import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useBoard } from '../../store';

interface Props {
  id: string;
  className?: string;
  children: ReactNode;
}

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf + Verbindungs-Handles.
 * Verbindungen: vom rechten Punkt einer Karte zum linken Punkt einer anderen ziehen.
 */
export function CardShell({ id, className, children }: Props) {
  const removeNode = useBoard((s) => s.removeNode);
  return (
    <div className={`card-shell ${className ?? ''}`}>
      <button
        className="card-x nodrag"
        title="Karte löschen"
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
