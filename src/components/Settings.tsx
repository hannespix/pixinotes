import { useEffect, useRef, useState } from 'react';
import { claimWriter, flushPersist, selectActiveBoard, useBoard } from '../store';
import {
  connectGoogle, connectMicrosoft, disconnect as disconnectCalAccount,
  invalidateAccountEvents, loadCalAccounts, oauthAvailable, patchCalAccounts, type CalAccounts,
} from '../lib/calAccounts';
import { exportToFolder, exportViewport } from '../lib/exporter';
import {
  applySync, checkSyncRemote, disconnectSync, ensurePermission, getSyncHandle, knownStamp,
  permissionState, pickSyncFolder, readSync, syncSupported, writeSync,
  SYNC_DIRTY_KEY, WEBDAV_DIRTY_KEY, type SyncDirHandle,
} from '../lib/syncFolder';
import {
  applyWebdav, clearWebdav, loadWebdav, saveWebdav, webdavRead, webdavStamp, webdavTest, webdavWrite,
  type WebdavConfig,
} from '../lib/webdav';

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

// Sync-Audit M81: Import ist erst „fertig", wenn er auch in localStorage liegt —
// vorher log der Erfolgs-Toast bei vollem Speicher (Stand nur im RAM, nach
// Neustart wieder weg). Jetzt wird ehrlich gewarnt und KEIN Stempel gesetzt.
const QUOTA_IMPORT_MSG =
  '⚠️ Geladen, aber NICHT dauerhaft gespeichert — der Browser-Speicher ist voll! '
  + 'Bitte Platz schaffen (z. B. große Bilder löschen) und erneut laden, sonst ist der Stand nach dem Schließen weg.';

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
  // Reiter-Gliederung: KI / Synchronisation / Daten / Export / Design
  const [tab, setTab] = useState<'ki' | 'sync' | 'kalender' | 'daten' | 'export' | 'design'>('ki');
  // Kalender-Konten leben in einem EIGENEN localStorage-Schlüssel (nie im
  // Board-Store) — flüchtig in den Komponenten-State gespiegelt
  const [calAcc, setCalAcc] = useState<CalAccounts>({});
  const [gClientId, setGClientId] = useState('');
  const [msClientId, setMsClientId] = useState('');
  const [msTenant, setMsTenant] = useState('');
  // WebDAV-Zugang (separater localStorage-Schlüssel — nie in Exporten)
  const [davCfg, setDavCfg] = useState<WebdavConfig | null>(null);
  // WebDAV-Fehler zusätzlich dauerhaft IM Modal zeigen — der Toast liegt
  // unterm Einstellungsfenster schnell außerhalb des Blicks (User-Report).
  // WICHTIG: vor dem Early-Return deklarieren (Hook-Reihenfolge, React #310)
  const [davError, setDavError] = useState('');
  const [davUrl, setDavUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [davSecret, setDavSecret] = useState('');
  const clickZoom = useBoard((s) => s.clickZoom);
  const setClickZoom = useBoard((s) => s.setClickZoom);
  const wheelZoom = useBoard((s) => s.wheelZoom);
  const setWheelZoom = useBoard((s) => s.setWheelZoom);
  const ui = useBoard((s) => s.ui);
  const setUiTheme = useBoard((s) => s.setUiTheme);
  const setUiAccent = useBoard((s) => s.setUiAccent);
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

  // Kalender-Konten beim Öffnen aus dem separaten localStorage-Schlüssel laden
  useEffect(() => {
    if (!open) return;
    const acc = loadCalAccounts();
    setCalAcc(acc);
    setGClientId(acc.google?.clientId ?? '');
    setMsClientId(acc.ms?.clientId ?? '');
    setMsTenant(acc.ms?.tenant ?? '');
    const dav = loadWebdav();
    setDavCfg(dav);
    setDavUrl(dav?.url ?? '');
    setDavUser(dav?.user ?? '');
    setDavSecret(dav?.secret ?? '');
  }, [open]);

  if (!open) return null;

  const refreshCalAcc = () => setCalAcc(loadCalAccounts());

  const doConnectGoogle = () => doExport(async () => {
    const name = await connectGoogle(gClientId.trim());
    refreshCalAcc();
    showToast(`✅ Google verbunden: ${name}`);
  }, 'google');

  const doConnectMs = () => doExport(async () => {
    const name = await connectMicrosoft(msClientId.trim(), msTenant.trim() || 'common');
    refreshCalAcc();
    showToast(`✅ Microsoft 365 verbunden: ${name}`);
  }, 'ms');

  const toggleGoogleCalendar = (calId: string, enabled: boolean) => {
    const g = loadCalAccounts().google;
    if (!g) return;
    patchCalAccounts({ google: { ...g, calendars: (g.calendars ?? []).map((c) => (c.id === calId ? { ...c, enabled } : c)) } });
    invalidateAccountEvents();
    refreshCalAcc();
  };

  const doDav = (label: string, fn: () => Promise<unknown>) => doExport(async () => {
    setDavError('');
    try { await fn(); } catch (e) { setDavError(String((e as Error).message)); throw e; }
  }, label);

  const davConnect = () => doDav('dav', async () => {
    const cfg: WebdavConfig = { url: davUrl.trim(), user: davUser.trim(), secret: davSecret, auto: true };
    const state = await webdavTest(cfg);
    saveWebdav(cfg);
    setDavCfg(cfg);
    if (state === 'vorhanden') {
      showToast('✅ Verbunden — auf dem Server liegt bereits ein Stand. „⬇️ Vom Server laden" holt ihn.');
    } else {
      await webdavWrite(cfg);
      showToast('✅ Verbunden — aktueller Stand wurde hochgeladen. Änderungen syncen ab jetzt automatisch.');
    }
  });

  const davPush = () => doDav('davpush', async () => {
    const stamp = await webdavWrite(davCfg!);
    showToast(`⬆️ Hochgeladen (${new Date(stamp).toLocaleTimeString('de-DE')}).`);
  });

  const davPull = () => doDav('davpull', async () => {
    const p = await webdavRead(davCfg!);
    if (!p) { showToast('Auf dem Server liegt (noch) keine PixiNotes-Datei.'); return; }
    if (!window.confirm(`Stand vom ${new Date(p.savedAt).toLocaleString('de-DE')} laden? Der lokale Stand wird ersetzt (Strg+Z geht danach nicht zurück).`)) return;
    if (!applyWebdav(p)) { showToast(QUOTA_IMPORT_MSG); return; }
    showToast('⬇️ Stand vom WebDAV-Server geladen.');
  });

  const davDisconnect = () => {
    clearWebdav();
    setDavCfg(null);
    setDavSecret('');
    showToast('WebDAV getrennt — Zugangsdaten gelöscht, Daten bleiben lokal erhalten.');
  };

  const connectSync = async () => {
    const handle = await pickSyncFolder();
    setSyncHandle(handle);
    const remote = await readSync(handle);
    if (remote && window.confirm(
      `Im Ordner liegt bereits ein PixiNotes-Stand (${new Date(remote.savedAt).toLocaleString('de-DE')}).\n\nOK = diesen Stand LADEN (ersetzt die lokalen Boards)\nAbbrechen = lokalen Stand in den Ordner schreiben`,
    )) {
      if (!applySync(remote)) { showToast(QUOTA_IMPORT_MSG); return; }
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
    if (!applySync(remote)) { showToast(QUOTA_IMPORT_MSG); return; }
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
      claimWriter(); // bewusster Import — auch aus einem Mitlese-Fenster wirksam
      useBoard.getState().importSync(p.boards, p.spaces ?? [], p.activeId ?? p.boards[0].id);
      if (!flushPersist()) { showToast(QUOTA_IMPORT_MSG); return; }
      // Der Datei-Stand liegt in keinem Sync-Ziel → kein Fast-Forward darüber
      try { localStorage.setItem(SYNC_DIRTY_KEY, '1'); localStorage.setItem(WEBDAV_DIRTY_KEY, '1'); } catch { /* unkritisch */ }
      showToast('📂 Stand aus Datei geladen');
      setOpen(false);
    } catch {
      showToast('Datei konnte nicht gelesen werden.');
    }
  };

  const doExport = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(label);
    // Fehlertexte (WebDAV/CORS & Co.) sind lang — 12 s Lesezeit statt 3 s
    try { await fn(); } catch (e) { showToast(`Abgebrochen: ${String((e as Error).message)}`, false, 12000); }
    setBusy('');
  };

  const hasFolderApi = 'showDirectoryPicker' in window;

  /** Alles leeren — bewusst zweistufig (Bestätigung + Tipp-Wort), kein Undo */
  const resetEverything = async () => {
    if (!window.confirm(
      'Wirklich ALLES leeren?\n\nAlle Bereiche, Projekte, Boards, Karten, Versionen und Vorlagen werden gelöscht. '
      + 'Ein verbundener Sync-Ordner wird getrennt (seine Dateien bleiben unangetastet). KI-Einstellungen bleiben erhalten.\n\n'
      + 'Tipp: Vorher unter „Daten" den Stand als Datei exportieren.',
    )) return;
    const word = window.prompt('Zur Bestätigung bitte LEEREN eingeben:');
    if ((word ?? '').trim().toUpperCase() !== 'LEEREN') {
      showToast('Abgebrochen — nichts wurde gelöscht.');
      return;
    }
    // Sync trennen, BEVOR geleert wird — sonst würde der Auto-Sync den
    // leeren Stand in den Ordner/auf den Server schreiben und die
    // Cloud-Kopie überschreiben
    if (syncHandle) {
      await disconnectSync().catch(() => {});
      setSyncHandle(null);
    }
    if (loadWebdav()) {
      clearWebdav();
      setDavCfg(null);
    }
    useBoard.getState().resetAll();
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Einstellungen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>⚙️ Einstellungen</h2>
          <button className="modal-x" onClick={() => setOpen(false)} aria-label="Schließen">✕</button>
        </div>

        {/* Reiter: hält jede Ebene übersichtlich */}
        <div className="modal-tabs">
          {([['ki', '🤖 KI'], ['sync', '☁️ Synchronisation'], ['kalender', '📅 Kalender'], ['daten', '💾 Daten'], ['export', '📤 Export'], ['design', '🎨 Design']] as const).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {/* ---- KI ---- */}
        {tab === 'ki' && (
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
        )}

        {/* ---- Synchronisation (Nextcloud & Co.) ---- */}
        {tab === 'sync' && (
        <>
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
                            // Direkt prüfen: liegt im Ordner ein neuerer Stand,
                            // wird er jetzt gefahrlos übernommen (Fast-Forward)
                            await checkSyncRemote();
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

        <section className="modal-section">
          <h3>🌐 WebDAV direkt (Nextcloud, ownCloud …)</h3>
          <p className="modal-hint">
            Ohne Desktop-Client: PixiNotes spricht direkt mit dem WebDAV-Server — funktioniert auch am
            Tablet/Handy. Bei Nextcloud: <b>App-Passwort</b> unter Einstellungen → Sicherheit anlegen
            (nie das echte Passwort). <b>Zugangsdaten bleiben lokal</b> und landen in keinem Export.
            <br />
            ⚠️ <b>Nextcloud blockiert Browser-Zugriffe standardmäßig</b> (CORS): Entweder die
            Nextcloud-App <b>„WebAppPassword"</b> installieren und dort die PixiNotes-Adresse
            (z. B. <code>https://hannespix.github.io</code>) als erlaubte Origin eintragen, oder die
            IT um CORS-Freigabe bitten — ohne Freigabe bitte den Sync-Ordner oben nutzen.
          </p>
          {!davCfg ? (
            <>
              <label className="modal-row">
                <span>Ordner-URL</span>
                <input
                  type="text" placeholder="https://cloud…/remote.php/dav/files/BENUTZER/PixiNotes"
                  value={davUrl} onChange={(e) => setDavUrl(e.target.value)}
                />
              </label>
              {davUrl.trim() !== '' && !davUrl.includes('remote.php') && (
                <div className="modal-note">
                  💡 Das sieht nicht nach einer WebDAV-Ordner-URL aus. Bei Nextcloud lautet sie meist:{' '}
                  <code>https://DEINE-CLOUD/remote.php/dav/files/BENUTZERNAME/PixiNotes</code>{' '}
                  (zu finden in Nextcloud unten links unter „Dateieinstellungen" → WebDAV).
                </div>
              )}
              <label className="modal-row">
                <span>Benutzer</span>
                <input type="text" placeholder="vorname.name" value={davUser} onChange={(e) => setDavUser(e.target.value)} />
              </label>
              <label className="modal-row">
                <span>App-Passwort</span>
                <input type="password" placeholder="xxxxx-xxxxx-xxxxx" value={davSecret} onChange={(e) => setDavSecret(e.target.value)} />
              </label>
              <div className="modal-buttons">
                <button disabled={!davUrl.trim() || !davUser.trim() || !davSecret || busy === 'dav'} onClick={davConnect}>
                  {busy === 'dav' ? '…' : '🔗 Verbinden & testen'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-buttons">
                <button disabled={!!busy} onClick={davPush}>{busy === 'davpush' ? '…' : '⬆️ Jetzt hochladen'}</button>
                <button disabled={!!busy} onClick={davPull}>{busy === 'davpull' ? '…' : '⬇️ Vom Server laden'}</button>
                <button disabled={!!busy} onClick={davDisconnect}>✂️ Trennen</button>
              </div>
              <div className="modal-note">
                ✅ Verbunden mit {davCfg.url.replace(/^https?:\/\//, '').split('/')[0]} — Änderungen werden automatisch hochgeladen
                {webdavStamp() ? ` (letzter Sync: ${new Date(webdavStamp()!).toLocaleString('de-DE')})` : ''}.
                Schreibt ein anderes Gerät zwischenzeitlich, warnt PixiNotes statt zu überschreiben.
              </div>
            </>
          )}
          {davError && (
            <div className="modal-error" role="alert">⚠️ {davError}</div>
          )}
        </section>
        </>
        )}

        {/* ---- Kalender-Konten: Google & Microsoft 365 direkt verbinden ---- */}
        {tab === 'kalender' && (
        <section className="modal-section">
          <h3>📅 Kalender-Konten</h3>
          <p className="modal-hint">
            Verbinde Google Kalender oder Microsoft 365/Outlook direkt — die Termine erscheinen
            (nur lesend) in den Kalender-Karten. Die Anmeldung läuft ohne PixiNotes-Server direkt
            zwischen Browser und Anbieter; <b>Zugangsdaten bleiben lokal in diesem Browser</b> und
            landen nie in Sync-Dateien, Share-Links oder Exporten. Die Client-ID legt eure IT einmalig
            an (Google Cloud Console → OAuth-Client „Webanwendung" · Azure → App-Registrierung „SPA",
            jeweils mit dieser Adresse als Redirect-URI).
          </p>
          {!oauthAvailable() && (
            <div className="modal-note">
              ⚠️ Die Einzeldatei (file://) kann kein OAuth — bitte die gehostete App/PWA nutzen.
              Alternative ohne Anmeldung: ICS-Abo direkt in der Kalender-Karte (⚙ → „ICS-URL abonnieren").
            </div>
          )}

          <h3 style={{ marginTop: 14 }}>Google Kalender</h3>
          {calAcc.google?.token ? (
            <>
              <div className="modal-note">✅ Verbunden{calAcc.google.connectedAs ? ` als „${calAcc.google.connectedAs}"` : ''} — Kalender wählen:</div>
              {(calAcc.google.calendars ?? []).map((c) => (
                <label key={c.id} className="cal-menu-check" style={{ display: 'flex', gap: 6 }}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => toggleGoogleCalendar(c.id, e.target.checked)} />
                  {c.name}
                </label>
              ))}
              <div className="modal-buttons">
                <button onClick={() => { disconnectCalAccount('google'); refreshCalAcc(); showToast('Google-Konto getrennt — Token gelöscht.'); }}>Trennen</button>
              </div>
            </>
          ) : (
            <>
              <label className="modal-row">
                <span>Client-ID</span>
                <input
                  type="text" placeholder="xxxxx.apps.googleusercontent.com"
                  value={gClientId} onChange={(e) => setGClientId(e.target.value)}
                />
              </label>
              <div className="modal-buttons">
                <button disabled={!gClientId.trim() || !oauthAvailable() || busy === 'google'} onClick={doConnectGoogle}>
                  {busy === 'google' ? '…' : 'Mit Google verbinden'}
                </button>
              </div>
            </>
          )}

          <h3 style={{ marginTop: 14 }}>Microsoft 365 / Outlook</h3>
          {(calAcc.ms?.token || calAcc.ms?.refreshToken) ? (
            <>
              <div className="modal-note">✅ Verbunden{calAcc.ms.connectedAs ? ` als „${calAcc.ms.connectedAs}"` : ''}.</div>
              <div className="modal-buttons">
                <button onClick={() => { disconnectCalAccount('ms'); refreshCalAcc(); showToast('Microsoft-Konto getrennt — Token gelöscht.'); }}>Trennen</button>
              </div>
            </>
          ) : (
            <>
              <label className="modal-row">
                <span>App-ID (Client)</span>
                <input
                  type="text" placeholder="00000000-0000-0000-0000-000000000000"
                  value={msClientId} onChange={(e) => setMsClientId(e.target.value)}
                />
              </label>
              <label className="modal-row">
                <span>Tenant (optional)</span>
                <input
                  type="text" placeholder="common (oder eure Tenant-ID)"
                  value={msTenant} onChange={(e) => setMsTenant(e.target.value)}
                />
              </label>
              <div className="modal-buttons">
                <button disabled={!msClientId.trim() || !oauthAvailable() || busy === 'ms'} onClick={doConnectMs}>
                  {busy === 'ms' ? '…' : 'Mit Microsoft verbinden'}
                </button>
              </div>
            </>
          )}
        </section>
        )}

        {/* ---- Daten: sichern/laden, Beispieldaten, leeren ---- */}
        {tab === 'daten' && (
        <>
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

        <section className="modal-section modal-danger">
          <h3>🧹 Alles leeren &amp; neu starten</h3>
          <p className="modal-hint">
            Löscht <b>alle</b> Bereiche, Projekte, Boards, Karten, Versionen und Vorlagen und startet mit
            einem leeren Board. Kein Rückgängig! KI-Einstellungen bleiben erhalten; ein verbundener
            Sync-Ordner wird vorher getrennt (seine Dateien bleiben unangetastet).
            <b> Tipp:</b> vorher oben „Datei exportieren".
          </p>
          <div className="modal-buttons">
            <button className="danger" disabled={!!busy} onClick={() => void resetEverything()}>
              🧹 Alles leeren…
            </button>
          </div>
        </section>
        </>
        )}

        {/* ---- Datenordner & Export ---- */}
        {tab === 'export' && (
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
        )}

        {/* ---- Design: Hell/Dunkel + Akzentfarbe ---- */}
        {tab === 'design' && (
        <section className="modal-section">
          <h3>🎨 Design</h3>
          <p className="modal-hint">
            Erscheinungsbild und Akzentfarbe gelten sofort und werden lokal gespeichert.
            „System" folgt automatisch der Hell/Dunkel-Einstellung deines Geräts.
            Haftnotizen und Formen bleiben bewusst helles „Papier" — auch im dunklen Design.
          </p>
          <label className="modal-row">
            <span>Erscheinungsbild</span>
            <select value={ui.theme} onChange={(e) => setUiTheme(e.target.value as 'system' | 'light' | 'dark')}>
              <option value="system">🖥️ System</option>
              <option value="light">☀️ Hell</option>
              <option value="dark">🌙 Dunkel</option>
            </select>
          </label>
          <div className="modal-row">
            <span>Akzentfarbe</span>
            <div className="accent-swatches">
              {([
                ['blau', '#4f7cff', 'Blau'],
                ['gruen', '#2e9e63', 'Grün'],
                ['violett', '#7c5cff', 'Violett'],
                ['orange', '#e0762e', 'Orange'],
                ['rosa', '#d44f6e', 'Rosa'],
              ] as const).map(([id, color, name]) => (
                <button
                  key={id}
                  className={`accent-swatch ${ui.accent === id ? 'on' : ''}`}
                  style={{ background: color }}
                  title={name}
                  aria-label={`Akzentfarbe ${name}`}
                  onClick={() => setUiAccent(id)}
                />
              ))}
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>🖱️ Bedienung</h3>
          <label className="modal-row modal-row-check">
            <span>Klick-Zoom</span>
            <input type="checkbox" checked={clickZoom} onChange={(e) => setClickZoom(e.target.checked)} />
          </label>
          <p className="modal-hint">
            Beim Anklicken fliegt die Ansicht sanft zur Karte — aber nur, wenn sie klein
            oder angeschnitten ist. Wer schon nah dran arbeitet, wird nicht herumgeworfen.
          </p>
          <label className="modal-row modal-row-check">
            <span>Mausrad zoomt</span>
            <input type="checkbox" checked={wheelZoom} onChange={(e) => setWheelZoom(e.target.checked)} />
          </label>
          <p className="modal-hint">
            Miro-Stil: Rad zoomt direkt (verschieben per Karten-Fläche ziehen).
            Aus = Rad scrollt, Zoomen mit Strg+Rad oder Pinch.
          </p>
        </section>
        )}

        <div className="modal-foot">
          PixiNotes (Stand {__BUILD_STAMP__}) · lokale Daten, kein Konto nötig ·{' '}
          <button className="link-btn legal-link" onClick={() => { setOpen(false); useBoard.getState().setHelpOpen(true, 'impressum'); }}>Impressum</button>
          {' · '}
          <button className="link-btn legal-link" onClick={() => { setOpen(false); useBoard.getState().setHelpOpen(true, 'datenschutz'); }}>Datenschutz</button>
        </div>
      </div>
    </div>
  );
}
