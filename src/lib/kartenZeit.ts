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
import { kanbanCols, type AppNode, type KanbanData, type KanbanItem } from '../types';
import { sprache } from './sprache';

/** Felder in `data`, die nur Ansicht oder Aussehen sind – ihre Änderung stempelt nicht */
const ANSICHT = new Set([
  'extEpoch', 'month', 'view', 'current', 'dayWidth', 'filter', 'filterAn', 'sort', 'kompakt', 'groupBy', 'colW',
  'rahmen', 'color', 'hex', 'look', 'show', 'fitOnLoad', 'icsEvents', 'lokal', 'ref',
  // M463: Merker an der Mail, dass ein Destillat daneben liegt (M451) – die Mail selbst bleibt unverändert
  'destillat',
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
  let aus = { ...neu, geaendert: jetzt } as T;
  // M470: Tickets merken sich, seit wann sie in ihrer Spalte stehen
  if (alt.type === 'kanban' && Array.isArray(patch.items)) {
    const items = spaltenStempeln(alt.data as KanbanData, neu.data as KanbanData, jetzt);
    if (items) aus = { ...aus, data: { ...aus.data, items } } as T;
  }
  return aus;
}

/**
 * M470: `spalteSeit` der Tickets nach einer Änderung von Hand. Neu in `items` (angelegt, aus dem Archiv, aus einem
 * anderen Kanban) → jetzt; die Spalte gewechselt → jetzt; sonst bleibt der alte Stempel (auch wenn ein Editor das
 * Ticket ohne ihn neu baut). „Gewechselt" heißt: der Index ist anders UND (die Spalten sind dieselben ODER der
 * Spaltenname ist ein anderer) — eine eingefügte Spalte verschiebt Indizes, ohne dass ein Ticket umzieht.
 * Rückgabe null, wenn nichts zu stempeln war.
 */
export function spaltenStempeln(alt: KanbanData, neu: KanbanData, jetzt = Date.now()): KanbanItem[] | null {
  if (!Array.isArray(neu.items)) return null;
  const vorher = new Map((Array.isArray(alt.items) ? alt.items : []).map((it) => [it.id, it]));
  const altCols = kanbanCols(alt);
  const neuCols = kanbanCols(neu);
  const gleicheSpalten = JSON.stringify(altCols) === JSON.stringify(neuCols);
  let anders = false;
  const items = neu.items.map((it) => {
    const a = vorher.get(it.id);
    let seit: number | undefined;
    if (!a) seit = jetzt;
    else if (a.col !== it.col && (gleicheSpalten || altCols[a.col] !== neuCols[it.col])) seit = jetzt;
    else seit = a.spalteSeit;
    if (seit === it.spalteSeit) return it;
    anders = true;
    if (seit === undefined) { const { spalteSeit: _w, ...rest } = it; return rest as KanbanItem; }
    return { ...it, spalteSeit: seit };
  });
  return anders ? items : null;
}

/** M470: Seit wann steht das Ticket in seiner Spalte? Ohne eigenen Stempel die Änderungszeit der Kanban-Karte */
export function spalteSeitVon(it: KanbanItem, kanban: AppNode): number | undefined {
  return typeof it.spalteSeit === 'number' ? it.spalteSeit : zeitVon(kanban);
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
export function zeitSaeubern<T extends AppNode>(n0: T, jetzt = Date.now()): T {
  const n = ticketZeitSaeubern(n0, jetzt);
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

/** M470: `spalteSeit` an Tickets von außen (Sync, Datei, Live-Kanal): dieselbe Regel wie für die Karte */
function ticketZeitSaeubern<T extends AppNode>(n: T, jetzt: number): T {
  if (n.type !== 'kanban') return n;
  const d = n.data as KanbanData;
  const reinigen = (liste: unknown): { liste: unknown; anders: boolean } => {
    if (!Array.isArray(liste)) return { liste, anders: false };
    let anders = false;
    const aus = liste.map((it: unknown) => {
      if (!it || typeof it !== 'object' || !('spalteSeit' in it)) return it;
      const v = (it as KanbanItem).spalteSeit;
      if (v === undefined || gueltig(v, jetzt)) return it;
      anders = true;
      const { spalteSeit: _w, ...rest } = it as KanbanItem;
      return rest;
    });
    return { liste: aus, anders };
  };
  const i = reinigen(d.items);
  const a = reinigen(d.archiv);
  if (!i.anders && !a.anders) return n;
  return { ...n, data: { ...d, items: i.liste, ...(d.archiv !== undefined ? { archiv: a.liste } : {}) } } as T;
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
