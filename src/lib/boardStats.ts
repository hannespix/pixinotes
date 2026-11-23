// Board-Statistiken — eine Quelle statt zweier divergierender reduce()-Kopien (Audit H3).
import type { BoardDoc } from '../store';
import { isOpenItem } from '../types';
import { zahlWort } from './sprache';

export function countOpenTickets(board: BoardDoc): number {
  return board.nodes.reduce(
    (acc, n) => (n.type === 'kanban' ? acc + n.data.items.filter((it) => isOpenItem(it, n.data)).length : acc),
    0,
  );
}

/** „5 Karten · 3 offen" — einheitliche Meta-Zeile für Kacheln & Portale */
export function boardMetaLabel(board: BoardDoc): string {
  const open = countOpenTickets(board);
  return `${zahlWort(board.nodes.length, 'Karte', 'Karten')}${open > 0 ? ` · ${open} offen` : ''}`;
}
