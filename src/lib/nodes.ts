// Karten-Fabriken: eine Quelle für Default-Größen, Farb-Rotation und
// Node-Erzeugung (Audit M5/N5 — vorher vierfach dupliziert).
import { useBoard } from '../store';
import { MERMAID_TEMPLATES } from './mermaidTemplates';
import {
  STICKY_COLORS,
  uid,
  type AppNode,
  type EmailData,
  type ShapeKind,
  type StickyColor,
} from '../types';

/**
 * Schutz vor stillem Datenverlust (Audit HOCH): Wenn der persistierte Zustand
 * plus das neue Asset ein sicheres Budget überschreiten würde, wird das Asset
 * NICHT eingebettet — sonst scheitern ab da alle localStorage-Writes und der
 * gesamte Board-Stand ginge beim Reload verloren. ~4 MB lässt Luft zum ~5-MB-Limit.
 */
const EMBED_BUDGET = 4_000_000;
export function canEmbed(dataUrlLength: number): boolean {
  try {
    const used = JSON.stringify(useBoard.getState().boards).length;
    return used + dataUrlLength < EMBED_BUDGET;
  } catch {
    return true;
  }
}

export const CARD_WIDTHS = {
  note: 270,
  email: 320,
  image: 260,
  file: 240,
  kanban: 430,
  portal: 200,
  shape: 150,
  mermaid: 380,
  gantt: 560,
  calendar: 430,
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

export function makeShape(position: Pos, shape: ShapeKind = 'process'): AppNode {
  return {
    id: uid(),
    type: 'shape',
    width: CARD_WIDTHS.shape,
    height: 70,
    position,
    data: { shape, text: '', color: '#eef2ff' },
  };
}

export function makeGantt(position: Pos): AppNode {
  const day = 864e5;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const now = Date.now();
  return {
    id: uid(),
    type: 'gantt',
    width: CARD_WIDTHS.gantt,
    height: 240,
    position,
    data: {
      title: '📅 Zeitplan',
      dayWidth: 24,
      rows: [
        { id: uid(), name: 'Phase 1', start: iso(now), end: iso(now + 6 * day), color: '#4f7cff', progress: 30 },
        { id: uid(), name: 'Phase 2', start: iso(now + 7 * day), end: iso(now + 13 * day), color: '#3fa564' },
        { id: uid(), name: 'Meilenstein', start: iso(now + 14 * day), end: iso(now + 14 * day), color: '#e07a3f' },
      ],
    },
  };
}

export function makeCalendar(position: Pos): AppNode {
  return {
    id: uid(),
    type: 'calendar',
    width: CARD_WIDTHS.calendar,
    height: 340,
    position,
    data: {},
  };
}

export function makeMermaid(position: Pos): AppNode {
  return {
    id: uid(),
    type: 'mermaid',
    width: CARD_WIDTHS.mermaid,
    height: 240,
    position,
    // Exakt die Flow-Vorlage: neue Karten gelten als „unberührt" — ein
    // Vorlagen-Wechsel direkt nach dem Anlegen fragt dann nicht nach (M92)
    data: { code: MERMAID_TEMPLATES.Flow },
  };
}
