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
   * M471: … bis auf Uhrzeit, Ort und UID: Die Aufgaben-Zentrale zeigt ICS-Abos
   * unter „Termine heute und morgen" mit Uhrzeit (Ortszeit) und erinnert davor.
   * Das Raster der Kalender-Karte bleibt tagesgenau.
   */
  startTime?: string;   // HH:MM
  endTime?: string;     // HH:MM
  place?: string;
  note?: string;
  /** M471: Kennung aus dem Kalender (UID) — nur beim Import gesetzt */
  uid?: string;
}

function icsDate(val: string): { iso: string; dateOnly: boolean; mitternacht?: boolean; zeit?: string } | null {
  const m = val.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[4] === undefined) return { iso: `${m[1]}-${m[2]}-${m[3]}`, dateOnly: true };
  // M388: Zeitangaben in Weltzeit (…Z) gelten am hiesigen Tag — 23:30 Z im Sommer ist hier schon der nächste
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const zeit = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { iso, dateOnly: false, mitternacht: d.getHours() === 0 && d.getMinutes() === 0, zeit };
  }
  // Ohne Z (auch mit TZID): Wandzeit, wie sie dasteht
  return { iso: `${m[1]}-${m[2]}-${m[3]}`, dateOnly: false, mitternacht: m[4] === '00' && m[5] === '00', zeit: `${m[4]}:${m[5]}` };
}

/** M471: Text eines Feldes nach RFC 5545 entschlüsseln (\\, \, \; \n) */
const icsText = (val: string, hoechstens: number): string => val
  .replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
  .trim().slice(0, hoechstens);

const shiftDay = (iso: string, n: number): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5)
    .toISOString().slice(0, 10);

/** VEVENTs aus einem .ics-Text ziehen (Zeilen-Entfaltung nach RFC 5545) */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r/g, '').split('\n');
  const out: IcsEvent[] = [];
  let cur: {
    title?: string; start?: string; end?: string; endDateOnly?: boolean; endMitternacht?: boolean;
    startZeit?: string; startMitternacht?: boolean; endZeit?: string; place?: string; uid?: string;
  } | null = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = {}; continue; }
    if (line.startsWith('END:VEVENT')) {
      if (cur?.title && cur.start) {
        let end = cur.end;
        // Ganztages-DTEND ist per RFC exklusiv → letzter Tag = end - 1
        // M388: … und ein Ende um Punkt 0 Uhr ebenso (Outlook schreibt Ganztägiges so; ein Abendtermin bis
        // Mitternacht belegte sonst auch den nächsten Tag)
        if (end && (cur.endDateOnly || cur.endMitternacht)) end = shiftDay(end, -1);
        if (end && end <= cur.start) end = undefined;
        const ev: IcsEvent = { title: cur.title, start: cur.start, end };
        // M471: Uhrzeit nur bei echten Zeitterminen — 0 Uhr bis 0 Uhr (Outlooks Ganztägiges) bleibt ohne
        if (cur.startZeit && !(cur.startMitternacht && (cur.endMitternacht || !cur.endZeit))) {
          ev.startTime = cur.startZeit;
          if (cur.endZeit && !cur.endDateOnly) ev.endTime = cur.endZeit;
        }
        if (cur.place) ev.place = cur.place;
        if (cur.uid) ev.uid = cur.uid;
        out.push(ev);
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
      if (d) { cur.start = d.iso; cur.startZeit = d.zeit; cur.startMitternacht = !!d.mitternacht; }
    } else if (key === 'DTEND' || key.startsWith('DTEND;')) {
      const d = icsDate(val);
      if (d) { cur.end = d.iso; cur.endDateOnly = d.dateOnly; cur.endMitternacht = !!d.mitternacht; cur.endZeit = d.zeit; }
    } else if (key === 'LOCATION' || key.startsWith('LOCATION;')) {
      const ort = icsText(val, 200);
      if (ort) cur.place = ort;
    } else if (key === 'UID') {
      if (val.trim()) cur.uid = val.trim().slice(0, 300);
    }
  }
  return out.slice(0, 500);
}

/**
 * Termin-Duplikate (gleicher Titel + Starttag) zusammenführen.
 * M471: Ein schon vorhandener Eintrag ohne Uhrzeit (Import vor M471) übernimmt Uhrzeit, Ort und UID des neuen —
 * so bekommen bestehende Abos beim nächsten „Abos aktualisieren" ihre Uhrzeiten.
 */
export function mergeEvents(existing: IcsEvent[], incoming: IcsEvent[]): IcsEvent[] {
  const neu = new Map(incoming.map((e) => [`${e.title}|${e.start}`, e]));
  const seen = new Set<string>();
  const alt = existing.map((e) => {
    const k = `${e.title}|${e.start}`;
    seen.add(k);
    const n = neu.get(k);
    return n && !e.startTime && !e.place && !e.uid && (n.startTime || n.place || n.uid) ? { ...e, ...n } : e;
  });
  const fresh = incoming.filter((e) => !seen.has(`${e.title}|${e.start}`));
  return [...alt, ...fresh].slice(-800);
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
      let endTag = e.end && e.end > e.start ? e.end : e.start;
      const std = Number(e.startTime!.slice(0, 2));
      const endZeit = e.endTime ?? `${String((std + 1) % 24).padStart(2, '0')}:${e.startTime!.slice(3, 5)}`;
      // M388: Beginn nach 23 Uhr ohne Endzeit — die Stunde danach liegt am nächsten Tag (sonst lag das Ende vor dem Beginn)
      if (!e.endTime && std >= 23 && endTag === e.start) endTag = shiftDay(endTag, 1);
      // … und eine Endzeit, die am selben Tag vor dem Beginn läge, meint den nächsten Tag
      else if (e.endTime && endTag === e.start && e.endTime <= e.startTime!) endTag = shiftDay(endTag, 1);
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
