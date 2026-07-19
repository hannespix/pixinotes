import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInternalNode, ViewportPortal } from '@xyflow/react';
import { selectActiveBoard, useBoard, type CommentThread } from '../store';
import { IX } from './Icons';

/** Verfasser-Name: rein lokal (localStorage), wandert NIE ohne den Kommentar */
const AUTHOR_KEY = 'pixinotes:author';
export const getAuthor = (): string => localStorage.getItem(AUTHOR_KEY) ?? '';
const setAuthor = (name: string) => { try { localStorage.setItem(AUTHOR_KEY, name.trim().slice(0, 40)); } catch { /* Sitzung reicht */ } };

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE');
};

/** Ein Pin am oberen rechten Kartenrand — folgt der Karte live (M148) */
function CommentPin({ thread }: { thread: CommentThread }) {
  const node = useInternalNode(thread.nodeId);
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const openId = useBoard((s) => s.commentOpen);
  if (!node) return null; // Karte existiert (noch) nicht — Pin bleibt stumm
  const w = node.measured.width ?? 260;
  const last = thread.msgs[thread.msgs.length - 1];
  return (
    <button
      className={`comment-pin nodrag nopan ${thread.resolved ? 'resolved' : ''} ${openId === thread.id ? 'open' : ''}`}
      // BEWUSST rechts AUSSERHALB der Ecke: genau auf der Ecke säße der Pin
      // über dem ✕-Löschknopf der ausgewählten Karte (E2E-Fund M148)
      style={{ transform: `translate(${node.internals.positionAbsolute.x + w + 3}px, ${node.internals.positionAbsolute.y - 13}px)` }}
      title={thread.resolved ? 'Erledigter Kommentar (Klick zum Öffnen)' : `Kommentar von ${last?.author ?? '?'} (Klick zum Öffnen)`}
      onClick={(e) => { e.stopPropagation(); setCommentOpen(thread.id); }}
    >
      {thread.resolved ? '✓' : initials(last?.author ?? '?')}
      {!thread.resolved && thread.msgs.length > 1 && <span className="comment-pin-count">{thread.msgs.length}</span>}
    </button>
  );
}

/** Schwebendes Gesprächs-Panel für den offenen Thread bzw. einen neuen Kommentar */
function CommentPanel() {
  const openId = useBoard((s) => s.commentOpen);
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const addCommentMsg = useBoard((s) => s.addCommentMsg);
  const toggleCommentResolved = useBoard((s) => s.toggleCommentResolved);
  const removeCommentThread = useBoard((s) => s.removeCommentThread);
  const board = useBoard(selectActiveBoard);
  const [name, setName] = useState(getAuthor());
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const isNew = openId?.startsWith('new:') ?? false;
  const thread = isNew ? null : (board.comments ?? []).find((c) => c.id === openId);
  const nodeId = isNew ? openId!.slice(4) : thread?.nodeId;

  // Neue Nachrichten: ans Ende scrollen
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [thread?.msgs.length]);

  if (!openId || (!isNew && !thread)) return null;

  const send = () => {
    if (!text.trim()) return;
    setAuthor(name);
    const tid = addCommentMsg(thread ? { threadId: thread.id } : { nodeId }, name, text);
    setText('');
    if (isNew && tid) setCommentOpen(tid); // frisch eröffneter Thread bleibt offen
  };

  return createPortal(
    <div className="comment-panel" role="dialog" aria-label="Kommentare">
      <div className="comment-panel-head">
        <b>{isNew ? 'Neuer Kommentar' : 'Kommentare'}</b>
        <span className="comment-panel-tools">
          {thread && (
            <>
              <button onClick={() => toggleCommentResolved(thread.id)} title={thread.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'}>
                {thread.resolved ? 'Wieder öffnen' : 'Erledigt'}
              </button>
              <button
                className="danger"
                title="Thread komplett löschen"
                onClick={() => { if (window.confirm('Diesen Kommentar-Thread löschen?')) removeCommentThread(thread.id); }}
              >
                Löschen
              </button>
            </>
          )}
          <button onClick={() => setCommentOpen(null)} aria-label="Schließen"><IX size={13} /></button>
        </span>
      </div>
      {thread && (
        <div className="comment-msgs" ref={listRef}>
          {thread.msgs.map((m, i) => (
            <div className="comment-msg" key={i}>
              <span className="comment-msg-meta"><b>{m.author}</b> · {timeOf(m.at)}</span>
              <span className="comment-msg-text">{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className="comment-compose">
        {!getAuthor() && (
          <input
            className="comment-name"
            placeholder="Dein Name (für Kollegen sichtbar)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <textarea
          className="comment-input"
          placeholder={isNew ? 'Kommentar zur Karte…' : 'Antworten…'}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="comment-send" disabled={!text.trim() || !name.trim()} onClick={send}>
          Senden
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Kommentar-Ebene (M148): Pins in Board-Koordinaten (ViewportPortal — zoomt
 * und schwenkt mit), das Gesprächs-Panel als fixes Overlay. Kommentare leben
 * im Board-Dokument und wandern so im Sync-Ordner UND im Team-Projekt mit.
 */
export function CommentLayer() {
  const board = useBoard(selectActiveBoard);
  const threads = board.comments ?? [];
  return (
    <>
      <ViewportPortal>
        {threads.map((t) => <CommentPin key={t.id} thread={t} />)}
      </ViewportPortal>
      <CommentPanel />
    </>
  );
}
