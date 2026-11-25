// M344: Tastatur auf dem Board — Karten auswählen, weiterspringen, öffnen, Werkzeug und Zoom.
//
// Bisher ging auf dem Board fast alles nur mit der Maus: Man konnte keine Karte per Tastatur
// auswählen, nicht zur nächsten springen, nicht in den Text hinein und wieder heraus.
// Die Kürzel stehen (wie alle) in lib/tasten.ts; hier werden sie ausgeführt, weil sie die Kamera brauchen.
import { overlayOffen } from '../lib/overlay';
import { reiseStand } from '../lib/rahmenReise';
import { leseFolge } from '../lib/kartenFolge';
import { zahlWort } from '../lib/sprache';
import { fokusStufeLoesen, FOKUS_ANSICHT_EREIGNIS } from '../lib/fokusAnsicht';
import { useEffect, type MutableRefObject } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { dokumentHatPfeile } from './nodes/FileCard';
import { type AppNode } from '../types';

interface Kamera {
  getViewport: () => { x: number; y: number; zoom: number };
  setCenter: (x: number, y: number, o?: { zoom?: number; duration?: number }) => unknown;
  zoomIn: (o?: { duration?: number }) => unknown;
  zoomOut: (o?: { duration?: number }) => unknown;
  zoomTo: (z: number, o?: { duration?: number }) => unknown;
}
const mass = (n: AppNode) => ({ w: n.measured?.width ?? n.width ?? 260, h: n.measured?.height ?? n.height ?? 120 });
const mitte = (n: AppNode) => { const m = mass(n); return { x: n.position.x + m.w / 2, y: n.position.y + m.h / 2 }; };
/** Karten in Lesefolge: zeilenweise von oben, in der Zeile von links (M390; seit M413 eine Regel für alle: lib/kartenFolge.ts) */
export const lesefolge = (ns: AppNode[]) => leseFolge(ns);

