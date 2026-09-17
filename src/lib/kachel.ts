/**
 * M298: Kennzahlen für die Kachel-Ansicht großer Module.
 *
 * Kanban, Zeitplan, Wochenplan und Protokoll-Reihe wachsen mit ihrem Inhalt
 * und sprengen den Bildschirm. Als Kachel zeigt so ein Modul nur noch, was
 * man auf einen Blick wissen will — und öffnet sich im Fokus (Doppelklick,
 * am Handy ein Tipp). Das Konzept nennt das seit jeher „ein Objekt, zwei
 * Ansichten"; hier ist es die zweite.
 *
 * Die Zeilen sind bewusst Sätze für Menschen, keine Tabellen: „5 überfällig",
 * „Nächste Frist: Do., 17.09. · Vergabeakte prüfen".
 */
import { doneCol, kanbanCols, type AppNode, type GanttData, type KanbanData, type MinutesData, type WeekData } from '../types';
import { formatDueShort, urgencyFor } from './tasks';

export interface KachelZeile { text: string; warn?: boolean }
export interface KachelInfo { typ: string; titel: string; zeilen: KachelZeile[] }

const datum = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};
const heuteIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const uhr = (min: number): string => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

export function kachelInfo(node: AppNode): KachelInfo | null {
  switch (node.type) {
    case 'kanban': {
      const d = node.data as KanbanData;
      const cols = kanbanCols(d);
      const dc = doneCol(d);
      const items = Array.isArray(d.items) ? d.items : [];
      const spalte = (it: { col: number }) => Math.max(0, Math.min(dc, it.col));
      const zeilen: KachelZeile[] = [{ text: cols.map((c, i) => `${c} ${items.filter((it) => spalte(it) === i).length}`).join(' · ') }];
      const offen = items.filter((it) => spalte(it) < dc);
      const ueberfaellig = offen.filter((it) => urgencyFor(it.due) === 'overdue').length;
      if (ueberfaellig > 0) zeilen.push({ text: `${ueberfaellig} überfällig`, warn: true });
      // Überfälliges steht schon in seiner eigenen Zeile — hier zählt die nächste kommende Frist
      const heute = heuteIso();
      const naechste = offen.filter((it) => it.due && it.due >= heute).sort((a, b) => a.due!.localeCompare(b.due!))[0];
      if (naechste) zeilen.push({ text: `Nächste Frist: ${formatDueShort(naechste.due!)} · ${naechste.text.slice(0, 40)}` });
      return { typ: 'Kanban', titel: d.title || 'Kanban', zeilen };
    }
    case 'gantt': {
      const g = node.data as GanttData;
      const rows = Array.isArray(g.rows) ? g.rows : [];
      if (rows.length === 0) return { typ: 'Zeitplan', titel: g.title || 'Zeitplan', zeilen: [{ text: 'Noch keine Vorgänge' }] };
      const starts = rows.map((r) => r.start).sort();
      const ends = rows.map((r) => r.end).sort();
      const heute = heuteIso();
      const laufend = rows.filter((r) => r.start <= heute && r.end >= heute).length;
      const fortschritt = Math.round(rows.reduce((a, r) => a + (r.progress ?? 0), 0) / rows.length);
      const naechster = rows.filter((r) => r.end >= heute).sort((a, b) => a.end.localeCompare(b.end))[0];
      const zeilen: KachelZeile[] = [
        { text: `${rows.length} Vorg${rows.length === 1 ? 'ang' : 'änge'} · ${datum(starts[0])} bis ${datum(ends[ends.length - 1])}` },
        { text: `${laufend} laufen heute · ${fortschritt} % erledigt` },
      ];
      if (naechster) zeilen.push({ text: `Nächster Endtermin: ${datum(naechster.end)} · ${naechster.name.slice(0, 40)}` });
      return { typ: 'Zeitplan', titel: g.title || 'Zeitplan', zeilen };
    }
    case 'week': {
      const w = node.data as WeekData;
      const e = Array.isArray(w.entries) ? w.entries : [];
      const spalten = w.cols?.length ?? w.days ?? 5;
      const zeilen: KachelZeile[] = [{ text: `${e.length} Bl${e.length === 1 ? 'ock' : 'öcke'} in ${spalten} Spalten` }];
      if (!w.cols) {
        const heuteIdx = (new Date().getDay() + 6) % 7;
        const heute = e.filter((x) => x.day === heuteIdx).sort((a, b) => a.start - b.start);
        if (heuteIdx < (w.days ?? 5)) {
          zeilen.push({
            text: heute.length === 0
              ? 'Heute frei'
              : `Heute: ${heute.slice(0, 3).map((x) => `${w.axis === 'slots' ? '' : `${uhr(x.start)} `}${x.text.slice(0, 18)}`).join(' · ')}${heute.length > 3 ? ' …' : ''}`,
          });
        }
      }
      return { typ: 'Wochenplan', titel: w.title || 'Wochenplan', zeilen };
    }
    case 'minutes': {
      const m = node.data as MinutesData;
      const entries = Array.isArray(m.entries) ? [...m.entries].sort((a, b) => b.date.localeCompare(a.date)) : [];
      const beschluesse = entries.reduce((a, en) => a + (en.decisions?.length ?? 0), 0);
      const zeilen: KachelZeile[] = [{
        text: `${entries.length} Sitzung${entries.length === 1 ? '' : 'en'}${entries[0] ? ` · zuletzt ${datum(entries[0].date)}` : ''}`,
      }];
      if (beschluesse > 0) zeilen.push({ text: `${beschluesse} Beschl${beschluesse === 1 ? 'uss' : 'üsse'}` });
      return { typ: 'Protokoll-Reihe', titel: m.title || 'Protokoll', zeilen };
    }
    default:
      return null;
  }
}
