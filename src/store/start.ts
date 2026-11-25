/**
 * Start: leeres Startboard (M370), Namen ohne Emoji (M397), Startnamen auf Englisch (M381).
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { uid } from '../types';
import type { BoardDoc, Space } from './typen';
import { useBoard } from '../store';
import { ablageModul } from './speicher';

/** „Board 2", „Board 3" … statt fünfmal „Neues Board" */
export function nextName(base: string, existing: string[]): string {
  let n = existing.filter((e) => e.startsWith(base)).length + 1;
  let candidate = n === 1 ? base : `${base} ${n}`;
  while (existing.includes(candidate)) candidate = `${base} ${++n}`;
  return candidate;
}

export const defaultHierarchy = (boardIds: string[]): Space[] => [
  {
    id: 'space-work',
    name: 'Arbeit',
    projects: [{ id: 'proj-general', name: 'Allgemein', boardIds }],
  },
];

/**
 * M370: Der leere Start. Wer PixiNotes zum ersten Mal öffnet, bekommt ein leeres Board — nicht mehr die
 * Beispiel-Umgebung mit ihren vielen Boards. Die verwirrte vor allem dort, wo jemand über einen geteilten Link kam:
 * neben dem einen Board, um das es ging, stand eine fremde Welt. Beispiele gibt es weiter, aber auf Wunsch
 * (Begrüßung, leeres Board, ＋ Neu).
 */
export const START_BOARD_NAME = 'Mein Board';
/** M381: … und so heißt es, wenn die Oberfläche englisch läuft (siehe startNamenAufEnglisch) */
export const START_BOARD_NAME_EN = 'My board';
/** Bis M396 trugen die vorgegebenen Namen ein Emoji vorweg – ein unberührtes Board von damals zählt weiter als unberührt */
export const ohneVorsatz = (n: string): string => n.replace(/^[^\p{L}\p{N}]+\s+/u, '');
export const istStartName = (n: string): boolean => { const k = ohneVorsatz(n); return k === START_BOARD_NAME || k === START_BOARD_NAME_EN; };
export function leererStart(): { boards: BoardDoc[]; spaces: Space[]; activeId: string } {
  const boardId = uid();
  return {
    boards: [{ id: boardId, name: START_BOARD_NAME, nodes: [], edges: [], drawings: [] }],
    spaces: [{ id: uid(), name: 'Arbeit', projects: [{ id: uid(), name: 'Allgemein', boardIds: [boardId] }] }],
    activeId: boardId,
  };
}
/**
 * Das unberührte Startboard — oder null. „Unberührt" heißt: Es ist das einzige Board, trägt noch seinen Namen
 * und ist leer. Dann darf es Platz machen, wenn ein Board von außen kommt (geteilter Link, Einladung,
 * Beispiele): Wer nichts Eigenes hat, soll danach genau das sehen, was er geöffnet hat.
 */
export function leeresStartboard(boards: BoardDoc[]): BoardDoc | null {
  if (boards.length !== 1) return null;
  const b = boards[0];
  const leer = istStartName(b.name) && !b.nodes.length && !b.edges.length && !(b.drawings?.length) && !(b.comments?.length)
    && !b.geteiltVon && !b.gastLink;
  return leer ? b : null;
}
/** Boards und Hierarchie ohne das Startboard (Bereich und Projekt bleiben — dort ist Platz für Eigenes) */
export function ohneStartboard<T extends { boards: BoardDoc[]; spaces: Space[] }>(stand: T, startId: string): { boards: BoardDoc[]; spaces: Space[] } {
  return {
    boards: stand.boards.filter((b) => b.id !== startId),
    spaces: stand.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((pr) => ({ ...pr, boardIds: pr.boardIds.filter((id) => id !== startId) })) })),
  };
}

/**
 * M397: Namen, die die App früher selbst mit Emoji vergeben hat, verlieren ihren Vorsatz – einmal je Gerät.
 * M532: Die Liste der alten Namen und das Umbenennen laden nach (store/ohneEmoji.ts) — und nur, wenn überhaupt ein
 * Name einen Vorsatz trägt; sonst wird nur die Marke gesetzt. Das hält das Start-Paket klein.
 */
export function alteNamenOhneEmoji(): Promise<void> | void {
  try { if (localStorage.getItem('pixinotes-ohne-emoji')) return; } catch { return; }
  const s = useBoard.getState();
  const namen = [...s.boards.map((b) => b.name), ...s.spaces.flatMap((sp) => [sp.name, ...sp.projects.map((p) => p.name)])];
  // (über das ohnehin nachgeladene Modul der Speicherschicht — ein eigener Nachlade-Weg kostete Platz im Start-Paket)
  if (namen.some((n) => ohneVorsatz(n) !== n)) return ablageModul().then((m) => m.namenOhneEmoji(), () => {});
  try { localStorage.setItem('pixinotes-ohne-emoji', '1'); } catch { /* egal */ }
}

/**
 * M381: Der unberührte Start trägt seine Namen in der Sprache der Oberfläche. Nur solange nichts angefasst
 * wurde — eigene Namen bleiben, wie sie sind (auch auf einem Gerät, das später die Sprache wechselt).
 */
export function startNamenAufEnglisch(): void {
  const s = useBoard.getState();
  const start = leeresStartboard(s.boards);
  const bereich = s.spaces[0];
  if (!start || start.name !== START_BOARD_NAME || s.spaces.length !== 1 || bereich.projects.length !== 1) return;
  if (bereich.name !== 'Arbeit' || bereich.projects[0].name !== 'Allgemein') return;
  useBoard.setState({
    boards: [{ ...start, name: START_BOARD_NAME_EN }],
    spaces: [{ ...bereich, name: 'Work', projects: [{ ...bereich.projects[0], name: 'General' }] }],
  });
}
