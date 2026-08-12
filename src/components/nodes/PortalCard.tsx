import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import { boardMetaLabel } from '../../lib/boardStats';
import { zeigtAuf } from '../../lib/portale';
import type { PortalNode } from '../../types';
import { IPlay } from '../Icons';
import { CardShell } from './CardShell';

/**
 * Portal-Karte: verlinkt ein anderes Projekt-Board (Obsidian-Gefühl, aber visuell).
 * Liegt auf dem Board wie jede andere Karte, zeigt Live-Statistik des Ziels
 * und springt per Klick hinein. Portale sind normale Karten — sie lassen sich
 * mit anderen Karten verbinden und machen Projekt-Beziehungen sichtbar.
 *
 * M262: Und sie sind gegenseitig. Beim Verlinken entsteht drüben ein
 * Rückverweis; die Karte zeigt an, ob die Gegenseite zurückverweist, und
 * bietet den Rückverweis für ältere, einseitige Portale zum Nachtragen an.
 */
export function PortalCard({ id, data, selected }: NodeProps<PortalNode>) {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const portalZielSetzen = useBoard((s) => s.portalZielSetzen);
  const rueckverweisNachtragen = useBoard((s) => s.rueckverweisNachtragen);
  const openBoard = useBoard((s) => s.openBoard);
  const setPresenting = useBoard((s) => s.setPresenting);

  const target = boards.find((b) => b.id === data.boardId);
  // Liegt drüben ein Portal zurück? Das ist die halbe Aussage der Karte.
  const gegenseitig = !!target && target.id !== activeId && zeigtAuf(target, activeId);

  return (
    <CardShell id={id} selected={selected} minWidth={160} minHeight={130} className="portal-card">
      <div className="portal-icon">🗂️</div>
      {target ? (
        <>
          <div className="portal-name">{target.name}</div>
          <div className="meta">{boardMetaLabel(target)}</div>
          {target.id !== activeId && (
            gegenseitig ? (
              <div className="portal-rueck" title={data.rueck
                ? `Rückverweis: „${target.name}" hat diese Karte beim Verlinken hier angelegt.`
                : `„${target.name}" verweist ebenfalls hierher — die Verbindung gilt in beide Richtungen.`}>
                ⇄ {data.rueck ? 'Rückverweis' : 'beidseitig'}
              </div>
            ) : (
              <button
                className="portal-rueck-add nodrag"
                title={`In „${target.name}" eine Portal-Karte zurück auf dieses Board anlegen`}
                onClick={() => rueckverweisNachtragen(activeId, target.id)}
              >
                ⇄ Rückverweis anlegen
              </button>
            )
          )}
          <div className="portal-actions">
            <button className="portal-open nodrag" onClick={() => openBoard(target.id)}>
              → Öffnen
            </button>
            <button
              className="portal-open nodrag"
              title="Ziel-Board direkt präsentieren"
              onClick={() => { openBoard(target.id); setPresenting(true); }}
            >
              <IPlay size={12} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="portal-name">Projekt verlinken</div>
          <select
            className="nodrag portal-select"
            value=""
            onChange={(e) => portalZielSetzen(id, e.target.value)}
          >
            <option value="" disabled>
              Board wählen…
            </option>
            {boards.filter((b) => b.id !== activeId).map((b) => (
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
