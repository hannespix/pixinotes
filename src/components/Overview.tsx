import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { hullPath, topAnchor, type Pt } from '../lib/hull';
import { useBoard, type BoardDoc, type Project, type Space } from '../store';
import { boardMetaLabel } from '../lib/boardStats';
import { boardGraph, layoutGraph, type GraphLink } from '../lib/links';
import { suggestBoardLinks, type LinkSuggestion } from '../lib/brain';
import { nodeToText } from '../lib/serialize';
import { InlineName } from './InlineName';
import { IPen, IPlay, ITarget, IX, IZoomIn, IZoomOut } from './Icons';

interface SpaceZoneData { space: Space; accent: string; [key: string]: unknown }
interface ProjectZoneData { project: Project; spaceId: string; [key: string]: unknown }
interface BoardTileData { board: BoardDoc; projectId: string; accent: string; [key: string]: unknown }

const SPACE_ACCENTS = ['#4f7cff', '#e07a3f', '#3fa564', '#a05fd4', '#d44f6e'];

// Kachel- und Layout-Maße (Canvas-Koordinaten)
const BW = 200, BH = 150, GAP = 16, PROJ_HEAD = 44, SPACE_HEAD = 56, SPACE_GAP = 70;

interface ProjectRect { id: string; x: number; y: number; w: number; h: number }

/**
 * M232: Archivierte Karten aus den Boards nehmen — es sei denn, das Archiv
 * ist eingeblendet.
 *
 * Boards ohne archivierte Karte werden UNVERÄNDERT durchgereicht (dieselbe
 * Objekt-Identität). Das ist kein Geiz, sondern Absicht: Die Netz-Ansicht
 * hängt teure Berechnungen (Graph, Layout, Satelliten-Titel) an der Board-
 * Referenz. Würde hier jedes Mal ein frisches Objekt entstehen, liefen
 * Kräfte-Layout und Titel-Arbeit bei jedem Render neu — genau das Ruckeln,
 * das M223 beseitigt hat.
 */
