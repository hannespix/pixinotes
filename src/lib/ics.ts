// iCalendar (.ics): das Austauschformat, das Outlook, Google und Apple
// gleichermaßen sprechen. Hier: schlanker Parser für VEVENTs (Ganztages-
// und Datetime-Termine, mehrtägig) + Export sichtbarer Einträge.
// Bewusst ohne RRULE-Auflösung (Serientermine erscheinen am Starttag).
import { triggerDownload } from './download';

export interface IcsEvent {
  title: string;
  /** ISO yyyy-mm-dd (inklusiv) */
  start: string;
  end?: string;
}

function icsDate(val: string): { iso: string; dateOnly: boolean } | null {
  const m = val.trim().match(/^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?/);
  if (!m) return null;
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, dateOnly: !m[4] };
}

const shiftDay = (iso: string, n: number): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5)
    .toISOString().slice(0, 10);

/** VEVENTs aus einem .ics-Text ziehen (Zeilen-Entfaltung nach RFC 5545) */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r/g, '').split('\n');
  const out: IcsEvent[] = [];
  let cur: { title?: string; start?: string; end?: string; endDateOnly?: boolean } | null = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = {}; continue; }
    if (line.startsWith('END:VEVENT')) {
      if (cur?.title && cur.start) {
        let end = cur.end;
        // Ganztages-DTEND ist per RFC exklusiv → letzter Tag = end - 1
        if (end && cur.endDateOnly) end = shiftDay(end, -1);
        if (end && end <= cur.start) end = undefined;
        out.push({ title: cur.title, start: cur.start, end });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1);
    if (key === 'SUMMARY' || key.startsWith('SUMMARY;')) {
      cur.title = val.replace(/\\([,;nN])/g, (_, c) => (c.toLowerCase() === 'n' ? ' ' : c)).trim().slice(0, 120);
    } else if (key === 'DTSTART' || key.startsWith('DTSTART;')) {
      const d = icsDate(val);
      if (d) cur.start = d.iso;
    } else if (key === 'DTEND' || key.startsWith('DTEND;')) {
      const d = icsDate(val);
      if (d) { cur.end = d.iso; cur.endDateOnly = d.dateOnly; }
    }
  }
  return out.slice(0, 500);
}

/** Termin-Duplikate (gleicher Titel + Starttag) zusammenführen */
export function mergeEvents(existing: IcsEvent[], incoming: IcsEvent[]): IcsEvent[] {
  const seen = new Set(existing.map((e) => `${e.title}|${e.start}`));
  const fresh = incoming.filter((e) => !seen.has(`${e.title}|${e.start}`));
  return [...existing, ...fresh].slice(-800);
}

/** Beliebige Einträge als .ics exportieren (für Outlook & Co.) */
export function downloadIcsEvents(events: IcsEvent[], filename = 'pixinotes-kalender.ics'): number {
  if (events.length === 0) return 0;
  const fmt = (iso: string) => iso.replace(/-/g, '');
  const body = events.map((e, i) => [
    'BEGIN:VEVENT',
    `UID:pn-${i}-${fmt(e.start)}@pixinotes`,
    `DTSTART;VALUE=DATE:${fmt(e.start)}`,
    ...(e.end ? [`DTEND;VALUE=DATE:${fmt(shiftDay(e.end, 1))}`] : []),
    `SUMMARY:${e.title.replace(/[\n,;]/g, ' ')}`,
    'END:VEVENT',
  ].join('\r\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PixiNotes//DE', ...body, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return events.length;
}

/** ICS von einer Abo-URL holen (webcal:// → https://). Wirft bei CORS/Netzfehlern. */
export async function fetchIcsUrl(url: string): Promise<IcsEvent[]> {
  const httpUrl = url.replace(/^webcal:\/\//i, 'https://');
  const res = await fetch(httpUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseIcs(await res.text());
}
