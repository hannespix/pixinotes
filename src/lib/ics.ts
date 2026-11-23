// iCalendar (.ics): das Austauschformat, das Outlook, Google und Apple
// gleichermaßen sprechen. Hier: schlanker Parser für VEVENTs (Ganztages-
// und Datetime-Termine, mehrtägig) + Export sichtbarer Einträge.
// M473: Serientermine (RRULE, EXDATE, RECURRENCE-ID) und Zeitzonen (TZID) — Auflösung in lib/icsSerie.ts.
import { triggerDownload } from './download';
import { ereignisAus, msZuWand, ortsZeitAus, wandZuMs, zoneAus, type IcsSerie, type OrtsZeit } from './icsSerie';

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
  /** M473: Serientermin — `start`/`startTime` nennen den ersten Termin, angezeigt wird über icsImFenster() */
  serie?: IcsSerie;
}

/** M473: eine Zeitangabe roh — Wandzeit in ihrer Zone („UTC" bei …Z, leer = floating) */
interface IcsRoh { wand: string; tz?: string; nurTag: boolean }

/** M473: Wert eines Parameters („DTSTART;TZID="W. Europe Standard Time";VALUE=…") */
const parameter = (key: string, name: string): string | undefined =>
  key.match(new RegExp(`;${name}=("[^"]*"|[^;]*)`, 'i'))?.[1]?.replace(/^"|"$/g, '');

function icsZeit(key: string, val: string): IcsRoh | null {
  const m = val.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[4] === undefined) return { wand: `${m[1]}-${m[2]}-${m[3]}`, nurTag: true };
  // M388: Weltzeit (…Z) gilt am hiesigen Tag. M473: … und eine TZID wird ebenso in die Ortszeit gerechnet
  // (09:00 New York steht hier um 15:00); unbekannte Zonen bleiben Wandzeit wie bisher.
  const tz = m[7] ? 'UTC' : zoneAus(parameter(key, 'TZID'));
  return { wand: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, tz, nurTag: false };
}

/** Roh → Ortszeit des Geräts */
function ortsZeit(r: IcsRoh): OrtsZeit {
  if (r.nurTag) return { tag: r.wand, nurTag: true, mitternacht: false };
  if (!r.tz) return { tag: r.wand.slice(0, 10), zeit: r.wand.slice(11, 16), nurTag: false, mitternacht: r.wand.slice(11, 16) === '00:00' };
  return ortsZeitAus(wandZuMs(r.wand, r.tz));
}

/** M473: Roh-Zeit als Schlüssel in der Zone einer Serie (für den Vergleich mit EXDATE/RECURRENCE-ID) */
function inSerienZone(r: IcsRoh, serie: { tz?: string; ganztag: boolean }): string {
  if (r.nurTag || serie.ganztag) return r.wand.slice(0, 10);
  if (r.tz === serie.tz) return r.wand;
  return msZuWand(wandZuMs(r.wand, r.tz), serie.tz);
}

/** M473: DURATION (P1D, PT1H30M, P1W) → Minuten */
function dauerMinuten(val: string): number | undefined {
  const m = val.trim().match(/^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return undefined;
  return (+(m[1] ?? 0)) * 10080 + (+(m[2] ?? 0)) * 1440 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0)) + Math.round(+(m[5] ?? 0) / 60);
}

/** M471: Text eines Feldes nach RFC 5545 entschlüsseln (\\, \, \; \n) — in EINEM Durchgang, sonst frisst \\ das Folgezeichen (Audit R6-F9) */
const icsText = (val: string, hoechstens: number): string => val
  .replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
  .trim().slice(0, hoechstens);

/** M473: Zeile am ersten Doppelpunkt AUSSERHALB von Anführungszeichen teilen (TZID="(UTC+01:00) Amsterdam, …") */
function teile(line: string): [string, string] | null {
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
}

const istFeld = (key: string, name: string) => key.toUpperCase() === name || key.toUpperCase().startsWith(`${name};`);

const tagDiff = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);

const shiftDay = (iso: string, n: number): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5)
    .toISOString().slice(0, 10);

/**
 * VEVENTs aus einem .ics-Text ziehen (Zeilen-Entfaltung nach RFC 5545).
 * M473: Zeiten mit TZID in Ortszeit; Serien (RRULE, EXDATE) bekommen `serie`, die erst beim Anzeigen für das
 * sichtbare Fenster aufgelöst wird (lib/icsSerie.ts); verschobene Einzeltermine (RECURRENCE-ID) stehen als eigener
 * Termin und fallen aus ihrer Serie, abgesagte (STATUS:CANCELLED) entfallen ganz.
 */
