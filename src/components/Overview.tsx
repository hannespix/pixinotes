import { useEffect, useMemo, useRef, useState } from 'react';
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
import { boardMetaLabel } from '../lib/boardStats';
import { boardGraph, layoutGraph } from '../lib/links';
import { nodeToText } from '../lib/serialize';
import { InlineName } from './InlineName';
import { IPen, IPlay, ITarget, IX, IZoomIn, IZoomOut } from './Icons';
import { makePortal } from '../lib/nodes';

interface SpaceZoneData { space: Space; accent: string; [key: string]: unknown }
interface ProjectZoneData { project: Project; spaceId: string; [key: string]: unknown }
interface BoardTileData { board: BoardDoc; projectId: string; accent: string; [key: string]: unknown }

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
  // M193: Der Modus liegt im Store — so kann der Navigator aus JEDER Ansicht
  // direkt ins Netz springen, und die Wahl überlebt den Ansichtswechsel
  const mode = useBoard((s) => s.overviewMode);
  const setMode = useBoard((s) => s.setOverviewMode);
  return (
    <ReactFlowProvider>
      <div className="ov-mode nodrag">
        <button className={mode === 'hierarchie' ? 'on' : ''} onClick={() => setMode('hierarchie')}>Hierarchie</button>
        <button className={mode === 'netz' ? 'on' : ''} onClick={() => setMode('netz')} title="Board-Netz: Portale & [[Wikilinks]] als Graph">Netz</button>
      </div>
      {mode === 'netz' ? <GraphView /> : <OverviewCanvas />}
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

  // Nur bei ECHTER Strukturänderung remounten (fitView); nach einem reinen
  // Drag reicht die neue nodes-Referenz zum Zurückschnappen — Zoom bleibt (N2)
  const structureKey = `${spaces.length}|${spaces.reduce((a, s) => a + s.projects.length, 0)}|${boards.length}`;

  return (
    <div className="board-wrap ov-canvas">
      <ReactFlow
        key={structureKey /* nach Drag/Strukturänderung sauber neu einrasten + fitView */}
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
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.6} color={document.documentElement.dataset.theme === 'dark' ? '#4b453c' : '#d8d3c8'} />
      </ReactFlow>
      <button className="ov-add-space-float" onClick={() => addSpace()}>
        + Neuer Bereich
      </button>
    </div>
  );
}

/* ---------- Graph-Ansicht (Obsidian-Netz): Boards als Knoten, Portale & Wikilinks als Kanten ---------- */

const GRAPH_W = 1100, GRAPH_H = 640;
/** Höchstens so viele Karten-Punkte je Board (M193) — darüber wird der Ring
 *  zum Knäuel und die Board-Ebene unlesbar */
const MAX_SATELLITES = 14;

/**
 * Board-Netz. Zwei Einsatzorte (M194): als Vollbild-Ansicht in der Übersicht
 * und eingebettet in die Seitenleiste. `embedded` schaltet nur die Hülle um —
 * Logik, Gesten und Ebenen sind identisch, damit beide nicht auseinanderlaufen.
 */
