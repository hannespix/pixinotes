import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useBoard } from '../store';

/**
 * Verbindung mit editierbarem Label. Auf die Mitte klicken → Text eingeben
 * (z. B. „blockiert", „gehört zu"). Leeres Label zeigt beim Hover ein „+".
 * ✕ löscht die Verbindung. Labels sind Freitext.
 */
export function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const updateEdgeLabel = useBoard((s) => s.updateEdgeLabel);
  const removeEdge = useBoard((s) => s.removeEdge);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const label = (data?.label as string) ?? '';

  const startEdit = () => {
    setDraft(label);
    setEditing(true);
  };
  const commit = () => {
    updateEdgeLabel(id, draft.trim());
    setEditing(false);
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: selected ? '#4f7cff' : 'rgba(90,80,60,.45)', strokeWidth: selected ? 2.5 : 2 }} />
      <EdgeLabelRenderer>
        <div
          className={`edge-label nodrag nopan ${label ? '' : 'empty'} ${selected ? 'selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {editing ? (
            <input
              autoFocus
              className="edge-label-input"
              value={draft}
              placeholder="Beziehung…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <span className="edge-label-text" onClick={startEdit} title="Klick: Beziehung benennen">
              {label || '+'}
            </span>
          )}
          {!editing && (
            <button className="edge-label-x" title="Verbindung löschen" onClick={() => removeEdge(id)}>
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
