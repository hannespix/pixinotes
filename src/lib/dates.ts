// Fristen-Erkennung: chrono-node (deutsch) findet Datumsangaben wie
// „bis Freitag", „am 24.07." oder „nächste Woche" in Kartentexten.
//
// M459: chrono-node (~120 KB) kommt nicht mehr im Start mit, sondern beim ersten Text, der überhaupt ein Datum
// enthalten KANN (`kannDatumSein`). Bis dahin liefert `detectDates` nichts — die Chips erscheinen einen Augenblick
// später; `useFristenStand()` zeichnet die Anzeigen dann neu. Ein Text ohne Ziffer, Wochentag, Monat, „heute",
// „morgen" oder Zeiteinheit kann für chrono keinen Tag liefern — er braucht die Bibliothek nie.
import { useSyncExternalStore } from 'react';
import type { ParsedResult } from 'chrono-node';
import { triggerDownload } from './download';
import { sprache } from './sprache';

type ChronoDe = typeof import('./chronoKern')['chronoDe'];
let chronoDe: ChronoDe | null = null;
let ladung: Promise<void> | null = null;
let stand = 0;
const hoerer = new Set<() => void>();
const neuZeichnen = (): void => { fundSpeicher.clear(); stand += 1; for (const h of [...hoerer]) h(); };
/**
 * M531: Englische Fristen („by Friday", „tomorrow", „next week"). Die englischen Regeln bringt chrono-node ohnehin
 * mit (die Grundeinstellung der Bibliothek ist Englisch, sie lagen schon immer im Nachlade-Teil „fristen") — sie
 * kosten dort rund 1 KB mehr und nichts im Start. Gelesen wird englisch nur, wenn die Oberfläche englisch ist oder ein
 * Text mit englischen Datumswörtern deutsch nichts ergibt.
 */
type ChronoEn = typeof import('./chronoKern')['chronoEn'];
let chronoEn: ChronoEn | null = null;
/** Die englische Erkennung, falls schon geladen (null sonst — dann `englischNoetig` fragen) */
export const englischeErkennung = (): ChronoEn | null => chronoEn;
const KANN_EN = /\b(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun|weekend|weeks?|months?|years?|days?|hours?|noon|midnight|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;
/** In der deutschen Oberfläche nur Wörter, die es deutsch nicht gibt — „Jan", „Nov" oder „Sat" lesen nicht englisch */
const EINDEUTIG_EN = /\b(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|noon|midnight|january|february|march|june|july|october|december|next (?:week|month|year)|in (?:a|\d+) (?:days?|weeks?|months?))\b/i;
/** Enthält der Text englische Datumswörter? */
export const kannEnglischSein = (text: string): boolean => (sprache() === 'en' ? KANN_EN : EINDEUTIG_EN).test(text);
/**
 * Soll für diesen Text englisch gelesen werden? Ja, wenn die Oberfläche englisch ist oder deutsch nichts gefunden
 * wurde — und der Text englische Datumswörter hat.
 */
export function englischNoetig(text: string, deutschGefunden: boolean): boolean {
  return !!chronoEn && !(deutschGefunden && sprache() !== 'en') && kannEnglischSein(text);
}
/** Ist die Fristen-Erkennung geladen? */
export const fristenBereit = (): boolean => !!chronoDe;
/** Die Fristen-Erkennung laden (einmal; danach sofort erfüllt). Anzeigen, die `useFristenStand` nutzen, zeichnen neu. */
export function fristenLaden(): Promise<void> {
  if (!ladung) {
    ladung = import('./chronoKern').then((m) => {
      chronoDe = m.chronoDe;
      chronoEn = m.chronoEn;   // M531
      neuZeichnen();
    });
    ladung.catch(() => { ladung = null; });   // offline und nicht im Cache: beim nächsten Text erneut versuchen
  }
  return ladung;
}
/** Läuft das Laden gerade? Dann das Versprechen (wer auf vollständige Fristen angewiesen ist, wartet darauf) */
export const fristenAusstehend = (): Promise<void> | null => (chronoDe ? null : ladung);
/** Zahl, die sich ändert, sobald die Erkennung geladen ist — in die Abhängigkeiten der Fristen-Anzeigen */
export function useFristenStand(): number {
  return useSyncExternalStore((h) => { hoerer.add(h); return () => { hoerer.delete(h); }; }, () => stand);
}
/**
 * Kann chrono in diesem Text einen Tag finden? Großzügig (lieber einmal zu oft laden): Ziffern, Wochentage samt
 * Kürzeln, Monate, die Tageswörter und alle Zeiteinheiten, auch als Zahlwort („in drei Tagen" enthält „tag").
 */
const KANN_DATUM = /\d|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|\b(?:mo|di|mi|do|fr|sa|so|a|j|jr|h)\b|jan|j[äa]n|feb|m[äa]r|maerz|mrz|apr|mai|jun|jul|aug|sep|okt|nov|dez|jetzt|heute|morgen|gestern|nacht|mittag|abend|sek|min|std|stunde|tag|woche|monat|quartal|jahr/i;
export const kannDatumSein = (text: string): boolean => KANN_DATUM.test(text);

export interface DetectedDate {
  /** Originaltext, z. B. „bis Freitag" */
  label: string;
  date: Date;
  /** dringend = < 48h, überfällig = vorbei */
  urgency: 'ok' | 'soon' | 'overdue';
}

/**
 * M323: Deutsche Kurzdaten — „12.11.", „am 3.12. um 10 Uhr", „12.11.26".
 * chrono-de kennt das Datum ohne Jahr nicht und machte aus „um 10 Uhr" ein
 * „morgen 10 Uhr"; die häufigste Schreibweise in Notizen blieb so unerkannt.
 */
const KURZDATUM_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?:(\d{4}|\d{2})(?!\d))?(?!\d)(?:\s*(?:um\s*)?(\d{1,2})(?::(\d{2}))?\s*Uhr)?/gi;
export function kurzdaten(text: string, ref: Date): Array<{ text: string; date: Date; index: number; mitZeit: boolean }> {
  const out: Array<{ text: string; date: Date; index: number; mitZeit: boolean }> = [];
  for (const m of text.matchAll(KURZDATUM_RE)) {
    const tag = Number(m[1]);
    const monat = Number(m[2]);
    if (tag < 1 || tag > 31 || monat < 1 || monat > 12) continue;
    const jahr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ref.getFullYear();
    const std = m[4] !== undefined ? Math.min(23, Number(m[4])) : 12;
    const min = m[5] ? Math.min(59, Number(m[5])) : 0;
    let d = new Date(jahr, monat - 1, tag, std, min);
    if (d.getDate() !== tag) continue; // 31.02. gibt es nicht
    // Ohne Jahr: Liegt es mehr als zwei Monate zurück, ist das nächste Jahr gemeint
    if (!m[3] && d.getTime() < ref.getTime() - 60 * 864e5) d = new Date(jahr + 1, monat - 1, tag, std, min);
    out.push({ text: m[0].trim(), date: d, index: m.index ?? 0, mitZeit: m[4] !== undefined });
  }
  return out;
}

