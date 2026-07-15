import { useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import confetti from 'canvas-confetti';
import { useBoard } from '../../store';
import { kanbanCols, uid, type GanttData, type KanbanData, type KanbanItem, type KanbanNode } from '../../types';
import { collectTasks, formatDueShort, urgencyFor } from '../../lib/tasks';
import { ICalendar, IChevronL, IChevronR, IDownload, IFolder, IPlus, IRedo, IX } from '../Icons';
import { CardShell } from './CardShell';

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
    const openKeys = new Set<string>();
    const fresh: KanbanItem[] = [];
    // Kanban-Tickets + Checklisten (Aufgaben-Zentrale-Logik) — ohne dieses Kanban selbst
    for (const t of collectTasks(boards)) {
      if (t.nodeId === id) continue;
      openKeys.add(`${t.nodeId}|${t.itemId}`);
      if (have.has(norm(t.text))) continue;
      have.add(norm(t.text));
      fresh.push({ id: uid(), text: t.text, col: 0, due: t.due, link: { boardId: t.boardId, nodeId: t.nodeId, itemId: t.itemId } });
    }
    // Zeitplan-Vorgänge (< 100 %) — „diverse Module" liefern mit
    for (const b of boards) {
      for (const n of b.nodes) {
        if (n.type !== 'gantt' || n.id === id) continue;
        for (const row of (n.data as GanttData).rows ?? []) {
          if ((row.progress ?? 0) >= 100) continue;
          openKeys.add(`${n.id}|${row.id}`);
          const text = `${row.name} (Zeitplan)`;
          if (have.has(norm(text))) continue;
          have.add(norm(text));
          fresh.push({ id: uid(), text, col: 0, due: row.end, link: { boardId: b.id, nodeId: n.id, itemId: row.id } });
        }
      }
    }
    // Abgleich: Quelle nicht mehr offen → Ticket erledigen (nur vorwärts)
    let moved = 0;
    const items = kanban.items.map((it) => {
      if (it.link?.nodeId && it.link.itemId && it.col < done && !openKeys.has(`${it.link.nodeId}|${it.link.itemId}`)) {
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
  useEffect(() => {
    if (!kanban.autoCollect) return;
    const t = setTimeout(() => syncFromBoards(false), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, kanban.autoCollect]);

  const move = (item: KanbanItem, dir: -1 | 1) => {
    const col = Math.max(0, Math.min(done, item.col + dir));
    if (col === done && item.col !== col) {
      confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 }, scalar: 0.8 });
    }
    setItems(kanban.items.map((it) => (it.id === item.id ? { ...it, col } : it)));
  };

  const remove = (item: KanbanItem) =>
    setItems(kanban.items.filter((it) => it.id !== item.id));

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

  return (
    <>
      <div className="kanban-head">
        <input
          className="kanban-title nodrag"
          value={kanban.title}
          onChange={(e) => setTitle(e.target.value)}
        />
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
        <button className="kanban-addcol nodrag" title="Spalte hinzufügen" onClick={addCol}><IPlus size={12} /></button>
      </div>
      <div className="kanban-cols">
        {cols.map((colName, colIdx) => (
          <div className="kanban-col" key={colIdx}>
            <div className="kanban-col-head">
              <input
                className="kanban-col-name nodrag"
                value={colName}
                title="Spalte umbenennen"
                onChange={(e) => renameCol(colIdx, e.target.value)}
              />
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
            {kanban.items
              .filter((it) => colOf(it) === colIdx)
              .map((it) => (
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
              ))}
          </div>
        ))}
      </div>
      <div className="kanban-add nodrag">
        <input
          placeholder="+ Neues Ticket…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addItem()}
        />
      </div>
      {(() => {
        const it = kanban.items.find((x) => x.id === detailId);
        if (!it) return null;
        return (
          <div className="ticket-detail nodrag" onKeyDown={(e) => e.key === 'Escape' && setDetailId(null)}>
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
                onChange={(e) => patchItem(it.id, { link: e.target.value ? { boardId: e.target.value } : undefined })}
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
