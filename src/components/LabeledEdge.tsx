import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  MarkerType,
  type EdgeProps,
} from '@xyflow/react';
import { useBoard } from '../store';

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
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}: EdgeProps) {
  const updateEdgeLabel = useBoard((s) => s.updateEdgeLabel);
  const updateEdgeKind = useBoard((s) => s.updateEdgeKind);
  const removeEdge = useBoard((s) => s.removeEdge);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const kind = (data?.kind as EdgeKind) ?? 'arrow';
  const label = (data?.label as string) ?? '';

  const [edgePath, labelX, labelY] =
    kind === 'step'
      ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
      : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const stroke = selected ? '#4f7cff' : 'rgba(90,80,60,.5)';
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
            <path d="M1,1 L10,6 L1,11 Z" fill={k === 'sel' ? '#4f7cff' : 'rgba(90,80,60,.7)'} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
