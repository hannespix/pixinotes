import { useEffect, useRef, useState } from 'react';
import { brainStatus, rebuildBrainIndex, syncBrainIndex } from '../lib/brain';
import { claimWriter, flushPersist, selectActiveBoard, useBoard } from '../store';
import {
  connectGoogle, connectMicrosoft, disconnect as disconnectCalAccount,
  invalidateAccountEvents, loadCalAccounts, oauthAvailable, patchCalAccounts, type CalAccounts,
} from '../lib/calAccounts';
import { exportBoard, exportToFolder } from '../lib/exporter';
import { OneNoteImport } from './OneNoteImport';
import {
  applySync, checkSyncRemote, disconnectSync, ensurePermission, getSyncHandle, knownStamp,
  permissionState, pickSyncFolder, readSync, syncSupported, writeSync,
  SYNC_DIRTY_KEY, WEBDAV_DIRTY_KEY, type SyncDirHandle,
} from '../lib/syncFolder';
import {
  applyWebdav, clearWebdav, corsRequestText, loadWebdav, saveWebdav, webdavRead, webdavStamp,
  webdavTest, webdavWrite, type WebdavConfig,
} from '../lib/webdav';
import {
  applyFilesSync, canShareFiles, filesSyncDirty, filesSyncOn, filesSyncStamp, isAppleTouch,
  isStandalone, readSyncFile, saveViaFiles,
} from '../lib/filesSync';
import {
  applyProjectPayload, buildInviteMailto, buildInviteText, connectProjectSync, disconnectProjectSync,
  joinProjectFolder, projectHandle, projectStamp, projectSyncMeta, readProjectFile, writeProjectSync,
} from '../lib/projectSync';

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
  // M204: Gehirn-Einstellungen + Live-Status (Indexer meldet sich per Event)
  const brain = useBoard((s) => s.brain);
  const updateBrain = useBoard((s) => s.updateBrain);
  const [brainInfo, setBrainInfo] = useState(brainStatus());
  useEffect(() => {
    const on = () => setBrainInfo(brainStatus());
    window.addEventListener('pixinotes:brain', on);
    const t = setInterval(on, 2000);
    return () => { window.removeEventListener('pixinotes:brain', on); clearInterval(t); };
  }, []);
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const activeBoard = useBoard(selectActiveBoard);
  const showToast = useBoard((s) => s.showToast);
  const [busy, setBusy] = useState('');
  const [syncHandle, setSyncHandle] = useState<SyncDirHandle | null>(null);
  const [syncPerm, setSyncPerm] = useState<'granted' | 'prompt'>('granted');
  // Team-Sync (M145): welche Projekte hängen an welchem Ordner (nur Namen, keine Geheimnisse)
  const [psMeta, setPsMeta] = useState<Record<string, { folder: string }>>({});
  useEffect(() => { if (open) setPsMeta(projectSyncMeta()); }, [open]);
  // Reiter-Gliederung: KI / Synchronisation / Daten / Export / Design
  const [tab, setTab] = useState<'ki' | 'sync' | 'kalender' | 'daten' | 'export' | 'design'>('ki');
  // Bild-Export-Optionen (M140)
  const [expFormat, setExpFormat] = useState<'png' | 'svg' | 'print'>('png');
  const [expScale, setExpScale] = useState(2);
  const [expBg, setExpBg] = useState<'beige' | 'white' | 'transparent'>('beige');
  const [expHeader, setExpHeader] = useState(true);
  const [expSelOnly, setExpSelOnly] = useState(false);
  // Direktsprung auf einen Reiter (z. B. „sync" vom Status-Chip in der Kopfleiste)
  const wantTab = useBoard((s) => s.settingsSection);
  useEffect(() => {
    if (open && wantTab) setTab(wantTab as typeof tab);
  }, [open, wantTab]);
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
  const anzeige = useBoard((s) => s.anzeige);
  const setAnzeige = useBoard((s) => s.setAnzeige);
  const lesbareSchrift = useBoard((s) => s.lesbareSchrift);
  const setLesbareSchrift = useBoard((s) => s.setLesbareSchrift);
  const hoherKontrast = useBoard((s) => s.hoherKontrast);
  const setHoherKontrast = useBoard((s) => s.setHoherKontrast);
  const clickZoom = useBoard((s) => s.clickZoom);
  const setClickZoom = useBoard((s) => s.setClickZoom);
  const cardFocus = useBoard((s) => s.cardFocus);
  const brainOffSpaces = useBoard((s) => s.brainOffSpaces);
  const toggleBrainSpace = useBoard((s) => s.toggleBrainSpace);
  const setCardFocus = useBoard((s) => s.setCardFocus);
  const wheelZoom = useBoard((s) => s.wheelZoom);
  const setWheelZoom = useBoard((s) => s.setWheelZoom);
  const ui = useBoard((s) => s.ui);
  const setUiTheme = useBoard((s) => s.setUiTheme);
  const setUiAccent = useBoard((s) => s.setUiAccent);
  // WICHTIG: vor dem early-return deklarieren (Hook-Reihenfolge!)
  const fileInputRef = useRef<HTMLInputElement>(null);
  // M190: Dateien-App-Sync (iPad & Co.) — eigener Datei-Dialog, damit er nicht
  // mit dem allgemeinen Datei-Import im Daten-Reiter kollidiert
  const filesSyncRef = useRef<HTMLInputElement>(null);
  const [filesTick, setFilesTick] = useState(0);   // erzwingt Neuanzeige nach Sichern/Laden

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
      showToast('✅ Verbunden — auf dem Server liegt bereits ein Stand. „Vom Server laden" holt ihn.');
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

  const copyCorsText = async () => {
    const text = corsRequestText(davCfg ?? (davUrl.trim() ? { url: davUrl.trim(), user: '', secret: '', auto: false } : null));
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 Text für die IT kopiert — er enthält keine Zugangsdaten.');
    } catch {
      // Zwischenablage verweigert (Safari ohne Nutzergeste o. Ä.) → als Mail öffnen
      const [subject, ...rest] = text.split('\n');
      location.href = `mailto:?subject=${encodeURIComponent(subject.replace(/^Betreff:\s*/, ''))}&body=${encodeURIComponent(rest.join('\n').trim())}`;
    }
  };

  // ---- M190: Sync über die Dateien-App (iPad/iPhone & jeder Browser ohne Ordner-API) ----
  const filesSave = () => doExport(async () => {
    try {
      const way = await saveViaFiles();
      setFilesTick((n) => n + 1);
      showToast(way === 'geteilt'
        ? '☁️ Teilen-Blatt geöffnet — „In Dateien sichern" → den Nextcloud-Ordner wählen und die vorhandene pixinotes-daten.json ersetzen.'
        : '💾 pixinotes-daten.json gespeichert — in den Nextcloud-Ordner legen (vorhandene Datei ersetzen).', false, 9000);
    } catch (e) {
      if ((e as Error).message === 'abgebrochen') { showToast('Nicht gesichert — Vorgang abgebrochen.'); return; }
      throw e;
    }
  }, 'filessave');

  const filesLoad = async (file: File) => {
    const p = await readSyncFile(file);
    if (!p) { showToast('Das ist keine gültige pixinotes-daten.json.'); return; }
    if (!window.confirm(`Stand vom ${new Date(p.savedAt).toLocaleString('de-DE')} laden? Die aktuellen Boards werden ersetzt (Strg+Z geht danach nicht zurück).`)) return;
    if (!applyFilesSync(p)) { showToast(QUOTA_IMPORT_MSG); return; }
    setFilesTick((n) => n + 1);
    showToast('⬇️ Stand aus der Dateien-App geladen.');
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

  // ---- Team-Sync (M145): einzelne Projekte in eigene Sync-Ordner ----
  const psConnect = (projectId: string, projectName: string) => doExport(async () => {
    const res = await connectProjectSync(projectId);
    setPsMeta(projectSyncMeta());
    if (res.state === 'vorhanden') {
      showToast(`Im Ordner „${res.folder}" liegt bereits ein Stand von „${projectName}" — unten „Vom Ordner laden" holt ihn, „Jetzt speichern" überschreibt ihn.`);
    } else {
      showToast(`☁️ „${projectName}" wird jetzt nach „${res.folder}" gespiegelt — Team-Mitglieder per Einladung dazuholen.`);
    }
  }, `psc-${projectId}`);

  const psSave = (projectId: string) => doExport(async () => {
    const stamp = await writeProjectSync(projectId);
    showToast(`☁️ Projekt in den Team-Ordner gespeichert (${new Date(stamp).toLocaleTimeString('de-DE')}).`);
  }, `pss-${projectId}`);

  const psLoad = (projectId: string, projectName: string) => doExport(async () => {
    const handle = await projectHandle(projectId);
    if (!handle || !(await ensurePermission(handle, true))) return;
    const p = await readProjectFile(handle, projectId);
    if (!p) { showToast('Im Team-Ordner liegt (noch) kein Paket dieses Projekts.'); return; }
    if (!window.confirm(`Team-Stand von „${projectName}" vom ${new Date(p.savedAt).toLocaleString('de-DE')} laden? Ersetzt die Boards dieses Projekts (andere Projekte bleiben unberührt).`)) return;
    setOpen(true, 'sync'); // Import remountet die App — Reiter beibehalten
    if (!applyProjectPayload(p)) { showToast(QUOTA_IMPORT_MSG); return; }
    showToast(`☁️ Team-Projekt „${p.project.name}" geladen.`);
  }, `psl-${projectId}`);

  const psOff = (projectId: string) => doExport(async () => {
    await disconnectProjectSync(projectId);
    setPsMeta(projectSyncMeta());
    showToast('Team-Ordner getrennt — das Projekt bleibt lokal erhalten.');
  }, `pso-${projectId}`);

  const psJoin = () => doExport(async () => {
    const res = await joinProjectFolder();
    // Der Import remountet die App (importEpoch) — ohne Wunsch-Reiter landete
    // man danach wieder auf „KI" statt in der Synchronisation
    setOpen(true, 'sync');
    setPsMeta(projectSyncMeta());
    if (!res.persisted) { showToast(QUOTA_IMPORT_MSG); return; }
    showToast(`✅ Beigetreten: ${res.names.map((n) => `„${n}"`).join(', ')} aus Ordner „${res.folder}" — Abgleich läuft ab jetzt automatisch.`);
  }, 'psjoin');

  const psInvite = (projectId: string, projectName: string) => {
    const folder = psMeta[projectId]?.folder ?? 'Team-Ordner';
    window.location.href = buildInviteMailto(projectName, folder);
  };

  const psCopyInvite = (projectId: string, projectName: string) => {
    const folder = psMeta[projectId]?.folder ?? 'Team-Ordner';
    navigator.clipboard?.writeText(buildInviteText(projectName, folder))
      .then(() => showToast('Einladungstext kopiert — nur noch den Freigabe-Link des Ordners einfügen.'))
      .catch(() => showToast('Kopieren nicht möglich — bitte „Einladung per E-Mail" nutzen.'));
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
          {([['ki', 'KI'], ['sync', 'Synchronisation'], ['kalender', 'Kalender'], ['daten', 'Daten'], ['export', 'Export'], ['design', 'Design']] as const).map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {/* ---- KI ---- */}
        {tab === 'ki' && (
        <section className="modal-section">
          <h3>KI-Assistent</h3>
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

        {/* ---- M204: Gehirn — semantischer Index ---- */}
        {tab === 'ki' && (
        <section className="modal-section">
          <h3>🧠 Gehirn (semantischer Index)</h3>
          <p className="modal-hint">
            Das Gehirn übersetzt jede Karte in einen Bedeutungs-Vektor (Embedding). Damit findet
            die Suche (Strg+K) auch <b>nach Bedeutung</b> („Kita" findet „Betreuungszeiten") und
            das Backlinks-Panel zeigt <b>verwandte Karten</b> aus anderen Boards.
            Mit <b>Ollama</b> bleibt alles lokal; <b>„Im Browser"</b> lädt einmalig ein kleines
            Modell (~30&nbsp;MB, danach offline) — der Weg für iPhone/iPad.
          </p>
          <label className="modal-row">
            <span>Gehirn</span>
            <select
              value={brain.on ? 'an' : 'aus'}
              onChange={(e) => {
                updateBrain({ on: e.target.value === 'an' });
                if (e.target.value === 'an') setTimeout(() => void syncBrainIndex(), 300);
              }}
            >
              <option value="aus">— aus —</option>
              <option value="an">an (Index aufbauen &amp; aktuell halten)</option>
            </select>
          </label>
          {brain.on && (
            <>
              {/* M220: Sub-Brains — Bereiche einzeln aus dem Gehirn nehmen */}
              <div className="brain-scope">
                <div className="brain-scope-head">Welche Bereiche gehören zum Gehirn?</div>
                {spaces.map((sp) => {
                  const an = !brainOffSpaces.includes(sp.id);
                  const karten = sp.projects
                    .flatMap((p) => p.boardIds)
                    .reduce((n, id) => n + (boards.find((b) => b.id === id)?.nodes.length ?? 0), 0);
                  return (
                    <label key={sp.id} className={`brain-scope-row ${an ? '' : 'off'}`}>
                      <input type="checkbox" checked={an} onChange={() => toggleBrainSpace(sp.id)} />
                      <span className="brain-scope-name">{sp.name}</span>
                      <span className="brain-scope-count">{karten} Karten</span>
                    </label>
                  );
                })}
                <p className="modal-hint">
                  Abgeschaltete Bereiche liefern <b>nichts</b> ans Gehirn: keine Bedeutungssuche,
                  keine Vorschläge, keine KI-Antworten, kein Puls. Ihre bereits berechneten
                  Vektoren werden dabei <b>gelöscht</b> — nicht bloß ausgeblendet. Praktisch, um
                  Privates aus dienstlichen Antworten herauszuhalten.
                </p>
              </div>
              <label className="modal-row">
                <span>Anbieter</span>
                <select value={brain.provider} onChange={(e) => updateBrain({ provider: e.target.value as typeof brain.provider })}>
                  <option value="auto">Automatisch (folgt der KI-Einstellung)</option>
                  <option value="ollama">Ollama (lokal — nomic-embed-text)</option>
                  <option value="browser">Im Browser (Transformers.js, einmaliger Download)</option>
                  <option value="cloud">Cloud (OpenAI/OpenRouter-Schlüssel)</option>
                </select>
              </label>
              <div className="modal-hint">
                {brainInfo.busy
                  ? `⏳ Indexiere … (${brainInfo.indexed} Karten fertig)`
                  : brainInfo.error
                    ? `⚠️ ${brainInfo.error}`
                    : `✅ ${brainInfo.indexed} Karten im Index · Anbieter: ${brainInfo.provider === 'ollama' ? 'Ollama (lokal)' : brainInfo.provider === 'browser' ? 'im Browser' : 'Cloud'}`}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => void rebuildBrainIndex()}>Index neu aufbauen</button>
              </div>
              <p className="modal-hint">
                Beim Anbieterwechsel bitte „Index neu aufbauen" — Vektoren verschiedener Modelle
                sind nicht vergleichbar. Der Index bleibt lokal in diesem Browser (IndexedDB) und
                ist nie Teil von Sync, Export oder Teilen-Links.
              </p>
            </>
          )}
        </section>
        )}

        {/* ---- Synchronisation (Nextcloud & Co.) ---- */}
        {tab === 'sync' && (
        <>
        <section className="modal-section">
          <h3>Synchronisation (Nextcloud, OneDrive, Dropbox …)</h3>
          <p className="modal-hint">
            {syncSupported()
              ? <>Verbinde einen Ordner, den dein <b>Nextcloud-/OneDrive-/Dropbox-Client</b> synchronisiert — PixiNotes speichert dort automatisch eine <code>pixinotes-daten.json</code> mit allen Boards. Der Cloud-Client bringt sie auf deine anderen Geräte; dort einfach denselben Ordner verbinden. Kein Server-Setup, KI-Schlüssel bleiben lokal.</>
              : isAppleTouch()
                ? <><b>Auf iPad und iPhone gibt es keine Ordner-Anbindung.</b> Apple erlaubt keinem Browser (auch nicht Chrome oder Firefox — auf iOS steckt in allen WebKit), dass eine Webseite auf einen Ordner zugreift. Das ist keine Einstellung, die man umlegen kann. <b>Nimm stattdessen den Weg über die Dateien-App</b> — direkt hier darunter. Er schreibt genau dieselbe Datei in denselben Nextcloud-Ordner, den dein Rechner automatisch synchronisiert.</>
                : <>Dieser Browser unterstützt keine Ordner-Anbindung (Chrome/Edge können das). <b>Alternative:</b> der Weg über die Dateien-Auswahl direkt darunter — gleiche Datei, gleicher Ordner, nur mit einem bewussten Klick statt automatisch.</>}
          </p>
          {syncSupported() && (
            <>
              <div className="modal-buttons">
                {!syncHandle ? (
                  <button disabled={!!busy} onClick={() => doExport(connectSync, 'sync')}>
                    {busy === 'sync' ? '…' : 'Sync-Ordner verbinden…'}
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
                      {busy === 'syncsave' ? '…' : 'Jetzt speichern'}
                    </button>
                    <button disabled={!!busy} onClick={() => doExport(loadFromSync, 'syncload')}>
                      {busy === 'syncload' ? '…' : 'Vom Ordner laden'}
                    </button>
                    <button disabled={!!busy} onClick={() => doExport(async () => {
                      await disconnectSync();
                      setSyncHandle(null);
                      showToast('Sync-Ordner getrennt — Daten bleiben lokal erhalten.');
                    }, 'syncoff')}>
                      {busy === 'syncoff' ? '…' : 'Trennen'}
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

        {/* ---- M190: Sync über die Dateien-App — der Weg, der auf iPad/iPhone geht ---- */}
        {!syncSupported() && (
        <section className="modal-section" key={filesTick}>
          <h3>{isAppleTouch() ? 'Synchronisation über die Dateien-App (iPad/iPhone)' : 'Synchronisation über die Dateiauswahl'}</h3>
          <p className="modal-hint">
            PixiNotes schreibt hier <b>exakt dieselbe <code>pixinotes-daten.json</code></b> wie der
            Sync-Ordner am Rechner. Legst du sie in <b>denselben Nextcloud-Ordner</b>, übernimmt dein
            Rechner den Stand automatisch — und umgekehrt holst du dir hier, was der Rechner
            geschrieben hat. Es ist also echte Zwei-Wege-Synchronisation, auf dem Tablet eben
            <b> mit einem bewussten Tipp</b> statt im Hintergrund. Zugangsdaten und KI-Schlüssel sind
            wie immer nicht enthalten.
          </p>
          {isAppleTouch() && (
            <div className="modal-note">
              <b>Einmalig einrichten:</b> die <b>Nextcloud-App</b> aus dem App Store installieren und
              anmelden — danach erscheint deine Nextcloud in der <b>Dateien-App</b> als Speicherort.
              Beim Sichern wählst du dort deinen PixiNotes-Ordner und ersetzt die vorhandene Datei.
            </div>
          )}
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={filesSave}>
              {busy === 'filessave' ? '…' : canShareFiles() ? 'Stand sichern → Dateien-App' : 'Stand sichern (Datei)'}
            </button>
            <button disabled={!!busy} onClick={() => filesSyncRef.current?.click()}>Stand laden…</button>
            <input
              ref={filesSyncRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void filesLoad(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="modal-note">
            {filesSyncDirty()
              ? <>⚠️ <b>Es gibt Änderungen, die noch nirgends gesichert sind.</b>{filesSyncStamp() ? ` Zuletzt gesichert: ${new Date(filesSyncStamp()!).toLocaleString('de-DE')}.` : ''} Die Wolke oben in der Kopfleiste erinnert dich daran — ein Tipp darauf sichert sofort.</>
              : filesSyncStamp()
                ? <>✅ Gesichert am {new Date(filesSyncStamp()!).toLocaleString('de-DE')} — seitdem keine Änderungen.</>
                : <>Noch nichts gesichert. <b>Tipp:</b> Nach jeder längeren Arbeitseinheit einmal sichern — der Browser-Speicher allein ist kein Backup.</>}
          </div>
          {isAppleTouch() && !isStandalone() && (
            <div className="modal-note">
              💡 <b>Wichtig auf dem iPad:</b> Safari löscht die Daten von Webseiten, die man 7 Tage
              nicht benutzt. Leg PixiNotes über <b>Teilen → „Zum Home-Bildschirm"</b> auf den
              Startbildschirm — dann gilt diese Löschregel nicht mehr. Zusätzlich regelmäßig oben
              sichern.
            </div>
          )}
        </section>
        )}

        <section className="modal-section">
          <h3>Team-Sync — einzelne Projekte teilen</h3>
          <p className="modal-hint">
            Jedes <b>Projekt</b> kann in einen <b>eigenen</b> Sync-Ordner gespiegelt werden — so arbeitest
            du mit mehreren Teams in einer Umgebung, ohne alles preiszugeben: Pro Team eine Ordner-Freigabe
            (z. B. Nextcloud „Teilen"), PixiNotes legt dort ein Projekt-Paket ab und gleicht es automatisch ab.
            <b> Wer mitarbeiten darf, regelt allein die Ordner-Freigabe</b> — Einladungen enthalten keine
            Passwörter, und KI-Schlüssel/Zugangsdaten landen nie im Paket.
          </p>
          {syncSupported() ? (
            <>
              <div className="modal-buttons">
                <button disabled={!!busy} onClick={psJoin} title="Einen freigegebenen Team-Ordner wählen — das darin liegende Projekt wird übernommen und ab dann automatisch abgeglichen">
                  {busy === 'psjoin' ? '…' : 'Projekt beitreten…'}
                </button>
              </div>
              <div className="psync-list">
                {spaces.flatMap((sp) => sp.projects.map((p) => (
                  <div className="psync-row" key={p.id}>
                    <span className="psync-name" title={`${sp.name} › ${p.name}`}>{sp.name} › <b>{p.name}</b></span>
                    {psMeta[p.id] ? (
                      <>
                        <span className="psync-status">☁ „{psMeta[p.id].folder}"{projectStamp(p.id) ? ` · ${new Date(projectStamp(p.id)!).toLocaleString('de-DE')}` : ''}</span>
                        <span className="psync-actions">
                          <button disabled={!!busy} onClick={() => psSave(p.id)}>{busy === `pss-${p.id}` ? '…' : 'Jetzt speichern'}</button>
                          <button disabled={!!busy} onClick={() => psLoad(p.id, p.name)}>{busy === `psl-${p.id}` ? '…' : 'Vom Ordner laden'}</button>
                          <button onClick={() => psInvite(p.id, p.name)} title="Öffnet eine E-Mail mit Beitritts-Anleitung — den Freigabe-Link zum Ordner fügst du selbst ein; Passwörter sind nie enthalten">Einladen…</button>
                          <button onClick={() => psCopyInvite(p.id, p.name)} title="Einladungstext in die Zwischenablage kopieren">Text kopieren</button>
                          <button disabled={!!busy} onClick={() => psOff(p.id)}>{busy === `pso-${p.id}` ? '…' : 'Trennen'}</button>
                        </span>
                      </>
                    ) : (
                      <span className="psync-actions">
                        <button disabled={!!busy} onClick={() => psConnect(p.id, p.name)}>
                          {busy === `psc-${p.id}` ? '…' : 'Mit Team-Ordner verbinden…'}
                        </button>
                      </span>
                    )}
                  </div>
                )))}
              </div>
              <div className="modal-note">
                So funktioniert die Einladung: Ordner im Cloud-Speicher fürs Team freigeben (dort werden
                die Rechte verwaltet) → „Einladen…" verschickt die Anleitung → die Person tritt über
                „Projekt beitreten…" bei. Der globale Sync-Ordner oben sichert weiterhin deine GESAMTE
                Umgebung — beide ergänzen sich.
              </div>
            </>
          ) : (
            <p className="modal-hint">
              {isAppleTouch()
                ? <>Der Team-Sync braucht einen Ordner-Zugriff, den iPadOS/iOS keiner Webseite erlaubt. <b>Am iPad geht das projektweise Teilen daher nicht</b> — deine gesamte Umgebung kannst du aber über die Dateien-App oben sichern und abgleichen. Für Team-Projekte einen Rechner mit Chrome oder Edge nutzen.</>
                : <>Dieser Browser unterstützt keine Ordner-Anbindung (Chrome/Edge können das). Deine gesamte Umgebung lässt sich trotzdem über die Dateiauswahl oben abgleichen.</>}
            </p>
          )}
        </section>

        <section className="modal-section">
          <h3>WebDAV direkt (Nextcloud, ownCloud …)</h3>
          <p className="modal-hint">
            Ohne Desktop-Client: PixiNotes spricht direkt mit dem WebDAV-Server — funktioniert auch am
            Tablet/Handy. Bei Nextcloud: <b>App-Passwort</b> unter Einstellungen → Sicherheit anlegen
            (nie das echte Passwort). <b>Zugangsdaten bleiben lokal</b> und landen in keinem Export.
          </p>
          <details className="modal-details">
            <summary>⚠️ Wird blockiert? Das liegt am Server (CORS) — so wird es freigegeben</summary>
            <p className="modal-hint">
              Nextcloud erlaubt Browser-Zugriffe auf <code>/remote.php/dav</code> standardmäßig
              nicht. <b>Das betrifft jeden Browser und jedes Gerät gleich</b> — es ist keine
              iPad-Eigenheit und lässt sich auch nicht in der App umgehen: Die Freigabe muss vom
              Server kommen, sonst bricht der Browser schon vor der Anmeldung ab.
              Am schnellsten geht es mit der Nextcloud-App <b>„WebAppPassword"</b>, in der eure IT
              diese Herkunft einträgt: <code>{location.origin}</code>
            </p>
            <div className="modal-buttons">
              <button onClick={() => void copyCorsText()}>Fertigen Text für die IT kopieren</button>
            </div>
            <div className="modal-note">
              Der Text erklärt die benötigten Header und enthält <b>keine Zugangsdaten</b> —
              Benutzername und App-Passwort bleiben hier. Bis zur Freigabe:{' '}
              {isAppleTouch() ? 'auf dem iPad der Weg über die Dateien-App weiter oben' : 'der Sync-Ordner weiter oben'}.
            </div>
          </details>
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
                  {busy === 'dav' ? '…' : 'Verbinden & testen'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="modal-buttons">
                <button disabled={!!busy} onClick={davPush}>{busy === 'davpush' ? '…' : 'Jetzt hochladen'}</button>
                <button disabled={!!busy} onClick={davPull}>{busy === 'davpull' ? '…' : 'Vom Server laden'}</button>
                <button disabled={!!busy} onClick={davDisconnect}>Trennen</button>
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
          <h3>Kalender-Konten</h3>
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
        <OneNoteImport onClose={() => setOpen(false)} />

        <section className="modal-section">
          <h3>Word-Dokumente (.docx)</h3>
          <p className="modal-hint">
            Ein Word-Dokument einfach <b>aufs Board ziehen</b> (oder über ＋ → „Datei einfügen"
            auswählen) — Überschriften, Listen, Tabellen und Bilder werden zu einer Notiz-Karte.
            Ohne Konto und ohne Internet. <b>Auch der Weg für OneNote ohne Microsoft-Anmeldung:</b>{' '}
            in OneNote „Datei → Exportieren → Word", dann die Datei hier ablegen.
          </p>
        </section>

        <section className="modal-section">
          <h3>Starter-Umgebung „Arbeit & Privat"</h3>
          <p className="modal-hint">
            Beispiel-Struktur mit <b>4 Bereichen, 9 Projekten und 18 Boards</b>: Verwaltungsalltag
            (Schreibtisch, Aufgaben-Zentrale, Zeiterfassung mit echter Erfassungs-Karte, Dienstplan,
            Dienstreise, Wissensbasis, Datenschutz, Jour fixe, Beispielprojekt mit Rahmen, Eigene Apps
            &amp; Dateien) <b>plus 🏡 Privat</b> (Familienplan, Einkauf &amp; Erledigungen, Routinen &amp;
            Ziele, Verträge &amp; Fristen). Erklärt nebenbei jedes Modul — alles ist Beispielinhalt und
            frei anpassbar/löschbar.
          </p>
          <div className="modal-buttons">
            <button
              onClick={() => {
                useBoard.getState().addStarter();
                setOpen(false);
              }}
            >
              Starter-Umgebung hinzufügen
            </button>
          </div>
        </section>

        <section className="modal-section">
          <h3>Als Datei sichern &amp; übertragen</h3>
          <p className="modal-hint">
            Der einfachste Weg ohne Cloud: kompletten Stand als <code>.json</code>-Datei exportieren und
            auf dem anderen Gerät laden — per USB-Stick, Mail-Anhang oder Netzlaufwerk.
            Funktioniert in <b>jedem Browser</b>.
          </p>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={exportStateFile}>Datei exportieren</button>
            <button disabled={!!busy} onClick={() => fileInputRef.current?.click()}>Datei laden…</button>
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
          <h3>Alles leeren &amp; neu starten</h3>
          <p className="modal-hint">
            Löscht <b>alle</b> Bereiche, Projekte, Boards, Karten, Versionen und Vorlagen und startet mit
            einem leeren Board. Kein Rückgängig! KI-Einstellungen bleiben erhalten; ein verbundener
            Sync-Ordner wird vorher getrennt (seine Dateien bleiben unangetastet).
            <b> Tipp:</b> vorher oben „Datei exportieren".
          </p>
          <div className="modal-buttons">
            <button className="danger" disabled={!!busy} onClick={() => void resetEverything()}>
              Alles leeren…
            </button>
          </div>
        </section>
        </>
        )}

        {/* ---- Datenordner & Export ---- */}
        {tab === 'export' && (
        <section className="modal-section">
          <h3>Datenordner &amp; Export</h3>
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
              {busy === 'folder' ? '…' : hasFolderApi ? 'Ordner wählen & speichern' : 'Als Markdown exportieren'}
            </button>
          </div>
          <h3 style={{ marginTop: 14 }}>Bild-Export (aktuelles Board)</h3>
          <p className="modal-hint">
            Automatisch auf den Inhalt zugeschnitten — keine leere Riesenfläche mehr. PDF: öffnet den
            Druckdialog, dort {'„Als PDF speichern"'} wählen.
          </p>
          <div className="modal-row export-opts">
            <label>Format{' '}
              <select value={expFormat} onChange={(e) => setExpFormat(e.target.value as typeof expFormat)}>
                <option value="png">PNG</option>
                <option value="svg">SVG (Vektor)</option>
                <option value="print">PDF (Druckdialog)</option>
              </select>
            </label>
            <label>Auflösung{' '}
              <select value={expScale} onChange={(e) => setExpScale(Number(e.target.value))} disabled={expFormat === 'svg'}>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={3}>3× (Druck)</option>
              </select>
            </label>
            <label>Hintergrund{' '}
              <select value={expBg} onChange={(e) => setExpBg(e.target.value as typeof expBg)}>
                <option value="beige">Beige (wie Board)</option>
                <option value="white">Weiß</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
          </div>
          <div className="modal-row export-opts">
            <label className="modal-row-check">
              <input type="checkbox" checked={expHeader} onChange={(e) => setExpHeader(e.target.checked)} />
              {' '}Kopfzeile (Board-Name + Datum)
            </label>
            <label className="modal-row-check">
              <input type="checkbox" checked={expSelOnly} onChange={(e) => setExpSelOnly(e.target.checked)} />
              {' '}Nur ausgewählte Karten
            </label>
          </div>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={() => doExport(async () => {
              const nodes = activeBoard.nodes.filter((n) => !n.archived && (!expSelOnly || n.selected));
              await exportBoard({
                format: expFormat, name: activeBoard.name, nodes,
                scale: expScale, background: expBg, header: expHeader,
              });
              showToast(expFormat === 'print' ? '🖨️ Druckdialog geöffnet — dort „Als PDF speichern"' : '⬇️ Export erstellt');
            }, 'img')}>
              {busy === 'img' ? '…' : 'Exportieren'}
            </button>
          </div>
        </section>
        )}

        {/* ---- Design: Hell/Dunkel + Akzentfarbe ---- */}
        {tab === 'design' && (
        <section className="modal-section">
          <h3>Design</h3>
          <p className="modal-hint">
            Erscheinungsbild und Akzentfarbe gelten sofort und werden lokal gespeichert.
            „System" folgt automatisch der Hell/Dunkel-Einstellung deines Geräts.
            Haftnotizen und Formen bleiben bewusst helles „Papier" — auch im dunklen Design.
          </p>
          <label className="modal-row">
            <span>Erscheinungsbild</span>
            <select value={ui.theme} onChange={(e) => setUiTheme(e.target.value as 'system' | 'light' | 'dark')}>
              <option value="system">System</option>
              <option value="light">Hell</option>
              <option value="dark">Dunkel</option>
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

          {/* ---- M224: Sehen & Bedienen ---- */}
          <h3 style={{ marginTop: 16 }}>Sehen &amp; Bedienen</h3>
          <p className="modal-hint">
            Für Augen, die nicht mehr die besten sind — und für alle, die ohne Brille
            arbeiten. Die Einstellungen gelten für die ganze App und bleiben gespeichert.
          </p>
          <div className="modal-row">
            <span>Anzeigegröße</span>
            <div className="seg">
              {([[1, '100 %'], [1.15, '115 %'], [1.3, '130 %'], [1.5, '150 %'], [1.75, '175 %']] as const).map(([z, label]) => (
                <button
                  key={z}
                  className={Math.abs(anzeige - z) < 0.02 ? 'on' : ''}
                  onClick={() => setAnzeige(z)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="modal-hint">
            Vergrößert <b>alles</b> — Schrift, Knöpfe, Abstände und die Karteninhalte.
            Bewusst nicht nur die Schrift: Wer Text schlecht liest, trifft auch kleine
            Knöpfe schlecht. Schneller erreichbar ist das über <b>A− / A+</b> im
            PixiNotes-Menü oben links.
          </p>
          <label className="modal-row modal-row-check">
            <span>Gut lesbare Schrift</span>
            <input type="checkbox" checked={lesbareSchrift} onChange={(e) => setLesbareSchrift(e.target.checked)} />
          </label>
          <p className="modal-hint">
            Stellt die ganze App auf <b>Atkinson Hyperlegible</b> um — eigens dafür
            entworfen, dass sich ähnliche Zeichen (I l 1, O 0, a o) auch bei Sehschwäche
            unterscheiden lassen. Karten mit eigener Schriftwahl behalten ihre.
          </p>
          <label className="modal-row modal-row-check">
            <span>Mehr Kontrast</span>
            <input type="checkbox" checked={hoherKontrast} onChange={(e) => setHoherKontrast(e.target.checked)} />
          </label>
          <p className="modal-hint">
            Kräftigere Schrift und Ränder, kein Milchglas, keine Papiertextur, deutlicher
            Fokusrahmen. Genau die Effekte, die modern aussehen, kosten Kontrast — hier
            lassen sie sich abschalten, ohne dass alle darauf verzichten müssen.
          </p>

          <h3 style={{ marginTop: 16 }}>Bedienung</h3>
          <label className="modal-row modal-row-check">
            <span>Karte im Fokus</span>
            <input type="checkbox" checked={cardFocus} onChange={(e) => setCardFocus(e.target.checked)} />
          </label>
          <p className="modal-hint">
            Ein Klick auf eine Karte öffnet sie groß — mit Kopfzeile, Blättern und allen
            Karten-Werkzeugen. Am <b>Handy</b> formatfüllend, ab <b>Tablet-Breite</b> als
            Blatt über dem Board, das abgedunkelt sichtbar bleibt. Wischen (oder ‹ ›)
            wechselt die Karte, Wischen nach unten, Esc oder die Zurück-Taste führen
            zurück; die Karte fliegt dabei an ihren Platz und wird ganz ins Bild gerückt.
            <b> Abgeschaltet</b> gilt wieder der alte Klick-Zoom (unten einstellbar).
          </p>
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
