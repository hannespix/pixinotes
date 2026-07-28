import { useMemo } from 'react';
import { useBoard } from '../store';
import { collectTasks } from '../lib/tasks';
import { ITasks } from './Icons';

/**
 * Schlankes Dock für Ansichten OHNE Board-Kontext (Übersicht/Netz):
 * Suche, Aufgaben, Hilfe und Einstellungen bleiben überall erreichbar —
 * das große Dock braucht React-Flow-Kontext und ist dort ausgehängt.
 */
export function MiniDock() {
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const setView = useBoard((s) => s.setView);
  const boards = useBoard((s) => s.boards);
  const taskStats = useMemo(() => {
    const ts = collectTasks(boards);
    return { open: ts.length, overdue: ts.filter((t) => t.urgency === 'overdue').length };
  }, [boards]);

  return (
    <div className="dock dock-mini">
      <button
        className="dock-tasks"
        onClick={() => { setView('board'); setTasksOpen(true); }}
        title={taskStats.open > 0
          ? `Aufgaben & Erinnerungen: ${taskStats.open} offen über alle Boards`
            + (taskStats.overdue > 0 ? ` — davon ${taskStats.overdue} überfällig (darum rot)` : ' — nichts überfällig')
          : 'Aufgaben & Erinnerungen (alle Boards) — aktuell nichts offen'}
        // aria-label bewusst FEST: Die Zahl steht sichtbar im Badge daneben und
        // wird ohnehin mitgelesen — ein wechselndes Label macht den Knopf für
        // Screenreader (und für Tests) zu einem beweglichen Ziel.
        aria-label="Aufgaben"
      >
        <ITasks />
        {taskStats.open > 0 && (
          <span className={`dock-badge ${taskStats.overdue > 0 ? 'red' : ''}`}>{taskStats.open}</span>
        )}
      </button>
    </div>
  );
}
