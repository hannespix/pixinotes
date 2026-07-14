import { useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useBoard } from '../store';
import { nodeToText } from '../lib/serialize';

const TYPE_ICON: Record<string, string> = {
  note: '📝',
  email: '📧',
  kanban: '📋',
  image: '🖼️',
  file: '📎',
  portal: '🗂️',
};

interface Hit {
  boardId: string;
  boardName: string;
  node: Node;
  title: string;
  snippet: string;
}

/** Spotlight-Suche (Strg/Cmd+K) über alle Boards — Treffer anklicken fliegt zur Karte. */
export function SearchOverlay() {
  const boards = useBoard((s) => s.boards);
  const focusNode = useBoard((s) => s.focusNode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setCursor(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Hit[] = [];
    for (const b of boards) {
      for (const n of b.nodes) {
        const text = nodeToText(n);
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) continue;
        const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
        const snippetStart = Math.max(0, idx - 30);
        out.push({
          boardId: b.id,
          boardName: b.name,
          node: n,
          title: firstLine.slice(0, 70),
          snippet: (snippetStart > 0 ? '…' : '') + text.slice(snippetStart, idx + q.length + 40).replace(/\n/g, ' '),
        });
        if (out.length >= 15) return out;
      }
    }
    return out;
  }, [query, boards]);

  const jump = (hit: Hit) => {
    setOpen(false);
    focusNode(hit.boardId, hit.node.id);
  };

  if (!open) return null;

  return (
    <div className="search-backdrop" onClick={() => setOpen(false)}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Karten durchsuchen… (alle Boards)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === 'Enter' && hits[cursor]) jump(hits[cursor]);
          }}
        />
        {query.trim() && (
          <div className="search-results">
            {hits.length === 0 && <div className="search-empty">Keine Treffer</div>}
            {hits.map((h, i) => (
              <button
                key={`${h.boardId}-${h.node.id}`}
                className={`search-hit ${i === cursor ? 'active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => jump(h)}
              >
                <span className="hit-icon">{TYPE_ICON[h.node.type ?? ''] ?? '🗒️'}</span>
                <span className="hit-main">
                  <span className="hit-title">{h.title || '(ohne Titel)'}</span>
                  <span className="hit-snippet">{h.snippet}</span>
                </span>
                <span className="hit-board">{h.boardName}</span>
              </button>
            ))}
          </div>
        )}
        <div className="search-footer">↑↓ navigieren · Enter springt zur Karte · Esc schließt</div>
      </div>
    </div>
  );
}
