import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { CardShell } from './CardShell';

interface PortalData {
  boardId?: string;
  [key: string]: unknown;
}

/**
 * Portal-Karte: verlinkt ein anderes Projekt-Board (Obsidian-Gefühl, aber visuell).
 * Liegt auf dem Board wie jede andere Karte, zeigt Live-Statistik des Ziels
 * und springt per Klick hinein. Portale sind normale Karten — sie lassen sich
 * mit anderen Karten verbinden und machen Projekt-Beziehungen sichtbar.
 */
export function PortalCard({ id, data }: NodeProps) {
  const portal = data as unknown as PortalData;
  const boards = useBoard((s) => s.boards);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const openBoard = useBoard((s) => s.openBoard);

  const target = boards.find((b) => b.id === portal.boardId);
  const openCount = target
    ? target.nodes.reduce((acc, n) => {
        const items = (n.data as { items?: { col: number }[] }).items;
        return acc + (items ? items.filter((it) => it.col < 2).length : 0);
      }, 0)
    : 0;

  return (
    <CardShell id={id} className="portal-card">
      <div className="portal-icon">🗂️</div>
      {target ? (
        <>
          <div className="portal-name">{target.name}</div>
          <div className="meta">
            {target.nodes.length} Karten
            {openCount > 0 ? ` · ${openCount} offene Tickets` : ''}
          </div>
          <button className="portal-open nodrag" onClick={() => openBoard(target.id)}>
            → Öffnen
          </button>
        </>
      ) : (
        <>
          <div className="portal-name">Projekt verlinken</div>
          <select
            className="nodrag portal-select"
            value=""
            onChange={(e) => updateNodeData(id, { boardId: e.target.value })}
          >
            <option value="" disabled>
              Board wählen…
            </option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </>
      )}
    </CardShell>
  );
}
