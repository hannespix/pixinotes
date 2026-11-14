import { useEffect, useRef, useState } from 'react';
import { brainStatus, rebuildBrainIndex, syncBrainIndex } from '../lib/brain';
import { claimWriter, flushPersist, useBoard } from '../store';
import {
  connectGoogle, connectMicrosoft, disconnect as disconnectCalAccount,
  invalidateAccountEvents, loadCalAccounts, msHasNotes, oauthAvailable, patchCalAccounts, type CalAccounts,
} from '../lib/calAccounts';
import { exportToFolder } from '../lib/exporter';
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
  applyKonto, bekannteClientId, bekannterTenant, kontoAbmelden, kontoAnmelden, kontoAnmeldenSupabase, kontoDateiMaxMb, kontoIstEigenes, kontoLabel, kontoLesen, kontoLiveVerbunden, kontoLoeschen, kontoStamp,
  kontoVerbinden, kontoWrite, loadKonto, type Anbieter, type KontoSitzung, type VerbindenErgebnis,
} from '../lib/kontoSync';
import { sbLinkSenden, sbPasswortAnmelden, sbRegistrieren, supabaseKonfig, supabaseKonfigSpeichern, supabaseKonfiguriert, type SbSitzung } from '../lib/kontoSupabase';
import { browserErkenntHandschrift } from '../lib/handschrift';
import { aiReady } from '../lib/ai';
import {
  applyFilesSync, canShareFiles, filesSyncDirty, filesSyncOn, filesSyncStamp, isAppleTouch,
  isStandalone, readSyncFile, saveViaFiles,
} from '../lib/filesSync';
import {
  applyProjectPayload, buildInviteMailto, buildInviteText, connectProjectSync, disconnectProjectSync,
  joinProjectFolder, projectHandle, projectStamp, projectSyncMeta, readProjectFile, writeProjectSync,
} from '../lib/projectSync';
import {
  EINBETTUNGS_VORSCHLAEGE, VORSCHLAEGE, befrageServer, erlaubnisHilfe,
  istEinbettungsModell, zeigeGroesse, type Lage, type OllamaModell,
} from '../lib/ollama';

const MODELS: Record<string, string[]> = {
  free: ['openai'], // anonym gibt es bei Pollinations aktuell nur dieses Modell
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen3-235b-a22b:free',
  ],
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  // M257: Für Ollama und eigene Server steht hier NICHTS mehr — welche Modelle
  // es gibt, weiß nur der Server selbst (lib/ollama.ts fragt ihn).
  ollama: [],
  custom: [],
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

type Reiter = 'design' | 'daten' | 'dienste';
/** M300/M314: Drei Reiter — Darstellung zuerst, weil es jeder braucht; Daten
 *  (Sichern, Synchronisation, Import/Export) in der Mitte; Dienste zuletzt,
 *  weil KI, Gehirn und Konten Einrichtungssache sind. */
const TABS: ReadonlyArray<readonly [Reiter, string]> = [
  ['design', 'Darstellung'], ['daten', 'Daten'], ['dienste', 'Dienste'],
];
/** Alte Reiter-Namen aus Verweisen (Toasts, Menüs, Karten) landen im passenden neuen Reiter */
const ALT_REITER: Record<string, Reiter> = { ki: 'dienste', kalender: 'dienste', export: 'daten', sync: 'daten', konto: 'daten' };
type SyncWeg = 'konto' | 'ordner' | 'webdav' | 'datei';

