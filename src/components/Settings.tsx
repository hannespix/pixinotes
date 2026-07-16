import { useEffect, useRef, useState } from 'react';
import { selectActiveBoard, useBoard } from '../store';
import { exportToFolder, exportViewport } from '../lib/exporter';
import {
  applySync, disconnectSync, ensurePermission, getSyncHandle, knownStamp,
  permissionState, pickSyncFolder, readSync, syncSupported, writeSync, type SyncDirHandle,
} from '../lib/syncFolder';

const MODELS: Record<string, string[]> = {
  free: ['openai'], // anonym gibt es bei Pollinations aktuell nur dieses Modell
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen3-235b-a22b:free',
  ],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  ollama: ['llama3.1', 'mistral', 'qwen2.5', 'phi3'],
  custom: [''],
  none: [],
};
const DEFAULT_BASE: Record<string, string> = {
  ollama: 'http://localhost:11434',
  custom: 'http://localhost:8080/v1',
};
const NEEDS_KEY = new Set(['anthropic', 'openai', 'openrouter', 'custom']);
const NEEDS_URL = new Set(['ollama', 'custom']);

/**
 * Einstellungen: KI-Anbindung (eigener Key, lokal gespeichert) und
 * Datenordner/Export. Bewusst schlicht — läuft auch aus der Single-HTML.
 */
