// Gemeinsame Datentypen der Karten ("alles ist eine Karte")

export type StickyColor = 'yellow' | 'pink' | 'mint' | 'sky' | 'white';

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
}

export interface KanbanData {
  title: string;
  items: KanbanItem[];
  [key: string]: unknown;
}

export const KANBAN_COLS = ['To Do', 'Doing', 'Done'] as const;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
