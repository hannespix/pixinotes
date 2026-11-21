import { useBoard } from '../store';

/**
 * M412: Das Logo führt zur Übersicht.
 *
 * Seit M312 öffnete es die Hilfe. Gewünscht war das Naheliegende: Ein Klick auf den Namen der App bringt nach
 * Hause – zur Übersicht aller Bereiche, Projekte und Boards. Das braucht man täglich, die Hilfe selten. Sie hat
 * jetzt ihren eigenen Knopf (das Fragezeichen in der Aktionsleiste bzw. am Fuß der Spalte), und das Haus-Symbol in
 * der Reiter-Leiste entfällt: zwei Wege zum selben Ziel nebeneinander waren einer zu viel.
 */
export function AboutMenu() {
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const setOverviewMode = useBoard((s) => s.setOverviewMode);
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const aktiv = view === 'overview';
  return (
    <div className="logo-wrap">
      <button
        className={`logo ${aktiv ? 'active' : ''}`}
        onClick={() => { setOverviewMode('hierarchie'); setTasksOpen(false); setView('overview'); }}
        data-taste="uebersicht"
        title="Übersicht – alle Bereiche, Projekte und Boards"
        aria-label="PixiNotes – zur Übersicht"
        aria-current={aktiv ? 'page' : undefined}
      >
        Pixi<span>Notes</span>
      </button>
    </div>
  );
}
