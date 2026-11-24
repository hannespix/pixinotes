// M520: Die ANSICHT einer Karte, die man nicht ändern darf (Board nur zum Lesen geteilt, Gast mit „nur Eigenes").
//
// Kalender, Zeiterfassung, Protokoll, Zeitplan und Tabelle merken sich in ihren Daten auch, was gerade gezeigt wird:
// Monat, Ansicht, Sitzung, Zeit-Skala, Filter. Der Leseschutz (store/schutz.ts) verwirft jede Änderung an den Daten —
// zu Recht für den Inhalt, aber damit ließ sich in einem nur lesend geteilten Board auch kein Monat weiterblättern,
// keine ältere Sitzung öffnen und die Tabelle nicht sortieren („Dieses Board ist nur zum Lesen freigegeben").
//
// Hier gilt: Darf die Karte nicht geändert werden, bleibt ein Wechsel der Ansicht auf diesem Gerät (im Arbeitsspeicher,
// je Karte) und überlagert beim Zeichnen die Daten. Der Speicher sieht davon nichts — es entsteht kein Stand, den es
// sonst nirgends gibt. Alles andere (Inhalt) geht wie bisher an den Speicher, der es ablehnt und sagt, warum.
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useBoard, useKarteFest } from '../store';

const lokal = new Map<string, Record<string, unknown>>();
const hoerer = new Set<() => void>();
let stand = 0;
const abo = (h: () => void) => { hoerer.add(h); return () => { hoerer.delete(h); }; };
const standJetzt = () => stand;

/**
 * Daten der Karte samt lokaler Ansicht — und ein Schreiber mit der Form von `updateNodeData` (id, patch).
 * `felder`: Namen der Ansichts-Felder in `data` (eine feste Liste je Kartentyp, nicht je Zeichnen neu).
 */
export function useKartenAnsicht<T extends object>(id: string, data: T, felder: readonly string[]): [T, (id: string, patch: Record<string, unknown>) => void] {
  const fest = useKarteFest((data as { von?: string }).von);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  useSyncExternalStore(abo, standJetzt);
  const eigen = fest ? lokal.get(id) : undefined;
  const sicht = useMemo(() => (eigen ? { ...data, ...eigen } : data), [data, eigen]);
  const schreiben = useCallback((_id: string, patch: Record<string, unknown>) => {
    if (!fest) { updateNodeData(id, patch); return; }
    const ansicht: Record<string, unknown> = {};
    const inhalt: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) (felder.includes(k) ? ansicht : inhalt)[k] = v;
    if (Object.keys(ansicht).length) {
      lokal.set(id, { ...(lokal.get(id) ?? {}), ...ansicht });
      stand += 1;
      for (const h of [...hoerer]) h();
    }
    if (Object.keys(inhalt).length) updateNodeData(id, inhalt);
  }, [fest, id, updateNodeData, felder]);
  return [sicht, schreiben];
}
