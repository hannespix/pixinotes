// M453: Karten wissen, wann sie angelegt und zuletzt INHALTLICH geändert wurden.
//
// Zwei Zahlen an der Karte selbst (Millisekunden seit 1970, wie Date.now()):
//   · angelegt  – beim Anlegen (addNode, addNodeToBoard, Duplizieren)
//   · geaendert – bei jeder Änderung am Inhalt (updateNodeData, updateNodeDataOnBoard)
// Bewusst NICHT bei Lage, Größe, Drehung, Schrift, Farbe oder Ansicht (Monat, Zoom, Filter): Wer eine Karte nur
// zur Seite schiebt, hat an ihr nichts getan – das Board-Briefing soll sie trotzdem als „lange unberührt" nennen.
//
// Sync: Die Zahlen reisen mit der Karte (Ordner, Konto, Live-Team). Gestempelt wird nur, wo ein Mensch auf DIESEM
// Gerät etwas ändert – nie beim Einarbeiten fremder Stände (importSync, Patches, Drei-Wege-Abgleich schreiben die
// Karte, wie sie kam). Im Abgleich zählen zwei Fassungen, die sich nur im Zeitpunkt unterscheiden, nicht als
// Konflikt; es gilt die spätere (syncMerge.ts). Was von außen kommt, säubert lib/sicher.ts (zeitSaeubern).
//
// Alte Boards haben keine Zahlen – dann heißt es „unbekannt", bis die Karte das nächste Mal geändert wird. Ein
// erfundenes Datum (etwa der Tag der Umstellung) würde das Briefing auf Monate hinaus belügen.
import type { AppNode } from '../types';
import { sprache } from './sprache';

/** Felder in `data`, die nur Ansicht oder Aussehen sind – ihre Änderung stempelt nicht */
const ANSICHT = new Set([
  'extEpoch', 'month', 'view', 'current', 'dayWidth', 'filter', 'filterAn', 'sort', 'kompakt', 'groupBy', 'colW',
  'rahmen', 'color', 'hex', 'look', 'show', 'fitOnLoad', 'icsEvents', 'lokal', 'ref',
]);

const TAG = 86_400_000;
/** Von außen akzeptierte Abweichung in die Zukunft (Uhren zweier Geräte gehen nie gleich) */
const ZUKUNFT_TOLERANZ = TAG;
/** Frühester glaubhafter Zeitpunkt (PixiNotes gab es vorher nicht) */
const FRUEHESTENS = Date.UTC(2020, 0, 1);

type MitZeit = { angelegt?: number; geaendert?: number };

/** Hat der Patch etwas am INHALT der Karte geändert? (Wertgleiche Patches – etwa ein Editor, der beim Öffnen
 *  denselben Stand meldet – zählen nicht.) */
export function inhaltGeaendert(alt: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(patch)) {
    if (ANSICHT.has(k)) continue;
    const a = alt[k];
    if (a === v) continue;
    if (a && v && typeof a === 'object' && typeof v === 'object' && JSON.stringify(a) === JSON.stringify(v)) continue;
    if (a === undefined && v === undefined) continue;
    return true;
  }
  return false;
}

/** Die Karte nach einem data-Patch: gestempelt, wenn der Inhalt sich änderte (sonst dieselbe Karte) */
export function nachPatch<T extends AppNode>(neu: T, alt: AppNode, patch: Record<string, unknown>, jetzt = Date.now()): T {
  if (!inhaltGeaendert(alt.data as Record<string, unknown>, patch)) return neu;
  return { ...neu, geaendert: jetzt } as T;
}

/** Eine neu angelegte Karte (auch eine Kopie): angelegt = geändert = jetzt */
export function frisch<T extends AppNode>(n: T, jetzt = Date.now()): T {
  return { ...n, angelegt: jetzt, geaendert: jetzt } as T;
}

/** Letzte inhaltliche Änderung (oder Anlage), undefined = unbekannt (Karte aus der Zeit vor M453) */
export function zeitVon(n: AppNode): number | undefined {
  const z = n as AppNode & MitZeit;
  return z.geaendert ?? z.angelegt;
}

const gueltig = (v: unknown, jetzt: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= FRUEHESTENS && v <= jetzt + ZUKUNFT_TOLERANZ;

/** Zeitpunkte einer Karte von außen: Zahl, glaubhaft, nicht (nennenswert) in der Zukunft – sonst weg */
export function zeitSaeubern<T extends AppNode>(n: T, jetzt = Date.now()): T {
  const z = n as T & MitZeit;
  const a = z.angelegt; const g = z.geaendert;
  const aOk = a === undefined || gueltig(a, jetzt);
  const gOk = g === undefined || gueltig(g, jetzt);
  if (aOk && gOk) return n;
  const kopie = { ...z };
  if (!aOk) delete kopie.angelegt;
  if (!gOk) delete kopie.geaendert;
  return kopie;
}

/** Von zwei inhaltsgleichen Fassungen die spätere (für den Abgleich: deterministisch auf beiden Geräten) */
export function spaetere<T extends AppNode>(a: T, b: T): T {
  const za = (a as T & MitZeit).geaendert ?? 0;
  const zb = (b as T & MitZeit).geaendert ?? 0;
  return zb > za ? b : a;
}

/** „vor 3 Tagen", „gestern", „vor 5 Minuten" (de-DE bzw. en) */
export function vorWann(ms: number, jetzt = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(sprache() === 'en' ? 'en' : 'de-DE', { numeric: 'auto' });
  const s = Math.round((Math.min(ms, jetzt) - jetzt) / 1000);   // vorgehende Uhr eines anderen Geräts: „gerade eben"
  const a = Math.abs(s);
  if (a < 45) return sprache() === 'en' ? 'just now' : 'gerade eben';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < TAG / 1000) return rtf.format(Math.round(s / 3600), 'hour');
  const tage = Math.round(s / (TAG / 1000));
  if (Math.abs(tage) < 30) return rtf.format(tage, 'day');
  if (Math.abs(tage) < 365) return rtf.format(Math.round(tage / 30), 'month');
  return rtf.format(Math.round(tage / 365), 'year');
}

/** Ganze Tage seit dem Zeitpunkt */
export function tageSeit(ms: number, jetzt = Date.now()): number {
  return Math.floor((jetzt - ms) / TAG);
}

/** Datum und Uhrzeit für Tooltips */
export function zeitLang(ms: number): string {
  return new Date(ms).toLocaleString(sprache() === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
