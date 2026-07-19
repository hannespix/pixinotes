import { useMemo, useRef, useState } from 'react';
import { useOutsideClose } from '../lib/useOutsideClose';
import { useReactFlow } from '@xyflow/react';
import { mutedHistory, useBoard } from '../store';
import { makeCalendar, makeGantt, makeKanban, makeMermaid, makeNote, makePortal, makeShape } from '../lib/nodes';
import { collectTasks } from '../lib/tasks';
import { aiReady } from '../lib/ai';
import { aiBriefing, aiCluster, aiCommand, aiEdges, aiProcess, aiTasks } from '../lib/aiActions';
import { selectActiveBoard } from '../store';
import { uid, type AppNode, type ShapeKind } from '../types';
import { computeArrangement, findFreeSpot, type ArrangeMode } from '../lib/arrange';
import {
  IArchive, IArrange, IBookmark, ICalendar, IDiagram, IDiamond, IEraser, IFolder, IGantt, IHighlighter, IKanban,
  IMagnet, IMousePointer, INote, IPen, IPill, IPlay, IPlus, ISquare, ITasks, IWand, IX,
} from './Icons';

/**
 * Das Werkzeug-Dock — bewusst schlank: ➕ bündelt alle Kartentypen in einem
 * strukturierten Menü, ✎ bündelt die Zeichenwerkzeuge in einem Flyout.
 */
