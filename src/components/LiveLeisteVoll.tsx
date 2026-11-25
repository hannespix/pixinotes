// M364/M391: Die Live-Leiste oben rechts — Kürzel der Anwesenden; antippen zeigt alle und die Werkzeuge der Gruppe.
// M477: eigene Datei, nachgeladen von LiveLeiste.tsx, sobald das Board live ist (vorher Teil des Start-Pakets).
import { useEffect, useState } from 'react';
import { fensterDarueber } from '../lib/overlay';
import { GRUPPE_EREIGNIS, gruppeVon, useBoard, useNurLesen } from '../store';
import { EINLADUNG_EREIGNIS, einladungVon, ichIn, liveAuf, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from '../lib/liveStand';
import { qrZeigen } from '../lib/qr';
import { ichFuehreVor, VORFUEHR_EREIGNIS, vorfuehrenStart, vorfuehrenStopp } from '../lib/vorfuehren';
import { ZEIGER_EREIGNIS, zeigerAn, zeigerSetzen } from '../lib/mauszeiger';
import { ICheck, IMousePointer, IPen, IQr, IUsers, ILock, IMegafon } from './Icons';
import { ReaktionsKnopf, TimerZeile } from './Gruppenraum';
import { FREIGABE_OEFFNEN } from './FreigabeHost';
import { farbe, kuerzel, NAME_FRAGEN, useTakt } from './LiveLeiste';

/**
 * M391: Die Leiste zeigt in Ruhe nur, WER da ist — ein Knopf. Alles, was man damit tun kann (Namen ändern, einladen,
 * QR-Code, vorführen, Timer, Mauszeiger), steht mit Namen in der Liste dahinter. Vorher lagen bis zu sieben runde
 * Symbol-Knöpfe nebeneinander; am Telefon überdeckten sie die Kopfzeile. Was gerade LÄUFT, zeigt sich selbst:
 * Das Band „Du führst vor" hat seinen Knopf zum Beenden, der Timer seine eigene Uhr.
 */
export default function LiveLeisteVoll() {
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
    // M530: Liegt ein Fenster über der Liste (Einstellungen, Hilfe), schließt Esc erst das
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !fensterDarueber(null, e)) setOffen(false); };
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
      <button className="live-mehr" aria-expanded={offen} aria-haspopup="true" aria-label="Wer ist dabei – Teilnehmer und Werkzeuge der Gruppe" data-taste="live-auf"
        title="Wer ist dabei – Teilnehmer und Werkzeuge der Gruppe" onClick={() => setOffen((o) => !o)}>
        <span className="live-chip ich" translate="no" style={farbe(selbst.farbe)} data-taste="live-ich-chip">{kuerzel(selbst.name)}</span>
        {sichtbar.map((t) => (
          <span key={t.id} className={`live-chip${t.karte ? ' schreibt' : ''}`} translate="no" style={farbe(t.farbe)} data-taste="live-chip" data-name={t.name}
            title={t.karte ? `${t.name} – bearbeitet gerade eine Karte` : t.name}>{kuerzel(t.name)}</span>
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
              <ILock size={13} /> {recht === 'eigenes' ? 'Du kannst hier nur deine eigenen Karten ändern und löschen – neue anlegen geht immer.' : 'Du kannst hier alles bearbeiten, aber nur löschen, was du selbst angelegt hast.'}
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
                <span className="live-zeichen" aria-hidden="true"><IMegafon size={15} /></span> {fuehrtVor ? 'Vorführen beenden' : 'Vorführen – alle folgen dir'}
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
