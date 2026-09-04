// Gemeinsame Datentypen der Karten ("alles ist eine Karte")
import type { Node } from '@xyflow/react';

export const STICKY_COLORS = ['yellow', 'pink', 'mint', 'sky', 'white'] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export interface NoteData {
  color: StickyColor;
  /** M155: freie Notiz-Farbe (Hex) — gesetzt gewinnt sie gegen die Palette */
  hex?: string;
  /** BlockNote-Dokument (Block[] als JSON) */
  blocks?: unknown[];
  [key: string]: unknown;
}

export interface ParsedAttachment {
  name: string;
  mime?: string;
  size: number;
  /** Nur für kleine Anhänge eingebettet (data:-URL), sonst undefined */
  dataUrl?: string;
}

export interface EmailData {
  subject: string;
  fromName: string;
  fromAddress?: string;
  date?: string;
  text: string;
  attachments: ParsedAttachment[];
  [key: string]: unknown;
}

export interface ImageData {
  src: string;
  name?: string;
  /** M263: eigener Titel der Karte — Dateinamen sagen selten, was drin ist */
  titel?: string;
  [key: string]: unknown;
}

export interface FileData {
  name: string;
  /**
   * M263: Eigener Titel der Karte. Der Dateiname bleibt unangetastet — er ist
   * der Schlüssel zur Datei (Download, Team-Ordner, lokale Ablage) und darf
   * sich nicht ändern, nur weil jemand die Karte lesbar beschriftet.
   * Leer/fehlt ⇒ es gilt der Dateiname.
   */
  titel?: string;
  size: number;
  mime?: string;
  dataUrl?: string;
  /** M159: relativer Pfad der Kopie im Team-Ordner (pixinotes-anlagen/…) —
   *  darüber holen Teammitglieder Dateien, die zu groß fürs Einbetten sind */
  ref?: string;
  /** M259: Der vollständige Inhalt liegt auf DIESEM Gerät (IndexedDB, s.
   *  fileStore.ts). Reist bewusst nicht mit: Ein Teilen-Link trägt den
   *  Board-Stand, nicht die Festplatte. */
  lokal?: boolean;
  [key: string]: unknown;
}

export interface KanbanItem {
  id: string;
  text: string;
  /** Spaltenindex: 0 = To Do, 1 = Doing, 2 = Done */
  col: number;
  /** Fälligkeitsdatum (ISO yyyy-mm-dd) — Basis für Erinnerungen & Aufgaben-Zentrale */
  due?: string;
  /** Priorität (M114): 1 = hoch (!!!), 2 = mittel (!!), 3 = niedrig (!) */
  prio?: 1 | 2 | 3;
  /** Beschreibung/Details (Ticket-Detailansicht) */
  note?: string;
  /** Verantwortliche Person */
  who?: string;
  /** Verknüpfung zu einem Board bzw. einer Karte (Sprung-Chip am Ticket);
   *  itemId = Quell-Ticket/-Block/-Vorgang — Basis für den Auto-Abgleich */
  link?: { boardId: string; nodeId?: string; itemId?: string };
  /** Checkliste im Ticket (Trello-Stil, M118) — Fortschritt x/y am Ticket */
  subs?: Array<{ id: string; text: string; done?: boolean }>;
  /** Abhängigkeiten (M118): Diese Ticket-IDs (gleiches Kanban) müssen erledigt
   *  sein, bevor dieses Ticket eine Spalte weiter darf ("erst Step 1, dann 2") */
  deps?: string[];
  /** Verknüpfte Karten/Module (mehrere, M118) — `link` bleibt für Auto-Abgleich */
  links?: Array<{ boardId: string; nodeId: string }>;
  /** M293: Wann das Ticket in die Erledigt-Spalte kam (ISO-Zeitstempel) —
   *  die Uhr der Auto-Archivierung. Fehlt bei älteren Ständen; der Archiv-
   *  Lauf trägt es beim ersten Sehen nach. Die Frist zählt also ab da, nicht
   *  rückwirkend: Niemand will nach einem Update eine leergefegte Spalte. */
  erledigtAm?: string;
  /** M293: Wann das Ticket ins Archiv kam — nur im `archiv`-Bestand gesetzt */
  archiviertAm?: string;
}

