// M443: Ersatz für src/store.ts im MCP-Server (Node, ohne Browser).
//
// Die Modul-Logik der App (lib/kiModule.ts, lib/kiPlan.ts, lib/nodes.ts …) spricht mit dem Store nur über eine
// Handvoll Funktionen: Karte anlegen, Daten einer Karte ändern, Pfeil ziehen, Karten löschen, das aktive Board lesen.
// Genau die stellt dieser Ersatz bereit — auf einem Stand im Speicher, den der MCP-Server lädt und wieder sichert.
// Beim Bündeln (werkzeug/mcp-bauen.mjs) wird jeder Import von src/store.ts hierher umgelenkt.
import type { AppNode } from '../src/types';
import { frisch, nachPatch } from '../src/lib/kartenZeit';

export interface Kante { id: string; source: string; target: string; type?: string; data?: Record<string, unknown>; [k: string]: unknown }
export interface BoardDoc { id: string; name: string; nodes: AppNode[]; edges: Kante[]; drawings?: unknown[]; [k: string]: unknown }
export interface Project { id: string; name: string; boardIds: string[]; sortierung?: string }
export interface Space { id: string; name: string; projects: Project[] }
export type AiSettings = Record<string, unknown>;

interface Zustand {
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
  [k: string]: unknown;
}

let zustand: Zustand = { boards: [], spaces: [], activeId: '' };
const neueId = () => Math.random().toString(36).slice(2, 10);

const aktiv = (): BoardDoc | undefined => zustand.boards.find((b) => b.id === zustand.activeId);
const aendern = (fn: (b: BoardDoc) => Partial<BoardDoc>) => {
  zustand.boards = zustand.boards.map((b) => (b.id === zustand.activeId ? { ...b, ...fn(b) } : b));
};

/** Dieselben Mutatoren wie im echten Store — nur ohne Verlauf, Hinweise und Oberfläche */
// M463: Auch Änderungen über den MCP-Server stempeln die Karte (angelegt/geaendert, M453) – sonst stünde eine von
// einem KI-Programm geschriebene Karte im Board-Briefing als „lange unberührt".
const aktionen = {
  addNode: (node: AppNode) => aendern((b) => ({ nodes: [...b.nodes, frisch(node)] })),
  updateNodeData: (id: string, data: Record<string, unknown>) => aendern((b) => ({
    nodes: b.nodes.map((n) => (n.id === id ? nachPatch({ ...n, data: { ...n.data, ...data } } as AppNode, n, data) : n)),
  })),
  addLabeledEdge: (source: string, target: string, label: string, kind = 'arrow') => aendern((b) => (
    b.edges.some((e) => e.source === source && e.target === target)
      ? {}
      : { edges: [...b.edges, { id: `e-${neueId()}`, source, target, type: 'labeled', data: { label, kind } }] })),
  removeNodes: (ids: string[]) => {
    const weg = new Set(ids);
    aendern((b) => ({
      nodes: b.nodes.filter((n) => !weg.has(n.id)),
      edges: b.edges.filter((e) => !weg.has(e.source) && !weg.has(e.target)),
      drawings: (b.drawings ?? []).filter((s) => !(s as { anchor?: string }).anchor || !weg.has((s as { anchor: string }).anchor)),
      comments: ((b.comments as Array<{ nodeId: string }> | undefined) ?? []).filter((c) => !weg.has(c.nodeId)),
    }));
  },
  resizeNode: (id: string, width: number, height: number) => aendern((b) => ({ nodes: b.nodes.map((n) => (n.id === id ? ({ ...n, width, height } as AppNode) : n)) })),
  pushHistory: () => {},
  showToast: () => {},
};

type Store = Zustand & typeof aktionen;
const lesen = (): Store => ({ ...zustand, ...aktionen } as Store);

/** Wie zustand: useBoard.getState() / setState() */
export const useBoard = Object.assign(
  (sel?: (s: Store) => unknown) => (sel ? sel(lesen()) : lesen()),
  {
    getState: lesen,
    setState: (teil: Partial<Zustand> | ((s: Store) => Partial<Zustand>)) => {
      const neu = typeof teil === 'function' ? teil(lesen()) : teil;
      zustand = { ...zustand, ...neu };
    },
    subscribe: () => () => {},
  },
);

export const selectActiveBoard = (s: { boards: BoardDoc[]; activeId: string }): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];
export const mutedHistory = <T>(fn: () => T): T => fn();
export const runDerived = <T>(fn: () => T): T => fn();
export const kamVonAussen = () => false;
export const useKarteFest = () => false;

/** Für den MCP-Motor: den ganzen Stand setzen und wieder holen */
export function standSetzen(z: { boards: BoardDoc[]; spaces: Space[]; activeId: string }): void { zustand = { ...z }; }
export function standHolen(): { boards: BoardDoc[]; spaces: Space[]; activeId: string } { return { boards: zustand.boards, spaces: zustand.spaces, activeId: zustand.activeId }; }
export function aktivesBoard(): BoardDoc | undefined { return aktiv(); }