export function useBoardTasten(kamera: Kamera, anzRef: MutableRefObject<number>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useBoard.getState();
      if (st.view !== 'board' || st.presenting || st.searchOpen || st.settingsOpen || st.helpOpen || st.tasksOpen) return;
      if (overlayOffen()) return;   // M388: auch Ticket-Fenster und Bild-Lupe (lib/overlay.ts)
      // M514: In der Rahmen-Reise gehören Pfeile, Pos1/Ende und Leertaste der Reise (components/RahmenReise.tsx) — dieser
      // Zuhörer hängt früher am Fenster und wählte sonst die erste/letzte Karte samt Kamerafahrt, mitten in den Flug
      if (reiseStand()) return;
      const t = e.target as HTMLElement | null;
      const closest = (sel: string) => (typeof t?.closest === 'function' ? t.closest(sel) : null);
      if (closest('.modal, [role="dialog"], [role="menu"], .dock-menu, .sel-more-menu, .nav-panel')) return;
      const imText = !!closest('input, textarea, select, [contenteditable="true"]');
      // „auf der Fläche": die Taste gilt dem Board, nicht einem Knopf oder Feld daneben
      const aufFlaeche = !t || t === document.body || !!t.classList?.contains('react-flow__node') || !!closest('.react-flow__pane');
      const strg = e.ctrlKey || e.metaKey;
      const board = selectActiveBoard(st);
      const sichtbar = board.nodes.filter((n) => (!n.archived || st.showArchived) && n.type !== 'frame');
      const gewaehlt = sichtbar.filter((n) => n.selected);
      const tun = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };

      /** Genau diese Karte wählen, ins Bild holen und ihr den Tastatur-Fokus geben (dann verschieben die Pfeile sie) */
      const waehle = (n: AppNode, dazu = false) => {
        st.onNodesChange(dazu
          ? [{ id: n.id, type: 'select' as const, selected: true }]
          : board.nodes.map((k) => ({ id: k.id, type: 'select' as const, selected: k.id === n.id })));
        const vp = kamera.getViewport();
        const fl = document.querySelector('.react-flow')?.getBoundingClientRect();
        const m = mass(n);
        if (fl) {
          const l = n.position.x * vp.zoom + vp.x; const o = n.position.y * vp.zoom + vp.y;
          const drin = l > 20 && o > 70 && l + m.w * vp.zoom < fl.width - 20 && o + m.h * vp.zoom < fl.height - 90;
          if (!drin) void kamera.setCenter(n.position.x + m.w / 2, n.position.y + m.h / 2, { zoom: vp.zoom, duration: 240 });
        }
        requestAnimationFrame(() => {
          for (const el of Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]) if (el.dataset.id === n.id) el.focus({ preventScroll: true });
        });
      };

      // ── Esc im Notiz-Text: zurück zur Karte (sie bleibt gewählt) ────────────────────────
      if (e.key === 'Escape' && !st.focusCard && closest('.react-flow__node [contenteditable="true"]')
        && !document.querySelector('.bn-suggestion-menu, .sel-menu-fixed, [role="menu"]')) {
        const id = (closest('.react-flow__node') as HTMLElement | null)?.dataset.id;
        const n = sichtbar.find((k) => k.id === id);
        if (n) { (document.activeElement as HTMLElement | null)?.blur?.(); window.getSelection()?.removeAllRanges(); waehle(n); }
        return; // andere Esc-Zuhörer (Rückflug) dürfen weiter
      }

      // ── Nächste / vorige Karte: Alt+↓/↑ überall auf dem Board, Tab auf der Fläche ───────
      const altPfeil = e.altKey && !strg && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp');
      // Tab nur, wenn schon eine Karte gewählt ist oder den Fokus hat — sonst führt Tab wie gewohnt zu den Knöpfen
      const tab = e.key === 'Tab' && !strg && !e.altKey && aufFlaeche && !imText && (gewaehlt.length > 0 || !!t?.classList?.contains('react-flow__node'));
      if ((altPfeil || tab) && !st.focusCard && sichtbar.length) {
        // M447: Tab an der letzten Karte (Umschalt+Tab an der ersten) verlässt die Fläche zum nächsten Bedienelement
        // (Auswahl-Leiste, Dock) — vorher kreiste der Fokus ohne Ausweg nur durch die Karten (WCAG 2.1.2).
        if (tab && gewaehlt.length) {
          const reihe = lesefolge(sichtbar);
          const i0 = reihe.findIndex((n) => n.id === gewaehlt[0].id);
          if (i0 >= 0 && (e.shiftKey ? i0 === 0 : i0 === reihe.length - 1)) {
            const anker = document.querySelector('.react-flow__viewport');
            const ziele = anker ? [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
              .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !anker.contains(el) && !el.closest('[aria-hidden="true"]')
                && !!(anker.compareDocumentPosition(el) & (e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING))) : [];
            const ziel = e.shiftKey ? ziele[ziele.length - 1] : ziele[0];
            if (ziel) return tun(() => ziel.focus());
          }
        }
        return tun(() => {
          const folge = lesefolge(sichtbar);
          const zurueck = altPfeil ? e.key === 'ArrowUp' : e.shiftKey;
          const i = gewaehlt.length ? folge.findIndex((n) => n.id === gewaehlt[0].id) : -1;
          const ziel = i < 0 ? (zurueck ? folge.length - 1 : 0) : (i + (zurueck ? -1 : 1) + folge.length) % folge.length;
          if (imText) (document.activeElement as HTMLElement | null)?.blur?.();
          waehle(folge[ziel]);
        });
      }
      if (imText) return;

      // ── Strg+Pfeil: zur Karte in dieser Richtung ────────────────────────────────────────
      // M345: mit Umschalt kommt die Karte zur Auswahl dazu
      if (strg && !e.altKey && /^Arrow/.test(e.key) && !st.focusCard && sichtbar.length) {
        const dazu = e.shiftKey;
        // Ausgangspunkt: die Karte mit dem Tastatur-Fokus (die zuletzt erreichte), sonst die erste gewählte
        const fokusId = (closest('.react-flow__node') as HTMLElement | null)?.dataset.id;
        const start = gewaehlt.find((n) => n.id === fokusId) ?? gewaehlt[0];
        return tun(() => {
          const vp = kamera.getViewport();
          const fl = document.querySelector('.react-flow')?.getBoundingClientRect();
          const von = start ? mitte(start) : { x: ((fl?.width ?? 1200) / 2 - vp.x) / vp.zoom, y: ((fl?.height ?? 800) / 2 - vp.y) / vp.zoom };
          const [rx, ry] = e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowDown' ? [0, 1] : [0, -1];
          let best: AppNode | null = null; let bestWert = Infinity;
          for (const n of sichtbar) {
            if (start && n.id === start.id) continue;
            if (dazu && n.selected) continue;
            const m = mitte(n);
            const laengs = (m.x - von.x) * rx + (m.y - von.y) * ry;
            const quer = Math.abs((m.x - von.x) * ry) + Math.abs((m.y - von.y) * rx);
            if (laengs <= 8) continue;               // nicht in dieser Richtung
            const wert = laengs + quer * 2.2;        // geradeaus zählt mehr als schräg
            if (wert < bestWert) { bestWert = wert; best = n; }
          }
          if (best) waehle(best, dazu);
        });
      }
      // M530: auch gewählte Rahmen — samt Inhalt (store/karten.ts `dupliziere`)
      const mitRahmen = board.nodes.filter((n) => n.selected && (!n.archived || st.showArchived));
      if (strg && !e.altKey && !e.shiftKey && e.code === 'KeyD' && mitRahmen.length) {
        return tun(() => {
          void st.dupliziere(mitRahmen.map((n) => n.id)).then((zahl) => { if (zahl) st.showToast(`${zahlWort(zahl, 'Karte', 'Karten')} dupliziert`); });
        });
      }
      if (strg || e.altKey) return;

      // ── Pfeiltasten schieben die gewählten Karten (M390) ─────────────────────────────────
      // Vorher tat das die Bibliothek selbst: ohne Rückgängig-Schritt (Strg+Z nahm den Schritt davor mit) und ohne
      // den Inhalt eines Rahmens mitzunehmen. Schrittweite wie gewohnt: 5 Punkte, mit Umschalt 20.
      // M521: auch gewählte RAHMEN — `gewaehlt` kennt sie nicht (Tab springt nur von Karte zu Karte). War nur ein Rahmen
      // gewählt, schob ihn weiter die Bibliothek: ohne seinen Inhalt und ohne Rückgängig-Schritt; neben einer Karte
      // gewählt, blieb er liegen.
      const schiebbar = board.nodes.filter((n) => n.selected && (!n.archived || st.showArchived));
      if (/^Arrow/.test(e.key) && schiebbar.length && !st.focusCard && t?.classList?.contains('react-flow__node')) {
        // In einem Dokument (PDF, Word, Folien), das zuletzt angefasst wurde, blättern ← → — das regelt die Karte selbst
        if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && schiebbar.length === 1 && gewaehlt.length === 1 && dokumentHatPfeile(gewaehlt[0].id)) return;
        const w = e.shiftKey ? 20 : 5;
        const [dx, dy] = e.key === 'ArrowRight' ? [w, 0] : e.key === 'ArrowLeft' ? [-w, 0] : e.key === 'ArrowDown' ? [0, w] : [0, -w];
        e.stopPropagation();
        return tun(() => st.verschiebeUm(schiebbar.map((n) => n.id), dx, dy));
      }

      // ── Enter: in die gewählte Karte — Notiz: schreiben, sonst: im Fokus öffnen ─────────
      if (e.key === 'Enter' && aufFlaeche && gewaehlt.length === 1 && !st.focusCard) {
        return tun(() => {
          const n = gewaehlt[0];
          if (n.type !== 'note') { st.setFocusCard(n.id); return; }
          window.dispatchEvent(new CustomEvent('pixinotes:notiz-aktiv', { detail: { id: n.id } }));
          let versuche = 0;
          const hinein = () => {
            const karte = (Array.from(document.querySelectorAll('.react-flow__node')) as HTMLElement[]).find((el) => el.dataset.id === n.id);
            const feld = karte?.querySelector('[contenteditable="true"]') as HTMLElement | null;
            if (!feld) { versuche += 1; if (versuche < 90) requestAnimationFrame(hinein); return; }
            feld.focus({ preventScroll: true });
            const r = document.createRange(); r.selectNodeContents(feld); r.collapse(false);
            const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
          };
          requestAnimationFrame(hinein);
        });
      }
      // ── Pos1 / Ende: erste und letzte Karte in Lesereihenfolge (M345) ───────────────────
      // M352: in einer PDF-/Word-Seite mit Tastatur-Fokus blättern Pos1/Ende (FileCard) — die Fläche umfasst auch die Karten
      if ((e.key === 'Home' || e.key === 'End') && aufFlaeche && !e.shiftKey && !st.focusCard && sichtbar.length && !closest('.pdf-seite-wrap')) {
        return tun(() => { const folge = lesefolge(sichtbar); waehle(e.key === 'Home' ? folge[0] : folge[folge.length - 1]); });
      }
      // ── Zoom ────────────────────────────────────────────────────────────────────────────
      if (e.key === '+' || e.key === '=') return tun(() => { void kamera.zoomIn({ duration: 140 }); });
      if (e.key === '-') return tun(() => { void kamera.zoomOut({ duration: 140 }); });
      // M530: Im Karten-Fokus heißt 0 „zurück zur gewählten Darstellung" (die Karte wieder eingepasst) — vorher 100 %,
      // und die offene Karte stand irgendwo halb im Bild
      if (e.key === '0' && st.focusCard) return tun(() => { fokusStufeLoesen(); window.dispatchEvent(new CustomEvent(FOKUS_ANSICHT_EREIGNIS)); });
      if (e.key === '0') return tun(() => { void kamera.zoomTo(anzRef.current || 1, { duration: 200 }); });
      // ── Werkzeuge ───────────────────────────────────────────────────────────────────────
      if (e.shiftKey) return;
      if (e.code === 'KeyV') return tun(() => st.setTool('select'));
      if (e.code === 'KeyP') return tun(() => st.setTool('pen'));
      if (e.code === 'KeyM') return tun(() => st.setTool('marker'));
      if (e.code === 'KeyE') return tun(() => st.setTool('eraser'));
    };
    // Capture: vor React Flow, das Pfeile und Enter an der fokussierten Karte selbst deutet
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
