import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBoard } from '../store';
import { makeCalendar, makeGantt, makeKanban, makeMermaid, makeNote, makePortal, makeShape } from '../lib/nodes';
import { collectTasks } from '../lib/tasks';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCluster, aiCommand, aiEdges, aiProcess, aiTasks } from '../lib/aiActions';
import { selectActiveBoard } from '../store';
import { uid, type AppNode, type ShapeKind } from '../types';
import { computeArrangement, type ArrangeMode } from '../lib/arrange';
import {
  IArrange, IBookmark, ICalendar, IDiagram, IDiamond, IEraser, IFolder, IGantt, IHighlighter, IKanban,
  IHelp, IMagnet, IMousePointer, INote, IPen, IPill, IPlay, IPlus, IRedo, ISearch, ISettings, ISquare, ITasks, IUndo, IWand, IX,
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [arranging, setArranging] = useState(false);

  /**
   * Aufräumen & Anordnen — reiner Algorithmus (lib/arrange): Cluster nach
   * Verbindungen, Typ-Gruppen für den Rest, Shelf-Packing. Die Karten
   * morphen animiert (cubic-out, leicht gestaffelt) an ihre Zielplätze.
   */
  const [arrangeMenu, setArrangeMenu] = useState(false);
  const physicsEnabled = useBoard((s) => s.physicsEnabled);
  const setPhysicsEnabled = useBoard((s) => s.setPhysicsEnabled);

  const arrange = (mode: ArrangeMode) => {
    setArrangeMenu(false);
    if (arranging) return;
    const st = useBoard.getState();
    const board = selectActiveBoard(st);
    if (board.nodes.length < 2) { showToast('Zu wenig Karten zum Anordnen.'); return; }
    const targets = computeArrangement(board.nodes, board.edges, mode);
    // Stapel-Modus: Physik MUSS aus, sonst drückt der nächste Drag alles wieder auseinander
    if (mode === 'stack' && useBoard.getState().physicsEnabled) {
      setPhysicsEnabled(false);
    }
    const starts = new Map(board.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    st.pushHistory();
    setArranging(true);
    const DUR = 700;
    const STAGGER = 14; // ms pro Karte — wirkt organisch statt mechanisch
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now();
    const step = (now: number) => {
      let done = true;
      const frame: Array<[string, number, number]> = [];
      targets.forEach(([id, tx, ty], i) => {
        const s = starts.get(id);
        if (!s) return;
        const t = Math.min(1, Math.max(0, (now - t0 - i * STAGGER) / DUR));
        if (t < 1) done = false;
        const k = ease(t);
        frame.push([id, s.x + (tx - s.x) * k, s.y + (ty - s.y) * k]);
      });
      useBoard.getState().setNodePositions(frame);
      if (!done) {
        requestAnimationFrame(step);
      } else {
        setArranging(false);
        fitView({ padding: 0.12, duration: 500, maxZoom: 1 });
        const msg = {
          flow: 'Verbundenes als Fluss, Rest nach Modultyp gruppiert',
          grid: 'alles als Raster nach Modultyp',
          circles: 'Cluster als Kreis-Bündel',
          stack: 'überlappende Stapel pro Modultyp (Physik ist jetzt AUS, damit nichts auseinanderrutscht)',
        }[mode];
        showToast(`🧹 Aufgeräumt: ${msg} — Strg+Z stellt die alte Anordnung wieder her.`);
      }
    };
    requestAnimationFrame(step);
  };
  const ai = useBoard((s) => s.ai);
  const templates = useBoard((s) => s.templates);
  const removeTemplate = useBoard((s) => s.removeTemplate);
  const focusNode = useBoard((s) => s.focusNode);
  const [addMenu, setAddMenu] = useState(false);
  const [drawMenu, setDrawMenu] = useState(false);
  const [aiMenu, setAiMenu] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const [cmd, setCmd] = useState('');

  /** KI-Aktion aufs ganze Board ausführen (mit Fortschritts-Toast + Fehlerbehandlung) */
  const runAi = async (label: string, fn: (nodes: import('../types').AppNode[], pos: { x: number; y: number }) => Promise<string>, restoreCmd?: string) => {
    setAiMenu(false);
    if (!aiReady(ai)) { showToast('Zuerst die KI in den Einstellungen konfigurieren (Ollama, Anthropic, OpenAI …).'); setSettingsOpen(true); return; }
    // GLOBALE Sperre: auch die Auswahl-Leiste darf währenddessen nichts starten
    if (useBoard.getState().aiBusy) { showToast('Eine KI-Aktion läuft bereits — kurz warten.'); return; }
    useBoard.getState().setAiBusy(true);
    setAiBusy(label);
    showToast('✨ KI analysiert das Board …');
    try {
      const st = useBoard.getState();
      const nodes = selectActiveBoard(st).nodes;
      const msg = await fn(nodes, screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 120 }));
      showToast(`✨ ${msg}`);
    } catch (e) {
      showToast(`KI-Aktion fehlgeschlagen: ${(e as Error).message}`);
      // Freitext-Eingabe bei Fehler zurückgeben — nicht neu tippen müssen
      if (restoreCmd) setCmd(restoreCmd);
    } finally {
      setAiBusy('');
      useBoard.getState().setAiBusy(false);
    }
  };

  const centerPos = (w = 260, h = 80) =>
    screenToFlowPosition({
      x: window.innerWidth / 2 - w / 2 + (Math.random() * 60 - 30),
      y: window.innerHeight / 2 - h / 2 + (Math.random() * 60 - 30),
    });

  /** Modul anlegen + direkt hinfliegen (Pan & Zoom über die pendingFocus-Mechanik) */
  const add = (make: () => AppNode) => {
    const node = make();
    addNode(node);
    focusNode(useBoard.getState().activeId, node.id);
    setAddMenu(false);
  };
  const addShape = (shape: ShapeKind) => add(() => makeShape(centerPos(150, 70), shape));
  const pickTool = (t: typeof tool) => { setTool(t); setDrawMenu(false); };
  const drawing = tool !== 'select';

  return (
    <div className="dock">
      <div className="dock-add-wrap">
        {addMenu && (
          <div className="dock-menu">
            <div className="dock-menu-label">Notizen &amp; Boards</div>
            <button onClick={() => add(() => makeNote(centerPos()))}><INote size={16} /> Notiz</button>
            <button
              onClick={() => add(() => {
                const heading = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                return makeNote(centerPos(), {
                  color: 'white',
                  blocks: [
                    { type: 'heading', props: { level: 3 }, content: heading },
                    { type: 'paragraph', content: '' },
                  ],
                });
              })}
              title="Notiz mit heutigem Datum als Überschrift (Daily Note)"
            >
              <ICalendar size={16} /> Tagesnotiz
            </button>
            <button onClick={() => add(() => makeKanban(centerPos(420, 200)))}><IKanban size={16} /> Kanban-Board</button>
            <div className="dock-menu-label">Planung</div>
            <button onClick={() => add(() => makeGantt(centerPos(560, 240)))}><IGantt size={16} /> Zeitplan (Gantt)</button>
            <button onClick={() => add(() => makeCalendar(centerPos(430, 340)))}><ICalendar size={16} /> Kalender (Monat)</button>
            <button onClick={() => add(() => makeMermaid(centerPos(380, 240)))}><IDiagram size={16} /> Diagramm (Mermaid)</button>
            <div className="dock-menu-label">Prozess-Formen</div>
            <button onClick={() => addShape('process')}><ISquare size={16} /> Schritt</button>
            <button onClick={() => addShape('decision')}><IDiamond size={16} /> Entscheidung</button>
            <button onClick={() => addShape('terminator')}><IPill size={16} /> Start/Ende</button>
            <div className="dock-menu-label">Verknüpfen</div>
            <button onClick={() => { add(() => makePortal(centerPos(200, 140))); showToast('Portal: verlinke ein anderes Board'); }}><IFolder size={16} /> Portal zu Board</button>
            {templates.length > 0 && (
              <>
                <div className="dock-menu-label">Vorlagen</div>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className="dock-menu-template"
                    title="Vorlage als neue Karte einfügen"
                    onClick={() => add(() => {
                      const clone = JSON.parse(JSON.stringify(t.node)) as AppNode;
                      const size = { w: clone.width ?? 260, h: clone.height ?? 120 };
                      return { ...clone, id: uid(), position: centerPos(size.w, size.h), selected: false };
                    })}
                  >
                    <IBookmark size={16} /> {t.name}
                    <span
                      className="dock-menu-template-x"
                      title="Vorlage löschen"
                      onClick={(e) => { e.stopPropagation(); removeTemplate(t.id); }}
                    >
                      <IX size={11} />
                    </span>
                  </button>
                ))}
              </>
            )}
            <div className="dock-menu-foot">E-Mails (.eml/.msg), Bilder &amp; PDFs einfach aufs Board ziehen · Strg+V für Screenshots · Karte auswählen → 🔖 macht sie zur Vorlage</div>
          </div>
        )}
        <button
          className={addMenu ? 'active' : ''}
          onClick={() => { setAddMenu((o) => !o); setDrawMenu(false); setAiMenu(false); }}
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
          onClick={() => { setDrawMenu((o) => !o); setAddMenu(false); setAiMenu(false); }}
          title="Zeichnen (Stift, Textmarker, Radierer)"
          aria-label="Zeichnen"
        >
          {tool === 'marker' ? <IHighlighter /> : tool === 'eraser' ? <IEraser /> : <IPen />}
        </button>
      </div>

      {/* KI-Assistent: boardweite Aktionen */}
      <div className="dock-add-wrap">
        {aiMenu && (
          <div className="dock-menu dock-menu-ai">
            <div className="dock-menu-label">Freitext-Anweisung</div>
            <textarea
              className="ai-cmd-input"
              rows={2}
              placeholder={'z. B. „Erstelle einen Wochenplan als Kanban" oder „Fasse alle Notizen zu einer zusammen"'}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && cmd.trim() && !aiBusy) {
                  e.preventDefault();
                  const wish = cmd;
                  setCmd('');
                  runAi('cmd', (n, p) => aiCommand(wish, n, p), wish);
                }
              }}
            />
            <button
              className="ai-cmd-go"
              disabled={!!aiBusy || !cmd.trim()}
              onClick={() => { const wish = cmd; setCmd(''); runAi('cmd', (n, p) => aiCommand(wish, n, p), wish); }}
            >
              ✨ Ausführen (erstellen, ändern, verbessern …)
            </button>
            <div className="dock-menu-label">KI-Assistent (ganzes Board)</div>
            <button disabled={!!aiBusy} onClick={() => runAi('cluster', (n) => aiCluster(n))}>Themen clustern &amp; anordnen</button>
            <button disabled={!!aiBusy} onClick={() => runAi('tasks', aiTasks)}>Aufgaben &amp; Termine extrahieren</button>
            <button disabled={!!aiBusy} onClick={() => runAi('process', aiProcess)}>Workflow als Diagramm ableiten</button>
            <button disabled={!!aiBusy} onClick={() => runAi('brief', aiBriefing)}>Analytisches Briefing erstellen</button>
            <button disabled={!!aiBusy} onClick={() => runAi('edges', (n) => aiEdges(n))}>Verbindungen vorschlagen</button>
            <div className="dock-menu-foot">
              {aiReady(ai)
                ? 'Nicht destruktiv: legt neue Karten an bzw. ordnet nur an — Strg+Z macht alles rückgängig.'
                : 'KI zuerst in den Einstellungen wählen — „Gratis" geht ohne Schlüssel, Ollama = alles lokal.'}
            </div>
          </div>
        )}
        <button
          className={aiMenu || aiBusy ? 'active' : ''}
          onClick={() => { setAiMenu((o) => !o); setAddMenu(false); setDrawMenu(false); }}
          title="KI-Assistent (Clustern, Aufgaben, Briefing …)"
          aria-label="KI-Assistent"
        >
          <IWand />
        </button>
      </div>

      {/* Aufräumen mit Anordnungs-Modi */}
      <div className="dock-add-wrap">
        {arrangeMenu && (
          <div className="dock-menu dock-menu-arrange">
            <div className="dock-menu-label">Anordnungs-Modus</div>
            <button onClick={() => arrange('flow')} title="Verbundene Karten als Prozess von links nach rechts, der Rest als Typ-Gruppen">🌊 Fluss &amp; Gruppen</button>
            <button onClick={() => arrange('grid')} title="Alles in ein sauberes Raster, sortiert nach Modultyp">▦ Raster</button>
            <button onClick={() => arrange('circles')} title="Zusammenhängendes und Typ-Gruppen jeweils als Kreis-Bündel">◎ Kreis-Bündel</button>
            <button onClick={() => arrange('stack')} title="Karten pro Modultyp überlappend stapeln — Überschriften bleiben sichtbar; Physik wird dafür ausgeschaltet">🗂 Stapeln (überlappend)</button>
            <div className="dock-menu-foot">Strg+Z stellt die vorherige Anordnung komplett wieder her</div>
          </div>
        )}
        <button
          onClick={() => { setArrangeMenu((o) => !o); setAddMenu(false); setDrawMenu(false); setAiMenu(false); }}
          disabled={arranging}
          className={arrangeMenu || arranging ? 'active' : ''}
          title="Board aufräumen & anordnen (Fluss, Raster, Kreise, Stapel)"
          aria-label="Board aufräumen"
        >
          <IArrange />
        </button>
      </div>
      <button
        onClick={() => {
          setPhysicsEnabled(!physicsEnabled);
          showToast(physicsEnabled
            ? '🧲 Physik AUS — Karten dürfen jetzt überlappen und gestapelt werden.'
            : '🧲 Physik AN — Karten verdrängen sich wieder und lassen sich werfen.');
        }}
        className={physicsEnabled ? 'active' : ''}
        title={physicsEnabled
          ? 'Physik ist AN: Karten verdrängen sich und lassen sich werfen — Klick schaltet aus (zum Stapeln/Überlappen)'
          : 'Physik ist AUS: Karten dürfen überlappen — Klick schaltet die Verdrängung wieder an'}
        aria-label="Physik umschalten"
      >
        <IMagnet />
      </button>
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
      <button onClick={() => useBoard.getState().setHelpOpen(true)} title="Hilfe: alle Funktionen erklärt" aria-label="Hilfe"><IHelp /></button>
      <button onClick={() => setSettingsOpen(true)} title="Einstellungen (KI, Synchronisation, Export)" aria-label="Einstellungen"><ISettings /></button>
    </div>
  );
}
