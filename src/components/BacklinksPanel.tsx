import { useMemo, useState } from 'react';
import { useBoard } from '../store';
import { collectBacklinks } from '../lib/links';
import { IFolder, INote, IX } from './Icons';

/**
 * Backlinks-Leiste (Obsidian: „Was verlinkt hierher?"): zeigt Portale und
 * [[Wikilinks]], die auf das AKTIVE Board zeigen. Als dezente Pille über
 * der Minimap — aufklappbar, komplett ausgeblendet wenn nichts verlinkt.
 */
export function BacklinksPanel() {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const [open, setOpen] = useState(false);

  const backlinks = useMemo(() => collectBacklinks(boards, activeId), [boards, activeId]);
  if (backlinks.length === 0) return null;

  const jump = (b: { boardId: string; nodeId: string }) => {
    setOpen(false);
    openBoard(b.boardId);
    focusNode(b.boardId, b.nodeId);
  };

  return (
    <div className="backlinks">
      {open && (
        <div className="backlinks-panel">
          <div className="backlinks-head">
            Verlinkt hierher
            <button onClick={() => setOpen(false)} aria-label="Backlinks schließen"><IX size={11} /></button>
          </div>
          {backlinks.map((b, i) => (
            <button key={i} className="backlinks-row" onClick={() => jump(b)} title="Zur Quelle springen">
              <span className="backlinks-icon">{b.kind === 'portal' ? <IFolder size={12} /> : <INote size={12} />}</span>
              <span className="backlinks-label">{b.label}</span>
              <span className="backlinks-board">{b.boardName}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`backlinks-pill ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Was verlinkt hierher? (Portale & Wikilinks)"
      >
        ↩ {backlinks.length}
      </button>
    </div>
  );
}
