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
 * M548: Die Marke ist das Zeichen „PX" mit zwei i-Punkten (liest sich „PIXI"), über das schwarzes Wasser läuft
 * (lib/agencyLogo.ts, nachgeladen), dazu leicht „NOTES". Klassisch und pix·el behalten genau ihr bisheriges Markup.
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

/**
 * Zeichen im Design „Agency" (M548): „PX" mit zwei i-Punkten, über das schwarzes Wasser läuft, dazu leicht „NOTES".
 * Zeichen und Bewegung setzt erst das nachgeladene Modul (lib/agencyLogo.ts) — bis dahin hält ein leerer Platz in der
 * Größe des Zeichens die Kopfleiste ruhig.
 */
function AgencyMarke() {
  const zeichen = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let aus = false;
    let stop: (() => void) | undefined;
    void import('../lib/agencyLogo').then((m) => { if (!aus && zeichen.current) stop = m.logoBewegen(zeichen.current); }).catch(() => { /* bleibt leer, „NOTES" steht */ });
    return () => { aus = true; stop?.(); };
  }, []);
  return (
    <span className="agency-marke" aria-hidden="true">
      <span className="agency-zeichen" ref={zeichen} />
      <span className="agency-zusatz">NOTES</span>
    </span>
  );
}
