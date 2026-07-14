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
  // Wichtig: Lösch-Knopf & Handles liegen AUSSERHALB des card-body,
  // damit dessen overflow:hidden sie nicht abschneidet.
  return (
    <div className="card-shell">
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
      {/* Anschlusspunkte an allen 4 Seiten — die Linie selbst dockt dank
          Floating Edges immer automatisch an der zugewandten Seite an */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map((pos) => (
        <Handle key={pos} id={pos} type="source" position={pos} className="pn-handle" />
      ))}
      <div className={`card-body ${className ?? ''}`}>{children}</div>
    </div>
  );
}