/**
 * M379: Ein nacktes „So", „Do", „Mi" ist im Deutschen meist ein Wort, kein Wochentag („So läuft es", „Do it",
 * „So machen wir es"). Als Tag zählt die Zwei-Buchstaben-Form nur mit Punkt („So.") oder nach einem Wort, das
 * einen Tag erwarten lässt („am Fr", „bis Mo").
 */
export function nurWortKeinTag(text: string, r: { text: string; index: number }): boolean {
  if (!/^(mo|di|mi|do|fr|sa|so)$/i.test(r.text.trim())) return false;
  const danach = text.charAt(r.index + r.text.length);
  const davor = text.slice(0, r.index).trimEnd().split(/\s+/).pop()?.toLowerCase() ?? '';
  return danach !== '.' && !['am', 'bis', 'ab', 'jeden', 'nächsten', 'kommenden', 'diesen', 'vor', 'seit'].includes(davor);
}

/**
 * M388: Gemerkte Funde je Text und Stunde. Die Datums-Erkennung ist teuer (rund 25 Mikrosekunden je Text klingt
 * wenig — aber die Aufgaben-Zählung läuft bei JEDER Änderung über alle offenen Punkte aller Boards, also bei jedem
 * Zieh-Schritt und jedem Tastendruck). Der Text eines Punkts ändert sich selten; sein Ergebnis hängt nur am Text
 * und am Zeitpunkt („morgen") — mit der Stunde als Schlüssel bleibt es richtig.
 */
const fundSpeicher = new Map<string, Array<{ text: string; date: Date; index: number }>>();
let fundStunde = '';

/** M390: Vermerke, die wie ein Datum aussehen, aber keine Frist sind — die Protokoll-Reihe hängt sie an vertagte Punkte. */
const KEIN_TERMIN = /\(offen seit [^)]*\)/gi;

/**
 * Datumsangaben im Text.
 *
 * M390: `anker` ist der Tag, an dem der Text GESCHRIEBEN wurde. „bis Freitag" meint den Freitag danach — nicht den
 * Freitag nach dem Tag, an dem man die Notiz gerade ansieht. Ohne Anker wanderte jede relative Frist mit: Am Freitag
 * hieß es „heute", ab Freitagmittag „in 7 Tagen" — überfällig wurde sie nie. Die Dringlichkeit rechnet weiter
 * gegen `now`.
 */
