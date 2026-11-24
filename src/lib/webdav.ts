// WebDAV-Synchronisation (Nextcloud, ownCloud, generische DAV-Server):
// Die App legt dieselbe Allow-List-Sync-Datei wie der Sync-Ordner direkt per
// HTTP(S) auf den Server — ohne Desktop-Client, funktioniert auch am Handy.
//
// - Zugangsdaten (URL, Benutzer, App-Passwort) liegen in einem EIGENEN
//   localStorage-Schlüssel, NICHT im Board-Store → nie in Share-Links,
//   Sync-Dateien oder Exporten (gleiche Regel wie KI-Keys/Kalender-Tokens).
// - Payload ist die bewährte Allow-List {boards, spaces, activeId, savedAt}
//   aus syncFolder.ts — Einstellungen/Schlüssel verlassen das Gerät nie.
// - Ehrliche Grenze: Der Browser braucht CORS-Header vom DAV-Server.
//   Nextcloud liefert die standardmäßig NICHT — dann muss die IT die Origin
//   freigeben, oder man nutzt den Sync-Ordner (Desktop-Client) bzw. Export.
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard } from '../store';
import { gestaltLaden } from './sicher';
import {
  basisMerken, basisVergessen, buildSyncPayloadMitDateien, DATEI_BUDGET_MB, emitSyncStatus, fremdStandEinarbeiten,
  KONTO_DIRTY_KEY, notiereAenderung, SYNC_DIRTY_KEY, uebernimmDateien, WEBDAV_DIRTY_KEY, type SyncPayload, type SyncWeg,
} from './syncFolder';
import { nurAuswahlAnders } from './syncMerge';
import { sprache } from './sprache';

const LS_KEY = 'pixinotes-webdav';
const STAMP_KEY = 'pixinotes:webdav-stamp';
const FILE_NAME = 'pixinotes-daten.json';

export interface WebdavConfig {
  url: string;      // Ordner-URL, z. B. https://cloud…/remote.php/dav/files/USER/PixiNotes
  user: string;
  secret: string;   // App-Passwort (bei Nextcloud: Einstellungen → Sicherheit)
  auto: boolean;    // Änderungen automatisch hochladen
}

export function loadWebdav(): WebdavConfig | null {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') as WebdavConfig | null;
    return cfg?.url ? cfg : null;
  } catch {
    return null;
  }
}

export function saveWebdav(cfg: WebdavConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  // M390: anderer Server, andere Regeln — die Vorbedingung beim Schreiben wird neu ausprobiert
  localStorage.removeItem('pixinotes-webdav-ohne-bedingung');
}

export function clearWebdav() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(STAMP_KEY);
  localStorage.removeItem('pixinotes-webdav-ohne-bedingung');
  void basisVergessen('webdav');
}

export const webdavStamp = (): string | null => localStorage.getItem(STAMP_KEY);

