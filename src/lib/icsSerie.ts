// M473: Zeitzonen (TZID) und Serientermine (RRULE, EXDATE, RECURRENCE-ID) aus ICS-Dateien und -Abos.
//
// Bis M471 galt eine Zeit mit TZID als Wandzeit (09:00 New York stand hier um 09:00) und ein Serientermin
// erschien nur an seinem ersten Tag. Hier steht beides ohne Bibliothek: Zonen über Intl (die VTIMEZONE-Blöcke
// der Datei werden bewusst nicht gelesen — Intl kennt die Regeln besser und aktueller), Windows-Namen aus
// Outlook über eine kleine Tabelle; Serien werden NUR für das sichtbare Fenster aufgelöst, mit Obergrenze.
// Keine Abhängigkeiten, damit der Baustein auch direkt in Node prüfbar ist (Prüfreihe m473).
import type { IcsEvent } from './ics';

/** Serie eines ICS-Termins — gespeichert in der Kalender-Karte, aufgelöst beim Anzeigen */
export interface IcsSerie {
  /** RRULE roh, z. B. „FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20271231T000000Z" */
  rrule: string;
  /** Zone der Wandzeit: IANA-Name, „UTC" oder leer (floating = Ortszeit des Geräts) */
  tz?: string;
  /** Beginn in Wandzeit der Zone: „YYYY-MM-DD" (ganztägig) oder „YYYY-MM-DDTHH:MM:SS" */
  beginn: string;
  /** Dauer: Minuten bei Zeitterminen, Tage (DTEND exklusiv) bei ganztägigen */
  dauer: number;
  /** ausgelassene Beginne (EXDATE, verschobene/abgesagte RECURRENCE-ID), gleiche Form wie `beginn` (oder nur Tag) */
  aus?: string[];
}

// ------------------------------------------------------------ Zeitzonen ----

/** Häufige Windows-Zonennamen (Outlook, Exchange) → IANA. Unbekanntes bleibt Wandzeit wie vor M473. */
const WINDOWS_ZONEN: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

const ANZEIGE_ZONEN: Array<[RegExp, string]> = [
  [/^\(UTC\+01:00\).*Berlin/i, 'Europe/Berlin'],
  [/^\(UTC\+01:00\).*(Brüssel|Brussels|Paris)/i, 'Europe/Paris'],
  [/^\(UTC\+01:00\).*(Prag|Prague|Budapest)/i, 'Europe/Budapest'],
  [/^\(UTC\+01:00\).*(Warschau|Warsaw|Zagreb)/i, 'Europe/Warsaw'],
  [/^\(UTC(\+00:00)?\).*(London|Dublin|Lissabon|Lisbon)/i, 'Europe/London'],
  [/^\(UTC-05:00\).*(Eastern|New York)/i, 'America/New_York'],
  [/^\(UTC-06:00\).*Central Time/i, 'America/Chicago'],
  [/^\(UTC-08:00\).*Pacific/i, 'America/Los_Angeles'],
];

const formatierer = new Map<string, Intl.DateTimeFormat | null>();
function formatierer_(tz: string): Intl.DateTimeFormat | null {
  if (!formatierer.has(tz)) {
    try {
      formatierer.set(tz, new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }));
    } catch {
      formatierer.set(tz, null);
    }
  }
  return formatierer.get(tz)!;
}

/**
 * TZID → Zone, die Intl versteht. Nimmt IANA-Namen, Windows-Namen, Präfixe wie „/mozilla.org/…/Europe/Berlin"
 * und Anführungszeichen. Ergebnis leer = unbekannt → Wandzeit (wie bisher).
 */
