// M525: Im Zug festhalten — Ansichten, die auf alle Boards hören, zeichnen nicht mit jeder Mausbewegung neu.
//
// Beim Ziehen einer Karte ändert sich der Board-Stand mit jeder Mausbewegung (die Lage der Karte). Wer auf das
// ganze Board oder auf alle Boards hört, zeichnete deshalb je Mausbewegung komplett neu — gemessen: die Auswahl-Leiste
// mit gut 130 Symbolen, jedes Kanban des Boards mit allen Tickets, der Projektbaum. Nichts davon zeigt die Lage einer
// Karte. Solange gezogen wird, behalten diese Ansichten darum den Stand von vor dem Zug und lesen mit dem Ablegen neu
// (nachZug). `schluessel` nennt, was auch mitten im Zug zählt (etwa die Auswahl): Ändert es sich, wird sofort gelesen.
import { useReducer, useRef } from 'react';
import { useBoard } from '../store';
import { nachZug, zugLaeuft } from './zugAnzeige';

type Stand = ReturnType<typeof useBoard.getState>;

export function useImZugFest<T>(wahl: (s: Stand) => T, schluessel?: (s: Stand) => string): T {
  const fest = useRef<{ wert: T; schluessel: string } | null>(null);
  const [, neu] = useReducer((n: number) => n + 1, 0);
  return useBoard((s) => {
    const k = schluessel ? schluessel(s) : '';
    if (zugLaeuft() && fest.current && fest.current.schluessel === k) { nachZug(neu); return fest.current.wert; }
    const wert = wahl(s);
    fest.current = { wert, schluessel: k };
    return wert;
  });
}
