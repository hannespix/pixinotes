import { useState } from 'react';
import { connectMicrosoft, loadCalAccounts, msHasNotes, oauthAvailable } from '../lib/calAccounts';
import { fetchNotebooks, runOneNoteImport, type OnNotebook } from '../lib/onenote';
import { useBoard } from '../store';

/**
 * M184: OneNote-Import — Notizbuch wird Bereich, Abschnitt wird Board,
 * jede Seite eine Notiz-Karte. Bewusst als eigene Komponente: Der Ablauf hat
 * mehrere Stufen (verbinden → Notizbücher laden → auswählen → holen) und
 * würde die ohnehin große Einstellungs-Datei sonst unübersichtlich machen.
 */
export function OneNoteImport({ onClose }: { onClose: () => void }) {
  const showToast = useBoard((s) => s.showToast);
  const canUndoImport = useBoard((s) => s.canUndoImport);
  const [acc, setAcc] = useState(() => loadCalAccounts().ms);
  const [books, setBooks] = useState<OnNotebook[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [withImages, setWithImages] = useState(true);
  const [maxPages, setMaxPages] = useState(60);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<{ msg: string; done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState(acc?.clientId ?? '');
  const [tenant, setTenant] = useState(acc?.tenant ?? '');

  const hasNotes = msHasNotes(acc);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const connect = () => run('connect', async () => {
    const name = await connectMicrosoft(clientId.trim(), tenant.trim() || 'common', true);
    setAcc(loadCalAccounts().ms);
    showToast(`✅ OneNote verbunden: ${name}`);
  });

  const load = () => run('load', async () => {
    const list = await fetchNotebooks();
    setBooks(list);
    const total = list.reduce((n, b) => n + b.sections.length, 0);
    if (total === 0) setError('Es wurden keine Abschnitte gefunden — hat dieses Konto OneNote-Notizbücher?');
  });

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const toggleBook = (b: OnNotebook) => setPicked((s) => {
    const n = new Set(s);
    const all = b.sections.every((x) => n.has(x.id));
    for (const x of b.sections) { if (all) n.delete(x.id); else n.add(x.id); }
    return n;
  });

  const doImport = () => run('import', async () => {
    const choices = (books ?? [])
      .map((notebook) => ({ notebook, sections: notebook.sections.filter((s) => picked.has(s.id)) }))
      .filter((c) => c.sections.length > 0);
    if (choices.length === 0) { setError('Bitte mindestens einen Abschnitt auswählen.'); return; }
    const res = await runOneNoteImport(choices, { withImages, maxPages }, (msg, done, total) => setProgress({ msg, done, total }));
    showToast(
      `📓 OneNote übernommen: ${res.boards} Board(s) mit ${res.pages} Seite(n)`
      + (res.skipped.length ? ` — ${res.skipped.length} übersprungen` : '')
      + '. Rückgängig über ⚙ → Daten.',
      false, 9000,
    );
    onClose();
  });

  const pickedCount = picked.size;

  return (
    <section className="modal-section">
      <h3>OneNote-Notizbücher übernehmen</h3>
      <p className="modal-hint">
        Holt deine OneNote-Inhalte direkt aus Microsoft 365: <b>Notizbuch → Bereich</b>,{' '}
        <b>Abschnitt → Board</b>, <b>Seite → Notiz-Karte</b>. Aufgabenkästchen (To-Do-Kategorie)
        werden zu echten Checklisten und tauchen damit in der Aufgaben-Zentrale auf.
        Gelesen wird <b>nur</b> — in OneNote ändert sich nichts.
      </p>

      {!oauthAvailable() && (
        <div className="modal-note">
          Das Anmelden braucht die gehostete App (http/https). Aus der Einzeldatei heraus geht es nicht —
          dort bleibt der Weg über „Datei → Exportieren → Word" und die .docx aufs Board ziehen.
        </div>
      )}

      {!hasNotes ? (
        <>
          <div className="modal-note">
            {acc ? 'Die bestehende Microsoft-Verbindung deckt nur den Kalender ab. Ein einmaliges Bestätigen schaltet den Lesezugriff auf OneNote frei.'
              : 'Noch kein Microsoft-Konto verbunden.'}
          </div>
          <label className="modal-row">
            <span>App-ID (Client)</span>
            <input
              type="text" placeholder="00000000-0000-0000-0000-000000000000"
              value={clientId} onChange={(e) => setClientId(e.target.value)}
            />
          </label>
          <label className="modal-row">
            <span>Tenant (optional)</span>
            <input
              type="text" placeholder="common (oder eure Tenant-ID)"
              value={tenant} onChange={(e) => setTenant(e.target.value)}
            />
          </label>
          <div className="modal-buttons">
            <button disabled={!clientId.trim() || !oauthAvailable() || !!busy} onClick={connect}>
              {busy === 'connect' ? '…' : 'Mit OneNote verbinden'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-note">✅ OneNote-Zugriff steht{acc?.connectedAs ? ` (${acc.connectedAs})` : ''}.</div>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={load}>
              {busy === 'load' ? 'Lade Notizbücher…' : books ? 'Notizbücher neu laden' : 'Notizbücher laden'}
            </button>
          </div>
        </>
      )}

      {books && books.length > 0 && (
        <>
          <div className="on-tree">
            {books.map((b) => (
              <div key={b.id} className="on-book">
                <button className="on-book-name" onClick={() => toggleBook(b)}>
                  📓 {b.name} <span className="on-count">{b.sections.length} Abschnitt(e)</span>
                </button>
                {b.sections.map((s) => (
                  <label key={s.id} className="on-sec">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                    <span>{s.group ? `${s.group} › ` : ''}{s.name}</span>
                  </label>
                ))}
                {b.sections.length === 0 && <div className="on-empty">keine Abschnitte</div>}
              </div>
            ))}
          </div>

          <label className="modal-row">
            <span>Bilder mitladen</span>
            <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
          </label>
          <label className="modal-row">
            <span>Höchstens Seiten je Abschnitt</span>
            <input
              type="number" min={1} max={100} value={maxPages}
              onChange={(e) => setMaxPages(Math.min(100, Math.max(1, Number(e.target.value) || 60)))}
            />
          </label>

          <div className="modal-buttons">
            <button disabled={pickedCount === 0 || !!busy} onClick={doImport}>
              {busy === 'import' ? 'Hole Inhalte…' : `${pickedCount} Abschnitt(e) übernehmen`}
            </button>
          </div>
        </>
      )}

      {progress && (
        <div className="on-progress">
          <div className="on-bar"><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <span>{progress.msg} ({progress.done}/{progress.total})</span>
        </div>
      )}

      {error && <div className="modal-error">{error}</div>}

      {canUndoImport && (
        <div className="modal-buttons">
          <button
            onClick={() => {
              if (useBoard.getState().undoImport()) showToast('Import zurückgenommen — der Stand von davor ist wiederhergestellt.');
            }}
          >
            Letzten Import zurücknehmen
          </button>
        </div>
      )}
    </section>
  );
}
