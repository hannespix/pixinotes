import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { makeGantt, makeKanban, makeMermaid, makeNote, makePortal, makeShape } from '../lib/nodes';
import { collectTasks } from '../lib/tasks';
import type { ShapeKind } from '../types';

/** Das Werkzeug-Dock. „Objekt hinzufügen" bündelt die Kartentypen in einem Menü. */
export function Dock() {
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  const setSearchOpen = useBoard((s) => s.setSearchOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setPresenting = useBoard((s) => s.setPresenting);
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const boards = useBoard((s) => s.boards);
  const taskStats = useMemo(() => {
    const ts = collectTasks(boards);
    return { open: ts.length, overdue: ts.filter((t) => t.urgency === 'overdue').length };
  }, [boards]);
  const { screenToFlowPosition } = useReactFlow();
  const [addMenu, setAddMenu] = useState(false);

  const centerPos = (w = 260, h = 80) =>
    screenToFlowPosition({
      x: window.innerWidth / 2 - w / 2 + (Math.random() * 60 - 30),
      y: window.innerHeight / 2 - h / 2 + (Math.random() * 60 - 30),
    });

  const add = (fn: () => void) => { fn(); setAddMenu(false); };
  const addShape = (shape: ShapeKind) => add(() => addNode(makeShape(centerPos(150, 70), shape)));

  return (
    <div className="dock">
      <div className="dock-add-wrap">
        {addMenu && (
          <div className="dock-menu">
            <button onClick={() => add(() => addNode(makeNote(centerPos())))}>📝 Notiz</button>
            <button onClick={() => add(() => addNode(makeKanban(centerPos(420, 200))))}>📋 Kanban</button>
            <button onClick={() => add(() => addNode(makeMermaid(centerPos(380, 240))))}>📊 Diagramm (Mermaid)</button>
            <button onClick={() => add(() => addNode(makeGantt(centerPos(560, 240))))}>📅 Zeitplan (Gantt)</button>
            <div className="dock-menu-label">Prozess-Formen</div>
            <button onClick={() => addShape('process')}>▭ Schritt</button>
            <button onClick={() => addShape('decision')}>◇ Entscheidung</button>
            <button onClick={() => addShape('terminator')}>▢ Start/Ende</button>
            <button onClick={() => add(() => { addNode(makePortal(centerPos(200, 140))); showToast('🗂️ Portal: verlinke ein anderes Board'); })}>🗂️ Portal</button>
          </div>
        )}
        <button className={addMenu ? 'active' : ''} onClick={() => setAddMenu((o) => !o)} title="Objekt hinzufügen" aria-label="Objekt hinzufügen">➕</button>
      </div>

      {/* Undo/Redo — Karten, Striche, Verbindungen (Strg+Z / Strg+Y) */}
      <button onClick={undo} disabled={!canUndo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig">↩️</button>
      <button onClick={redo} disabled={!canRedo} title="Wiederholen (Strg+Y)" aria-label="Wiederholen">↪️</button>
      <span className="dock-sep" />

      {/* Zeichen-Werkzeuge */}
      <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool(tool === 'pen' ? 'select' : 'pen')} title="Stift" aria-label="Stift">✏️</button>
      <button className={tool === 'marker' ? 'active' : ''} onClick={() => setTool(tool === 'marker' ? 'select' : 'marker')} title="Textmarker" aria-label="Textmarker">🖍️</button>
      <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool(tool === 'eraser' ? 'select' : 'eraser')} title="Radierer" aria-label="Radierer">🧽</button>

      <span className="dock-sep" />
      <button className="dock-tasks" onClick={() => setTasksOpen(true)} title="Aufgaben & Erinnerungen (alle Boards)" aria-label="Aufgaben">
        ✅
        {taskStats.open > 0 && (
          <span className={`dock-badge ${taskStats.overdue > 0 ? 'red' : ''}`}>{taskStats.open}</span>
        )}
      </button>
      <button onClick={() => setPresenting(true)} title="Präsentationsmodus (Karten als Folien)" aria-label="Präsentieren">▶️</button>
      <button onClick={() => setSearchOpen(true)} title="Suche über alle Boards (Strg+K)" aria-label="Suche">🔍</button>
      <button onClick={() => setSettingsOpen(true)} title="Einstellungen (KI, Datenordner, Export)" aria-label="Einstellungen">⚙️</button>
      <button
        onClick={() => showToast('📧 E-Mails/Dateien/PDFs aufs Board ziehen · Strg+V für Screenshots · Strg+Scroll = Zoom')}
        title="Import-Hilfe"
      >
        📥
      </button>
    </div>
  );
}