function ohneArchiv<T extends { nodes: Array<{ archived?: boolean }> }>(boards: T[], zeigen: boolean): T[] {
  if (zeigen) return boards;
  let geaendert = false;
  const raus = boards.map((b) => {
    const nodes = b.nodes.filter((n) => !n.archived);
    if (nodes.length === b.nodes.length) return b;
    geaendert = true;
    return { ...b, nodes };
  });
  return geaendert ? raus : boards;
}

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
  /**
   * M252: Wie breit der Umschalter oben rechts wirklich ist.
   *
   * Die Filterleiste links darf nicht bis unter ihn laufen — bei 150 %
   * Textgröße tat sie das und verschwand mit ihrer rechten Hälfte unter dem
   * Umschalter. Eine feste Zahl wäre wieder nur geraten; die Breite wächst mit
   * Schriftgröße und Sprache mit.
   */
  const umschalter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = umschalter.current;
    if (!el) return;
    const messen = () => document.documentElement.style.setProperty(
      '--ov-mode-breite', `${Math.round(el.offsetWidth)}px`);
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => {
      beobachter.disconnect();
      document.documentElement.style.setProperty('--ov-mode-breite', '0px');
    };
  }, []);
  return (
    <ReactFlowProvider>
      <div className="ov-mode nodrag" ref={umschalter}>
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
  const alleBoards = useBoard((s) => s.boards);
  const showArchived = useBoard((s) => s.showArchived);
  // M232: Dieselbe Regel wie im Netz — Kachel-Zähler („12 Karten") und die
  // Mini-Vorschau zeigen sonst Karten, die auf dem Board gar nicht zu sehen
  // sind, und die beiden Übersichten widersprächen sich gegenseitig.
  const boards = useMemo(() => ohneArchiv(alleBoards, showArchived), [alleBoards, showArchived]);
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

/**
 * M223: Gelände-Geometrie aus den AKTUELLEN Positionen.
 *
 * Bewusst als freie Funktion, nicht im Render: Die Hüllen müssen zweimal
 * gerechnet werden — einmal beim Rendern (Topologie ändert sich) und einmal
 * pro Frame in der Physik-Schleife. Vorher hing die Fläche in der Luft, während
 * die Knoten schon weitergezogen waren; das Gelände „hinkte" sichtbar nach.
 */
function regionGeo(ids: string[], pad: number, at: (id: string) => Pt | undefined) {
  const pts: Pt[] = [];
  for (const id of ids) { const p = at(id); if (p) pts.push({ x: p.x, y: p.y }); }
  if (pts.length === 0) return null;
  return { d: hullPath(pts, pad), label: topAnchor(pts, pad) };
}

/** Detailgrad aus dem Maßstab (M43) — an einer Stelle, damit Render und
 *  Zoom-Logik nicht auseinanderlaufen */
const lodOf = (scale: number): 0 | 1 | 2 => (scale < 0.42 ? 0 : scale <= 1.35 ? 1 : 2);
/** Gliederungs-Ebene aus der Zoomstufe (M222) */
const geoOf = (zoom: number): 'space' | 'project' | 'board' =>
  (zoom < 0.5 ? 'space' : zoom < 0.8 ? 'project' : 'board');
/**
 * M223: Bildschirmfeste Größen werden GESTUFT nachgezogen, nicht stufenlos.
 *
 * Schriftgrößen und Strichstärken sind in SVG-Einheiten angegeben und müssen
 * beim Zoomen gegengerechnet werden, damit sie auf dem Schirm gleich groß
 * bleiben. Jede Änderung eines font-size vermisst der Browser den Text neu —
 * bei 78 Beschriftungen und einem Render pro Frame ging fast die Hälfte der
 * Rechenzeit ins Layout (gemessen: 1,36 s Layout in 3 s Zoomen).
 * In Stufen von 20 % gerechnet fällt das fast vollständig weg; dazwischen
 * skaliert die Schrift höchstens um ein Fünftel mit — das sieht niemand.
 */
const sizeStep = (w: number) => Math.round(Math.log(w) / Math.log(1.2));

/** Eine Gelände-Fläche: nur die ZUGEHÖRIGKEIT, nie fertige Koordinaten */
interface RegionShape {
  key: string; kind: 'space' | 'project'; name: string; accent: string;
  ids: string[]; pad: number; spaceId: string; schlaeft: boolean;
}
/** Ein Band zwischen zwei Bereichen (M222) */
interface BundleShape { key: string; aIds: string[]; bIds: string[]; n: number; label: string }

/** Schwerpunkt einer Board-Gruppe — Ankerpunkt der Bereichs-Bänder (M222) */
function groupMid(ids: string[], at: (id: string) => Pt | undefined): Pt | null {
  let x = 0, y = 0, n = 0;
  for (const id of ids) { const p = at(id); if (p) { x += p.x; y += p.y; n += 1; } }
  return n === 0 ? null : { x: x / n, y: y / n };
}
/** Höchstens so viele Karten-Punkte je Board (M193) — darüber wird der Ring
 *  zum Knäuel und die Board-Ebene unlesbar */
const MAX_SATELLITES = 14;

/**
 * Board-Netz. Zwei Einsatzorte (M194): als Vollbild-Ansicht in der Übersicht
 * und eingebettet in die Seitenleiste. `embedded` schaltet nur die Hülle um —
 * Logik, Gesten und Ebenen sind identisch, damit beide nicht auseinanderlaufen.
 */
export function GraphView({ embedded = false }: { embedded?: boolean }) {
  const alleBoards = useBoard((s) => s.boards);
  const showArchived = useBoard((s) => s.showArchived);
  // M232: Archivierte Karten gehören auch im Netz ins Archiv (User-Report).
  // Sie blähten die Board-Kugeln auf, hingen als Satelliten daneben und
  // zogen über ihre Portale sogar Verbindungslinien — obwohl sie auf dem
  // Board selbst ausgeblendet sind. Der Archiv-Schalter im Dock gilt jetzt
  // hier genauso. Gefiltert wird EINMAL an der Quelle: So stimmen Kugelgröße,
  // Satelliten, Bänder und Suche automatisch überein.
  const boards = useMemo(() => ohneArchiv(alleBoards, showArchived), [alleBoards, showArchived]);
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
  // M221: Gelände-Ebene — standardmäßig AN, weil sie Struktur zeigt statt sie zu verstecken
  const showRegions = layers.regionen !== false;
  const brainOffSpaces = useBoard((s) => s.brainOffSpaces);
  const toggleBrainSpace = useBoard((s) => s.toggleBrainSpace);
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
  const { nodes, links: realLinks, pos: seedPos } = useMemo(() => {
    const g = boardGraph(scoped);
    return { ...g, pos: layoutGraph(g.nodes, g.links, W, H) };
  }, [scoped]);

  // ---------- M205: Synapsen — was das Gehirn zu verknüpfen vorschlägt ----------
  const brainOn = useBoard((s) => s.brain.on);
  const rejectedLinks = useBoard((s) => s.rejectedLinks);
  const rejectLink = useBoard((s) => s.rejectLink);
  const showSuggest = (layers.vorschlaege ?? true) && brainOn;
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  useEffect(() => {
    if (!showSuggest) { setSuggestions([]); return; }
    let gone = false;
    const load = () => {
      const inScope = new Set(scoped.map((b) => b.id));
      const existing = new Set(realLinks.map((l) => [l.a, l.b].sort().join('|')));
      suggestBoardLinks(existing, new Set(rejectedLinks), 8)
        .then((s) => { if (!gone) setSuggestions(s.filter((x) => inScope.has(x.a) && inScope.has(x.b))); })
        .catch(() => { if (!gone) setSuggestions([]); });
    };
    const t = setTimeout(load, 900);
    window.addEventListener('pixinotes:brain', load);
    return () => { gone = true; clearTimeout(t); window.removeEventListener('pixinotes:brain', load); };
  }, [showSuggest, scoped, realLinks, rejectedLinks]);

  // Vorschläge sind Kanten wie andere auch — nur gestrichelt und annehmbar
  const links = useMemo<GraphLink[]>(
    () => [...realLinks, ...suggestions.map((s) => ({ a: s.a, b: s.b, kind: 'vorschlag' as const, score: s.score }))],
    [realLinks, suggestions],
  );

  // ---------- M195: Lebendige Physik (Obsidian-Gefühl) ----------
  // Kräfte: Abstoßung zwischen allen Boards, Federn entlang der Verbindungen,
  // sanfte Mitte-Gravitation — und CLUSTERUNG: Boards desselben Projekts
  // ziehen sich zu ihrem Schwerpunkt, so sortiert sich die Struktur von
  // selbst in Themen-Inseln. Läuft mit abklingender Energie (kein Dauerlauf,
  // schont den Akku) und heizt bei Drag/Datenänderung wieder auf.
  const physicsOn = layers.physik ?? true;
  const simPos = useRef(new Map<string, { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }>());
  const alpha = useRef(1);
  // M203: Positionen laufen IMPERATIV in den DOM (transform-/Linien-Attribute)
  // statt über einen setState-Puls pro Frame. Der React-Reconcile über das
  // komplette SVG (alle Knoten, Satelliten, Kanten — jede Sekunde 60–120×)
  // war der Haupt-Ruckler beim Drag, auch auf starken Rechnern. React rendert
  // jetzt nur noch die TOPOLOGIE (Datenänderung, Ebenen, Zoomstufe).
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const satEls = useRef(new Map<string, SVGGElement>());
  const linkEls = useRef(new Map<number, SVGLineElement>());
  // M223: Auch Gelände und Bänder werden pro Frame imperativ nachgezogen
  const regionEls = useRef(new Map<string, SVGPathElement>());
  const regionTextEls = useRef(new Map<string, SVGTextElement>());
  const bundleEls = useRef(new Map<string, SVGLineElement>());
  const bundleTextEls = useRef(new Map<string, SVGTextElement>());
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
    wake();              // M223: Schleife anwerfen, falls sie gerade ruht
  }, [seedPos]);

  /**
   * M223: Die Schleife LÄUFT NICHT MEHR EWIG.
   *
   * Vorher stand am Ende jedes Frames ein unbedingtes requestAnimationFrame —
   * auch wenn längst nichts mehr schwang. Der Hauptthread wurde damit 60-mal
   * pro Sekunde geweckt, ohne etwas zu tun: auf dem Handy spürbar als Wärme
   * und leerer Akku. Jetzt hält die Schleife an, sobald das Netz ruht, und
   * `wake()` startet sie wieder — beim Ziehen, bei Datenänderungen, beim
   * „neu ausschwingen".
   */
  const wakeRef = useRef<() => void>(() => {});
  /** Aktueller Maßstab (Bildschirm-px je SVG-Einheit) für die Frame-Schleife */
  const scaleRef = useRef(1);
  const wake = () => wakeRef.current();
  const regionsRef = useRef<RegionShape[]>([]);
  const bundlesRef = useRef<BundleShape[]>([]);

  useEffect(() => {
    if (!physicsOn) return;
    let raf = 0;
    let frame = 0;
    const step = () => {
      raf = 0;
      const m = simPos.current;
      const a = alpha.current;
      frame += 1;
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
          // M223: NICHT über setVb — das war ein voller React-Durchlauf PRO
          // FRAME (gemessen: 60 Renders/s im Leerlauf) und hat den ganzen
          // imperativen Frame-Pfad von M203 wieder zunichtegemacht.
          if (ap) {
            const v = vbRef.current;
            applyVb({ ...v, x: ap.x - v.w / 2, y: ap.y - v.h / 2 });
          }
        }
        // Frame direkt in den DOM schreiben — kein React-Render (M203)
        for (const [id, el] of nodeEls.current) {
          const p = m.get(id);
          if (p) el.setAttribute('transform', `translate(${p.x} ${p.y})`);
        }
        for (const [id, el] of satEls.current) {
          const p = m.get(id);
          if (p) el.setAttribute('transform', `translate(${p.x} ${p.y})`);
        }
        for (const [i, el] of linkEls.current) {
          const l = links[i];
          if (!l) continue;
          const A = m.get(l.a), B = m.get(l.b);
          if (!A || !B) continue;
          el.setAttribute('x1', String(A.x)); el.setAttribute('y1', String(A.y));
          el.setAttribute('x2', String(B.x)); el.setAttribute('y2', String(B.y));
        }
        // M223: Gelände und Bänder ziehen mit. Die Hüllen kosten mehr als ein
        // transform (konvexe Hülle + Kurve + Zeichenkette), darum nur jeden
        // zweiten Frame — bei 60 Hz sieht das kein Mensch, halbiert aber die
        // Rechenlast auf schwachen Geräten.
        if (frame % 2 === 0) {
          const at = (id: string) => m.get(id);
          for (const rg of regionsRef.current) {
            const path = regionEls.current.get(rg.key);
            const label = regionTextEls.current.get(rg.key);
            if (!path && !label) continue;
            const geo = regionGeo(rg.ids, rg.pad, at);
            if (!geo) continue;
            path?.setAttribute('d', geo.d);
            if (label) { label.setAttribute('x', String(geo.label.x)); label.setAttribute('y', String(geo.label.y)); }
          }
          for (const bd of bundlesRef.current) {
            const line = bundleEls.current.get(bd.key);
            const label = bundleTextEls.current.get(bd.key);
            if (!line && !label) continue;
            const A = groupMid(bd.aIds, at);
            const B = groupMid(bd.bIds, at);
            if (!A || !B) continue;
            if (line) {
              line.setAttribute('x1', String(A.x)); line.setAttribute('y1', String(A.y));
              line.setAttribute('x2', String(B.x)); line.setAttribute('y2', String(B.y));
            }
            if (label) {
              label.setAttribute('x', String((A.x + B.x) / 2));
              label.setAttribute('y', String((A.y + B.y) / 2 - 9 / scaleRef.current));
            }
          }
        }
        // M203: Solange sich das Netz bewegt, pausiert das Glas der Seiten-
        // leiste — backdrop-filter erzwingt sonst pro Frame einen teuren
        // Repaint der verwischten Fläche (ruckelte selbst auf Gaming-GPUs)
        svgRef.current?.closest('.sidepanel')?.classList.add('graph-motion');
        raf = requestAnimationFrame(step);
      } else {
        // Ruhe: Schleife anhalten statt weiterzulaufen (M223)
        svgRef.current?.closest('.sidepanel')?.classList.remove('graph-motion');
      }
    };
    wakeRef.current = () => { if (!raf) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => {
      wakeRef.current = () => {};
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      svgRef.current?.closest('.sidepanel')?.classList.remove('graph-motion');
    };
  }, [physicsOn, links, projectOf]);

  /**
   * Effektive Positionen: mit Physik die Simulation, ohne das statische Layout.
   *
   * M223: BEWUSST ohne useMemo. Die Simulation läuft außerhalb von React; eine
   * Memo hätte nach dem Ausschwingen alte Koordinaten festgehalten, und der
   * nächste beliebige Render (Ebene umschalten, tippen) hätte alle Knoten an
   * ihre Startplätze zurückspringen lassen. Die Kopie kostet bei Board-Zahlen
   * dieser Größenordnung nichts — Renders sind jetzt selten.
   */
  const pos = (() => {
    if (!physicsOn) return seedPos;
    const out = new Map<string, { x: number; y: number }>();
    for (const [id, p] of simPos.current) out.set(id, { x: p.x, y: p.y });
    // Fallback fürs allererste Rendern (Sim noch nicht geseedet)
    for (const [id, p] of seedPos) if (!out.has(id)) out.set(id, p);
    return out;
  })();

  /**
   * M221: Die Gliederung als Gelände.
   *
   * Bereiche und Projekte werden nicht zu weiteren Knoten, sondern zu weichen
   * Flächen UNTER den Board-Knoten. Struktur gehört in den Hintergrund, sonst
   * kämpfen drei Knotenarten um dieselbe Aufmerksamkeit.
   *
   * Ein abgeschaltetes Sub-Brain (M220) wird dabei zur ausgegrauten Region —
   * der Zustand wird räumlich begreifbar, statt in einer Einstellungsliste zu
   * verschwinden, und lässt sich hier direkt umschalten.
   */
  // M223: Die Memo hält nur noch WELCHE Boards zu welcher Fläche gehören —
  // die Geometrie entsteht daraus beim Rendern UND in der Frame-Schleife.
  // Vorher hing sie an `pos` und wurde damit bei jedem Render neu gerechnet,
  // obwohl sich die Gliederung nur bei Strukturänderungen ändert.
  const regions = useMemo<RegionShape[]>(() => {
    if (!showRegions) return [];
    const out: RegionShape[] = [];
    spaces.forEach((sp, si) => {
      const accent = SPACE_ACCENTS[si % SPACE_ACCENTS.length];
      const schlaeft = brainOn && brainOffSpaces.includes(sp.id);
      const alle: string[] = [];
      for (const proj of sp.projects) {
        const ids = proj.boardIds.filter((id) => seedPos.has(id));
        if (ids.length === 0) continue;
        alle.push(...ids);
        // Projekt-Hüllen nur, wenn der Bereich mehr als eines hat — sonst
        // läge dieselbe Fläche doppelt übereinander
        if (sp.projects.length > 1) {
          out.push({ key: `p-${proj.id}`, kind: 'project', name: proj.name, accent, ids, pad: 34, spaceId: sp.id, schlaeft });
        }
      }
      if (alle.length === 0) return;
      out.push({ key: `s-${sp.id}`, kind: 'space', name: sp.name, accent, ids: alle, pad: 62, spaceId: sp.id, schlaeft });
    });
    // Bereichs-Flächen zuerst zeichnen, Projekte darüber
    return out.sort((a, b) => (a.kind === 'space' ? -1 : 1) - (b.kind === 'space' ? -1 : 1));
  }, [spaces, seedPos, showRegions, brainOn, brainOffSpaces]);

  /**
   * M222: Verbindungen zwischen Bereichen als BAND statt als fünfzig Fäden.
   *
   * Zwischen zwei gut verzahnten Bereichen laufen schnell Dutzende Portale und
   * Wikilinks. Einzeln gezeichnet ergeben sie Rauschen; gebündelt ergeben sie
   * eine Aussage: „Zwischen Bauleitplanung und Rechtsamt läuft viel." Die
   * Stärke des Bands zeigt, wie viel — die Beschriftung sagt es genau.
   */
  const bundles = useMemo<BundleShape[]>(() => {
    if (!showRegions) return [];
    const spaceOf = new Map<string, string>();
    for (const sp of spaces) for (const p of sp.projects) for (const id of p.boardIds) spaceOf.set(id, sp.id);
    const zaehler = new Map<string, number>();
    for (const l of links) {
      if (l.kind === 'vorschlag') continue; // Vorschläge sind keine echten Wege
      const a = spaceOf.get(l.a);
      const b = spaceOf.get(l.b);
      if (!a || !b || a === b) continue;    // innerhalb eines Bereichs: kein Band
      const key = [a, b].sort().join('|');
      zaehler.set(key, (zaehler.get(key) ?? 0) + 1);
    }
    // Wie bei den Hüllen: nur die ZUGEHÖRIGKEIT merken, die Mittelpunkte
    // rechnet die Frame-Schleife — sonst klebten die Bänder an alten Orten
    const boardsOf = new Map<string, string[]>();
    for (const sp of spaces) {
      const ids = sp.projects.flatMap((p) => p.boardIds).filter((id) => seedPos.has(id));
      if (ids.length > 0) boardsOf.set(sp.id, ids);
    }
    const namen = new Map(spaces.map((sp) => [sp.id, sp.name]));
    return [...zaehler.entries()].flatMap(([key, n]) => {
      const [a, b] = key.split('|');
      const ia = boardsOf.get(a);
      const ib = boardsOf.get(b);
      if (!ia || !ib) return [];
      return [{ key, aIds: ia, bIds: ib, n, label: `${namen.get(a)} ↔ ${namen.get(b)}: ${n}` }];
    });
  }, [links, spaces, seedPos, showRegions]);

  // Die Frame-Schleife liest beides über Refs — so bleibt sie unabhängig
  // davon, wann React zuletzt gerendert hat (M223)
  regionsRef.current = regions;
  bundlesRef.current = bundles;

  // ---------- M195: Knoten ziehen (stupst die Nachbarn physikalisch an) ----------
  const dragNode = useRef<string | null>(null);
  const dragMoved = useRef(false);
  /**
   * M223: Die Maße des SVG werden HÖCHSTENS EINMAL PRO FRAME gemessen.
   *
   * getBoundingClientRect ist ein erzwungenes Layout. Bei jedem Zeiger- oder
   * Rad-Ereignis gemessen — und dazwischen die viewBox geschrieben — entsteht
   * das klassische Layout-Thrashing: Lesen erzwingt, was das Schreiben gerade
   * ungültig gemacht hat. Bei 250 Ereignissen pro Sekunde war das der teuerste
   * Posten der ganzen Ansicht.
   */
  const rectCache = useRef<DOMRect | null>(null);
  const rectStale = useRef(true);
  const svgRect = (): DOMRect | null => {
    const el = svgRef.current;
    if (!el) return null;
    if (rectStale.current || !rectCache.current) {
      rectCache.current = el.getBoundingClientRect();
      rectStale.current = false;
    }
    return rectCache.current;
  };
  /** Neu vermessen, wenn sich die Lage GEÄNDERT haben kann — nicht pro Frame:
   *  Größenwechsel, Scrollen und der Beginn einer neuen Geste. */
  const rectVeraltet = () => { rectStale.current = true; };
  useEffect(() => {
    window.addEventListener('scroll', rectVeraltet, true);
    window.addEventListener('resize', rectVeraltet);
    return () => {
      window.removeEventListener('scroll', rectVeraltet, true);
      window.removeEventListener('resize', rectVeraltet);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Bildschirm → Graph-Koordinaten (berücksichtigt viewBox + meet-Zentrierung) */
  const toGraph = (cx: number, cy: number) => {
    const rect = svgRect();
    if (!rect) return { x: 0, y: 0 };
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
    // M234: Gedrückt halten öffnet das Knoten-Menü — mit Finger UND mit Maus.
    // Vorher gab es dafür nur den Rechtsklick bzw. das vom Browser aus einem
    // langen Tipp erzeugte contextmenu-Ereignis. Das ist keine verlässliche
    // Grundlage: Ob und wann ein Browser aus einem Langdruck ein contextmenu
    // macht, ist Geschmackssache des Herstellers, und am Notebook-Trackpad
    // ist der Rechtsklick für viele gar keine geläufige Geste (User-Report:
    // „funktioniert nur am Touchscreen"). Der Langdruck gehört ohnehin
    // niemandem: Ziehen beginnt erst ab 7 px, ein Tipp zählt erst beim
    // Loslassen — halten ohne Bewegung war bis hierher tote Zeit.
    langdruckStart(id, e);
    if (!physicsOn) return;
    rectVeraltet();   // neue Geste → einmal frisch vermessen (M223)
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
    wake();                                         // ruhende Schleife starten
    // KEIN Render hier: Die rAF-Schleife schreibt die Frames selbst — ein zweiter
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
  const portalAnlegen = useBoard((s) => s.portalAnlegen);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; boardId: string } | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  // M205: Menü an einer angeklickten Vorschlags-Kante (annehmen/ablehnen)
  const [sugMenu, setSugMenu] = useState<{ x: number; y: number; a: string; b: string; score: number } | null>(null);
  const onNodeContext = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    langdruckEnde();
    setCtxMenu({ x: e.clientX, y: e.clientY, boardId: id });
  };

  /**
   * M234: Langdruck als zweiter, geräteunabhängiger Weg zum Knoten-Menü.
   *
   * Maus, Stift und Finger laufen durch dieselbe Zeitmessung — es gibt keinen
   * Zweig „nur Touch" und keinen „nur Desktop", also auch nichts, was auf
   * einem der beiden ausfallen kann. 480 ms sind lang genug, dass ein
   * gewöhnlicher Klick nicht versehentlich auslöst, und kurz genug, dass man
   * nicht wartend dasteht.
   */
  const druckUhr = useRef(0);
  const druckAb = useRef({ x: 0, y: 0 });
  const langdruckEnde = () => {
    if (druckUhr.current) { window.clearTimeout(druckUhr.current); druckUhr.current = 0; }
  };
  const langdruckStart = (id: string, e: React.PointerEvent) => {
    langdruckEnde();
    if (e.button !== 0 && e.pointerType === 'mouse') return;   // Rechtsklick hat seinen eigenen Weg
    const x = e.clientX, y = e.clientY;
    druckAb.current = { x, y };
    druckUhr.current = window.setTimeout(() => {
      druckUhr.current = 0;
      // Aus dem Ziehen aussteigen und das folgende Loslassen entwerten —
      // sonst öffnete der Finger beim Abheben zusätzlich das Board.
      dragNode.current = null;
      dragMoved.current = true;
      setCtxMenu({ x, y, boardId: id });
    }, 480);
  };
  /** Wer den Zeiger bewegt, will ziehen oder schieben — kein Menü. */
  const langdruckPruefen = (e: React.PointerEvent) => {
    if (!druckUhr.current) return;
    if (Math.abs(e.clientX - druckAb.current.x) + Math.abs(e.clientY - druckAb.current.y) > 8) langdruckEnde();
  };
  const boardName = (id: string) => scoped.find((b) => b.id === id)?.name ?? '?';
  // Esc bricht Verknüpfen/Menü ab; Klick irgendwo schließt das Menü
  useEffect(() => {
    if (!ctxMenu && !linkFrom && !sugMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCtxMenu(null); setLinkFrom(null); setSugMenu(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest?.('.ov-graph-ctx') || t.closest?.('.ov-graph-suggest-hit')) return;
      setCtxMenu(null); setSugMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [ctxMenu, linkFrom, sugMenu]);

  /** Vorschlag annehmen: Portal vom aktuell offenen (oder erstgenannten) Board
   *  aus — seit M262 legt der Store drüben den Rückverweis gleich mit an. */
  const acceptSuggestion = (a: string, b: string) => {
    const from = a === activeId ? a : (b === activeId ? b : a);
    const to = from === a ? b : a;
    portalAnlegen(from, to, { x: 80, y: 80 });
    setSugMenu(null);
  };
  /** Ziel angeklickt: Portal-Karten auf BEIDEN Boards anlegen — eine ECHTE
   *  Verbindung im Datenmodell (undo-fähig), nicht nur ein Strich im Bild */
  const completeLink = (targetId: string) => {
    if (!linkFrom || linkFrom === targetId) { setLinkFrom(null); return; }
    portalAnlegen(linkFrom, targetId, { x: 80, y: 80 });
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
  /**
   * M223: Die viewBox ist KEIN React-Zustand mehr im engeren Sinn.
   *
   * Pannen und Zoomen liefen vorher über setVb — ein voller Reconcile des
   * kompletten SVG (Gelände, Bänder, alle Kanten, Satelliten, Knoten) pro
   * Zeigerbewegung bzw. pro Rad-Rastung. Bei 250 Ereignissen/s bricht das
   * jedes Gerät (gemessen: 21 fps beim Rad-Zoom auf Handy-Leistung).
   *
   * Jetzt: `vbRef` ist die Wahrheit und wird sofort ins DOM geschrieben —
   * das ist ein Attribut, kein Layout. React erfährt nur dann davon, wenn
   * sich etwas SICHTBAR ändert: eine Größenstufe, der Detailgrad oder die
   * Gliederungs-Ebene — und selbst dann höchstens einmal pro Frame.
   * Reines Verschieben rendert gar nicht mehr.
   */
  const [vb, setVb] = useState({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H });
  const vbRef = useRef(vb);
  const rectWRef = useRef(0);
  /**
   * M223: Der Ausschnitt bewegt sich als TRANSFORM einer Gruppe, nicht mehr
   * über die viewBox des SVG.
   *
   * Das ist der Unterschied zwischen ruckelig und flüssig: Eine geänderte
   * viewBox zwingt den Browser, das gesamte SVG NEU ZU VERMESSEN — inklusive
   * aller Textmetriken. Gemessen waren das beim Zoomen 1,3 von 3 Sekunden
   * reine Layout-Zeit. Ein transform dagegen ist reines Zeichnen; die Maße
   * bleiben gültig. (React Flow auf den Boards macht es genauso — deshalb
   * fühlt sich das Board flüssiger an als das Netz.)
   */
  const vpRef = useRef<SVGGElement | null>(null);
  /** Fingerabdruck der Zoomstufe: nur wenn er sich ändert, muss React ran */
  const stufe = (w: number) =>
    `${sizeStep(w)}|${lodOf((rectWRef.current || GRAPH_W) / w)}|${geoOf(GRAPH_W / w)}`;
  const committedStufe = useRef(stufe(vb.w));
  const commitRaf = useRef(0);
  /** Maßstab wie bei preserveAspectRatio="meet": einheitlich, zentriert */
  const fitScale = (v: { w: number; h: number }, rect: { width: number; height: number }) =>
    Math.min(rect.width / v.w, rect.height / v.h);
  const paintVb = (v: { x: number; y: number; w: number; h: number }) => {
    const g = vpRef.current;
    const rect = svgRect();
    if (!g || !rect) return;
    const k = fitScale(v, rect);
    const ox = (rect.width - v.w * k) / 2;
    const oy = (rect.height - v.h * k) / 2;
    // CSS-transform statt transform-Attribut: Blink kann die Gruppe damit auf
    // eine eigene Ebene heben (will-change) und schiebt sie beim Zoomen, statt
    // das SVG neu zu vermessen.
    g.style.transform = `translate(${ox - v.x * k}px, ${oy - v.y * k}px) scale(${k})`;
    // Für Tests und Fehlersuche einsehbar — data-Attribute lösen kein Layout aus
    svgRef.current?.setAttribute('data-view', `${v.x} ${v.y} ${v.w} ${v.h}`);
  };
  /**
   * Der React-Durchlauf, der die bildschirmfesten Größen nachzieht, kommt
   * höchstens alle 150 ms — mit garantiertem Abschluss-Durchlauf.
   *
   * Warum nicht pro Frame: Jeder dieser Durchläufe vermisst 200+ Elemente neu
   * (auf Handy-Leistung rund 12 ms). Beim Zoomen mit dem Rad oder zwei Fingern
   * kamen sie 60-mal pro Sekunde und fraßen das Frame-Budget. Dazwischen
   * skaliert die Schrift kurz mit — am Ende der Geste sitzt wieder alles exakt.
   */
  const letzterCommit = useRef(0);
  const commitTimer = useRef(0);
  const planeCommit = () => {
    if (commitTimer.current) return;
    const seit = performance.now() - letzterCommit.current;
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = 0;
      letzterCommit.current = performance.now();
      committedStufe.current = stufe(vbRef.current.w);
      setVb(vbRef.current);
    }, Math.max(0, 150 - seit));
  };
  const applyVb = (next: { x: number; y: number; w: number; h: number }) => {
    vbRef.current = next;
    paintVb(next);
    if (stufe(next.w) !== committedStufe.current) planeCommit();
  };
  useEffect(() => () => {
    if (commitRaf.current) cancelAnimationFrame(commitRaf.current);
    if (commitTimer.current) clearTimeout(commitTimer.current);
  }, []);
  // Nach JEDEM Render den echten Ausschnitt wiederherstellen: React kennt beim
  // Commit nur den (nach reinem Pannen veralteten) Zustandswert.
  useLayoutEffect(() => { paintVb(vbRef.current); });
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
    {
      const v = vbRef.current;
      const rect = svgRect();
      if (!rect) return;
      // Zoomstufe begrenzen: 10× rein bis 2,5× raus
      const w = Math.min(GRAPH_W * 2.5, Math.max(GRAPH_W / 10, v.w * f));
      const realF = w / v.w;
      if (realF === 1) return;
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
      applyVb(next);
    }
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
    applyVb({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  }, [pos, activeId]);

  // Rad-Zoom braucht preventDefault → nativer non-passive Listener
  // (Reacts onWheel ist am Root passiv registriert)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let letztesRad = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Nur zu Beginn eines Rad-Schubs neu vermessen — dazwischen bleibt die
      // Lage gleich, und jede Messung wäre ein erzwungenes Layout (M223)
      const jetzt = e.timeStamp;
      if (jetzt - letztesRad > 300) rectVeraltet();
      letztesRad = jetzt;
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // zoomAt nutzt nur Refs + funktionales setState — Closure bleibt gültig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    rectVeraltet();   // neue Geste → einmal frisch vermessen (M223)
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
    langdruckPruefen(e);   // M234: bewegt = ziehen/schieben, kein Menü
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
      // M223: Reines Verschieben ändert den Maßstab nicht — es geht direkt
      // ins Attribut, ganz ohne React-Durchlauf.
      const rect = svgRect();
      if (!rect) return;
      const v = vbRef.current;
      const sc = Math.min(rect.width / v.w, rect.height / v.h);
      applyVb({ ...v, x: v.x - dx / sc, y: v.y - dy / sc });
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
    langdruckEnde();   // M234: losgelassen, bevor die Zeit um war
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

  // M203: Satelliten leben RELATIV in einer Gruppe pro Board — die Gruppe wird
  // pro Frame nur noch verschoben (ein transform), Punkte/Titel/Binnen-Linien
  // sind statische Kinder. Vorher wurden alle Absolut-Koordinaten je Frame
  // neu gerechnet und gerendert.
  const satellites = useMemo(() => satelliteMeta.map((b) => {
    const ring = r(b.total) + 34;
    const dotPos = new Map<string, { x: number; y: number }>();
    const dots = b.cards.map((c, i) => {
      const angle = (i / Math.max(1, b.cards.length)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * ring;
      const y = Math.sin(angle) * ring;
      dotPos.set(c.nodeId, { x, y });
      return { key: `${b.boardId}:${c.nodeId}`, x, y, title: c.title, nodeId: c.nodeId };
    });
    const lines = b.edges.flatMap((e) => {
      const a = dotPos.get(e.s), c2 = dotPos.get(e.t);
      return a && c2 ? [{ x1: a.x, y1: a.y, x2: c2.x, y2: c2.y }] : [];
    });
    return { boardId: b.boardId, dots, lines };
  }), [satelliteMeta]);

  // ---------- Semantischer Zoom: Detailgrad folgt der Zoomstufe ----------
  // Maßstab = ECHTE Bildschirm-Pixel pro SVG-Einheit (gemessen, nicht relativ
  // zur Graph-Breite — sonst ist auf dem Handy alles ⅓ so groß wie gedacht).
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      rectStale.current = true;              // gecachte Maße sind hinfällig
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rectW = box.w;
  rectWRef.current = rectW;
  // Maßstab EXAKT wie im Transform (meet: der kleinere der beiden Faktoren) —
  // sonst passen bildschirmfeste Größen nicht zur tatsächlichen Darstellung
  const scale = box.w > 0 && box.h > 0 ? fitScale(vb, { width: box.w, height: box.h }) : GRAPH_W / vb.w;
  // Stufe 0 (zu klein für Details): nur Boards + Namen. Stufe 1: Karten-Punkte.
  // Stufe 2 (nah): Karten-Titel an den Punkten.
  const lod = lodOf(scale);
  /**
   * M222: Der Zoom wechselt die GLIEDERUNGS-Ebene.
   *
   * Weit draußen interessiert niemanden, wie ein einzelnes Board heißt — dort
   * zählt, welche Bereiche es überhaupt gibt und wie stark sie zusammenhängen.
   * Näher heran treten die Projekte hervor, ganz nah die Boards selbst.
   *
   * Der Wechsel läuft über eine Klasse am SVG, nicht über bedingtes Rendern:
   * So blenden CSS-Übergänge die Ebenen ineinander, statt dass Elemente
   * schlagartig verschwinden — genau das Flackern, das solche Ansichten
   * unruhig macht.
   *
   * Maßstab ist die Zoomstufe (wie viel vom Netz im Bild liegt), NICHT die
   * Bildschirmgröße: Sonst stünde ein Handy dauerhaft auf Bereichs-Ebene und
   * ein großer Monitor nie. `zoom` ist 1, wenn alles eingepasst ist, und läuft
   * von 0,4 (ganz heraus) bis 10 (ganz heran) — die Grenzen aus `zoomAt`.
   */
  const geoLevel = geoOf(GRAPH_W / vb.w);
  /** Wunschgröße in Bildschirm-Pixeln → SVG-Einheiten (konstant auf dem Schirm) */
  const ui = (px: number) => px / scale;
  scaleRef.current = scale;

  return (
    <div className={`ov-graph ${embedded ? "embedded" : ""}`}>
      <div className="ov-graph-toggles nodrag">
        {([
          ['Karten', 'cards', showCards],
          ['Portale', 'portals', showPortals],
          ['Wikilinks', 'wikis', showWikis],
          ['Gliederung', 'regionen', showRegions],
          ['Physik', 'physik', physicsOn],
          ...(brainOn ? [['🧠 Vorschläge', 'vorschlaege', showSuggest] as const] : []),
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
        data-view={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className={`ov-graph-svg geo-${geoLevel}`}
        role="img"
        aria-label="Board-Netz"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {/* M223: EINE Gruppe trägt Verschiebung und Zoom — Pan/Zoom sind damit
            reines Zeichnen statt einer Neuvermessung des ganzen SVG */}
        <g className="ov-graph-vp" ref={vpRef}>
        {/* M221: Gelände zuerst — alles Weitere liegt darauf */}
        {regions.map((rg) => {
          const geo = regionGeo(rg.ids, rg.pad, (id) => pos.get(id));
          if (!geo) return null;
          return (
            <g
              key={rg.key}
              className={`ov-region ov-region-${rg.kind} ${rg.schlaeft ? 'schlaeft' : ''}`}
              onClick={() => { if (brainOn) toggleBrainSpace(rg.spaceId); }}
            >
              <title>
                {rg.schlaeft
                  ? `„${rg.name}" ist nicht Teil des Gehirns — klicken zum Einschalten`
                  : `${rg.kind === 'space' ? 'Bereich' : 'Projekt'} „${rg.name}"${brainOn ? ' — klicken, um ihn aus dem Gehirn zu nehmen' : ''}`}
              </title>
              <path
                ref={(el) => { if (el) regionEls.current.set(rg.key, el); else regionEls.current.delete(rg.key); }}
                d={geo.d}
                style={{ color: rg.accent }}
              />
              {rg.kind === 'space' && (
                <text
                  ref={(el) => { if (el) regionTextEls.current.set(rg.key, el); else regionTextEls.current.delete(rg.key); }}
                  x={geo.label.x} y={geo.label.y} style={{ color: rg.accent }} fontSize={ui(15)}
                >
                  {rg.schlaeft ? `${rg.name} · schläft` : rg.name}
                </text>
              )}
            </g>
          );
        })}
        {/* M222: Bänder zwischen Bereichen — nur weit draußen, dort ersetzen
            sie die Einzellinien und machen die Verzahnung erst lesbar */}
        {bundles.map((bd) => {
          const a = groupMid(bd.aIds, (id) => pos.get(id));
          const b = groupMid(bd.bIds, (id) => pos.get(id));
          if (!a || !b) return null;
          return (
            <g key={`bd-${bd.key}`} className="ov-bundle">
              <title>{bd.label}</title>
              <line
                ref={(el) => { if (el) bundleEls.current.set(bd.key, el); else bundleEls.current.delete(bd.key); }}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                strokeWidth={ui(Math.min(22, 4 + bd.n * 2.4))}
              />
              <text
                ref={(el) => { if (el) bundleTextEls.current.set(bd.key, el); else bundleTextEls.current.delete(bd.key); }}
                x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - ui(9)} fontSize={ui(13)}
              >
                {bd.n}
              </text>
            </g>
          );
        })}
        {links.map((l, i) => {
          if (l.kind === 'portal' && !showPortals) return null;
          if (l.kind === 'wikilink' && !showWikis) return null;
          const a = pos.get(l.a), b = pos.get(l.b);
          if (!a || !b) return null;
          // M205: Vorschlag — gestrichelt in Akzentfarbe, anklickbar (breite
          // unsichtbare Trefferlinie darunter, sonst trifft man 1,5px nie)
          if (l.kind === 'vorschlag') {
            return (
              <g key={`sug-${l.a}-${l.b}`} className="ov-graph-suggest">
                <line
                  ref={(el) => { if (el) linkEls.current.set(i, el); else linkEls.current.delete(i); }}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  strokeWidth={ui(2)} strokeDasharray={`${ui(7)} ${ui(6)}`}
                />
                <line
                  className="ov-graph-suggest-hit"
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  strokeWidth={ui(16)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSugMenu({ x: e.clientX, y: e.clientY, a: l.a, b: l.b, score: l.score ?? 0 });
                  }}
                >
                  <title>{`Vorschlag: „${boardName(l.a)}" ↔ „${boardName(l.b)}" (${Math.round((l.score ?? 0) * 100)} % inhaltliche Nähe) — anklicken`}</title>
                </line>
              </g>
            );
          }
          return (
            <line
              key={i}
              ref={(el) => { if (el) linkEls.current.set(i, el); else linkEls.current.delete(i); }}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={l.kind === 'portal' ? 'rgba(79,124,255,.5)' : 'rgba(120,110,90,.45)'}
              strokeWidth={l.kind === 'portal' ? ui(2) : ui(1.5)}
              strokeDasharray={l.kind === 'wikilink' ? `${ui(5)} ${ui(4)}` : undefined}
            />
          );
        })}
        {lod >= 1 && satellites.map((sb) => {
          const center = pos.get(sb.boardId);
          if (!center) return null;
          return (
            <g
              key={`sat-${sb.boardId}`}
              ref={(el) => { if (el) satEls.current.set(sb.boardId, el); else satEls.current.delete(sb.boardId); }}
              transform={`translate(${center.x} ${center.y})`}
            >
              {sb.lines.map((l, i) => (
                <line key={`c${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(120,110,90,.3)" strokeWidth={ui(1)} />
              ))}
              {sb.dots.map((d) => (
                <g
                  key={d.key}
                  className={`ov-graph-dot ${marking ? (hits.cards.has(d.key) ? 'hit' : 'dim') : ''}`}
                  onClick={() => { openBoard(sb.boardId); focusNode(sb.boardId, d.nodeId); }}
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
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const rad = r(n.cards);
          return (
            <g
              key={n.id}
              // M203: Kinder sitzen im Ursprung, die GRUPPE wird verschoben —
              // pro Frame ändert sich nur noch dieses eine transform-Attribut
              ref={(el) => { if (el) nodeEls.current.set(n.id, el); else nodeEls.current.delete(n.id); }}
              transform={`translate(${p.x} ${p.y})`}
              className={`ov-graph-node ${n.id === activeId ? 'here' : ''} ${marking ? (hits.boards.has(n.id) ? 'hit' : 'dim') : ''} ${linkFrom === n.id ? 'linking' : ''}`}
              data-tip={linkFrom
                ? `Klicken: Portal „${boardName(linkFrom)}" → „${n.label}" anlegen`
                // M234: Der zweite Weg gehört in die Sprechblase — ein Menü,
                // von dem niemand weiß, gibt es für den Benutzer nicht.
                : `${previewOf(n.id)}\n— Gedrückt halten oder Rechtsklick: Menü`}
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
              {n.id === activeId && <circle className="ov-graph-here" r={rad + ui(7)} strokeWidth={ui(2.5)} />}
              <circle r={rad} strokeWidth={ui(2)} />
              <text
                x={0} y={rad + ui(17)} textAnchor="middle"
                // Deckel in SVG-Einheiten: weit rausgezoomt schrumpfen Namen,
                // statt sich gegenseitig zu überlagern
                fontSize={Math.min(ui(13.5), 30)}
                stroke="var(--bg)" strokeWidth={Math.min(ui(3.5), 7)} paintOrder="stroke"
              >
                {n.label.slice(0, 24)}
              </text>
              {lod >= 1 && (
                <text x={0} y={ui(4)} textAnchor="middle" className="ov-graph-count" fontSize={Math.min(ui(10), 20)}>
                  {n.cards}
                </text>
              )}
            </g>
          );
        })}
        </g>
      </svg>
      <div className="ov-graph-zoom nodrag">
        <button onClick={() => zoomButton(1 / 1.35)} title="Vergrößern" aria-label="Vergrößern"><IZoomIn size={16} /></button>
        <button onClick={() => zoomButton(1.35)} title="Verkleinern" aria-label="Verkleinern"><IZoomOut size={16} /></button>
        <button
          onClick={() => { followActive.current = false; applyVb({ x: 0, y: 0, w: GRAPH_W, h: GRAPH_H }); }}
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
      {sugMenu && (
        <div className="ov-graph-ctx nodrag" style={{ left: sugMenu.x, top: sugMenu.y }}>
          <div className="ov-graph-ctx-title">
            🧠 Vorschlag · {Math.round(sugMenu.score * 100)} % Nähe
          </div>
          <div className="ov-graph-ctx-sub">
            „{boardName(sugMenu.a)}" ↔ „{boardName(sugMenu.b)}"
          </div>
          <button onClick={() => acceptSuggestion(sugMenu.a, sugMenu.b)}>Verknüpfen (Portal anlegen)</button>
          <button onClick={() => { openBoard(sugMenu.a); setSugMenu(null); }}>„{boardName(sugMenu.a)}" öffnen</button>
          <button onClick={() => { openBoard(sugMenu.b); setSugMenu(null); }}>„{boardName(sugMenu.b)}" öffnen</button>
          <button onClick={() => { rejectLink(sugMenu.a, sugMenu.b); setSugMenu(null); }}>Passt nicht — nicht mehr vorschlagen</button>
        </div>
      )}
      {ctxMenu && (
        <div className="ov-graph-ctx nodrag" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="ov-graph-ctx-title">{boardName(ctxMenu.boardId)}</div>
          <button onClick={() => { openBoard(ctxMenu.boardId); setCtxMenu(null); }}>Board öffnen</button>
          <button onClick={() => { setLinkFrom(ctxMenu.boardId); setCtxMenu(null); }}>Verknüpfen mit … (Portal)</button>
          <button onClick={() => {
            const p = pos.get(ctxMenu.boardId);
            if (p) { followActive.current = false; applyVb({ x: p.x - GRAPH_W / 3.8, y: p.y - GRAPH_H / 3.8, w: GRAPH_W / 1.9, h: GRAPH_H / 1.9 }); }
            setCtxMenu(null);
          }}>Hierher zoomen</button>
          {physicsOn && (
            <button onClick={() => { alpha.current = 1; wake(); setCtxMenu(null); }}>Netz neu ausschwingen</button>
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

