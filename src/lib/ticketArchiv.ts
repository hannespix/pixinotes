/**
 * M293: Archiv für erledigte Kanban-Tickets — von Hand und automatisch.
 *
 * Der Wunsch: „Erledigte Aufgaben sollen archivierbar sein … auch
 * Auto-Archivierung aktivierbar machen, dass nach einer einstellbaren Zeit
 * erledigte Aufgaben automatisch archiviert werden."
 *
 * Ein Kanban lebt davon, dass die Erledigt-Spalte den Fortschritt zeigt —
 * und stirbt daran, wenn sie nach drei Monaten zweihundert Tickets hält.
 * Löschen ist die falsche Antwort (der Nachweis wäre weg), also ein Archiv:
 * Die Tickets verlassen die Spalten, bleiben aber in der Karte — mit dem
 * Datum ihrer Erledigung und Archivierung — und kommen per Klick zurück.
 *
 * Das Archiv ist ein eigener Bestand (`archiv`) neben `items`. Dadurch
 * bleibt alles, was Tickets zählt oder liest (WIP-Limits, Abhängigkeits-
 * Pfeile, Aufgaben-Zentrale, Einsammeln, Zeitplan-Abo, Export), ohne
 * Änderung korrekt: Es sieht das Archiv schlicht nicht.
 *
 * Für die Automatik braucht es eine Uhr: `erledigtAm` wird gestempelt, sobald
 * ein Ticket die Erledigt-Spalte erreicht (types.ts → mitSpalte). Tickets aus
 * älteren Ständen haben keinen Stempel; der Lauf trägt ihn beim ersten Sehen
 * nach — die Frist zählt also ab dem Update, nicht rückwirkend. Wer alte
 * Erledigte sofort weghaben will, nimmt „Alle archivieren" an der Spalte.
 */
import { doneCol, type KanbanData, type KanbanItem } from '../types';
import { runDerived, useBoard } from '../store';

const TAG_MS = 86_400_000;

/** Voreinstellung, wenn die Automatik eingeschaltet wird — eine Woche lässt
 *  das Erledigte noch für den Wochenrückblick stehen */
export const AUTO_ARCHIV_STANDARD_TAGE = 7;

/** Wirksame Frist in Tagen — 0 = Automatik aus */
export function autoArchivTage(data: KanbanData): number {
  if (!data.autoArchiv) return 0;
  const t = Number(data.autoArchivTage);
  return Number.isFinite(t) && t > 0 ? Math.min(365, Math.round(t)) : AUTO_ARCHIV_STANDARD_TAGE;
}

/** Was ein Archiv-Handgriff am Kanban ändert (nur diese beiden Felder) */
export type ArchivStand = { items: KanbanItem[]; archiv: KanbanItem[] };

/** Tickets ins Archiv legen — in der Reihenfolge, in der sie in den Spalten standen */
export function archiviere(data: KanbanData, ids: Iterable<string>, now: Date = new Date()): ArchivStand {
  const set = new Set(ids);
  const stamp = now.toISOString();
  const weg = data.items
    .filter((it) => set.has(it.id))
    // Ohne Erledigt-Stempel (Altbestand) gilt der Moment des Archivierens
    .map((it) => ({ ...it, erledigtAm: it.erledigtAm ?? stamp, archiviertAm: stamp }));
  return { items: data.items.filter((it) => !set.has(it.id)), archiv: [...(data.archiv ?? []), ...weg] };
}

/** Archivierte Tickets zurück in die Erledigt-Spalte — der Archiv-Stempel fällt weg */
export function holeZurueck(data: KanbanData, ids: Iterable<string>): ArchivStand {
  const set = new Set(ids);
  const dc = doneCol(data);
  const zurueck = (data.archiv ?? [])
    .filter((it) => set.has(it.id))
    .map(({ archiviertAm: _weg, ...it }) => ({ ...it, col: dc }));
  return { items: [...data.items, ...zurueck], archiv: (data.archiv ?? []).filter((it) => !set.has(it.id)) };
}

export interface AutoArchivErgebnis {
  /** Nur die Felder, die sich ändern — `archiv` fehlt, wenn nichts gewandert ist */
  patch: { items: KanbanItem[]; archiv?: KanbanItem[] };
  archiviert: number;
}

/**
 * Ein Lauf der Automatik über EIN Kanban. Zwei Dinge passieren:
 * 1. Erledigte ohne Stempel bekommen jetzt einen — immer, auch bei
 *    ausgeschalteter Automatik, damit die Uhr schon läuft, falls sie später
 *    eingeschaltet wird.
 * 2. Ist die Automatik an, wandern Erledigte, deren Stempel älter als die
 *    eingestellten Tage ist, ins Archiv.
 * null, wenn nichts zu tun war — der Aufrufer fasst den Store dann nicht an.
 */
export function autoArchivLauf(data: KanbanData, now: Date = new Date()): AutoArchivErgebnis | null {
  if (!Array.isArray(data.items)) return null;
  const dc = doneCol(data);
  const tage = autoArchivTage(data);
  const grenze = tage > 0 ? now.getTime() - tage * TAG_MS : null;
  const jetzt = now.toISOString();
  let geaendert = false;
  const bleibt: KanbanItem[] = [];
  const weg: KanbanItem[] = [];
  for (const it of data.items) {
    if (it.col < dc) { bleibt.push(it); continue; }
    const seit = it.erledigtAm ? Date.parse(it.erledigtAm) : Number.NaN;
    if (Number.isNaN(seit)) {
      bleibt.push({ ...it, erledigtAm: jetzt });
      geaendert = true;
    } else if (grenze !== null && seit <= grenze) {
      weg.push({ ...it, archiviertAm: jetzt });
      geaendert = true;
    } else {
      bleibt.push(it);
    }
  }
  if (!geaendert) return null;
  return {
    patch: weg.length ? { items: bleibt, archiv: [...(data.archiv ?? []), ...weg] } : { items: bleibt },
    archiviert: weg.length,
  };
}

/**
 * Alle Kanbans aller Boards durchgehen — beim Start und alle paar Minuten
 * (App.tsx). Läuft als abgeleitete Änderung (runDerived): kein Undo-Eintrag,
 * keine „eigene Bearbeitung" für den Sync — das Ergebnis folgt aus Stempeln
 * und Einstellung und ist jederzeit rekonstruierbar. Archivierte Karten und
 * Boards ruhen, wie bei Aufgaben und Erinnerungen auch.
 * Rückgabe: wie viele Tickets insgesamt ins Archiv gewandert sind.
 */
export function autoArchivAlleBoards(now: Date = new Date()): number {
  const st = useBoard.getState();
  let gesamt = 0;
  runDerived(() => {
    for (const b of st.boards) {
      if (b.archived) continue;
      for (const n of b.nodes) {
        if (n.type !== 'kanban' || n.archived) continue;
        const erg = autoArchivLauf(n.data, now);
        if (!erg) continue;
        st.updateNodeDataOnBoard(b.id, n.id, erg.patch);
        gesamt += erg.archiviert;
      }
    }
  });
  return gesamt;
}
