import { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { useBoard, type BoardDoc, type Project, type Space } from '../store';
import type { KanbanData } from '../types';

const SPACE_ACCENTS = ['#4f7cff', '#e07a3f', '#3fa564', '#a05fd4', '#d44f6e'];

// Kachel- und Layout-Maße (Canvas-Koordinaten)
const BW = 200, BH = 150, GAP = 16, PROJ_HEAD = 44, SPACE_HEAD = 56, SPACE_GAP = 70;

interface ProjectRect { id: string; x: number; y: number; w: number; h: number }

/**
 * Übersicht als Canvas-Navigation: dieselben Gesten wie auf den Boards
 * (pannen, zoomen), Bereiche und Projekte als Zonen, Boards als Kacheln.
 * Kachel anklicken = ins Board springen · Kachel in andere Projekt-Zone
 * ziehen = verschieben · Portal-Verknüpfungen erscheinen als Linien.
 */
export function Overview() {
  return (
    <ReactFlowProvider>
      <OverviewCanvas />
    </ReactFlowProvider>
  );
}

const nodeTypes: NodeTypes = {
  ovSpace: SpaceZone,
  ovProject: ProjectZone,
  ovBoard: BoardTile,
};

function OverviewCanvas() {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const moveBoard = useBoard((s) => s.moveBoard);
  const openBoard = useBoard((s) => s.openBoard);
  const addSpace = useBoard((s) => s.addSpace);
  // tick erzwingt Neu-Layout nach einem Drag (Kacheln rasten in die Zonen zurück)
  const [tick, setTick] = useState(0);

  const { nodes, edges, projectRects } = useMemo(
    () => layoutHierarchy(spaces, boards),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, boards, tick],
  );

  return (
    <div className="board-wrap ov-canvas">
      <ReactFlow
        key={tick /* nach Drag sauber neu einrasten */}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
        minZoom={0.08}
        maxZoom={1.8}
        panOnScroll
        zoomOnDoubleClick={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        nodeDragThreshold={6}
        proOptions={{ hideAttribution: false }}
        onNodeClick={(_, node) => {
          if (node.type === 'ovBoard') openBoard((node.data as { board: BoardDoc }).board.id);
        }}
        onNodeDragStop={(_, node) => {
          if (node.type !== 'ovBoard') return;
          const data = node.data as { board: BoardDoc; projectId: string };
          const cx = node.position.x + BW / 2;
          const cy = node.position.y + BH / 2;
          const hit = projectRects.find(
            (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h,
          );
          if (hit && hit.id !== data.projectId) moveBoard(data.board.id, hit.id);
          setTick((t) => t + 1);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color="#d8d3c8" />
      </ReactFlow>
      <button className="ov-add-space-float" onClick={() => addSpace()}>
        + Neuer Bereich
      </button>
    </div>
  );
}

/* ---------- Layout: Hierarchie → Canvas-Positionen ---------- */

function layoutHierarchy(spaces: Space[], boards: BoardDoc[]) {
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const projectRects: ProjectRect[] = [];
  const tilePos = new Map<string, { x: number; y: number }>();

  let y = 0;
  spaces.forEach((space, si) => {
    const accent = SPACE_ACCENTS[si % SPACE_ACCENTS.length];

    const sizes = space.projects.map((p) => {
      const n = p.boardIds.length;
      const cols = Math.max(1, Math.min(3, n));
      const rows = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
      return {
        cols,
        w: Math.max(cols * (BW + GAP) + GAP, 250),
        h: PROJ_HEAD + rows * (BH + GAP) + GAP,
      };
    });
    const spaceW = Math.max(sizes.reduce((a, s) => a + s.w, 0) + GAP * (space.projects.length + 1), 340);
    const spaceH = SPACE_HEAD + (sizes.length ? Math.max(...sizes.map((s) => s.h)) : 90) + GAP;

    nodes.push({
      id: `s-${space.id}`,
      type: 'ovSpace',
      position: { x: 0, y },
      data: { space, accent },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
      style: { width: spaceW, height: spaceH },
    });

    let px = GAP;
    space.projects.forEach((project, pi) => {
      const { cols, w, h } = sizes[pi];
      const projX = px;
      const projY = y + SPACE_HEAD;
      projectRects.push({ id: project.id, x: projX, y: projY, w, h });
      nodes.push({
        id: `p-${project.id}`,
        type: 'ovProject',
        position: { x: projX, y: projY },
        data: { project, spaceId: space.id },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 1,
        style: { width: w, height: h },
      });

      project.boardIds.forEach((bid, bi) => {
        const board = boardById.get(bid);
        if (!board) return;
        const bx = projX + GAP + (bi % cols) * (BW + GAP);
        const by = projY + PROJ_HEAD + Math.floor(bi / cols) * (BH + GAP);
        tilePos.set(bid, { x: bx, y: by });
        nodes.push({
          id: `b-${bid}`,
          type: 'ovBoard',
          position: { x: bx, y: by },
          data: { board, projectId: project.id, accent },
          zIndex: 2,
          style: { width: BW, height: BH },
        });
      });
      px += w + GAP;
    });
    y += spaceH + SPACE_GAP;
  });

  // Portal-Karten → sichtbare Verknüpfungslinien zwischen Board-Kacheln
  for (const b of boards) {
    for (const n of b.nodes) {
      const targetId = (n.data as { boardId?: string }).boardId;
      if (n.type === 'portal' && targetId && tilePos.has(targetId) && tilePos.has(b.id) && targetId !== b.id) {
        edges.push({
          id: `pe-${b.id}-${targetId}-${n.id}`,
          source: `b-${b.id}`,
          target: `b-${targetId}`,
          label: '🗂️',
          style: { stroke: 'rgba(124,92,255,.55)', strokeWidth: 2, strokeDasharray: '7 5' },
        });
      }
    }
  }

  return { nodes, edges, projectRects };
}

/* ---------- Zonen & Kacheln ---------- */

function SpaceZone({ data }: NodeProps) {
  const { space, accent } = data as unknown as { space: Space; accent: string };
  const renameSpace = useBoard((s) => s.renameSpace);
  const removeSpace = useBoard((s) => s.removeSpace);
  const addProject = useBoard((s) => s.addProject);
  return (
    <div className="ovc-space" style={{ borderColor: accent }}>
      <div className="ovc-space-head">
        <InlineName value={space.name} className="ovc-space-name" style={{ color: accent }} onRename={(n) => renameSpace(space.id, n)} />
        <div className="ov-head-actions nodrag">
          <button onClick={() => addProject(space.id)} title="Projekt anlegen">+ Projekt</button>
          <button onClick={() => removeSpace(space.id)} title="Bereich löschen (nur wenn leer)">✕</button>
        </div>
      </div>
    </div>
  );
}

function ProjectZone({ data }: NodeProps) {
  const { project } = data as unknown as { project: Project };
  const renameProject = useBoard((s) => s.renameProject);
  const removeProject = useBoard((s) => s.removeProject);
  const addBoard = useBoard((s) => s.addBoard);
  return (
    <div className="ovc-project">
      <div className="ovc-project-head">
        <InlineName value={project.name} className="ov-project-name" onRename={(n) => renameProject(project.id, n)} />
        <div className="ov-head-actions nodrag">
          <button onClick={() => addBoard(undefined, project.id)} title="Board anlegen">+ Board</button>
          <button onClick={() => removeProject(project.id)} title="Projekt löschen (nur wenn leer)">✕</button>
        </div>
      </div>
      {project.boardIds.length === 0 && <div className="ov-empty small nodrag">Boards hierher ziehen</div>}
    </div>
  );
}

function BoardTile({ data }: NodeProps) {
  const { board, accent } = data as unknown as { board: BoardDoc; accent: string };
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.name);

  const openTickets = board.nodes.reduce((acc, n) => {
    const items = (n.data as Partial<KanbanData>).items;
    return acc + (Array.isArray(items) ? items.filter((it) => it.col < 2).length : 0);
  }, 0);

  return (
    <div className="ov-board ovc-tile" style={{ borderTopColor: accent }} title="Klick öffnet das Board · Ziehen verschiebt es">
      <span className="ovc-tile-actions nodrag">
        <button
          title="Umbenennen"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(board.name);
            setEditing(true);
          }}
        >
          ✏️
        </button>
        <button
          title="Board löschen"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Board „${board.name}" mit ${board.nodes.length} Karten wirklich löschen?`)) {
              removeBoard(board.id);
            }
          }}
        >
          ✕
        </button>
      </span>
      {editing ? (
        <input
          className="inline-edit nodrag"
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) renameBoard(board.id, draft.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="ov-board-name">{board.name}</span>
      )}
      <div className="ov-board-meta">
        {board.nodes.length} Karten
        {openTickets > 0 ? ` · ${openTickets} offen` : ''}
      </div>
      <BoardMiniMap board={board} accent={accent} />
    </div>
  );
}

