import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import { selectActiveBoard, useBoard } from '../store';
import { getFloatingEdgeParams } from '../lib/floatingEdge';
import type { AppNode } from '../types';

/** Karten-Rechteck (leicht aufgebläht) für die Hindernis-Prüfung */
interface ORect { x1: number; y1: number; x2: number; y2: number }
const PAD = 10;
const rectOf = (n: AppNode): ORect => {
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : 260);
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : 170);
  return { x1: n.position.x - PAD, y1: n.position.y - PAD, x2: n.position.x + w + PAD, y2: n.position.y + h + PAD };
};

/** Verbindungs-Stile für Prozessdiagramme. 'line' ist ein Altbestand
 *  (Kurve ohne Spitze) — die Spitze ist seit M146 ein EIGENER Schalter. */
export type EdgeKind = 'arrow' | 'line' | 'dashed' | 'step';

const KIND_CYCLE: EdgeKind[] = ['arrow', 'step', 'dashed'];
const KIND_LABEL: Record<EdgeKind, string> = {
  arrow: '→ Kurve',
  step: '⌐ Winkel',
  dashed: '⇢ gestrichelt',
  line: '→ Kurve',
};

/** Feste Verbindungs-Farben (M146) — kräftig genug für helle wie dunkle Fläche.
 *  Die Pfeilspitzen-Marker unten sind aus DERSELBEN Liste erzeugt; ein Wert,
 *  der hier fehlt, hätte keine passende Spitze. */
export const EDGE_COLORS = ['#5b6470', '#4a7dbd', '#3f8a52', '#dd9a26', '#d05353', '#7d5bb8'];

/** Spitzenformen (M147) — für jede gibt es Marker in allen Farben */
export type HeadShape = 'arrow' | 'open' | 'circle' | 'diamond';
const SHAPE_CYCLE: HeadShape[] = ['arrow', 'open', 'circle', 'diamond'];
const SHAPE_NAME: Record<HeadShape, string> = {
  arrow: 'geschlossener Pfeil', open: 'offener Pfeil', circle: 'Kreis', diamond: 'Raute',
};

/** Linienstärken (M147): fein / normal / kräftig */
const WIDTHS = [1.4, 2, 3.2];

/**
 * Verbindung mit editierbarem Label und Stil-Umschaltung. Mitte anklicken →
 * Beziehung benennen (z. B. „blockiert", „ja/nein" im Flowchart); das Stil-
 * Icon wechselt Pfeil / Winkel-Route / gestrichelt / schlichte Linie.
 */