export function GraphView({ embedded = false }: { embedded?: boolean }) {
  const boards = useBoard((s) => s.boards);
  /** Hover-Vorschau je Board — MEMOISIERT (M197): lief vorher pro Knoten und
   *  Physik-Frame über alle Karten (nodeToText) und ruckelte am iPhone */
  const previews = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boards) {
      const titles = b.nodes
        .map((n) => (nodeToText(n).split('\n').find((l) => l.trim()) ?? '').slice(0, 44))
        .filter(Boolean)
        .slice(0, 4);
      const more = b.nodes.length - titles.length;
      m.set(b.id, `${b.name} · ${b.nodes.length} Karten\n${titles.map((t) => `• ${t}`).join('\n')}${more > 0 ? `\n… und ${more} weitere` : ''}`);
    }
    return m;
  }, [boards]);
  const previewOf = (boardId: string): string => previews.get(boardId) ?? '';
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  // M193: Ebenen liegen im Store und bleiben erhalten — vorher fiel „Karten"
  // bei jedem Öffnen wieder auf „aus" zurück
  const layers = useBoard((s) => s.graphLayers);
  const setLayer = useBoard((s) => s.setGraphLayer);
  const { cards: showCards, portals: showPortals, wikis: showWikis, projectOnly } = layers;
  const activeId = useBoard((s) => s.activeId);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const spaces = useBoard((s) => s.spaces);
  const [q, setQ] = useState('');

  // M193: „Nur dieses Projekt" — bei vielen Boards ist der Gesamtgraph ein
  // Knäuel; das Projekt des aktiven Boards ist meist die gesuchte Umgebung
  const projectName = useMemo(() => {
    for (const sp of spaces) for (const p of sp.projects) if (p.boardIds.includes(activeId)) return `${sp.name} › ${p.name}`;
    return null;
  }, [spaces, activeId]);
  const scoped = useMemo(() => {
    if (!projectOnly) return boards;
    for (const sp of spaces) {
      for (const p of sp.projects) {
        if (p.boardIds.includes(activeId)) return boards.filter((b) => p.boardIds.includes(b.id));
      }
    }
    return boards;
  }, [projectOnly, boards, spaces, activeId]);

  const W = GRAPH_W, H = GRAPH_H;
  const { nodes, links, pos: seedPos } = useMemo(() => {
    const g = boardGraph(scoped);
    return { ...g, pos: layoutGraph(g.nodes, g.links, W, H) };
  }, [scoped]);

  // ---------- M195: Lebendige Physik (Obsidian-Gefühl) ----------
  // Kräfte: Abstoßung zwischen allen Boards, Federn entlang der Verbindungen,
  // sanfte Mitte-Gravitation — und CLUSTERUNG: Boards desselben Projekts
  // ziehen sich zu ihrem Schwerpunkt, so sortiert sich die Struktur von
  // selbst in Themen-Inseln. Läuft mit abklingender Energie (kein Dauerlauf,
  // schont den Akku) und heizt bei Drag/Datenänderung wieder auf.
  const physicsOn = layers.physik ?? true;
  const simPos = useRef(new Map<string, { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }>());
  const alpha = useRef(1);
  const [, setFrame] = useState(0);   // Render-Puls — Positionen leben im Ref
  const projectOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const sp of spaces) for (const p of sp.projects) for (const id of p.boardIds) m.set(id, p.id);
    return m;
  }, [spaces]);

  // Seed/Sync: neue Boards bekommen ihren Layout-Platz, verschwundene fliegen raus
  useEffect(() => {
    const m = simPos.current;
    for (const [id, p] of seedPos) {
      if (!m.has(id)) m.set(id, { x: p.x, y: p.y, vx: 0, vy: 0 });
    }
    for (const id of [...m.keys()]) if (!seedPos.has(id)) m.delete(id);
    alpha.current = 1;   // neue Lage → neu einschwingen
  }, [seedPos]);

  useEffect(() => {
    if (!physicsOn) return;
    let raf = 0;
    const step = () => {
      const m = simPos.current;
      const a = alpha.current;
      if (a > 0.005) {
        const arr = [...m.entries()];
        // Abstoßung (alle Paare — Board-Zahlen bleiben klein genug)
        for (let i = 0; i < arr.length; i += 1) {
          for (let j = i + 1; j < arr.length; j += 1) {
            const A = arr[i][1], B = arr[j][1];
            let dx = A.x - B.x, dy = A.y - B.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = (Math.sin(i * 7 + j) || 0.5); dy = (Math.cos(i + j * 5) || 0.5); d2 = 1; }
            const f = (14000 / d2) * a;
            const d = Math.sqrt(d2);
            A.vx += (dx / d) * f; A.vy += (dy / d) * f;
            B.vx -= (dx / d) * f; B.vy -= (dy / d) * f;
          }
        }
        // Federn entlang der Verbindungen
        for (const l of links) {
          const A = m.get(l.a), B = m.get(l.b);
          if (!A || !B) continue;
          const dx = B.x - A.x, dy = B.y - A.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = ((d - 190) / d) * 0.04 * a;
          A.vx += dx * f; A.vy += dy * f;
          B.vx -= dx * f; B.vy -= dy * f;
        }
        // Cluster-Gravitation: zum Schwerpunkt des eigenen Projekts
        const centroids = new Map<string, { x: number; y: number; n: number }>();
        for (const [id, p] of m) {
          const proj = projectOf.get(id);
          if (!proj) continue;
          const c = centroids.get(proj) ?? { x: 0, y: 0, n: 0 };
          c.x += p.x; c.y += p.y; c.n += 1;
          centroids.set(proj, c);
        }
        for (const [id, p] of m) {
          const proj = projectOf.get(id);
          const c = proj ? centroids.get(proj) : undefined;
          if (c && c.n > 1) {
            p.vx += ((c.x / c.n) - p.x) * 0.015 * a;
            p.vy += ((c.y / c.n) - p.y) * 0.015 * a;
          }
          // sanfte Mitte-Gravitation gegen das Auseinanderdriften
          p.vx += (GRAPH_W / 2 - p.x) * 0.0022 * a;
          p.vy += (GRAPH_H / 2 - p.y) * 0.0022 * a;
        }
        // Integrieren + Dämpfung; festgehaltene Knoten (Drag) bleiben am Finger
        for (const p of m.values()) {
          if (p.fx != null && p.fy != null) { p.x = p.fx; p.y = p.fy; p.vx = 0; p.vy = 0; continue; }
          p.vx *= 0.82; p.vy *= 0.82;
          p.x += p.vx; p.y += p.vy;
        }
        alpha.current = a * 0.985;   // Energie klingt ab → Ruhe statt Dauerzappeln
        if (followActive.current) {
          const ap = m.get(activeIdRef.current);
          if (ap) setVb((v) => ({ ...v, x: ap.x - v.w / 2, y: ap.y - v.h / 2 }));
        }
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [physicsOn, links, projectOf]);

  /** Effektive Positionen: mit Physik die Simulation, ohne das statische Layout */
  const pos = useMemo(() => {
    if (!physicsOn) return seedPos;
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, p] of simPos.current) out.set(id, { x: p.x, y: p.y });
    // Fallback fürs allererste Rendern (Sim noch nicht geseedet)
    for (const [id, p] of seedPos) if (!out.has(id)) out.set(id, p);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicsOn, seedPos, simPos.current.size, alpha.current]);

  // ---------- M195: Knoten ziehen (stupst die Nachbarn physikalisch an) ----------
  const dragNode = useRef<string | null>(null);
  const dragMoved = useRef(false);
  /** Bildschirm → Graph-Koordinaten (berücksichtigt viewBox + meet-Zentrierung) */
  const toGraph = (cx: number, cy: number) => {
    const el = svgRef.current!;
    const rect = el.getBoundingClientRect();
    const v = vbRef.current;
    const scale = Math.min(rect.width / v.w, rect.height / v.h);
    const ox = (rect.width - v.w * scale) / 2;
    const oy = (rect.height - v.h * scale) / 2;
    return { x: v.x + (cx - rect.left - ox) / scale, y: v.y + (cy - rect.top - oy) / scale };
  };
  // M197: Der Drag läuft über die SVG-WURZEL, nicht übers winzige g-Element.
  // setPointerCapture auf SVG-Kindern ist in iOS-Safari unzuverlässig — sobald
  // der Finger die Bubble verließ, kamen keine pointermove mehr an: Der Knoten
  // blieb stehen und sprang erst beim Loslassen ans Ziel (User-Report iPhone).
  const dragStart = useRef({ x: 0, y: 0 });
  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    if (!physicsOn) return;
    // Nur Haupttaste/Finger: Der Rechtsklick gehört dem Kontextmenü — sonst
    // würde sein pointerup als „Tipp" gewertet und öffnete das Board (M197)
    if (e.button !== 0) return;
    e.stopPropagation();
    dragNode.current = id;
    dragMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* synthetische Pointer */ }
  };
  /** Wird vom SVG-Move-Handler gerufen, solange ein Knoten am Finger hängt */
  const moveDraggedNode = (e: React.PointerEvent) => {
    const id = dragNode.current;
    if (!id) return;
    const p = simPos.current.get(id);
    if (!p) return;
    // Finger zittern: Erst ab ~7px ist es ein Drag, davor bleibt es ein Tipp —
    // sonst würde auf Touch NIE ein Klick durchkommen (jeder Tipp wackelt)
    if (!dragMoved.current
      && Math.abs(e.clientX - dragStart.current.x) + Math.abs(e.clientY - dragStart.current.y) < 7) return;
    const g = toGraph(e.clientX, e.clientY);
    p.fx = g.x; p.fy = g.y;
    dragMoved.current = true;
    alpha.current = Math.max(alpha.current, 0.5);   // Nachbarn wach machen
    // KEIN setFrame hier: Die rAF-Schleife rendert ohnehin — ein zweiter
    // Render je pointermove (bis 120 Hz am iPhone) machte es nur ruckeliger
  };
  /** Nach Capture an der SVG-Wurzel feuert der Browser-„click" nicht mehr am
   *  g-Element — Tipp-ohne-Zerren wird deshalb HIER beim Loslassen behandelt */
  const clickHandledAt = useRef(0);
  const releaseDraggedNode = () => {
    const id = dragNode.current;
    if (!id) return;
    const p = simPos.current.get(id);
    if (p) { p.fx = undefined; p.fy = undefined; }   // loslassen → weiterschwingen
    dragNode.current = null;
    if (!dragMoved.current) {
      clickHandledAt.current = Date.now();
      if (linkFrom) completeLink(id);
      else openBoard(id);
    }
  };

  // ---------- M195: Kontextmenü — manuell verknüpfen per Rechtsklick/Langdruck ----------
  const addNodeToBoard = useBoard((s) => s.addNodeToBoard);
  const showToast = useBoard((s) => s.showToast);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; boardId: string } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const onNodeContext = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, boardId: id });
  };
  const boardName = (id: string) => scoped.find((b) => b.id === id)?.name ?? '?';
  // Esc bricht Verknüpfen/Menü ab; Klick irgendwo schließt das Menü
  useEffect(() => {
    if (!ctxMenu && !linkFrom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCtxMenu(null); setLinkFrom(null);
    };
    const onDown = (e: PointerEvent) => {
      if (ctxMenu && !(e.target as Element).closest?.('.ov-graph-ctx')) setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [ctxMenu, linkFrom]);
  /** Ziel angeklickt: Portal-Karte auf dem Quell-Board anlegen — eine ECHTE
   *  Verbindung im Datenmodell (undo-fähig), nicht nur ein Strich im Bild */
  const completeLink = (targetId: string) => {
    if (!linkFrom || linkFrom === targetId) { setLinkFrom(null); return; }
    const from = linkFrom;
    const spot = { x: 80 + Math.random() * 240, y: 80 + Math.random() * 160 };
    const portal = makePortal(spot);
    portal.data = { boardId: targetId };
    addNodeToBoard(from, portal);
    showToast(`🔗 Portal angelegt: „${boardName(from)}" → „${boardName(targetId)}" (Strg+Z macht es rückgängig).`);
    setLinkFrom(null);
  };

  /** Suche im Netz: hebt HERVOR statt zu filtern — man soll sehen, wo etwas
   *  sitzt, nicht nur was übrig bleibt. Trifft Board-Namen und Karten-Text. */
  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    const boardsHit = new Set<string>();
    const cardsHit = new Set<string>();
    if (!needle) return { boards: boardsHit, cards: cardsHit };
    for (const b of scoped) {
      if (b.name.toLowerCase().includes(needle)) boardsHit.add(b.id);
      for (const n of b.nodes) {
        if (nodeToText(n).toLowerCase().includes(needle)) {
          cardsHit.add(`${b.id}:${n.id}`);
          boardsHit.add(b.id);
        }
      }
    }
    return { boards: boardsHit, cards: cardsHit };
  }, [needle, scoped]);
  /** Nur hervorheben, wenn es auch etwas hervorzuheben GIBT — sonst läge das
   *  ganze Netz blass da und sähe kaputt aus statt „nichts gefunden" */
  const marking = needle !== '' && hits.boards.size > 0;

  // ---------- Pan & Zoom wie auf dem Whiteboard (viewBox-Steuerung) ----------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H });
  // Ref-Spiegel für Handler, die außerhalb des Render-Zyklus rechnen (M195-Drag)
  const vbRef = useRef(vb);
  vbRef.current = vb;
  // Ref statt Closure: der Wheel-Listener wird nur einmal registriert und
  // soll trotzdem immer die aktuellen Knoten-Positionen sehen
  const posRef = useRef(pos);
  posRef.current = pos;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const pinchDist = useRef<number | null>(null);

  /** Um einen Bildschirmpunkt herum zoomen — der Punkt unterm Cursor bleibt stehen */
  /** M195: Solange der Nutzer die Ansicht nicht selbst bewegt hat, folgt sie
   *  dem aktiven Board — die Physik schiebt es sonst aus der Startmitte. */
  const followActive = useRef(true);
  const zoomAt = (cx: number, cy: number, f: number) => {
    followActive.current = false;
    setVb((v) => {
      const el = svgRef.current;
      if (!el) return v;
      const rect = el.getBoundingClientRect();
      // Zoomstufe begrenzen: 10× rein bis 2,5× raus
      const w = Math.min(GRAPH_W * 2.5, Math.max(GRAPH_W / 10, v.w * f));
      const realF = w / v.w;
      if (realF === 1) return v;
      // preserveAspectRatio "meet": einheitlicher Maßstab + zentrierter Versatz
      const scale = Math.min(rect.width / v.w, rect.height / v.h);
      const ox = (rect.width - v.w * scale) / 2;
      const oy = (rect.height - v.h * scale) / 2;
      const px = v.x + (cx - rect.left - ox) / scale;
      const py = v.y + (cy - rect.top - oy) / scale;
      const next = { x: px - (px - v.x) * realF, y: py - (py - v.y) * realF, w: v.w * realF, h: v.h * realF };
      // Leerlauf-Sicherung: Wer per Button/Pinch am Inhalt vorbeizoomt, sähe
      // sonst nur noch Beige — dann auf den nächstgelegenen Knoten zentrieren
      const pts = [...posRef.current.values()];
      const visible = pts.some(
        (p) => p.x >= next.x && p.x <= next.x + next.w && p.y >= next.y && p.y <= next.y + next.h,
      );
      if (pts.length > 0 && !visible) {
        const cx0 = next.x + next.w / 2;
        const cy0 = next.y + next.h / 2;
        let best = pts[0];
        let bd = Infinity;
        for (const p of pts) {
          const d = (p.x - cx0) ** 2 + (p.y - cy0) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        next.x = best.x - next.w / 2;
        next.y = best.y - next.h / 2;
      }
      return next;
    });
  };

  const zoomButton = (f: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  /** M193: Beim Öffnen dorthin schauen, wo man herkommt. Vorher startete das
   *  Netz immer links oben — bei vielen Boards wusste man nicht, wo man ist.
   *  Nur EINMAL beim Mount, danach gehört die Ansicht dem Nutzer. */
  const centeredOnce = useRef(false);
  useEffect(() => {
    if (centeredOnce.current) return;
    const p = pos.get(activeId);
    if (!p) return;
    centeredOnce.current = true;
    const w = GRAPH_W / 1.9, h = GRAPH_H / 1.9;
    setVb({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  }, [pos, activeId]);

  // Rad-Zoom braucht preventDefault → nativer non-passive Listener
  // (Reacts onWheel ist am Root passiv registriert)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt nutzt nur Refs + funktionales setState — Closure bleibt gültig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      downAt.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    }
    pinchDist.current = null;
    // KEIN setPointerCapture hier: Capture würde auch den Klick aufs SVG
    // umleiten und Knoten-Klicks schlucken — erst beim echten Pannen (s. unten)
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // M197: Hängt ein Knoten am Finger, gehört die Bewegung ihm — die Events
    // kommen dank Capture an der SVG-Wurzel zuverlässig hier an (iOS-Safari
    // verliert sie auf den kleinen g-Elementen)
    if (dragNode.current) { moveDraggedNode(e); return; }
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (!moved.current && downAt.current
        && Math.abs(e.clientX - downAt.current.x) + Math.abs(e.clientY - downAt.current.y) > 4) {
        moved.current = true;
        followActive.current = false;
        // Ab jetzt ist es ein Pan — Capture hält die Geste auch außerhalb des SVG
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetische Pointer */ }
      }
      if (!moved.current) return;
      setVb((v) => {
        const el = svgRef.current;
        if (!el) return v;
        const rect = el.getBoundingClientRect();
        const scale = Math.min(rect.width / v.w, rect.height / v.h);
        return { ...v, x: v.x - dx / scale, y: v.y - dy / scale };
      });
    } else if (pts.size === 2) {
      const [p1, p2] = [...pts.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      if (pinchDist.current && dist > 0) {
        zoomAt(mid.x, mid.y, pinchDist.current / dist);
        moved.current = true;
      }
      pinchDist.current = dist;
    }
  };

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    releaseDraggedNode();
    pointers.current.delete(e.pointerId);
    pinchDist.current = null;
  };

  /** Nach einem Pan/Pinch darf der abschließende Klick keine Knoten öffnen */
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current) {
      e.stopPropagation();
      e.preventDefault();
      moved.current = false;
    }
  };

  const r = (cards: number) => 14 + Math.min(26, Math.sqrt(cards) * 5);

  // Karten-Ebene, Stufe 1 (M197): Auswahl + TITEL nur bei Datenänderung —
  // die String-Arbeit (nodeToText) hat in der Frame-Schleife nichts verloren
  const satelliteMeta = useMemo(() => {
    if (!showCards) return [];
    return scoped.map((b) => {
      // M193: Vorher zählten NUR Karten mit Pfeilen — auf Boards ohne
      // Verbindungen blieb die eingeschaltete Ebene komplett leer und wirkte
      // kaputt. Jetzt: verbundene Karten zuerst (sie tragen die Struktur),
      // danach mit den übrigen auffüllen. Deckel gegen den Knäuel-Effekt.
      const connected = new Set(b.edges.flatMap((e) => [e.source, e.target]));
      const linked = b.nodes.filter((n) => connected.has(n.id));
      const rest = b.nodes.filter((n) => !connected.has(n.id));
      const cards = [...linked, ...rest].slice(0, Math.max(linked.length, MAX_SATELLITES)).map((n) => ({
        nodeId: n.id,
        title: (nodeToText(n).split('\n').find((l) => l.trim()) ?? n.type ?? 'Karte').slice(0, 40),
      }));
      return { boardId: b.id, total: b.nodes.length, cards, edges: b.edges.map((e) => ({ s: e.source, t: e.target })) };
    });
  }, [showCards, scoped]);

  // Stufe 2: pro Frame nur noch Trigonometrie um die aktuellen Board-Zentren
  const satellites = useMemo(() => {
    const dots: Array<{ key: string; x: number; y: number; title: string; boardId: string; nodeId: string }> = [];
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const dotPos = new Map<string, { x: number; y: number }>();
    for (const b of satelliteMeta) {
      const center = pos.get(b.boardId);
      if (!center) continue;
      const ring = r(b.total) + 34;
      b.cards.forEach((c, i) => {
        const angle = (i / Math.max(1, b.cards.length)) * Math.PI * 2 - Math.PI / 2;
        const x = center.x + Math.cos(angle) * ring;
        const y = center.y + Math.sin(angle) * ring;
        dotPos.set(`${b.boardId}:${c.nodeId}`, { x, y });
        dots.push({ key: `${b.boardId}:${c.nodeId}`, x, y, title: c.title, boardId: b.boardId, nodeId: c.nodeId });
      });
      for (const e of b.edges) {
        const a = dotPos.get(`${b.boardId}:${e.s}`);
        const c2 = dotPos.get(`${b.boardId}:${e.t}`);
        if (a && c2) lines.push({ x1: a.x, y1: a.y, x2: c2.x, y2: c2.y });
      }
    }
    return { dots, lines };
  }, [satelliteMeta, pos]);

  // ---------- Semantischer Zoom: Detailgrad folgt der Zoomstufe ----------
  // Maßstab = ECHTE Bildschirm-Pixel pro SVG-Einheit (gemessen, nicht relativ
  // zur Graph-Breite — sonst ist auf dem Handy alles ⅓ so groß wie gedacht).
  const [rectW, setRectW] = useState(0);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => setRectW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = (rectW || GRAPH_W) / vb.w;
  // Stufe 0 (zu klein für Details): nur Boards + Namen. Stufe 1: Karten-Punkte.
  // Stufe 2 (nah): Karten-Titel an den Punkten.
  const lod = scale < 0.42 ? 0 : scale <= 1.35 ? 1 : 2;
  /** Wunschgröße in Bildschirm-Pixeln → SVG-Einheiten (konstant auf dem Schirm) */
  const ui = (px: number) => px / scale;

  return (
    <div className={`ov-graph ${embedded ? "embedded" : ""}`}>
      <div className="ov-graph-toggles nodrag">
        {([
          ['Karten', 'cards', showCards],
          ['Portale', 'portals', showPortals],
          ['Wikilinks', 'wikis', showWikis],
          ['Physik', 'physik', physicsOn],
        ] as const).map(([label, key, on]) => (
          <label key={key} className="ov-graph-toggle">
            <input type="checkbox" checked={on} onChange={(e) => setLayer(key, e.target.checked)} /> {label}
          </label>
        ))}
        {projectName && (
          <label className="ov-graph-toggle" title={`Nur die Boards aus „${projectName}" zeigen`}>
            <input type="checkbox" checked={projectOnly} onChange={(e) => setLayer('projectOnly', e.target.checked)} /> Nur dieses Projekt
          </label>
        )}
        <span className="ov-graph-find">
          <input
            type="search"
            placeholder="Im Netz suchen …"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Im Netz suchen"
          />
          {needle && (
            <b className={`ov-graph-hits ${marking ? '' : 'none'}`}>
              {marking
                ? `${hits.boards.size} Board${hits.boards.size === 1 ? '' : 's'}${showCards ? ` · ${hits.cards.size} Karten` : ''}`
                : 'keine Treffer'}
            </b>
          )}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="ov-graph-svg"
        role="img"
        aria-label="Board-Netz"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {links.map((l, i) => {
          if (l.kind === 'portal' && !showPortals) return null;
          if (l.kind === 'wikilink' && !showWikis) return null;
          const a = pos.get(l.a), b = pos.get(l.b);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={l.kind === 'portal' ? 'rgba(79,124,255,.5)' : 'rgba(120,110,90,.45)'}
              strokeWidth={l.kind === 'portal' ? ui(2) : ui(1.5)}
              strokeDasharray={l.kind === 'wikilink' ? `${ui(5)} ${ui(4)}` : undefined}
            />
          );
        })}
        {lod >= 1 && satellites.lines.map((l, i) => (
          <line key={`c${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(120,110,90,.3)" strokeWidth={ui(1)} />
        ))}
        {lod >= 1 && satellites.dots.map((d) => (
          <g
            key={d.key}
            className={`ov-graph-dot ${marking ? (hits.cards.has(d.key) ? 'hit' : 'dim') : ''}`}
            onClick={() => { openBoard(d.boardId); focusNode(d.boardId, d.nodeId); }}
          >
            <title>{d.title}</title>
            <circle cx={d.x} cy={d.y} r={ui(5)} strokeWidth={ui(1.5)} />
            {lod === 2 && (
              <text
                className="ov-graph-dot-label"
                x={d.x + ui(9)} y={d.y + ui(4)} fontSize={ui(11.5)}
                stroke="var(--bg)" strokeWidth={ui(3)} paintOrder="stroke"
              >
                {d.title.slice(0, 28)}
              </text>
            )}
          </g>
        ))}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const rad = r(n.cards);
          return (
            <g
              key={n.id}
              className={`ov-graph-node ${n.id === activeId ? 'here' : ''} ${marking ? (hits.boards.has(n.id) ? 'hit' : 'dim') : ''} ${linkFrom === n.id ? 'linking' : ''}`}
              data-tip={linkFrom ? `Klicken: Portal „${boardName(linkFrom)}" → „${n.label}" anlegen` : previewOf(n.id)}
              onClick={() => {
                // Nach einem echten Zerren nicht auch noch öffnen (M195);
                // und nicht doppelt, wenn das Loslassen den Tipp schon
                // behandelt hat (M197 — Capture-Pfad, Physik an)
                if (dragMoved.current) { dragMoved.current = false; return; }
                if (Date.now() - clickHandledAt.current < 400) return;
                if (linkFrom) { completeLink(n.id); return; }
                openBoard(n.id);
              }}
              onPointerDown={onNodeDown(n.id)}
              onContextMenu={onNodeContext(n.id)}
            >
              {/* M193: „Du bist hier" — ohne diesen Ring verliert man im
                  Gesamtnetz sofort den Bezug zum eigenen Standort */}
              {n.id === activeId && <circle className="ov-graph-here" cx={p.x} cy={p.y} r={rad + ui(7)} strokeWidth={ui(2.5)} />}
              <circle cx={p.x} cy={p.y} r={rad} strokeWidth={ui(2)} />
              <text
                x={p.x} y={p.y + rad + ui(17)} textAnchor="middle"
                // Deckel in SVG-Einheiten: weit rausgezoomt schrumpfen Namen,
                // statt sich gegenseitig zu überlagern
                fontSize={Math.min(ui(13.5), 30)}
                stroke="var(--bg)" strokeWidth={Math.min(ui(3.5), 7)} paintOrder="stroke"
              >
                {n.label.slice(0, 24)}
              </text>
              {lod >= 1 && (
                <text x={p.x} y={p.y + ui(4)} textAnchor="middle" className="ov-graph-count" fontSize={Math.min(ui(10), 20)}>
                  {n.cards}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="ov-graph-zoom nodrag">
        <button onClick={() => zoomButton(1 / 1.35)} title="Vergrößern" aria-label="Vergrößern"><IZoomIn size={16} /></button>
        <button onClick={() => zoomButton(1.35)} title="Verkleinern" aria-label="Verkleinern"><IZoomOut size={16} /></button>
        <button
          onClick={() => setVb({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H })}
          title="Alles einpassen"
          aria-label="Alles einpassen"
        >
          <ITarget size={16} />
        </button>
      </div>
      {linkFrom && (
        <div className="ov-graph-linkhint nodrag">
          🔗 Verknüpfen: Ziel-Board anklicken — Portal entsteht auf „{boardName(linkFrom)}"
          <button onClick={() => setLinkFrom(null)}>Abbrechen (Esc)</button>
        </div>
      )}
      {ctxMenu && (
        <div className="ov-graph-ctx nodrag" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="ov-graph-ctx-title">{boardName(ctxMenu.boardId)}</div>
          <button onClick={() => { openBoard(ctxMenu.boardId); setCtxMenu(null); }}>Board öffnen</button>
          <button onClick={() => { setLinkFrom(ctxMenu.boardId); setCtxMenu(null); }}>Verknüpfen mit … (Portal)</button>
          <button onClick={() => {
            const p = pos.get(ctxMenu.boardId);
            if (p) setVb({ x: p.x - GRAPH_W / 3.8, y: p.y - GRAPH_H / 3.8, w: GRAPH_W / 1.9, h: GRAPH_H / 1.9 });
            setCtxMenu(null);
          }}>Hierher zoomen</button>
          {physicsOn && (
            <button onClick={() => { alpha.current = 1; setCtxMenu(null); }}>Netz neu ausschwingen</button>
          )}
        </div>
      )}
      {!embedded && (
        <div className="ov-graph-legend">
          ── Portal · ┄┄ [[Wikilink]] · Kreisgröße = Kartenzahl · <b>Ring = aktuelles Board</b> · Klick öffnet · Rad/Pinch = Zoom · Ziehen = Verschieben · Detailgrad folgt dem Zoom (nah heranzoomen zeigt Kartentitel)
        </div>
      )}
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

function SpaceZone({ data }: NodeProps<Node<SpaceZoneData, 'ovSpace'>>) {
  const { space, accent } = data;
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

function ProjectZone({ data }: NodeProps<Node<ProjectZoneData, 'ovProject'>>) {
  const { project } = data;
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

function BoardTile({ data }: NodeProps<Node<BoardTileData, 'ovBoard'>>) {
  const { board, accent } = data;
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const openBoard = useBoard((s) => s.openBoard);
  const setPresenting = useBoard((s) => s.setPresenting);
  const [editing, setEditing] = useState(false);

  return (
    <div className="ov-board ovc-tile" style={{ borderTopColor: accent }} title="Klick öffnet das Board · Ziehen verschiebt es">
      <span className="ovc-tile-actions nodrag">
        <button
          title="Board direkt präsentieren"
          aria-label={`Board ${board.name} präsentieren`}
          onClick={(e) => {
            e.stopPropagation();
            openBoard(board.id);
            setPresenting(true);
          }}
        >
          <IPlay size={12} />
        </button>
        <button
          title="Umbenennen"
          aria-label="Board umbenennen"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          <IPen size={12} />
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
          <IX size={12} />
        </button>
      </span>
      <InlineName
        value={board.name}
        className="ov-board-name"
        editing={editing}
        onEditingChange={setEditing}
        onRename={(name) => renameBoard(board.id, name)}
      />
      <div className="ov-board-meta">{boardMetaLabel(board)}</div>
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