/** Mini-Vorschau: Kartenpositionen als Rechtecke — Wiedererkennung auf einen Blick. */
function BoardMiniMap({ board, accent }: { board: BoardDoc; accent: string }) {
  if (board.nodes.length === 0) return <div className="ov-minimap empty">leer</div>;
  const xs = board.nodes.map((n) => n.position.x);
  const ys = board.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs) + 250;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + 150;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  return (
    <svg className="ov-minimap" viewBox="0 0 100 46" preserveAspectRatio="xMidYMid meet">
      {board.nodes.slice(0, 40).map((n) => (
        <rect
          key={n.id}
          x={((n.position.x - minX) / w) * 88 + 2}
          y={((n.position.y - minY) / h) * 36 + 2}
          width={Math.max(4, (250 / w) * 88)}
          height={Math.max(3, (150 / h) * 36)}
          rx={1.5}
          fill={accent}
          opacity={0.45}
        />
      ))}
    </svg>
  );
}

/* ---------- Inline-Umbenennen (Doppelklick) ---------- */

function InlineName({
  value,
  onRename,
  className,
  style,
}: {
  value: string;
  onRename: (name: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className={`${className ?? ''} nodrag`}
        style={style}
        title="Doppelklick zum Umbenennen"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }
  return (
    <input
      className={`${className ?? ''} inline-edit nodrag`}
      style={style}
      autoFocus
      value={draft}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim()) onRename(draft.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
