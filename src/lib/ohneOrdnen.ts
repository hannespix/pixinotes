// M463: „Nicht mit ordnen" – eine Eigenschaft der Karte (Feld `ohneOrdnen` an der Karte, wie `archived`).
//
// „Nach Themen ordnen" (M445, lib/themenOrdnen.ts) lässt solche Karten liegen – auch, wenn sie in einer Auswahl
// stecken. Gedacht für Karten mit festem Platz: Legende, Ziel-Notiz oben links, eine bewusst gelegte Gruppe.
// Kein Stempel für „geändert" (M453): Das ist eine Eigenschaft der Lage, nicht des Inhalts.
// Bewusst hier statt in store.ts (Hotspot): ein Schritt im Verlauf, dann ein Store-Update.
import { useBoard } from '../store';
import type { AppNode } from '../types';

/** Karten vom Ordnen ausnehmen (an) oder wieder mitordnen (aus) – EIN Schritt im Verlauf */
export function ohneOrdnenSetzen(ids: string[], an: boolean): void {
  if (!ids.length) return;
  const st = useBoard.getState();
  const wahl = new Set(ids);
  st.pushHistory();
  useBoard.setState((s) => ({
    boards: s.boards.map((b) => (b.id !== s.activeId ? b : {
      ...b,
      nodes: b.nodes.map((n) => {
        if (!wahl.has(n.id) || !!n.ohneOrdnen === an) return n;
        if (an) return { ...n, ohneOrdnen: true } as AppNode;
        const { ohneOrdnen: _o, ...rest } = n;
        return rest as AppNode;
      }),
    })),
  }));
  st.showToast(an
    ? (ids.length === 1 ? 'Die Karte ordnet nicht mehr mit – „Nach Themen ordnen" lässt sie liegen.' : `${ids.length} Karten ordnen nicht mehr mit – „Nach Themen ordnen" lässt sie liegen.`)
    : (ids.length === 1 ? 'Die Karte ordnet wieder mit.' : `${ids.length} Karten ordnen wieder mit.`), 'schritt', 4000);
}
