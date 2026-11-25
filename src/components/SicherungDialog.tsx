// M476: Sicherung einspielen — erst zeigen, was drin ist, dann fragen, wie (lib/sicherung.ts).
import { useEffect, useRef, useState } from 'react';
import { escDarueber } from '../lib/fensterEsc';
import { eingespieltMelden, OHNE, sicherungEinspielen, sicherungLesen, ueberblick, type Modus, type Sicherung } from '../lib/sicherung';
import { t, zahlWort } from '../lib/sprache';
import { useBoard } from '../store';
import { IX } from './Icons';

export function SicherungDialog({ datei, onClose }: { datei?: File; onClose: () => void }) {
  const [quelle, setQuelle] = useState<File | undefined>(datei);
  const [s, setS] = useState<Sicherung | null>(null);
  const [fehler, setFehler] = useState('');
  const [modus, setModus] = useState<Modus>('kopie');
  const [busy, setBusy] = useState(false);
  const zu = useRef<HTMLButtonElement>(null);
  const eingabe = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!quelle) return;
    let aktiv = true;
    setS(null); setFehler('');
    void sicherungLesen(quelle).then((x) => {
      if (!aktiv) return;
      if (x) setS(x);
      else setFehler('Das ist keine PixiNotes-Sicherung (oder die Datei ist beschädigt). Erwartet wird eine .pixinotes-Datei oder eine ältere PixiNotes-Datei (.json).');
    }).catch(() => { if (aktiv) setFehler('Die Datei konnte nicht gelesen werden.'); });
    return () => { aktiv = false; };
  }, [quelle]);

  useEffect(() => {
    zu.current?.focus();
    // M534: Liegt ein anderes Fenster darüber (Alt+H, Alt+E, Strg+K), gehört Esc ihm
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !escDarueber(zu.current, e)) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const u = s ? ueberblick(s) : null;
  const einspielen = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const meldung = await sicherungEinspielen(s, modus);
      onClose();
      eingespieltMelden(meldung);
    } catch (e) {
      setBusy(false);
      useBoard.getState().showToast(`Einspielen abgebrochen: ${String((e as Error).message)}`, false, 8000);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sicherung-dialog" role="dialog" aria-modal="true" aria-label="Sicherung einspielen" data-taste="sicherung-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Sicherung einspielen</h2>
          <button ref={zu} className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <input ref={eingabe} type="file" accept=".pixinotes,.json,application/zip,application/json" style={{ display: 'none' }} data-taste="sicherung-datei"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setQuelle(f); e.target.value = ''; }} />
          {!quelle && (
            <>
              <p className="modal-hint">Eine Sicherung (.pixinotes) wählen – oder die Datei einfach aufs Board ziehen.</p>
              <div className="modal-buttons"><button className="primaer" onClick={() => eingabe.current?.click()}>Datei wählen …</button></div>
            </>
          )}
          {quelle && !s && !fehler && <p className="modal-hint">Lese die Sicherung …</p>}
          {fehler && <div className="modal-error" role="alert" data-taste="sicherung-fehler">{fehler}</div>}
          {s && u && (
            <>
              <p className="modal-hint">
                {s.art === 'board' ? `Sicherung eines Boards vom ${u.datum}` : `Sicherung von allem vom ${u.datum}`}
                {quelle?.name ? <> · <span translate="no">{quelle.name}</span></> : null}
              </p>
              <ul className="sicherung-zahlen" data-taste="sicherung-zahlen" data-boards={u.boards} data-karten={u.karten} data-dateien={u.dateien}>
                <li><b>{zahlWort(u.boards, 'Board', 'Boards')}</b></li>
                <li>{zahlWort(u.karten, 'Karte', 'Karten')}</li>
                {u.dateien > 0 && <li>{zahlWort(u.dateien, 'Datei', 'Dateien')}</li>}
                {u.vorlagen > 0 && <li>{zahlWort(u.vorlagen, 'Vorlage', 'Vorlagen')}</li>}
                {u.bereiche > 0 && <li>{zahlWort(u.bereiche, 'Bereich', 'Bereiche')}</li>}
                {s.einstellungen && <li>Einstellungen</li>}
              </ul>
              {s.boards.length <= 12 && (
                <ul className="sicherung-boards">{s.boards.map((b) => <li key={b.id} translate="no">{b.name}</li>)}</ul>
              )}
              {s.entschaerft > 0 && (
                <p className="modal-hint" data-taste="sicherung-entschaerft" data-anzahl={s.entschaerft}>
                  {`Beim Prüfen weggelassen: ${zahlWort(s.entschaerft, 'ungültiger Teil', 'ungültige Teile')}.`}
                </p>
              )}
              <div className="sicherung-wahl" role="radiogroup" aria-label="Wie einspielen?">
                <label>
                  <input type="radio" name="sicherung-modus" checked={modus === 'kopie'} onChange={() => setModus('kopie')} data-taste="sicherung-kopie" />
                  <span>Als Kopie hinzufügen</span>
                  <small>Kommt zusätzlich dazu, mit neuen Kennungen. Nichts Vorhandenes ändert sich.</small>
                </label>
                <label>
                  <input type="radio" name="sicherung-modus" checked={modus === 'ersetzen'} onChange={() => setModus('ersetzen')} data-taste="sicherung-ersetzen" />
                  <span>Vorhandene ersetzen</span>
                  <small>
                    {u.schonDa > 0
                      ? `${zahlWort(u.schonDa, 'Board bekommt', 'Boards bekommen')} den Stand aus der Sicherung; der Stand davor liegt unter Versionen. Boards, die nur hier liegen, bleiben.`
                      : 'Keines dieser Boards liegt hier – sie kommen mit ihren Kennungen dazu. Boards, die nur hier liegen, bleiben.'}
                    {s.einstellungen ? ' Die Einstellungen (Aussehen, Bedienung) werden übernommen.' : ''}
                  </small>
                </label>
              </div>
              <p className="sicherung-ohne">{`Nicht in einer Sicherung: ${OHNE.map((x) => t(x)).join(' · ')}.`} Danach nimmt „Rückgängig" im Hinweis das Einspielen zurück.</p>
            </>
          )}
          <div className="modal-buttons">
            <button onClick={onClose}>Abbrechen</button>
            {s && <button className="primaer" disabled={busy} onClick={() => void einspielen()} data-taste="sicherung-einspielen">{busy ? '…' : 'Einspielen'}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
