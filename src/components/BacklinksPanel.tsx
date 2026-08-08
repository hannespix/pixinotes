import { useEffect, useMemo, useState } from 'react';
import { useBoard } from '../store';
import { collectBacklinks } from '../lib/links';
import { relatedToBoard, type BrainHit } from '../lib/brain';
import { IFolder, INote, IX } from './Icons';

/**
 * Backlinks-Leiste (Obsidian: „Was verlinkt hierher?"): zeigt Portale und
 * [[Wikilinks]], die auf das AKTIVE Board zeigen — und seit M204 zusätzlich
 * 🧠 VERWANDTE Karten aus anderen Boards (semantischer Index): Verbindungen,
 * die noch NIEMAND gezogen hat, die inhaltlich aber naheliegen.
 */
export function BacklinksPanel() {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const brainOn = useBoard((s) => s.brain.on);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<BrainHit[]>([]);

  const backlinks = useMemo(() => collectBacklinks(boards, activeId), [boards, activeId]);

  // Verwandte Karten nachladen: beim Board-Wechsel und wenn der Index fertig wird
  useEffect(() => {
    if (!brainOn) { setRelated([]); return; }
    let gone = false;
    const load = () => {
      relatedToBoard(activeId, 5)
        .then((r) => { if (!gone) setRelated(r); })
        .catch(() => { if (!gone) setRelated([]); });
    };
    const t = setTimeout(load, 1200);
    const onBrain = () => load();
    window.addEventListener('pixinotes:brain', onBrain);
    return () => { gone = true; clearTimeout(t); window.removeEventListener('pixinotes:brain', onBrain); };
  }, [activeId, brainOn]);

  if (backlinks.length === 0 && related.length === 0) return null;

  const jump = (boardId: string, nodeId: string) => {
    setOpen(false);
    openBoard(boardId);
    focusNode(boardId, nodeId);
  };

  return (
    <div className="backlinks">
      {open && (
        <div className="backlinks-panel">
          <div className="backlinks-head">
            {backlinks.length > 0 ? 'Verlinkt hierher' : '🧠 Verwandt (Bedeutung)'}
            <button onClick={() => setOpen(false)} aria-label="Backlinks schließen"><IX size={11} /></button>
          </div>
          {backlinks.map((b, i) => (
            <button key={i} className="backlinks-row" onClick={() => jump(b.boardId, b.nodeId)} title="Zur Quelle springen">
              <span className="backlinks-icon">{b.kind === 'portal' ? <IFolder size={12} /> : <INote size={12} />}</span>
              <span className="backlinks-label">{b.label}</span>
              <span className="backlinks-board">{b.boardName}</span>
            </button>
          ))}
          {related.length > 0 && backlinks.length > 0 && (
            <div className="backlinks-head backlinks-sub">🧠 Verwandt (Bedeutung)</div>
          )}
          {related.map((r) => (
            <button
              key={`${r.boardId}:${r.nodeId}`}
              className="backlinks-row"
              onClick={() => jump(r.boardId, r.nodeId)}
              title={`Inhaltlich verwandt (${Math.round(r.score * 100)} % Ähnlichkeit) — noch nicht verlinkt`}
            >
              <span className="backlinks-icon">🧠</span>
              <span className="backlinks-label">{r.title || '(ohne Titel)'}</span>
              <span className="backlinks-board">{r.boardName}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`backlinks-pill ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={related.length > 0
          ? 'Was verlinkt hierher — und was ist inhaltlich verwandt? (🧠 semantischer Index)'
          : 'Was verlinkt hierher? (Portale & Wikilinks)'}
      >
        ↩ {backlinks.length}{related.length > 0 ? ` · 🧠 ${related.length}` : ''}
      </button>
    </div>
  );
}
