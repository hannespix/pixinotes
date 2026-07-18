import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { useBoard } from '../store';
import { doneCol, uid, type GanttData, type KanbanData } from '../types';
import { makeKanban } from '../lib/nodes';
import {
  collectTasks, downloadTasksIcs, formatDueShort, shiftIso, toggleCheckBlock, type TaskRef,
} from '../lib/tasks';
import { IBell, ICalendar, IGantt, IKanban, INote, IUsers, IX } from './Icons';

type Filter = 'all' | 'today' | 'overdue';

/** Fristen-Gruppen der Aufgabenliste (M113) */
type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
const BUCKETS: Array<[Bucket, string]> = [
  ['overdue', 'Überfällig'],
  ['today', 'Heute'],
  ['week', 'Diese Woche'],
  ['later', 'Später'],
  ['none', 'Ohne Frist'],
];

function bucketOf(t: TaskRef, todayIso: string): Bucket {
  if (!t.due) return 'none';
  if (t.urgency === 'overdue') return 'overdue';
  if (t.due === todayIso) return 'today';
  const days = Math.round((new Date(`${t.due}T12:00:00`).getTime() - new Date(`${todayIso}T12:00:00`).getTime()) / 864e5);
  return days <= 7 ? 'week' : 'later';
}

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
  const [personFilter, setPersonFilter] = useState('all');
  const [groupByPerson, setGroupByPerson] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState('');

  const todayIso = new Date().toISOString().slice(0, 10);
  const allTasks = useMemo(() => collectTasks(boards), [boards]);
  const persons = useMemo(
    () => [...new Set(allTasks.map((t) => t.who).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [allTasks],
  );
  const tasks = allTasks.filter((t) => {
    if (boardFilter !== 'all' && t.boardId !== boardFilter) return false;
    if (personFilter !== 'all' && t.who !== personFilter) return false;
    if (filter === 'today') return t.urgency === 'overdue' || t.due === todayIso;
    if (filter === 'overdue') return t.urgency === 'overdue';
    return true;
  });
  const overdue = allTasks.filter((t) => t.urgency === 'overdue').length;

  // Gruppierte Ansicht (M113): nach Frist-Abschnitten oder nach Person
  const groups = useMemo(() => {
    if (groupByPerson) {
      const by = new Map<string, TaskRef[]>();
      for (const t of tasks) {
        const k = t.who ?? '— ohne Person —';
        by.set(k, [...(by.get(k) ?? []), t]);
      }
      return [...by.entries()].sort((a, b) =>
        (a[0].startsWith('—') ? 1 : 0) - (b[0].startsWith('—') ? 1 : 0) || a[0].localeCompare(b[0]));
    }
    return BUCKETS
      .map(([b, label]) => [label, tasks.filter((t) => bucketOf(t, todayIso) === b)] as [string, TaskRef[]])
      .filter(([, list]) => list.length > 0);
  }, [tasks, groupByPerson, todayIso]);

  const toggleGroup = (name: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

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
    } else if (t.kind === 'gantt') {
      // Gantt-Vorgang erledigen = Fortschritt auf 100 % (M113)
      const g = node.data as GanttData;
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        rows: g.rows.map((r) => (r.id === t.itemId ? { ...r, progress: 100 } : r)),
      });
      confetti({ particleCount: 45, spread: 50, origin: { y: 0.4 }, scalar: 0.75 });
    } else {
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        blocks: toggleCheckBlock(node.data.blocks as unknown[] | undefined, t.itemId),
      });
    }
  };

  /** Fälligkeit direkt in der Liste ändern — Kanban-Frist bzw. Gantt-Ende (T2/M113) */
  const setDue = (t: TaskRef, due: string) => {
    const node = boards.find((b) => b.id === t.boardId)?.nodes.find((n) => n.id === t.nodeId);
    if (!node) return;
    if (t.kind === 'gantt') {
      if (!due) return; // ein Gantt-Balken braucht immer ein Ende
      const g = node.data as GanttData;
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        rows: g.rows.map((r) => (r.id === t.itemId
          ? { ...r, end: due, start: r.start > due ? due : r.start }
          : r)),
      });
      return;
    }
    const k = node.data as KanbanData;
    updateNodeDataOnBoard(t.boardId, t.nodeId, {
      items: k.items.map((it) => (it.id === t.itemId ? { ...it, due: due || undefined } : it)),
    });
  };

  /** Schlummern (M113): Frist ehrlich verschieben — +1 Tag / +1 Woche */
  const snooze = (t: TaskRef, days: number) => {
    const base = t.due && t.urgency !== 'overdue' ? t.due : todayIso;
    setDue(t, shiftIso(base, days));
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
        {persons.length > 0 && (
          <select className="th-board" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} title="Nach Person filtern (Ticket-Zuständigkeit / Gantt-Ressource)">
            <option value="all">Alle Personen</option>
            {persons.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {persons.length > 0 && (
          <button
            className={`th-chip ${groupByPerson ? 'on' : ''}`}
            onClick={() => setGroupByPerson((g) => !g)}
            title="Nach Person gruppieren — wer macht was?"
          ><IUsers size={13} /></button>
        )}
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
        <div className="taskhub-list">
          {groups.map(([name, list]) => (
            <section key={name} className="th-group">
              <button className="th-group-head" onClick={() => toggleGroup(name)} aria-expanded={!collapsed.has(name)}>
                <span className="th-group-caret">{collapsed.has(name) ? '▸' : '▾'}</span>
                {name}
                <span className="th-group-count">{list.length}</span>
              </button>
              {!collapsed.has(name) && (
                <ul>
                  {list.map((t) => (
                    <li key={t.key} className={`task-row urgency-${t.urgency}`}>
                      <input
                        type="checkbox"
                        title={t.kind === 'gantt' ? 'Erledigt (Fortschritt 100 %)' : 'Erledigt'}
                        onChange={() => complete(t)}
                        aria-label={`„${t.text}" erledigen`}
                      />
                      <button className="task-text" title="Zur Karte springen" onClick={() => jumpTo(t)}>
                        <span className="task-kind">
                          {t.kind === 'kanban' ? <IKanban size={13} /> : t.kind === 'gantt' ? <IGantt size={13} /> : <INote size={13} />}
                        </span>
                        {t.text}
                      </button>
                      {t.who && !groupByPerson && <span className="task-who" title="Zuständig">{t.who}</span>}
                      {(t.kind === 'kanban' || t.kind === 'gantt') && (
                        <input
                          type="date"
                          className={`task-due-input urgency-${t.urgency}`}
                          value={t.due ?? ''}
                          title={t.kind === 'gantt' ? 'Ende des Vorgangs ändern' : 'Fälligkeit ändern'}
                          onChange={(e) => setDue(t, e.target.value)}
                        />
                      )}
                      {t.due && <span className={`task-due urgency-${t.urgency}`}>{formatDueShort(t.due)}</span>}
                      {(t.kind === 'kanban' || t.kind === 'gantt') && (
                        <span className="task-snooze" role="group" aria-label="Schlummern">
                          <button title="Um 1 Tag verschieben" onClick={() => snooze(t, 1)}>+1T</button>
                          <button title="Um 1 Woche verschieben" onClick={() => snooze(t, 7)}>+1W</button>
                        </span>
                      )}
                      <span className="task-board">{t.boardName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      <div className="taskhub-foot">
        Fällige Aufgaben melden sich beim Öffnen der App und danach regelmäßig als Erinnerung.
      </div>
    </div>
  );
}
