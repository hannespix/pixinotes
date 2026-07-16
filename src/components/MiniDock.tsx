import { useMemo } from 'react';
import { useBoard } from '../store';
import { collectTasks } from '../lib/tasks';
import { IHelp, ISearch, ISettings, ITasks } from './Icons';

/**
 * Schlankes Dock für Ansichten OHNE Board-Kontext (Übersicht/Netz):
 * Suche, Aufgaben, Hilfe und Einstellungen bleiben überall erreichbar —
 * das große Dock braucht React-Flow-Kontext und ist dort ausgehängt.
 */
export function MiniDock() {
  const setSearchOpen = useBoard((s) => s.setSearchOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setHelpOpen = useBoard((s) => s.setHelpOpen);
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const setView = useBoard((s) => s.setView);
  const boards = useBoard((s) => s.boards);
  const taskStats = useMemo(() => {
    const ts = collectTasks(boards);
    return { open: ts.length, overdue: ts.filter((t) => t.urgency === 'overdue').length };
  }, [boards]);

  return (
    <div className="dock dock-mini">
      <button className="dock-tasks" onClick={() => { setView('board'); setTasksOpen(true); }} title="Aufgaben & Erinnerungen (alle Boards)" aria-label="Aufgaben">
        <ITasks />
        {taskStats.open > 0 && (
          <span className={`dock-badge ${taskStats.overdue > 0 ? 'red' : ''}`}>{taskStats.open}</span>
        )}
      </button>
      <span className="dock-sep" />
      <button onClick={() => setSearchOpen(true)} title="Suche über alle Boards (Strg+K)" aria-label="Suche"><ISearch /></button>
      <button onClick={() => setHelpOpen(true)} title="Hilfe: alle Funktionen erklärt" aria-label="Hilfe"><IHelp /></button>
      <button onClick={() => setSettingsOpen(true)} title="Einstellungen (KI, Synchronisation, Kalender, Export)" aria-label="Einstellungen"><ISettings /></button>
    </div>
  );
}
