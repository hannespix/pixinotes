import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import confetti from 'canvas-confetti';
import { runDerived, useBoard } from '../../store';
import {
  kanbanCols, openSubs, ticketBlockers, uid, wipFull, wipLimitOf,
  type GanttData, type KanbanData, type KanbanItem, type KanbanNode,
} from '../../types';
import { collectTasks, formatDueShort, urgencyFor } from '../../lib/tasks';
import { nodeToText } from '../../lib/serialize';
import { ICalendar, IChevronL, IChevronR, IDownload, IFolder, IPlus, IRedo, ISearch, ISettings, IX } from '../Icons';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';

/** Symbol je Karten-Typ für die Verknüpfungs-Liste im Ticket-Modal (M118) */
const TYPE_ICON: Record<string, string> = {
  note: '📝', kanban: '📋', mermaid: '📊', gantt: '📅', calendar: '🗓️',
  shape: '⬛', image: '🖼️', pdf: '📄', email: '✉️', file: '📎', portal: '🚪',
};

/** #Tags aus einem Ticket-Text ziehen (Trello-Labels light: einfach #tag tippen) */
const tagsOf = (text: string): string[] => [...text.matchAll(/#([\p{L}\d_-]{2,20})/gu)].map((m) => m[1].toLowerCase());

/** Alle Tags eines Tickets — Titel UND Beschreibung zählen (M121) */
const ticketTags = (it: KanbanItem): string[] =>
  [...new Set(tagsOf(`${it.text} ${it.note ?? ''}`))];

/** Deterministische Label-Farbe je Tag (M121): gleicher Tag = gleiche Farbe */
const tagHue = (tag: string): number => {
  let h = 0;
  for (let i = 0; i < tag.length; i += 1) h = (h * 31 + tag.charCodeAt(i)) % 360;
  return h;
};

/**
 * Der eigentliche Kanban-Inhalt — geteilt zwischen Board-Karte und
 * Präsentations-Folie. Spalten sind frei benennbar und in der Anzahl
 * variabel (➕/✕); die letzte Spalte ist immer „Erledigt" (🎉 + Durchstreichen).
 */
export function KanbanBody({ id, data }: { id: string; data: KanbanData }) {
  const kanban = data;
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const boards = useBoard((s) => s.boards);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const setPresenting = useBoard((s) => s.setPresenting);
  const [newText, setNewText] = useState('');
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Filterleiste (Trello-Stil): Textsuche, Schnellfilter, #Tag, Quell-Board.
  // Bewusst NICHT persistiert — Filter sind eine Ansicht, kein Zustand.
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<'alle' | 'faellig' | 'ueberfaellig'>('alle');
  const [tagFilter, setTagFilter] = useState('');
  const [boardFilter, setBoardFilter] = useState('');
  // Fokus EINMAL beim Öffnen aufs Panel — sonst wirkt Esc erst nach Feld-Klick.
  // (Kein Callback-Ref: der würde bei jedem Tipp-Rerender den Fokus klauen.)
  const detailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (detailId) detailRef.current?.focus();
  }, [detailId]);

  // Drag & Drop zwischen Spalten (M119) — HTML5-DnD; die Pfeile bleiben als
  // Touch-Fallback (HTML5-Drag existiert auf Smartphones nicht zuverlässig)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  // WIP-Limit-Inline-Editor (M119): Spaltenindex mit offenem Zahlenfeld
  const [wipEdit, setWipEdit] = useState<number | null>(null);

  // Abhängigkeits-Pfeile (M119): SVG-Overlay über den Spalten — von jedem
  // Vorgänger-Ticket zum abhängigen Ticket (rot = blockiert noch, grün = frei)
  const colsRef = useRef<HTMLDivElement | null>(null);
  const [depPaths, setDepPaths] = useState<Array<{ d: string; open: boolean }>>([]);
  const doneIdx = kanbanCols(kanban).length - 1;
  useEffect(() => {
    const host = colsRef.current;
    if (!host) return;
    const calc = () => {
      const rect = host.getBoundingClientRect();
      // React Flow skaliert per CSS-Transform — Bildschirm-Px zurückrechnen
      const scale = host.offsetWidth > 0 ? rect.width / host.offsetWidth : 1;
      const paths: Array<{ d: string; open: boolean }> = [];
      for (const it of kanban.items) {
        for (const depId of it.deps ?? []) {
          const from = host.querySelector(`[data-kid="${depId}"]`);
          const to = host.querySelector(`[data-kid="${it.id}"]`);
          if (!from || !to) continue;
          const f = from.getBoundingClientRect();
          const t = to.getBoundingClientRect();
          const x1 = (f.right - rect.left) / scale;
          const y1 = (f.top + f.height / 2 - rect.top) / scale;
          const x2 = (t.left - rect.left) / scale;
          const y2 = (t.top + t.height / 2 - rect.top) / scale;
          const dep = kanban.items.find((x) => x.id === depId);
          const open = !!dep && dep.col < doneIdx;
          const bend = Math.max(22, Math.abs(x2 - x1) / 2);
          paths.push({ d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, open });
        }
      }
      setDepPaths(paths);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(host);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kanban.items, doneIdx, query, quick, tagFilter, boardFilter, kanban.groupBy]);

  const cols = kanbanCols(kanban);
  const done = cols.length - 1;

  const setItems = (items: KanbanItem[]) => updateNodeData(id, { items });
  const patchItem = (itemId: string, patch: Partial<KanbanItem>) =>
    setItems(kanban.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));

  /** Sprung-Chip: verknüpftes Board (bzw. Karte) öffnen */
  const followLink = (link: NonNullable<KanbanItem['link']>) => {
    setPresenting(false);
    openBoard(link.boardId);
    if (link.nodeId) focusNode(link.boardId, link.nodeId);
  };

  /**
   * Offene Aufgaben aus ALLEN Boards einsammeln (mit Quell-Verknüpfung) und
   * bereits eingesammelte Tickets abgleichen: ist die Quelle erledigt oder
   * verschwunden, wandert das Ticket automatisch in die Erledigt-Spalte.
   */
  const syncFromBoards = (announce: boolean) => {
    const norm = (t: string) => t.trim().toLowerCase();
    const have = new Set(kanban.items.map((it) => norm(it.text)));
    // Dedupe zusätzlich über die Link-Identität: ändert sich der Quelltext,
    // entsteht sonst ein Duplikat neben dem alten Ticket (Audit R6-F3)
    const haveKeys = new Set(
      kanban.items.filter((it) => it.link?.nodeId && it.link.itemId).map((it) => `${it.link!.nodeId}|${it.link!.itemId}`),
    );
    const openKeys = new Set<string>();
    const fresh: KanbanItem[] = [];
    // Feingranular: nur aus gewählten Boards NEU einsammeln; entfernte Tickets
    // (ignoreKeys) bleiben draußen. WICHTIG: openKeys sieht weiterhin ALLE
    // Boards — sonst würden Tickets aus abgewählten Boards fälschlich als
    // „Quelle erledigt" abgehakt.
    const allowed = (boardId: string) => !kanban.collectFrom || kanban.collectFrom.includes(boardId);
    const ignored = new Set(kanban.ignoreKeys ?? []);
    // M166: abgewählte EINZEL-Module (feiner als die Board-Auswahl).
    // WICHTIG: openKeys sieht sie weiterhin — sonst würden vorhandene Tickets
    // aus einer gerade abgewählten Quelle fälschlich als „erledigt" abgehakt.
    const excludedNodes = new Set(kanban.collectExcludeNodes ?? []);
    // Kanban-Tickets + Checklisten (Aufgaben-Zentrale-Logik) — ohne dieses Kanban selbst
    for (const t of collectTasks(boards)) {
      if (t.nodeId === id) continue;
      const key = `${t.nodeId}|${t.itemId}`;
      openKeys.add(key);
      if (!allowed(t.boardId) || ignored.has(key) || excludedNodes.has(t.nodeId)) continue;
      if (haveKeys.has(key) || have.has(norm(t.text))) continue;
      have.add(norm(t.text));
      fresh.push({ id: uid(), text: t.text, col: 0, due: t.due, link: { boardId: t.boardId, nodeId: t.nodeId, itemId: t.itemId } });
    }
    // M166-Aufräumen: Zeitplan-Vorgänge liefert collectTasks seit M113 SELBST
    // mit (inkl. Person/Frist) — die frühere Extra-Schleife hier erzeugte beim
    // ERSTEN Einsammeln ein Duplikat je Vorgang („… (Zeitplan)" neben dem
    // Original, gleicher Link-Schlüssel) und ist deshalb entfernt.
    // Abgleich: Quelle nicht mehr offen → Ticket erledigen (nur vorwärts).
    // pos:-Adressen (Checklisten-Blöcke ohne echte ID) ausgenommen: BlockNote
    // vergibt beim ersten Edit echte IDs, der pos:-Schlüssel würde dann
    // fälschlich als „erledigt" gelten (Audit R6-S6)
    let moved = 0;
    const items = kanban.items.map((it) => {
      if (
        it.link?.nodeId && it.link.itemId && !it.link.itemId.startsWith('pos:')
        && it.col < done && !openKeys.has(`${it.link.nodeId}|${it.link.itemId}`)
      ) {
        moved++;
        return { ...it, col: done };
      }
      return it;
    });
    if (fresh.length === 0 && moved === 0) {
      if (announce) showToast('Nichts Neues gefunden — alle offenen Aufgaben sind schon hier.');
      return;
    }
    setItems([...items, ...fresh]);
    if (announce) {
      showToast(`${fresh.length} Aufgabe(n) eingesammelt${moved ? `, ${moved} als erledigt abgeglichen` : ''} — Tickets verlinken auf ihre Quelle (↗).`);
    } else if (fresh.length > 0 || moved > 0) {
      showToast(`⟳ Auto-Abgleich: ${fresh.length} neu${moved ? `, ${moved} erledigt` : ''}`);
    }
  };

  // Auto-Einsammeln: solange der ⟳-Schalter aktiv ist, hält sich das Kanban
  // selbst aktuell. Debounced; loop-sicher, weil ein Lauf ohne Änderungen
  // den State nicht anfasst.
  // WICHTIG: `kanban` (die eigenen Node-Daten) gehört in die Deps. Der
  // Store-Render (neue boards) kommt einen Tick VOR dem React-Flow-Prop-Render
  // (neue data) — ohne die Dep feuerte der Timer mit veralteter Closure und
  // ignorierte frisch geänderte ignoreKeys/collectFrom (M68-Debugging).
  useEffect(() => {
    if (!kanban.autoCollect) return;
    // runDerived: Auto-Einsammeln ist aus den Boards rekonstruierbar und darf
    // deshalb nicht als „eigene Bearbeitung" zählen — sonst würde es direkt
    // beim Start das automatische Übernehmen eines neueren Sync-Stands blocken
    const t = setTimeout(() => runDerived(() => syncFromBoards(false)), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, kanban]);

  /**
   * Zentrale Spaltenwechsel-Logik (M119) — gilt für Pfeile, Drag & Drop und
   * die Spalten-Auswahl im Modal gleichermaßen:
   * vorwärts nur ohne offene Abhängigkeiten (M118), in „Erledigt" nur mit
   * kompletter Checkliste, und nie in eine volle WIP-Spalte.
   */
  const tryMoveTo = (item: KanbanItem, target: number) => {
    const col = Math.max(0, Math.min(done, target));
    if (col === item.col) return;
    if (col > item.col) {
      const blockers = ticketBlockers(item, kanban);
      if (blockers.length > 0) {
        showToast(`🔒 Erst erledigen: ${blockers.join(' · ')}`);
        return;
      }
      if (col === done && openSubs(item) > 0) {
        showToast(`☑ Noch ${openSubs(item)} Checklisten-Punkt(e) offen — Ticket öffnen und abhaken.`);
        return;
      }
    }
    if (wipFull(kanban, col)) {
      showToast(`🚦 WIP-Limit erreicht: „${cols[col]}" fasst höchstens ${wipLimitOf(kanban, col)} Ticket(s) — erst dort Platz schaffen.`);
      return;
    }
    if (col === done) {
      confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 }, scalar: 0.8 });
    }
    setItems(kanban.items.map((it) => (it.id === item.id ? { ...it, col } : it)));
  };

  const move = (item: KanbanItem, dir: -1 | 1) => tryMoveTo(item, item.col + dir);

  /**
   * Zyklen-Wächter (M120-Audit): Würde „item hängt an candidate" einen Kreis
   * schließen (A→B→…→A), wären BEIDE Tickets für immer gesperrt. DFS über
   * die bestehenden Abhängigkeiten des Kandidaten.
   */
  const wouldCycle = (itemId: string, candidateId: string): boolean => {
    const byId = new Map(kanban.items.map((x) => [x.id, x]));
    const seen = new Set<string>();
    const stack = [candidateId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === itemId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of byId.get(cur)?.deps ?? []) stack.push(d);
    }
    return false;
  };

  const remove = (item: KanbanItem) => {
    const items = kanban.items
      .filter((it) => it.id !== item.id)
      // Hängende Abhängigkeiten aufräumen (M120-Audit): andere Tickets dürfen
      // nicht auf ein gelöschtes Ticket zeigen
      .map((it) => (it.deps?.includes(item.id)
        ? { ...it, deps: it.deps.filter((d) => d !== item.id) }
        : it));
    // Eingesammelte Tickets: Entfernen merken — sonst legt der Auto-Abgleich
    // das Ticket beim nächsten Lauf sofort wieder an (User-Report)
    if (item.link?.nodeId && item.link.itemId) {
      const key = `${item.link.nodeId}|${item.link.itemId}`;
      updateNodeData(id, { items, ignoreKeys: [...new Set([...(kanban.ignoreKeys ?? []), key])] });
      if (kanban.autoCollect) showToast('Ticket entfernt — wird nicht erneut eingesammelt (⚙ am Kanban macht das rückgängig).');
    } else {
      setItems(items);
    }
  };

  const addItem = () => {
    const text = newText.trim();
    if (!text) return;
    setItems([...kanban.items, { id: uid(), text, col: 0 }]);
    setNewText('');
    // WIP-Hinweis (M120-Audit): Anlegen bleibt immer möglich, aber ehrlich
    // gesagt, wenn die erste Spalte damit über ihrem Limit liegt
    const lim = wipLimitOf(kanban, 0);
    if (lim && kanban.items.filter((it) => colOf(it) === 0).length + 1 > lim) {
      showToast(`🚦 Hinweis: „${cols[0]}" liegt jetzt über dem WIP-Limit (${lim}).`);
    }
  };

  const setTitle = (title: string) => updateNodeData(id, { title });

  const renameCol = (idx: number, name: string) => {
    const next = [...cols];
    next[idx] = name;
    updateNodeData(id, { cols: next });
  };

  const addCol = () => {
    // Neue Spalte vor der Erledigt-Spalte einfügen — „Done" bleibt so immer die letzte
    const next = [...cols];
    next.splice(done, 0, `Spalte ${cols.length}`);
    const items = kanban.items.map((it) => (it.col >= done ? { ...it, col: it.col + 1 } : it));
    // WIP-Limits laufen parallel zu den Spalten mit (M119)
    const wip = [...(kanban.wip ?? [])];
    if (wip.length > done) wip.splice(done, 0, null);
    updateNodeData(id, { cols: next, items, wip });
  };

  const removeCol = (idx: number) => {
    if (cols.length <= 2) {
      showToast('Mindestens zwei Spalten müssen bleiben.');
      return;
    }
    const next = cols.filter((_, i) => i !== idx);
    // Tickets der gelöschten Spalte rücken eine Spalte nach links
    const items = kanban.items.map((it) => {
      if (it.col === idx) return { ...it, col: Math.max(0, idx - 1) };
      if (it.col > idx) return { ...it, col: it.col - 1 };
      return it;
    });
    const wip = (kanban.wip ?? []).filter((_, i) => i !== idx);
    updateNodeData(id, { cols: next, items, wip });
  };

  /** WIP-Limit einer Spalte setzen (M119) — 0/leer = kein Limit */
  const setWip = (idx: number, value: number) => {
    const wip: Array<number | null> = [...(kanban.wip ?? [])];
    while (wip.length < cols.length) wip.push(null);
    wip[idx] = value > 0 ? Math.min(99, value) : null;
    updateNodeData(id, { wip });
  };

  // Defensive: Tickets mit Spaltenindex außerhalb des Bereichs landen in der letzten Spalte
  const colOf = (it: KanbanItem) => Math.max(0, Math.min(done, it.col));

  // ---------- Filter & Gruppierung ----------
  const allTags = useMemo(() => {
    const t = new Set<string>();
    for (const it of kanban.items) for (const tag of ticketTags(it)) t.add(tag);
    return [...t].sort();
  }, [kanban.items]);
  const linkedBoards = useMemo(() => {
    const ids = new Set(kanban.items.map((it) => it.link?.boardId).filter(Boolean) as string[]);
    return boards.filter((b) => ids.has(b.id));
  }, [kanban.items, boards]);

  const matches = (it: KanbanItem): boolean => {
    if (query) {
      const q = query.toLowerCase();
      if (!it.text.toLowerCase().includes(q) && !(it.who ?? '').toLowerCase().includes(q) && !(it.note ?? '').toLowerCase().includes(q)) return false;
    }
    if (quick === 'faellig' && !it.due) return false;
    if (quick === 'ueberfaellig' && urgencyFor(it.due) !== 'overdue') return false;
    if (tagFilter && !ticketTags(it).includes(tagFilter)) return false;
    if (boardFilter && it.link?.boardId !== boardFilter) return false;
    return true;
  };
  const filtering = !!(query || quick !== 'alle' || tagFilter || boardFilter);
  const visibleItems = kanban.items.filter(matches);
  const grouped = kanban.groupBy === 'board';
  const boardName = (bid?: string) => (bid ? boards.find((b) => b.id === bid)?.name ?? 'Board' : '— hier erstellt —');
  const resetFilters = () => { setQuery(''); setQuick('alle'); setTagFilter(''); setBoardFilter(''); };

  // ---------- Einsammeln konfigurieren (Quell-Boards, board-weise räumen) ----------
  const [collectOpen, setCollectOpen] = useState(false);
  const toggleCollectBoard = (bid: string) => {
    const current = kanban.collectFrom ?? boards.map((b) => b.id);
    const next = current.includes(bid) ? current.filter((x) => x !== bid) : [...current, bid];
    // Wieder alle gewählt → Whitelist auflösen, damit auch KÜNFTIGE Boards mitsammeln
    const all = boards.every((b) => next.includes(b.id));
    updateNodeData(id, { collectFrom: all ? undefined : next });
  };
  // M166: einzelne Quell-Module je Board an-/abwählen (feiner als Boards)
  const [openSrcBoard, setOpenSrcBoard] = useState('');
  const toggleCollectNode = (nid: string) => {
    const cur = kanban.collectExcludeNodes ?? [];
    const next = cur.includes(nid) ? cur.filter((x) => x !== nid) : [...cur, nid];
    updateNodeData(id, { collectExcludeNodes: next.length ? next : undefined });
  };
  /** Task-Quellen je Board: Karten, die offene Aufgaben liefern (Notiz-
   *  Checklisten, Kanbans, Zeitpläne — collectTasks kennt sie ALLE, M113)
   *  + Zahl der offenen Punkte */
  const taskSourcesOf = (bid: string): Array<{ nodeId: string; label: string; count: number }> => {
    const counts = new Map<string, number>();
    for (const t of collectTasks(boards)) {
      if (t.boardId !== bid || t.nodeId === id) continue;
      counts.set(t.nodeId, (counts.get(t.nodeId) ?? 0) + 1);
    }
    const b = boards.find((x) => x.id === bid);
    return [...counts.entries()].map(([nodeId, count]) => {
      const n = b?.nodes.find((x) => x.id === nodeId);
      const first = n ? (nodeToText(n).split('\n').find((l) => l.trim())?.trim() ?? '') : '';
      return { nodeId, count, label: (first || 'Karte').slice(0, 46) };
    });
  };

  const clearBoardTickets = (bid: string) => {
    const gone = kanban.items.filter((it) => it.link?.boardId === bid);
    if (gone.length === 0) return;
    const keys = gone
      .filter((it) => it.link?.nodeId && it.link.itemId)
      .map((it) => `${it.link!.nodeId}|${it.link!.itemId}`);
    updateNodeData(id, {
      items: kanban.items.filter((it) => it.link?.boardId !== bid),
      ignoreKeys: [...new Set([...(kanban.ignoreKeys ?? []), ...keys])],
    });
    showToast(`${gone.length} Ticket(s) aus „${boardName(bid)}" entfernt — werden nicht erneut eingesammelt.`);
  };

  const renderItem = (it: KanbanItem, colIdx: number) => (
    <div
      className={`kanban-item nodrag ${colIdx === done ? 'col-done' : colIdx === 0 ? 'col-first' : 'col-mid'} ${dragId === it.id ? 'dragging' : ''}`}
      key={it.id}
      data-kid={it.id}
      draggable
      onDragStart={(e) => {
        // Textauswahl in Eingabefeldern (Fristfeld) darf keinen Ticket-Drag
        // starten (M120-Audit) — Chrome zieht sonst das ganze Ticket mit
        if ((e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', it.id);
        // Marker-Typ: der Board-Drop-Handler lässt Ticket-Drags in Ruhe (M119)
        e.dataTransfer.setData('application/x-pixinotes-ticket', it.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragId(it.id);
      }}
      onDragEnd={() => { setDragId(null); setDragOverCol(null); }}
    >
      <span
        className={`kanban-item-text ${colIdx === done ? 'done-text' : ''}`}
        title="Ticket öffnen (Details, Person, Verknüpfung)"
        onClick={() => setDetailId(it.id)}
      >
        {it.prio && colIdx < done && (
          <b className={`k-prio prio-${it.prio}`} title={`Priorität ${it.prio === 1 ? 'hoch' : it.prio === 2 ? 'mittel' : 'niedrig'}`}>
            {'!'.repeat(4 - it.prio)}{' '}
          </b>
        )}
        {it.text}
      </span>
      {ticketTags(it).length > 0 && (
        <span className="k-labels">
          {ticketTags(it).map((tag) => (
            <button
              key={tag}
              className="k-label nodrag"
              style={{ background: `hsl(${tagHue(tag)} 70% 85%)`, color: `hsl(${tagHue(tag)} 65% 24%)` }}
              title={tagFilter === tag ? `Filter #${tag} aufheben` : `Nur Tickets mit #${tag} zeigen`}
              onClick={() => { setTagFilter(tagFilter === tag ? '' : tag); setFilterOpen(true); }}
            >{tag}</button>
          ))}
        </span>
      )}
      {(it.who || it.note || it.link || it.subs?.length || it.deps?.length || it.links?.length) && (
        <span className="kanban-chips">
          {(it.subs?.length ?? 0) > 0 && (
            <em
              className={`k-subs ${openSubs(it) === 0 ? 'done' : ''}`}
              title={`Checkliste: ${it.subs!.filter((s) => s.done).length}/${it.subs!.length} erledigt — Ticket öffnen`}
              onClick={() => setDetailId(it.id)}
            >☑ {it.subs!.filter((s) => s.done).length}/{it.subs!.length}</em>
          )}
          {colIdx < done && ticketBlockers(it, kanban).length > 0 && (
            <em
              className="k-blocked"
              title={`Blockiert durch: ${ticketBlockers(it, kanban).join(' · ')}`}
              onClick={() => setDetailId(it.id)}
            >🔒</em>
          )}
          {(it.links?.length ?? 0) > 0 && (
            <em className="k-links" title={`${it.links!.length} verknüpfte Karte(n) — Ticket öffnen`} onClick={() => setDetailId(it.id)}>🔗{it.links!.length}</em>
          )}
          {it.who && <em className="k-who" title={it.who}>{it.who.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</em>}
          {it.note && <em className="k-note" title="Hat Beschreibung — Ticket öffnen" onClick={() => setDetailId(it.id)}>≡</em>}
          {it.link && (
            <button
              className="k-link"
              title={`Zur Quelle springen: ${boards.find((b) => b.id === it.link!.boardId)?.name ?? 'Board'}`}
              onClick={() => followLink(it.link!)}
            >
              ↗
            </button>
          )}
        </span>
      )}
      <span className="kanban-item-actions">
        {colIdx > 0 && (
          <button onClick={() => move(it, -1)} title="Zurück"><IChevronL size={11} /></button>
        )}
        {colIdx < done && (
          <button onClick={() => move(it, 1)} title="Weiter"><IChevronR size={11} /></button>
        )}
        <button onClick={() => setEditingDue(editingDue === it.id ? null : it.id)} title="Fälligkeit setzen (Erinnerung!)"><ICalendar size={11} /></button>
        <button onClick={() => remove(it)} title="Entfernen"><IX size={11} /></button>
      </span>
      {editingDue === it.id ? (
        <input
          type="date"
          className="kanban-due-input nodrag"
          autoFocus
          value={it.due ?? ''}
          onChange={(e) =>
            setItems(kanban.items.map((x) => (x.id === it.id ? { ...x, due: e.target.value || undefined } : x)))
          }
          onBlur={() => setEditingDue(null)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingDue(null); }}
        />
      ) : it.due && colIdx < done ? (
        <button
          className={`kanban-due urgency-${urgencyFor(it.due)} nodrag`}
          title="Fälligkeit ändern"
          onClick={() => setEditingDue(it.id)}
        >
          {formatDueShort(it.due)}
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="kanban-head">
        <DragTitle className="kanban-title" value={kanban.title} onChange={setTitle} placeholder="Kanban" />
        <button
          className={`kanban-addcol nodrag ${filterOpen || filtering ? 'k-auto-on' : ''}`}
          title="Filtern & Gruppieren: Suche, Frist, #Tags, Quell-Board (Trello-Stil)"
          onClick={() => { setFilterOpen((o) => !o); if (filterOpen) resetFilters(); }}
        >
          <ISearch size={12} />
        </button>
        <button
          className="kanban-addcol nodrag"
          title="Offene Aufgaben aus ALLEN Boards einsammeln (Kanbans, Checklisten, Zeitpläne)"
          onClick={() => syncFromBoards(true)}
        >
          <IDownload size={12} />
        </button>
        <button
          className={`kanban-addcol nodrag ${kanban.autoCollect ? 'k-auto-on' : ''}`}
          title={kanban.autoCollect
            ? 'Auto-Einsammeln AN: neue Aufgaben erscheinen automatisch, erledigte Quellen haken ihre Tickets ab — Klick schaltet aus'
            : 'Auto-Einsammeln: dieses Kanban hält sich selbst mit den offenen Aufgaben aller Boards aktuell'}
          onClick={() => updateNodeData(id, { autoCollect: !kanban.autoCollect })}
        >
          <IRedo size={12} />
        </button>
        <button
          className={`kanban-addcol nodrag ${collectOpen || kanban.collectFrom ? 'k-auto-on' : ''}`}
          title="Einsammeln konfigurieren: Quell-Boards wählen · Tickets board-weise entfernen · entfernte Tickets wieder zulassen"
          onClick={() => setCollectOpen((o) => !o)}
        >
          <ISettings size={12} />
        </button>
        <button className="kanban-addcol nodrag" title="Spalte hinzufügen" onClick={addCol}><IPlus size={12} /></button>
      </div>
      {filterOpen && (
        <div className="kanban-filter nodrag">
          <input
            className="k-filter-q"
            placeholder="Suchen (Text, Person) …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className={`k-chip ${quick === 'faellig' ? 'on' : ''}`} title="Nur Tickets mit Frist" onClick={() => setQuick(quick === 'faellig' ? 'alle' : 'faellig')}>Frist</button>
          <button className={`k-chip ${quick === 'ueberfaellig' ? 'on' : ''}`} title="Nur überfällige Tickets" onClick={() => setQuick(quick === 'ueberfaellig' ? 'alle' : 'ueberfaellig')}>Überfällig</button>
          {allTags.map((tag) => (
            <button key={tag} className={`k-chip k-tag ${tagFilter === tag ? 'on' : ''}`} title={`Nur Tickets mit #${tag} — Tags einfach im Ticket-Text tippen`} onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}>#{tag}</button>
          ))}
          {linkedBoards.length > 1 && (
            <select className="k-filter-board" value={boardFilter} title="Nur Tickets aus einem Quell-Board" onChange={(e) => setBoardFilter(e.target.value)}>
              <option value="">alle Quell-Boards</option>
              {linkedBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {linkedBoards.length > 0 && (
            <button
              className={`k-chip ${grouped ? 'on' : ''}`}
              title="Tickets in den Spalten nach ihrem Quell-Board gruppieren"
              onClick={() => updateNodeData(id, { groupBy: grouped ? 'none' : 'board' })}
            >
              ⊟ nach Board
            </button>
          )}
          {filtering && <span className="k-filter-count">{visibleItems.length}/{kanban.items.length}</span>}
          {filtering && <button className="k-chip" title="Alle Filter zurücksetzen" onClick={resetFilters}>✕</button>}
        </div>
      )}
      <div className="kanban-cols" ref={colsRef}>
        {depPaths.length > 0 && (
          <svg className="k-dep-svg" aria-hidden="true">
            <defs>
              <marker id={`kdep-open-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#d84b3d" />
              </marker>
              <marker id={`kdep-done-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#2e9e63" />
              </marker>
            </defs>
            {depPaths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                className={`k-dep-path ${p.open ? 'open' : 'done'}`}
                markerEnd={`url(#kdep-${p.open ? 'open' : 'done'}-${id})`}
              />
            ))}
          </svg>
        )}
        {cols.map((colName, colIdx) => {
          const colItems = visibleItems.filter((it) => colOf(it) === colIdx);
          const realCount = kanban.items.filter((it) => colOf(it) === colIdx).length;
          const lim = wipLimitOf(kanban, colIdx);
          return (
            <div
              className={`kanban-col ${dragOverCol === colIdx && dragId ? 'drop-target' : ''}`}
              key={colIdx}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverCol !== colIdx) setDragOverCol(colIdx);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverCol === colIdx) setDragOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation(); // nie zum Board-Drop-Handler durchreichen
                const iid = e.dataTransfer.getData('text/plain') || dragId;
                const item = kanban.items.find((x) => x.id === iid);
                if (item) tryMoveTo(item, colIdx);
                setDragId(null);
                setDragOverCol(null);
              }}
            >
              <div className="kanban-col-head">
                <input
                  className="kanban-col-name nodrag"
                  value={colName}
                  title="Spalte umbenennen"
                  onChange={(e) => renameCol(colIdx, e.target.value)}
                />
                {wipEdit === colIdx ? (
                  <input
                    className="kanban-wip-input nodrag"
                    type="number"
                    min={0}
                    max={99}
                    autoFocus
                    defaultValue={lim ?? ''}
                    placeholder="∞"
                    title="WIP-Limit (leer/0 = keins)"
                    onBlur={(e) => { setWip(colIdx, Number(e.target.value) || 0); setWipEdit(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setWipEdit(null);
                    }}
                  />
                ) : (
                  <button
                    className={`kanban-count nodrag ${lim && realCount >= lim ? 'wip-full' : ''}`}
                    title={colIdx < done
                      ? `${realCount} Ticket(s)${lim ? ` · WIP-Limit ${lim}` : ''} — Klick setzt das WIP-Limit (max. Tickets in dieser Spalte)`
                      : 'Tickets in der Spalte'}
                    onClick={() => colIdx < done && setWipEdit(colIdx)}
                  >
                    {filtering ? colItems.length : realCount}{lim ? `/${lim}` : ''}
                  </button>
                )}
                {cols.length > 2 && (
                  <button
                    className="kanban-col-x nodrag"
                    title="Spalte löschen (Tickets rücken nach links)"
                    onClick={() => removeCol(colIdx)}
                  >
                    <IX size={10} />
                  </button>
                )}
              </div>
              {!grouped
                ? colItems.map((it) => renderItem(it, colIdx))
                : (() => {
                    const groups = new Map<string, KanbanItem[]>();
                    for (const it of colItems) {
                      const k = it.link?.boardId ?? '';
                      if (!groups.has(k)) groups.set(k, []);
                      groups.get(k)!.push(it);
                    }
                    return [...groups.entries()]
                      .sort((a, b) => boardName(a[0] || undefined).localeCompare(boardName(b[0] || undefined), 'de'))
                      .flatMap(([bid, items]) => [
                        <div className="k-group-head" key={`g-${bid}`}>{boardName(bid || undefined)} <em>{items.length}</em></div>,
                        ...items.map((it) => renderItem(it, colIdx)),
                      ]);
                  })()}
            </div>
          );
        })}
      </div>
      <div className="kanban-add nodrag">
        <input
          placeholder="+ Neues Ticket…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
        />
      </div>
      {collectOpen && (
        <div
          className="ticket-detail collect-panel nodrag"
          tabIndex={-1}
          onKeyDown={(e) => e.key === 'Escape' && setCollectOpen(false)}
        >
          <div className="ticket-detail-head">
            <span>Einsammeln konfigurieren</span>
            <button title="Schließen" onClick={() => setCollectOpen(false)}><IX size={12} /></button>
          </div>
          <div className="collect-hint">Haken = aus diesem Board sammeln · ▸ zeigt die einzelnen Quellen-Karten · ✕ räumt Tickets aus dem Kanban</div>
          {boards.map((b) => {
            const checked = !kanban.collectFrom || kanban.collectFrom.includes(b.id);
            const cnt = kanban.items.filter((it) => it.link?.boardId === b.id).length;
            const srcOpen = openSrcBoard === b.id;
            const sources = srcOpen ? taskSourcesOf(b.id) : [];
            return (
              <div key={b.id}>
                <div className="collect-row">
                  <button
                    className={`collect-expand ${srcOpen ? 'open' : ''}`}
                    title={srcOpen ? 'Quellen-Karten einklappen' : 'Einzelne Quellen-Karten dieses Boards an-/abwählen'}
                    onClick={() => setOpenSrcBoard(srcOpen ? '' : b.id)}
                  >
                    <IChevronR size={11} />
                  </button>
                  <label title={checked ? 'Wird eingesammelt — Klick schließt dieses Board aus' : 'Ausgeschlossen — Klick sammelt wieder ein'}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCollectBoard(b.id)} />
                    <span className="collect-name">{b.name}</span>
                  </label>
                  {cnt > 0 && <span className="kanban-count">{cnt}</span>}
                  {cnt > 0 && (
                    <button
                      className="collect-clear"
                      title={`Alle ${cnt} Tickets aus „${b.name}" aus diesem Kanban entfernen (kommen nicht automatisch wieder)`}
                      onClick={() => clearBoardTickets(b.id)}
                    >
                      <IX size={10} />
                    </button>
                  )}
                </div>
                {srcOpen && (
                  /* M166: die einzelnen Quellen-Karten (Checklisten-Notizen,
                     Kanbans, Zeitpläne) — abwählen überspringt NUR diese Karte */
                  <div className="collect-subs">
                    {sources.length === 0 && <div className="collect-sub-empty">Keine offenen Aufgaben-Quellen auf diesem Board.</div>}
                    {sources.map((s) => {
                      const on = !(kanban.collectExcludeNodes ?? []).includes(s.nodeId);
                      return (
                        <label
                          className="collect-sub"
                          key={s.nodeId}
                          title={on ? 'Wird eingesammelt — Klick überspringt künftig genau diese Karte' : 'Abgewählt — Klick sammelt diese Karte wieder ein'}
                        >
                          <input type="checkbox" checked={on} disabled={!checked} onChange={() => toggleCollectNode(s.nodeId)} />
                          <span className="collect-name">{s.label}</span>
                          <span className="collect-sub-count">{s.count}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {(kanban.ignoreKeys?.length ?? 0) > 0 && (
            <button
              className="collect-reset"
              title="Ignorier-Liste leeren — beim nächsten Einsammeln kommen sie zurück"
              onClick={() => { updateNodeData(id, { ignoreKeys: undefined }); showToast('Entfernte Tickets werden wieder eingesammelt (⭳ bzw. ⟳).'); }}
            >
              {kanban.ignoreKeys!.length} dauerhaft entfernte(s) Ticket(s) wieder zulassen
            </button>
          )}
          <div className="ticket-detail-foot">Gilt für ⭳ Einsammeln und ⟳ Auto-Abgleich · Esc schließt</div>
        </div>
      )}
      {(() => {
        const it = kanban.items.find((x) => x.id === detailId);
        if (!it) return null;
        const subs = it.subs ?? [];
        const subsDone = subs.filter((s) => s.done).length;
        const blockers = ticketBlockers(it, kanban);
        const others = kanban.items.filter((x) => x.id !== it.id);
        // Ticket-Modal (M118, Trello-Vorbild) — als Portal über der ganzen App,
        // damit es unabhängig von Kartengröße und Zoom immer gut lesbar ist
        return createPortal(
          <div className="modal-backdrop ticket-modal-backdrop" onClick={() => setDetailId(null)}>
            <div
              className="ticket-modal nodrag"
              tabIndex={-1}
              ref={detailRef}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === 'Escape' && setDetailId(null)}
              role="dialog"
              aria-label="Ticket bearbeiten"
            >
              <div className="ticket-modal-head">
                <input
                  className="ticket-title"
                  value={it.text}
                  onChange={(e) => patchItem(it.id, { text: e.target.value })}
                />
                <button className="taskhub-x" title="Schließen (Esc)" onClick={() => setDetailId(null)}><IX size={14} /></button>
              </div>
              <div className="ticket-meta-row">
                <select
                  className="ticket-colsel"
                  value={Math.min(it.col, done)}
                  title="Spalte"
                  onChange={(e) => tryMoveTo(it, Number(e.target.value))}
                >
                  {cols.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
                <label>📅<input type="date" value={it.due ?? ''} onChange={(e) => patchItem(it.id, { due: e.target.value || undefined })} /></label>
                <label>👤<input type="text" placeholder="Person" value={it.who ?? ''} onChange={(e) => patchItem(it.id, { who: e.target.value || undefined })} /></label>
                <span className="ticket-prio-row" role="group" aria-label="Priorität">
                  {([[1, '!!!'], [2, '!!'], [3, '!']] as const).map(([p, label]) => (
                    <button
                      key={p}
                      className={`prio-btn prio-${p} ${it.prio === p ? 'on' : ''}`}
                      title={p === 1 ? 'hoch' : p === 2 ? 'mittel' : 'niedrig'}
                      onClick={() => patchItem(it.id, { prio: it.prio === p ? undefined : p })}
                    >{label}</button>
                  ))}
                </span>
              </div>

              <textarea
                className="ticket-note"
                rows={4}
                placeholder="Beschreibung / Details / Kontext … (#tags werden zu Labels)"
                value={it.note ?? ''}
                onChange={(e) => patchItem(it.id, { note: e.target.value || undefined })}
              />

              {/* Checkliste (Trello-Stil) mit Fortschrittsbalken */}
              <div className="ticket-section">
                <div className="ticket-section-head">
                  ☑ Checkliste
                  {subs.length > 0 && <span className="ticket-progress-label">{subsDone}/{subs.length}</span>}
                </div>
                {subs.length > 0 && (
                  <div className="ticket-progress"><i style={{ width: `${Math.round((subsDone / subs.length) * 100)}%` }} /></div>
                )}
                {subs.map((s) => (
                  <label key={s.id} className="ticket-sub">
                    <input
                      type="checkbox"
                      checked={!!s.done}
                      onChange={() => patchItem(it.id, { subs: subs.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                    />
                    <span className={s.done ? 'done' : ''}>{s.text}</span>
                    <button title="Punkt entfernen" onClick={() => patchItem(it.id, { subs: subs.filter((x) => x.id !== s.id) })}><IX size={10} /></button>
                  </label>
                ))}
                <input
                  className="ticket-sub-add"
                  placeholder="＋ Punkt hinzufügen und Enter …"
                  onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (e.key === 'Enter' && v) {
                      patchItem(it.id, { subs: [...subs, { id: uid(), text: v.slice(0, 140) }] });
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
              </div>

              {/* Abhängigkeiten: erst wenn alle erledigt sind, darf das Ticket weiter */}
              <div className="ticket-section">
                <div className="ticket-section-head">
                  🔒 Abhängig von
                  {blockers.length > 0 && <span className="ticket-blocked-label">blockiert</span>}
                </div>
                {(it.deps ?? []).map((d) => {
                  const dep = kanban.items.find((x) => x.id === d);
                  if (!dep) return null;
                  const depDone = dep.col >= done;
                  return (
                    <div key={d} className="ticket-dep">
                      <span className={`ticket-dep-state ${depDone ? 'done' : ''}`}>{depDone ? '✓' : '○'}</span>
                      <span className={depDone ? 'done' : ''}>{dep.text}</span>
                      <button title="Abhängigkeit lösen" onClick={() => patchItem(it.id, { deps: (it.deps ?? []).filter((x) => x !== d) })}><IX size={10} /></button>
                    </div>
                  );
                })}
                {others.length > 0 && (
                  <select
                    className="ticket-dep-add"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v || (it.deps ?? []).includes(v)) return;
                      if (wouldCycle(it.id, v)) { showToast('🔁 Das würde einen Abhängigkeits-Kreis schließen — beide Tickets wären für immer gesperrt.'); return; }
                      patchItem(it.id, { deps: [...(it.deps ?? []), v] });
                    }}
                  >
                    <option value="">＋ Ticket wählen, das vorher erledigt sein muss …</option>
                    {others
                      .filter((o) => !(it.deps ?? []).includes(o.id) && !wouldCycle(it.id, o.id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>{o.col >= done ? '✓ ' : ''}{o.text.slice(0, 60)}</option>
                      ))}
                  </select>
                )}
                <div className="ticket-hint">Vorwärts geht es erst, wenn alle Abhängigkeiten erledigt sind.</div>
              </div>

              {/* Verknüpfte Karten/Module aus allen Boards */}
              <div className="ticket-section">
                <div className="ticket-section-head">🔗 Verknüpfte Karten</div>
                {(it.links ?? []).map((l, i) => {
                  const b = boards.find((x) => x.id === l.boardId);
                  const n = b?.nodes.find((x) => x.id === l.nodeId);
                  const label = n ? `${TYPE_ICON[n.type ?? ''] ?? '🗂️'} ${(nodeToText(n).split('\n')[0] || n.type || 'Karte').slice(0, 44)}` : '⚠ Karte fehlt';
                  return (
                    <div key={`${l.nodeId}-${i}`} className="ticket-linkrow">
                      <button className="ticket-linkjump" title={`Öffnen (${b?.name ?? '?'})`} onClick={() => followLink({ boardId: l.boardId, nodeId: l.nodeId })}>
                        {label} <em>· {b?.name ?? '?'}</em>
                      </button>
                      <button title="Verknüpfung entfernen" onClick={() => patchItem(it.id, { links: (it.links ?? []).filter((_, xi) => xi !== i) })}><IX size={10} /></button>
                    </div>
                  );
                })}
                <select
                  className="ticket-link-add"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const [boardId, nodeId] = v.split('::');
                    if ((it.links ?? []).some((l) => l.nodeId === nodeId)) return;
                    patchItem(it.id, { links: [...(it.links ?? []), { boardId, nodeId }] });
                  }}
                >
                  <option value="">＋ Vorhandene Karte/Modul verknüpfen …</option>
                  {boards.map((b) => (
                    <optgroup key={b.id} label={b.name}>
                      {b.nodes.filter((n) => n.id !== id && !n.archived).slice(0, 60).map((n) => (
                        <option key={n.id} value={`${b.id}::${n.id}`}>
                          {TYPE_ICON[n.type ?? ''] ?? '🗂️'} {(nodeToText(n).split('\n')[0] || n.type || 'Karte').slice(0, 60)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Quell-Verknüpfung (Auto-Abgleich) — bestehendes Verhalten */}
              <div className="ticket-section">
                <div className="ticket-section-head"><IFolder size={12} /> Quelle / Board-Verknüpfung</div>
                <div className="ticket-row">
                  <select
                    value={it.link?.boardId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return patchItem(it.id, { link: undefined });
                      // gleiches Board erneut gewählt → nodeId/itemId (Auto-Abgleich!) behalten
                      if (v === it.link?.boardId) return;
                      patchItem(it.id, { link: { boardId: v } });
                    }}
                  >
                    <option value="">— kein Board —</option>
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  {it.link && (
                    <button className="ticket-jump" title="Verknüpftes Board öffnen" onClick={() => followLink(it.link!)}>↗ öffnen</button>
                  )}
                </div>
              </div>

              <div className="ticket-detail-foot">
                Änderungen werden sofort gespeichert · Esc schließt
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}

/** Kanban-Board als Karte auf dem Whiteboard. */
export function KanbanCard({ id, data, selected }: NodeProps<KanbanNode>) {
  return (
    <CardShell id={id} selected={selected} minWidth={330} minHeight={200} className="kanban-card">
      <KanbanBody id={id} data={data} />
    </CardShell>
  );
}
