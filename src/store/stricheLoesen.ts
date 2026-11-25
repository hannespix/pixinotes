/**
 * Markierungen von ihrer Karte lösen (Kartenmenü „Markierungen lösen") — sie bleiben frei auf dem Board liegen.
 *
 * M521: aus store/zeichnen.ts herausgelöst und erst beim Aufruf geladen (Start-JS, M446) — die Aktion `detachStrokes`
 * bleibt in der Scheibe und ruft hierher. Geschrieben wird wie in jeder Aktion über `patchActive` (Leseschutz, M360).
 */
import { seiteVon, strichRelativ } from '../lib/pdfSeiten';
import type { Holen, AufsOffene } from './typen';

export function stricheLoesen(get: Holen, patchActive: AufsOffene, nodeIds: string[]): void {
  const board = get().boards.find((b) => b.id === get().activeId);
  if (!board) return;
  const idSet = new Set(nodeIds);
  const affected = (board.drawings ?? []).filter((s) => s.anchor && idSet.has(s.anchor));
  if (affected.length === 0) return;
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  get().pushHistory();
  patchActive((b) => ({
    drawings: (b.drawings ?? []).map((s) => {
      if (!s.anchor || !idSet.has(s.anchor)) return s;
      const n = byId.get(s.anchor);
      // M335: Seitenstriche kommen in Kartenpunkten zurück — verdeckte (Seite nicht offen) bleiben, wie sie sind
      const rel = strichRelativ(s); // M339: Text-Striche dort, wo man sie gerade sieht
      if (s.seite != null && rel.length === 0) return s;
      const g = s.seitenBreite && s.anchor ? seiteVon(s.anchor) : undefined;
      return {
        ...s,
        width: g ? s.width * g.k : s.width,
        seitenBreite: undefined,
        anchor: undefined,
        seite: undefined,
        amText: undefined,
        block: undefined,
        blockY: undefined,
        points: n ? rel.map(([px, py]) => [px + n.position.x, py + n.position.y] as [number, number]) : rel,
      };
    }),
  }));
  get().showToast(affected.length === 1
    ? 'Markierung von der Karte gelöst – sie bleibt frei auf dem Board.'
    : `${affected.length} Markierungen von der Karte gelöst – sie bleiben frei auf dem Board.`);
}