/** Offene Blocker eines Tickets: Titel der unerledigten Abhängigkeiten (M118) */
export function ticketBlockers(it: KanbanItem, data: KanbanData): string[] {
  const dc = doneCol(data);
  return (it.deps ?? [])
    .map((d) => data.items.find((x) => x.id === d))
    .filter((x): x is KanbanItem => !!x && x.col < dc)
    .map((x) => x.text.slice(0, 40));
}

/** Offene Checklisten-Punkte eines Tickets (M118) */
export function openSubs(it: KanbanItem): number {
  return (it.subs ?? []).filter((s) => !s.done).length;
}

export interface KanbanData {
  title: string;
  items: KanbanItem[];
  /** Spaltennamen — frei benennbar und in der Anzahl variabel; fehlt bei alten Boards (dann Default) */
  cols?: string[];
  /** Auto-Einsammeln: hält sich selbst mit offenen Aufgaben aller Boards aktuell */
  autoCollect?: boolean;
  /** Tickets innerhalb der Spalten nach Quell-Board gruppieren (Swimlanes) */
  groupBy?: 'board' | 'none';
  /** Nur aus diesen Boards einsammeln (undefined = aus allen) */
  collectFrom?: string[];
  /** M166: EINZELNE Quell-Module (Karten-Ids), die beim Einsammeln übersprungen
   *  werden — feiner als die Board-Auswahl (z. B. eine private Checkliste) */
  collectExcludeNodes?: string[];
  /** „nodeId|itemId"-Schlüssel entfernter Tickets — werden NICHT erneut eingesammelt */
  ignoreKeys?: string[];
  /** WIP-Limits je Spaltenindex (M119): 0/undefined = kein Limit; für die
   *  Erledigt-Spalte wirkungslos. Läuft bei ＋/✕-Spalten parallel zu `cols`. */
  wip?: Array<number | null>;
  /** M293: Archivierte Tickets — aus den Spalten heraus, aber nicht weg.
   *  Bewusst ein EIGENER Bestand statt eines Flags an jedem Ticket: So lassen
   *  WIP-Zähler, Abhängigkeiten, Aufgaben-Zentrale, Einsammeln und Export das
   *  Archiv von selbst in Ruhe, ohne dass jede Stelle daran denken müsste. */
  archiv?: KanbanItem[];
  /** M293: Auto-Archivierung an — erledigte Tickets wandern nach
   *  `autoArchivTage` Tagen von selbst ins Archiv */
  autoArchiv?: boolean;
  /** M293: nach wie vielen Tagen in „Erledigt" (Standard 7, siehe ticketArchiv.ts) */
  autoArchivTage?: number;
  [key: string]: unknown;
}

/** WIP-Limit einer Spalte (M119) — die Erledigt-Spalte hat nie eines */
export function wipLimitOf(data: KanbanData, col: number): number | undefined {
  const w = data.wip?.[col];
  return typeof w === 'number' && w > 0 && col < doneCol(data) ? w : undefined;
}

/** Ist die Spalte voll? (WIP-Limit erreicht, M119) */
export function wipFull(data: KanbanData, col: number): boolean {
  const lim = wipLimitOf(data, col);
  if (!lim) return false;
  const dc = doneCol(data);
  return data.items.filter((i) => Math.max(0, Math.min(dc, i.col)) === col).length >= lim;
}

export interface PortalData {
  /** Ziel-Board der Portal-Karte */
  boardId?: string;
  /** M262: automatisch als Rückverweis angelegt (Gegenstück eines Portals) */
  rueck?: boolean;
  [key: string]: unknown;
}

export type ShapeKind = 'process' | 'decision' | 'terminator' | 'note';
export interface ShapeData {
  shape: ShapeKind;
  text: string;
  color: string;
  [key: string]: unknown;
}

export interface MermaidData {
  code: string;
  [key: string]: unknown;
}

