import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { useBoard } from '../store';
import { doneCol, type KanbanData } from '../types';
import {
  collectTasks, downloadTasksIcs, formatDueShort, toggleCheckBlock, type TaskRef,
} from '../lib/tasks';

const KIND_ICON = { kanban: '📋', check: '📝' } as const;

/**
 * Aufgaben-Zentrale: alle offenen Kanban-Tickets und Checklisten-Punkte aus
 * ALLEN Boards, sortiert nach Dringlichkeit. Abhaken direkt hier, Klick
 * springt zur Karte. Wird als eigene Ansicht gerendert (Board ausgehängt),
 * damit Checklisten-Änderungen sauber in die Notiz-Editoren zurückfließen.
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

  const tasks = useMemo(() => collectTasks(boards), [boards]);
  const overdue = tasks.filter((t) => t.urgency === 'overdue').length;

  // Esc schließt die Zentrale
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
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
      const done = doneCol(k);
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        items: k.items.map((it) => (it.id === t.itemId ? { ...it, col: done } : it)),
      });
      confetti({ particleCount: 45, spread: 50, origin: { y: 0.4 }, scalar: 0.75 });
    } else {
      updateNodeDataOnBoard(t.boardId, t.nodeId, {
        blocks: toggleCheckBlock(node.data.blocks as unknown[] | undefined, t.itemId),
      });
    }
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
        ? '🔔 Browser-Benachrichtigungen aktiv — Erinnerungen kommen auch als System-Meldung.'
        : 'Benachrichtigungen nicht erlaubt — Erinnerungen erscheinen weiter als Hinweis in der App.');
      tick((n) => n + 1);
    } catch {
      showToast('Dieser Browser unterstützt keine Benachrichtigungen.');
    }
  };

  const exportIcs = () => {
    const n = downloadTasksIcs(tasks);
    showToast(n > 0
      ? `📆 ${n} Aufgabe(n) mit Frist als Kalender-Datei exportiert — in Outlook öffnen.`
      : 'Keine Aufgaben mit Fälligkeitsdatum vorhanden.');
  };

  const canAskNotify = 'Notification' in window && Notification.permission === 'default';

  return (
    <div className="taskhub" role="dialog" aria-label="Aufgaben">
      <div className="taskhub-head">
        <h2>✅ Aufgaben</h2>
        <span className="taskhub-meta">
          {tasks.length} offen{overdue > 0 ? ` · ${overdue} überfällig` : ''}
        </span>
        <span className="taskhub-actions">
          {canAskNotify && (
            <button onClick={enableNotifications} title="Erinnerungen zusätzlich als System-Benachrichtigung">🔔 Benachrichtigungen</button>
          )}
          <button onClick={exportIcs} title="Alle Aufgaben mit Frist als .ics (Outlook-Kalender)">📆 Kalender-Export</button>
          <button className="taskhub-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </span>
      </div>
      {tasks.length === 0 ? (
        <div className="taskhub-empty">
          🎉 Nichts offen! Neue Aufgaben entstehen aus Kanban-Tickets und ☐-Checklisten in Notizen.
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
                <span className="task-kind">{KIND_ICON[t.kind]}</span>
                {t.text}
              </button>
              {t.due && <span className={`task-due urgency-${t.urgency}`}>📅 {formatDueShort(t.due)}</span>}
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
