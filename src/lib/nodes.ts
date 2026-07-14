// Karten-Fabriken: eine Quelle für Default-Größen, Farb-Rotation und
// Node-Erzeugung (Audit M5/N5 — vorher vierfach dupliziert).
import {
  STICKY_COLORS,
  uid,
  type AppNode,
  type EmailData,
  type StickyColor,
} from '../types';

export const CARD_WIDTHS = {
  note: 270,
  email: 320,
  image: 260,
  file: 240,
  kanban: 430,
  portal: 200,
} as const;

type Pos = { x: number; y: number };

/** Rotierende Haftnotiz-Farben (ohne Weiß — das ist die „Karten"-Optik) */
let colorIdx = 0;
export function nextStickyColor(): StickyColor {
  return STICKY_COLORS[colorIdx++ % (STICKY_COLORS.length - 1)];
}

export function makeNote(position: Pos, opts?: { color?: StickyColor; blocks?: unknown[] }): AppNode {
  return {
    id: uid(),
    type: 'note',
    width: CARD_WIDTHS.note,
    position,
    data: { color: opts?.color ?? nextStickyColor(), blocks: opts?.blocks ?? [] },
  };
}

export function makeEmail(position: Pos, data: EmailData): AppNode {
  return { id: uid(), type: 'email', width: CARD_WIDTHS.email, position, data };
}

export function makeImage(position: Pos, src: string, name?: string): AppNode {
  return { id: uid(), type: 'image', width: CARD_WIDTHS.image, position, data: { src, name } };
}

export function makeFile(
  position: Pos,
  file: { name: string; size: number; mime?: string; dataUrl?: string },
): AppNode {
  return { id: uid(), type: 'file', width: CARD_WIDTHS.file, position, data: file };
}

export function makeKanban(position: Pos, title = '📋 Neues Board'): AppNode {
  return { id: uid(), type: 'kanban', width: CARD_WIDTHS.kanban, position, data: { title, items: [] } };
}

export function makePortal(position: Pos): AppNode {
  return { id: uid(), type: 'portal', width: CARD_WIDTHS.portal, position, data: {} };
}
