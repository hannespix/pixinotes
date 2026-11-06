/**
 * Finger-Gesten überall auf dem Board — nach dem Vorbild von Procreate (M326).
 *
 *   Zwei-Finger-Tipp        Rückgängig          Zwei Finger halten     schnell zurück
 *   Drei-Finger-Tipp        Wiederholen         Drei Finger halten     schnell vor
 *   Schnelles Zusammen-/Auseinanderziehen   Alles einpassen — noch einmal: zurück zur Ansicht
 *   Vier-Finger-Tipp        Vollbild an/aus
 *   Drei Finger nach unten  Auswahl duplizieren; ohne Auswahl: ＋-Palette
 *
 * Nicht in Textfeldern, nicht auf Bedienleisten, nicht bei offenen Dialogen,
 * nicht während ein Stift-Zug läuft (die Zeichenebene meldet ihn am <body>).
 * Ein Schalter unter ⚙ → Darstellung schaltet alles ab.
 */
import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { uid } from '../types';

/** So kurz, so still ist ein Tipp */
const TIPP_MS = 300;
const TIPP_PX = 12;
/** Halten: nach dieser Zeit beginnt das schnelle Zurück/Vor (Procreate: „Rapid Undo Delay") */
const HALTEN_MS = 450;
const HALTEN_TAKT_MS = 170;
/** Quick-Pinch: so schnell, so deutlich */
const PINCH_MS = 320;
const PINCH_FAKTOR = 1.7;
/** Drei-Finger-Wischen nach unten */
const WISCH_PX = 80;
const WISCH_MS = 700;

const TABU = '.note-editor, input, textarea, select, button, a, [contenteditable="true"], .dock, .dock-menu, .draw-palette, .sel-toolbar, .sel-toolbar-dock, .modal-backdrop, .modal, .tabs, .topbar, .top-actions, .taskhub, .focus-head, .focus-nav, .toast, .schrift-vorschlag, .react-flow__minimap';

interface Finger { t: number; x: number; y: number; x0: number; y0: number; weit: boolean }

