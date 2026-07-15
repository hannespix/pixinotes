import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { useBoard } from '../store';
import { doneCol, uid, type KanbanData } from '../types';
import { makeKanban } from '../lib/nodes';
import {
  collectTasks, downloadTasksIcs, formatDueShort, toggleCheckBlock, type TaskRef,
} from '../lib/tasks';
import { IBell, ICalendar, IKanban, INote, IX } from './Icons';

type Filter = 'all' | 'today' | 'overdue';

/**
 * Aufgaben-Zentrale: alle offenen Kanban-Tickets und Checklisten-Punkte aus
 * ALLEN Boards. Filter (Alle/Heute/Überfällig + Board), Fälligkeit direkt
 * editierbar, Schnell-Eingabe legt neue Tickets an. Abhaken hier, Klick
 * springt zur Karte.
 */
export function TaskHub() {
  const open = useBoard((s) => s.tasksOpen);
  const setOpen = useBoard((s) => s.setTasksOpen);
  const boards = useBoard((s) => s.boards);
  const openBoard = useBoard((s) => s.openBoard);
  const focusNode = useBoard((s) => s.focusNode);
  const updateNodeDataOnBoard = useBoard((s) => s.updateNodeDataOnBoard);
  const showToast = useBoard((s) => s.showToast);
  const [, tick] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [boardFilter, setBoardFilter] = useState('all');
  const [quick, setQuick] = useState('');

  const todayIso = new Date().toISOString().slice(0, 10);
  const allTasks = useMemo(() => collectTasks(boards), [boards]);
  const tasks = allTasks.filter((t) => {
    if (boardFilter !== 'all' && t.boardId !== boardFilter) return false;
    if (filter === 'today') return t.urgency === 'overdue' || t.due === todayIso;
    if (filter === 'overdue') return t.urgency === 'overdue';
    return true;
  });
  const overdue = allTasks.filter((t) => t.urgency === 'overdue').length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') { t.blur(); return; }
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const complete = (t: TaskRef) => {
    const board = boards.find((b) => b.id === t.boardId);
    const node = board?.nodes.find((n) => n.id === t.nodeId);
    if (!board || !node) return;
    if (t.kind === 'kanban') {
      const k = node.data as KanbanData;
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        items: k.items.map((it) => (it.id === t.itemId ? { ...it, col: doneCol(k) } : it)),
      });
      confetti({ particleCount: 45, spread: 50, origin: { y: 0.4 }, scalar: 0.75 });
    } else {
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        blocks: toggleCheckBlock(node.data.blocks as unknown[] | undefined, t.itemId),
      });
    }
  };

  /** Fälligkeit einer Kanban-Aufgabe direkt in der Liste ändern (T2) */
  const setDue = (t: TaskRef, due: string) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node) return;
    const k = node.data as KanbanData;
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? { ...it, due: due || undefined } : it)),
    });
  };

  /** Schnell-Eingabe: Ticket im Kanban des aktiven Boards anlegen (T3) */
  const quickAdd = () => {
    const text = quick.trim();
    if (!text) return;
    const st = useBoard.getState();
    const board = st.boards.find((b) => b.id === st.activeId) ?? st.boards[0];
    let kanban = board.nodes.find((n) => n.type === 'kanban') as import('../types').AppNode | undefined;
    if (!kanban) {
      kanban = makeKanban({ x: 140, y: 140 }, 'Aufgaben');
      st.addNode(kanban);
    }
    const k = kanban.data as KanbanData;
    st.updateNodeDataOnBoard(board.id, kanban.id, { items: [...k.items, { id: uid(), text, col: 0 }] });
    setQuick('');
    showToast(`Aufgabe in „${board.name}" angelegt`);
  };

  const jumpTo = (t: TaskRef) => {
    setOpen(false);
    openBoard(t.boardId);
    focusNode(t.boardId, t.nodeId);
  };

  const enableNotifications = async () => {
    try {
      const perm = await Notification.requestPermission();
      showToast(perm === 'granted'
        ? 'Browser-Benachrichtigungen aktiv — Erinnerungen kommen auch als System-Meldung.'
        : 'Benachrichtigungen nicht erlaubt — Erinnerungen erscheinen weiter in der App.');
      tick((n) => n + 1);
    } catch {
      showToast('Dieser Browser unterstützt keine Benachrichtigungen.');
    }
  };

  const exportIcs = () => {
    const n = downloadTasksIcs(tasks);
    showToast(n > 0
      ? `${n} Aufgabe(n) mit Frist als Kalender-Datei exportiert — in Outlook öffnen.`
      : 'Keine Aufgaben mit Fälligkeitsdatum in dieser Ansicht.');
  };

  const canAskNotify = 'Notification' in window && Notification.permission === 'default';

  return (
    <div className="taskhub" role="dialog" aria-label="Aufgaben">
      <div className="taskhub-head">
        <h2>Aufgaben</h2>
        <span className="taskhub-meta">
          {tasks.length} angezeigt{overdue > 0 ? ` · ${overdue} überfällig` : ''}
        </span>
        <span className="taskhub-actions">
          {canAskNotify && (
            <button onClick={enableNotifications} title="Erinnerungen zusätzlich als System-Benachrichtigung"><IBell size={14} /> Benachrichtigungen</button>
          )}
          <button onClick={exportIcs} title="Angezeigte Aufgaben mit Frist als .ics (Outlook-Kalender)"><ICalendar size={14} /> Kalender-Export</button>
          <button className="taskhub-x" onClick={() => setOpen(false)} aria-label="Schließen"><IX size={14} /></button>
        </span>
      </div>

      {/* Filter (T1) */}
      <div className="taskhub-filters">
        {([['all', 'Alle'], ['today', 'Heute'], ['overdue', 'Überfällig']] as const).map(([f, label]) => (
          <button key={f} className={`th-chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
        <select className="th-board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} title="Nach Board filtern">
          <option value="all">Alle Boards</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Schnell-Eingabe (T3) */}
      <input
        className="taskhub-quick"
        placeholder="Neue Aufgabe eingeben und Enter drücken — landet im Kanban des aktiven Boards"
        value={quick}
        onChange={(e) => setQuick(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
      />

      {tasks.length === 0 ? (
        <div className="taskhub-empty">
          {filter === 'all' && boardFilter === 'all'
            ? 'Nichts offen! Neue Aufgaben entstehen aus Kanban-Tickets und Checklisten in Notizen — oder oben per Schnell-Eingabe.'
            : 'Keine Aufgaben in dieser Ansicht.'}
        </div>
      ) : (
        <ul className="taskhub-list">
          {tasks.map((t) => (
            <li key={t.key} className={`task-row urgency-${t.urgency}`}>
              <input
                type="checkbox"
                title="Erledigt"
                onChange={() => complete(t)}
                aria-label={`„${t.text}" erledigen`}
              />
              <button className="task-text" title="Zur Karte springen" onClick={() => jumpTo(t)}>
                <span className="task-kind">{t.kind === 'kanban' ? <IKanban size={13} /> : <INote size={13} />}</span>
                {t.text}
              </button>
              {t.kind === 'kanban' && (
                <input
                  type="date"
                  className={`task-due-input urgency-${t.urgency}`}
                  value={t.due ?? ''}
                  title="Fälligkeit ändern"
                  onChange={(e) => setDue(t, e.target.value)}
                />
              )}
              {t.due && <span className={`task-due urgency-${t.urgency}`}>{formatDueShort(t.due)}</span>}
              <span className="task-board">{t.boardName}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="taskhub-foot">
        Fällige Aufgaben melden sich beim Öffnen der App und danach regelmäßig als Erinnerung.
      </div>
    </div>
  );
}
