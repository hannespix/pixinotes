import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { frameMembers } from '../lib/arrange';
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
import { FrameCard } from './nodes/FrameCard';
import { WeekCard } from './nodes/WeekCard';
import { TimeCard } from './nodes/TimeCard';
import { EdgeMarkerDefs, LabeledEdge } from './LabeledEdge';
import { DrawingLayer } from './DrawingLayer';
import { CommentLayer } from './CommentLayer';
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
  frame: FrameCard,
  week: WeekCard,
  time: TimeCard,
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

  const { screenToFlowPosition, setCenter, fitView, getViewport, setViewport } = useReactFlow();
  const wheelZoom = useBoard((s) => s.wheelZoom);

  // ---------- Zoom-Durchgriff ÜBER Modulen (M123) ----------
  // Karteninhalte (Notiz-Editor, Kanban, Diagramm …) tragen nowheel/eigene
  // Scroller — Strg+Rad, Trackpad-Pinch (= Rad mit ctrlKey) und der
  // Zwei-Finger-Pinch sollen trotzdem IMMER das Board zoomen. Normales
  // Scrollen im Modul bleibt unangetastet. Native Listener (non-passive),
  // weil React Wheel/Touch am Root passiv registriert.
  const zoomWrapRef = useRef<HTMLDivElement | null>(null);
  const wheelZoomRef = useRef(wheelZoom);
  wheelZoomRef.current = wheelZoom;
  const pinchRef = useRef<{ dist: number; zoom: number; fx: number; fy: number } | null>(null);
  // Ein-Finger-Panning über Modulen (M125): Drag aus „toten" nodrag-Zonen
  // der Karten schwenkt das Board; pending bis der 8-px-Schwellwert fällt
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number; zoom: number; active: boolean; el: Element } | null>(null);
  useEffect(() => {
    const wrap = zoomWrapRef.current;
    if (!wrap) return;
    const clampZoom = (z: number) => Math.max(0.15, Math.min(2.5, z));
    const zoomAt = (clientX: number, clientY: number, newZoom: number, fx?: number, fy?: number) => {
      const rect = wrap.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const { x, y, zoom } = getViewport();
      const flowX = fx ?? (px - x) / zoom;
      const flowY = fy ?? (py - y) / zoom;
      void setViewport({ x: px - flowX * newZoom, y: py - flowY * newZoom, zoom: newZoom });
      return { flowX, flowY };
    };
    // M143: Solange ein Menü/Popup offen ist und der Zeiger darüber steht,
    // pausieren ALLE Board-Gesten (Rad-Zoom, Pinch, Finger-Pan) — im Menü
    // wird ganz normal gescrollt und navigiert.
    const OVERLAY_SEL = '.bn-suggestion-menu, .bn-side-menu, .mantine-Menu-dropdown, .mantine-Popover-dropdown, '
      + '[role="menu"], [role="listbox"], [role="dialog"], .modal-backdrop, .ticket-modal-backdrop, '
      + '.dock-menu, .sel-ai-menu, .sel-attr-menu, .tab-tree, .tab-bg-menu, .mm-pop, .draw-palette, .comment-panel, .frame-menu, .week-pop';
    const inOverlay = (t: Element | null) => !!t?.closest?.(OVERLAY_SEL);
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (inOverlay(target)) return; // Menü offen → Menü scrollt, Board bleibt ruhig
      const inNode = target?.closest?.('.react-flow__node');
      if (!inNode) return; // auf der Fläche macht React Flow das selbst
      if (!e.ctrlKey && !wheelZoomRef.current) return; // Modul-Scroll bleibt
      e.preventDefault();
      e.stopPropagation();
      const factor = Math.pow(2, -e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      zoomAt(e.clientX, e.clientY, clampZoom(getViewport().zoom * factor));
    };
    // M143: Klicks im Slash-Menü (z. B. auf dessen Scrollleiste) dürfen weder
    // dem Editor den Fokus klauen noch BlockNotes „außerhalb geklickt"-
    // Schließer erreichen — sonst verschwindet das Menü. window-CAPTURE läuft
    // vor allen document-Listenern von BlockNote/Mantine.
    const onMenuPointerDown = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('.bn-suggestion-menu')) {
        e.stopPropagation();
        // Fokus-Klau nur beim mousedown unterbinden — preventDefault auf
        // pointerdown würde auch die Klick-Erzeugung abwürgen
        if (e.type === 'mousedown') e.preventDefault();
      }
    };
    const touchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const touchMid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    /** Kann irgendein Container zwischen Ziel und Karte in Zugrichtung scrollen? */
    const canScrollTowards = (from: Element, stopAt: Element, dx: number, dy: number): boolean => {
      const vertical = Math.abs(dy) >= Math.abs(dx);
      let cur: Element | null = from;
      while (cur && cur !== stopAt) {
        const st = getComputedStyle(cur);
        if (vertical && /auto|scroll/.test(st.overflowY) && cur.scrollHeight > cur.clientHeight + 4) {
          if ((dy < 0 && cur.scrollTop + cur.clientHeight < cur.scrollHeight - 1) || (dy > 0 && cur.scrollTop > 0)) return true;
        }
        if (!vertical && /auto|scroll/.test(st.overflowX) && cur.scrollWidth > cur.clientWidth + 4) {
          if ((dx < 0 && cur.scrollLeft + cur.clientWidth < cur.scrollWidth - 1) || (dx > 0 && cur.scrollLeft > 0)) return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (inOverlay(target)) { panRef.current = null; return; } // Menü offen → keine Board-Gesten
      const node = target?.closest?.('.react-flow__node');
      if (e.touches.length === 2) {
        panRef.current = null; // zweiter Finger: Pinch übernimmt
        if (!node) return; // Pinch auf der Fläche gehört React Flow
        e.preventDefault(); // Modul-Scroll/Textauswahl nicht starten lassen
        const mid = touchMid(e.touches);
        const rect = wrap.getBoundingClientRect();
        const { x, y, zoom } = getViewport();
        pinchRef.current = {
          dist: touchDist(e.touches),
          zoom,
          fx: (mid.x - rect.left - x) / zoom,
          fy: (mid.y - rect.top - y) / zoom,
        };
        return;
      }
      if (e.touches.length !== 1 || !node || !target) return;
      // Panning-Kandidat (M125): nur aus nodrag-Zonen (dort verschiebt React
      // Flow NICHT die Karte) und nie aus interaktiven Elementen heraus
      if (!target.closest('.nodrag')) return;
      if (target.closest('input, textarea, select, button, a, [contenteditable="true"], .react-flow__handle, .react-flow__resize-control')) return;
      const t = e.touches[0];
      const { x, y, zoom } = getViewport();
      panRef.current = { x: t.clientX, y: t.clientY, vx: x, vy: y, zoom, active: false, el: target };
    };
    const onTouchMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (p && e.touches.length === 2) {
        e.preventDefault();
        e.stopPropagation();
        const mid = touchMid(e.touches);
        const newZoom = clampZoom(p.zoom * (touchDist(e.touches) / p.dist));
        zoomAt(mid.x, mid.y, newZoom, p.fx, p.fy);
        return;
      }
      const pan = panRef.current;
      if (!pan || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - pan.x;
      const dy = t.clientY - pan.y;
      if (!pan.active) {
        if (Math.hypot(dx, dy) < 8) return; // Tipp bleibt Tipp
        // Kann der Modul-Inhalt selbst in diese Richtung scrollen? Dann darf er.
        const node = pan.el.closest('.react-flow__node');
        if (node && canScrollTowards(pan.el, node, dx, dy)) { panRef.current = null; return; }
        pan.active = true;
      }
      e.preventDefault();
      e.stopPropagation();
      void setViewport({ x: pan.vx + dx, y: pan.vy + dy, zoom: pan.zoom });
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length === 0) panRef.current = null;
    };
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointerdown', onMenuPointerDown, true);
    window.addEventListener('mousedown', onMenuPointerDown, true);
    window.addEventListener('touchstart', onMenuPointerDown, true);
    wrap.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    wrap.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    wrap.addEventListener('touchend', onTouchEnd, true);
    wrap.addEventListener('touchcancel', onTouchEnd, true);
    return () => {
      wrap.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener('pointerdown', onMenuPointerDown, true);
      window.removeEventListener('mousedown', onMenuPointerDown, true);
      window.removeEventListener('touchstart', onMenuPointerDown, true);
      wrap.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchmove', onTouchMove, { capture: true } as EventListenerOptions);
      wrap.removeEventListener('touchend', onTouchEnd, true);
      wrap.removeEventListener('touchcancel', onTouchEnd, true);
    };
  }, [getViewport, setViewport]);
  const pendingFocus = useBoard((s) => s.pendingFocus);
  const clearPendingFocus = useBoard((s) => s.clearPendingFocus);

  // Board-Optionen (M88): Hintergrund-Tönung + Gitter/Raster-Fang
  const boardBg = useBoard((s) => selectActiveBoard(s).bg);
  const gridSnap = useBoard((s) => s.gridSnap);

  // Archiv (M87): archivierte Karten sind ausgeblendet (React-Flow `hidden`),
  // bei aktivem Archiv-Schalter gedimmt sichtbar. Anhängende Kanten wandern mit.
  const showArchived = useBoard((s) => s.showArchived);
  const rfNodes = useMemo(
    () => nodes.map((n) => (n.archived ? { ...n, hidden: !showArchived, className: 'archived-card' } : n)),
    [nodes, showArchived],
  );
  const rfEdges = useMemo(() => {
    const arch = new Set(nodes.filter((n) => n.archived).map((n) => n.id));
    if (arch.size === 0) return edges;
    return edges.map((e) =>
      arch.has(e.source) || arch.has(e.target)
        ? { ...e, hidden: !showArchived, className: 'archived-edge' }
        : e,
    );
  }, [nodes, edges, showArchived]);

  // Suche: nach Board-Wechsel zur gefundenen Karte fliegen und sie markieren
  useEffect(() => {
    if (!pendingFocus || pendingFocus.boardId !== activeId) return;
    const node = nodes.find((n) => n.id === pendingFocus.nodeId);
    if (!node) { clearPendingFocus(); return; }
    // Treffer liegt im (ausgeblendeten) Archiv → Archiv einblenden, sonst
    // fliegt die Suche ins Leere
    if (node.archived && !useBoard.getState().showArchived) {
      useBoard.getState().setShowArchived(true);
      useBoard.getState().showToast('🗃 Der Treffer liegt im Archiv — archivierte Karten sind jetzt eingeblendet.');
    }
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
      // F = Auswahl formatfüllend einpassen (Figma-Gewohnheit); ohne Auswahl: alles
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const selected = selectActiveBoard(st).nodes.filter((n) => n.selected);
        void fitView({
          nodes: selected.length ? selected.map((n) => ({ id: n.id })) : undefined,
          padding: selected.length ? 0.3 : 0.15,
          duration: 400,
          maxZoom: 1.2,
        });
        return;
      }
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      addNode(makeNote(screenToFlowPosition({ x: window.innerWidth / 2 - 130, y: window.innerHeight / 2 - 40 })));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode, screenToFlowPosition, fitView]);

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
    // Physik-Schalter (Dock-Magnet): aus = Karten dürfen überlappen/stapeln
    if (!useBoard.getState().physicsEnabled) return;
    const mr = nodeRect(mover);
    for (const other of all) {
      if (other.id === mover.id || dragTrack.current?.id === other.id) continue;
      if ((other as AppNode).archived) continue; // Archivierte stehen still (meist unsichtbar)
      if (other.type === 'frame') continue; // Rahmen sind Hintergrund — keine Verdrängung (M149)
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

  // Frame-Mitzug (M149): Beim Greifen eines Rahmens werden alle Karten
  // eingesammelt, deren MITTELPUNKT im Rahmen liegt — sie folgen dem Rahmen
  // dann live mit jedem Drag-Delta (eine History-Stufe, keine Physik).
  const frameDrag = useRef<{ id: string; ids: string[]; x: number; y: number } | null>(null);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    if (node.type === 'frame') {
      const all = selectActiveBoard(useBoard.getState()).nodes;
      // Mitglieder inkl. verschachtelter (kleinerer) Rahmen — deren Karten
      // liegen ohnehin im äußeren Rahmen und bewegen sich genau EINMAL (M150)
      const ids = frameMembers(node as AppNode, all, true).map((n) => n.id);
      frameDrag.current = { id: node.id, ids, x: node.position.x, y: node.position.y };
      useBoard.getState().pushHistory();
      return;
    }
    vels.current.delete(node.id); // gegriffene Karte gehorcht der Maus, nicht der Physik
    dragTrack.current = { id: node.id, x: node.position.x, y: node.position.y, t: performance.now(), vx: 0, vy: 0 };
  }, []);

  // Klick-Zoom (optional, ⚙ → Design → Bedienung): fliegt NUR, wenn die Karte
  // klein oder angeschnitten ist — wer schon nah dran arbeitet, wird nicht
  // herumgeworfen. Drags lösen kein Click-Event aus (React Flow unterdrückt das).
  // Leertaste halten + ziehen = Pannen, auch ÜBER Karten (Photoshop-Gewohnheit).
  // React Flow startet den Flächen-Pan nur auf der Fläche selbst — deshalb werden
  // Karten während gehaltener Leertaste durchklick-transparent (CSS .space-pan).
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault(); // Seite darf nicht scrollen
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false); };
    const reset = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // Esc fliegt nach einem Klick-Zoom zur vorherigen Position zurück — aber nur,
  // solange man die Ansicht nicht selbst weiterbewegt hat
  const returnViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const flyingUntil = useRef(0);

  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    if (!useBoard.getState().clickZoom || e.shiftKey) return; // Shift = Mehrfachauswahl
    const { x, y, zoom } = getViewport();
    const w = (node.measured?.width ?? 260) * zoom;
    const h = (node.measured?.height ?? 160) * zoom;
    const sx = node.position.x * zoom + x;
    const sy = node.position.y * zoom + y;
    const fullyVisible = sx >= 8 && sy >= 64 && sx + w <= window.innerWidth - 8 && sy + h <= window.innerHeight - 76;
    if (fullyVisible && zoom >= 0.65) return; // gut lesbar im Blick → nicht springen
    returnViewport.current = { x, y, zoom };
    flyingUntil.current = performance.now() + 700;
    void fitView({ nodes: [{ id: node.id }], padding: 0.35, duration: 450, maxZoom: 1.05 });
  }, [fitView, getViewport]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !returnViewport.current) return;
      const st = useBoard.getState();
      // Overlays haben Vorrang (deren Esc schließt sie) — und nur im Auswahl-Werkzeug
      if (st.searchOpen || st.settingsOpen || st.helpOpen || st.tasksOpen || st.presenting || st.tool !== 'select') return;
      // Der Klick-Zoom fokussiert meist den Karten-Editor — Esc darf trotzdem
      // zurückfliegen (der Anker existiert nur direkt nach dem Flug und ist
      // einmalig). Nur ein offenes Slash-Menü hat Vorrang.
      if (document.querySelector('.bn-suggestion-menu')) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const prev = returnViewport.current;
      returnViewport.current = null;
      flyingUntil.current = performance.now() + 700;
      void setViewport(prev, { duration: 400 });
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [setViewport]);

  // Angefasst = dauerhaft nach vorn: Capture-Listener statt onNodeClick, damit
  // auch Klicks in Editor/nodrag-Bereiche zählen (die erreichen onNodeClick nicht)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.react-flow__node');
      const id = el?.getAttribute('data-id');
      if (id) useBoard.getState().touchNode(id);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    if (node.type === 'frame') {
      const fd = frameDrag.current;
      if (fd && fd.id === node.id) {
        const dx = node.position.x - fd.x;
        const dy = node.position.y - fd.y;
        fd.x = node.position.x;
        fd.y = node.position.y;
        if ((dx || dy) && fd.ids.length > 0) {
          const st = useBoard.getState();
          const moves = selectActiveBoard(st).nodes
            .filter((n) => fd.ids.includes(n.id))
            .map((n) => [n.id, n.position.x + dx, n.position.y + dy] as [string, number, number]);
          mutedHistory(() => st.setNodePositions(moves)); // eine History-Stufe: der pushHistory vom Drag-Start
        }
      }
      return; // Rahmen kennen weder Physik noch Neigung
    }
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
      if (node.type === 'frame') { frameDrag.current = null; return; }
      const track = dragTrack.current;
      setTilt(node.id, 0);
      if (!track || track.id !== node.id) return;
      const { vx, vy } = track;
      dragTrack.current = null;
      if (Math.hypot(vx, vy) >= MIN_SPEED * 2 && useBoard.getState().physicsEnabled) {
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
      // Kanban-Ticket-Drags (M119) gehören den Spalten — hier ignorieren,
      // sonst würde aus dem Ticket-Text eine Notiz-Karte erzeugt
      if (e.dataTransfer.types.includes('application/x-pixinotes-ticket')) return;
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

  // ---------- Strg+V: Screenshots & Bilder direkt aufs Board ----------
  // Globaler Listener statt onPaste am Wrapper: Paste-Events landen beim
  // FOKUSSIERTEN Element — nach einem Klick auf Dock/Canvas liegt der Fokus
  // oft auf <body>, dort kam das React-Event nie an (User-Report).
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // Nicht eingreifen, wenn in einem Editor/Input eingefügt wird
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.note-editor, input, textarea, [contenteditable="true"]')) return;
      // Offene Overlays (Suche, Einstellungen, Aufgaben, Hilfe, Präsentation) nicht unterlaufen
      const st = useBoard.getState();
      if (st.searchOpen || st.settingsOpen || st.tasksOpen || st.helpOpen || st.presenting) return;

      const dt = e.clipboardData;
      if (!dt) return;
      // Manche Quellen (Snipping Tool, Explorer-Kopie) liefern nur `files`,
      // andere (Browser-„Bild kopieren") nur `items` — beide abklappern
      let files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) {
        files = Array.from(dt.items ?? [])
          .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
          .map((it) => it.getAsFile())
          .filter((f): f is File => !!f);
      }
      if (files.length === 0) return;
      e.preventDefault();

      let placed = 0;
      for (const file of files) {
        try {
          const src = await imageFileToDataUrl(file);
          if (!canEmbed(src.length)) {
            showToast('⚠️ Speicher fast voll — Bild nicht eingebettet. Exportiere in den Datenordner (⚙️).');
            break;
          }
          const pos = screenToFlowPosition({
            x: window.innerWidth / 2 - 130 + placed * 34,
            y: window.innerHeight / 2 - 90 + placed * 34,
          });
          addNode(makeImage(pos, src, file.name && file.name !== 'image.png' ? file.name : 'Screenshot'));
          placed++;
        } catch (err) {
          console.error('Einfügen fehlgeschlagen:', err);
          showToast('⚠️ Bild aus der Zwischenablage konnte nicht gelesen werden');
        }
      }
      if (placed > 0) showToast(placed === 1 ? '🖼️ Screenshot eingefügt' : `🖼️ ${placed} Bilder eingefügt`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addNode, screenToFlowPosition, showToast]);

  return (
    <div
      ref={zoomWrapRef}
      className={`board-wrap ${spaceHeld ? 'space-pan' : ''} ${boardBg ? `board-bg-${boardBg}` : ''}`}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onDoubleClick={handleDoubleClick}
      onTouchEnd={handleTouchEnd}
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
        nodes={rfNodes}
        edges={rfEdges}
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
        onNodeClick={onNodeClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={42}
        connectionLineStyle={{ stroke: '#4f7cff', strokeWidth: 2.5 }}
        panOnScroll={!wheelZoom}
        snapToGrid={gridSnap}
        snapGrid={[20, 20]}
        zoomOnScroll={wheelZoom}
        panActivationKeyCode="Space"
        onMoveEnd={() => { if (performance.now() > flyingUntil.current) returnViewport.current = null; }}
        zoomOnDoubleClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Meta', 'Shift']}
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
        <Background
          variant={gridSnap ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={gridSnap ? 20 : 26}
          size={1.6}
          lineWidth={0.6}
          color={document.documentElement.dataset.theme === 'dark' ? '#4b453c' : '#d8d3c8'}
        />
        <MiniMap
          pannable zoomable className="pn-minimap"
          onClick={(_, pos) => { void setCenter(pos.x, pos.y, { duration: 350, zoom: getViewport().zoom }); }}
        />
        <Controls showInteractive={false} />
        <SelectionToolbar />
        <DrawingLayer />
        <CommentLayer />
      </ReactFlow>
    </div>
  );
}


