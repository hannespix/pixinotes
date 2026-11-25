/**
 * Karten (und Rahmen samt Inhalt) des offenen Boards duplizieren — ein Rückgängig-Schritt (M390).
 *
 * M530: aus store/karten.ts herausgelöst und erst beim Aufruf geladen (Start-JS, M446/M502); die Aktion `dupliziere`
 * bleibt in der Scheibe und ruft hierher. Geschrieben wird wie in jeder Aktion über `patchActive` (Leseschutz, M360).
 * Neu: Ein gewählter Rahmen kommt mit seinem Inhalt (auch archiviertem) und landet frei daneben; Rahmenpfeile nicht.
 */
import { uid, type AppNode } from '../types';
import { frameMembers, sizeOf } from '../lib/arrange';
import { frisch } from '../lib/kartenZeit';
import type { Holen, AufsOffene } from './typen';
import { selectActiveBoard } from './selektoren';
import { anhaengeMitnehmen } from './karten';

export function dupliziere(get: Holen, patchActive: AufsOffene, ids: string[]): number {
  // M390: EIN Schritt für alle gewählten Karten (vorher je Karte einer — Strg+Z ließ Kopien zurück), die
  // Verbindungen ZWISCHEN den Kopierten kommen mit, große Dateien und Tool-Quelltexte ebenfalls, und die
  // Kopien landen nie deckungsgleich auf einer früheren Kopie.
  const b = selectActiveBoard(get());
  // M530: Ein Rahmen kommt samt Inhalt (auch archiviertem, wie beim Ziehen) — vorher entstanden nur Kopien der Karten
  const set0 = new Set(ids);
  for (const f of b.nodes) if (set0.has(f.id) && f.type === 'frame') for (const m of frameMembers(f, b.nodes, true, true)) set0.add(m.id);
  const wahl = b.nodes.filter((n) => set0.has(n.id));
  if (!wahl.length) return 0;
  const istRahmen = new Set(wahl.filter((n) => n.type === 'frame').map((n) => n.id));
  let k = 1;
  const belegt = (kk: number) => wahl.some((n) => b.nodes.some((x) => x.type === n.type && Math.abs(x.position.x - (n.position.x + 30 * kk)) < 2 && Math.abs(x.position.y - (n.position.y + 30 * kk)) < 2));
  while (k < 40 && belegt(k)) k += 1;
  let dx = 30 * k; let dy = 30 * k;
  // M530: Ein Rahmen landet daneben, nicht 30 Punkte versetzt darüber — zwei Rahmen übereinander fingen gegenseitig
  // die Karten des anderen ein (Mittelpunkt im Rahmen, lib/arrange.ts) und zögen sie beim Verschieben mit
  if (istRahmen.size) {
    const xs = wahl.map((n) => n.position.x); const ys = wahl.map((n) => n.position.y);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys);
    const w = Math.max(...wahl.map((n) => n.position.x + sizeOf(n).w)) - x0; const h = Math.max(...wahl.map((n) => n.position.y + sizeOf(n).h)) - y0;
    // rechts daneben, sonst darunter — weiter hinaus, bis nichts im Weg liegt (findFreeSpot ließ Ränder überlappen)
    const andere = b.nodes.filter((n) => !set0.has(n.id) && !n.archived);
    const frei = (x: number, y: number) => andere.every((n) => { const m = sizeOf(n); return x >= n.position.x + m.w + 40 || x + w + 40 <= n.position.x || y >= n.position.y + m.h + 40 || y + h + 40 <= n.position.y; });
    for (let i = 1; i < 30; i += 1) {
      if (frei(x0 + i * (w + 60), y0)) { dx = i * (w + 60); dy = 0; break; }
      if (frei(x0, y0 + i * (h + 60))) { dx = 0; dy = i * (h + 60); break; }
    }
  }
  const karte = new Map(wahl.map((n) => [n.id, uid()]));
  const neu = wahl.map((n) => frisch({
    ...n, id: karte.get(n.id) as string, selected: true,
    position: { x: n.position.x + dx, y: n.position.y + dy },
    data: JSON.parse(JSON.stringify(n.data)),
  }) as AppNode);
  // M530: Rahmenpfeile (Rahmen → Rahmen) nicht: Die Kopie legte sonst eine zweite Rahmen-Reise neben die erste
  const kanten = b.edges.filter((e) => karte.has(e.source) && karte.has(e.target) && !(istRahmen.has(e.source) && istRahmen.has(e.target)))
    .map((e) => ({ ...e, id: uid(), source: karte.get(e.source) as string, target: karte.get(e.target) as string, selected: false }));
  get().pushHistory();
  patchActive((bb) => ({
    nodes: [...bb.nodes.map((n) => (n.selected ? ({ ...n, selected: false } as AppNode) : n)), ...neu],
    edges: [...bb.edges, ...kanten],
  }));
  anhaengeMitnehmen(wahl, karte);
  return neu.length;
}
