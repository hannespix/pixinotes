import type { ReactNode } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { useBoard } from '../../store';

interface Props {
  id: string;
  className?: string;
  children: ReactNode;
  /** von NodeProps durchreichen — steuert Resize-Griffe & Controls */
  selected?: boolean;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf, Verbindungs-Handles und
 * Resize-Griffe an Ecken/Kanten (sichtbar bei Selektion).
 */
export function CardShell({ id, className, children, selected, minWidth = 170, minHeight = 70 }: Props) {
  const removeNode = useBoard((s) => s.removeNode);
  return (
    <div className={`card-shell ${className ?? ''}`}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={minWidth}
        minHeight={minHeight}
        color="#4f7cff"
        handleStyle={{ width: 9, height: 9, borderRadius: 3 }}
      />
      <button
        className="card-x nodrag"
        title="Karte löschen (oder Entf-Taste)"
        onClick={() => removeNode(id)}
      >
        ✕
      </button>
      <Handle type="target" position={Position.Left} className="pn-handle" />
      <Handle type="source" position={Position.Right} className="pn-handle" />
      {children}
    </div>
  );
}
