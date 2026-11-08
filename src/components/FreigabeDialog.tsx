// M330: Ein Board für ein anderes PixiNotes-Konto freigeben.
//
// Der Besitzer trägt die E-Mail des Gasts ein. Sobald sich der Gast mit dieser
// E-Mail in PixiNotes anmeldet, erscheint das Board bei ihm unter „Geteilt mit
// mir" und beide arbeiten live auf demselben Stand. Für den Gast zeigt der
// Dialog den Besitzer und bietet „Freigabe verlassen" (das Board bleibt dann als
// eigene Kopie auf dem Gerät).
import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { freigabeAnlegen, freigabeEntfernen, freigabenDesBoards, freigabeVerlassen, loadKonto, type Freigabe } from '../lib/kontoSync';
import { IX } from './Icons';

export function FreigabeDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const board = useBoard((s) => s.boards.find((b) => b.id === boardId));
  const showToast = useBoard((s) => s.showToast);
  const [liste, setListe] = useState<Freigabe[] | null>(null);
  const [mail, setMail] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const eigenesKonto = loadKonto();
  const gast = !!board?.geteiltVon;
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim());

  const laden = async () => {
    try { setListe(await freigabenDesBoards(boardId)); setFehler(''); } catch (e) { setFehler((e as Error).message); setListe([]); }
  };
  useEffect(() => {
    if (!gast) void laden();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  if (!board) return null;

  const einladen = async () => {
    if (!mailOk || busy) return;
    setBusy(true); setFehler('');
    try {
      await freigabeAnlegen(boardId, mail.trim());
      setMail('');
      await laden();
      showToast(`✅ „${board.name}" ist für ${mail.trim()} freigegeben — sobald sich die Person mit dieser E-Mail anmeldet, sieht sie das Board.`, false, 8000);
    } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const entfernen = async (f: Freigabe) => {
    if (busy) return;
    setBusy(true); setFehler('');
    try { await freigabeEntfernen(f.id); await laden(); showToast(`Freigabe für ${f.gast_email} entfernt.`); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };
  const verlassen = async () => {
    if (busy) return;
    if (!window.confirm(`Die Freigabe von „${board.name}" verlassen? Das Board bleibt als eigene Kopie hier, Änderungen des Besitzers kommen nicht mehr an.`)) return;
    setBusy(true); setFehler('');
    try { await freigabeVerlassen(boardId); showToast('Freigabe verlassen — das Board ist jetzt eine eigene Kopie.'); onClose(); } catch (e) { setFehler((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal freigabe-dialog" role="dialog" aria-modal="true" aria-label="Board freigeben" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>👥 {gast ? 'Geteiltes Board' : 'Board freigeben'}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            {gast ? (
              <>
                <p className="modal-hint">„{board.name}" gehört <b>{board.geteiltVonName ?? 'einem anderen Konto'}</b> und ist für dich freigegeben. Ihr arbeitet live auf demselben Stand; gleichzeitige Änderungen werden zusammengeführt.</p>
                <div className="modal-buttons">
                  <button disabled={busy} onClick={verlassen} data-taste="freigabe-verlassen">{busy ? '…' : 'Freigabe verlassen'}</button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-hint">
                  „{board.name}" mit einem anderen PixiNotes-Konto teilen: E-Mail eintragen. Sobald sich die Person mit dieser E-Mail anmeldet
                  (unter ⚙ → Daten → Konto), erscheint das Board bei ihr unter <b>Geteilt mit mir</b>. Beide sehen Änderungen live.
                </p>
                <label className="modal-row">
                  <span>E-Mail</span>
                  <input type="email" autoComplete="off" placeholder="kollegin@example.de" value={mail} onChange={(e) => setMail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void einladen(); }} data-taste="freigabe-email" />
                </label>
                <div className="modal-buttons">
                  <button disabled={!mailOk || busy || !eigenesKonto} onClick={einladen} data-taste="freigabe-einladen">{busy ? '…' : 'Freigeben'}</button>
                </div>
                {liste === null ? (
                  <div className="modal-note">Lade Freigaben …</div>
                ) : liste.length === 0 ? (
                  <div className="modal-note">Noch für niemanden freigegeben.</div>
                ) : (
                  <ul className="freigabe-liste" data-taste="freigabe-liste">
                    {liste.map((f) => (
                      <li key={f.id}>
                        <span className="freigabe-mail">{f.gast_email}</span>
                        <span className={`freigabe-stand ${f.gast_id ? 'an' : ''}`}>{f.gast_id ? 'angenommen' : 'wartet auf Anmeldung'}</span>
                        <button className="freigabe-weg" disabled={busy} onClick={() => void entfernen(f)} title="Freigabe entfernen" aria-label={`Freigabe für ${f.gast_email} entfernen`}><IX size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="modal-note">
                  Anhänge (Dateien, Bilder als Datei) wandern bei geteilten Boards noch nicht mit — Notizen, Karten, Verbindungen und Zeichnungen schon.
                  Die Person braucht ein PixiNotes-Konto mit genau dieser E-Mail; die App-Adresse: <code>{location.origin + location.pathname}</code>
                </div>
              </>
            )}
            {fehler && <div className="modal-error" role="alert">⚠️ {fehler}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