export function Settings() {
  const open = useBoard((s) => s.settingsOpen);
  const setOpen = useBoard((s) => s.setSettingsOpen);
  const ai = useBoard((s) => s.ai);
  const updateAi = useBoard((s) => s.updateAi);
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard(selectActiveBoard);
  const showToast = useBoard((s) => s.showToast);
  const [busy, setBusy] = useState('');
  const [syncHandle, setSyncHandle] = useState<SyncDirHandle | null>(null);
  const [syncPerm, setSyncPerm] = useState<'granted' | 'prompt'>('granted');
  // WICHTIG: vor dem early-return deklarieren (Hook-Reihenfolge!)
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Esc schließt das Panel — wie überall sonst (Suche, TaskHub, Präsentation)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Verbundenen Sync-Ordner + Berechtigungs-Status anzeigen (Handle überlebt Neustarts via IndexedDB)
  useEffect(() => {
    if (!open || !syncSupported()) return;
    getSyncHandle()
      .then(async (h) => {
        setSyncHandle(h ?? null);
        if (h) setSyncPerm(await permissionState(h));
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const connectSync = async () => {
    const handle = await pickSyncFolder();
    setSyncHandle(handle);
    const remote = await readSync(handle);
    if (remote && window.confirm(
      `Im Ordner liegt bereits ein PixiNotes-Stand (${new Date(remote.savedAt).toLocaleString('de-DE')}).\n\nOK = diesen Stand LADEN (ersetzt die lokalen Boards)\nAbbrechen = lokalen Stand in den Ordner schreiben`,
    )) {
      applySync(remote);
      showToast('☁️ Stand aus dem Sync-Ordner geladen');
    } else {
      await writeSync(handle);
      showToast(`☁️ Verbunden — Änderungen werden automatisch nach „${handle.name}" gespeichert`);
    }
  };

  const loadFromSync = async () => {
    if (!syncHandle || !(await ensurePermission(syncHandle, true))) return;
    const remote = await readSync(syncHandle);
    if (!remote) { showToast('Keine (gültige) pixinotes-daten.json im Ordner gefunden.'); return; }
    applySync(remote);
    showToast('☁️ Stand aus dem Sync-Ordner geladen');
  };

  const saveToSync = async () => {
    if (!syncHandle || !(await ensurePermission(syncHandle, true))) return;
    await writeSync(syncHandle);
    showToast('☁️ In den Sync-Ordner gespeichert');
  };

  // ---- Datei-Sync: funktioniert überall (Firefox, file://, USB-Stick, Mail-Anhang) ----
  const exportStateFile = () => {
    const st = useBoard.getState();
    const payload = {
      app: 'pixinotes', version: 2, savedAt: new Date().toISOString(),
      boards: st.boards, spaces: st.spaces, activeId: st.activeId,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixinotes-daten-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('💾 Kompletter Stand als Datei exportiert');
  };

  const importStateFile = async (file: File) => {
    try {
      const p = JSON.parse(await file.text());
      if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0) {
        showToast('Das ist keine gültige PixiNotes-Datei.');
        return;
      }
      if (!window.confirm(`Stand vom ${p.savedAt ? new Date(p.savedAt).toLocaleString('de-DE') : '?'} laden? Die aktuellen Boards werden ersetzt.`)) return;
      useBoard.getState().importSync(p.boards, p.spaces ?? [], p.activeId ?? p.boards[0].id);
      showToast('📂 Stand aus Datei geladen');
      setOpen(false);
    } catch {
      showToast('Datei konnte nicht gelesen werden.');
    }
  };

  const doExport = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    try { await fn(); } catch (e) { showToast(`Abgebrochen: ${String((e as Error).message)}`); }
    setBusy('');
  };

  const hasFolderApi = 'showDirectoryPicker' in window;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙️ Einstellungen</h2>
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>

        {/* ---- KI ---- */}
        <section className="modal-section">
          <h3>🤖 KI-Assistent</h3>
          <p className="modal-hint">
            KI-Funktionen (Textpolitur, E-Mail-Zusammenfassung, Auto-Clustering) laufen über einen
            Anbieter deiner Wahl. Cloud-Dienste nutzen deinen eigenen Schlüssel; mit <b>Ollama</b> oder
            einem selbstgehosteten Server bleibt <b>alles auf deinem Rechner</b>. Zugangsdaten werden
            nur lokal in diesem Browser gespeichert.
          </p>
          <label className="modal-row">
            <span>Anbieter</span>
            <select value={ai.provider} onChange={(e) => {
              const provider = e.target.value as typeof ai.provider;
              // apiKey IMMER zurücksetzen: sonst ginge z. B. ein OpenAI-Key beim
              // Wechsel auf „Eigener Server" an eine fremde URL (Audit R6-K2)
              updateAi({ provider, model: MODELS[provider]?.[0] ?? '', baseUrl: DEFAULT_BASE[provider] ?? '', apiKey: '' });
            }}>
              <option value="none">— aus —</option>
              <option value="free">Gratis (Pollinations.ai, ohne Schlüssel)</option>
              <option value="openrouter">OpenRouter (Gratis-Modelle, kostenloser Account)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (lokal, selbstgehostet)</option>
              <option value="custom">Eigener Server (OpenAI-kompatibel)</option>
            </select>
          </label>
          {ai.provider !== 'none' && (
            <>
              <label className="modal-row">
                <span>Modell</span>
                {ai.provider === 'custom' ? (
                  <input type="text" placeholder="modellname" value={ai.model}
                    onChange={(e) => updateAi({ model: e.target.value })} />
                ) : (
                  <select value={ai.model} onChange={(e) => updateAi({ model: e.target.value })}>
                    {MODELS[ai.provider].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </label>
              {NEEDS_URL.has(ai.provider) && (
                <label className="modal-row">
                  <span>Server-URL</span>
                  <input type="text" placeholder="http://localhost:11434" value={ai.baseUrl}
                    onChange={(e) => updateAi({ baseUrl: e.target.value })} />
                </label>
              )}
              {NEEDS_KEY.has(ai.provider) && (
                <label className="modal-row">
                  <span>API-Schlüssel{ai.provider === 'custom' ? ' (optional)' : ''}</span>
                  <input type="password" placeholder="sk-…" value={ai.apiKey}
                    onChange={(e) => updateAi({ apiKey: e.target.value })} />
                </label>
              )}
              <div className="modal-note">
                {ai.provider === 'free'
                  ? '✅ Sofort nutzbar, kein Konto nötig — aber langsam (~20 s, Reasoning-Modell) und ohne Garantien; Inhalte gehen an den Community-Dienst Pollinations.ai. Zuverlässiger gratis: OpenRouter (kostenloser Account). Für Sensibles: Ollama (lokal).'
                  : ai.provider === 'openrouter'
                    ? '🔑 Kostenlosen Schlüssel auf openrouter.ai erstellen (Konto reicht, keine Zahlung nötig) — die Modelle mit „:free" kosten nichts und sind deutlich zuverlässiger und schneller als der anonyme Gratis-Dienst.'
                    : ai.provider === 'ollama'
                    ? '🖥️ Ollama muss lokal laufen (ollama serve). Für den Browser-Zugriff ggf. OLLAMA_ORIGINS setzen. Kein Schlüssel, keine Cloud.'
                    : (NEEDS_KEY.has(ai.provider) && !ai.apiKey)
                      ? 'Ohne Schlüssel bleiben die KI-Aktionen ausgeblendet.'
                      : '✅ Konfiguriert — KI-Aktionen erscheinen auf den Karten.'}
              </div>
            </>
          )}
        </section>

        {/* ---- Synchronisation (Nextcloud & Co.) ---- */}
        <section className="modal-section">
          <h3>☁️ Synchronisation (Nextcloud, OneDrive, Dropbox …)</h3>
          <p className="modal-hint">
            {syncSupported()
              ? <>Verbinde einen Ordner, den dein <b>Nextcloud-/OneDrive-/Dropbox-Client</b> synchronisiert — PixiNotes speichert dort automatisch eine <code>pixinotes-daten.json</code> mit allen Boards. Der Cloud-Client bringt sie auf deine anderen Geräte; dort einfach denselben Ordner verbinden. Kein Server-Setup, KI-Schlüssel bleiben lokal.</>
              : 'Dieser Browser unterstützt keine Ordner-Anbindung (Chrome/Edge empfohlen). Alternative: regelmäßig über den Datenordner-Export sichern.'}
          </p>
          {syncSupported() && (
            <>
              <div className="modal-buttons">
                {!syncHandle ? (
                  <button disabled={!!busy} onClick={() => doExport(connectSync, 'sync')}>
                    {busy === 'sync' ? '…' : '📁 Sync-Ordner verbinden…'}
                  </button>
                ) : (
                  <>
                    {syncPerm === 'prompt' && (
                      <button
                        disabled={!!busy}
                        className="sync-perm-btn"
                        onClick={() => doExport(async () => {
                          if (await ensurePermission(syncHandle, true)) {
                            setSyncPerm('granted');
                            showToast('Zugriff erlaubt — Auto-Sync läuft wieder.');
                          } else {
                            showToast('Zugriff nicht erteilt — Sync bleibt pausiert.');
                          }
                        }, 'syncperm')}
                      >
                        {busy === 'syncperm' ? '…' : '🔓 Zugriff erlauben'}
                      </button>
                    )}
                    <button disabled={!!busy} onClick={() => doExport(saveToSync, 'syncsave')}>
                      {busy === 'syncsave' ? '…' : '⬆️ Jetzt speichern'}
                    </button>
                    <button disabled={!!busy} onClick={() => doExport(loadFromSync, 'syncload')}>
                      {busy === 'syncload' ? '…' : '⬇️ Vom Ordner laden'}
                    </button>
                    <button disabled={!!busy} onClick={() => doExport(async () => {
                      await disconnectSync();
                      setSyncHandle(null);
                      showToast('Sync-Ordner getrennt — Daten bleiben lokal erhalten.');
                    }, 'syncoff')}>
                      {busy === 'syncoff' ? '…' : '✂️ Trennen'}
                    </button>
                  </>
                )}
              </div>
              {syncHandle && (
                <div className="modal-note">
                  {syncPerm === 'prompt'
                    ? `⚠️ Verbunden mit „${syncHandle.name}", aber der Browser hat den Zugriff nach dem Neustart zurückgesetzt — bitte oben „Zugriff erlauben" klicken, sonst pausiert der Auto-Sync.`
                    : <>✅ Verbunden mit Ordner „{syncHandle.name}" — Änderungen werden automatisch gespeichert
                      {knownStamp() ? ` (letzter Sync: ${new Date(knownStamp()!).toLocaleString('de-DE')})` : ''}.
                      Schreibt ein anderes Gerät zwischenzeitlich, warnt PixiNotes statt zu überschreiben.</>}
                </div>
              )}
            </>
          )}
        </section>

        {/* ---- Datei-Sync (überall) ---- */}
        {/* ---- Starter-Umgebung ---- */}
        <section className="modal-section">
          <h3>🧭 Starter-Umgebung „Verwaltung"</h3>
          <p className="modal-hint">
            Beispiel-Struktur mit <b>3 Bereichen, 6 Projekten und 14 Boards</b> für den Verwaltungsalltag:
            Schreibtisch, Aufgaben-Zentrale, Zeiterfassung, Dienstreise, Dienstwagen, Wissensbasis,
            Datenschutz, Ansprechpartner, Jour fixe, Mitarbeitergespräche, Beispielprojekt, Onboarding.
            Erklärt nebenbei jedes Modul — alles ist Beispielinhalt und frei anpassbar/löschbar.
          </p>
          <div className="modal-buttons">
            <button
              onClick={() => {
                useBoard.getState().addStarter();
                setOpen(false);
              }}
            >
              🧭 Starter-Umgebung hinzufügen
            </button>
          </div>
        </section>

        <section className="modal-section">
          <h3>💾 Als Datei sichern &amp; übertragen</h3>
          <p className="modal-hint">
            Der einfachste Weg ohne Cloud: kompletten Stand als <code>.json</code>-Datei exportieren und
            auf dem anderen Gerät laden — per USB-Stick, Mail-Anhang oder Netzlaufwerk.
            Funktioniert in <b>jedem Browser</b>.
          </p>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={exportStateFile}>💾 Datei exportieren</button>
            <button disabled={!!busy} onClick={() => fileInputRef.current?.click()}>📂 Datei laden…</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importStateFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </section>

        {/* ---- Datenordner & Export ---- */}
        <section className="modal-section">
          <h3>📁 Datenordner &amp; Export</h3>
          <p className="modal-hint">
            {hasFolderApi
              ? 'Speichere alle Boards als echte Markdown-Dateien in einem Ordner deiner Wahl (Struktur: Bereich / Projekt / Board.md) — z. B. in OneDrive, versionierbar und in Obsidian lesbar.'
              : 'Dieser Browser unterstützt keine direkte Ordner-Anbindung (Chrome/Edge empfohlen). Der Export lädt stattdessen die Markdown-Dateien einzeln herunter.'}
          </p>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={() => doExport(async () => {
              const r = await exportToFolder(spaces, boards);
              showToast(r === 'ok' ? '📁 In Ordner gespeichert' : '⬇️ Markdown-Dateien heruntergeladen');
            }, 'folder')}>
              {busy === 'folder' ? '…' : hasFolderApi ? '📂 Ordner wählen & speichern' : '⬇️ Als Markdown exportieren'}
            </button>
            <button disabled={!!busy} onClick={() => doExport(() => exportViewport('png', activeBoard.name), 'png')}>
              {busy === 'png' ? '…' : '🖼️ Aktuelles Board als PNG'}
            </button>
            <button disabled={!!busy} onClick={() => doExport(() => exportViewport('svg', activeBoard.name), 'svg')}>
              {busy === 'svg' ? '…' : '✏️ Aktuelles Board als SVG'}
            </button>
          </div>
          <div className="modal-note">💡 Für PDF: PNG/SVG exportieren und über „Drucken → Als PDF speichern" ablegen.</div>
        </section>

        <div className="modal-foot">PixiNotes · lokale Daten, kein Konto nötig</div>
      </div>
    </div>
  );
}
