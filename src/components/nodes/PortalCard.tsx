import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { boardMetaLabel } from '../../lib/boardStats';
import type { PortalNode } from '../../types';
import { CardShell } from './CardShell';

/**
 * Portal-Karte: verlinkt ein anderes Projekt-Board (Obsidian-Gefühl, aber visuell).
 * Liegt auf dem Board wie jede andere Karte, zeigt Live-Statistik des Ziels
 * und springt per Klick hinein. Portale sind normale Karten — sie lassen sich
 * mit anderen Karten verbinden und machen Projekt-Beziehungen sichtbar.
 */
export function PortalCard({ id, data, selected }: NodeProps<PortalNode>) {
  const boards = useBoard((s) => s.boards);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const openBoard = useBoard((s) => s.openBoard);
  const setPresenting = useBoard((s) => s.setPresenting);

  const target = boards.find((b) => b.id === data.boardId);

  return (
    <CardShell id={id} selected={selected} minWidth={160} minHeight={130} className="portal-card">
      <div className="portal-icon">🗂️</div>
      {target ? (
        <>
          <div className="portal-name">{target.name}</div>
          <div className="meta">{boardMetaLabel(target)}</div>
          <div className="portal-actions">
            <button className="portal-open nodrag" onClick={() => openBoard(target.id)}>
              → Öffnen
            </button>
            <button
              className="portal-open nodrag"
              title="Ziel-Board direkt präsentieren"
              onClick={() => { openBoard(target.id); setPresenting(true); }}
            >
              ▶️
            </button>
          </div>
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
