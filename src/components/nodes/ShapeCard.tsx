import { useState, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { ShapeKind, ShapeNode } from '../../types';
import { IPalette } from '../Icons';

const SHAPE_COLORS = ['#eef2ff', '#e6f7ec', '#fff4e0', '#ffe9ef', '#eef7ff', '#f3eeff', '#ffffff'];

const NEXT_SHAPE: Record<ShapeKind, ShapeKind> = {
  process: 'decision',
  decision: 'terminator',
  terminator: 'note',
  note: 'process',
};
const SHAPE_LABEL: Record<ShapeKind, string> = {
  process: 'Schritt (Rechteck)',
  decision: 'Entscheidung (Raute)',
  terminator: 'Start/Ende (Stadion)',
  note: 'Notizfeld',
};

/**
 * Prozess-Form für Flussdiagramme: Rechteck (Schritt), Raute (Entscheidung),
 * Stadion (Start/Ende), Notizfeld. Verbindungspunkte an allen 4 Seiten,
 * Text direkt editierbar, Form- und Farbwechsel per Klick, resizbar.
 */
export function ShapeCard({ id, data, selected }: NodeProps<ShapeNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const removeNode = useBoard((s) => s.removeNode);
  const [editing, setEditing] = useState(false);

  const cycleShape = () => updateNodeData(id, { shape: NEXT_SHAPE[data.shape] });
  const cycleColor = () => {
    const i = SHAPE_COLORS.indexOf(data.color);
    updateNodeData(id, { color: SHAPE_COLORS[(i + 1) % SHAPE_COLORS.length] });
  };

  const handles = [Position.Top, Position.Right, Position.Bottom, Position.Left];

  return (
    <div className={`shape-wrap shape-${data.shape}`}>
      <NodeResizer isVisible={!!selected} minWidth={90} minHeight={54} color="#4f7cff"
        handleStyle={{ width: 9, height: 9, borderRadius: 3 }} />
      {handles.map((pos) => (
        <Handle key={pos} type="source" position={pos} id={pos} className="pn-handle shape-handle" />
      ))}
      <Handle id="body" type="source" position={Position.Left} className="pn-handle-body" isConnectableStart={false} />
      <button className="card-x nodrag" title="Form löschen" onClick={() => removeNode(id)}>✕</button>
      <div className="shape-toolbar nodrag">
        <button title={SHAPE_LABEL[data.shape]} onClick={cycleShape}>◇</button>
        <button title="Farbe (Palette)" onClick={cycleColor}><IPalette size={13} /></button>
        <input
          type="color"
          className="pn-colorpick nodrag"
          title="Eigene Füllfarbe"
          value={data.color}
          onChange={(e) => updateNodeData(id, { color: e.target.value })}
        />
      </div>
      <div
        className="shape-body"
        style={{ background: data.color, '--shape-fill': data.color } as CSSProperties}
        onDoubleClick={() => setEditing(true)}
      >
        {editing ? (
          <textarea
            autoFocus className="shape-input nodrag" value={data.text}
            onChange={(e) => updateNodeData(id, { text: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span className="shape-text">{data.text || <span className="shape-ph">Doppelklick…</span>}</span>
        )}
      </div>
    </div>
  );
}
