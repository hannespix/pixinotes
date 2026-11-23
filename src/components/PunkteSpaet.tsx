// M502: Punkte (M377) — im Start-Paket nur diese beiden Wächter.
//
// Die Marken an den Karten und die Leiste des Punkte-Modus (Punkte.tsx, ~9 KB Quelltext) laden, sobald das Board
// Punkte trägt bzw. der Modus angeht — sonst still im Leerlauf nach dem Start (App.tsx). Einmal da, bleiben sie
// eingehängt, wie vorher von Anfang an. Ohne Punkte hängen sie nichts ins DOM.
import { lazy, Suspense, useEffect, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { PUNKTE_MODUS, punkteModus, punkteZahl } from '../lib/punkte';

export const punkteLaden = () => import('./Punkte');
const MarkenVoll = lazy(() => punkteLaden().then((m) => ({ default: m.PunkteMarken })));
const LeisteVoll = lazy(() => punkteLaden().then((m) => ({ default: m.PunkteLeiste })));

let markenDa = false;
/** Gehört in ein <ViewportPortal> des Boards */
export function PunkteMarkenSpaet() {
  const da = useBoard((s) => (selectActiveBoard(s)?.nodes ?? []).some((n) => punkteZahl(n.data) > 0));
  if (da) markenDa = true;
  return markenDa ? <Suspense fallback={null}><MarkenVoll /></Suspense> : null;
}

let leisteDa = false;
export function PunkteLeisteSpaet() {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(PUNKTE_MODUS, auf);
    return () => window.removeEventListener(PUNKTE_MODUS, auf);
  }, []);
  if (punkteModus()) leisteDa = true;
  return leisteDa ? <Suspense fallback={null}><LeisteVoll /></Suspense> : null;
}
