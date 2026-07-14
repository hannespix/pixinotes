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

interface BoardState {
  nodes: Node[];
  edges: Edge[];
  toast: string | null;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Record<string, unknown>) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  showToast: (message: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useBoard = create<BoardState>()(
  persist(
    (set, get) => ({
      nodes: seedNodes,
      edges: seedEdges,
      toast: null,

      onNodesChange: (changes) =>
        set({ nodes: applyNodeChanges(changes, get().nodes) }),

      onEdgesChange: (changes) =>
        set({ edges: applyEdgeChanges(changes, get().edges) }),

      onConnect: (connection) =>
        set({ edges: addEdge({ ...connection }, get().edges) }),

      addNode: (node) => set({ nodes: [...get().nodes, node] }),

      removeNode: (id) =>
        set({
          nodes: get().nodes.filter((n) => n.id !== id),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
        }),

      updateNodeData: (id, data) =>
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
          ),
        }),

      setNodePosition: (id, x, y) =>
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, position: { x, y } } : n,
          ),
        }),

      showToast: (message) => {
        if (toastTimer) clearTimeout(toastTimer);
        set({ toast: message });
        toastTimer = setTimeout(() => set({ toast: null }), 3000);
      },
    }),
    {
      name: 'pixinotes-board',
      partialize: (s) => ({ nodes: s.nodes, edges: s.edges }),
    },
  ),
);
