import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import confetti from 'canvas-confetti';
import { runDerived, useBoard } from '../../store';
import { kanbanCols, uid, type GanttData, type KanbanData, type KanbanItem, type KanbanNode } from '../../types';
import { collectTasks, formatDueShort, urgencyFor } from '../../lib/tasks';
import { ICalendar, IChevronL, IChevronR, IDownload, IFolder, IPlus, IRedo, ISearch, ISettings, IX } from '../Icons';
import { CardShell } from './CardShell';

/** #Tags aus einem Ticket-Text ziehen (Trello-Labels light: einfach #tag tippen) */
const tagsOf = (text: string): string[] => [...text.matchAll(/#([\p{L}\d_-]{2,20})/gu)].map((m) => m[1].toLowerCase());

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
    // Kanban-Tickets + Checklisten (Aufgaben-Zentrale-Logik) — ohne dieses Kanban selbst
    for (const t of collectTasks(boards)) {
      if (t.nodeId === id) continue;
      const key = `${t.nodeId}|${t.itemId}`;
      openKeys.add(key);
      if (!allowed(t.boardId) || ignored.has(key)) continue;
      if (haveKeys.has(key) || have.has(norm(t.text))) continue;
      have.add(norm(t.text));
      fresh.push({ id: uid(), text: t.text, col: 0, due: t.due, link: { boardId: t.boardId, nodeId: t.nodeId, itemId: t.itemId } });
    }
    // Zeitplan-Vorgänge (< 100 %) — „diverse Module" liefern mit
    for (const b of boards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt' || n.id === id) continue;
        for (const row of (n.data as GanttData).rows ?? []) {
          if ((row.progress ?? 0) >= 100) continue;
          const key = `${n.id}|${row.id}`;
          openKeys.add(key);
          if (!allowed(b.id) || ignored.has(key)) continue;
          const text = `${row.name} (Zeitplan)`;
          if (haveKeys.has(key) || have.has(norm(text))) continue;
          have.add(norm(text));
          fresh.push({ id: uid(), text, col: 0, due: row.end, link: { boardId: b.id, nodeId: n.id, itemId: row.id } });
        }
      }
    }
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

  const move = (item: KanbanItem, dir: -1 | 1) => {
    const col = Math.max(0, Math.min(done, item.col + dir));
    if (col === done && item.col !== col) {
      confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 }, scalar: 0.8 });
    }
    setItems(kanban.items.map((it) => (it.id === item.id ? { ...it, col } : it)));
  };

  const remove = (item: KanbanItem) => {
    const items = kanban.items.filter((it) => it.id !== item.id);
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
    updateNodeData(id, { cols: next, items });
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
    updateNodeData(id, { cols: next, items });
  };

  // Defensive: Tickets mit Spaltenindex außerhalb des Bereichs landen in der letzten Spalte
  const colOf = (it: KanbanItem) => Math.max(0, Math.min(done, it.col));

  // ---------- Filter & Gruppierung ----------
  const allTags = useMemo(() => {
    const t = new Set<string>();
    for (const it of kanban.items) for (const tag of tagsOf(it.text)) t.add(tag);
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
    if (tagFilter && !tagsOf(it.text).includes(tagFilter)) return false;
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
      className={`kanban-item nodrag ${colIdx === done ? 'col-done' : colIdx === 0 ? 'col-first' : 'col-mid'}`}
      key={it.id}
    >
      <span
        className={`kanban-item-text ${colIdx === done ? 'done-text' : ''}`}
        title="Ticket öffnen (Details, Person, Verknüpfung)"
        onClick={() => setDetailId(it.id)}
      >
        {it.text}
      </span>
      {(it.who || it.note || it.link) && (
        <span className="kanban-chips">
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
        <input
          className="kanban-title nodrag"
          value={kanban.title}
          onChange={(e) => setTitle(e.target.value)}
        />
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
          <button className={`k-chip ${quick === 'faellig' ? 'on' : ''}`} title="Nur Tickets mit Frist" onClick={() => setQuick(quick === 'faellig' ? 'alle' : 'faellig')}>⏰ Frist</button>
          <button className={`k-chip ${quick === 'ueberfaellig' ? 'on' : ''}`} title="Nur überfällige Tickets" onClick={() => setQuick(quick === 'ueberfaellig' ? 'alle' : 'ueberfaellig')}>🔥 überfällig</button>
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
      <div className="kanban-cols">
        {cols.map((colName, colIdx) => {
          const colItems = visibleItems.filter((it) => colOf(it) === colIdx);
          return (
            <div className="kanban-col" key={colIdx}>
              <div className="kanban-col-head">
                <input
                  className="kanban-col-name nodrag"
                  value={colName}
                  title="Spalte umbenennen"
                  onChange={(e) => renameCol(colIdx, e.target.value)}
                />
                <span className="kanban-count" title={filtering ? 'sichtbar (gefiltert)' : 'Tickets in der Spalte'}>{colItems.length}</span>
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
          <div className="collect-hint">Haken = aus diesem Board sammeln · ✕ räumt dessen Tickets aus dem Kanban</div>
          {boards.map((b) => {
            const checked = !kanban.collectFrom || kanban.collectFrom.includes(b.id);
            const cnt = kanban.items.filter((it) => it.link?.boardId === b.id).length;
            return (
              <div className="collect-row" key={b.id}>
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
        return (
          <div
            className="ticket-detail nodrag"
            tabIndex={-1}
            ref={detailRef}
            onKeyDown={(e) => e.key === 'Escape' && setDetailId(null)}
          >
            <div className="ticket-detail-head">
              <span>Ticket</span>
              <button title="Schließen" onClick={() => setDetailId(null)}><IX size={12} /></button>
            </div>
            <input
              className="ticket-title"
              value={it.text}
              onChange={(e) => patchItem(it.id, { text: e.target.value })}
            />
            <textarea
              className="ticket-note"
              rows={3}
              placeholder="Beschreibung / Details / Kontext …"
              value={it.note ?? ''}
              onChange={(e) => patchItem(it.id, { note: e.target.value || undefined })}
            />
            <div className="ticket-row">
              <label>Fällig</label>
              <input
                type="date"
                value={it.due ?? ''}
                onChange={(e) => patchItem(it.id, { due: e.target.value || undefined })}
              />
              <label>Person</label>
              <input
                type="text"
                placeholder="wer?"
                value={it.who ?? ''}
                onChange={(e) => patchItem(it.id, { who: e.target.value || undefined })}
              />
            </div>
            <div className="ticket-row">
              <label><IFolder size={12} /> Verknüpft</label>
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
            <div className="ticket-detail-foot">
              Änderungen werden sofort gespeichert · Esc schließt
            </div>
          </div>
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