/** Typisierte Karten-Nodes — macht `node.data` überall typsicher (Audit H1). */
export type NoteNode = Node<NoteData, 'note'>;
export type EmailNode = Node<EmailData, 'email'>;
export type ImageNode = Node<ImageData, 'image'>;
export type FileNode = Node<FileData, 'file'>;
export type KanbanNode = Node<KanbanData, 'kanban'>;
export type PortalNode = Node<PortalData, 'portal'>;
export type ShapeNode = Node<ShapeData, 'shape'>;
export type MermaidNode = Node<MermaidData, 'mermaid'>;

/** Ein Vorgang im Zeitplan. start === end ⇒ Meilenstein (Raute). */
export interface GanttRow {
  id: string;
  name: string;
  /** ISO yyyy-mm-dd, inklusiv */
  start: string;
  end: string;
  color?: string;
  /** 0–100 */
  progress?: number;
  /** Vorgänger-Vorgang (Finish-to-Start-Abhängigkeit) */
  dep?: string;
  /** Ressource/Person (z. B. „Anna") */
  who?: string;
}
export interface GanttData {
  title: string;
  rows: GanttRow[];
  /** Pixel pro Tag (Zoom) */
  dayWidth?: number;
  [key: string]: unknown;
}
export type GanttNode = Node<GanttData, 'gantt'>;

/** Kalender-Karte: zeigt Fristen & Zeitplan-Einträge aller Boards im Monatsraster */
export interface CalendarData {
  /** angezeigter Monat als yyyy-mm; fehlt ⇒ aktueller Monat */
  month?: string;
  [key: string]: unknown;
}
export type CalendarNode = Node<CalendarData, 'calendar'>;

/** Wochenplan (M153): klassisches Stundenraster — Tage als Spalten, Uhrzeiten
 *  als Zeilen, Blöcke als Einträge. Deckt Stundenplan, Arbeitswoche,
 *  Dienstplan & Co. ab. */
export interface WeekEntry {
  id: string;
  /** Spalten-Index (bei Wochentagen: 0 = Montag … 6 = Sonntag) */
  day: number;
  /** Beginn in Minuten seit Mitternacht (bei eigenen Zeilen: Zeilen-Index × 60) */
  start: number;
  /** Dauer in Minuten (bei eigenen Zeilen: Zeilen-Anzahl × 60) */
  dur: number;
  text: string;
  /** Index in die Farb-Palette der Karte */
  color?: number;
  /** M155: freie Block-Farbe (Hex) — gesetzt gewinnt sie gegen die Palette */
  colorHex?: string;
  /** Optionales Label je Block (Person, Raum, Gruppe …) — als Badge (M154) */
  who?: string;
}
export interface WeekData {
  title: string;
  /** 5 = Mo–Fr, 7 = Mo–So (nur ohne freie Spalten relevant) */
  days: number;
  /** Raster-Beginn/-Ende in Minuten (z. B. 480 = 8:00) */
  from: number;
  to: number;
  entries: WeekEntry[];
  /** M154: FREIE Spalten-Labels (Personen, Räume, Phasen …) — überschreibt days */
  cols?: string[];
  /** M154: Zeilen-Achse — 'time' = Uhrzeit, 'slots' = eigene Einheiten */
  axis?: 'time' | 'slots';
  /** M154: eigene Zeilen-Labels (Schulstunden, Schichten, Sprints …) */
  slots?: string[];
  [key: string]: unknown;
}
export type WeekNode = Node<WeekData, 'week'>;

/**
 * Rechen-Tabelle (M256): das Tabellenblatt als Karte.
 *
 * Die Zellen liegen als flache Zuordnung „A1" → Rohtext vor, nicht als
 * verschachteltes Zeilen-Array. Das hat zwei Gründe: Eine Tabelle ist meist
 * dünn besetzt (fünf gefüllte Zellen in einem 10×20-Raster), und beim
 * Bearbeiten einer einzelnen Zelle muss so kein ganzes Gitter neu gebaut
 * werden. Der Rohtext ist das, was man eintippt — inklusive „=SUMME(A1:A5)";
 * gerechnet wird beim Anzeigen (lib/formel.ts).
 */
export interface SheetData {
  title?: string;
  /** „A1" → Rohtext, z. B. „12,5" oder „=SUMME(A1:A5)" */
  cells?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Breite je Spalte in Punkten — nur abweichende Spalten stehen drin */
  colW?: Record<string, number>;
  /** Herkunft, wenn die Tabelle aus einer Excel-Datei kam */
  quelle?: string;
  [key: string]: unknown;
}
export type SheetNode = Node<SheetData, 'sheet'>;

