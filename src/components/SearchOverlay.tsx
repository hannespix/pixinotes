import { useEffect, useMemo, useRef, useState } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { useBoard } from '../store';
import { nodeToText } from '../lib/serialize';
import { collectAllTags } from '../lib/links';

// Fuzzy + Multi-Token: Tippfehler-tolerant (1 Fehler pro Wort), Wörter in
// beliebiger Reihenfolge, Umlaute korrekt (Unicode-Preset für Deutsch).
const uf = new uFuzzy({
  unicode: true,
  interSplit: "[^\\p{L}\\d']+",
  intraSplit: '\\p{Ll}\\p{Lu}',
  intraBound: '\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}',
  intraChars: "[\\p{L}\\d']",
  intraContr: "'\\p{L}{1,2}\\b",
  intraMode: 1,
  intraIns: 1,
});

const TYPE_ICON: Record<string, string> = {
  note: '📝',
  email: '📧',
  kanban: '📋',
  gantt: '📅',
  calendar: '🗓️',
  image: '🖼️',
  file: '📎',
  portal: '🗂️',
  shape: '🔷',
  mermaid: '📊',
};

import type { AppNode } from '../types';

interface Hit {
  boardId: string;
  boardName: string;
  node: AppNode;
  title: string;
  snippet: string;
}

/** Spotlight-Suche (Strg/Cmd+K) über alle Boards — Treffer anklicken fliegt zur Karte. */
export function SearchOverlay() {
  const boards = useBoard((s) => s.boards);
  const focusNode = useBoard((s) => s.focusNode);
  const open = useBoard((s) => s.searchOpen);
  const setOpen = useBoard((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useBoard.getState().searchOpen);
        setQuery('');
        setCursor(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    // Fokus hart erzwingen — auch wenn gerade ein anderes Eingabefeld fokussiert war
    const grab = () => inputRef.current?.focus();
    grab();
    const raf = requestAnimationFrame(grab);
    const t = setTimeout(grab, 80);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [open]);

  // Index: jede Karte als durchsuchbarer Text (inkl. Board-Name).
  // Nur bei geöffneter Suche bauen — sonst liefe das bei jedem Tastendruck
  // in irgendeiner Karte über alle Boards (Audit PERF-1).
  const entries = useMemo(() => {
    const list: { boardId: string; boardName: string; node: AppNode; text: string }[] = [];
    if (!open) return list;
    for (const b of boards) {
      for (const n of b.nodes) {
        const text = nodeToText(n);
        if (text.trim()) list.push({ boardId: b.id, boardName: b.name, node: n, text });
      }
    }
    return list;
  }, [boards, open]);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const haystack = entries.map((e) => `${e.text} ${e.boardName}`);

    // uFuzzy: outOfOrder=1 → Multi-Token in beliebiger Reihenfolge
    let resultIdxs: number[] = [];
    const searched = uf.search(haystack, q, 1, 1000);
    if (searched) {
      const [idxs, info, order] = searched;
      if (idxs && info && order) resultIdxs = order.map((i) => info.idx[i]);
      else if (idxs) resultIdxs = [...idxs];
    }
    // Sicherheitsnetz: simple Teilstring-Suche, falls fuzzy nichts liefert
    if (resultIdxs.length === 0) {
      const ql = q.toLowerCase();
      resultIdxs = entries
        .map((e, i) => (`${e.text} ${e.boardName}`.toLowerCase().includes(ql) ? i : -1))
        .filter((i) => i >= 0);
    }

    const firstToken = q.split(/\s+/)[0] ?? q;
    return resultIdxs.slice(0, 15).map((i) => {
      const e = entries[i];
      const firstLine = e.text.split('\n').find((l) => l.trim()) ?? '';
      let at = e.text.toLowerCase().indexOf(firstToken.toLowerCase());
      if (at === -1) at = 0;
      const start = Math.max(0, at - 30);
      return {
        boardId: e.boardId,
        boardName: e.boardName,
        node: e.node,
        title: firstLine.slice(0, 70),
        snippet: (start > 0 ? '…' : '') + e.text.slice(start, at + 70).replace(/\n/g, ' '),
      };
    });
  }, [query, entries]);

  const jump = (hit: Hit) => {
    setOpen(false);
    focusNode(hit.boardId, hit.node.id);
  };

  if (!open) return null;

  return (
    <div className="search-backdrop" onClick={() => setOpen(false)}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Kartensuche" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Karten durchsuchen…"
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
        {query.trim() === '#' && (
          <div className="search-tags">
            {collectAllTags(useBoard.getState().boards).slice(0, 24).map(({ tag, count }) => (
              <button key={tag} className="search-tag" onClick={() => { setQuery(tag); setCursor(0); }}>
                {tag} <span>{count}</span>
              </button>
            ))}
            {collectAllTags(useBoard.getState().boards).length === 0 && (
              <div className="search-empty">Noch keine #Tags — einfach #stichwort in eine Notiz schreiben.</div>
            )}
          </div>
        )}
        {query.trim() && query.trim() !== '#' && (
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
        <div className="search-footer">↑↓ navigieren · Enter springt zur Karte · # zeigt alle Tags · Esc schließt · sucht in allen Boards, tippfehlertolerant</div>
      </div>
    </div>
  );
}