/**
 * Einstellungen: Design, Daten, Synchronisation, Dienste (KI, Gehirn, Konten).
 * Bewusst schlicht — läuft auch aus der Single-HTML.
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
  /* M257: Was der lokale Server WIRKLICH kann — Liste, Ladezustand, Fehler */
  const [lokal, setLokal] = useState<OllamaModell[]>([]);
  const [lokalLaedt, setLokalLaedt] = useState(false);
  const [lokalFehler, setLokalFehler] = useState('');
  /* M258: nicht nur DASS es scheiterte, sondern WORAN */
  const [lokalLage, setLokalLage] = useState<Lage | 'leer' | ''>('');
  const [lokalGeprueft, setLokalGeprueft] = useState('');
  useEffect(() => {
    const on = () => setBrainInfo(brainStatus());
    window.addEventListener('pixinotes:brain', on);
    const t = setInterval(on, 2000);
    return () => { window.removeEventListener('pixinotes:brain', on); clearInterval(t); };
  }, []);
  const spaces = useBoard((s) => s.spaces);
  const boards = useBoard((s) => s.boards);
  const showToast = useBoard((s) => s.showToast);
  const [busy, setBusy] = useState('');
  const [syncHandle, setSyncHandle] = useState<SyncDirHandle | null>(null);
  const [syncPerm, setSyncPerm] = useState<'granted' | 'prompt'>('granted');
  // Team-Sync (M145): welche Projekte hängen an welchem Ordner (nur Namen, keine Geheimnisse)
  const [psMeta, setPsMeta] = useState<Record<string, { folder: string }>>({});
  useEffect(() => { if (open) setPsMeta(projectSyncMeta()); }, [open]);


  const [tab, setTab] = useState<Reiter>('design');
  // M300: Ein Sync-Weg zur Zeit — Ordner (Cloud-Client), WebDAV (Server) oder Datei (Dateien-App)
  const [syncWeg, setSyncWeg] = useState<SyncWeg>('ordner');
  const wegManuell = useRef(false);
  const waehleWeg = (w: SyncWeg) => { wegManuell.current = true; setSyncWeg(w); };
  // Team-Sync: welches Projekt als Nächstes verbunden wird
  const [psPick, setPsPick] = useState('');
  // Microsoft: beim Verbinden gleich den OneNote-Lesezugriff mitnehmen?
  const [msMitNotes, setMsMitNotes] = useState(false);

  /**
   * M257: Modelle beim lokalen Server erfragen.
   *
   * Der Server ist die einzige verlässliche Quelle — eine Liste im Quelltext
   * veraltet in dem Moment, in dem jemand `ollama pull` tippt.
   */
  const ladeLokaleModelle = async (still = false) => {
    const url = ai.baseUrl?.trim();
    if (!url) { setLokalFehler('Erst die Server-URL eintragen.'); return; }
    setLokalLaedt(true);
    if (!still) { setLokalFehler(''); setLokalLage(''); }
    try {
      const b = await befrageServer(url, ai.provider === 'ollama' ? 'ollama' : 'openai', ai.apiKey);
      setLokal(b.modelle);
      setLokalLage(b.lage === 'ok' && b.modelle.length === 0 ? 'leer' : b.lage);
      setLokalFehler(b.lage === 'fehler' ? (b.text ?? '') : '');
      // Nach dem Anbieterwechsel ist das Feld leer. Steht ein taugliches
      // Modell bereit, wird es eingetragen — eine bestehende Wahl aber nie
      // überschrieben.
      if (!ai.model?.trim()) {
        const erstes = b.modelle.find((m) => !istEinbettungsModell(m.name));
        if (erstes) updateAi({ model: erstes.name });
      }
    } finally {
      setLokalGeprueft(`${ai.provider}|${url}`);
      setLokalLaedt(false);
    }
  };

  /* Einmal automatisch nachsehen, sobald der Reiter mit passendem Anbieter
     offen ist — wer die Einstellungen öffnet, will die Liste sehen, nicht
     erst einen Knopf suchen. Danach nur noch auf Wunsch (⟳). */
  useEffect(() => {
    if (!open || tab !== 'dienste') return;
    if (ai.provider !== 'ollama' && ai.provider !== 'custom') return;
    if (!ai.baseUrl?.trim()) return;
    if (lokalGeprueft === `${ai.provider}|${ai.baseUrl.trim()}`) return;
    // Kurz abwarten: Beim Tippen der Adresse entstünde sonst pro Zeichen eine
    // Anfrage an eine halbfertige URL — samt Fehlermeldung, die schon wieder
    // überholt ist, bevor man sie gelesen hat.
    const t = setTimeout(() => void ladeLokaleModelle(true), 700);
    return () => clearTimeout(t);
    // ladeLokaleModelle hängt an denselben Werten wie die Bedingung oben
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, ai.provider, ai.baseUrl, lokalGeprueft]);
  // Direktsprung auf einen Reiter (z. B. „sync" vom Status-Chip in der Kopfleiste)
  const wantTab = useBoard((s) => s.settingsSection);
  useEffect(() => {
    if (!open || !wantTab) return;
    const ziel = ALT_REITER[wantTab] ?? (wantTab as Reiter);
    if (TABS.some(([k]) => k === ziel)) setTab(ziel);
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
  // M317: Konto-Sync (Google Drive / OneDrive) — Sitzung im eigenen localStorage-Schlüssel
  const [kontoSitz, setKontoSitz] = useState<KontoSitzung | null>(null);
  const [kontoError, setKontoError] = useState('');
  const [kontoGid, setKontoGid] = useState('');
  const [kontoMsid, setKontoMsid] = useState('');
  const [kontoTenant, setKontoTenant] = useState('common');
  // M328: Eigenes PixiNotes-Konto — E-Mail-Link oder Passwort; Backend-Konfiguration vom Betreiber
  const [kontoMail, setKontoMail] = useState('');
  const [kontoPass, setKontoPass] = useState('');
  const [kontoLinkWeg, setKontoLinkWeg] = useState(false);
  const [sbUrl, setSbUrl] = useState('');
  const [sbKey, setSbKey] = useState('');
  const anzeige = useBoard((s) => s.anzeige);
  const setAnzeige = useBoard((s) => s.setAnzeige);
  const syncDateienMb = useBoard((s) => s.syncDateienMb ?? 25);
  const setSyncDateienMb = useBoard((s) => s.setSyncDateienMb);
  const lesbareSchrift = useBoard((s) => s.lesbareSchrift);
  const setLesbareSchrift = useBoard((s) => s.setLesbareSchrift);
  const hoherKontrast = useBoard((s) => s.hoherKontrast);
  const setHoherKontrast = useBoard((s) => s.setHoherKontrast);
  const milchglas = useBoard((s) => s.milchglas);
  const setMilchglas = useBoard((s) => s.setMilchglas);
  const clickZoom = useBoard((s) => s.clickZoom);
  const stiftZeichnet = useBoard((s) => s.stiftZeichnet);
  const setStiftZeichnet = useBoard((s) => s.setStiftZeichnet);
  const setClickZoom = useBoard((s) => s.setClickZoom);
  const cardFocus = useBoard((s) => s.cardFocus);
  // M294: Bewegung auf der Fläche als Optionen — Physik, Klick-Zoom, Konfetti
  const physicsEnabled = useBoard((s) => s.physicsEnabled);
  const setPhysicsEnabled = useBoard((s) => s.setPhysicsEnabled);
  const konfetti = useBoard((s) => s.konfetti);
  const setKonfetti = useBoard((s) => s.setKonfetti);
  const fingerGesten = useBoard((s) => s.fingerGesten);
  const setFingerGesten = useBoard((s) => s.setFingerGesten);
  const brainOffSpaces = useBoard((s) => s.brainOffSpaces);
  const toggleBrainSpace = useBoard((s) => s.toggleBrainSpace);
  const setCardFocus = useBoard((s) => s.setCardFocus);
  const fokusEinKlick = useBoard((s) => s.fokusEinKlick);
  const setFokusEinKlick = useBoard((s) => s.setFokusEinKlick);
  const fokusVollbild = useBoard((s) => s.fokusVollbild);
  const setFokusVollbild = useBoard((s) => s.setFokusVollbild);
  const navLinks = useBoard((s) => s.navLinks);
  const setNavLinks = useBoard((s) => s.setNavLinks);
  const wheelZoom = useBoard((s) => s.wheelZoom);
  const handschriftOnline = useBoard((s) => s.handschriftOnline);
  const setHandschriftOnline = useBoard((s) => s.setHandschriftOnline);
  const handschriftAuto = useBoard((s) => s.handschriftAuto);
  const setHandschriftAuto = useBoard((s) => s.setHandschriftAuto);
  const handschriftKi = useBoard((s) => s.handschriftKi);
  const setHandschriftKi = useBoard((s) => s.setHandschriftKi);
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
        if (h && !wegManuell.current && !loadKonto() && !loadWebdav()) setSyncWeg('ordner');
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
    const konto = loadKonto();
    setKontoSitz(konto);
    setKontoGid(bekannteClientId('google'));
    setKontoMsid(bekannteClientId('ms'));
    setKontoTenant(bekannterTenant());
    const sb = supabaseKonfig();
    setSbUrl(sb.url); setSbKey(sb.key); setKontoLinkWeg(false);
    // Weg-Vorwahl: ein angemeldetes Konto gewinnt, dann WebDAV, sonst der Ordner (wo möglich), sonst die Datei
    wegManuell.current = false;
    // M360: Wer einer Einladung folgt, landet direkt bei der Anmeldung (Sprung „konto")
    setSyncWeg(konto || useBoard.getState().settingsSection === 'konto' ? 'konto' : dav ? 'webdav' : syncSupported() ? 'ordner' : 'datei');
  }, [open]);

  // M328: Rückkehr vom E-Mail-Link meldet an, während das Blatt vielleicht offen ist
  useEffect(() => {
    const auf = () => setKontoSitz(loadKonto());
    window.addEventListener('pixinotes:konto', auf);
    return () => window.removeEventListener('pixinotes:konto', auf);
  }, []);

  if (!open) return null;

  const refreshCalAcc = () => setCalAcc(loadCalAccounts());

  const doConnectGoogle = () => doExport(async () => {
    const name = await connectGoogle(gClientId.trim());
    refreshCalAcc();
    showToast(`✅ Google verbunden: ${name}`);
  }, 'google');

  const doConnectMs = () => doExport(async () => {
    const name = await connectMicrosoft(msClientId.trim(), msTenant.trim() || 'common', msMitNotes);
    refreshCalAcc();
    showToast(`✅ Microsoft 365 verbunden: ${name}`);
  }, 'ms');

  /** M300: OneNote nachträglich freischalten — dieselbe App-ID, ein weiteres Bestätigen */
  const doMsNotes = () => doExport(async () => {
    const acc = loadCalAccounts().ms;
    if (!acc) return;
    const name = await connectMicrosoft(acc.clientId, acc.tenant ?? 'common', true);
    refreshCalAcc();
    showToast(`✅ OneNote freigeschaltet: ${name}`);
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

  // ---- M317: Konto-Sync ----
  const doKonto = (label: string, fn: () => Promise<unknown>) => doExport(async () => {
    setKontoError('');
    try { await fn(); } catch (e) { setKontoError(String((e as Error).message)); throw e; }
  }, label);

  const kontoMeldung = (r: VerbindenErgebnis, wo: string) => {
    if (r === 'hochgeladen') showToast(`✅ Angemeldet — der aktuelle Stand liegt jetzt in ${wo}. Änderungen gleichen sich ab jetzt automatisch ab.`);
    else if (r === 'uebernommen') showToast(`✅ Angemeldet — der Stand aus ${wo} wurde übernommen.`);
    else if (r === 'zusammengefuehrt') showToast(`✅ Angemeldet — Stand mit ${wo} zusammengeführt.`);
    else if (r === 'konflikt') showToast(`In ${wo} liegt schon ein Stand und hier Eigenes. Unten „Vom Konto laden" oder „Jetzt hochladen" wählen.`, false, 9000);
    else showToast(`✅ Angemeldet bei ${wo} — alles auf dem gleichen Stand.`);
  };
  const kontoConnect = (anbieter: Anbieter) => doKonto('konto', async () => {
    const sitz = await kontoAnmelden(anbieter, anbieter === 'google' ? kontoGid : kontoMsid, kontoTenant.trim() || 'common');
    setKontoSitz(sitz);
    kontoMeldung(await kontoVerbinden(), kontoLabel(sitz));
  });
  // M328: Eigenes Konto — E-Mail-Link (kein Passwort) oder Passwort; Registrieren
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontoMail.trim());
  const kontoSbFertig = async (sitz: SbSitzung) => {
    const s = await kontoAnmeldenSupabase(sitz);
    setKontoSitz(s);
    setKontoPass('');
    kontoMeldung(await kontoVerbinden(), kontoLabel(s));
  };
  const kontoMailLink = () => doKonto('konto', async () => {
    await sbLinkSenden(kontoMail);
    setKontoLinkWeg(true);
    showToast(`✉️ Link an ${kontoMail.trim()} geschickt — ein Tipp darauf meldet dieses Gerät an.`, false, 8000);
  });
  const kontoMailPasswort = () => doKonto('konto', async () => kontoSbFertig(await sbPasswortAnmelden(kontoMail, kontoPass)));
  const kontoMailRegistrieren = () => doKonto('konto', async () => {
    const s = await sbRegistrieren(kontoMail, kontoPass);
    if (!s) { setKontoLinkWeg(true); showToast('✉️ Konto angelegt — bitte den Bestätigungs-Link aus der Mail öffnen, dann ist dieses Gerät angemeldet.', false, 9000); return; }
    await kontoSbFertig(s);
  });
  const sbKonfigSichern = () => {
    supabaseKonfigSpeichern({ url: sbUrl, key: sbKey });
    showToast(supabaseKonfiguriert() ? '✅ Konto-Backend hinterlegt — Nutzer können sich jetzt mit E-Mail anmelden.' : 'Konto-Backend entfernt.');
  };
  const kontoEigenesLoeschen = () => doKonto('kontoweg', async () => {
    if (!window.confirm('Das PixiNotes-Konto und alle dort gespeicherten Boards endgültig löschen? Die Daten auf diesem Gerät bleiben erhalten.')) return;
    await kontoLoeschen();
    setKontoSitz(null);
    showToast('Konto gelöscht — die Daten bleiben nur noch auf diesem Gerät.');
  });

  const kontoPush = () => doKonto('kontopush', async () => {
    const st = await kontoWrite();
    showToast(`⬆️ Hochgeladen (${new Date(st).toLocaleTimeString('de-DE')}).`);
  });

  const kontoPull = () => doKonto('kontopull', async () => {
    const r = await kontoLesen();
    if (!r) { showToast(`In ${kontoLabel()} liegt (noch) kein PixiNotes-Stand.`); return; }
    if (!window.confirm(`Stand vom ${new Date(r.payload.savedAt).toLocaleString('de-DE')} laden? Der lokale Stand wird ersetzt (Strg+Z geht danach nicht zurück).`)) return;
    if (!applyKonto(r.payload)) { showToast(QUOTA_IMPORT_MSG); return; }
    showToast(`⬇️ Stand aus ${kontoLabel()} geladen.`);
  });

  const kontoLogout = () => {
    kontoAbmelden();
    setKontoSitz(null);
    showToast('Abgemeldet — die Daten bleiben lokal und im Konto erhalten.');
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
      showToast(`Im Ordner liegt schon ein Stand von „${projectName}". Unten laden oder überschreiben.`);
    } else {
      showToast(`☁️ „${projectName}" wird jetzt nach „${res.folder}" gespiegelt.`);
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
    setOpen(true, 'daten'); // Import remountet die App — Reiter beibehalten
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
    setOpen(true, 'daten');
    setPsMeta(projectSyncMeta());
    if (!res.persisted) { showToast(QUOTA_IMPORT_MSG); return; }
    showToast(`✅ Beigetreten: ${res.names.map((n) => `„${n}"`).join(', ')} aus Ordner „${res.folder}" — Abgleich läuft ab jetzt automatisch.`);
  }, 'psjoin');

  /** M300: Ein Knopf statt zwei — der Text landet in der Zwischenablage UND als
   *  E-Mail-Entwurf; wer keinen Mail-Client hat, hat ihn trotzdem. */
  const psInvite = (projectId: string, projectName: string) => {
    const folder = psMeta[projectId]?.folder ?? 'Team-Ordner';
    navigator.clipboard?.writeText(buildInviteText(projectName, folder)).catch(() => {});
    window.location.href = buildInviteMailto(projectName, folder);
    showToast('Einladung kopiert und als E-Mail geöffnet — nur noch den Freigabe-Link einfügen.');
  };

  // Team-Sync: verbundene Projekte in der Liste, freie im Wähler
  const projekte = spaces.flatMap((sp) => sp.projects.map((p) => ({ sp, p })));
  const verbundene = projekte.filter(({ p }) => psMeta[p.id]);
  const freieProjekte = projekte.filter(({ p }) => !psMeta[p.id]);
  const psWahl = freieProjekte.some(({ p }) => p.id === psPick) ? psPick : (freieProjekte[0]?.p.id ?? '');

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
    if (loadKonto()) {
      kontoAbmelden();
      setKontoSitz(null);
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

        {/* M300: Vier Reiter, nach Alltagsnähe geordnet — was jeder braucht zuerst,
            angebundene Dienste zuletzt. */}
        <div className="modal-tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {/* M263: Nur DIESER Bereich läuft über — die Fensterschale bleibt
            geschlossen (overflow: hidden). Dadurch kann keine Bildlaufleiste
            mehr über die abgerundeten Ecken laufen, und Kopfzeile samt
            Reitern bleiben immer stehen. */}
        <div className="modal-body">

        {/* ---- Darstellung (M314: sechs Zeilen statt fünfzehn) ----
            Automatisch statt Option (Milchglas gibt es seit M315 gar nicht
            mehr): Navigation links (Fuß ‹), Karte im Fokus samt Öffnen-/
            Zeigen-Art (Handy: Tipp, PC: Doppelklick, Blatt), Stift zeichnet
            sofort (an). Zusammengelegt: Lesbarkeit (Schrift + Kontrast) und
            Lebendige Fläche (Physik + Klick-Zoom + Konfetti). */}
        {tab === 'design' && (
        <>
        <section className="modal-section">
          <h3>Aussehen</h3>
          <div className="modal-row">
            <span>Erscheinungsbild</span>
            <div className="seg" role="group" aria-label="Erscheinungsbild">
              {([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']] as const).map(([v, label]) => (
                <button key={v} className={ui.theme === v ? 'on' : ''} onClick={() => setUiTheme(v)}>{label}</button>
              ))}
            </div>
          </div>
          <p className="modal-hint">„System" folgt deinem Gerät. Haftnotizen bleiben auch im Dunkeln helles Papier.</p>
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
        </section>

        <section className="modal-section">
          <h3>Lesbarkeit</h3>
          <div className="modal-row">
            <span>Anzeigegröße</span>
            <div className="seg" role="group" aria-label="Anzeigegröße">
              {([[1, '100 %'], [1.15, '115 %'], [1.3, '130 %'], [1.5, '150 %'], [1.75, '175 %']] as const).map(([z, label]) => (
                <button key={z} className={Math.abs(anzeige - z) < 0.02 ? 'on' : ''} onClick={() => setAnzeige(z)}>{label}</button>
              ))}
            </div>
          </div>
          <p className="modal-hint">Vergrößert alles: Schrift, Knöpfe, Abstände und Karteninhalte.</p>
          <label className="modal-row modal-row-check">
            <span>Besser lesbar</span>
            <input
              type="checkbox"
              checked={lesbareSchrift || hoherKontrast}
              onChange={(e) => { setLesbareSchrift(e.target.checked); setHoherKontrast(e.target.checked); }}
            />
          </label>
          <p className="modal-hint">Klare Schrift (Atkinson Hyperlegible), kräftigere Ränder und Zweitschrift.</p>
        </section>

        <section className="modal-section">
          <h3>Bedienung</h3>
          <label className="modal-row modal-row-check">
            <span>Mausrad zoomt</span>
            <input type="checkbox" checked={wheelZoom} onChange={(e) => setWheelZoom(e.target.checked)} />
          </label>
          <p className="modal-hint">Aus: Rad scrollt, Zoomen mit Strg+Rad oder Pinch. An: Rad zoomt direkt.</p>
          <label className="modal-row modal-row-check">
            <span>Lebendige Fläche</span>
            <input
              type="checkbox"
              checked={physicsEnabled || clickZoom || konfetti}
              onChange={(e) => { setPhysicsEnabled(e.target.checked); setClickZoom(e.target.checked); setKonfetti(e.target.checked); }}
            />
          </label>
          <p className="modal-hint">Karten weichen aus und lassen sich werfen, die Ansicht fliegt zu angeklickten Karten, Konfetti beim Erledigen. Aus bleibt die Fläche ruhig.</p>
          {/* M326: Finger-Gesten nach Procreate */}
          <label className="modal-row modal-row-check">
            <span>Finger-Gesten (wie Procreate)</span>
            <input type="checkbox" checked={fingerGesten} onChange={(e) => setFingerGesten(e.target.checked)} data-taste="finger-gesten" />
          </label>
          <p className="modal-hint">Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen (halten = schnell), schnelles Zusammenziehen = Alles einpassen, Vier-Finger-Tipp = Vollbild, drei Finger nach unten = Duplizieren oder ＋.</p>
        </section>
        </>
        )}

        {/* ---- Daten: sichern & laden, Export, Import, Beispieldaten, leeren ---- */}
        {tab === 'daten' && (
        <>
        <section className="modal-section">
          <h3>Sichern &amp; Laden</h3>
          <p className="modal-hint">Der komplette Stand als Datei, für Backups und den Umzug auf ein anderes Gerät. Geht in jedem Browser.</p>
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

        {/* ---- Synchronisation (M314: hier statt in einem eigenen Reiter; die Dateien-Obergrenze ist fest 25 MB) ---- */}
        <section className="modal-section">
          <h3>Synchronisation</h3>
          <p className="modal-hint">Ein Weg genügt: PixiNotes legt seinen Stand dort ab und holt ihn auf dem nächsten Gerät wieder. Zugangsdaten und KI-Schlüssel bleiben lokal.</p>
          <div className="modal-row">
            <span>Weg</span>
            <div className="seg seg-weg" role="group" aria-label="Sync-Weg">
              <button className={syncWeg === 'konto' ? 'on' : ''} onClick={() => waehleWeg('konto')}>Konto{kontoSitz ? ' ✓' : ''}</button>
              {syncSupported() && (
                <button className={syncWeg === 'ordner' ? 'on' : ''} onClick={() => waehleWeg('ordner')}>Ordner{syncHandle ? ' ✓' : ''}</button>
              )}
              <button className={syncWeg === 'webdav' ? 'on' : ''} onClick={() => waehleWeg('webdav')}>WebDAV{davCfg ? ' ✓' : ''}</button>
              {!syncSupported() && (
                <button className={syncWeg === 'datei' ? 'on' : ''} onClick={() => waehleWeg('datei')}>
                  {isAppleTouch() ? 'Dateien-App' : 'Datei'}{filesSyncStamp() ? ' ✓' : ''}
                </button>
              )}
            </div>
          </div>

          {/* M317: Konto-Sync — Anmeldung mit Google oder Microsoft, Daten im App-Ordner des eigenen Drive/OneDrive */}
          {syncWeg === 'konto' && (
            <>
              <p className="modal-hint">
                {supabaseKonfiguriert()
                  ? 'Mit E-Mail anmelden — ein PixiNotes-Konto, das auf jedem Gerät geht, auch ohne Google Drive oder OneDrive. Oder mit Google bzw. Microsoft: dann liegt der Stand im App-Ordner deines eigenen Drive/OneDrive.'
                  : 'Mit Google oder Microsoft anmelden — PixiNotes legt seinen Stand im App-Ordner deines eigenen Google Drive bzw. OneDrive ab und gleicht ihn auf allen Geräten ab. Kein Server, nichts einzurichten.'}
              </p>
              {!oauthAvailable() && (
                <div className="modal-note">⚠️ Die Einzeldatei (file://) kann keine Anmeldung per Google, Microsoft oder E-Mail-Link — dafür die gehostete App nutzen. Hier bleiben E-Mail mit Passwort, Ordner, WebDAV und Datei.</div>
              )}
              {!kontoSitz ? (
                <>
                  {/* M328: Eigenes Konto — E-Mail-Link als Standard, Passwort darunter */}
                  {supabaseKonfiguriert() && (
                    <div className="konto-mail" data-taste="konto-mail">
                      <label className="modal-row">
                        <span>E-Mail</span>
                        <input type="email" autoComplete="email" placeholder="du@example.de" value={kontoMail} onChange={(e) => { setKontoMail(e.target.value); setKontoLinkWeg(false); }} data-taste="konto-email" />
                      </label>
                      <div className="modal-buttons">
                        <button disabled={!oauthAvailable() || !mailOk || busy === 'konto'} onClick={kontoMailLink} data-taste="konto-link">
                          {busy === 'konto' ? '…' : 'Anmelde-Link per E-Mail'}
                        </button>
                      </div>
                      {kontoLinkWeg && <div className="modal-note">✉️ Link verschickt — ein Tipp darauf meldet dieses Gerät an. Kein Passwort nötig.</div>}
                      <details className="modal-details">
                        <summary>Mit Passwort anmelden oder Konto erstellen</summary>
                        <label className="modal-row">
                          <span>Passwort</span>
                          <input type="password" autoComplete="current-password" placeholder="mindestens 6 Zeichen" value={kontoPass} onChange={(e) => setKontoPass(e.target.value)} data-taste="konto-pass" />
                        </label>
                        <div className="modal-buttons">
                          <button disabled={!mailOk || kontoPass.length < 6 || busy === 'konto'} onClick={kontoMailPasswort} data-taste="konto-passwort">{busy === 'konto' ? '…' : 'Anmelden'}</button>
                          <button disabled={!mailOk || kontoPass.length < 6 || busy === 'konto'} onClick={kontoMailRegistrieren} data-taste="konto-neu">{busy === 'konto' ? '…' : 'Konto erstellen'}</button>
                        </div>
                      </details>
                    </div>
                  )}
                  <div className="modal-buttons">
                    <button disabled={!oauthAvailable() || !kontoGid.trim() || busy === 'konto'} onClick={() => kontoConnect('google')} data-taste="konto-google">
                      {busy === 'konto' ? '…' : 'Mit Google anmelden'}
                    </button>
                    <button disabled={!oauthAvailable() || !kontoMsid.trim() || busy === 'konto'} onClick={() => kontoConnect('ms')} data-taste="konto-ms">
                      {busy === 'konto' ? '…' : 'Mit Microsoft anmelden'}
                    </button>
                  </div>
                  <div className="modal-note">Google und Microsoft fragen beim ersten Mal einmal nach der Erlaubnis für den App-Ordner. Mehr sieht PixiNotes nicht.</div>
                  {(!supabaseKonfiguriert() || !kontoGid.trim() || !kontoMsid.trim()) && (
                    <details className="modal-details" open={!supabaseKonfiguriert() && !kontoGid.trim() && !kontoMsid.trim()}>
                      <summary>Einmalig vom Betreiber: Konto-Backend und Client-IDs hinterlegen</summary>
                      <p className="modal-hint">
                        Nutzer tippen hier nichts. Der Betreiber hinterlegt einmal das Konto-Backend (Supabase-Projekt) und je Anbieter eine App-ID im Build
                        (Repository-Variablen <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>, <code>VITE_GOOGLE_CLIENT_ID</code>, <code>VITE_MS_CLIENT_ID</code>) — oder hier. Dieselben IDs gelten für die Kalender-Konten unter Dienste.
                      </p>
                      {!supabaseKonfiguriert() && (
                        <>
                          <label className="modal-row">
                            <span>Supabase-URL</span>
                            <input type="url" placeholder="https://xxxx.supabase.co" value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} data-taste="sb-url" />
                          </label>
                          <label className="modal-row">
                            <span>Anon-Key</span>
                            <input type="text" placeholder="eyJ… (öffentlicher Schlüssel)" value={sbKey} onChange={(e) => setSbKey(e.target.value)} data-taste="sb-key" />
                          </label>
                          <div className="modal-buttons">
                            <button disabled={!sbUrl.trim() || !sbKey.trim()} onClick={sbKonfigSichern} data-taste="sb-sichern">Konto-Backend hinterlegen</button>
                          </div>
                          <div className="modal-note">
                            Supabase → neues Projekt (Region Frankfurt) → SQL Editor: die Migration aus <code>supabase/migrations</code> ausführen → Authentication → E-Mail-Anmeldung an, Site-URL <code>{location.origin + location.pathname}</code>. Der Anon-Key ist öffentlich; die Daten schützt Row Level Security.
                          </div>
                        </>
                      )}
                      <label className="modal-row">
                        <span>Google Client-ID</span>
                        <input type="text" placeholder="xxxxx.apps.googleusercontent.com" value={kontoGid} onChange={(e) => setKontoGid(e.target.value)} />
                      </label>
                      <div className="modal-note">
                        Google Cloud Console → APIs &amp; Dienste → Anmeldedaten → OAuth-Client „Webanwendung", autorisierte JavaScript-Quelle <code>{location.origin}</code>.
                        Berechtigung <code>drive.appdata</code> gilt als nicht sensibel — keine Prüfung durch Google nötig.
                      </div>
                      <label className="modal-row">
                        <span>Microsoft App-ID</span>
                        <input type="text" placeholder="00000000-0000-0000-0000-000000000000" value={kontoMsid} onChange={(e) => setKontoMsid(e.target.value)} />
                      </label>
                      <label className="modal-row">
                        <span>Tenant</span>
                        <input type="text" placeholder="common" value={kontoTenant} onChange={(e) => setKontoTenant(e.target.value)} />
                      </label>
                      <div className="modal-note">
                        Microsoft Entra → App-Registrierung „Single-Page-Anwendung", Umleitungs-URI <code>{location.origin + location.pathname}</code>, Berechtigung <code>Files.ReadWrite.AppFolder</code>.
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <div className="modal-buttons">
                    <button disabled={!!busy} onClick={kontoPush}>{busy === 'kontopush' ? '…' : 'Jetzt hochladen'}</button>
                    <button disabled={!!busy} onClick={kontoPull}>{busy === 'kontopull' ? '…' : 'Vom Konto laden'}</button>
                    <button disabled={!!busy} onClick={kontoLogout}>Abmelden</button>
                    {kontoIstEigenes(kontoSitz) && (
                      <button disabled={!!busy} onClick={kontoEigenesLoeschen} className="danger" data-taste="konto-loeschen">{busy === 'kontoweg' ? '…' : 'Konto löschen'}</button>
                    )}
                  </div>
                  <div className="modal-note" data-taste="konto-stand">
                    ✅ Angemeldet bei {kontoLabel(kontoSitz)}{kontoSitz.name ? <> als „<span translate="no">{kontoSitz.name}</span>"</> : ''} — Änderungen werden automatisch abgeglichen
                    {kontoStamp() ? ` (letzter Abgleich: ${new Date(kontoStamp()!).toLocaleString('de-DE')})` : ''}
                    {kontoIstEigenes(kontoSitz) ? (kontoLiveVerbunden() ? ', live verbunden' : ', Abgleich alle zehn Sekunden') : ''}. Anhänge bis {kontoDateiMaxMb(kontoSitz)} MB wandern mit{kontoIstEigenes(kontoSitz) ? ' — große laden beim Öffnen der Karte nach' : ''}.
                  </div>
                </>
              )}
              {kontoError && (
                <div className="modal-error" role="alert">⚠️ {kontoError}</div>
              )}
            </>
          )}

          {syncWeg === 'ordner' && (
            <>
              <p className="modal-hint">Ein Ordner, den dein Cloud-Client (Nextcloud, OneDrive, Dropbox …) synchronisiert. PixiNotes speichert dort automatisch und gleicht in beide Richtungen ab.</p>
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
                    ? <>⚠️ Verbunden mit „<span translate="no">{syncHandle.name}</span>", aber der Browser hat den Zugriff nach dem Neustart zurückgesetzt — bitte oben „Zugriff erlauben" klicken, sonst pausiert der Auto-Sync.</>
                    : <>✅ Verbunden mit Ordner „<span translate="no">{syncHandle.name}</span>" — Änderungen werden automatisch gespeichert
                      {knownStamp() ? ` (letzter Sync: ${new Date(knownStamp()!).toLocaleString('de-DE')})` : ''}.
                      Schreibt ein anderes Gerät zwischenzeitlich, werden beide Stände zusammengeführt.</>}
                </div>
              )}
            </>
          )}

          {syncWeg === 'webdav' && (
            <>
              <p className="modal-hint">Direkt auf den Server (Nextcloud, ownCloud …), ohne Desktop-Client, auch am Tablet und Handy. Bei Nextcloud ein App-Passwort anlegen.</p>
              <details className="modal-details">
                <summary>⚠️ Wird blockiert? Das liegt am Server (CORS) — so wird es freigegeben</summary>
                <p className="modal-hint">
                  Nextcloud erlaubt Browser-Zugriffe auf <code>/remote.php/dav</code> standardmäßig nicht, in jedem Browser und auf jedem Gerät.
                  Die Freigabe muss vom Server kommen — am schnellsten mit der Nextcloud-App <b>„WebAppPassword"</b>, in der eure IT
                  diese Herkunft einträgt: <code>{location.origin}</code>
                </p>
                <div className="modal-buttons">
                  <button onClick={() => void copyCorsText()}>Fertigen Text für die IT kopieren</button>
                </div>
                <div className="modal-note">
                  Der Text erklärt die benötigten Header und enthält <b>keine Zugangsdaten</b>. Bis zur Freigabe:{' '}
                  {syncSupported() ? 'der Weg „Ordner" oben' : isAppleTouch() ? 'der Weg „Dateien-App" oben' : 'der Weg „Datei" oben'}.
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
                    ✅ Verbunden mit <span translate="no">{davCfg.url.replace(/^https?:\/\//, '').split('/')[0]}</span> — Änderungen werden automatisch hochgeladen
                    {webdavStamp() ? ` (letzter Sync: ${new Date(webdavStamp()!).toLocaleString('de-DE')})` : ''}.
                    Schreibt ein anderes Gerät zwischenzeitlich, warnt PixiNotes statt zu überschreiben.
                  </div>
                </>
              )}
              {davError && (
                <div className="modal-error" role="alert">⚠️ {davError}</div>
              )}
            </>
          )}

          {/* M190: Sync über die Dateien-App — der Weg, der auf iPad/iPhone geht */}
          {syncWeg === 'datei' && (
            <div key={filesTick}>
              <p className="modal-hint">Dieselbe Datei wie beim Sync-Ordner am Rechner. In denselben Cloud-Ordner gelegt, gleichen sich beide Wege ab.</p>
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
                    : <>Noch nichts gesichert. Nach jeder längeren Arbeitseinheit einmal sichern — der Browser-Speicher allein ist kein Backup.</>}
              </div>
              {isAppleTouch() && !isStandalone() && (
                <div className="modal-note">
                  💡 <b>Wichtig auf dem iPad:</b> Safari löscht die Daten von Webseiten, die man 7 Tage
                  nicht benutzt. Leg PixiNotes über <b>Teilen → „Zum Home-Bildschirm"</b> auf den
                  Startbildschirm — dann gilt diese Löschregel nicht mehr.
                </div>
              )}
            </div>
          )}
        </section>

        <section className="modal-section">
          <h3>Team-Sync — Projekte teilen</h3>
          <p className="modal-hint">Ein Projekt wird in einen eigenen, fürs Team freigegebenen Ordner gespiegelt. Wer mitarbeitet, regelt allein die Ordner-Freigabe.</p>
          {syncSupported() ? (
            <>
              {/* M300: Ein Wähler statt ein Knopf je Projekt — die Liste zeigt nur, was verbunden ist */}
              <div className="modal-row psync-neu">
                <select value={psWahl} onChange={(e) => setPsPick(e.target.value)} disabled={freieProjekte.length === 0} aria-label="Projekt">
                  {freieProjekte.length === 0
                    ? <option value="">Alle Projekte sind verbunden</option>
                    : freieProjekte.map(({ sp, p }) => <option key={p.id} value={p.id} translate="no">{sp.name} › {p.name}</option>)}
                </select>
                <button
                  disabled={!!busy || !psWahl}
                  onClick={() => { const t = freieProjekte.find((x) => x.p.id === psWahl); if (t) void psConnect(t.p.id, t.p.name); }}
                >
                  {busy.startsWith('psc-') ? '…' : 'Mit Team-Ordner verbinden…'}
                </button>
              </div>
              <div className="modal-buttons">
                <button disabled={!!busy} onClick={psJoin} title="Freigegebenen Team-Ordner wählen und das Projekt übernehmen">
                  {busy === 'psjoin' ? '…' : 'Projekt beitreten…'}
                </button>
              </div>
              {verbundene.length > 0 && (
                <div className="psync-list">
                  {verbundene.map(({ sp, p }) => (
                    <div className="psync-row" key={p.id}>
                      <span className="psync-name" translate="no" title={`${sp.name} › ${p.name}`}>{sp.name} › <b>{p.name}</b></span>
                      <span className="psync-status" translate="no">☁ „{psMeta[p.id].folder}"{projectStamp(p.id) ? ` · ${new Date(projectStamp(p.id)!).toLocaleString('de-DE')}` : ''}</span>
                      <span className="psync-actions">
                        <button disabled={!!busy} onClick={() => psSave(p.id)}>{busy === `pss-${p.id}` ? '…' : 'Jetzt speichern'}</button>
                        <button disabled={!!busy} onClick={() => psLoad(p.id, p.name)}>{busy === `psl-${p.id}` ? '…' : 'Vom Ordner laden'}</button>
                        <button onClick={() => psInvite(p.id, p.name)} title="Einladung kopieren und als E-Mail öffnen">Einladen…</button>
                        <button disabled={!!busy} onClick={() => psOff(p.id)}>{busy === `pso-${p.id}` ? '…' : 'Trennen'}</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-note">
                Einladen: Ordner im Cloud-Speicher fürs Team freigeben, „Einladen…" schickt die Anleitung, die Person tritt über „Projekt beitreten…" bei.
              </div>
            </>
          ) : (
            <p className="modal-hint">{isAppleTouch()
                ? <>Team-Sync braucht einen Ordner-Zugriff, den iPadOS keiner Webseite erlaubt. Dafür einen Rechner mit Chrome oder Edge nutzen.</>
                : <>Dieser Browser kann keine Ordner anbinden (Chrome und Edge können das).</>}</p>
          )}
        </section>


        <section className="modal-section">
          <h3>Als Markdown exportieren</h3>
          <p className="modal-hint">{hasFolderApi
              ? 'Alle Boards als Markdown-Dateien in einen Ordner deiner Wahl, lesbar in Obsidian.'
              : 'Alle Boards in einer Markdown-Datei, gegliedert nach Bereich und Projekt.'}</p>
          <div className="modal-buttons">
            <button disabled={!!busy} onClick={() => doExport(async () => {
              const r = await exportToFolder(spaces, boards);
              showToast(r === 'ok' ? '📁 In Ordner gespeichert' : '⬇️ Markdown-Datei heruntergeladen');
            }, 'folder')}>
              {busy === 'folder' ? '…' : hasFolderApi ? 'Ordner wählen & speichern' : 'Als Markdown exportieren'}
            </button>
          </div>
          <div className="modal-note">Das aktuelle Board als Bild (PNG, SVG, PDF): Dock ⋯ → „Als Bild exportieren".</div>
        </section>

        <OneNoteImport onClose={() => setOpen(false)} onDienste={() => setTab('dienste')} />

        <section className="modal-section modal-danger">
          <h3>Alles leeren &amp; neu starten</h3>
          <p className="modal-hint">Löscht alle Bereiche, Projekte, Boards, Karten und Vorlagen, ohne Rückgängig. Vorher oben „Datei exportieren".</p>
          <div className="modal-buttons">
            <button className="danger" disabled={!!busy} onClick={() => void resetEverything()}>
              Alles leeren…
            </button>
          </div>
        </section>
        </>
        )}

        {/* ---- Synchronisation: ein Weg für die Umgebung, Team-Sync je Projekt, Optionen ---- */}
        {/* ---- Dienste: KI, Gehirn, Konten ---- */}
        {tab === 'dienste' && (
        <>
        <section className="modal-section">
          <h3>KI-Assistent</h3>
          <p className="modal-hint">Die KI läuft über einen Anbieter deiner Wahl. Mit Ollama oder einem eigenen Server bleibt alles auf deinem Rechner.</p>
          <label className="modal-row">
            <span>Anbieter</span>
            <select value={ai.provider} onChange={(e) => {
              const provider = e.target.value as typeof ai.provider;
              // apiKey IMMER zurücksetzen: sonst ginge z. B. ein OpenAI-Key beim
              // Wechsel auf „Eigener Server" an eine fremde URL (Audit R6-K2)
              updateAi({ provider, model: MODELS[provider]?.[0] ?? '', baseUrl: DEFAULT_BASE[provider] ?? '', apiKey: '' });
            }}>
              <option value="none">— aus —</option>
              <option value="free">Gratis (Pollinations.ai)</option>
              <option value="openrouter">OpenRouter (kostenloser Account)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama (lokal)</option>
              <option value="custom">Eigener Server (OpenAI-kompatibel)</option>
            </select>
          </label>
          {ai.provider !== 'none' && (
            <>
              {/* M257: Bei lokalen Servern kommt die Liste vom Server selbst;
                  bei Cloud-Diensten bleibt es bei den bekannten Namen. */}
              {NEEDS_URL.has(ai.provider) ? (
                <>
                  <label className="modal-row">
                    <span>Server-URL</span>
                    <input type="text" placeholder="http://localhost:11434" value={ai.baseUrl}
                      onChange={(e) => updateAi({ baseUrl: e.target.value })} />
                  </label>
                  <label className="modal-row">
                    <span>Modell</span>
                    <input
                      type="text" list="lokale-modelle" placeholder="z. B. gemma3:12b"
                      value={ai.model} onChange={(e) => updateAi({ model: e.target.value })}
                    />
                    <button
                      className="btn btn-mini" onClick={() => void ladeLokaleModelle()}
                      disabled={lokalLaedt}
                      title="Modelle vom Server laden"
                    >
                      {lokalLaedt ? '…' : '⟳ Modelle laden'}
                    </button>
                  </label>
                  {/* Freies Feld MIT Vorschlagsliste: Jedes installierte Modell ist
                      per Klick da — und jeder andere Name lässt sich trotzdem
                      eintippen, auch wenn der Server gerade nicht antwortet. */}
                  <datalist id="lokale-modelle">
                    {lokal.map((m) => <option key={m.name} value={m.name} />)}
                  </datalist>
                  {lokal.length > 0 && (
                    <div className="modell-liste">
                      <div className="modell-kopf">
                        {lokal.filter((m) => !istEinbettungsModell(m.name)).length} Modelle auf {ai.baseUrl.replace(/^https?:\/\//, '')} — anklicken zum Übernehmen
                      </div>
                      {lokal.filter((m) => !istEinbettungsModell(m.name)).map((m) => (
                        <button
                          key={m.name}
                          className={`modell-zeile ${ai.model === m.name ? 'aktiv' : ''}`}
                          onClick={() => updateAi({ model: m.name })}
                        >
                          <b>{m.name}</b>
                          <span>{[m.groesse, m.quant, zeigeGroesse(m.bytes)].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                      {lokal.some((m) => istEinbettungsModell(m.name)) && (
                        <div className="modell-fuss">
                          Nicht gezeigt: {lokal.filter((m) => istEinbettungsModell(m.name)).map((m) => m.name).join(', ')}
                          {' '}— Einbettungs-Modelle fürs Gehirn, sie können nicht antworten.
                        </div>
                      )}
                    </div>
                  )}
                  {/* M258: Für jede Lage genau eine Aussage — und die dazu
                      passende Anleitung, nicht alle auf einmal. */}
                  {lokalLage === 'verboten' && (
                    <div className="modal-note warn ollama-hilfe">
                      <b>Der Server läuft — aber der Browser darf nicht zugreifen.</b>
                      <p>
                        Ollama weist die Anfrage von dieser Seite ab, weil sie nicht in seiner Liste erlaubter
                        Herkünfte steht — eine Schutzvorkehrung, kein Fehler deiner Einrichtung.
                      </p>
                      <p>{erlaubnisHilfe().hinweis}</p>
                      <pre>{erlaubnisHilfe().befehle.join('\n')}</pre>
                      <p>Danach hier auf <b>⟳ Modelle laden</b> tippen.</p>
                    </div>
                  )}
                  {lokalLage === 'weg' && (
                    <div className="modal-note warn ollama-hilfe">
                      <b>Unter {ai.baseUrl} antwortet nichts.</b>
                      <p>
                        Dort lauscht kein Dienst: prüfen mit <code>ollama serve</code> oder{' '}
                        <code>systemctl status ollama</code>, die Voreinstellung ist <code>http://127.0.0.1:11434</code>.
                        Von einem anderen Gerät ist „localhost" immer das Gerät selbst — dort die Netzwerkadresse
                        des Rechners eintragen und Ollama mit <code>OLLAMA_HOST=0.0.0.0</code> starten.
                      </p>
                    </div>
                  )}
                  {lokalLage === 'leer' && (
                    <div className="modal-note warn">
                      Der Server antwortet, hat aber kein Modell installiert — unten stehen
                      Vorschläge mit dem passenden Befehl.
                    </div>
                  )}
                  {lokalFehler && <div className="modal-note warn">⚠️ {lokalFehler}</div>}
                  {ai.provider === 'ollama' && (
                    <details className="modell-tipps">
                      <summary>Noch kein Modell? Bewährte Vorschläge zum Nachladen</summary>
                      <p className="modal-hint">Eine Starthilfe, keine vollständige Liste. Jeder Name aus ollama.com/library funktioniert, vorher einmal im Terminal holen.</p>
                      {VORSCHLAEGE.map((v) => (
                        <div key={v.name} className="modell-tipp">
                          <code>ollama pull {v.name}</code>
                          <span className="modell-tipp-platz">{v.platz}</span>
                          <span className="modell-tipp-zweck">{v.zweck}</span>
                          <button className="btn btn-mini" onClick={() => updateAi({ model: v.name })}>
                            eintragen
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                </>
              ) : (
                <label className="modal-row">
                  <span>Modell</span>
                  <select value={ai.model} onChange={(e) => updateAi({ model: e.target.value })}>
                    {MODELS[ai.provider].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
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
                  ? 'Ohne Konto, aber langsam (~20 s) und ohne Garantien; Inhalte gehen an Pollinations.ai.'
                  : ai.provider === 'openrouter'
                    ? 'Schlüssel auf openrouter.ai anlegen (Konto reicht), Modelle mit „:free" kosten nichts.'
                    : ai.provider === 'ollama'
                      ? 'Ollama muss laufen (ollama serve); für den Browser-Zugriff ggf. OLLAMA_ORIGINS setzen.'
                      : (NEEDS_KEY.has(ai.provider) && !ai.apiKey)
                        ? 'Ohne Schlüssel bleiben die KI-Aktionen ausgeblendet.'
                        : '✅ Konfiguriert — KI-Aktionen erscheinen auf den Karten.'}
              </div>
            </>
          )}
        </section>

        {/* ---- M204: Gehirn — semantischer Index ---- */}
        <section className="modal-section">
          <h3>🧠 Gehirn</h3>
          <p className="modal-hint">Die Suche findet nach Bedeutung („Kita" findet „Betreuungszeiten") und zeigt verwandte Karten. Der Index bleibt in diesem Browser.</p>
          <label className="modal-row modal-row-check">
            <span>Gehirn einschalten</span>
            <input
              type="checkbox"
              checked={brain.on}
              onChange={(e) => {
                updateBrain({ on: e.target.checked });
                if (e.target.checked) setTimeout(() => void syncBrainIndex(), 300);
              }}
            />
          </label>
          {brain.on && (
            <>
              <p className="modal-hint">
                {brainInfo.busy
                  ? `⏳ Indexiere … (${brainInfo.indexed} Karten fertig)`
                  : brainInfo.error ? `⚠️ ${brainInfo.error}` : `✅ ${brainInfo.indexed} Karten im Index`}
              </p>
              {/* M314: Bereiche, Anbieter und Modell braucht man einmal — eingeklappt */}
              <details className="modal-details">
              <summary>Erweitert: Bereiche, Anbieter, Index</summary>
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
                      <span className="brain-scope-name" translate="no">{sp.name}</span>
                      <span className="brain-scope-count">{karten} Karten</span>
                    </label>
                  );
                })}
                <p className="modal-hint">Abgeschaltete Bereiche liefern nichts ans Gehirn, ihre Vektoren werden gelöscht. So bleibt Privates aus dienstlichen Antworten heraus.</p>
              </div>
              <label className="modal-row">
                <span>Anbieter</span>
                <select value={brain.provider} onChange={(e) => updateBrain({ provider: e.target.value as typeof brain.provider })}>
                  <option value="auto">Automatisch (folgt der KI-Einstellung)</option>
                  <option value="ollama">Ollama (lokal)</option>
                  <option value="browser">Im Browser (einmaliger Download)</option>
                  <option value="cloud">Cloud (OpenAI/OpenRouter-Schlüssel)</option>
                </select>
              </label>
              {/* M257: Auch das Einbettungs-Modell ist wählbar — bge-m3 versteht
                  deutsche Texte besser, all-minilm passt auf jeden Rechner. */}
              {(brain.provider === 'ollama' || (brain.provider === 'auto' && ai.provider === 'ollama')) && (
                <>
                  <label className="modal-row">
                    <span>Einbettungs-Modell</span>
                    <input
                      type="text" list="lokale-einbettungen" placeholder="nomic-embed-text"
                      value={brain.embedModel ?? ''}
                      onChange={(e) => updateBrain({ embedModel: e.target.value })}
                    />
                    <button className="btn btn-mini" onClick={() => void ladeLokaleModelle()} disabled={lokalLaedt} title="Modelle vom Server laden">
                      {lokalLaedt ? '…' : '⟳'}
                    </button>
                  </label>
                  <datalist id="lokale-einbettungen">
                    {lokal.filter((m) => istEinbettungsModell(m.name)).map((m) => <option key={m.name} value={m.name} />)}
                  </datalist>
                  <div className="modal-hint">
                    Installiert: {lokal.filter((m) => istEinbettungsModell(m.name)).map((m) => m.name).join(', ') || '— noch keines gefunden'}
                    {' · '}Nachladen mit <code>ollama pull …</code>: {EINBETTUNGS_VORSCHLAEGE.map((v) => `${v.name} (${v.platz})`).join(' · ')}.
                  </div>
                </>
              )}
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
                Nach einem Wechsel von Anbieter oder Modell „Index neu aufbauen" — Vektoren verschiedener Modelle sind nicht vergleichbar.
              </p>
              </details>
            </>
          )}
        </section>

        {/* ---- M320: Handschrift → Text ---- */}
        <section className="modal-section">
          <h3>Handschrift</h3>
          <p className="modal-hint">
            {browserErkenntHandschrift()
              ? '„Text" in der Zeichen-Palette wandelt Geschriebenes in eine Notiz — dein Browser erkennt die Schrift selbst, nichts verlässt das Gerät.'
              : '„Text" in der Zeichen-Palette wandelt Geschriebenes in eine Notiz — das kann dein Browser nicht selbst (Chrome auf ChromeOS, Windows und Mac kann es). Am iPad schreibt der Pencil mit Scribble direkt in die Textfelder.'}
          </p>
          <label className="modal-row modal-row-check">
            <span>Online-Erkennung (Google)</span>
            <input type="checkbox" checked={handschriftOnline} onChange={(e) => setHandschriftOnline(e.target.checked)} data-taste="handschrift-online" />
          </label>
          <p className="modal-hint">Ersatz, wenn der Browser es nicht kann: Die Striche gehen dann an Googles Handschrift-Dienst — ohne Konto, aber außer Haus. Standard: aus.</p>
          {/* M324: Vorschlag nach der Schreibpause und KI-Korrektur */}
          <label className="modal-row modal-row-check">
            <span>Vorschlag nach dem Schreiben</span>
            <input type="checkbox" checked={handschriftAuto} onChange={(e) => setHandschriftAuto(e.target.checked)} data-taste="handschrift-auto" />
          </label>
          <p className="modal-hint">Kurz nach dem Absetzen erscheint der erkannte Text unter dem Geschriebenen — ein Tipp übernimmt ihn in die Notiz darunter oder in eine neue.</p>
          {aiReady(ai) && (
            <>
              <label className="modal-row modal-row-check">
                <span>KI verbessert die Erkennung</span>
                <input type="checkbox" checked={handschriftKi} onChange={(e) => setHandschriftKi(e.target.checked)} data-taste="handschrift-ki" />
              </label>
              <p className="modal-hint">Deine eingerichtete KI korrigiert Lesefehler und kennt dabei Namen und Begriffe aus der Notiz und dem Board. Sie ergänzt nichts und lässt nichts weg.</p>
            </>
          )}
        </section>

        {/* ---- Konten: Google & Microsoft 365 — Kalender, bei Microsoft auch OneNote ---- */}
        <section className="modal-section">
          <h3>Konten</h3>
          <p className="modal-hint">Google und Microsoft 365 liefern Termine in die Kalender-Karten, Microsoft auf Wunsch auch OneNote-Notizbücher. Die Anmeldung läuft direkt zwischen Browser und Anbieter, die Client-ID legt eure IT an.</p>
          {!oauthAvailable() && (
            <div className="modal-note">
              ⚠️ Die Einzeldatei (file://) kann kein OAuth, dafür die gehostete App nutzen. Ohne Anmeldung: ICS-Abo in der Kalender-Karte.
            </div>
          )}

          <h4>Google</h4>
          {calAcc.google?.token ? (
            <>
              <div className="modal-note">✅ Verbunden{calAcc.google.connectedAs ? <> als „<span translate="no">{calAcc.google.connectedAs}</span>"</> : ''} — Kalender wählen:</div>
              {(calAcc.google.calendars ?? []).map((c) => (
                <label key={c.id} className="cal-menu-check" style={{ display: 'flex', gap: 6 }}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => toggleGoogleCalendar(c.id, e.target.checked)} />
                  <span translate="no">{c.name}</span>
                </label>
              ))}
              <div className="modal-buttons">
                <button onClick={() => { disconnectCalAccount('google'); refreshCalAcc(); showToast('Google-Konto getrennt.'); }}>Trennen</button>
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

          <h4>Microsoft 365</h4>
          {(calAcc.ms?.token || calAcc.ms?.refreshToken) ? (
            <>
              <div className="modal-note">
                ✅ Verbunden{calAcc.ms.connectedAs ? <> als „<span translate="no">{calAcc.ms.connectedAs}</span>"</> : ''} · Kalender ✓ · OneNote {msHasNotes(calAcc.ms) ? '✓' : '—'}
              </div>
              <div className="modal-buttons">
                {!msHasNotes(calAcc.ms) && (
                  <button disabled={!oauthAvailable() || busy === 'ms'} onClick={doMsNotes}>
                    {busy === 'ms' ? '…' : 'OneNote freischalten'}
                  </button>
                )}
                <button onClick={() => { disconnectCalAccount('ms'); refreshCalAcc(); showToast('Microsoft-Konto getrennt.'); }}>Trennen</button>
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
              <label className="modal-row modal-row-check">
                <span>Auch OneNote lesen</span>
                <input type="checkbox" checked={msMitNotes} onChange={(e) => setMsMitNotes(e.target.checked)} />
              </label>
              <div className="modal-buttons">
                <button disabled={!msClientId.trim() || !oauthAvailable() || busy === 'ms'} onClick={doConnectMs}>
                  {busy === 'ms' ? '…' : 'Mit Microsoft verbinden'}
                </button>
              </div>
            </>
          )}
        </section>
        </>
        )}

        </div>
      </div>
    </div>
  );
}
