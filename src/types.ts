// Gemeinsame Datentypen der Karten ("alles ist eine Karte")
import type { Node } from '@xyflow/react';

export const STICKY_COLORS = ['yellow', 'pink', 'mint', 'sky', 'white'] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export interface NoteData {
  color: StickyColor;
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
  [key: string]: unknown;
}

export interface FileData {
  name: string;
  size: number;
  mime?: string;
  dataUrl?: string;
  [key: string]: unknown;
}

export interface KanbanItem {
  id: string;
  text: string;
  /** Spaltenindex: 0 = To Do, 1 = Doing, 2 = Done */
  col: number;
  /** Fälligkeitsdatum (ISO yyyy-mm-dd) — Basis für Erinnerungen & Aufgaben-Zentrale */
  due?: string;
  /** Beschreibung/Details (Ticket-Detailansicht) */
  note?: string;
  /** Verantwortliche Person */
  who?: string;
  /** Verknüpfung zu einem Board bzw. einer Karte (Sprung-Chip am Ticket);
   *  itemId = Quell-Ticket/-Block/-Vorgang — Basis für den Auto-Abgleich */
  link?: { boardId: string; nodeId?: string; itemId?: string };
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
  /** „nodeId|itemId"-Schlüssel entfernter Tickets — werden NICHT erneut eingesammelt */
  ignoreKeys?: string[];
  [key: string]: unknown;
}

export interface PortalData {
  /** Ziel-Board der Portal-Karte */
  boardId?: string;
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

export type AppNode =
  (| NoteNode | EmailNode | ImageNode | FileNode | KanbanNode | PortalNode | ShapeNode | MermaidNode | GanttNode | CalendarNode)
  // Archiv (M87): Karten jedes Typs lassen sich als Ganzes „erledigt" ablegen —
  // deshalb ein gemeinsames Flag auf Node-Ebene statt in jedem data-Interface.
  // autoFit (M103): Auto-Größe — die Karte wächst mit ihrem Inhalt, bis der
  // Nutzer manuell zieht (das schaltet ab); wieder aktivierbar per Auswahl-Leiste.
  // Seit M111 STANDARD AN: undefined = an, false = manuell gebrochen.
  & { archived?: boolean; autoFit?: boolean };

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

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
