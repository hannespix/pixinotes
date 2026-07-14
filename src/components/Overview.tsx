import { useState, type DragEvent } from 'react';
import { useBoard, type BoardDoc, type Project, type Space } from '../store';
import type { KanbanData } from '../types';

const SPACE_ACCENTS = ['#4f7cff', '#e07a3f', '#3fa564', '#a05fd4', '#d44f6e'];

/**
 * Mission Control: alle Bereiche (Ebene 1) → Projekte (Ebene 2) → Boards (Ebene 3).
 * Boards lassen sich per Drag & Drop zwischen Projekten verschieben und sortieren,
 * alles ist inline umbenennbar (Doppelklick).
 */
export function Overview() {
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const addSpace = useBoard((s) => s.addSpace);

  const boardById = new Map(boards.map((b) => [b.id, b]));

  return (
    <div className="overview">
      <div className="ov-head">
        <h1>Deine Boards</h1>
        <p className="ov-sub">
          Bereiche → Projekte → Boards · Boards per Drag &amp; Drop verschieben · Doppelklick benennt um
        </p>
      </div>
      {spaces.map((space, i) => (
        <SpaceSection
          key={space.id}
          space={space}
          accent={SPACE_ACCENTS[i % SPACE_ACCENTS.length]}
          boardById={boardById}
        />
      ))}
      <button className="ov-add-space" onClick={() => addSpace()}>
        + Neuer Bereich
      </button>
    </div>
  );
}

/* ---------- Ebene 1: Bereich ---------- */

function SpaceSection({
  space,
  accent,
  boardById,
}: {
  space: Space;
  accent: string;
  boardById: Map<string, BoardDoc>;
}) {
  const addProject = useBoard((s) => s.addProject);
  const removeSpace = useBoard((s) => s.removeSpace);
  const renameSpace = useBoard((s) => s.renameSpace);

  return (
    <section className="ov-space" style={{ borderColor: accent }}>
      <div className="ov-space-head">
        <InlineName
          value={space.name}
          className="ov-space-name"
          style={{ color: accent }}
          onRename={(name) => renameSpace(space.id, name)}
        />
        <div className="ov-head-actions">
          <button onClick={() => addProject(space.id)} title="Projekt in diesem Bereich anlegen">
            + Projekt
          </button>
          <button onClick={() => removeSpace(space.id)} title="Bereich löschen (nur wenn leer)">
            ✕
          </button>
        </div>
      </div>
      {space.projects.length === 0 && (
        <div className="ov-empty">Noch keine Projekte — leg mit „+ Projekt" los.</div>
      )}
      <div className="ov-projects">
        {space.projects.map((p) => (
          <ProjectGroup key={p.id} project={p} accent={accent} boardById={boardById} />
        ))}
      </div>
    </section>
  );
}

/* ---------- Ebene 2: Projekt ---------- */

function ProjectGroup({
  project,
  accent,
  boardById,
}: {
  project: Project;
  accent: string;
  boardById: Map<string, BoardDoc>;
}) {
  const renameProject = useBoard((s) => s.renameProject);
  const removeProject = useBoard((s) => s.removeProject);
  const addBoard = useBoard((s) => s.addBoard);
  const moveBoard = useBoard((s) => s.moveBoard);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const boardId = e.dataTransfer.getData('text/pn-board');
    if (boardId) moveBoard(boardId, project.id);
  };

  return (
    <div
      className={`ov-project ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="ov-project-head">
        <InlineName
          value={project.name}
          className="ov-project-name"
          onRename={(name) => renameProject(project.id, name)}
        />
        <div className="ov-head-actions">
          <button onClick={() => addBoard(undefined, project.id)} title="Board in diesem Projekt anlegen">
            + Board
          </button>
          <button onClick={() => removeProject(project.id)} title="Projekt löschen (nur wenn leer)">
            ✕
          </button>
        </div>
      </div>
      <div className="ov-boards">
        {project.boardIds.map((id) => {
          const board = boardById.get(id);
          if (!board) return null;
          return <BoardTile key={id} board={board} projectId={project.id} accent={accent} />;
        })}
        {project.boardIds.length === 0 && <div className="ov-empty small">Boards hierher ziehen</div>}
      </div>
    </div>
  );
}

/* ---------- Ebene 3: Board-Kachel ---------- */

function BoardTile({ board, projectId, accent }: { board: BoardDoc; projectId: string; accent: string }) {
  const openBoard = useBoard((s) => s.openBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const moveBoard = useBoard((s) => s.moveBoard);
  const showToast = useBoard((s) => s.showToast);

  const openTickets = board.nodes.reduce((acc, n) => {
    const items = (n.data as Partial<KanbanData>).items;
    return acc + (Array.isArray(items) ? items.filter((it) => it.col < 2).length : 0);
  }, 0);

  const onDropBefore = (e: DragEvent) => {
    // Drop auf eine Kachel = davor einsortieren (Reihenfolge!)
    const boardId = e.dataTransfer.getData('text/pn-board');
    if (boardId && boardId !== board.id) {
      e.preventDefault();
      e.stopPropagation();
      moveBoard(boardId, projectId, board.id);
    }
  };

  return (
    <div
      className="ov-board"
      style={{ borderTopColor: accent }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/pn-board', board.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDrop={onDropBefore}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => openBoard(board.id)}
    >
      <button
        className="ov-board-x"
        title="Board löschen"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Board „${board.name}" mit ${board.nodes.length} Karten wirklich löschen?`)) {
            removeBoard(board.id);
            showToast(`Board „${board.name}" gelöscht`);
          }
        }}
      >
        ✕
      </button>
      <InlineName
        value={board.name}
        className="ov-board-name"
        onRename={(name) => renameBoard(board.id, name)}
        stopClick
      />
      <div className="ov-board-meta">
        {board.nodes.length} Karten
        {openTickets > 0 ? ` · ${openTickets} offen` : ''}
      </div>
      <BoardMiniMap board={board} accent={accent} />
    </div>
  );
}

/** Mini-Vorschau: Kartenpositionen als kleine Punkte — man erkennt „sein" Board sofort. */
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
  stopClick,
}: {
  value: string;
  onRename: (name: string) => void;
  className?: string;
  style?: React.CSSProperties;
  stopClick?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className={className}
        style={style}
        title="Doppelklick zum Umbenennen"
        onClick={(e) => stopClick && editing && e.stopPropagation()}
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
      className={`${className ?? ''} inline-edit`}
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