export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').replace(/\r/g, '').split('\n');
  const out: IcsEvent[] = [];
  const ersetzt: Array<{ uid: string; roh: IcsRoh }> = [];
  let cur: {
    title?: string; start?: IcsRoh; end?: IcsRoh; dauer?: number; place?: string; uid?: string;
    rrule?: string; exdate?: IcsRoh[]; recurrenceId?: IcsRoh; abgesagt?: boolean;
  } | null = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = {}; continue; }
    if (line.startsWith('END:VEVENT')) {
      if (cur?.uid && cur.recurrenceId) ersetzt.push({ uid: cur.uid, roh: cur.recurrenceId });
      if (cur?.title && cur.start && !(cur.recurrenceId && cur.abgesagt)) {
        const b = ortsZeit(cur.start);
        let e = cur.end ? ortsZeit(cur.end) : undefined;
        if (!e && cur.dauer && !cur.start.nurTag) e = ortsZeitAus(wandZuMs(cur.start.wand, cur.start.tz) + cur.dauer * 60000);
        // M388/M471: Ganztages-Ende und Ende um 0 Uhr exklusiv, 0 bis 0 Uhr bleibt ganztägig (ereignisAus)
        const ev = ereignisAus({ title: cur.title }, b, e);
        if (cur.place) ev.place = cur.place;
        if (cur.uid) ev.uid = cur.uid;
        if (cur.rrule && !cur.recurrenceId) {
          const ganztag = cur.start.nurTag;
          const tz = ganztag ? undefined : cur.start.tz;
          let dauer = 0;
          if (cur.end) {
            dauer = ganztag ? tagDiff(cur.start.wand, cur.end.wand)
              : Math.round((wandZuMs(cur.end.wand, cur.end.tz) - wandZuMs(cur.start.wand, cur.start.tz)) / 60000);
          } else if (cur.dauer) dauer = ganztag ? Math.round(cur.dauer / 1440) : cur.dauer;
          const serie: IcsSerie = { rrule: cur.rrule, beginn: cur.start.wand, dauer: Math.max(0, dauer) };
          if (tz) serie.tz = tz;
          const aus = (cur.exdate ?? []).map((x) => inSerienZone(x, { tz, ganztag }));
          if (aus.length) serie.aus = [...new Set(aus)].slice(0, 500);
          ev.serie = serie;
        }
        out.push(ev);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const kv = teile(line);
    if (!kv) continue;
    const [key, val] = kv;
    if (istFeld(key, 'SUMMARY')) {
      cur.title = icsText(val, 120);
    } else if (istFeld(key, 'DTSTART')) {
      const d = icsZeit(key, val);
      if (d) cur.start = d;
    } else if (istFeld(key, 'DTEND')) {
      const d = icsZeit(key, val);
      if (d) cur.end = d;
    } else if (istFeld(key, 'DURATION')) {
      cur.dauer = dauerMinuten(val);
    } else if (istFeld(key, 'RRULE')) {
      if (val.trim()) cur.rrule = val.trim().slice(0, 500);
    } else if (istFeld(key, 'EXDATE')) {
      for (const teil of val.split(',')) {
        const d = icsZeit(key, teil);
        if (d) (cur.exdate ??= []).push(d);
      }
    } else if (istFeld(key, 'RECURRENCE-ID')) {
      const d = icsZeit(key, val);
      if (d) cur.recurrenceId = d;
    } else if (istFeld(key, 'STATUS')) {
      cur.abgesagt = /^cancelled$/i.test(val.trim());
    } else if (istFeld(key, 'LOCATION')) {
      const ort = icsText(val, 200);
      if (ort) cur.place = ort;
    } else if (key.toUpperCase() === 'UID') {
      if (val.trim()) cur.uid = val.trim().slice(0, 300);
    }
  }
  // M473: Ersetzte Termine fallen aus ihrer Serie — der Ersatz steht als eigener Termin da (abgesagte gar nicht)
  for (const { uid, roh } of ersetzt) {
    for (const ev of out) {
      if (ev.uid !== uid || !ev.serie) continue;
      const k = inSerienZone(roh, { tz: ev.serie.tz, ganztag: !ev.serie.beginn.includes('T') });
      ev.serie.aus = [...new Set([...(ev.serie.aus ?? []), k])].slice(0, 500);
    }
  }
  return out.slice(0, 500);
}

/**
 * Termin-Duplikate (gleicher Titel + Starttag) zusammenführen.
 * M471: Ein schon vorhandener Eintrag ohne Uhrzeit (Import vor M471) übernimmt Uhrzeit, Ort und UID des neuen —
 * so bekommen bestehende Abos beim nächsten „Abos aktualisieren" ihre Uhrzeiten.
 * M473: Der neue Stand gewinnt ganz (Serie, umgerechnete Zeitzone, Ausnahmen), und ältere Einträge mit derselben
 * UID, die der neue Stand nicht mehr enthält (verschobener Einzeltermin, Tag vor der Zonen-Umrechnung), entfallen.
 */
export function mergeEvents(existing: IcsEvent[], incoming: IcsEvent[]): IcsEvent[] {
  const schluessel = (e: IcsEvent) => `${e.title}|${e.start}`;
  const neu = new Map(incoming.map((e) => [schluessel(e), e]));
  const uids = new Set(incoming.map((e) => e.uid).filter(Boolean));
  const seen = new Set<string>();
  const alt: IcsEvent[] = [];
  for (const e of existing) {
    const k = schluessel(e);
    const n = neu.get(k);
    if (!n && e.uid && uids.has(e.uid)) continue;
    seen.add(k);
    if (!n) { alt.push(e); continue; }
    const zus: IcsEvent = { ...e, ...n };
    for (const f of ['serie', 'startTime', 'endTime', 'end'] as const) if (n[f] === undefined) delete zus[f];
    alt.push(zus);
  }
  const fresh = incoming.filter((e) => !seen.has(schluessel(e)));
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