export function LabeledEdge({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}: EdgeProps) {
  const updateEdgeLabel = useBoard((s) => s.updateEdgeLabel);
  const updateEdgeKind = useBoard((s) => s.updateEdgeKind);
  const updateEdgeStyle = useBoard((s) => s.updateEdgeStyle);
  const removeEdge = useBoard((s) => s.removeEdge);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const kind = (data?.kind as EdgeKind) ?? 'arrow';
  const label = (data?.label as string) ?? '';
  // M146: Pfeilspitze unabhängig vom Linienstil — Altbestand 'line' hieß „ohne Spitze"
  const head = typeof data?.head === 'boolean' ? (data.head as boolean) : kind !== 'line';
  const custom = (data?.color as string) ?? '';
  // M147: Start-Spitze, Spitzenform und Linienstärke je Verbindung
  const headStart = data?.headStart === true;
  const shape: HeadShape = SHAPE_CYCLE.includes(data?.shape as HeadShape) ? (data?.shape as HeadShape) : 'arrow';
  const width = typeof data?.width === 'number' ? (data.width as number) : 2;

  // Floating: Andockpunkte aus den echten Knoten-Rechtecken berechnen — die
  // Linie tritt immer an der zugewandten Seite aus, keine Schleifen mehr.
  // Fallback auf die Handle-Koordinaten, falls die Knoten (noch) nicht vermessen sind.
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY;
  let sPos = sourcePosition, tPos = targetPosition;
  if (sourceNode && targetNode && sourceNode.measured.width && targetNode.measured.width) {
    const p = getFloatingEdgeParams(sourceNode, targetNode);
    if (Number.isFinite(p.sx) && Number.isFinite(p.tx)) {
      ({ sx, sy, tx, ty } = p);
      sPos = p.sourcePos;
      tPos = p.targetPos;
    }
  }

  // M132: Kanten-Routing gegen den „Kabelsalat" — (a) laufen mehrere Kanten
  // zwischen denselben Karten, fächern sie mit Versatz auf; (b) schneidet der
  // Direktweg FREMDE Karten, weicht die Kante mit einem Bogen darum aus.
  const allNodes = useBoard((s) => selectActiveBoard(s).nodes);
  const allEdges = useBoard((s) => selectActiveBoard(s).edges);
  // M136/M137 — EINE Geometrie für alle Kurven-Kanten (Profi-Tool-Stil wie
  // Miro/Lucidchart): kurzer GERADER Stummel senkrecht aus dem Konnektor,
  // weiche kubische Kurve, GERADER Einlauf in den Ziel-Konnektor. Hindernis-
  // Ausweichen und Parallel-Auffächern (M132) verschieben dabei nur noch die
  // Kurvenmitte seitlich — Aus- und Einlauf bleiben IMMER senkrecht.
  const geo = (() => {
    if (kind === 'step') return null; // Winkel-Route bleibt bewusst rechtwinklig
    const dist = Math.hypot(tx - sx, ty - sy);
    if (dist < 4) return null;
    const normal = (p: typeof sPos): [number, number] =>
      p === 'left' ? [-1, 0] : p === 'right' ? [1, 0] : p === 'top' ? [0, -1] : [0, 1];
    const [nsx, nsy] = normal(sPos);
    const [ntx, nty] = normal(tPos);
    const stub = Math.min(22, dist / 4);
    const ax = sx + nsx * stub, ay = sy + nsy * stub;
    const bx = tx + ntx * stub, by = ty + nty * stub;

    // Parallel-Auffächerung: stabile Reihenfolge über sortierte Kanten-IDs
    const siblings = allEdges
      .filter((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source))
      .map((e) => e.id)
      .sort();
    const pShift = siblings.length > 1 ? (siblings.indexOf(id) - (siblings.length - 1) / 2) * 26 : 0;

    const obstacles = allNodes
      .filter((n) => n.id !== source && n.id !== target && !n.archived)
      .map(rectOf);
    const mnx = -(ty - sy) / dist, mny = (tx - sx) / dist; // Normale zum Direktweg
    // M138/M139: Basis ist EINE einzige Kubik mit Tangenten senkrecht zur
    // Kartenseite — knickfrei UND wellenfrei (eine Kubik kann höchstens ein
    // sanftes S bilden, nie eine Doppelwelle). Nur wenn Ausweichen/Auffächern
    // die Kurvenmitte seitlich verschiebt, wird die Kurve an der Mitte
    // geteilt — mit der ECHTEN Tangente der Basis-Kurve, nicht der Sehne.
    const chordX = bx - ax, chordY = by - ay;
    const clen = Math.hypot(chordX, chordY) || 1;
    const k = Math.min(110, clen / 3, Math.max(24, clen * 0.25)); // Griffweite
    const c1bx = ax + nsx * k, c1by = ay + nsy * k;
    const c2bx = bx + ntx * k, c2by = by + nty * k;
    // Basis-Kurve: Mittelpunkt + Tangentenrichtung bei t = 0,5
    const baseMidX = (ax + 3 * c1bx + 3 * c2bx + bx) / 8;
    const baseMidY = (ay + 3 * c1by + 3 * c2by + by) / 8;
    const tdx0 = (bx - ax) + (c2bx - c1bx);
    const tdy0 = (by - ay) + (c2by - c1by);
    const tdl = Math.hypot(tdx0, tdy0) || 1;
    const tdx = tdx0 / tdl, tdy = tdy0 / tdl;
    const geometry = (o: number) => {
      const midX = baseMidX + mnx * o;
      const midY = baseMidY + mny * o;
      const k1 = Math.min(k, Math.hypot(midX - ax, midY - ay) / 2.5);
      const k2 = Math.min(k, Math.hypot(bx - midX, by - midY) / 2.5);
      return {
        midX, midY,
        c1x: ax + nsx * k1, c1y: ay + nsy * k1,
        c2x: midX - tdx * k1, c2y: midY - tdy * k1,
        c3x: midX + tdx * k2, c3y: midY + tdy * k2,
        c4x: bx + ntx * k2, c4y: by + nty * k2,
      };
    };
    const cubicAt = (t: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
      const u = 1 - t;
      return {
        x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      };
    };
    const blockedAt = (o: number): boolean => {
      for (let i = 1; i < 18; i++) {
        const t = (i % 9) / 9 || 0.05;
        let p;
        if (o === 0) {
          p = cubicAt(i / 18, ax, ay, c1bx, c1by, c2bx, c2by, bx, by);
        } else {
          const g = geometry(o);
          p = i < 9
            ? cubicAt(t, ax, ay, g.c1x, g.c1y, g.c2x, g.c2y, g.midX, g.midY)
            : cubicAt(t, g.midX, g.midY, g.c3x, g.c3y, g.c4x, g.c4y, bx, by);
        }
        if (obstacles.some((r) => p.x > r.x1 && p.x < r.x2 && p.y > r.y1 && p.y < r.y2)) return true;
      }
      return false;
    };
    let off = pShift;
    if (blockedAt(off)) {
      // M140: bevorzugt NACH OBEN ausweichen — lange Rückläufer laufen dann
      // als flacher Bogen ÜBER dem Prozessband statt mitten durchs Bild
      const upFirst = mny > 0 ? -1 : 1;
      for (const m of [70, 120, 180, 240]) {
        const cand = [pShift + upFirst * m, pShift - upFirst * m].find((o) => !blockedAt(o));
        if (cand !== undefined) { off = cand; break; }
      }
    }
    if (off === 0) {
      // Normalfall: EINE Kurve — maximal harmonisch
      return {
        path: `M ${sx},${sy} L ${ax},${ay} C ${c1bx},${c1by} ${c2bx},${c2by} ${bx},${by} L ${tx},${ty}`,
        lx: baseMidX,
        ly: baseMidY,
      };
    }
    const g = geometry(off);
    return {
      path: `M ${sx},${sy} L ${ax},${ay}`
        + ` C ${g.c1x},${g.c1y} ${g.c2x},${g.c2y} ${g.midX},${g.midY}`
        + ` C ${g.c3x},${g.c3y} ${g.c4x},${g.c4y} ${bx},${by}`
        + ` L ${tx},${ty}`,
      lx: g.midX,
      ly: g.midY,
    };
  })();

  const [edgePath, labelX, labelY] = geo
    ? [geo.path, geo.lx, geo.ly]
    : kind === 'step'
      ? getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })
      : getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });

  // Eigene Farbe gewinnt auch bei Auswahl (Auswahl zeigt sich dann über die
  // dickere Linie) — ohne eigene Farbe bleibt alles theme-sensitiv wie bisher
  const stroke = custom || (selected ? 'var(--accent)' : 'var(--edge)');
  const colorIdx = EDGE_COLORS.indexOf(custom);
  const colorKey = custom ? (colorIdx >= 0 ? `c${colorIdx}` : 'def') : (selected ? 'sel' : 'def');
  const markerId = `pn-${shape}-${colorKey}`;

  const commit = () => { updateEdgeLabel(id, draft.trim()); setEditing(false); };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={head ? `url(#${markerId})` : undefined}
        markerStart={headStart ? `url(#${markerId})` : undefined}
        style={{
          stroke,
          strokeWidth: selected ? width + 0.5 : width,
          strokeDasharray: kind === 'dashed' ? '7 5' : undefined,
        }}
      />
      {/* Marker-Defs einmalig (React Flow eigene Marker sind fummelig bei Farbe) */}
      <EdgeLabelRenderer>
        <div
          className={`edge-label nodrag nopan ${label ? '' : 'empty'} ${selected ? 'selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {editing ? (
            <input
              autoFocus className="edge-label-input" value={draft} placeholder="Beziehung…"
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            />
          ) : (
            <>
              <span className="edge-label-text" onClick={() => { setDraft(label); setEditing(true); }} title="Klick: Beziehung benennen">
                {label || '+'}
              </span>
              <button
                className="edge-kind-btn"
                title={`Stil: ${KIND_LABEL[kind]} (klicken zum Wechseln)`}
                onClick={() => updateEdgeKind(id, KIND_CYCLE[(KIND_CYCLE.indexOf(kind) + 1) % KIND_CYCLE.length])}
              >
                {KIND_LABEL[kind][0]}
              </button>
              <button className="edge-label-x" title="Verbindung löschen" onClick={() => removeEdge(id)}>✕</button>
            </>
          )}
        </div>
        {/* M146/M147: feingliedrige Optionen — nur bei ausgewählter Verbindung */}
        {selected && !editing && (
          <div
            className="edge-opts nodrag nopan"
            style={{ transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 16}px)` }}
          >
            <div className="edge-opts-row">
              <button
                className={`edge-opt-btn ${headStart ? 'on' : ''}`}
                title={headStart ? 'Spitze am ANFANG entfernen' : 'Spitze auch am ANFANG (beidseitiger Pfeil)'}
                onClick={() => updateEdgeStyle(id, { headStart: !headStart })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 12h13" />
                  {headStart && <path d="m9 6-6 6 6 6" />}
                </svg>
              </button>
              <button
                className={`edge-opt-btn edge-opt-head ${head ? 'on' : ''}`}
                title={head ? 'Spitze am ENDE entfernen (schlichte Linie)' : 'Spitze am ENDE (gerichteter Pfeil)'}
                onClick={() => updateEdgeStyle(id, { head: !head })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12h13" />
                  {head && <path d="m12 6 6 6-6 6" />}
                </svg>
              </button>
              <button
                className="edge-opt-btn edge-opt-shape"
                title={`Spitzenform: ${SHAPE_NAME[shape]} (klicken zum Wechseln)`}
                onClick={() => updateEdgeStyle(id, { shape: SHAPE_CYCLE[(SHAPE_CYCLE.indexOf(shape) + 1) % SHAPE_CYCLE.length] })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {shape === 'arrow' && <path d="M6 5l12 7-12 7Z" fill="currentColor" />}
                  {shape === 'open' && <path d="m8 5 9 7-9 7" />}
                  {shape === 'circle' && <circle cx="12" cy="12" r="6" fill="currentColor" />}
                  {shape === 'diamond' && <path d="M12 4l7 8-7 8-7-8Z" fill="currentColor" />}
                </svg>
              </button>
              <span className="edge-opt-sep" />
              {WIDTHS.map((w, i) => (
                <button
                  key={w}
                  className={`edge-opt-btn edge-opt-width ${width === w ? 'on' : ''}`}
                  title={['Fein', 'Normal', 'Kräftig'][i]}
                  onClick={() => updateEdgeStyle(id, { width: w })}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round">
                    <path d="M3 12h18" strokeWidth={1 + i * 1.6} />
                  </svg>
                </button>
              ))}
            </div>
            <div className="edge-opts-row">
              <button
                className={`edge-color-dot default ${custom === '' ? 'on' : ''}`}
                title="Standardfarbe (folgt Hell/Dunkel)"
                onClick={() => updateEdgeStyle(id, { color: null })}
              />
              {EDGE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`edge-color-dot ${custom === c ? 'on' : ''}`}
                  style={{ background: c }}
                  title="Verbindungsfarbe"
                  onClick={() => updateEdgeStyle(id, { color: c })}
                />
              ))}
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/** SVG-Pfeilspitzen-Definitionen — einmal im Board gerendert. Je Spitzenform
 *  (M147) und Farbe (Standard, Auswahl, Palette M146) ein eigener Marker;
 *  orient="auto-start-reverse" lässt denselben Marker auch am ANFANG der
 *  Linie korrekt herum sitzen. */