/**
 * Protokoll-Reihe (M186): EINE Karte für eine ganze Besprechungsserie.
 *
 * Wiederkehrende Meetings sind das klassische Dokumentations-Dilemma: eine
 * endlose Notiz wird unlesbar, hundert Einzelnotizen zerfasern das Board.
 * Hier liegen alle Sitzungen IN der Karte, angezeigt wird immer genau eine.
 *
 * Der eigentliche Gewinn ist die WIEDERVORLAGE: Beim Anlegen einer neuen
 * Sitzung wandern die offenen Punkte der letzten automatisch mit — genau der
 * Handgriff, bei dem sonst per Copy-Paste Punkte verloren gehen.
 */
export interface MinutesEntry {
  id: string;
  /** ISO yyyy-mm-dd — die Sitzung IST ihr Datum */
  date: string;
  /** Abweichender Titel („Sondersitzung"); sonst zählt das Datum */
  title?: string;
  /** Teilnehmende als Freitext — ergibt nebenbei eine Anwesenheitsübersicht */
  attendees?: string;
  /** Protokolltext als BlockNote-Blöcke (wie die Notiz-Karte) */
  blocks?: unknown[];
  /** Beschlüsse: bewusst KEINE Aufgaben, sondern Festlegungen. In der
   *  Verwaltung ist die Beschlusslage oft wichtiger als das Protokoll. */
  decisions?: Array<{ id: string; text: string }>;
  /** Externer Schreiber hat blocks geändert (Rück-Sync) — erzwingt Editor-Refresh */
  extEpoch?: number;
}

export interface MinutesData {
  /** Name der Reihe, z. B. „Jour Fixe Referat 21" */
  title: string;
  /** M187: Kartenfarbe wie bei Notizen — Paletten-Schlüssel … */
  color?: StickyColor;
  /** … bzw. freie Farbe (Hex); gesetzt gewinnt sie gegen die Palette */
  hex?: string;
  /** Neueste zuerst — die Reihenfolge hält sortEntries() */
  entries: MinutesEntry[];
  /** Gerade angezeigte Sitzung (id); fehlt ⇒ die neueste */
  current?: string;
  /** Feste Tagesordnung: erscheint in jeder neuen Sitzung vorstrukturiert */
  agenda?: string[];
  /** Rhythmus für den Datumsvorschlag der nächsten Sitzung */
  rhythm?: 'woche' | 'zweiwochen' | 'monat' | 'quartal' | '';
  /** Offene Punkte beim Anlegen automatisch übernehmen (Standard: an) */
  carryOpen?: boolean;
  [key: string]: unknown;
}
export type MinutesNode = Node<MinutesData, 'minutes'>;

/** Zeiterfassung (M157): Arbeitszeit so unkompliziert wie möglich — ein
 *  laufender Abschnitt (end fehlt), Umschalten der Art beendet den alten und
 *  startet nahtlos den nächsten. Nacherfassen = Zeilen direkt editieren. */
export interface TimeSeg {
  id: string;
  /** ISO yyyy-mm-dd */
  date: string;
  /** Beginn in Minuten seit Mitternacht */
  start: number;
  /** Ende in Minuten — fehlt ⇒ läuft gerade */
  end?: number;
  /** Arbeit / Pause (M171: Fahrzeit & Dienstgeschäft entfernt — Altdaten
   *  werden per Migration v5 zu Arbeit mit Vermerk in der Bemerkung) */
  kind: 'arbeit' | 'pause';
  note?: string;
}
export interface TimeData {
  title: string;
  segs: TimeSeg[];
  /** Ansicht (M161): Tag = editierbares Protokoll, sonst verdichtete Summen */
  view?: 'tag' | 'woche' | 'monat' | 'jahr';
  [key: string]: unknown;
}
export type TimeNode = Node<TimeData, 'time'>;

/** Eigene App (M158): eine per Drag & Drop eingebettete HTML-Datei, die in
 *  einer sandboxten iframe-Instanz läuft. Der Quelltext liegt wegen seiner
 *  Größe in IndexedDB (htmlStore) — hier stehen nur Name und Größe. */
