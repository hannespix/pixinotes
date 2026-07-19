// M142: Ausrichten & Verteilen der Auswahl — das PowerPoint-Handwerkszeug.
// Reine Geometrie: liefert Ziel-Positionen/-Größen, der Aufrufer schreibt sie
// (mit EINEM History-Eintrag) in den Store.
import type { AppNode } from '../types';
import { sizeOf } from './arrange';

export type AlignOp = 'left' | 'centerX' | 'top' | 'centerY' | 'distH' | 'distV' | 'width';

export const ALIGN_LABEL: Record<AlignOp, string> = {
  left: '⇤ Links ausrichten',
  centerX: '↔ Horizontal zentrieren',
  top: '⤒ Oben ausrichten',
  centerY: '↕ Vertikal zentrieren',
  distH: '⇹ Horizontal verteilen',
  distV: '⇳ Vertikal verteilen',
  width: '⭤ Gleiche Breite',
};

export interface AlignResult {
  moves: Array<[string, number, number]>;
  resizes: Array<[string, number, number]>;
}

export function computeAlign(nodes: AppNode[], op: AlignOp): AlignResult {
  const moves: Array<[string, number, number]> = [];
  const resizes: Array<[string, number, number]> = [];
  if (nodes.length < 2) return { moves, resizes };
  const boxes = nodes.map((n) => ({ n, s: sizeOf(n) }));

  switch (op) {
    case 'left': {
      const minX = Math.min(...boxes.map((b) => b.n.position.x));
      for (const b of boxes) moves.push([b.n.id, minX, b.n.position.y]);
      break;
    }
    case 'centerX': {
      const c = boxes.reduce((a, b) => a + b.n.position.x + b.s.w / 2, 0) / boxes.length;
      for (const b of boxes) moves.push([b.n.id, c - b.s.w / 2, b.n.position.y]);
      break;
    }
    case 'top': {
      const minY = Math.min(...boxes.map((b) => b.n.position.y));
      for (const b of boxes) moves.push([b.n.id, b.n.position.x, minY]);
      break;
    }
    case 'centerY': {
      const c = boxes.reduce((a, b) => a + b.n.position.y + b.s.h / 2, 0) / boxes.length;
      for (const b of boxes) moves.push([b.n.id, b.n.position.x, c - b.s.h / 2]);
      break;
    }
    case 'distH': {
      if (boxes.length < 3) break;
      const sorted = [...boxes].sort((a, b) => a.n.position.x - b.n.position.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.n.position.x + last.s.w - first.n.position.x;
      const sumW = sorted.reduce((a, b) => a + b.s.w, 0);
      const gap = (span - sumW) / (sorted.length - 1);
      let x = first.n.position.x;
      for (const b of sorted) { moves.push([b.n.id, x, b.n.position.y]); x += b.s.w + gap; }
      break;
    }
    case 'distV': {
      if (boxes.length < 3) break;
      const sorted = [...boxes].sort((a, b) => a.n.position.y - b.n.position.y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.n.position.y + last.s.h - first.n.position.y;
      const sumH = sorted.reduce((a, b) => a + b.s.h, 0);
      const gap = (span - sumH) / (sorted.length - 1);
      let y = first.n.position.y;
      for (const b of sorted) { moves.push([b.n.id, b.n.position.x, y]); y += b.s.h + gap; }
      break;
    }
    case 'width': {
      const maxW = Math.max(...boxes.map((b) => b.s.w));
      for (const b of boxes) if (b.s.w !== maxW) resizes.push([b.n.id, maxW, b.s.h]);
      break;
    }
  }
  return { moves, resizes };
}
