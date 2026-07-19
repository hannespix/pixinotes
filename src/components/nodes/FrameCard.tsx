import { useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { FrameNode } from '../../types';
import { IPalette, IX } from '../Icons';

/** Pastell-Tönungen für Rahmen — bewusst blass, der Inhalt bleibt der Star */
const FRAME_COLORS = ['', '#dbe7f6', '#dcedde', '#f6ead2', '#f4dde3', '#e6def4'];

/**
 * Frame (M149): benannter Rahmen-Bereich à la Miro. Liegt hinter allen Karten,
 * wird NUR an der Titel-Leiste gezogen (dragHandle) und nimmt dabei alle
 * Karten mit, deren Mittelpunkt im Rahmen liegt (Logik in Board.tsx).
 * Die Fläche selbst ist durchklick-transparent — Pan/Auswahl/Doppelklick
 * funktionieren im Rahmen weiter wie auf freiem Board.
 */
export function FrameCard({ id, data, selected }: NodeProps<FrameNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const removeNode = useBoard((s) => s.removeNode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const tint = (data.color as string) || '';
  const commit = () => {
    updateNodeData(id, { name: draft.trim() || 'Bereich' });
    setEditing(false);
  };
  const cycleColor = () => {
    const i = FRAME_COLORS.indexOf(tint);
    updateNodeData(id, { color: FRAME_COLORS[(i + 1) % FRAME_COLORS.length] });
  };

  return (
    <div className={`frame-wrap ${selected ? 'selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={260} minHeight={180} />
      <div className="frame-head" title="Ziehen verschiebt den Rahmen SAMT Inhalt · Doppelklick benennt um">
        {editing ? (
          <input
            autoFocus
            className="frame-name-input nodrag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span className="frame-name" onDoubleClick={() => { setDraft(data.name); setEditing(true); }}>
            {data.name}
          </span>
        )}
        {selected && !editing && (
          <span className="frame-tools nodrag">
            <button title="Rahmen-Tönung wechseln" onClick={cycleColor}><IPalette size={12} /></button>
            <button
              title="Nur den Rahmen löschen — die Karten darin bleiben"
              onClick={() => removeNode(id)}
            >
              <IX size={12} />
            </button>
          </span>
        )}
      </div>
      <div className="frame-body" style={tint ? { background: `${tint}55` } : undefined} />
    </div>
  );
}
