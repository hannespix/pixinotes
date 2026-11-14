// M364: Gruppenarbeit sichtbar machen — wer ist gerade im Board, wer bearbeitet welche Karte, wie heiße ich.
//
// Die Angaben kommen aus dem Live-Kanal (lib/gastSync.ts). Hier nur die Anzeige:
//   · LiveLeiste     – Kürzel der Anwesenden oben rechts; das eigene zuerst (Antippen ändert den Namen)
//   · LiveSperren    – farbiger Rahmen mit Namensschild um jede Karte, die gerade ein anderer bearbeitet
//   · GastNameDialog – „Wie heißt du?" beim Einwählen ohne Konto
import { useEffect, useState, type CSSProperties } from 'react';
import { useInternalNode } from '@xyflow/react';
import { GRUPPE_EREIGNIS, gruppeVon, useBoard, useNurLesen } from '../store';
import { ich, liveAuf, liveVerbunden, nameGeaendert, SPERREN_EREIGNIS, sperrenVon, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/gastSync';
import type { Teilnehmer } from '../lib/liveKanal';
import { getAuthor, setAuthor } from './CommentLayer';
import { ichFuehreVor, VORFUEHR_EREIGNIS, vorfuehrenStart, vorfuehrenStopp } from '../lib/vorfuehren';
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
  useTakt(GRUPPE_EREIGNIS);
  useTakt(VORFUEHR_EREIGNIS);
  // M366: Bei vielen Teilnehmern zeigt die Leiste wenige Kürzel und die Zahl; die ganze Liste klappt auf
  const [offen, setOffen] = useState(false);
  const nurLesen = useNurLesen();   // wer nur liest, führt nicht vor
  useEffect(() => {
    if (!offen) return;
    const zu = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('.live-leiste')) setOffen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOffen(false); };
    window.addEventListener('pointerdown', zu, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', zu, true); window.removeEventListener('keydown', esc); };
  }, [offen]);
  if (!liveAuf(boardId)) return null;
  const selbst = ich();
  // M365: Als Gast sehen, was der Besitzer hier erlaubt
  const g = gruppeVon(boardId);
  const recht = g?.gast && g.recht !== 'alles' ? g.recht : null;
  const andere = teilnehmerVon(boardId).filter((t) => t.id !== selbst.id);
  // wer gerade schreibt, steht vorn
  const sortiert = [...andere].sort((a, b) => Number(!!b.karte) - Number(!!a.karte));
  const sichtbar = sortiert.slice(0, andere.length > 4 ? 3 : 4);
  const rest = andere.length - sichtbar.length;
  const verbunden = liveVerbunden(boardId);
  const schreiben = andere.filter((t) => t.karte).length;
  return (
    <div className={`live-leiste${offen ? ' offen' : ''}`} role="group" aria-label="Gerade in diesem Board" data-taste="live-leiste">
      <button className="live-chip ich" style={farbe(selbst.farbe)} title={`Du (${selbst.name}) — Namen ändern`} data-taste="live-ich"
        onClick={() => window.dispatchEvent(new CustomEvent(NAME_FRAGEN))}>{kuerzel(selbst.name)}</button>
      <button className="live-mehr" aria-expanded={offen} aria-label="Alle Teilnehmer zeigen" data-taste="live-auf" disabled={andere.length === 0}
        onClick={() => setOffen((o) => !o)}>
        {sichtbar.map((t) => (
          <span key={t.id} className={`live-chip${t.karte ? ' schreibt' : ''}`} style={farbe(t.farbe)} data-taste="live-chip" data-name={t.name}
            title={t.karte ? `${t.name} — bearbeitet gerade eine Karte` : t.name}>{kuerzel(t.name)}</span>
        ))}
        {rest > 0 && <span className="live-chip mehr" data-taste="live-rest">+{rest}</span>}
        <span className="live-zahl" data-taste="live-zahl">{!verbunden ? 'verbindet …' : andere.length === 0 ? 'nur du' : `${andere.length + 1} dabei`}</span>
      </button>
      {/* M367: Vorführen — alle folgen meiner Ansicht */}
      {andere.length > 0 && !nurLesen && (
        <button className={`live-zeig${ichFuehreVor(boardId) ? ' an' : ''}`} data-taste="vorfuehren" aria-pressed={ichFuehreVor(boardId)}
          title={ichFuehreVor(boardId) ? 'Vorführen beenden' : 'Vorführen: Alle folgen deiner Ansicht (Schwenken, Zoomen, Fokus)'}
          onClick={() => (ichFuehreVor(boardId) ? vorfuehrenStopp() : vorfuehrenStart(boardId))}>📣</button>
      )}
      {recht && (
        <span className="live-recht" data-taste="live-recht"
          title={recht === 'eigenes' ? 'Du kannst hier nur deine eigenen Karten ändern und löschen — neue anlegen geht immer.' : 'Du kannst hier alles bearbeiten, aber nur löschen, was du selbst angelegt hast.'}>
          🔒 {recht === 'eigenes' ? 'nur Eigenes ändern' : 'nur Eigenes löschen'}
        </span>
      )}
      {offen && (
        <div className="live-liste" role="list" data-taste="live-liste">
          <div className="live-liste-kopf">{andere.length + 1} im Board{schreiben ? ` · ${schreiben} ${schreiben === 1 ? 'schreibt' : 'schreiben'} gerade` : ''}</div>
          <div className="live-liste-zeile" role="listitem"><span className="live-punkt" style={farbe(selbst.farbe)} /> <span className="live-name">{selbst.name}</span> <span className="live-neben">du</span></div>
          {sortiert.map((t) => (
            <div key={t.id} className="live-liste-zeile" role="listitem" data-name={t.name}>
              <span className="live-punkt" style={farbe(t.farbe)} /> <span className="live-name">{t.name}</span>
              {t.karte && <span className="live-neben">schreibt</span>}
            </div>
          ))}
        </div>
      )}
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
