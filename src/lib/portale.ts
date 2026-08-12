// M262: Portale sind gegenseitig.
//
// Ein Portal war bisher eine Einbahnstraße: Auf Board A lag eine Karte, die
// nach B zeigte — in B stand nichts davon. Wer in B arbeitete, sah nicht, dass
// er von A aus verlinkt ist; das Wissen lag nur auf einer Seite. Beim Anlegen
// entsteht deshalb auf der Gegenseite ein Rückverweis: dieselbe Portal-Karte,
// nur in die andere Richtung.
//
// Bewusst eine eigene Datei ohne Store-Import (der Typ kommt als `import type`
// und ist zur Laufzeit weg): lib/nodes.ts zieht den Store herein, und ein
// Ringschluss Store → nodes → Store ist nichts, was man sich für eine
// Karten-Fabrik einhandeln muss.
import { findFreeSpot } from './arrange';
import { uid, type AppNode } from '../types';
import type { BoardDoc } from '../store';

/** Breite der Portal-Karte — dieselbe wie in lib/nodes.ts (CARD_WIDTHS.portal) */
const BREITE = 200;
const HOEHE = 140;

/** Zeigt irgendein Portal auf `zielId` in diesem Board? */
export function zeigtAuf(board: BoardDoc, zielId: string): boolean {
  return board.nodes.some((n) => n.type === 'portal' && n.data.boardId === zielId);
}

/**
 * Rückverweis für das Ziel-Board bauen — oder null, wenn keiner nötig ist.
 *
 * Kein zweiter, wenn dort schon ein Portal zurückzeigt (auch ein von Hand
 * gelegtes zählt), und keiner auf sich selbst.
 */
export function baueRueckverweis(ziel: BoardDoc, quellBoardId: string): AppNode | null {
  if (ziel.id === quellBoardId) return null;
  if (zeigtAuf(ziel, quellBoardId)) return null;
  /* Über den Inhalt statt irgendwo ins Leere: Wer das Ziel-Board öffnet und
     einpasst, hat den Rückverweis im Bild — nicht drei Bildschirme entfernt. */
  const sichtbar = ziel.nodes.filter((n) => !n.archived);
  const wunsch = sichtbar.length
    ? {
      x: Math.min(...sichtbar.map((n) => n.position.x)),
      y: Math.min(...sichtbar.map((n) => n.position.y)) - HOEHE - 60,
    }
    : { x: 80, y: 80 };
  const position = findFreeSpot(ziel.nodes, wunsch, { w: BREITE, h: HOEHE });
  // `rueck`: automatisch angelegt — die Karte sagt es in der Sprechblase, und
  // wer sie löscht, löscht nur den Verweis, nicht das Original.
  return { id: uid(), type: 'portal', width: BREITE, position, data: { boardId: quellBoardId, rueck: true } };
}
