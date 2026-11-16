// M364: Gruppenarbeit sichtbar machen — wer ist gerade im Board, wer bearbeitet welche Karte, wie heiße ich.
//
// Die Angaben kommen aus dem Live-Kanal (lib/gastSync.ts). Hier nur die Anzeige:
//   · LiveLeiste     – Kürzel der Anwesenden oben rechts; antippen zeigt alle und die Werkzeuge der Gruppe (M391)
//   · LiveSperren    – farbiger Rahmen mit Namensschild um jede Karte, die gerade ein anderer bearbeitet
//   · GastNameDialog – „Wie heißt du?" beim Einwählen ohne Konto
import { useEffect, useState, type CSSProperties } from 'react';
import { useInternalNode } from '@xyflow/react';
import { GRUPPE_EREIGNIS, gruppeVon, useBoard, useNurLesen } from '../store';
import { EINLADUNG_EREIGNIS, einladungVon, ichIn, liveAuf, liveVerbunden, nameGeaendert, SPERREN_EREIGNIS, sperrenVon, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/gastSync';
import { qrZeigen } from '../lib/qr';
import type { Teilnehmer } from '../lib/liveKanal';
import { getAuthor, setAuthor } from './CommentLayer';
import { ichFuehreVor, VORFUEHR_EREIGNIS, vorfuehrenStart, vorfuehrenStopp } from '../lib/vorfuehren';
import { ZEIGER_EREIGNIS, zeigerAn, zeigerSetzen } from '../lib/mauszeiger';
import { ICheck, IMousePointer, IPen, IQr, IUsers, IX } from './Icons';
import { ReaktionsKnopf, TimerZeile } from './Gruppenraum';
import { FREIGABE_OEFFNEN } from './FreigabeDialog';

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

/**
 * M391: Die Leiste zeigt in Ruhe nur, WER da ist — ein Knopf. Alles, was man damit tun kann (Namen ändern, einladen,
 * QR-Code, vorführen, Timer, Mauszeiger), steht mit Namen in der Liste dahinter. Vorher lagen bis zu sieben runde
 * Symbol-Knöpfe nebeneinander; am Telefon überdeckten sie die Kopfzeile. Was gerade LÄUFT, zeigt sich selbst:
 * Das Band „Du führst vor" hat seinen Knopf zum Beenden, der Timer seine eigene Uhr.
 */
export function LiveLeiste() {
  const boardId = useBoard((s) => s.activeId);
  const eigenes = useBoard((s) => { const b = s.boards.find((x) => x.id === s.activeId); return !!b && !b.geteiltVon && !b.gastLink; });
  useTakt(TEILNEHMER_EREIGNIS);
  useTakt(GRUPPE_EREIGNIS);
  useTakt(VORFUEHR_EREIGNIS);
  useTakt(ZEIGER_EREIGNIS);
  useTakt(EINLADUNG_EREIGNIS);
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
  useEffect(() => { setOffen(false); }, [boardId]);
  if (!liveAuf(boardId)) return null;
  const selbst = ichIn(boardId);
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
  const fuehrtVor = ichFuehreVor(boardId);
  const tun = (f: () => void) => () => { setOffen(false); f(); };
  return (
    <div className={`live-leiste${offen ? ' offen' : ''}`} role="group" aria-label="Gerade in diesem Board" data-taste="live-leiste">
      <button className="live-mehr" aria-expanded={offen} aria-haspopup="true" aria-label="Wer ist dabei — Teilnehmer und Werkzeuge der Gruppe" data-taste="live-auf"
        title="Wer ist dabei — Teilnehmer und Werkzeuge der Gruppe" onClick={() => setOffen((o) => !o)}>
        <span className="live-chip ich" translate="no" style={farbe(selbst.farbe)} data-taste="live-ich-chip">{kuerzel(selbst.name)}</span>
        {sichtbar.map((t) => (
          <span key={t.id} className={`live-chip${t.karte ? ' schreibt' : ''}`} translate="no" style={farbe(t.farbe)} data-taste="live-chip" data-name={t.name}
            title={t.karte ? `${t.name} — bearbeitet gerade eine Karte` : t.name}>{kuerzel(t.name)}</span>
        ))}
        {rest > 0 && <span className="live-chip mehr" data-taste="live-rest">+{rest}</span>}
        <span className="live-zahl" data-taste="live-zahl">{!verbunden ? 'verbindet …' : andere.length === 0 ? 'nur du' : `${andere.length + 1} dabei`}</span>
      </button>
      {/* M376: Reagieren bleibt ein Tipp — das braucht in der Runde jeder */}
      {andere.length > 0 && <ReaktionsKnopf boardId={boardId} />}
      {offen && (
        <div className="live-liste" data-taste="live-liste">
          <div className="live-liste-kopf">{andere.length + 1} im Board{schreiben ? ` · ${schreiben} ${schreiben === 1 ? 'schreibt' : 'schreiben'} gerade` : ''}</div>
          <div role="list">
            <div className="live-liste-zeile" role="listitem">
              <span className="live-punkt" style={farbe(selbst.farbe)} /> <span className="live-name" translate="no">{selbst.name}</span> <span className="live-neben">du</span>
              <button className="live-zeile-knopf" data-taste="live-ich" title="Deinen Namen ändern" aria-label="Deinen Namen ändern"
                onClick={tun(() => window.dispatchEvent(new CustomEvent(NAME_FRAGEN)))}><IPen size={13} /></button>
            </div>
            {sortiert.map((t) => (
              <div key={t.id} className="live-liste-zeile" role="listitem" data-name={t.name}>
                <span className="live-punkt" style={farbe(t.farbe)} /> <span className="live-name" translate="no">{t.name}</span>
                {t.karte && <span className="live-neben">schreibt</span>}
              </div>
            ))}
          </div>
          {recht && (
            <div className="live-liste-hinweis" data-taste="live-recht">
              🔒 {recht === 'eigenes' ? 'Du kannst hier nur deine eigenen Karten ändern und löschen — neue anlegen geht immer.' : 'Du kannst hier alles bearbeiten, aber nur löschen, was du selbst angelegt hast.'}
            </div>
          )}
          <div className="live-liste-aktionen">
            {eigenes && (
              <button data-taste="live-einladen" onClick={tun(() => window.dispatchEvent(new CustomEvent(FREIGABE_OEFFNEN, { detail: { boardId } })))}>
                <IUsers size={15} /> Einladen …
              </button>
            )}
            {/* M385: QR-Code zum Mitmachen — der Einladungslink groß zum Scannen */}
            {einladungVon(boardId) && (
              <button data-taste="live-qr" onClick={tun(() => qrZeigen(boardId))}><IQr size={15} /> QR-Code zum Mitmachen zeigen</button>
            )}
            {/* M367: Vorführen — alle folgen meiner Ansicht */}
            {andere.length > 0 && !nurLesen && (
              <button data-taste="vorfuehren" aria-pressed={fuehrtVor} title="Alle folgen deiner Ansicht: Schwenken, Zoomen, Fokus"
                onClick={tun(() => (fuehrtVor ? vorfuehrenStopp() : vorfuehrenStart(boardId)))}>
                <span className="live-zeichen" aria-hidden="true">📣</span> {fuehrtVor ? 'Vorführen beenden' : 'Vorführen — alle folgen dir'}
              </button>
            )}
            {/* M375: Mauszeiger der anderen sehen und den eigenen zeigen — je Gerät abschaltbar */}
            {andere.length > 0 && (
              <button data-taste="live-maus" role="menuitemcheckbox" aria-checked={zeigerAn()} aria-pressed={zeigerAn()}
                title={zeigerAn() ? 'Du siehst die Zeiger der anderen, sie sehen deinen' : 'Mauszeiger sind ausgeblendet'}
                onClick={() => zeigerSetzen(!zeigerAn())}>
                <IMousePointer size={15} /> Mauszeiger zeigen {zeigerAn() && <ICheck size={14} />}
              </button>
            )}
            {/* M376: Timer für alle */}
            {!nurLesen && <TimerZeile boardId={boardId} fertig={() => setOffen(false)} />}
          </div>
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
