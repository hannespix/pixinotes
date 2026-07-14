import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
import { uid } from './types';

/** Ein Board = ein Projekt/Raum. Wie Browser-Tabs, aber mit Portal-Karten verlinkbar. */
export interface BoardDoc {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
}

interface BoardState {
  boards: BoardDoc[];
  activeId: string;
  toast: string | null;

  // Board-Verwaltung
  setActiveBoard: (id: string) => void;
  addBoard: (name?: string) => string;
  renameBoard: (id: string, name: string) => void;
  removeBoard: (id: string) => void;

  // Karten & Verbindungen (wirken immer auf das aktive Board)
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  setNodePosition: (id: string, x: number, y: number) => void;

  showToast: (message: string) => void;
}

/** Selektoren für Komponenten */
export const selectActiveBoard = (s: BoardState): BoardDoc =>
  s.boards.find((b) => b.id === s.activeId) ?? s.boards[0];

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => {
      /** Hilfsfunktion: das aktive Board immutabel patchen */
      const patchActive = (fn: (b: BoardDoc) => Partial<BoardDoc>) =>
        set({
          boards: get().boards.map((b) =>
            b.id === get().activeId ? { ...b, ...fn(b) } : b,
          ),
        });

      return {
        boards: [
          { id: 'main', name: '🏠 Mein Schreibtisch', nodes: seedNodes, edges: seedEdges },
        ],
        activeId: 'main',
        toast: null,

        setActiveBoard: (id) => {
          if (get().boards.some((b) => b.id === id)) set({ activeId: id });
        },

        addBoard: (name) => {
          const id = uid();
          set({
            boards: [...get().boards, { id, name: name ?? '✨ Neues Projekt', nodes: [], edges: [] }],
            activeId: id,
          });
          return id;
        },

        renameBoard: (id, name) =>
          set({ boards: get().boards.map((b) => (b.id === id ? { ...b, name } : b)) }),

        removeBoard: (id) => {
          const boards = get().boards;
          if (boards.length <= 1) return;
          const rest = boards.filter((b) => b.id !== id);
          set({
            boards: rest,
            activeId: get().activeId === id ? rest[0].id : get().activeId,
          });
        },

        onNodesChange: (changes) =>
          patchActive((b) => ({ nodes: applyNodeChanges(changes, b.nodes) })),

        onEdgesChange: (changes) =>
          patchActive((b) => ({ edges: applyEdgeChanges(changes, b.edges) })),

        onConnect: (connection) =>
          patchActive((b) => ({ edges: addEdge({ ...connection }, b.edges) })),

        addNode: (node) => patchActive((b) => ({ nodes: [...b.nodes, node] })),

        removeNode: (id) =>
          patchActive((b) => ({
            nodes: b.nodes.filter((n) => n.id !== id),
            edges: b.edges.filter((e) => e.source !== id && e.target !== id),
          })),

        updateNodeData: (id, data) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
            ),
          })),

        setNodePosition: (id, x, y) =>
          patchActive((b) => ({
            nodes: b.nodes.map((n) =>
              n.id === id ? { ...n, position: { x, y } } : n,
            ),
          })),

        showToast: (message) => {
          if (toastTimer) clearTimeout(toastTimer);
          set({ toast: message });
          toastTimer = setTimeout(() => set({ toast: null }), 3000);
        },
      };
    },
    {
      name: 'pixinotes-board',
      version: 1,
      partialize: (s) => ({ boards: s.boards, activeId: s.activeId }),
      migrate: (persisted: unknown, version: number) => {
        // v0 → v1: Einzelboard {nodes, edges} wird zum Multi-Board-Format
        if (version === 0 && persisted && typeof persisted === 'object' && 'nodes' in persisted) {
          const old = persisted as { nodes: Node[]; edges: Edge[] };
          return {
            boards: [
              { id: 'main', name: '🏠 Mein Schreibtisch', nodes: old.nodes, edges: old.edges },
            ],
            activeId: 'main',
          };
        }
        return persisted as { boards: BoardDoc[]; activeId: string };
      },
    },
  ),
);
