import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { seedEdges, seedNodes } from './seed';
import { uid, type AppNode } from './types';

/** Ein Freihand-Strich (Punkte in Flow-Koordinaten) */
export interface Stroke {
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  width: number;
  points: [number, number][];
}

/** Ebene 3: Ein Board = eine Leinwand voller Karten. */
export interface BoardDoc {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
}

export type Tool = 'select' | 'pen' | 'marker' | 'eraser';

/** Ein Undo-Schritt: kompletter Struktur-Stand eines Boards (Referenzen, kein Deep-Copy —
 *  alle Mutationen laufen immutabel, alte Objekte bleiben gültig). */
interface HistoryEntry {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
}

const HISTORY_LIMIT = 50;

export type AiProvider = 'none' | 'anthropic' | 'openai' | 'ollama' | 'custom';
export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** Basis-URL für Ollama / selbstgehostete OpenAI-kompatible Server */
  baseUrl: string;
}

/** Ebene 2: Ein Projekt bündelt Boards (geordnete Liste). */
export interface Project {
  id: string;
  name: string;
  boardIds: string[];
}

/** Ebene 1: Ein Bereich bündelt Projekte (z. B. „Arbeit", „Privat", „Team"). */
export interface Space {
  id: string;
  name: string;
  projects: Project[];
}

interface Toast {
  message: string;
  /** true → Toast zeigt einen „Rückgängig"-Knopf */
  undo?: boolean;
}

interface DeletedSnapshot {
  boardId: string;
  nodes: AppNode[];
  edges: Edge[];
}

interface BoardState {
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
  view: 'overview' | 'board';
  toast: Toast | null;
  pendingFocus: { boardId: string; nodeId: string } | null;
  lastDeleted: DeletedSnapshot | null;
  tool: Tool;
  settingsOpen: boolean;
  presenting: boolean;
  ai: AiSettings;

  // Navigation
  setView: (view: 'overview' | 'board') => void;
  openBoard: (id: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPresenting: (on: boolean) => void;
  setTool: (tool: Tool) => void;
  updateAi: (patch: Partial<AiSettings>) => void;
  addStroke: (stroke: Stroke) => void;
  eraseStrokesNear: (x: number, y: number, radius: number) => void;
  /** Radier-Geste beginnt: nächster tatsächlicher Lösch-Treffer macht EINEN History-Eintrag */
  beginEraseGesture: () => void;

  // Undo/Redo für Board-Struktur (Karten, Verbindungen, Striche — keine Tipp-Edits)
  past: HistoryEntry[];
  future: HistoryEntry[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  /** Kompletten Stand aus der Sync-Datei übernehmen (ersetzt Boards & Hierarchie) */
  importSync: (boards: BoardDoc[], spaces: Space[], activeId: string) => void;

  // Hierarchie (Bereiche / Projekte / Boards)
  addSpace: (name?: string) => void;
  renameSpace: (id: string, name: string) => void;
  removeSpace: (id: string) => void;
  addProject: (spaceId: string, name?: string) => void;
  renameProject: (id: string, name: string) => void;
  removeProject: (id: string) => void;
  addBoard: (name?: string, projectId?: string) => string;
  renameBoard: (id: string, name: string) => void;
  removeBoard: (id: string) => void;
  /** Board in ein (anderes) Projekt verschieben, optional vor ein bestimmtes Board */
  moveBoard: (boardId: string, targetProjectId: string, beforeBoardId?: string) => void;

  // Karten & Verbindungen (aktives Board)
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  updateEdgeLabel: (id: string, label: string) => void;
  updateEdgeKind: (id: string, kind: string) => void;
  removeEdge: (id: string) => void;
  addNode: (node: AppNode) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  restoreDeleted: () => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  /** Mehrere Positionen in EINEM Store-Update — für den Physik-Loop (60 fps) */
  setNodePositions: (entries: Array<[string, number, number]>) => void;
  focusNode: (boardId: string, nodeId: string) => void;
  clearPendingFocus: () => void;

  showToast: (message: string, undo?: boolean) => void;
}

export const selectActiveBoard = (s: BoardState): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Radier-Geste: erster Treffer erzeugt den History-Eintrag, Rest der Geste nicht */
let eraseSnapPending = false;

/**
 * K1+M5-Schutz: localStorage-Writes werden gedrosselt (max. alle 400 ms statt
 * pro Tastendruck/Drag-Frame) und Quota-Fehler abgefangen statt die App zu
 * crashen. Bei vollem Speicher informiert ein Event die UI (Toast in App.tsx).
 */
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWrite: { key: string; value: string } | null = null;
let quotaWarned = false;

function flushWrite() {
  if (!pendingWrite) return;
  try {
    localStorage.setItem(pendingWrite.key, pendingWrite.value);
    quotaWarned = false;
  } catch {
    if (!quotaWarned) {
      quotaWarned = true;
      window.dispatchEvent(new CustomEvent('pixinotes:quota'));
    }
  }
  pendingWrite = null;
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushWrite);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrite();
  });
}
const debouncedSafeStorage = {
  getItem: (k: string) => localStorage.getItem(k),
  setItem: (k: string, v: string) => {
    pendingWrite = { key: k, value: v };
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushWrite, 400);
  },
  removeItem: (k: string) => localStorage.removeItem(k),
};