export interface HtmlAppData {
  name: string;
  size: number;
  /** M159: Pfad der Kopie im Team-Ordner — fehlender Quelltext wird auf
   *  anderen Geräten von dort automatisch nachgeladen */
  ref?: string;
  /** M164: Quell-URL. Mit lokalem Quelltext = „Von der Quelle neu laden";
   *  OHNE lokalen Quelltext = Live-Modus (iframe lädt die URL direkt) */
  url?: string;
  /** M164: true = bewusst live einbetten (Quelle erlaubt kein Kopieren/CORS) */
  live?: boolean;
  [key: string]: unknown;
}
export type HtmlAppNode = Node<HtmlAppData, 'htmlapp'>;

/** Frame (M149): benannter Rahmen-Bereich, der Karten optisch gruppiert und
 *  beim Verschieben (am Titel gefasst) seinen Inhalt mitnimmt */
export interface FrameData {
  name: string;
  /** Pastell-Tönung (Hex) — fehlt ⇒ neutral */
  color?: string;
  [key: string]: unknown;
}
export type FrameNode = Node<FrameData, 'frame'>;

export type AppNode =
  (| NoteNode | EmailNode | ImageNode | FileNode | KanbanNode | PortalNode | ShapeNode | MermaidNode | GanttNode | CalendarNode | FrameNode | WeekNode | TimeNode | HtmlAppNode | MinutesNode | SheetNode)
  // Archiv (M87): Karten jedes Typs lassen sich als Ganzes „erledigt" ablegen —
  // deshalb ein gemeinsames Flag auf Node-Ebene statt in jedem data-Interface.
  // autoFit (M103): Auto-Größe — die Karte wächst mit ihrem Inhalt, bis der
  // Nutzer manuell zieht (das schaltet ab); wieder aktivierbar per Auswahl-Leiste.
  // Seit M111 STANDARD AN: undefined = an, false = manuell gebrochen.
  // font/fontSize (M200): Schrift & Textgröße pro Karte — kuratierte Stapel
  // statt endloser Font-Listen; undefined = Standard/M.
  & { archived?: boolean; autoFit?: boolean; font?: CardFont; fontSize?: CardSize };

/** M200: kuratierte Schrift-Stapel — alle offline (Kalam + Atkinson eingebettet) */
export type CardFont = 'serif' | 'lesbar' | 'hand' | 'mono';
export type CardSize = 's' | 'l' | 'xl';

export const KANBAN_COLS = ['To Do', 'Doing', 'Done'] as const;
/** Effektive Spalten eines Kanban-Boards — Default für alte Boards ohne `cols` */
export function kanbanCols(data: KanbanData): string[] {
  return data.cols && data.cols.length >= 2 ? data.cols : [...KANBAN_COLS];
}
/** Die letzte Spalte ist per Konvention immer die „Erledigt"-Spalte */
export function doneCol(data: KanbanData): number {
  return kanbanCols(data).length - 1;
}
export const isOpenItem = (item: KanbanItem, data: KanbanData): boolean => item.col < doneCol(data);

/**
 * M293: Spalte setzen und dabei das Erledigt-Datum pflegen — hinein in die
 * Erledigt-Spalte stempelt den Zeitpunkt, heraus löscht ihn wieder. Alle
 * Wege, auf denen ein Ticket erledigt wird (Pfeil, Ziehen, Ticket-Fenster,
 * Aufgaben-Zentrale, Auto-Abgleich), laufen hier durch — so hat die
 * Auto-Archivierung eine verlässliche Uhr statt einer geratenen.
 */
export function mitSpalte(it: KanbanItem, col: number, data: KanbanData, now: Date = new Date()): KanbanItem {
  const dc = doneCol(data);
  if (col >= dc) {
    // Schon erledigt und gestempelt (z. B. Umsortieren): Stempel bleibt
    return { ...it, col, erledigtAm: it.col >= dc && it.erledigtAm ? it.erledigtAm : now.toISOString() };
  }
  if (it.erledigtAm === undefined) return { ...it, col };
  const { erledigtAm: _weg, ...rest } = it;
  return { ...rest, col };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
