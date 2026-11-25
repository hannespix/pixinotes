/**
 * M530: Reihenfolge der Ausgänge eines Rahmens für die Rahmen-Reise festlegen — `ids` = Kanten in der neuen Folge, ihr
 * Platz landet als `data.folge` an der Kante (lib/rahmenReise.ts sortiert danach). Ein Rückgängig-Schritt.
 * Nachgeladen (Start-JS); die Aktion `ausgaengeOrdnen` bleibt in store/kanten.ts und ruft hierher.
 */
import type { Holen, AufsOffene } from './typen';

export function ausgaengeOrdnen(get: Holen, patchActive: AufsOffene, ids: string[]): void {
  get().pushHistory();
  const platz = new Map(ids.map((id, i) => [id, i]));
  patchActive((b) => ({ edges: b.edges.map((e) => (platz.has(e.id) && e.data?.folge !== platz.get(e.id) ? { ...e, data: { ...e.data, folge: platz.get(e.id) } } : e)) }));
}
