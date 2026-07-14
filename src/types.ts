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
}

export interface KanbanData {
  title: string;
  items: KanbanItem[];
  /** Spaltennamen — frei benennbar und in der Anzahl variabel; fehlt bei alten Boards (dann Default) */
  cols?: string[];
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
export type AppNode =
  | NoteNode | EmailNode | ImageNode | FileNode | KanbanNode | PortalNode | ShapeNode | MermaidNode;

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