/** Basic-Auth mit UTF-8-Namen/Passwörtern (btoa allein kann kein UTF-8) */
function basicAuth(user: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${user}:${secret}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const fileUrl = (cfg: WebdavConfig) => `${cfg.url.replace(/\/+$/, '')}/${FILE_NAME}`;

/** Netzwerk-/CORS-Fehler unterscheiden statt raten (M82): Ein no-cors-Probe-
 *  Request klappt auch OHNE CORS-Freigabe — antwortet der Server darauf, ist
 *  er erreichbar und es fehlt „nur" die CORS-Freigabe (bei Nextcloud der
 *  Normalfall). Schlägt auch die Probe fehl, stimmt Adresse/Netz nicht. */
async function friendly(e: unknown, cfg: WebdavConfig): Promise<Error> {
  if (e instanceof TypeError) {
    // Gemischte Inhalte zuerst: Eine https-Seite darf gar keine http-Adresse
    // aufrufen — der Browser bricht ab, bevor CORS überhaupt zur Sprache kommt.
    if (location.protocol === 'https:' && /^http:\/\//i.test(cfg.url.trim())) {
      return new Error(
        'Die Server-Adresse beginnt mit http:// – eine über https ausgelieferte Seite darf das nicht aufrufen '
        + '(„Mixed Content"). Bitte https:// verwenden.',
      );
    }
    try {
      await fetch(fileUrl(cfg), { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      return new Error(
        `Der Server ist erreichbar, blockiert aber Browser-Zugriffe (fehlende CORS-Freigabe). Das liegt am Server, nicht am Gerät – ${apple() ? 'auf dem iPad ist es genauso wie auf jedem anderen Browser' : 'jeder Browser verhält sich hier gleich'}. `
        + 'Nötig ist eine einmalige Freigabe durch die IT (bei Nextcloud z. B. die App „WebAppPassword" mit dieser PixiNotes-Adresse als erlaubte Herkunft). '
        + 'In Einstellungen → Daten → Synchronisation steht ein fertiger Text für die IT zum Kopieren. '
        + `Ohne Freigabe funktioniert ${apple() ? 'auf dem iPad die Synchronisation über die Dateien-App' : 'der Sync-Ordner oder der Datei-Export'}.`,
      );
    } catch {
      return new Error(
        'Server nicht erreichbar – Adresse prüfen (Tippfehler? VPN/Firewall? HTTPS?). '
        + 'Die Ordner-URL sieht bei Nextcloud so aus: https://cloud.example.de/remote.php/dav/files/BENUTZERNAME/PixiNotes',
      );
    }
  }
  return e as Error;
}

const apple = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * Fertiger Text für die IT — nennt die konkrete Herkunft dieser Installation
 * und exakt die Header, die der Server für PixiNotes liefern muss. Bewusst
 * OHNE Zugangsdaten: Benutzername und App-Passwort haben in so einer Mail
 * nichts verloren und stehen deshalb auch nicht drin.
 */
export function corsRequestText(cfg: WebdavConfig | null): string {
  // M381: Läuft die Oberfläche englisch, geht die Bitte an die IT englisch hinaus (eigene Fassung statt Zeile für Zeile)
  if (sprache() === 'en') {
    const h = cfg?.url ? cfg.url.replace(/^https?:\/\//, '').split('/')[0] : 'our Nextcloud';
    return [
      'Subject: CORS for WebDAV (browser access to ' + h + ')',
      '',
      'Hello,',
      '',
      `I use the web application PixiNotes and would like to store my notes via WebDAV in our Nextcloud (${h}).`,
      'The browser aborts the connection because the server sends no CORS headers for /remote.php/dav.',
      'The application runs entirely in the browser; no additional server is involved and no data is passed on to third parties.',
      '',
      `Origin that would need to be allowed: ${location.origin}`,
      '',
      'The following response headers are needed for /remote.php/dav:',
      `  Access-Control-Allow-Origin: ${location.origin}`,
      '  Access-Control-Allow-Methods: GET, PUT, OPTIONS',
      '  Access-Control-Allow-Headers: Authorization, Content-Type, If-Match',
    '  Access-Control-Expose-Headers: ETag',
      '  Access-Control-Max-Age: 600',
      'The OPTIONS request (preflight) must be answered with 200/204 without authentication —',
      'otherwise it fails before the credentials are sent at all.',
      '',
      'In Nextcloud this can also be done without touching the server configuration, using the app',
      '“WebAppPassword”: the origin above is entered there.',
      '',
      'PixiNotes only uses GET and PUT on a single JSON file in the given folder and signs in with an',
      'app password (not the account password). No cookies are set.',
      '',
      'Thank you!',
    ].join('\n');
  }
  const host = cfg?.url ? cfg.url.replace(/^https?:\/\//, '').split('/')[0] : 'unsere Nextcloud';
  return [
    'Betreff: CORS-Freigabe für WebDAV (Browser-Zugriff auf ' + host + ')',
    '',
    'Hallo zusammen,',
    '',
    'ich nutze die Web-Anwendung PixiNotes und möchte meine Notizen per WebDAV in',
    `unserer Nextcloud (${host}) ablegen. Der Browser bricht die Verbindung ab, weil der`,
    'Server keine CORS-Header für /remote.php/dav liefert. Die Anwendung läuft rein im',
    'Browser, es ist kein zusätzlicher Server beteiligt und es werden keine Daten an',
    'Dritte übertragen.',
    '',
    `Herkunft (Origin), die freigegeben werden müsste: ${location.origin}`,
    '',
    'Benötigt werden für /remote.php/dav folgende Antwort-Header:',
    `  Access-Control-Allow-Origin: ${location.origin}`,
    '  Access-Control-Allow-Methods: GET, PUT, OPTIONS',
    '  Access-Control-Allow-Headers: Authorization, Content-Type',
    '  Access-Control-Max-Age: 600',
    'Die OPTIONS-Anfrage (Preflight) muss dabei ohne Anmeldung mit 200/204 beantwortet',
    'werden, sonst schlägt sie fehl, bevor die Anmeldedaten überhaupt gesendet werden.',
    '',
    'In Nextcloud lässt sich das auch ohne Eingriff in die Server-Konfiguration über die',
    'App „WebAppPassword" erledigen: dort wird die oben genannte Herkunft eingetragen.',
    '',
    'PixiNotes verwendet nur GET und PUT auf eine einzelne JSON-Datei im angegebenen',
    'Ordner und meldet sich mit einem App-Passwort an (nicht mit dem Kennwort des',
    'Kontos). Es werden keine Cookies gesetzt.',
    '',
    'Vielen Dank!',
  ].join('\n');
}

/**
 * M390: Schreiben mit Vorbedingung.
 *
 * Vor jedem automatischen Schreiben wird gelesen und ein fremder Stand eingearbeitet (M311). Zwischen diesem Lesen
 * und dem Schreiben liegt aber das Packen der Sicherung — mit Anhängen dauert das Sekunden. Schrieb in dieser Zeit
 * ein zweites Gerät, überschrieb das erste dessen Stand, ohne ihn je gesehen zu haben. Zeigt der Server ein ETag,
 * geht es jetzt als Bedingung mit („nur ersetzen, wenn es noch der gelesene Stand ist"); lehnt er ab (412), wird
 * neu gelesen und zusammengeführt. Server, die die Kopfzeile über CORS nicht zulassen, schreiben wie bisher —
 * das merkt sich die App, statt jedes Mal neu anzuecken.
 */
let davEtag: string | null = null;
const OHNE_BEDINGUNG_KEY = 'pixinotes-webdav-ohne-bedingung';
export class WebdavKonflikt extends Error {}
const bedingungErlaubt = (): boolean => { try { return localStorage.getItem(OHNE_BEDINGUNG_KEY) !== '1'; } catch { return false; } };
const bedingungAus = (): void => { try { localStorage.setItem(OHNE_BEDINGUNG_KEY, '1'); } catch { /* voll */ } davEtag = null; };
/** Schwache ETags (W/…) taugen nicht für If-Match — der Vergleich schlüge immer fehl. */
const etagAus = (res: Response): string | null => { const e = res.headers.get('ETag'); return e && !e.startsWith('W/') ? e : null; };

async function davFetch(cfg: WebdavConfig, init: RequestInit): Promise<Response> {
  try {
    return await fetch(fileUrl(cfg), {
      ...init,
      headers: { Authorization: basicAuth(cfg.user, cfg.secret), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw await friendly(e, cfg);
  }
}

/** Stand vom Server lesen; null = Datei existiert (noch) nicht. */
export async function webdavRead(cfg: WebdavConfig): Promise<SyncPayload | null> {
  const res = await davFetch(cfg, { method: 'GET', cache: 'no-store' });
  davEtag = res.ok ? etagAus(res) : null;
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('Anmeldung abgelehnt – Benutzername/App-Passwort prüfen.');
  if (!res.ok) throw new Error(`WebDAV: HTTP ${res.status}`);
  const p = (await res.json()) as SyncPayload;
  if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0 || !Array.isArray(p.spaces)) return null;
  return (await gestaltLaden()).standVonAussen(p);   // M522: Gestalt prüfen — null, wenn kein gültiges Board darin ist
}

/** Aktuellen Stand hochladen (Allow-List-Payload — ohne Einstellungen/Schlüssel). */
export async function webdavWrite(cfg: WebdavConfig, bedingt = false): Promise<string> {
  const s = useBoard.getState();
  // M269: eine Quelle für alle drei Wege — samt Dateien im Beipack. Was NICHT
  // mitgeht, bleibt unverändert: KI-/Konto-Einstellungen und Zugangsdaten.
  const payload = await buildSyncPayloadMitDateien(s.syncDateienMb ?? DATEI_BUDGET_MB);
  const body = JSON.stringify(payload);
  const ohne = () => davFetch(cfg, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  let res: Response;
  if (bedingt && davEtag && bedingungErlaubt()) {
    try {
      res = await fetch(fileUrl(cfg), { method: 'PUT', headers: { Authorization: basicAuth(cfg.user, cfg.secret), 'Content-Type': 'application/json', 'If-Match': davEtag }, body });
    } catch {
      // Die Vorabfrage des Browsers scheiterte — meist lässt der Server „If-Match" über CORS nicht zu. Ohne
      // Bedingung noch einmal; nur wenn DAS gelingt, lag es an der Kopfzeile (und nicht am Netz).
      res = await ohne();
      if (res.ok || res.status === 201 || res.status === 204) bedingungAus();
    }
    if (res.status === 412) throw new WebdavKonflikt('Der Stand auf dem Server hat sich seit dem Lesen geändert.');
  } else {
    res = await ohne();
  }
  if (res.status === 401 || res.status === 403) throw new Error('Anmeldung abgelehnt – Benutzername/App-Passwort prüfen.');
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`WebDAV: HTTP ${res.status}`);
  davEtag = etagAus(res);
  localStorage.setItem(STAMP_KEY, payload.savedAt);
  await basisMerken('webdav', payload); // M311: gemeinsamer Stand für die Zusammenführung
  // Nur „sauber" markieren, wenn währenddessen nicht weiter editiert wurde
  const cur = useBoard.getState();
  if (cur.spaces === s.spaces && nurAuswahlAnders(s.boards, cur.boards)) localStorage.removeItem(WEBDAV_DIRTY_KEY);
  emitSyncStatus('webdav', 'ok', payload.savedAt);
  return payload.savedAt;
}

/** Verbindung prüfen: erreichbar + Anmeldung ok (404 = ok, Datei kommt noch). */
export async function webdavTest(cfg: WebdavConfig): Promise<'leer' | 'vorhanden'> {
  const p = await webdavRead(cfg);
  return p ? 'vorhanden' : 'leer';
}

/** Geladenen Stand übernehmen. false = konnte NICHT dauerhaft gespeichert
 *  werden (Browser-Speicher voll) — Stempel bleibt dann unangetastet, damit
 *  Stempel und Daten nie auseinanderlaufen (gleiche Regel wie applySync). */
export function applyWebdav(p: SyncPayload): boolean {
  claimWriter(); // Import ist eine bewusste Nutzer-Aktion — dieses Fenster schreibt ab jetzt
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  if (!flushPersist()) return false;
  try {
    localStorage.setItem(STAMP_KEY, p.savedAt);
    localStorage.removeItem(WEBDAV_DIRTY_KEY); // deckungsgleich mit dem Server
    // Gegenüber einem evtl. verbundenen Sync-Ordner ist der Stand jetzt neu
    localStorage.setItem(SYNC_DIRTY_KEY, '1');
    localStorage.setItem(KONTO_DIRTY_KEY, '1');
  } catch { return false; }
  emitSyncStatus('webdav', 'ok', p.savedAt);
  void basisMerken('webdav', p); // M311
  // M269: Beipack nachgelagert in die lokale Ablage (wie applySync)
  void uebernimmDateien(p).then((n) => {
    if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
  });
  return true;
}

// ---------- Auto-Sync (gleiche Zusammenführung wie der Sync-Ordner, M311) ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

const webdavWeg = (cfg: WebdavConfig): SyncWeg => ({
  source: 'webdav',
  stampKey: STAMP_KEY,
  dirtyKey: WEBDAV_DIRTY_KEY,
  // M390: Auch das Ergebnis einer Zusammenführung geht nur mit Vorbedingung hinaus. War schon wieder jemand
  // schneller, liest der nächste Durchlauf neu und führt erneut zusammen (lokal liegt der vereinte Stand bereits).
  schreiben: async () => {
    try { return await webdavWrite(cfg, true); } catch (e) {
      if (!(e instanceof WebdavKonflikt)) throw e;
      setTimeout(() => { void autoPush().catch(() => {}); }, 400);
      return webdavStamp() ?? '';
    }
  },
  uebernehmen: applyWebdav,
});

/** Server prüfen und einen fremden Stand einarbeiten — mit Basis (M311)
 *  zusammengeführt, ohne Basis wie früher: nur ohne eigene Änderungen
 *  übernehmen, sonst ehrlicher Hinweis. */
export async function checkWebdavRemote(): Promise<void> {
  const now = Date.now();
  if (now - lastRemoteCheck < 60_000) return; // Netz-Zugriff: sparsamer prüfen
  if (getWriterRole() !== 'writer') return;
  const cfg = loadWebdav();
  if (!cfg) return;
  lastRemoteCheck = now;
  const remote = await webdavRead(cfg);
  if (!remote || remote.savedAt === webdavStamp()) {
    staleHintShown = false;
    if (remote) emitSyncStatus('webdav', 'ok', remote.savedAt); // in sync
    return;
  }
  const r = await fremdStandEinarbeiten(remote, webdavWeg(cfg));
  if (r === 'uebernommen') {
    useBoard.getState().showToast(`Neuerer Stand vom WebDAV-Server übernommen (${new Date(remote.savedAt).toLocaleString('de-DE')}).`);
    staleHintShown = false;
  } else if (r === 'konflikt') {
    emitSyncStatus('webdav', 'conflict');
    if (!staleHintShown) {
      staleHintShown = true;
      useBoard.getState().showToast('Server und lokaler Stand weichen ab, nichts überschrieben. Wählen: Einstellungen → Daten.');
    }
  } else if (r === 'fehler') {
    emitSyncStatus('webdav', 'error');
  } else {
    staleHintShown = false;
  }
}

async function autoPush(versuch = 0): Promise<void> {
  if (getWriterRole() !== 'writer') return; // Mitlese-Fenster synct nie
  const cfg = loadWebdav();
  if (!cfg?.auto) return;
  emitSyncStatus('webdav', 'pending');
  try {
    const remote = await webdavRead(cfg);
    // Fremder Stand auf dem Server → zusammenführen (M311) statt warnen;
    // geschrieben wird dann das Ergebnis mit beiden Anteilen
    if (remote && remote.savedAt !== webdavStamp()) {
      const r = await fremdStandEinarbeiten(remote, webdavWeg(cfg));
      if (r === 'konflikt') {
        emitSyncStatus('webdav', 'conflict');
        if (!conflictWarned) {
          conflictWarned = true;
          useBoard.getState().showToast('Der WebDAV-Server hat einen anderen Stand. Laden oder überschreiben: Einstellungen → Daten.');
        }
        return;
      }
      if (r === 'fehler') { emitSyncStatus('webdav', 'error'); return; }
      if (r === 'spaeter') { setTimeout(() => { void autoPush().catch(() => {}); }, 3000); return; }
      conflictWarned = false;
      return;
    }
    try {
      await webdavWrite(cfg, true); // meldet bei Erfolg selbst 'ok'
    } catch (e) {
      if (!(e instanceof WebdavKonflikt)) throw e;
      // M390: Jemand war schneller. Neu lesen — liegt wirklich ein anderer Stand da, führt der nächste Durchlauf
      // zusammen. Liegt derselbe da, vergleicht der Server ETags anders als gedacht: dann ohne Bedingung.
      const nochmal = await webdavRead(cfg);
      if (nochmal && nochmal.savedAt !== webdavStamp()) {
        if (versuch < 3) return await autoPush(versuch + 1);
        emitSyncStatus('webdav', 'error');
        return;
      }
      bedingungAus();
      await webdavWrite(cfg);
    }
    conflictWarned = false;
  } catch (e) {
    emitSyncStatus('webdav', 'error');
    throw e; // Aufrufer behandelt (offline o. Ä.)
  }
}

/** Einmal beim App-Start aufrufen: lädt Hinweise & pusht Änderungen automatisch. */
export function initWebdavSync(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBoard.subscribe((s, prev) => {
    if (s.spaces === prev.spaces && nurAuswahlAnders(prev.boards, s.boards)) return;   // M345: Auswählen ist keine Änderung
    // Frisch importierter Stand: kein Re-Upload mit neuem savedAt (s. syncFolder)
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return;
    // Dirty auch hier setzen — auf Browsern ohne Ordner-API (Firefox) läuft
    // der syncFolder-Subscribe nicht, WebDAV aber sehr wohl. Abgeleitete
    // Änderungen (Auto-Einsammeln) zählen nicht als eigene Bearbeitung.
    if (!inDerived()) {
      notiereAenderung();
      try { localStorage.setItem(WEBDAV_DIRTY_KEY, '1'); localStorage.setItem(SYNC_DIRTY_KEY, '1'); localStorage.setItem(KONTO_DIRTY_KEY, '1'); } catch { /* voll → sicherer ohne Fast-Forward */ }
    }
    if (!loadWebdav()?.auto) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void autoPush().catch(() => { /* offline o. Ä. — nächster Versuch beim nächsten Edit */ }); }, 2500);
  });
  // Start-Check: neuerer Stand auf dem Server? → Fast-Forward (sonst Hinweis)
  void checkWebdavRemote().catch(() => {});
  // Beim Zurückkehren ins Fenster erneut prüfen (anderes Gerät kann gepusht haben)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkWebdavRemote().catch(() => {});
  });
}