export function detectDates(text: string, now: Date = new Date(), anker?: Date): DetectedDate[] {
  if (!text) return [];
  const ref = anker ?? now;
  const stunde = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  if (stunde !== fundStunde || fundSpeicher.size > 20000) { fundSpeicher.clear(); fundStunde = stunde; }
  const schluessel = anker ? `${anker.getFullYear()}-${anker.getMonth()}-${anker.getDate()}|${text}` : text;
  let funde = fundSpeicher.get(schluessel);
  if (!funde) {
    const lesbar = text.replace(KEIN_TERMIN, (m) => ' '.repeat(m.length));
    if (!kannDatumSein(lesbar) && !kannEnglischSein(lesbar)) return [];
    // M459: noch nicht geladen → anstoßen, vorerst nichts (nicht merken — nach dem Laden wird neu gelesen)
    if (!chronoDe) { void fristenLaden().catch(() => {}); return []; }
    const gefunden: Array<{ text: string; date: Date; index: number }> = [];
    const lies = (parser: ChronoDe | ChronoEn): boolean => {
      let results: ParsedResult[] = [];
      try {
        results = parser.parse(lesbar, ref, { forwardDate: true });
      } catch {
        return false;
      }
      for (const r of results) {
        // Reine Uhrzeiten überspringen
        if (!r.start.isCertain('day') && !r.start.isCertain('weekday')) continue;
        if (nurWortKeinTag(lesbar, r)) continue;
        gefunden.push({ text: r.text, date: r.start.date(), index: r.index });
      }
      return true;
    };
    if (!lies(chronoDe)) return [];
    gefunden.push(...kurzdaten(lesbar, ref));
    // M531: englisch nachlesen („by Friday") — in der englischen Oberfläche immer, sonst nur, wenn deutsch nichts kam
    if (englischNoetig(lesbar, gefunden.length > 0)) lies(chronoEn!);
    funde = gefunden.sort((a, b) => a.index - b.index);
    fundSpeicher.set(schluessel, funde);
  }
  const seen = new Set<string>();
  const out: DetectedDate[] = [];
  for (const f of funde) {
    const key = f.date.toDateString();
    if (seen.has(key)) continue;
    seen.add(key);
    const diffH = (f.date.getTime() - now.getTime()) / 36e5;
    out.push({
      label: f.text.trim(),
      date: f.date,
      urgency: diffH < -12 ? 'overdue' : diffH < 48 ? 'soon' : 'ok',
    });
  }
  return out.slice(0, 3);
}

/**
 * M390: Hängt das Ergebnis am Tag des Lesens? („Freitag", „morgen", „in 3 Tagen" — nicht „20.11.")
 * M459: `null` = weiß ich noch nicht (die Erkennung lädt gerade) — wer Daten daraus ableitet, ändert dann nichts.
 */
export function hatRelativesDatumOderOffen(text: string): boolean | null {
  if (!text || text.length < 3 || (!kannDatumSein(text) && !kannEnglischSein(text))) return false;
  if (!chronoDe) { void fristenLaden().catch(() => {}); return null; }
  return hatRelativesDatum(text);
}
export function hatRelativesDatum(text: string): boolean {
  if (!text || text.length < 3) return false;
  const a = new Date(2026, 0, 5, 0, 0, 1);    // ein Montag
  const b = new Date(2026, 0, 16, 0, 0, 1);   // elf Tage später, ein Freitag
  const da = detectDates(text, a, a); const db = detectDates(text, b, b);
  if (da.length !== db.length) return true;
  return da.some((d, i) => d.date.toDateString() !== db[i].date.toDateString());
}

export function formatDue(d: DetectedDate, now: Date = new Date()): string {
  const days = Math.round((startOfDay(d.date).getTime() - startOfDay(now).getTime()) / 864e5);
  const dateStr = d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  if (days < 0) return `${dateStr} · überfällig!`;
  if (days === 0) return `${dateStr} · heute`;
  if (days === 1) return `${dateStr} · morgen`;
  return `${dateStr} · in ${days} Tagen`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Kalender-Eintrag (.ics) für eine erkannte Frist erzeugen und herunterladen. */
export function downloadIcs(title: string, date: Date): void {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PixiNotes//DE',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@pixinotes`,
    `DTSTART;VALUE=DATE:${fmt(date)}`,
    `SUMMARY:${title.replace(/[\n,;]/g, ' ')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT9H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${title.replace(/[\n,;]/g, ' ')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  triggerDownload(url, 'pixinotes-termin.ics');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
