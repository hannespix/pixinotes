// M364: Gruppenarbeit sichtbar machen — wer ist gerade im Board, wer bearbeitet welche Karte, wie heiße ich.
//
// Die Angaben kommen aus dem Live-Kanal (lib/gastSync.ts). Hier nur die Anzeige:
//   · LiveLeiste     – Kürzel der Anwesenden oben rechts; das eigene zuerst (Antippen ändert den Namen)
//   · LiveSperren    – farbiger Rahmen mit Namensschild um jede Karte, die gerade ein anderer bearbeitet
//   · GastNameDialog – „Wie heißt du?" beim Einwählen ohne Konto
import { useEffect, useState, type CSSProperties } from 'react';
import { useInternalNode } from '@xyflow/react';
import { useBoard } from '../store';
import { ich, liveAuf, liveVerbunden, nameGeaendert, SPERREN_EREIGNIS, sperrenVon, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/gastSync';
import type { Teilnehmer } from '../lib/liveKanal';
import { getAuthor, setAuthor } from './CommentLayer';
import { IX } from './Icons';

export const NAME_FRAGEN = 'pixinotes:gast-name';

/** Neu zeichnen, sobald das Ereignis kommt */
function useTakt(ereignis: string): void {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(ereignis, auf);
    return () => window.removeEventListener(ereignis, auf);
  }, [ereignis]);
}

/** „Mara Lindner" → ML, „gast" → GA */
function kuerzel(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  const k = teile.length === 1 ? teile[0].slice(0, 2) : teile[0][0] + teile[teile.length - 1][0];
  return k.toLocaleUpperCase('de');
}
const farbe = (f: string): CSSProperties => ({ '--farbe': f } as CSSProperties);

export function LiveLeiste() {
  const boardId = useBoard((s) => s.activeId);
  useTakt(TEILNEHMER_EREIGNIS);
  if (!liveAuf(boardId)) return null;
  const selbst = ich();
  const andere = teilnehmerVon(boardId).filter((t) => t.id !== selbst.id);
  const sichtbar = andere.slice(0, 5);
  const rest = andere.slice(5);
  const verbunden = liveVerbunden(boardId);
  return (
    <div className="live-leiste" role="group" aria-label="Gerade in diesem Board" data-taste="live-leiste">
      <button className="live-chip ich" style={farbe(selbst.farbe)} title={`Du (${selbst.name}) — Namen ändern`} data-taste="live-ich"
        onClick={() => window.dispatchEvent(new CustomEvent(NAME_FRAGEN))}>{kuerzel(selbst.name)}</button>
      {sichtbar.map((t) => (
        <span key={t.id} className={`live-chip${t.karte ? ' schreibt' : ''}`} style={farbe(t.farbe)} data-taste="live-chip" data-name={t.name}
          title={t.karte ? `${t.name} — bearbeitet gerade eine Karte` : t.name}>{kuerzel(t.name)}</span>
      ))}
      {rest.length > 0 && <span className="live-chip mehr" title={rest.map((t) => t.name).join(', ').slice(0, 100)}>+{rest.length}</span>}
      <span className="live-zahl" data-taste="live-zahl">{!verbunden ? 'verbindet …' : andere.length === 0 ? 'nur du' : `${andere.length + 1} dabei`}</span>
    </div>
  );
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
      <span className="live-sperre-name">✎ {t.name}</span>
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
    <div className="modal-backdrop" onClick={() => setOffen(false)}>
      <div className="modal gast-name-dialog" role="dialog" aria-modal="true" aria-label="Dein Name" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>👋 Wie heißt du?</h2>
          <button className="modal-x" onClick={() => setOffen(false)} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            <p className="modal-hint">Die anderen im Board sehen deinen Namen — an der Karte, die du gerade bearbeitest, und an deinen Kommentaren.</p>
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
