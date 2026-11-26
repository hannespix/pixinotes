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
 * M547: Im Design „vave.log" steht die Wortmarke wie dort gebaut — kräftiges Wort, violetter Punkt, leichter Zusatz
 * („PIXI · NOTES" statt „VAVE · LOG") — und das kräftige Wort atmet in den Gesten des vave-Logos (lib/vaveLogo.ts,
 * nachgeladen). Klassisch und pix·el behalten genau ihr bisheriges Markup.
 */
export function AboutMenu() {
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const setOverviewMode = useBoard((s) => s.setOverviewMode);
  const setTasksOpen = useBoard((s) => s.setTasksOpen);
  const vave = useDesign() === 'vave';
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
        {vave ? <VaveMarke /> : <>Pixi<span>Notes</span></>}
      </button>
    </div>
  );
}

/** Wortmarke im vave.log-Design; die Bewegung lädt erst, wenn sie gezeigt wird */
function VaveMarke() {
  const wort = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let aus = false;
    let stop: (() => void) | undefined;
    void import('../lib/vaveLogo').then((m) => { if (!aus && wort.current) stop = m.logoBewegen(wort.current); }).catch(() => { /* steht still */ });
    return () => { aus = true; stop?.(); };
  }, []);
  return (
    <span className="vave-marke" aria-hidden="true">
      <span className="vave-wort" ref={wort}>{['P', 'I', 'X', 'I'].map((b, i) => <span key={i} className="vave-b">{b}</span>)}</span>
      <span className="vave-punkt" />
      <span className="vave-zusatz">NOTES</span>
    </span>
  );
}
