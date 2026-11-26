import { useEffect, useRef } from 'react';
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
 * M547: Im Design „Agency" (nach vave.log, eigenes Werk des Besitzers) eine eigene Marke statt der Wortmarke.
 * M550: In Agency atmet „pixi“ neben dem violetten Punkt und dem ruhig gesetzten „notes“.
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
  const marke = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let aus = false;
    let stop: (() => void) | undefined;
    void import('../lib/agencyLogo').then((m) => {
      if (!aus && marke.current) stop = m.agencyBewegen(marke.current);
    }).catch(() => { /* Das Standbild steht bereits. */ });
    return () => { aus = true; stop?.(); };
  }, []);
  return (
    <span className="agency-wortmarke" aria-hidden="true" data-sprache="aus" translate="no">
      <span className="agency-pixi" ref={marke}><span className="agency-wortmarke-text">pixi</span></span>
      <span className="agency-trennpunkt" />
      <span className="agency-notes">notes</span>
    </span>
  );
}