export function FingerGesten() {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const an = useBoard((s) => s.fingerGesten);
  const finger = useRef<Map<number, Finger>>(new Map());
  const maxFinger = useRef(0);
  const beginn = useRef(0);
  const verbraucht = useRef(false);
  const halteTimer = useRef<number | null>(null);
  const halteTakt = useRef<number | null>(null);
  const pinchStart = useRef<number | null>(null);
  /** Ansicht beim Aufsetzen des zweiten Fingers — VOR dem, was d3-zoom aus dem Pinch macht */
  const pinchAnsicht = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const vorherigeAnsicht = useRef<{ x: number; y: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!an) return;
    const halteStopp = () => {
      if (halteTimer.current !== null) { window.clearTimeout(halteTimer.current); halteTimer.current = null; }
      if (halteTakt.current !== null) { window.clearInterval(halteTakt.current); halteTakt.current = null; }
    };
    const gesperrt = (e: TouchEvent): boolean => {
      const st = useBoard.getState();
      if (st.searchOpen || st.settingsOpen || st.tasksOpen || st.helpOpen || st.presenting || st.focusCard) return true;
      if (document.body.dataset.stiftZug === '1') return true;
      const ziel = e.target as HTMLElement | null;
      if (!ziel?.closest) return true;
      if (ziel.closest(TABU)) return true;
      return !ziel.closest('.react-flow');
    };
    const abstand = () => {
      const [a, b] = Array.from(finger.current.values());
      return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    };
    const rueckgaengig = (): boolean => {
      const st = useBoard.getState();
      if (st.past.length === 0) return false;
      st.undo();
      return true;
    };
    const wiederholen = (): boolean => {
      const st = useBoard.getState();
      if (st.future.length === 0) return false;
      st.redo();
      return true;
    };
    const toast = (t: string) => useBoard.getState().showToast(t);

    const start = (e: TouchEvent) => {
      if (gesperrt(e)) { if (finger.current.size === 0) verbraucht.current = true; return; }
      const jetzt = Date.now();
      if (finger.current.size === 0) { beginn.current = jetzt; maxFinger.current = 0; verbraucht.current = false; pinchStart.current = null; }
      for (const t of Array.from(e.changedTouches)) finger.current.set(t.identifier, { t: jetzt, x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, weit: false });
      maxFinger.current = Math.max(maxFinger.current, finger.current.size);
      if (finger.current.size === 2) { pinchStart.current = abstand(); pinchAnsicht.current = getViewport(); }
      // Halten mit zwei oder drei Fingern → nach einer Weile schnell zurück/vor
      halteStopp();
      const n = finger.current.size;
      if (n === 2 || n === 3) {
        halteTimer.current = window.setTimeout(() => {
          if (finger.current.size !== n || Array.from(finger.current.values()).some((f) => f.weit)) return;
          verbraucht.current = true;
          const schritt = n === 2 ? rueckgaengig : wiederholen;
          if (!schritt()) return;
          toast(n === 2 ? '↶ Rückgängig … (halten = schnell zurück)' : '↷ Wiederholen … (halten = schnell vor)');
          halteTakt.current = window.setInterval(() => { if (!schritt()) halteStopp(); }, HALTEN_TAKT_MS);
        }, HALTEN_MS);
      }
    };
    const bewegen = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const f = finger.current.get(t.identifier);
        if (!f) continue;
        f.x = t.clientX; f.y = t.clientY;
        if (!f.weit && Math.hypot(t.clientX - f.x0, t.clientY - f.y0) > TIPP_PX) { f.weit = true; halteStopp(); }
      }
    };
    const ende = (e: TouchEvent) => {
      const jetzt = Date.now();
      const alle = Array.from(finger.current.values());
      // Quick-Pinch: zwei Finger, schnell, deutlich — bewertet beim ersten Loslassen
      if (finger.current.size === 2 && pinchStart.current && pinchStart.current > 0 && !verbraucht.current && e.type === 'touchend') {
        const faktor = abstand() / pinchStart.current;
        if (jetzt - beginn.current < PINCH_MS && (faktor > PINCH_FAKTOR || faktor < 1 / PINCH_FAKTOR)) {
          verbraucht.current = true;
          const vorher = vorherigeAnsicht.current;
          if (vorher) {
            vorherigeAnsicht.current = null;
            void setViewport(vorher, { duration: 300 });
            toast('↩ Zurück zur vorherigen Ansicht');
          } else {
            vorherigeAnsicht.current = pinchAnsicht.current ?? getViewport();
            void fitView({ padding: 0.15, duration: 300 });
            toast('⤢ Alles eingepasst (noch einmal: zurück)');
          }
        }
      }
      for (const t of Array.from(e.changedTouches)) finger.current.delete(t.identifier);
      if (finger.current.size > 0) return;
      halteStopp();
      const n = maxFinger.current;
      maxFinger.current = 0;
      if (verbraucht.current || e.type !== 'touchend' || n < 2) return;
      const dauer = jetzt - beginn.current;
      const beendet = alle;
      const still = beendet.every((f) => !f.weit);
      if (still && dauer < TIPP_MS) {
        if (n === 2) { toast(rueckgaengig() ? '↶ Rückgängig (Zwei-Finger-Tipp)' : 'Nichts rückgängig zu machen'); return; }
        if (n === 3) { toast(wiederholen() ? '↷ Wiederholen (Drei-Finger-Tipp)' : 'Nichts zu wiederholen'); return; }
        if (n === 4) {
          if (document.fullscreenElement) { void document.exitFullscreen().then(() => toast('⛶ Vollbild aus')).catch(() => toast('Vollbild ließ sich nicht beenden')); }
          else { void document.documentElement.requestFullscreen?.().then(() => toast('⛶ Vollbild (Vier-Finger-Tipp beendet es)')).catch(() => toast('Vollbild ist hier nicht möglich')); }
          return;
        }
        return;
      }
      // Drei Finger nach unten: Auswahl duplizieren, sonst ＋-Palette
      if (n === 3 && dauer < WISCH_MS && beendet.length >= 3) {
        const dy = beendet.reduce((a, f) => a + (f.y - f.y0), 0) / beendet.length;
        const dx = beendet.reduce((a, f) => a + Math.abs(f.x - f.x0), 0) / beendet.length;
        if (dy > WISCH_PX && dx < 60) {
          const st = useBoard.getState();
          const auswahl = selectActiveBoard(st).nodes.filter((k) => k.selected && k.type !== 'frame');
          if (auswahl.length > 0) {
            for (const k of auswahl) st.addNode({ ...k, id: uid(), selected: false, position: { x: k.position.x + 30, y: k.position.y + 30 }, data: JSON.parse(JSON.stringify(k.data)) });
            toast(`⧉ ${auswahl.length} Karte${auswahl.length > 1 ? 'n' : ''} dupliziert (Drei-Finger-Wischen)`);
          } else {
            window.dispatchEvent(new CustomEvent('pixinotes:palette'));
          }
        }
      }
    };
    window.addEventListener('touchstart', start, { capture: true, passive: true });
    window.addEventListener('touchmove', bewegen, { capture: true, passive: true });
    window.addEventListener('touchend', ende, true);
    window.addEventListener('touchcancel', ende, true);
    return () => {
      halteStopp();
      window.removeEventListener('touchstart', start, true);
      window.removeEventListener('touchmove', bewegen, true);
      window.removeEventListener('touchend', ende, true);
      window.removeEventListener('touchcancel', ende, true);
    };
  }, [an, fitView, getViewport, setViewport]);

  return null;
}
