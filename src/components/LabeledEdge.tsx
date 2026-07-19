import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  MarkerType,
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

/** Verbindungs-Stile für Prozessdiagramme */
export type EdgeKind = 'arrow' | 'line' | 'dashed' | 'step';

const KIND_CYCLE: EdgeKind[] = ['arrow', 'step', 'dashed', 'line'];
const KIND_LABEL: Record<EdgeKind, string> = {
  arrow: '→ Pfeil',
  step: '⌐ Winkel',
  dashed: '⇢ gestrichelt',
  line: '— Linie',
};

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
  const removeEdge = useBoard((s) => s.removeEdge);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const kind = (data?.kind as EdgeKind) ?? 'arrow';
  const label = (data?.label as string) ?? '';

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
    // Moderate Biegung — harmonischer Schwung statt weiter Bögen
    const bend = Math.min(110, Math.max(30, dist * 0.22));
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
    // Versatz o der Kurvenmitte → Kontrollpunkte (Mitte einer Kubik wandert
    // um 0,75·d, wenn beide Kontrollpunkte um d verschoben werden)
    const ctrl = (o: number) => {
      const d = (o * 4) / 3;
      return {
        c1x: ax + nsx * bend + mnx * d, c1y: ay + nsy * bend + mny * d,
        c2x: bx + ntx * bend + mnx * d, c2y: by + nty * bend + mny * d,
      };
    };
    const blockedAt = (o: number): boolean => {
      const c = ctrl(o);
      for (let i = 1; i < 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        const px = u * u * u * ax + 3 * u * u * t * c.c1x + 3 * u * t * t * c.c2x + t * t * t * bx;
        const py = u * u * u * ay + 3 * u * u * t * c.c1y + 3 * u * t * t * c.c2y + t * t * t * by;
        if (obstacles.some((r) => px > r.x1 && px < r.x2 && py > r.y1 && py < r.y2)) return true;
      }
      return false;
    };
    let off = pShift;
    if (blockedAt(off)) {
      for (const m of [70, 120, 180, 240]) {
        const cand = [pShift + m, pShift - m].find((o) => !blockedAt(o));
        if (cand !== undefined) { off = cand; break; }
      }
    }
    const c = ctrl(off);
    return {
      path: `M ${sx},${sy} L ${ax},${ay} C ${c.c1x},${c.c1y} ${c.c2x},${c.c2y} ${bx},${by} L ${tx},${ty}`,
      lx: (ax + 3 * c.c1x + 3 * c.c2x + bx) / 8,
      ly: (ay + 3 * c.c1y + 3 * c.c2y + by) / 8,
    };
  })();

  const [edgePath, labelX, labelY] = geo
    ? [geo.path, geo.lx, geo.ly]
    : kind === 'step'
      ? getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos })
      : getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });

  const stroke = selected ? 'var(--accent)' : 'var(--edge)'; // theme-sensitiv (hell/dunkel)
  const marker = kind === 'line'
    ? undefined
    : { type: MarkerType.ArrowClosed, width: 18, height: 18, color: stroke };

  const commit = () => { updateEdgeLabel(id, draft.trim()); setEditing(false); };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={marker ? `url(#pn-arrow-${selected ? 'sel' : 'def'})` : undefined}
        style={{
          stroke,
          strokeWidth: selected ? 2.5 : 2,
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
      </EdgeLabelRenderer>
    </>
  );
}

/** SVG-Pfeilspitzen-Definitionen — einmal im Board gerendert */
export function EdgeMarkerDefs() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        {(['def', 'sel'] as const).map((k) => (
          <marker
            key={k}
            id={`pn-arrow-${k}`}
            viewBox="0 0 12 12"
            refX="9"
            refY="6"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            {/* Deckende Füllung! Halbtransparent ließe die darunterliegende
                Linie durchscheinen — die „transparente Spitze" aus dem User-Report */}
            <path d="M1,1 L10,6 L1,11 Z" fill={k === 'sel' ? 'var(--accent)' : 'var(--edge-head)'} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