export function Dock() {
  const addNode = useBoard((s) => s.addNode);
  const showToast = useBoard((s) => s.showToast);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setPresenting = useBoard((s) => s.setPresenting);
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
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
  const showArchived = useBoard((s) => s.showArchived);
  const setShowArchived = useBoard((s) => s.setShowArchived);
  const gridSnap = useBoard((s) => s.gridSnap);
  const setGridSnap = useBoard((s) => s.setGridSnap);
  const archivedCount = useBoard((s) => selectActiveBoard(s).nodes.filter((n) => n.archived).length);
  // Hintergrund-Tönung des aktiven Boards — seit M126 hier statt in der Tab-Leiste
  const setBoardBg = useBoard((s) => s.setBoardBg);
  const activeBoardId = useBoard((s) => s.activeId);
  const activeBoardBg = useBoard((s) => selectActiveBoard(s).bg);

  const arrange = (mode: ArrangeMode) => {
    setArrangeMenu(false);
    if (arranging) return;
    const st = useBoard.getState();
    const board = selectActiveBoard(st);
    if (board.nodes.length < 2) { showToast('Zu wenig Karten zum Anordnen.'); return; }
    // Archivierte Karten bleiben liegen — sie sind meist unsichtbar und sollen
    // beim Aufräumen weder mitmischen noch heimlich verschoben werden
    const targets = computeArrangement(board.nodes.filter((n) => !n.archived), board.edges, mode);
    // Stapel-Modus: Physik MUSS aus, sonst drückt der nächste Drag alles wieder auseinander
    if (mode === 'stack' && useBoard.getState().physicsEnabled) {
      setPhysicsEnabled(false);
    }
    const starts = new Map(board.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    st.pushHistory();
    // M140: Doppelte Verbindungen (gleiche Richtung zwischen denselben Karten)
    // beim Aufräumen zusammenfassen — die beschriftete Fassung überlebt
    const keep = new Map<string, { id: string; hasLabel: boolean }>();
    const dupes: string[] = [];
    for (const e of board.edges) {
      const key = `${e.source}>${e.target}`;
      const hasLabel = !!(e.data as { label?: string } | undefined)?.label;
      const prev = keep.get(key);
      if (!prev) keep.set(key, { id: e.id, hasLabel });
      else if (hasLabel && !prev.hasLabel) { dupes.push(prev.id); keep.set(key, { id: e.id, hasLabel }); }
      else dupes.push(e.id);
    }
    if (dupes.length) {
      mutedHistory(() => st.onEdgesChange(dupes.map((id) => ({ type: 'remove' as const, id }))));
      showToast(`🧹 ${dupes.length} doppelte Verbindung(en) zusammengefasst.`);
    }
    // Metro-Grid: alle Verbindungen auf die rechtwinklige Winkel-Route stellen
    if (mode === 'metro') {
      mutedHistory(() => {
        for (const e of selectActiveBoard(useBoard.getState()).edges) st.updateEdgeKind(e.id, 'step');
      });
    }
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
          flow: 'Verbundenes als Fluss (links → rechts), Rest nach Modultyp gruppiert',
          flowV: 'Verbundenes als Fluss (oben ↓ unten), Rest nach Modultyp gruppiert',
          metro: 'Metro-Grid: Fluss auf festem Raster, Verbindungen rechtwinklig',
          lanes: 'Schwimmbahnen: eine Bahn pro Person, unten „Ohne Zuordnung"',
          timeline: 'Zeitstrahl: Fristen chronologisch, Undatiertes darunter',
          compact: 'Kompakt gepackt — ideal vor dem Bild-Export',
          quadrant: 'Quadrant: ↖ wichtig+dringend · ↗ wichtig · ↙ dringend · ↘ Rest',
          grid: 'Themen-Cluster bleiben zusammen, Rest als Raster nach Modultyp',
          circles: 'Themen-Cluster als Kreis-Bündel (Titel in der Mitte)',
          stack: 'Stapel je Themen-Cluster & Modultyp (Physik ist jetzt AUS, damit nichts auseinanderrutscht)',
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
  // Hintergrund-Klick/-Tipp schließt alle Dock-Flyouts (User-Wunsch)
  const dockRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(addMenu || drawMenu || aiMenu || arrangeMenu, dockRef, () => {
    setAddMenu(false); setDrawMenu(false); setAiMenu(false); setArrangeMenu(false);
  });
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

  // Wunschposition Bildmitte — aber nie ÜBER bestehende Karten (M130):
  // findFreeSpot weicht auf die nächste freie Stelle aus
  const centerPos = (w = 260, h = 80) => {
    const p = screenToFlowPosition({ x: window.innerWidth / 2 - w / 2, y: window.innerHeight / 2 - h / 2 });
    return findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, p, { w, h });
  };

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
    <div className="dock" ref={dockRef}>
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
            <button onClick={() => arrange('flow')} title="Verbundene Karten als Prozess von links nach rechts, der Rest als Typ-Gruppen">🌊 Fluss → horizontal</button>
            <button onClick={() => arrange('flowV')} title="Verbundene Karten als Prozess von oben nach unten, der Rest als Typ-Gruppen">🌊 Fluss ↓ vertikal</button>
            <button onClick={() => arrange('metro')} title="Fluss-Layout auf festem Raster, alle Verbindungen rechtwinklig — U-Bahn-Plan-Look">🚇 Metro-Grid</button>
            <button onClick={() => arrange('grid')} title="Alles in ein sauberes Raster, sortiert nach Modultyp">▦ Raster</button>
            <button onClick={() => arrange('compact')} title="Minimale Fläche — dicht gepackt, ideal vor dem Bild-Export">🧱 Kompakt packen</button>
            <button onClick={() => arrange('lanes')} title="Eine Bahn pro Person (Eigenschaft wer/who oder Personen aus Tickets/Zeitplänen)">🏊 Schwimmbahnen (Personen)</button>
            <button onClick={() => arrange('timeline')} title="Karten mit Fristen chronologisch von links nach rechts, Undatiertes darunter">📅 Zeitstrahl (Fristen)</button>
            <button onClick={() => arrange('quadrant')} title="Eisenhower: links oben wichtig+dringend · rechts oben wichtig · links unten dringend · rechts unten Rest">🎯 Quadrant (wichtig/dringend)</button>
            <button onClick={() => arrange('circles')} title="Zusammenhängendes und Typ-Gruppen jeweils als Kreis-Bündel">◎ Kreis-Bündel</button>
            <button onClick={() => arrange('stack')} title="Karten pro Modultyp überlappend stapeln — Überschriften bleiben sichtbar; Physik wird dafür ausgeschaltet">🗂 Stapeln (überlappend)</button>
            <div className="dock-menu-label">Raster</div>
            <button
              className={gridSnap ? 'active' : ''}
              onClick={() => {
                setGridSnap(!gridSnap);
                showToast(gridSnap
                  ? '⊞ Gitter aus — Karten bewegen sich wieder frei.'
                  : '⊞ Gitter an — Karten rasten beim Verschieben am Raster ein.');
              }}
              title="Linien-Gitter anzeigen und Karten beim Verschieben am Raster einrasten lassen"
            >
              ⊞ Gitter &amp; Raster-Fang {gridSnap ? 'AUS' : 'AN'}
            </button>
            <div className="dock-menu-label">Board-Hintergrund</div>
            <div className="tab-bg-swatches">
              {([
                [undefined, 'Standard'], ['grau', 'Grau'], ['blau', 'Blau'], ['gelb', 'Gelb'],
                ['gruen', 'Grün'], ['rosa', 'Rosa'], ['flieder', 'Flieder'],
              ] as Array<[string | undefined, string]>).map(([key, label]) => (
                <button
                  key={label}
                  className={`tab-bg-swatch bg-${key ?? 'none'} ${activeBoardBg === key ? 'on' : ''}`}
                  title={label}
                  aria-label={`Hintergrund ${label}`}
                  onClick={() => setBoardBg(activeBoardId, key)}
                />
              ))}
            </div>
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
      {archivedCount > 0 && (
        <button
          onClick={() => {
            setShowArchived(!showArchived);
            showToast(showArchived
              ? '🗃 Archiv ausgeblendet — archivierte Karten sind wieder unsichtbar.'
              : `🗃 Archiv eingeblendet — ${archivedCount} archivierte Karte${archivedCount > 1 ? 'n' : ''} (gedimmt). Zum Zurückholen Karte auswählen → Archiv-Symbol.`);
          }}
          className={showArchived ? 'active' : ''}
          title={showArchived
            ? `Archivierte Karten ausblenden (${archivedCount} auf diesem Board)`
            : `Archivierte Karten einblenden (${archivedCount} auf diesem Board)`}
          aria-label="Archiv ein-/ausblenden"
        >
          <IArchive />
          <span className="dock-badge">{archivedCount}</span>
        </button>
      )}
      <span className="dock-sep" />
      <button className="dock-tasks" onClick={() => setTasksOpen(true)} title="Aufgaben & Erinnerungen (alle Boards)" aria-label="Aufgaben">
        <ITasks />
        {taskStats.open > 0 && (
          <span className={`dock-badge ${taskStats.overdue > 0 ? 'red' : ''}`}>{taskStats.open}</span>
        )}
      </button>
      <button onClick={() => setPresenting(true)} title="Präsentationsmodus (Karten als Folien)" aria-label="Präsentieren"><IPlay /></button>

    </div>
  );
}