export function zoneAus(tzid?: string): string | undefined {
  if (!tzid) return undefined;
  const roh = tzid.trim().replace(/^"|"$/g, '').trim();
  if (!roh) return undefined;
  // Outlook schreibt mitunter den Anzeigenamen („(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien")
  const anzeige = ANZEIGE_ZONEN.find(([muster]) => muster.test(roh))?.[1];
  const kandidaten = [WINDOWS_ZONEN[roh], roh, roh.match(/([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/)?.[1], anzeige];
  for (const k of kandidaten) if (k && formatierer_(k)) return k;
  return undefined;
}

/** Versatz der Zone gegen Weltzeit (Minuten) zum Zeitpunkt `ms` */
function versatz(tz: string, ms: number): number {
  const f = formatierer_(tz);
  if (!f) return 0;
  const t: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') t[p.type] = Number(p.value);
  return Math.round((Date.UTC(t.year, t.month - 1, t.day, t.hour % 24, t.minute, t.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Wandzeit einer Zone → Zeitpunkt (ms). Zwei Durchgänge, damit die Sommerzeit-Umstellung stimmt; eine Zeit in der
 * Lücke (02:30 am Umstellungstag) rutscht wie in Outlook/Google um die Lücke nach vorn.
 */
export function wandZuMs(wand: string, tz?: string): number {
  const m = wand.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  if (!tz) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const als = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return als;
  const v1 = versatz(tz, als);
  let t = als - v1 * 60000;
  const v2 = versatz(tz, t);
  if (v2 !== v1) {
    const t2 = als - v2 * 60000;
    // Doppelte Stunde (Herbst): die erste nehmen; Lücke (Frühjahr): der Versatz danach
    t = versatz(tz, t2) === v2 ? Math.min(t, t2) : Math.max(t, t2);
  }
  return t;
}

const zwei = (n: number) => String(n).padStart(2, '0');
/** Zeitpunkt → Wandzeit einer Zone (leer = Gerät) „YYYY-MM-DDTHH:MM:SS" */
export function msZuWand(ms: number, tz?: string): string {
  if (tz && tz !== 'UTC') {
    const f = formatierer_(tz);
    if (f) {
      const t: Record<string, number> = {};
      for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') t[p.type] = Number(p.value);
      return `${t.year}-${zwei(t.month)}-${zwei(t.day)}T${zwei(t.hour % 24)}:${zwei(t.minute)}:${zwei(t.second)}`;
    }
  }
  const d = new Date(ms);
  if (tz === 'UTC') return d.toISOString().slice(0, 19);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`;
}

// ------------------------------------------------------------- Ereignis ----

/** Ein Zeitpunkt aus der Datei, schon in Ortszeit des Geräts */
export interface OrtsZeit { tag: string; zeit?: string; nurTag: boolean; mitternacht: boolean }

export const ortsZeitAus = (ms: number): OrtsZeit => {
  const w = msZuWand(ms);
  return { tag: w.slice(0, 10), zeit: w.slice(11, 16), nurTag: false, mitternacht: w.slice(11, 16) === '00:00' };
};

const tagVerschieben = (iso: string, n: number): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);

/**
 * Beginn/Ende (Ortszeit) → IcsEvent nach den Regeln aus M388/M471: Ganztages-Ende und ein Ende um 0 Uhr sind
 * exklusiv, 0 Uhr bis 0 Uhr bleibt ganztägig. Gemeinsam für Einzeltermine und aufgelöste Serien.
 */
export function ereignisAus(basis: Omit<IcsEvent, 'start'>, b: OrtsZeit, e?: OrtsZeit): IcsEvent {
  let end = e?.tag;
  if (end && e && (e.nurTag || e.mitternacht)) end = tagVerschieben(end, -1);
  if (end && end <= b.tag) end = undefined;
  const ev: IcsEvent = { ...basis, start: b.tag, end };
  delete ev.startTime; delete ev.endTime;
  if (end === undefined) delete ev.end;
  if (b.zeit && !b.nurTag && !(b.mitternacht && (e?.mitternacht || !e?.zeit))) {
    ev.startTime = b.zeit;
    if (e?.zeit && !e.nurTag) ev.endTime = e.zeit;
  }
  return ev;
}

// ---------------------------------------------------------------- Serien ----

const WT = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Obergrenzen: Perioden je Auflösung und Termine je Serie im Fenster */
const MAX_PERIODEN = 5000;
const MAX_TERMINE = 400;

const tagNr = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
const vonTagNr = (n: number) => { const d = new Date(n * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const isoVon = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const wochentag = (n: number) => ((n + 4) % 7 + 7) % 7;   // 1970-01-01 war ein Donnerstag
const monatsTage = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const zahlen = (s?: string) => (s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n !== 0) : []);

interface Regel {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  intervall: number;
  anzahl?: number;
  bis?: string;
  wochentage: Array<{ ord: number; wt: number }>;
  monatstage: number[];
  monate: number[];
  setpos: number[];
  wkst: number;
}

/** RRULE lesen; null bei Unbekanntem (stündlich, BYWEEKNO, BYYEARDAY …) — dann bleibt es beim ersten Termin */
function regelLesen(rrule: string, tz?: string): Regel | null {
  const t: Record<string, string> = {};
  for (const teil of rrule.split(';')) {
    const i = teil.indexOf('=');
    if (i > 0) t[teil.slice(0, i).trim().toUpperCase()] = teil.slice(i + 1).trim().toUpperCase();
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(t.FREQ)) return null;
  if (t.BYWEEKNO || t.BYYEARDAY || t.BYHOUR || t.BYMINUTE || t.BYSECOND) return null;
  const wochentage: Regel['wochentage'] = [];
  for (const w of (t.BYDAY ?? '').split(',').filter(Boolean)) {
    const m = w.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!m) return null;
    wochentage.push({ ord: m[1] ? Number(m[1]) : 0, wt: WT.indexOf(m[2]) });
  }
  let bis: string | undefined;
  if (t.UNTIL) {
    const m = t.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return null;
    if (!m[4]) bis = `${m[1]}-${m[2]}-${m[3]}`;
    else {
      const wand = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      bis = m[7] ? msZuWand(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), tz) : wand;
    }
  }
  const intervall = Math.max(1, Math.min(1000, Number(t.INTERVAL) || 1));
  const anzahl = t.COUNT ? Math.max(0, Math.min(10000, Number(t.COUNT) || 0)) : undefined;
  return {
    freq: t.FREQ as Regel['freq'], intervall, anzahl, bis, wochentage,
    monatstage: zahlen(t.BYMONTHDAY).filter((n) => Math.abs(n) <= 31),
    monate: zahlen(t.BYMONTH).filter((n) => n >= 1 && n <= 12),
    setpos: zahlen(t.BYSETPOS),
    wkst: t.WKST && WT.includes(t.WKST) ? WT.indexOf(t.WKST) : 1,
  };
}

/** Tage eines Monats nach BYMONTHDAY/BYDAY (mit Ordinal: 1MO, -1FR); ohne beides der Starttag des Monats */
function tageImMonat(r: Regel, y: number, m: number, startTagImMonat: number): number[] {
  const dim = monatsTage(y, m);
  const erster = tagNr(y, m, 1);
  const md = r.monatstage.map((v) => (v > 0 ? v : dim + 1 + v)).filter((v) => v >= 1 && v <= dim);
  let wd: number[] | null = null;
  if (r.wochentage.length) {
    wd = [];
    for (const { ord, wt } of r.wochentage) {
      const alle: number[] = [];
      for (let d = 1; d <= dim; d += 1) if (wochentag(erster + d - 1) === wt) alle.push(d);
      if (ord === 0) wd.push(...alle);
      else { const x = ord > 0 ? alle[ord - 1] : alle[alle.length + ord]; if (x) wd.push(x); }
    }
  }
  let tage: number[];
  if (r.monatstage.length && wd) tage = md.filter((d) => wd!.includes(d));
  else if (r.monatstage.length) tage = md;
  else if (wd) tage = wd;
  else tage = startTagImMonat <= dim ? [startTagImMonat] : [];
  return tage.map((d) => erster + d - 1);
}

/** Kandidaten (Tagesnummern) der Periode k, sortiert und nach BYSETPOS ausgewählt */
function periode(r: Regel, k: number, start: { n: number; y: number; m: number; d: number }): { ab: number; tage: number[] } {
  let ab: number;
  let tage: number[] = [];
  if (r.freq === 'DAILY') {
    ab = start.n + k * r.intervall;
    const { y, m, d } = vonTagNr(ab);
    const dim = monatsTage(y, m);
    const passt = (!r.monate.length || r.monate.includes(m))
      && (!r.monatstage.length || r.monatstage.some((v) => (v > 0 ? v : dim + 1 + v) === d))
      && (!r.wochentage.length || r.wochentage.some((w) => w.wt === wochentag(ab)));
    if (passt) tage = [ab];
  } else if (r.freq === 'WEEKLY') {
    ab = start.n - ((wochentag(start.n) - r.wkst + 7) % 7) + k * 7 * r.intervall;
    const wts = r.wochentage.length ? r.wochentage.map((w) => w.wt) : [wochentag(start.n)];
    tage = wts.map((wt) => ab + ((wt - r.wkst + 7) % 7))
      .filter((n) => !r.monate.length || r.monate.includes(vonTagNr(n).m));
  } else if (r.freq === 'MONTHLY') {
    const mi = start.y * 12 + (start.m - 1) + k * r.intervall;
    const y = Math.floor(mi / 12); const m = (mi % 12) + 1;
    ab = tagNr(y, m, 1);
    if (!r.monate.length || r.monate.includes(m)) tage = tageImMonat(r, y, m, start.d);
  } else {
    const y = start.y + k * r.intervall;
    ab = tagNr(y, 1, 1);
    if (r.monate.length) {
      for (const m of r.monate) tage.push(...tageImMonat(r, y, m, r.monatstage.length || r.wochentage.length ? 0 : start.d));
    } else if (r.wochentage.length) {
      // BYDAY ohne BYMONTH: Ordinal im Jahr (20MO = 20. Montag des Jahres)
      const n0 = tagNr(y, 1, 1); const n1 = tagNr(y + 1, 1, 1);
      for (const { ord, wt } of r.wochentage) {
        const alle: number[] = [];
        for (let n = n0; n < n1; n += 1) if (wochentag(n) === wt) alle.push(n);
        if (ord === 0) tage.push(...alle);
        else { const x = ord > 0 ? alle[ord - 1] : alle[alle.length + ord]; if (x !== undefined) tage.push(x); }
      }
      if (r.monatstage.length) tage = tage.filter((n) => { const x = vonTagNr(n); const dim = monatsTage(x.y, x.m); return r.monatstage.some((v) => (v > 0 ? v : dim + 1 + v) === x.d); });
    } else if (r.monatstage.length) {
      for (let m = 1; m <= 12; m += 1) tage.push(...tageImMonat(r, y, m, 0));
    } else if (start.d <= monatsTage(y, start.m)) {
      tage = [tagNr(y, start.m, start.d)];   // 29.02. fällt in Nicht-Schaltjahren aus (RFC 5545)
    }
  }
  tage = [...new Set(tage)].sort((a, b) => a - b);
  if (r.setpos.length && tage.length) {
    const aus: number[] = [];
    for (const p of r.setpos) { const x = p > 0 ? tage[p - 1] : tage[tage.length + p]; if (x !== undefined) aus.push(x); }
    tage = [...new Set(aus)].sort((a, b) => a - b);
  }
  return { ab, tage };
}

/** Wie viele Perioden lassen sich ohne COUNT gefahrlos überspringen, bis das Fenster naht? */
function sprung(r: Regel, start: { n: number; y: number; m: number }, fruehesterTag: number): number {
  const vorne = fruehesterTag - start.n;
  if (vorne <= 0) return 0;
  const k = r.freq === 'DAILY' ? Math.floor(vorne / r.intervall)
    : r.freq === 'WEEKLY' ? Math.floor(vorne / (7 * r.intervall))
      : r.freq === 'MONTHLY' ? Math.floor(vorne / 31 / r.intervall)
        : Math.floor(vorne / 366 / r.intervall);
  return Math.max(0, k - 1);
}

/**
 * Die Termine einer Serie, die das Fenster [von, bis] (Ortszeit, yyyy-mm-dd, inklusiv) berühren — in Ortszeit,
 * ohne `serie`. Ausnahmen (EXDATE, verschobene Einzeltermine) entfallen, COUNT zählt sie nach RFC 5545 mit.
 * DTSTART zählt immer als erster Termin. Unbekannte Regeln: nur der erste Termin.
 */
export function serieAufloesen(ev: IcsEvent, von: string, bis: string): IcsEvent[] {
  const s = ev.serie;
  const basis: Omit<IcsEvent, 'start'> = { ...ev };
  delete (basis as Partial<IcsEvent>).serie;
  if (!s) return ev.start <= bis && (ev.end ?? ev.start) >= von ? [ev] : [];
  // Gespeicherte Daten kommen auch aus Sync und Links — Unlesbares zeigt nur den ersten Termin
  if (typeof s.rrule !== 'string' || typeof s.beginn !== 'string' || (s.tz !== undefined && typeof s.tz !== 'string')) {
    return typeof ev.start === 'string' && ev.start <= bis && (ev.end ?? ev.start) >= von ? [basis as IcsEvent] : [];
  }
  const m = s.beginn.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?$/);
  if (!m) return [];
  const ganztag = !m[4];
  const zeitTeil = m[4] ? `T${m[4]}` : '';
  const start = { n: tagNr(+m[1], +m[2], +m[3]), y: +m[1], m: +m[2], d: +m[3] };
  const dauer = Math.max(0, Math.min(ganztag ? 400 : 60 * 24 * 400, Number(s.dauer) || 0));
  const aus = new Set(Array.isArray(s.aus) ? s.aus.filter((x) => typeof x === 'string') : []);
  const vonN = tagNr(+von.slice(0, 4), +von.slice(5, 7), +von.slice(8, 10));
  const bisN = tagNr(+bis.slice(0, 4), +bis.slice(5, 7), +bis.slice(8, 10));
  // Ein Tag Spielraum je Seite für den Zonenversatz, dazu die Länge eines Termins
  const dauerTage = ganztag ? dauer : Math.ceil(dauer / 1440);
  const frueh = vonN - 2 - dauerTage;
  const spaet = bisN + 2;

  const termine: IcsEvent[] = [];
  const ausgeben = (n: number) => {
    const wand = `${isoVon(n)}${zeitTeil}`;
    if (aus.has(wand) || aus.has(isoVon(n))) return;
    let t: IcsEvent;
    if (ganztag) {
      const tag = isoVon(n);
      t = ereignisAus(basis, { tag, nurTag: true, mitternacht: false }, { tag: isoVon(n + Math.max(1, dauer)), nurTag: true, mitternacht: false });
    } else {
      const ms = wandZuMs(wand, s.tz);
      t = ereignisAus(basis, ortsZeitAus(ms), dauer > 0 ? ortsZeitAus(ms + dauer * 60000) : undefined);
    }
    if (t.start <= bis && (t.end ?? t.start) >= von) termine.push(t);
  };

  const r = regelLesen(s.rrule, s.tz);
  let gezaehlt = 1;
  if (start.n >= frueh && start.n <= spaet) ausgeben(start.n);
  if (!r) return termine;
  if (r.anzahl !== undefined && r.anzahl <= 1) return termine;
  const k0 = r.anzahl === undefined ? sprung(r, start, frueh) : 0;
  for (let k = k0, runden = 0; runden < MAX_PERIODEN && termine.length < MAX_TERMINE; k += 1, runden += 1) {
    const p = periode(r, k, start);
    if (p.ab > spaet) break;
    let ende = false;
    for (const n of p.tage) {
      if (n <= start.n) continue;
      if (r.bis && `${isoVon(n)}${zeitTeil}`.slice(0, r.bis.length) > r.bis) { ende = true; break; }
      gezaehlt += 1;
      if (r.anzahl !== undefined && gezaehlt > r.anzahl) { ende = true; break; }
      if (n > spaet) { ende = true; break; }
      if (n >= frueh) ausgeben(n);
    }
    if (ende) break;
  }
  return termine;
}

/** Alle ICS-Termine einer Karte für ein Fenster: Einzeltermine wie gespeichert, Serien aufgelöst */
export function icsImFenster(events: IcsEvent[], von: string, bis: string): IcsEvent[] {
  const aus: IcsEvent[] = [];
  for (const ev of events) {
    if (!ev?.serie) { aus.push(ev); continue; }
    aus.push(...serieAufloesen(ev, von, bis));
  }
  return aus;
}
