// M396: Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen, halten = schnell zurück/vor — außerhalb des
// Boards (Präsentation). Auf dem Board macht das components/FingerGesten.tsx, zusammen mit den Gesten, die die
// Kamera des Boards brauchen; hier ist nur, was überall gilt. Dieselben Zeiten, dieselben Meldungen.
import { useEffect } from 'react';
import { useBoard } from '../store';

const TIPP_MS = 300;
const TIPP_PX = 12;
const HALTEN_MS = 450;
const HALTEN_TAKT_MS = 170;

interface Finger { x0: number; y0: number; weit: boolean }

/** `erlaubt` entscheidet am ersten Finger, ob die Stelle Gesten annimmt (nicht in Textfeldern, nicht auf Leisten) */
export function useTippGesten(aktiv: boolean, erlaubt: (ziel: HTMLElement | null) => boolean): void {
  useEffect(() => {
    if (!aktiv) return;
    const finger = new Map<number, Finger>();
    let max = 0; let beginn = 0; let verbraucht = false;
    let halteTimer: number | null = null; let halteTakt: number | null = null;
    const halteStopp = () => {
      if (halteTimer !== null) { window.clearTimeout(halteTimer); halteTimer = null; }
      if (halteTakt !== null) { window.clearInterval(halteTakt); halteTakt = null; }
    };
    const zurueck = (): boolean => { const st = useBoard.getState(); if (st.past.length === 0) return false; st.undo(); return true; };
    const vor = (): boolean => { const st = useBoard.getState(); if (st.future.length === 0) return false; st.redo(); return true; };
    const toast = (t: string) => useBoard.getState().showToast(t);

    const start = (e: TouchEvent) => {
      if (finger.size === 0) {
        beginn = Date.now(); max = 0;
        // ein Stift-Zug läuft (die Zeichenschicht meldet ihn am <body>): Das ist die aufgelegte Hand, keine Geste
        verbraucht = document.body.dataset.stiftZug === '1' || !erlaubt(e.target as HTMLElement | null);
      }
      for (const t of Array.from(e.changedTouches)) finger.set(t.identifier, { x0: t.clientX, y0: t.clientY, weit: false });
      max = Math.max(max, finger.size);
      halteStopp();
      const n = finger.size;
      if (!verbraucht && (n === 2 || n === 3)) {
        halteTimer = window.setTimeout(() => {
          if (finger.size !== n || Array.from(finger.values()).some((f) => f.weit)) return;
          verbraucht = true;
          const schritt = n === 2 ? zurueck : vor;
          if (!schritt()) return;
          toast(n === 2 ? '↶ Rückgängig … (halten = schnell zurück)' : '↷ Wiederholen … (halten = schnell vor)');
          halteTakt = window.setInterval(() => { if (!schritt()) halteStopp(); }, HALTEN_TAKT_MS);
        }, HALTEN_MS);
      }
    };
    const bewegen = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const f = finger.get(t.identifier);
        if (f && !f.weit && Math.hypot(t.clientX - f.x0, t.clientY - f.y0) > TIPP_PX) { f.weit = true; halteStopp(); }
      }
    };
    const ende = (e: TouchEvent) => {
      const alle = Array.from(finger.values());
      for (const t of Array.from(e.changedTouches)) finger.delete(t.identifier);
      if (finger.size > 0) return;
      halteStopp();
      const n = max; max = 0;
      if (verbraucht || e.type !== 'touchend' || n < 2 || n > 3) return;
      if (alle.some((f) => f.weit) || Date.now() - beginn >= TIPP_MS) return;
      if (n === 2) toast(zurueck() ? '↶ Rückgängig (Zwei-Finger-Tipp)' : 'Nichts rückgängig zu machen');
      else toast(vor() ? '↷ Wiederholen (Drei-Finger-Tipp)' : 'Nichts zu wiederholen');
    };
    const opt = { capture: true, passive: true } as const;
    window.addEventListener('touchstart', start, opt);
    window.addEventListener('touchmove', bewegen, opt);
    window.addEventListener('touchend', ende, opt);
    window.addEventListener('touchcancel', ende, opt);
    return () => {
      halteStopp();
      window.removeEventListener('touchstart', start, true);
      window.removeEventListener('touchmove', bewegen, true);
      window.removeEventListener('touchend', ende, true);
      window.removeEventListener('touchcancel', ende, true);
    };
    // `erlaubt` darf sich je Render ändern, ohne die Lauscher neu zu setzen — es wird nur am ersten Finger gefragt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv]);
}
