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
  /**
   * M270: Uhrzeiten, Ort und Notiz — für den Export nach Outlook.
   *
   * Bis dahin schrieb PixiNotes ausnahmslos GANZTAGES-Termine. Ein Termin, der
   * um 9 Uhr beginnt, landete im Outlook-Kalender als Balken über den ganzen
   * Tag; die Uhrzeit stand bestenfalls im Titel. Wer einen Sitzungstermin
   * exportiert, will ihn aber um 9 Uhr sehen.
   *
   * Beim IMPORT bleiben die Felder leer — dort werden Termine weiterhin
   * tagesgenau geführt, weil die Kalenderkarte tageweise rastert.
   */
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  place?: string;
  note?: string;
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
      // RFC-5545-Escapes in EINEM Durchgang — \\ gehört dazu, sonst frisst
      // es das Folgezeichen (Audit R6-F9)
      cur.title = val
        .replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
        .trim().slice(0, 120);
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

/**
 * Text für ein iCalendar-Feld absichern (RFC 5545).
 *
 * Komma, Semikolon und Backslash haben im Format eine Bedeutung und müssen
 * maskiert werden — ein Titel wie „Sitzung, 2. Teil" zerlegte den Eintrag
 * sonst. Zeilenumbrüche werden zu `\n`, damit eine mehrzeilige Notiz
 * ankommt, statt die Datei zu zerbrechen.
 */
const escIcs = (s: string): string => s
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/**
 * Lange Zeilen falten (RFC 5545: höchstens 75 Oktette).
 *
 * Outlook ist da streng: Eine überlange Zeile kann den ganzen Termin
 * verschlucken. Gefaltet wird konservativ nach Zeichen statt nach Oktetten —
 * bei Umlauten wird die Zeile dadurch höchstens kürzer als nötig, nie länger.
 */
function falte(zeile: string): string {
  if (zeile.length <= 73) return zeile;
  const teile: string[] = [zeile.slice(0, 73)];
  for (let i = 73; i < zeile.length; i += 72) teile.push(` ${zeile.slice(i, i + 72)}`);
  return teile.join('\r\n');
}

/** Beliebige Einträge als .ics exportieren (für Outlook & Co.) */
export function downloadIcsEvents(events: IcsEvent[], filename = 'pixinotes-kalender.ics'): number {
  if (events.length === 0) return 0;
  const fmt = (iso: string) => iso.replace(/-/g, '');
  const zeit = (t: string) => `${t.replace(':', '')}00`;
  const body = events.map((e, i) => {
    /**
     * M270: Mit Uhrzeit wird es ein echter Zeittermin.
     *
     * Geschrieben wird ORTSZEIT ohne Zeitzonen-Angabe („floating"): Genau so
     * ist ein Termin gemeint, den jemand in Stuttgart auf 9 Uhr legt. Mit
     * angehängtem Z wäre es UTC, und Outlook zeigte ihn im Sommer um 11 Uhr.
     * Ohne Endzeit gilt eine Stunde — die übliche Annahme, und besser als ein
     * Termin ohne Dauer, den manche Kalender gar nicht anzeigen.
     */
    const mitZeit = !!e.startTime;
    const zeilen = ['BEGIN:VEVENT', `UID:pn-${i}-${fmt(e.start)}@pixinotes`];
    if (mitZeit) {
      zeilen.push(`DTSTART:${fmt(e.start)}T${zeit(e.startTime!)}`);
      const endTag = e.end && e.end > e.start ? e.end : e.start;
      const endZeit = e.endTime ?? `${String((Number(e.startTime!.slice(0, 2)) + 1) % 24).padStart(2, '0')}:${e.startTime!.slice(3, 5)}`;
      zeilen.push(`DTEND:${fmt(endTag)}T${zeit(endZeit)}`);
    } else {
      zeilen.push(`DTSTART;VALUE=DATE:${fmt(e.start)}`);
      // Ganztages-DTEND ist per RFC exklusiv → letzter Tag + 1
      zeilen.push(`DTEND;VALUE=DATE:${fmt(shiftDay(e.end && e.end > e.start ? e.end : e.start, 1))}`);
    }
    zeilen.push(`SUMMARY:${escIcs(e.title)}`);
    if (e.place) zeilen.push(`LOCATION:${escIcs(e.place)}`);
    if (e.note) zeilen.push(`DESCRIPTION:${escIcs(e.note)}`);
    zeilen.push('END:VEVENT');
    return zeilen.map(falte).join('\r\n');
  });
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PixiNotes//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...body, 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([`${ics}\r\n`], { type: 'text/calendar' }));
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
