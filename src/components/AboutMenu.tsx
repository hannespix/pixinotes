import { useBoard } from '../store';
import { useDesign } from '../lib/designAttr';

/**
 * M412: Das Logo führt zur Übersicht.
 *
 * Seit M312 öffnete es die Hilfe. Gewünscht war das Naheliegende: Ein Klick auf den Namen der App bringt nach
 * Hause – zur Übersicht aller Bereiche, Projekte und Boards. Das braucht man täglich, die Hilfe selten. Sie hat
 * jetzt ihren eigenen Knopf (das Fragezeichen in der Aktionsleiste bzw. am Fuß der Spalte), und das Haus-Symbol in
 * der Reiter-Leiste entfällt: zwei Wege zum selben Ziel nebeneinander waren einer zu viel.
 *
 * M561: Agency zeigt „pixi · notes“ als ruhenden Schriftzug mit violettem Trennpunkt.
 */
export function AboutMenu() {
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const setOverviewMode = useBoard((s) => s.setOverviewMode);
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const agency = useDesign() === 'agency';
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
        {agency ? <AgencyMarke /> : <>Pixi<span>Notes</span></>}
      </button>
    </div>
  );
}

function AgencyMarke() {
  return (
    <span className="agency-wortmarke" aria-hidden="true" data-sprache="aus" translate="no">
      <span className="agency-pixi">pixi</span>
      <span className="agency-trennpunkt" />
      <span className="agency-notes">notes</span>
    </span>
  );
}
