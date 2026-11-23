// M364: Gruppenarbeit sichtbar machen — wer ist gerade im Board, wer bearbeitet welche Karte, wie heiße ich.
//
// Die Angaben kommen aus dem Live-Kanal (lib/gastSync.ts). Hier nur die Anzeige:
//   · LiveLeiste     – Kürzel der Anwesenden oben rechts; antippen zeigt alle und die Werkzeuge der Gruppe (M391);
//                      nachgeladen aus LiveLeisteVoll.tsx, sobald das Board live ist (M477)
//   · LiveSperren    – farbiger Rahmen mit Namensschild um jede Karte, die gerade ein anderer bearbeitet
//   · GastNameDialog – „Wie heißt du?" beim Einwählen ohne Konto
import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { useInternalNode } from '@xyflow/react';
import { useBoard } from '../store';
import { liveAuf, nameGeaendert, SPERREN_EREIGNIS, sperrenVon, TEILNEHMER_EREIGNIS } from '../lib/liveStand';
import type { Teilnehmer } from '../lib/liveKanal';
import { getAuthor, setAuthor } from '../lib/autor';
import { IX } from './Icons';

export const NAME_FRAGEN = 'pixinotes:gast-name';

/** Neu zeichnen, sobald das Ereignis kommt (M477: auch NoteCard und die nachgeladene Leiste nutzen es) */
export function useTakt(ereignis: string): void {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(ereignis, auf);
    return () => window.removeEventListener(ereignis, auf);
  }, [ereignis]);
}

/** „Mara Lindner" → ML, „gast" → GA */
export function kuerzel(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  const k = teile.length === 1 ? teile[0].slice(0, 2) : teile[0][0] + teile[teile.length - 1][0];
  return k.toLocaleUpperCase('de');
}
export const farbe = (f: string): CSSProperties => ({ '--farbe': f } as CSSProperties);

/**
 * M477: Die Leiste selbst (Kürzel, Liste, Werkzeuge der Gruppe) lädt erst, wenn das Board live ist — sie zeigt ohne
 * Kanal ohnehin nichts. So bleibt im Start-Paket Platz für das gemeinsame Tippen (Grenze in m446/m459/m467).
 */
const LiveLeisteVoll = lazy(() => import('./LiveLeisteVoll'));
export function LiveLeiste() {
  const boardId = useBoard((s) => s.activeId);
  useTakt(TEILNEHMER_EREIGNIS);
  if (!liveAuf(boardId)) return null;
  return <Suspense fallback={null}><LiveLeisteVoll /></Suspense>;
}

/**
 * M502: Vorführen-Band, Live-Mauszeiger und Gruppenraum (Reaktionen, Timer) zeigen nur in einem Live-Board etwas —
 * ihr Code lädt darum erst, wenn das erste Board dieser Sitzung live ist, und bleibt danach eingehängt (wie früher
 * von Anfang an). Ohne Kanal hängen sie nichts ins DOM. Die Kanal-Seite startet lib/gastSync.ts.
 */
let liveTeamDa = false;
function useLiveTeam(): boolean {
  const boardId = useBoard((s) => s.activeId);
  useTakt(TEILNEHMER_EREIGNIS);
  if (liveAuf(boardId)) liveTeamDa = true;
  return liveTeamDa;
}
const LiveZeigerVoll = lazy(() => import('./Mauszeiger').then((m) => ({ default: m.LiveZeiger })));
const VorfuehrenVoll = lazy(() => import('./Vorfuehren').then((m) => ({ default: m.Vorfuehren })));
const GruppenraumVoll = lazy(() => import('./Gruppenraum').then((m) => ({ default: m.GruppenraumSchicht })));
/** Gehört in ein <ViewportPortal> des Boards (M375) */
export function LiveZeigerSpaet() {
  return useLiveTeam() ? <Suspense fallback={null}><LiveZeigerVoll /></Suspense> : null;
}
/** M367 „Folgt mir" — Band und Mitfahren der Ansicht */
export function VorfuehrenSpaet() {
  return useLiveTeam() ? <Suspense fallback={null}><VorfuehrenVoll /></Suspense> : null;
}
/** M376 — aufsteigende Reaktionen und die gemeinsame Uhr */
export function GruppenraumSpaet() {
  return useLiveTeam() ? <Suspense fallback={null}><GruppenraumVoll /></Suspense> : null;
}

function Sperre({ id, t }: { id: string; t: Teilnehmer }) {
  const node = useInternalNode(id);
  if (!node) return null;
  const w = node.measured?.width ?? node.width ?? 0;
  const h = node.measured?.height ?? node.height ?? 0;
  if (!w || !h) return null;
  const p = node.internals.positionAbsolute;
  return (
    <div className="live-sperre" data-taste="live-sperre" data-karte={id}
      style={{ ...farbe(t.farbe), transform: `translate(${p.x}px, ${p.y}px)`, width: w, height: h }}>
      <span className="live-sperre-name" translate="no">✎ {t.name}</span>
    </div>
  );
}
/** Gehört in ein <ViewportPortal>: Rahmen in Board-Koordinaten, zoomt und schwenkt mit */
export function LiveSperren() {
  const boardId = useBoard((s) => s.activeId);
  useTakt(SPERREN_EREIGNIS);
  const s = sperrenVon(boardId);
  if (s.size === 0) return null;
  return <>{[...s].map(([id, t]) => <Sperre key={id} id={id} t={t} />)}</>;
}

export function GastNameDialog() {
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const auf = () => { setName(getAuthor()); setOffen(true); };
    window.addEventListener(NAME_FRAGEN, auf);
    return () => window.removeEventListener(NAME_FRAGEN, auf);
  }, []);
  if (!offen) return null;
  const fertig = () => {
    if (!name.trim()) return;
    setAuthor(name);
    nameGeaendert();
    setOffen(false);
  };
  return (
    <div className="modal-backdrop ueber-vortrag" onClick={() => setOffen(false)}>
      <div className="modal gast-name-dialog" role="dialog" aria-modal="true" aria-label="Dein Name" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Wie heißt du?</h2>
          <button className="modal-x" onClick={() => setOffen(false)} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <p className="modal-hint">Die anderen im Board sehen deinen Namen – an der Karte, die du gerade bearbeitest, und an deinen Kommentaren.</p>
            <div className="freigabe-zeile">
              <input autoFocus value={name} maxLength={40} placeholder="Dein Name" aria-label="Dein Name" data-taste="gast-name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fertig(); else if (e.key === 'Escape') setOffen(false); }} />
              <button disabled={!name.trim()} onClick={fertig} data-taste="gast-name-ok">Mitmachen</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
