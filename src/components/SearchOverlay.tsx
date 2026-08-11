import { useEffect, useMemo, useRef, useState } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { mutedHistory, useBoard } from '../store';
import { makeKanban, makeNote } from '../lib/nodes';
import { nodeToText } from '../lib/serialize';
import { collectAllTags } from '../lib/links';
import { askBrain, brainSearch, type BrainHit } from '../lib/brain';
import { aiReady } from '../lib/ai';

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
  sheet: '📊',
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
/**
 * M216: Die Suche kann jetzt auch HANDELN, nicht nur finden.
 *
 * Bisher war Strg+K reines Nachschlagen — wer ein Modul anlegen oder die
 * Ansicht wechseln wollte, musste den passenden Knopf suchen. Die Befehle
 * stehen als eigener Block ÜBER den Treffern und tauchen nur auf, wenn die
 * Eingabe zu ihnen passt; ohne Eingabe bleibt die Suche, was sie war.
 */
interface Command {
  label: string;
  hint: string;
  /** Zusätzliche Suchwörter, unter denen der Befehl gefunden wird */
  alias: string;
  run: () => void;
}

function buildCommands(): Command[] {
  const st = () => useBoard.getState();
  const center = () => ({ x: 160, y: 160 });
  const add = (make: () => AppNode, was: string) => () => {
    const s = st();
    s.pushHistory();
    const node = make();
    mutedHistory(() => s.addNode(node));
    s.focusNode(s.activeId, node.id);
    s.showToast(`${was} angelegt.`);
  };
  return [
    { label: '＋ Notiz', hint: 'Neue Notiz auf diesem Board', alias: 'note text zettel',
      run: add(() => makeNote(center()), 'Notiz') },
    { label: '＋ Kanban', hint: 'Neues Kanban-Board', alias: 'ticket spalten board',
      run: add(() => makeKanban(center()), 'Kanban') },
    { label: '🏠 Zur Übersicht', hint: 'Alle Bereiche, Projekte und Boards', alias: 'home start mission',
      run: () => st().setView('overview') },
    { label: '🕸 Netz-Ansicht', hint: 'Boards als Graph', alias: 'graph netz verbindungen',
      run: () => { st().setOverviewMode('netz'); st().setView('overview'); } },
    { label: '✅ Aufgaben-Zentrale', hint: 'Alle offenen Aufgaben aller Boards', alias: 'tasks todo fristen',
      run: () => st().setTasksOpen(true) },
    { label: '▶ Präsentieren', hint: 'Karten als Folien zeigen', alias: 'presenter folien vortrag',
      run: () => st().setPresenting(true) },
    { label: '⚙️ Einstellungen', hint: 'KI, Sync, Design, Daten', alias: 'settings optionen ki sync',
      run: () => st().setSettingsOpen(true) },
    { label: '❓ Hilfe', hint: 'Anleitung zu allen Funktionen', alias: 'help anleitung',
      run: () => st().setHelpOpen(true, 'start') },
  ];
}

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

  // M204: Suche nach BEDEUTUNG — läuft entprellt neben der Fuzzy-Suche her,
  // sobald das Gehirn (Einstellungen → KI) eingeschaltet ist
  const brainOn = useBoard((s) => s.brain.on);
  const [semHits, setSemHits] = useState<BrainHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!open || !brainOn || q.length < 3 || q === '#') { setSemHits([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      brainSearch(q, 6)
        .then((r) => { if (!stale) setSemHits(r); })
        .catch(() => { if (!stale) setSemHits([]); });
    }, 350);
    return () => { stale = true; clearTimeout(t); };
  }, [query, open, brainOn]);
  // Doppelte raus: Was die Fuzzy-Suche schon zeigt, braucht der 🧠-Block nicht
  const semOnly = semHits.filter((h) => !hits.some((x) => x.boardId === h.boardId && x.node.id === h.nodeId));

  // M206: „Frag dein Gehirn" — Antwort aus den EIGENEN Karten, mit Quellen
  const ai = useBoard((s) => s.ai);
  const canAsk = brainOn && aiReady(ai);
  const [answer, setAnswer] = useState<{ text: string; sources: BrainHit[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    const q = query.trim();
    if (!q || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await askBrain(q);
      setAnswer({
        text: res.answer || 'Dazu steht nichts in deinen Karten.',
        sources: res.sources,
      });
    } catch (e) {
      setAnswer({ text: `Antwort fehlgeschlagen: ${(e as Error).message}`, sources: [] });
    } finally {
      setAsking(false);
    }
  };
  // Frage-Ergebnis verwerfen, sobald weitergetippt wird
  useEffect(() => { setAnswer(null); }, [query]);

  // M216: passende Befehle zur Eingabe (nur bei Eingabe, nie im Weg)
  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === '#' || q.length < 2) return [];
    return buildCommands().filter((c) =>
      `${c.label} ${c.hint} ${c.alias}`.toLowerCase().includes(q)).slice(0, 4);
  }, [query]);

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
            // M206: Strg+Enter fragt das Gehirn, statt zum Treffer zu springen
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canAsk) { e.preventDefault(); void ask(); return; }
            if (e.key === 'Enter' && hits[cursor]) jump(hits[cursor]);
          }}
        />
        {canAsk && query.trim().length >= 3 && query.trim() !== '#' && (
          <button className="search-ask" onClick={() => void ask()} disabled={asking}>
            {asking ? '🧠 denkt nach …' : '🧠 Frag dein Gehirn (Strg+Enter)'}
          </button>
        )}
        {answer && (
          <div className="search-answer">
            <div className="search-answer-text">{answer.text}</div>
            {answer.sources.length > 0 && (
              <div className="search-answer-src">
                {answer.sources.map((s, i) => (
                  <button
                    key={`${s.boardId}-${s.nodeId}`}
                    className="search-src-chip"
                    title={`${s.boardName} · ${s.title}`}
                    onClick={() => { setOpen(false); focusNode(s.boardId, s.nodeId); }}
                  >
                    [{i + 1}] {s.title.slice(0, 26) || s.boardName}
                  </button>
                ))}
              </div>
            )}
            <div className="search-answer-foot">Antwort nur aus deinen Karten — Quellen anklicken springt hin.</div>
          </div>
        )}
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
            {commands.length > 0 && (
              <div className="search-cmds">
                <div className="search-sem-head">⌘ Befehle</div>
                {commands.map((c) => (
                  <button
                    key={c.label}
                    className="search-cmd"
                    title={c.hint}
                    onClick={() => { setOpen(false); c.run(); }}
                  >
                    <span className="hit-main">
                      <span className="hit-title">{c.label}</span>
                      <span className="hit-snippet">{c.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {hits.length === 0 && commands.length === 0 && <div className="search-empty">Keine Treffer</div>}
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
        {semOnly.length > 0 && query.trim() && query.trim() !== '#' && (
          <div className="search-results search-sem">
            <div className="search-sem-head">🧠 Nach Bedeutung</div>
            {semOnly.map((h) => (
              <button
                key={`sem-${h.boardId}-${h.nodeId}`}
                className="search-hit"
                onClick={() => { setOpen(false); focusNode(h.boardId, h.nodeId); }}
              >
                <span className="hit-icon">🧠</span>
                <span className="hit-main">
                  <span className="hit-title">{h.title || '(ohne Titel)'}</span>
                  <span className="hit-snippet">inhaltlich verwandt · {Math.round(h.score * 100)} %</span>
                </span>
                <span className="hit-board">{h.boardName}</span>
              </button>
            ))}
          </div>
        )}
        <div className="search-footer">↑↓ navigieren · Enter springt zur Karte · # zeigt alle Tags · Esc schließt · sucht in allen Boards, tippfehlertolerant{brainOn ? ' · 🧠 findet auch nach Bedeutung' : ''}</div>
      </div>
    </div>
  );
}
