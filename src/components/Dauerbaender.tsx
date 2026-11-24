// M511: Dauerbänder — Meldungen, die stehen bleiben, solange ein Zustand gilt („Nur lesen", „… führt vor", Timer,
// „anderes Fenster"). Sie liegen in EINEM Stapel (`.dauerbaender` in App.tsx):
//   · am Desktop ist der Stapel `display: contents` — jedes Band sitzt wie bisher an seiner Stelle;
//   · am Telefon ist er eine Spalte UNTER Kopfzeile und Live-Leiste, eine Ebene tiefer als die Bedienung
//     (--ebene-dauerband in 00-tokens.css). Vorher lag „Nur lesen" mitten über der Live-Leiste und damit über dem
//     Reaktions-Knopf: Gäste konnten am Telefon nicht reagieren.
import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { IChevronL, IChevronR, ILock } from './Icons';

/** Nach so vielen Millisekunden schrumpft ein Dauerband am Telefon auf sein Kurzwort */
export const BAND_KURZ_NACH = 6000;

/**
 * Ein Band klappt nach `ms` von selbst auf seine Kurzform; antippen zeigt es wieder ganz (und es klappt danach
 * wieder zu). Ändert sich `schluessel` (neuer Zustand, z. B. anderes Board), steht es zuerst wieder ganz da.
 * Die Kurzform wirkt nur am Telefon (CSS); am Desktop bleibt das Band, wie es war.
 */
export function useBandKurz(schluessel: string, ms = BAND_KURZ_NACH): [boolean, (kurz: boolean) => void] {
  const [kurz, setKurz] = useState(false);
  const [lauf, setLauf] = useState(0);
  useEffect(() => { setKurz(false); setLauf((n) => n + 1); }, [schluessel]);
  useEffect(() => {
    if (kurz) return;
    const t = window.setTimeout(() => setKurz(true), ms);
    return () => window.clearTimeout(t);
  }, [kurz, lauf, ms]);
  const setzen = (k: boolean) => { setKurz(k); if (!k) setLauf((n) => n + 1); };
  return [kurz, setzen];
}

/** M360: Nur lesend geteiltes Board — sagen, warum nichts geht, und den Ausweg anbieten */
export function LeseBand({ id, von }: { id: string; von?: string }) {
  const [kurz, setKurz] = useBandKurz(id);
  return (
    <div className={`lese-band${kurz ? ' kurz' : ''}`} role="status" data-taste="lese-band"
      onClick={kurz ? () => setKurz(false) : undefined}>
      <span><ILock size={13} /> <b>Nur lesen</b><span className="band-mehr"> · {von ? `geteilt von ${von}` : 'geteiltes Board'}</span></span>
      <button onClick={() => useBoard.getState().duplicateBoard(id)} data-taste="lese-kopie">Eigene Kopie anlegen</button>
      <button className="band-klapp" data-taste="lese-klapp" aria-expanded={!kurz}
        aria-label={kurz ? 'Hinweis ganz zeigen' : 'Hinweis verkleinern'} title={kurz ? 'Hinweis ganz zeigen' : 'Hinweis verkleinern'}
        onClick={(e) => { e.stopPropagation(); setKurz(!kurz); }}>
        {kurz ? <IChevronR size={14} /> : <IChevronL size={14} />}
      </button>
    </div>
  );
}
