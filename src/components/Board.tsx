import { useCallback, useEffect, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { uid, type StickyColor } from '../types';
import { guessMime, parseEml, parseMsg } from '../lib/parseEmail';
import { imageFileToDataUrl } from '../lib/image';
import { NoteCard } from './nodes/NoteCard';
import { EmailCard } from './nodes/EmailCard';
import { ImageCard } from './nodes/ImageCard';
import { FileCard } from './nodes/FileCard';
import { KanbanCard } from './nodes/KanbanCard';
import { PortalCard } from './nodes/PortalCard';
import { SelectionToolbar } from './SelectionToolbar';

const nodeTypes: NodeTypes = {
  note: NoteCard,
  email: EmailCard,
  image: ImageCard,
  file: FileCard,
  kanban: KanbanCard,
  portal: PortalCard,
};

const STICKY_ROTATION: StickyColor[] = ['yellow', 'pink', 'mint', 'sky'];
let colorIdx = 0;
const nextColor = () => STICKY_ROTATION[colorIdx++ % STICKY_ROTATION.length];

/** Physik: Reibung pro Frame für den „Wurf" nach dem Loslassen */
const FRICTION = 0.93;
const MIN_SPEED = 0.6;

export function Board() {
  const activeId = useBoard((s) => s.activeId);
  const nodes = useBoard((s) => selectActiveBoard(s).nodes);
  const edges = useBoard((s) => selectActiveBoard(s).edges);
  const onNodesChange = useBoard((s) => s.onNodesChange);
  const onEdgesChange = useBoard((s) => s.onEdgesChange);
  const onConnect = useBoard((s) => s.onConnect);
  const addNode = useBoard((s) => s.addNode);
  const setNodePosition = useBoard((s) => s.setNodePosition);
  const removeNodes = useBoard((s) => s.removeNodes);
  const showToast = useBoard((s) => s.showToast);

  const { screenToFlowPosition, setCenter } = useReactFlow();
  const pendingFocus = useBoard((s) => s.pendingFocus);
  const clearPendingFocus = useBoard((s) => s.clearPendingFocus);
  const onNodesChangeStore = onNodesChange;

  // Suche: nach Board-Wechsel zur gefundenen Karte fliegen und sie markieren
  useEffect(() => {
    if (!pendingFocus || pendingFocus.boardId !== activeId) return;
    const node = nodes.find((n) => n.id === pendingFocus.nodeId);
    if (!node) { clearPendingFocus(); return; }
    const t = setTimeout(() => {
      const w = node.measured?.width ?? 280;
      const h = node.measured?.height ?? 120;
      setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 650 });
      onNodesChangeStore(
        nodes.map((n) => ({ id: n.id, type: 'select' as const, selected: n.id === node.id })),
      );
      clearPendingFocus();
    }, 80);
    return () => clearTimeout(t);
  }, [pendingFocus, activeId, nodes, setCenter, clearPendingFocus, onNodesChangeStore]);

  // Tastatur: N = neue Notiz in Bildschirmmitte (außerhalb von Eingabefeldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      addNode({
        id: uid(),
        type: 'note',
        width: 270,
        position: screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 40 }),
        data: { color: nextColor(), blocks: [] },
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode, screenToFlowPosition]);

  // ---------- Wurf-Physik (Momentum nach dem Loslassen) ----------
  const dragTrack = useRef<{ id: string; x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const animRef = useRef<number>(0);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    cancelAnimationFrame(animRef.current);
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
  }, []);

  // Physik-Loop beim Unmount stoppen (M4)
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const track = dragTrack.current;
      if (!track || track.id !== node.id) return;
      let { vx, vy } = track;
      let { x, y } = node.position;
      dragTrack.current = null;
      if (Math.hypot(vx, vy) < MIN_SPEED * 2) return;

      const startBoard = useBoard.getState().activeId;
      const step = () => {
        // Board gewechselt? Dann den Wurf nicht aufs falsche Board schreiben (M4)
        if (useBoard.getState().activeId !== startBoard) return;
        vx *= FRICTION;
        vy *= FRICTION;
        x += vx;
        y += vy;
        setNodePosition(node.id, x, y);
        if (Math.hypot(vx, vy) > MIN_SPEED) {
          animRef.current = requestAnimationFrame(step);
        }
      };
      animRef.current = requestAnimationFrame(step);
    },
    [setNodePosition],
  );

  // ---------- Karten erstellen ----------
  const addNote = useCallback(
    (pos: { x: number; y: number }) => {
      addNode({ id: uid(), type: 'note', width: 270, position: pos, data: { color: nextColor(), blocks: [] } });
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
          addNode({
            id: uid(),
            type: 'note',
            width: 270,
            position: basePos,
            data: { color: nextColor(), blocks: [{ type: 'paragraph', content: text }] },
          });
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
          if (ext === 'eml' || file.type === 'message/rfc822') {
            const email = await parseEml(await file.arrayBuffer());
            addNode({ id: uid(), type: 'email', width: 320, position: pos, data: email });
            showToast(`📧 „${email.subject}" importiert — ${email.attachments.length} Anhänge als Chips`);
          } else if (ext === 'msg') {
            const email = await parseMsg(await file.arrayBuffer());
            addNode({ id: uid(), type: 'email', width: 320, position: pos, data: email });
            showToast(`📧 Outlook-Mail „${email.subject}" importiert`);
          } else if (file.type.startsWith('image/')) {
            const src = await imageFileToDataUrl(file);
            addNode({ id: uid(), type: 'image', width: 260, position: pos, data: { src, name: file.name } });
          } else {
            const dataUrl = file.size <= 1_500_000 ? await fileToDataUrl(file) : undefined;
            addNode({
              id: uid(),
              type: 'file',
              width: 240,
              position: pos,
              data: { name: file.name, size: file.size, mime: file.type || guessMime(file.name), dataUrl },
            });
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
        const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 90 });
        addNode({ id: uid(), type: 'image', width: 260, position: pos, data: { src, name: 'Screenshot' } });
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
      {nodes.length === 0 && (
        <div className="empty-board-hint">
          <div>📝 Doppelklick (oder N) = neue Notiz</div>
          <div>📧 E-Mails (.eml/.msg) &amp; Dateien hierher ziehen</div>
          <div>🖼️ Strg+V fügt Screenshots ein</div>
        </div>
      )}
      <ReactFlow
        key={activeId}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color="#d8d3c8" />
        <MiniMap pannable zoomable className="pn-minimap" />
        <Controls showInteractive={false} />
        <SelectionToolbar />
      </ReactFlow>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