export function EdgeMarkerDefs() {
  const colors: Array<[string, string]> = [
    ['def', 'var(--edge-head)'],
    ['sel', 'var(--accent)'],
    ...EDGE_COLORS.map((c, i) => [`c${i}`, c] as [string, string]),
  ];
  // Deckende Füllung! Halbtransparent ließe die darunterliegende Linie
  // durchscheinen — die „transparente Spitze" aus dem User-Report (M63)
  const shapeEl = (shape: HeadShape, c: string) => {
    switch (shape) {
      case 'open': return <path d="M2,1.5 L9.5,6 L2,10.5" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />;
      case 'circle': return <circle cx="6" cy="6" r="4" fill={c} />;
      case 'diamond': return <path d="M6,1 L11,6 L6,11 L1,6 Z" fill={c} />;
      default: return <path d="M1,1 L10,6 L1,11 Z" fill={c} />;
    }
  };
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {(['arrow', 'open', 'circle', 'diamond'] as HeadShape[]).flatMap((shape) =>
          colors.map(([k, fill]) => (
            <marker
              key={`${shape}-${k}`}
              id={`pn-${shape}-${k}`}
              viewBox="0 0 12 12"
              refX={shape === 'circle' ? 7 : 9}
              refY="6"
              markerWidth={shape === 'circle' || shape === 'diamond' ? 7 : 8}
              markerHeight={shape === 'circle' || shape === 'diamond' ? 7 : 8}
              orient="auto-start-reverse"
            >
              {shapeEl(shape, fill)}
            </marker>
          )))}
      </defs>
    </svg>
  );
}
