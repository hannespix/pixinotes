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
  /** Wird nach einem manuellen Resize über die Griffe gerufen (z. B. um eine
   *  Auto-Größe abzuschalten, Mermaid M92c) */
  onManualResize?: () => void;
}

/**
 * Gemeinsame Hülle aller Karten: Lösch-Knopf, Verbindungs-Handles und
 * Resize-Griffe an Ecken/Kanten (sichtbar bei Selektion).
 */
export function CardShell({ id, className, children, selected, minWidth = 170, minHeight = 70, onManualResize }: Props) {
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
        onResizeEnd={onManualResize}
      />
      {/* Sichtbarer Griff: hier packt man die Karte IMMER — auch wenn sie
          innen komplett aus Editor/Eingabefeldern besteht */}
      <div className="card-grip" title="Ziehen zum Verschieben" aria-hidden="true">
        <svg width="18" height="8" viewBox="0 0 18 8" fill="currentColor">
          <circle cx="3" cy="2" r="1.3" /><circle cx="9" cy="2" r="1.3" /><circle cx="15" cy="2" r="1.3" />
          <circle cx="3" cy="6" r="1.3" /><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" />
        </svg>
      </div>
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
      {/* Ganzkarten-Ziel: während einer Verbindung reicht es, IRGENDWO auf der
          Karte loszulassen (CSS aktiviert diesen Handle nur beim Verbinden) */}
      <Handle id="body" type="source" position={Position.Left} className="pn-handle-body" isConnectableStart={false} />
      <div className={`card-body ${className ?? ''}`}>{children}</div>
    </div>
  );
}