/** „Board 2", „Board 3" … statt fünfmal „Neues Board" */
function nextName(base: string, existing: string[]): string {
  let n = existing.filter((e) => e.startsWith(base)).length + 1;
  let candidate = n === 1 ? base : `${base} ${n}`;
  while (existing.includes(candidate)) candidate = `${base} ${++n}`;
  return candidate;
}

const defaultHierarchy = (boardIds: string[]): Space[] => [
  {
    id: 'space-work',
    name: '🏢 Arbeit',
    projects: [{ id: 'proj-general', name: 'Allgemein', boardIds }],
  },
];

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => {
      const patchActive = (fn: (b: BoardDoc) => Partial<BoardDoc>) => {
        const active = selectActiveBoard(get());
        if (!active) return;
        set({
          boards: get().boards.map((b) =>
            b.id === active.id ? { ...b, ...fn(b) } : b,
          ),
        });
      };

      /** Board-ID aus allen Projekten entfernen (Hilfsfunktion für move/delete) */
      const stripBoardFromHierarchy = (spaces: Space[], boardId: string): Space[] =>
        spaces.map((sp) => ({
          ...sp,
          projects: sp.projects.map((p) => ({
            ...p,
            boardIds: p.boardIds.filter((id) => id !== boardId),
          })),
        }));

      return {
        boards: [
          { id: 'main', name: '🏠 Mein Schreibtisch', nodes: seedNodes, edges: seedEdges },
        ],
        spaces: defaultHierarchy(['main']),
        activeId: 'main',
        view: 'board',
        searchOpen: false,
        settingsOpen: false,
        presenting: false,
        tool: 'select',
        ai: { provider: 'none', model: 'claude-opus-4-8', apiKey: '', baseUrl: '' },
        toast: null,
        pendingFocus: null,
        lastDeleted: null,

        setSettingsOpen: (open) => set({ settingsOpen: open }),
        setPresenting: (on) => set({ presenting: on }),
        setTool: (tool) => set({ tool }),
        updateAi: (patch) => set({ ai: { ...get().ai, ...patch } }),

        addStroke: (stroke) => {
          get().pushHistory();
          patchActive((b) => ({ drawings: [...(b.drawings ?? []), stroke] }));
        },

        beginEraseGesture: () => { eraseSnapPending = true; },

        eraseStrokesNear: (x, y, radius) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          const hit = (board?.drawings ?? []).some(
            (s) => s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < radius),
          );
          if (!hit) return;
          // pro Radier-Geste genau EIN History-Eintrag (beim ersten Treffer)
          if (eraseSnapPending) { get().pushHistory(); eraseSnapPending = false; }
          patchActive((b) => ({
            drawings: (b.drawings ?? []).filter(
              (s) => !s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < radius),
            ),
          }));
        },

        // ---------- Undo/Redo (Board-Struktur) ----------
        past: [],
        future: [],

        pushHistory: () => {
          const s = get();
          const b = s.boards.find((x) => x.id === s.activeId);
          if (!b) return;
          set({
            past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings }],
            future: [],
          });
        },

        undo: () => {
          const s = get();
          const entry = s.past[s.past.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ past: s.past.slice(0, -1) }); return; }
          set({
            past: s.past.slice(0, -1),
            future: [...s.future, { boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings } : b,
            ),
          });
        },

        importSync: (boards, spaces, activeId) => {
          if (!Array.isArray(boards) || boards.length === 0 || !Array.isArray(spaces)) return;
          set({
            boards,
            spaces,
            activeId: boards.some((b) => b.id === activeId) ? activeId : boards[0].id,
            past: [],
            future: [],
            lastDeleted: null,
            pendingFocus: null,
          });
        },

        redo: () => {
          const s = get();
          const entry = s.future[s.future.length - 1];
          if (!entry) return;
          const board = s.boards.find((b) => b.id === entry.boardId);
          if (!board) { set({ future: s.future.slice(0, -1) }); return; }
          set({
            future: s.future.slice(0, -1),
            past: [...s.past, { boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings }],
            activeId: entry.boardId,
            view: 'board',
            boards: s.boards.map((b) =>
              b.id === entry.boardId ? { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings } : b,
            ),
          });
        },

        setView: (view) => set({ view }),

        openBoard: (id) => {
          if (get().boards.some((b) => b.id === id)) set({ activeId: id, view: 'board' });
        },

        setSearchOpen: (open) => set({ searchOpen: open }),

        addSpace: (name) =>
          set({
            spaces: [
              ...get().spaces,
              { id: uid(), name: name ?? nextName('Neuer Bereich', get().spaces.map((s) => s.name)), projects: [] },
            ],
          }),

        renameSpace: (id, name) =>
          set({ spaces: get().spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)) }),

        removeSpace: (id) => {
          const space = get().spaces.find((sp) => sp.id === id);
          if (!space) return;
          if (space.projects.some((p) => p.boardIds.length > 0)) {
            get().showToast('Bereich enthält noch Boards — erst verschieben oder löschen.');
            return;
          }
          if (get().spaces.length <= 1) {
            get().showToast('Der letzte Bereich bleibt bestehen 🙂');
            return;
          }
          set({ spaces: get().spaces.filter((sp) => sp.id !== id) });
        },

        addProject: (spaceId, name) =>
          set({
            spaces: get().spaces.map((sp) =>
              sp.id === spaceId
                ? {
                    ...sp,
                    projects: [
                      ...sp.projects,
                      { id: uid(), name: name ?? nextName('📁 Projekt', sp.projects.map((p) => p.name)), boardIds: [] },
                    ],
                  }
                : sp,
            ),
          }),

        renameProject: (id, name) =>
          set({
            spaces: get().spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => (p.id === id ? { ...p, name } : p)),
            })),
          }),

        removeProject: (id) => {
          const project = get().spaces.flatMap((sp) => sp.projects).find((p) => p.id === id);
          if (!project) return;
          if (project.boardIds.length > 0) {
            get().showToast('Projekt enthält noch Boards — erst verschieben oder löschen.');
            return;
          }
          set({
            spaces: get().spaces.map((sp) => ({
              ...sp,
              projects: sp.projects.filter((p) => p.id !== id),
            })),
          });
        },

        addBoard: (name, projectId) => {
          const id = uid();
          const spaces = get().spaces;
          // Ziel: angegebenes Projekt, sonst das erste existierende (notfalls anlegen)
          let target = projectId && spaces.some((sp) => sp.projects.some((p) => p.id === projectId))
            ? projectId
            : undefined;
          let newSpaces = spaces;
          if (!target) {
            const first = spaces.flatMap((sp) => sp.projects)[0];
            if (first) {
              target = first.id;
            } else {
              const pid = uid();
              newSpaces = spaces.length
                ? spaces.map((sp, i) =>
                    i === 0
                      ? { ...sp, projects: [{ id: pid, name: 'Allgemein', boardIds: [] }] }
                      : sp,
                  )
                : defaultHierarchy([]);
              target = newSpaces[0].projects[0]?.id ?? pid;
            }
          }
          set({
            boards: [...get().boards, { id, name: name ?? nextName('✨ Board', get().boards.map((b) => b.name)), nodes: [], edges: [] }],
            spaces: newSpaces.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) =>
                p.id === target ? { ...p, boardIds: [...p.boardIds, id] } : p,
              ),
            })),
            activeId: id,
          });
          return id;
        },

        renameBoard: (id, name) =>
          set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name } : b)) }),

        removeBoard: (id) => {
          const boards = get().boards;
          if (boards.length <= 1) {
            get().showToast('Das letzte Board bleibt offen 🙂');
            return;
          }
          const rest = boards.filter((b) => b.id !== id);
          set({
            boards: rest,
            spaces: stripBoardFromHierarchy(get().spaces, id),
            activeId: get().activeId === id ? rest[0].id : get().activeId,
          });
        },

        moveBoard: (boardId, targetProjectId, beforeBoardId) => {
          // Geister-Boards verhindern: Ziel muss existieren, sonst no-op
          const targetExists = get().spaces.some((sp) => sp.projects.some((p) => p.id === targetProjectId));
          if (!targetExists) return;
          const stripped = stripBoardFromHierarchy(get().spaces, boardId);
          set({
            spaces: stripped.map((sp) => ({
              ...sp,
              projects: sp.projects.map((p) => {
                if (p.id !== targetProjectId) return p;
                const ids = [...p.boardIds];
                const at = beforeBoardId ? ids.indexOf(beforeBoardId) : -1;
                if (at >= 0) ids.splice(at, 0, boardId);
                else ids.push(boardId);
                return { ...p, boardIds: ids };
              }),
            })),
          });
        },

        onNodesChange: (changes) => {
          // Entfernen-Änderungen (Entf-Taste) durch die Undo-Logik schleusen
          const removeIds = changes
            .filter((c): c is Extract<NodeChange, { type: 'remove' }> => c.type === 'remove')
            .map((c) => c.id);
          const rest = changes.filter((c) => c.type !== 'remove');
          if (rest.length) patchActive((b) => ({ nodes: applyNodeChanges(rest, b.nodes) as AppNode[] }));
          if (removeIds.length) get().removeNodes(removeIds);
        },

        onEdgesChange: (changes) =>
          patchActive((b) => ({ edges: applyEdgeChanges(changes, b.edges) })),

        onConnect: (connection) => {
          get().pushHistory();
          patchActive((b) => ({
            edges: addEdge({ ...connection, type: 'labeled', data: { label: '', kind: 'arrow' } }, b.edges),
          }));
        },

        updateEdgeLabel: (id, label) =>
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, label } } : e,
            ),
          })),

        updateEdgeKind: (id, kind) =>
          patchActive((b) => ({
            edges: b.edges.map((e) =>
              e.id === id ? { ...e, data: { ...e.data, kind } } : e,
            ),
          })),

        removeEdge: (id) => {
          get().pushHistory();
          patchActive((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },

        addNode: (node) => {
          get().pushHistory();
          patchActive((b) => ({ nodes: [...b.nodes, node] }));
        },

        removeNode: (id) => get().removeNodes([id]),

        removeNodes: (ids) => {
          const board = get().boards.find((b) => b.id === get().activeId);
          if (!board) return;
          const idSet = new Set(ids);
          const removedNodes = board.nodes.filter((n) => idSet.has(n.id));
          const removedEdges = board.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
          if (removedNodes.length === 0) return;
          get().pushHistory();
          patchActive((b) => ({
            nodes: b.nodes.filter((n) => !idSet.has(n.id)),
            edges: b.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
          }));
          set({ lastDeleted: { boardId: board.id, nodes: removedNodes, edges: removedEdges } });
          get().showToast(
            removedNodes.length === 1 ? 'Karte gelöscht' : `${removedNodes.length} Karten gelöscht`,
            true,
          );
        },

        restoreDeleted: () => {
          const snap = get().lastDeleted;
          if (!snap) return;
          if (!get().boards.some((b) => b.id === snap.boardId)) {
            set({ lastDeleted: null });
            get().showToast('Das Board dieser Karten existiert nicht mehr.');
            return;
          }
          get().pushHistory();
          set({
            boards: get().boards.map((b) =>
              b.id === snap.boardId
                ? {
                    ...b,
                    nodes: [...b.nodes, ...snap.nodes.map((n) => ({ ...n, selected: false }) as AppNode)],
                    edges: [...b.edges, ...snap.edges],
                  }
                : b,
            ),
            lastDeleted: null,
          });
          get().showToast('Wiederhergestellt ✓');
        },

        updateNodeData: (id, data) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, data: { ...n.data, ...data } } as AppNode) : n,
            ),
          })),

        setNodePosition: (id, x, y) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? ({ ...n, position: { x, y } } as AppNode) : n,
            ),
          })),

        setNodePositions: (entries) =>
          patchActive((b) => {
            const map = new Map(entries.map(([id, x, y]) => [id, { x, y }]));
            return {
              nodes: b.nodes.map((n) => {
                const p = map.get(n.id);
                return p ? ({ ...n, position: p } as AppNode) : n;
              }),
            };
          }),

        focusNode: (boardId, nodeId) => {
          set({ pendingFocus: { boardId, nodeId }, activeId: boardId, view: 'board' });
        },

        clearPendingFocus: () => set({ pendingFocus: null }),

        showToast: (message, undo) => {
          if (toastTimer) clearTimeout(toastTimer);
          set({ toast: { message, undo } });
          toastTimer = setTimeout(() => set({ toast: null }), undo ? 6000 : 3000);
        },
      };
    },
    {
      name: 'pixinotes-board',
      version: 2,
      storage: createJSONStorage(() => debouncedSafeStorage),
      partialize: (s) => ({
        boards: s.boards,
        spaces: s.spaces,
        activeId: s.activeId,
        view: s.view,
        ai: s.ai,
      }),
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as Record<string, unknown>;
        // v0: {nodes, edges} — Einzelboard
        if (version === 0 && p && 'nodes' in p) {
          const boards = [
            { id: 'main', name: '🏠 Mein Schreibtisch', nodes: p.nodes as Node[], edges: p.edges as Edge[] },
          ];
          return { boards, spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
        }
        // v1: {boards, activeId} — flache Boards ohne Hierarchie
        if (version === 1 && p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          return {
            boards,
            spaces: defaultHierarchy(boards.map((b) => b.id)),
            activeId: (p.activeId as string) ?? boards[0]?.id,
            view: 'board',
          };
        }
        // v2: defensiv validieren (leeres boards-Array oder tote activeId reparieren)
        if (p && 'boards' in p) {
          const boards = (p.boards as BoardDoc[]) ?? [];
          if (boards.length === 0) {
            return { boards: [{ id: 'main', name: '🏠 Mein Schreibtisch', nodes: [], edges: [] }], spaces: defaultHierarchy(['main']), activeId: 'main', view: 'board' };
          }
          if (!boards.some((b) => b.id === (p.activeId as string))) {
            return { ...p, activeId: boards[0].id };
          }
        }
        return p;
      },
    },
  ),
);
