import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { makeCalendar, makeGantt, makeKanban, makeMermaid, makeNote, makePortal, makeShape } from '../lib/nodes';
import { collectTasks } from '../lib/tasks';
import type { ShapeKind } from '../types';
import {
  ICalendar, IDiagram, IDiamond, IEraser, IFolder, IGantt, IHighlighter, IKanban,
  IMousePointer, INote, IPen, IPill, IPlay, IPlus, IRedo, ISearch, ISettings, ISquare, ITasks, IUndo,
} from './Icons';

/**
 * Das Werkzeug-Dock — bewusst schlank: ➕ bündelt alle Kartentypen in einem
 * strukturierten Menü, ✎ bündelt die Zeichenwerkzeuge in einem Flyout.
 */
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
  const [drawMenu, setDrawMenu] = useState(false);

  const centerPos = (w = 260, h = 80) =>
    screenToFlowPosition({
      x: window.innerWidth / 2 - w / 2 + (Math.random() * 60 - 30),
      y: window.innerHeight / 2 - h / 2 + (Math.random() * 60 - 30),
    });

  const add = (fn: () => void) => { fn(); setAddMenu(false); };
  const addShape = (shape: ShapeKind) => add(() => addNode(makeShape(centerPos(150, 70), shape)));
  const pickTool = (t: typeof tool) => { setTool(t); setDrawMenu(false); };
  const drawing = tool !== 'select';

  return (
    <div className="dock">
      <div className="dock-add-wrap">
        {addMenu && (
          <div className="dock-menu">
            <div className="dock-menu-label">Notizen &amp; Boards</div>
            <button onClick={() => add(() => addNode(makeNote(centerPos())))}><INote size={16} /> Notiz</button>
            <button onClick={() => add(() => addNode(makeKanban(centerPos(420, 200))))}><IKanban size={16} /> Kanban-Board</button>
            <div className="dock-menu-label">Planung</div>
            <button onClick={() => add(() => addNode(makeGantt(centerPos(560, 240))))}><IGantt size={16} /> Zeitplan (Gantt)</button>
            <button onClick={() => add(() => addNode(makeCalendar(centerPos(430, 340))))}><ICalendar size={16} /> Kalender (Monat)</button>
            <button onClick={() => add(() => addNode(makeMermaid(centerPos(380, 240))))}><IDiagram size={16} /> Diagramm (Mermaid)</button>
            <div className="dock-menu-label">Prozess-Formen</div>
            <button onClick={() => addShape('process')}><ISquare size={16} /> Schritt</button>
            <button onClick={() => addShape('decision')}><IDiamond size={16} /> Entscheidung</button>
            <button onClick={() => addShape('terminator')}><IPill size={16} /> Start/Ende</button>
            <div className="dock-menu-label">Verknüpfen</div>
            <button onClick={() => add(() => { addNode(makePortal(centerPos(200, 140))); showToast('Portal: verlinke ein anderes Board'); })}><IFolder size={16} /> Portal zu Board</button>
            <div className="dock-menu-foot">E-Mails (.eml/.msg), Bilder &amp; PDFs einfach aufs Board ziehen · Strg+V für Screenshots</div>
          </div>
        )}
        <button
          className={addMenu ? 'active' : ''}
          onClick={() => { setAddMenu((o) => !o); setDrawMenu(false); }}
          title="Objekt hinzufügen"
          aria-label="Objekt hinzufügen"
        >
          <IPlus />
        </button>
      </div>

      {/* Zeichenwerkzeuge als Flyout — ein Slot statt drei */}
      <div className="dock-add-wrap">
        {drawMenu && (
          <div className="dock-menu dock-menu-draw">
            <button className={tool === 'pen' ? 'on' : ''} onClick={() => pickTool('pen')}><IPen size={16} /> Stift</button>
            <button className={tool === 'marker' ? 'on' : ''} onClick={() => pickTool('marker')}><IHighlighter size={16} /> Textmarker</button>
            <button className={tool === 'eraser' ? 'on' : ''} onClick={() => pickTool('eraser')}><IEraser size={16} /> Radierer</button>
            <button onClick={() => pickTool('select')}><IMousePointer size={16} /> Auswahl (Esc)</button>
          </div>
        )}
        <button
          className={drawing ? 'active' : ''}
          onClick={() => { setDrawMenu((o) => !o); setAddMenu(false); }}
          title="Zeichnen (Stift, Textmarker, Radierer)"
          aria-label="Zeichnen"
        >
          {tool === 'marker' ? <IHighlighter /> : tool === 'eraser' ? <IEraser /> : <IPen />}
        </button>
      </div>

      <button onClick={undo} disabled={!canUndo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig"><IUndo /></button>
      <button onClick={redo} disabled={!canRedo} title="Wiederholen (Strg+Y)" aria-label="Wiederholen"><IRedo /></button>

      <span className="dock-sep" />
      <button className="dock-tasks" onClick={() => setTasksOpen(true)} title="Aufgaben & Erinnerungen (alle Boards)" aria-label="Aufgaben">
        <ITasks />
        {taskStats.open > 0 && (
          <span className={`dock-badge ${taskStats.overdue > 0 ? 'red' : ''}`}>{taskStats.open}</span>
        )}
      </button>
      <button onClick={() => setPresenting(true)} title="Präsentationsmodus (Karten als Folien)" aria-label="Präsentieren"><IPlay /></button>
      <span className="dock-sep" />
      <button onClick={() => setSearchOpen(true)} title="Suche über alle Boards (Strg+K)" aria-label="Suche"><ISearch /></button>
      <button onClick={() => setSettingsOpen(true)} title="Einstellungen (KI, Synchronisation, Export)" aria-label="Einstellungen"><ISettings /></button>
    </div>
  );
}
