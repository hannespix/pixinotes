// M465: Eine Frist aus dem Text im Bild (M452) als Aufgabe anlegen — nur auf ausdrücklichen Klick.
//
// Fristen aus Bildern erscheinen nie von selbst in der Aufgaben-Zentrale: Die Texterkennung liest auch
// Rechnungs-, Liefer- und Druckdaten, und nicht jedes Datum auf einem Screenshot ist etwas, das man tun muss.
// Erst „als Aufgabe" am Frist-Chip macht daraus ein Kanban-Ticket mit Frist und Verweis auf das Bild — wie die
// Schnell-Eingabe der Zentrale: ins erste (nicht archivierte) Kanban des Boards, sonst in ein neues unter dem Bild.
import { mutedHistory, useBoard } from '../store';
import { uid, type KanbanData, type KanbanItem } from '../types';
import { makeKanban } from './nodes';
import { findFreeSpot, sizeOf } from './arrange';
import { tagLokal } from './tag';
import type { DetectedDate } from './dates';

/** Die Zeile des erkannten Textes, in der die Frist steht — sie sagt meist, worum es geht („Abgabe bis 15.12.") */
export function fristZeile(ocr: string, label: string): string {
  const zeile = ocr.split('\n').map((z) => z.trim()).find((z) => z.includes(label)) ?? '';
  const kurz = zeile.replace(/\s+/g, ' ').trim();
  return kurz.length > 90 ? `${kurz.slice(0, 89)}…` : kurz;
}

export function fristAlsAufgabe(boardId: string, bildId: string, ocr: string, frist: DetectedDate): string {
  const st = useBoard.getState();
  const board = st.boards.find((b) => b.id === boardId);
  const bild = board?.nodes.find((n) => n.id === bildId);
  if (!board || !bild) return 'Das Bild gibt es nicht mehr – keine Aufgabe angelegt.';
  const due = tagLokal(frist.date);
  const titel = String((bild.data as { titel?: string; name?: string }).titel?.trim() || (bild.data as { name?: string }).name || 'Bild');
  const text = fristZeile(ocr, frist.label) || `Frist aus ${titel}`;
  const vorhanden = board.nodes.find((n) => n.type === 'kanban' && !n.archived);
  const item: KanbanItem = { id: uid(), text, col: 0, due, links: [{ boardId, nodeId: bildId }] };
  // Schon dieselbe Aufgabe angelegt (Doppelklick)? Dann nicht doppelt in der Zentrale.
  if (vorhanden && (vorhanden.data as KanbanData).items.some((it) => it.due === due && it.text === text
    && it.links?.some((l) => l.nodeId === bildId))) {
    return `Diese Frist ist schon als Aufgabe in „${(vorhanden.data as KanbanData).title || 'Kanban'}" angelegt.`;
  }
  st.pushHistory();
  let ziel = vorhanden;
  mutedHistory(() => {
    if (!ziel) {
      const s = sizeOf(bild);
      const pos = findFreeSpot(board.nodes, { x: bild.position.x, y: bild.position.y + s.h + 60 }, { w: 320, h: 220 });
      ziel = makeKanban(pos, 'Aufgaben');
      st.addNodeToBoard(boardId, ziel);
    }
    const k = (useBoard.getState().boards.find((b) => b.id === boardId)?.nodes.find((n) => n.id === ziel!.id)?.data ?? ziel!.data) as KanbanData;
    st.updateNodeDataOnBoard(boardId, ziel!.id, { items: [...k.items, item] });
  });
  const name = (ziel!.data as KanbanData).title || 'Kanban';
  return `Aufgabe „${text}" mit Frist in „${name}" angelegt – zu sehen in der Aufgaben-Zentrale`;
}
