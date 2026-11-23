// M498: Ein Kanban gemeinsam bearbeiten — die leichte Brücke zwischen den Stellen, die Tickets ändern (KanbanCard,
// Aufgaben-Zentrale, eingesammelte Tickets, die in ihre Quelle schreiben) und der nachgeladenen Yjs-Sitzung der Karte
// (lib/notizGemeinsamKern.ts `kanbanOeffnen`).
//
// Warum über Yjs? Gemeinsam sichert genau EIN Gerät (der Schreiber) die ganze Kanban-Karte. Schrieb ein anderer an ihm
// vorbei in den Speicher (Person, Frist, Haken, Spalte), ging das im kartenweisen Abgleich verloren oder wurde vom
// Schutz zurückgenommen — darum waren diese Felder in M487 gesperrt, solange jemand im Ticket tippte. Jetzt liegt jede
// Änderung an bestehenden Tickets als „Überlagerung" im Y-Dokument der Karte (Feld für Feld, Checklisten-Punkt für
// Checklisten-Punkt, Reihenfolge); alle sehen sofort denselben Stand, der Schreiber sichert ihn.
//
// Ohne Abhängigkeiten außer React — liegt nie im Start-Bundle als Yjs, ohne Live-Kanal ist die Brücke leer.
import { useSyncExternalStore } from 'react';
import type { KanbanItem } from '../types';

export interface KanbanLive {
  /** Die Tickets aus dem Speicher mit dem gemeinsamen Stand (Felder, Checklisten, Reihenfolge) */
  anwenden(items: KanbanItem[]): KanbanItem[];
  /**
   * Eine Änderung der Ticketliste über das Y-Dokument — `alt` ist der Stand, aus dem `neu` gerechnet wurde. Liefert
   * false (und ändert nichts), wenn sie sich so nicht ausdrücken lässt: Tickets kamen dazu oder fielen weg.
   */
  uebernehmen(alt: KanbanItem[], neu: KanbanItem[]): boolean;
  /** Rückruf bei jeder Änderung des gemeinsamen Stands (hier oder bei anderen) — gibt das Abmelden zurück */
  bei(cb: () => void): () => void;
}

const offen = new Map<string, KanbanLive>();
const versionen = new Map<string, number>();
const abos = new Set<() => void>();
const schluessel = (boardId: string, nodeId: string): string => `${boardId}\n${nodeId}`;
const melden = (k: string): void => {
  versionen.set(k, (versionen.get(k) ?? 0) + 1);
  for (const cb of [...abos]) cb();
};
const abmelden = new Map<string, () => void>();

/** Sitzung einer Kanban-Karte an- (bzw. mit null ab-)melden — von KanbanGemeinsam.tsx, sobald sie steht */
export function kanbanLiveSetzen(boardId: string, nodeId: string, s: KanbanLive | null): void {
  const k = schluessel(boardId, nodeId);
  abmelden.get(k)?.();
  abmelden.delete(k);
  if (s) {
    offen.set(k, s);
    abmelden.set(k, s.bei(() => melden(k)));
  } else offen.delete(k);
  melden(k);
}
export const kanbanLive = (boardId: string, nodeId: string): KanbanLive | null => offen.get(schluessel(boardId, nodeId)) ?? null;

/**
 * Tickets einer Kanban-Karte ändern: steht ihre gemeinsame Sitzung, über das Y-Dokument — sonst (oder wenn die Änderung
 * Tickets anlegt bzw. entfernt) über den Speicher (`sonst`). `alt` = der Stand, aus dem `neu` gerechnet wurde.
 */
export function ticketsSetzen(boardId: string, nodeId: string, alt: KanbanItem[], neu: KanbanItem[], sonst: () => void): void {
  const l = kanbanLive(boardId, nodeId);
  if (l && l.uebernehmen(alt, neu)) return;
  sonst();
}

const abonnieren = (cb: () => void): (() => void) => { abos.add(cb); return () => { abos.delete(cb); }; };
/** Die Sitzung der Karte (oder null) — und neu zeichnen, wenn sich ihr gemeinsamer Stand ändert */
export function useKanbanLive(boardId: string, nodeId: string): { live: KanbanLive | null; version: number } {
  const k = schluessel(boardId, nodeId);
  const version = useSyncExternalStore(abonnieren, () => versionen.get(k) ?? 0, () => 0);
  return { live: offen.get(k) ?? null, version };
}
