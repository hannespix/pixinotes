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
 * M547: Im Design „Agency" (nach vave.log, eigenes Werk des Besitzers) steht die Wortmarke wie dort gebaut — kräftiges Wort, violetter Punkt, leichter Zusatz
 * („PIXI · NOTES" statt „VAVE · LOG") — und das kräftige Wort atmet in den Gesten des vave-Logos (lib/agencyLogo.ts,
 * nachgeladen). Klassisch und pix·el behalten genau ihr bisheriges Markup.
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

/** Wortmarke im Design „Agency"; die Bewegung lädt erst, wenn sie gezeigt wird */
function AgencyMarke() {
  const wort = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let aus = false;
    let stop: (() => void) | undefined;
    void import('../lib/agencyLogo').then((m) => { if (!aus && wort.current) stop = m.logoBewegen(wort.current); }).catch(() => { /* steht still */ });
    return () => { aus = true; stop?.(); };
  }, []);
  return (
    <span className="agency-marke" aria-hidden="true">
      <span className="agency-wort" ref={wort}>{['P', 'I', 'X', 'I'].map((b, i) => <span key={i} className="agency-b">{b}</span>)}</span>
      <span className="agency-punkt" />
      <span className="agency-zusatz">NOTES</span>
    </span>
  );
}
