import { useCallback, useEffect, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { computePush } from '../lib/physics';
import { guessMime, MAX_EMBED_BYTES, parseEml, parseMsg } from '../lib/parseEmail';
import { imageFileToDataUrl, readFileAsDataUrl } from '../lib/image';
import { canEmbed, makeCalendar, makeEmail, makeFile, makeImage, makeNote } from '../lib/nodes';
import { cloneSharedBoard, parseBoardPayload } from '../lib/share';
import { mergeEvents, parseIcs, type IcsEvent } from '../lib/ics';
import type { AppNode } from '../types';
import { NoteCard } from './nodes/NoteCard';
import { EmailCard } from './nodes/EmailCard';
import { ImageCard } from './nodes/ImageCard';
import { FileCard } from './nodes/FileCard';
import { KanbanCard } from './nodes/KanbanCard';
import { PortalCard } from './nodes/PortalCard';
import { ShapeCard } from './nodes/ShapeCard';
import { MermaidCard } from './nodes/MermaidCard';
import { GanttCard } from './nodes/GanttCard';
import { CalendarCard } from './nodes/CalendarCard';
import { EdgeMarkerDefs, LabeledEdge } from './LabeledEdge';
import { DrawingLayer } from './DrawingLayer';
import { SelectionToolbar } from './SelectionToolbar';

const nodeTypes: NodeTypes = {
  note: NoteCard,
  email: EmailCard,
  image: ImageCard,
  file: FileCard,
  kanban: KanbanCard,
  portal: PortalCard,
  shape: ShapeCard,
  mermaid: MermaidCard,
  gantt: GanttCard,
  calendar: CalendarCard,
};

const edgeTypes: EdgeTypes = { labeled: LabeledEdge };

/** Physik: Reibung pro Frame für Wurf & Verdrängung */
const FRICTION = 0.9;
const MIN_SPEED = 0.5;
/** Wie kräftig eingedrungene Karten pro Frame hinausfedern (0..1) */
const PUSH_SPRING = 0.32;
/** Wunschabstand zwischen Karten beim Verdrängen */
const PUSH_GAP = 12;
/** Geschwindigkeits-Deckel für weggeschobene Karten */
const PUSH_MAX = 22;

export function Board() {
  const activeId = useBoard((s) => s.activeId);
  const importEpoch = useBoard((s) => s.importEpoch);
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const edges = useBoard((s) => selectActiveBoard(s).edges);
  const onNodesChange = useBoard((s) => s.onNodesChange);
  const onEdgesChange = useBoard((s) => s.onEdgesChange);
  const onConnect = useBoard((s) => s.onConnect);
  const addNode = useBoard((s) => s.addNode);
  const removeNodes = useBoard((s) => s.removeNodes);
  const showToast = useBoard((s) => s.showToast);

  const { screenToFlowPosition, setCenter } = useReactFlow();
  const pendingFocus = useBoard((s) => s.pendingFocus);
  const clearPendingFocus = useBoard((s) => s.clearPendingFocus);

  // Suche: nach Board-Wechsel zur gefundenen Karte fliegen und sie markieren
  useEffect(() => {
    if (!pendingFocus || pendingFocus.boardId !== activeId) return;
    const node = nodes.find((n) => n.id === pendingFocus.nodeId);
    if (!node) { clearPendingFocus(); return; }
    const t = setTimeout(() => {
      const w = node.measured?.width ?? 280;
      const h = node.measured?.height ?? 120;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 650 });
      onNodesChange(
        nodes.map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === node.id })),
      );
      clearPendingFocus();
    }, 80);
    return () => clearTimeout(t);
  }, [pendingFocus, activeId, nodes, setCenter, clearPendingFocus, onNodesChange]);

  // Tastatur: N = neue Notiz; Strg+Z/Strg+Y = Undo/Redo (außerhalb von Eingabefeldern —
  // in Editoren gilt deren eigenes Undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      const st = useBoard.getState();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo(); else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      addNode(makeNote(screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 40 })));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode, screenToFlowPosition]);

  // ---------- Physik-Engine: Wurf-Momentum + Verdrängung (FigJam-Gefühl) ----------
  // Ein gemeinsamer Loop integriert alle Geschwindigkeiten: geworfene Karten
  // gleiten aus, überlappte Nachbarn federn beiseite — inkl. Kettenreaktion.
  const dragTrack = useRef<{ id: string; x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const animRef = useRef<number>(0);
  const vels = useRef(new Map<string, { vx: number; vy: number }>());
  const physicsOn = useRef(false);

  const nodeRect = (n: Node) => ({
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? 260,
    h: n.measured?.height ?? 120,
  });

  /** `mover` drückt alle überlappten Nachbarn federnd weg (Impuls sammeln) */
  const pushNeighbors = useCallback((mover: Node, all: Node[], strength: number) => {
    const mr = nodeRect(mover);
    for (const other of all) {
      if (other.id === mover.id || dragTrack.current?.id === other.id) continue;
      const push = computePush(mr, nodeRect(other), PUSH_GAP);
      if (!push) continue;
      const v = vels.current.get(other.id) ?? { vx: 0, vy: 0 };
      v.vx += push[0] * strength;
      v.vy += push[1] * strength;
      const speed = Math.hypot(v.vx, v.vy);
      if (speed > PUSH_MAX) {
        v.vx *= PUSH_MAX / speed;
        v.vy *= PUSH_MAX / speed;
      }
      vels.current.set(other.id, v);
    }
  }, []);

  const startPhysics = useCallback(() => {
    if (physicsOn.current) return;
    physicsOn.current = true;
    const startBoard = useBoard.getState().activeId;
    const tick = () => {
      // Board gewechselt? Physik nicht aufs falsche Board schreiben (M4)
      if (useBoard.getState().activeId !== startBoard) {
        physicsOn.current = false;
        vels.current.clear();
        return;
      }
      const st = useBoard.getState();
      const board = selectActiveBoard(st);
      const moves: Array<[string, number, number]> = [];
      for (const [id, v] of vels.current) {
        const n = board.nodes.find((nn) => nn.id === id);
        if (!n || dragTrack.current?.id === id) { vels.current.delete(id); continue; }
        v.vx *= FRICTION;
        v.vy *= FRICTION;
        if (Math.hypot(v.vx, v.vy) < MIN_SPEED) { vels.current.delete(id); continue; }
        moves.push([id, n.position.x + v.vx, n.position.y + v.vy]);
      }
      if (moves.length) {
        st.setNodePositions(moves);
        // Kettenreaktion: bewegte Karten verdrängen ihrerseits Nachbarn
        const fresh = selectActiveBoard(useBoard.getState()).nodes;
        for (const [id] of moves) {
          const mover = fresh.find((n) => n.id === id);
          if (mover) pushNeighbors(mover, fresh, PUSH_SPRING * 0.7);
        }
      }
      if (vels.current.size > 0) animRef.current = requestAnimationFrame(tick);
      else physicsOn.current = false;
    };
    animRef.current = requestAnimationFrame(tick);
  }, [pushNeighbors]);

  /** Neigungs-Effekt: gezogene Karte kippt leicht in Bewegungsrichtung */
  const setTilt = (id: string, deg: number) => {
    const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
    if (el) el.style.setProperty('--tilt', `${deg.toFixed(2)}deg`);
  };

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    vels.current.delete(node.id); // gegriffene Karte gehorcht der Maus, nicht der Physik
    dragTrack.current = { id: node.id, x: node.position.x, y: node.position.y, t: performance.now(), vx: 0, vy: 0 };
  }, []);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const track = dragTrack.current;
    if (!track || track.id !== node.id) return;
    const now = performance.now();
    const dt = Math.max(1, now - track.t);
    // Geschwindigkeit in Flow-Einheiten pro Frame (~16 ms), leicht geglättet
    track.vx = 0.6 * track.vx + 0.4 * ((node.position.x - track.x) / dt) * 16;
    track.vy = 0.6 * track.vy + 0.4 * ((node.position.y - track.y) / dt) * 16;
    track.x = node.position.x;
    track.y = node.position.y;
    track.t = now;
    // Fancy: Karte neigt sich mit der Bewegung
    setTilt(node.id, Math.max(-5, Math.min(5, track.vx * 0.45)));
    // Verdrängung: alles, was unter der Karte liegt, federt beiseite
    pushNeighbors(node, selectActiveBoard(useBoard.getState()).nodes, PUSH_SPRING);
    if (vels.current.size > 0) startPhysics();
  }, [pushNeighbors, startPhysics]);

  // Physik-Loop beim Unmount stoppen (M4)
  useEffect(() => () => { cancelAnimationFrame(animRef.current); physicsOn.current = false; }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const track = dragTrack.current;
      setTilt(node.id, 0);
      if (!track || track.id !== node.id) return;
      const { vx, vy } = track;
      dragTrack.current = null;
      if (Math.hypot(vx, vy) >= MIN_SPEED * 2) {
        // Wurf: Karte gleitet mit Momentum weiter (und räumt sich den Weg frei)
        vels.current.set(node.id, { vx, vy });
      }
      if (vels.current.size > 0) startPhysics();
    },
    [startPhysics],
  );

  // ---------- Karten erstellen ----------
  const addNote = useCallback(
    (pos: { x: number; y: number }) => {
      addNode(makeNote(pos));
    },
    [addNode],
  );

  const createNoteAt = useCallback(
    (clientX: number, clientY: number) => {
      addNote(screenToFlowPosition({ x: clientX - 130, y: clientY - 30 }));
      showToast('Notiz erstellt — lostippen! „/" öffnet das Block-Menü ✍️');
    },
    [addNote, screenToFlowPosition, showToast],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      createNoteAt(e.clientX, e.clientY);
    },
    [createNoteAt],
  );

  // Doppel-Tap auf Touch-Geräten (dblclick feuert dort nicht zuverlässig)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const now = performance.now();
      const prev = lastTap.current;
      lastTap.current = { x: touch.clientX, y: touch.clientY, t: now };
      if (prev && now - prev.t < 350 && Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 32) {
        lastTap.current = null;
        createNoteAt(touch.clientX, touch.clientY);
      }
    },
    [createNoteAt],
  );

  // ---------- Drag & Drop von Dateien (E-Mails! Bilder! Alles!) ----------
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const basePos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const files = Array.from(e.dataTransfer.files);

      if (files.length === 0) {
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
          addNode(makeNote(basePos, { blocks: [{ type: 'paragraph', content: text }] }));
          showToast('Text als Notiz abgelegt 📝');
        }
        return;
      }

      let offset = 0;
      for (const file of files) {
        const pos = { x: basePos.x + offset, y: basePos.y + offset };
        offset += 36;
        const ext = file.name.split('.').pop()?.toLowerCase();

        try {
          if (ext === 'ics') {
            // Outlook/Google/Apple-Kalender: Termine in die Kalender-Karte mergen
            const events = parseIcs(await file.text());
            if (events.length === 0) { showToast('Keine Termine in der .ics-Datei gefunden.'); continue; }
            const st = useBoard.getState();
            let cal: AppNode | undefined = selectActiveBoard(st).nodes.find((n) => n.type === 'calendar');
            if (!cal) { cal = makeCalendar(pos); st.addNode(cal); }
            const cur = (cal.data.icsEvents as IcsEvent[] | undefined) ?? [];
            st.updateNodeData(cal.id, { icsEvents: mergeEvents(cur, events) });
            showToast(`${events.length} Termin(e) in die Kalender-Karte importiert`);
            continue;
          }
          if (ext === 'json') {
            // Geteiltes Board (.pixiboard.json) oder Voll-Export per Drop importieren
            const text = await file.text();
            const shared = parseBoardPayload(text);
            if (shared) {
              useBoard.getState().importBoard(cloneSharedBoard(shared));
              showToast(`Geteiltes Board „${shared.name}" importiert`);
              continue;
            }
            const full = JSON.parse(text);
            if (full?.app === 'pixinotes' && Array.isArray(full.boards) && full.boards.length > 0) {
              if (window.confirm(`Kompletten Stand vom ${full.savedAt ? new Date(full.savedAt).toLocaleString('de-DE') : '?'} laden? Die aktuellen Boards werden ersetzt.`)) {
                useBoard.getState().importSync(full.boards, full.spaces ?? [], full.activeId ?? full.boards[0].id);
                showToast('Stand aus Datei geladen');
              }
              continue;
            }
            showToast('JSON erkannt, aber keine PixiNotes-Datei — als Datei-Karte abgelegt.');
          }
          if (ext === 'eml' || file.type === 'message/rfc822') {
            const email = await parseEml(await file.arrayBuffer());
            addNode(makeEmail(pos, email));
            showToast(`📧 „${email.subject}" importiert — ${email.attachments.length} Anhänge als Chips`);
          } else if (ext === 'msg') {
            const email = await parseMsg(await file.arrayBuffer());
            addNode(makeEmail(pos, email));
            showToast(`📧 Outlook-Mail „${email.subject}" importiert`);
          } else if (file.type.startsWith('image/')) {
            const src = await imageFileToDataUrl(file);
            if (!canEmbed(src.length)) { showToast('⚠️ Speicher fast voll — Bild nicht eingebettet. Exportiere in den Datenordner (⚙️).'); continue; }
            addNode(makeImage(pos, src, file.name));
          } else {
            let dataUrl = file.size <= MAX_EMBED_BYTES ? await readFileAsDataUrl(file) : undefined;
            if (dataUrl && !canEmbed(dataUrl.length)) {
              dataUrl = undefined;
              showToast('⚠️ Speicher fast voll — Datei nur als Verweis abgelegt. Exportiere in den Datenordner (⚙️).');
            }
            addNode(makeFile(pos, { name: file.name, size: file.size, mime: file.type || guessMime(file.name), dataUrl }));
          }
        } catch (err) {
          console.error('Import fehlgeschlagen:', err);
          showToast(`⚠️ „${file.name}" konnte nicht gelesen werden`);
        }
      }
    },
    [addNode, screenToFlowPosition, showToast],
  );

  // ---------- Strg+V: Screenshots direkt aufs Board ----------
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Nicht eingreifen, wenn in einem Editor/Input eingefügt wird
      const target = e.target as HTMLElement;
      if (target.closest('.note-editor, input, textarea, [contenteditable="true"]')) return;

      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find((it) => it.type.startsWith('image/'));
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (!file) return;
        const src = await imageFileToDataUrl(file);
        if (!canEmbed(src.length)) { showToast('⚠️ Speicher fast voll — Screenshot nicht eingebettet. Exportiere in den Datenordner (⚙️).'); return; }
        const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 90 });
        addNode(makeImage(pos, src, 'Screenshot'));
        showToast('🖼️ Screenshot eingefügt');
      }
    },
    [addNode, screenToFlowPosition, showToast],
  );

  return (
    <div
      className="board-wrap"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onDoubleClick={handleDoubleClick}
      onTouchEnd={handleTouchEnd}
      onPaste={handlePaste}
    >
      <EdgeMarkerDefs />
      {nodes.length === 0 && (
        <div className="empty-board-hint">
          <div>📝 Doppelklick (oder N) = neue Notiz</div>
          <div>📧 E-Mails (.eml/.msg) &amp; Dateien hierher ziehen</div>
          <div>🖼️ Strg+V fügt Screenshots ein</div>
        </div>
      )}
      <ReactFlow
        key={`${activeId}:${importEpoch}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={async ({ nodes: delNodes }) => {
          // Entf-Taste: durch removeNodes leiten, damit Undo auch die Kanten kennt (M1)
          if (delNodes.length === 0) return true;
          removeNodes(delNodes.map((n) => n.id));
          return false;
        }}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={42}
        connectionLineStyle={{ stroke: '#4f7cff', strokeWidth: 2.5 }}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        defaultEdgeOptions={{
          style: { stroke: 'rgba(90,80,60,.45)', strokeWidth: 2 },
          labelStyle: { fontSize: 11, fill: '#7a7263' },
          labelBgStyle: { fill: '#f2efe9', fillOpacity: 0.9 },
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color={document.documentElement.dataset.theme === 'dark' ? '#3d3931' : '#d8d3c8'} />
        <MiniMap pannable zoomable className="pn-minimap" />
        <Controls showInteractive={false} />
        <SelectionToolbar />
        <DrawingLayer />
      </ReactFlow>
    </div>
  );
}


