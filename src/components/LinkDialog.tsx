// M357: Ein Board per Link teilen — der Empfänger öffnet es direkt, ohne Konto (lib/linkTeilen.ts).
import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { linkDesBoards, linkErstellen, linkLoeschen, linkMoeglich, LinkNichtEingerichtet, linkUrl, type LinkZeile } from '../lib/linkTeilen';
import { IX } from './Icons';

export function LinkDialog({ boardId, onClose, ohneKonto, alsDatei }: { boardId: string; onClose: () => void; ohneKonto: () => void; alsDatei: () => void }) {
  const board = useBoard((s) => s.boards.find((b) => b.id === boardId));
  const showToast = useBoard((s) => s.showToast);
  const [zeile, setZeile] = useState<LinkZeile | null | undefined>(undefined);
  const [busy, setBusy] = useState('');
  const [fehler, setFehler] = useState('');
  // Der Server kennt kurze Links noch nicht → derselbe Dialog wie ohne Konto, mit passendem Hinweis (kein Fehler)
  const [fehlt, setFehlt] = useState(false);
  const mitKonto = linkMoeglich() && !fehlt;

  useEffect(() => {
    if (mitKonto) linkDesBoards(boardId).then(setZeile).catch((e: Error) => { if (e instanceof LinkNichtEingerichtet) setFehlt(true); else setFehler(e.message); setZeile(null); });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  if (!board) return null;
  const url = zeile ? linkUrl(zeile.token) : '';

  const kopieren = async (u = url) => {
    try { await navigator.clipboard.writeText(u); showToast('Link kopiert.'); } catch { window.prompt('Link zum Kopieren (Strg+C):', u); }
  };
  const erstellen = async () => {
    if (busy) return;
    setBusy('Lade hoch …'); setFehler('');
    try {
      const neu = !zeile;
      const z = await linkErstellen(boardId, setBusy);
      setZeile(z);
      if (neu) await kopieren(linkUrl(z.token));
      else showToast('Die geteilte Fassung ist auf dem heutigen Stand.');
    } catch (e) { if (e instanceof LinkNichtEingerichtet) setFehlt(true); else setFehler((e as Error).message); } finally { setBusy(''); }
  };
  const loeschen = async () => {
    if (busy) return;
    if (!window.confirm(`Den Link zu „${board.name}" löschen? Wer ihn danach öffnet, bekommt nichts mehr. Schon geöffnete Kopien bleiben bei den Empfängern.`)) return;
    setBusy('Lösche …'); setFehler('');
    try { await linkLoeschen(boardId); setZeile(null); showToast('Link gelöscht.'); } catch (e) { setFehler((e as Error).message); } finally { setBusy(''); }
  };
  const weitergeben = async () => {
    try { await navigator.share({ title: board.name, text: `PixiNotes-Board „${board.name}"`, url }); } catch { /* abgebrochen */ }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal freigabe-dialog link-dialog" role="dialog" aria-modal="true" aria-label="Board per Link teilen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🔗 Per Link teilen</h2>
          <button className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <section className="modal-section">
            {!mitKonto ? (
              <>
                {fehlt ? (
                  <p className="modal-hint" data-taste="link-fehlt">
                    Kurze Links (samt Anhängen) sind auf dem PixiNotes-Server noch nicht eingerichtet. Bis dahin geht es so:
                    Das Board steckt im Link selbst — ohne Anhänge, und nur, solange es klein genug ist.
                  </p>
                ) : (
                  <>
                    <p className="modal-hint">
                      Ein <b>kurzer Link</b>, den jeder direkt öffnen kann — samt PDFs und anderen Anhängen — braucht das PixiNotes-Konto
                      (⚙ → Daten → Konto, Anmeldung mit E-Mail). Nur du brauchst es; wer den Link bekommt, nicht.
                    </p>
                    <div className="modal-buttons">
                      <button onClick={() => { onClose(); useBoard.getState().setSettingsOpen(true); }} data-taste="link-konto">Konto einrichten …</button>
                    </div>
                    <div className="modal-note">
                      Ohne Konto geht es so: Das Board steckt dann im Link selbst — ohne Anhänge, und nur, solange es klein genug ist.
                    </div>
                  </>
                )}
                <div className="modal-buttons">
                  <button onClick={() => { ohneKonto(); onClose(); }} data-taste="link-ohne-konto">Board im Link kopieren</button>
                  <button onClick={() => { alsDatei(); onClose(); }}>Als Datei sichern</button>
                </div>
              </>
            ) : zeile === undefined ? (
              <div className="modal-note">Lade …</div>
            ) : zeile ? (
              <>
                <p className="modal-hint">Wer diesen Link öffnet, bekommt „{board.name}" direkt als eigenes Board — ohne Konto, samt Anhängen.</p>
                <div className="link-zeile">
                  <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link" data-taste="link-adresse" />
                  <button onClick={() => void kopieren()} data-taste="link-kopieren">Kopieren</button>
                  {typeof navigator.share === 'function' && <button onClick={() => void weitergeben()}>Senden …</button>}
                </div>
                <div className="modal-note" data-taste="link-stand">
                  Geteilte Fassung vom {new Date(zeile.updated_at).toLocaleString('de-DE')}{zeile.dateien.length ? ` · ${zeile.dateien.length} Anhang${zeile.dateien.length === 1 ? '' : 'e'}` : ''}.
                  Änderungen danach sieht man über den Link erst, wenn du die Fassung aktualisierst.
                </div>
                <div className="modal-buttons">
                  <button disabled={!!busy} onClick={erstellen} data-taste="link-aktualisieren">{busy || 'Fassung aktualisieren'}</button>
                  <button disabled={!!busy} className="link-weg" onClick={loeschen} data-taste="link-loeschen">Link löschen</button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-hint">
                  Einen Link zu „{board.name}" anlegen: Wer ihn öffnet, bekommt das Board direkt als eigenes Board — ohne Konto, samt PDFs und anderen Anhängen.
                </p>
                <div className="modal-buttons">
                  <button disabled={!!busy} onClick={erstellen} data-taste="link-erstellen">{busy || 'Link erstellen und kopieren'}</button>
                </div>
              </>
            )}
            {mitKonto && (
              <div className="modal-note">
                Jeder, der den Link kennt, kann diese Fassung lesen — sie liegt dafür auf dem PixiNotes-Server, bis du den Link löschst.
                Empfänger arbeiten an ihrer eigenen Kopie. Zum gemeinsamen Arbeiten in Echtzeit (oder live mitlesen lassen): Board-Menü → <b>Gemeinsam bearbeiten</b>.
              </div>
            )}
            {fehler && <div className="modal-error" role="alert">⚠️ {fehler}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
