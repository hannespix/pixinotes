/**
 * Start: leeres Startboard (M370), Namen ohne Emoji (M397), Startnamen auf Englisch (M381).
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import { uid } from '../types';
import type { BoardDoc, Space } from './typen';
import { mutedHistory } from './verlauf';
import { useBoard } from '../store';

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
 * M397: PixiNotes vergibt keine Emojis mehr. Namen, die die App früher selbst vergeben hat („🏠 Mein Board",
 * „🏢 Arbeit", die Beispiel-Boards, „✨ Board 2" …), verlieren ihren Vorsatz – einmal je Gerät. Eigene Namen
 * bleiben unangetastet: Es zählt nur, was nach dem Vorsatz genau einem alten Standardnamen entspricht.
 */
const ALTE_STANDARDNAMEN = new Set(
  'Arbeit|Work|Mein Board|My board|Mein Schreibtisch|My desk|Board|Projekt|Project|Arbeitsplatz|Wissen & Nachschlagen|Zusammenarbeit & Projekte|Privat|Schreibtisch|Aufgaben-Zentrale|Zeiterfassung & Abwesenheit|Dienstreise|Dienstwagen|Wissen|Software & Tipps|Datenschutz & IT-Sicherheit|Ansprechpartner|Jour fixe|Mitarbeitergespräche|Beispielprojekt: E-Akte|Onboarding neue Kolleg:innen|Prozesse & Mindmap|Eigene Apps & Dateien|Familienplan|Routinen & Ziele|Verträge & Fristen|Besprechung|Meeting|Rückblick|Retrospective|Projektplan|Project plan|Brainstorming|Aufgaben-Board|Task board|Wochenplanung|Weekly planning|Entscheidung|Decision|SWOT|Workshop'.split('|'),
);
export function alteNamenOhneEmoji(): void {
  try {
    if (localStorage.getItem('pixinotes-ohne-emoji')) return;
    localStorage.setItem('pixinotes-ohne-emoji', '1');
  } catch { return; }
  const neu = (n: string): string => {
    const kern = ohneVorsatz(n);
    return kern !== n && ALTE_STANDARDNAMEN.has(kern.replace(/ \d+$/, '')) ? kern : n;
  };
  const s = useBoard.getState();
  const boards = s.boards.map((b) => (neu(b.name) === b.name ? b : { ...b, name: neu(b.name) }));
  const spaces = s.spaces.map((sp) => {
    const projects = sp.projects.map((p) => (neu(p.name) === p.name ? p : { ...p, name: neu(p.name) }));
    const gleich = projects.every((p, i) => p === sp.projects[i]) && neu(sp.name) === sp.name;
    return gleich ? sp : { ...sp, name: neu(sp.name), projects };
  });
  if (boards.every((b, i) => b === s.boards[i]) && spaces.every((sp, i) => sp === s.spaces[i])) return;
  mutedHistory(() => useBoard.setState({ boards, spaces }));
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
