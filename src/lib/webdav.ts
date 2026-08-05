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
import { emitSyncStatus, SYNC_DIRTY_KEY, WEBDAV_DIRTY_KEY, type SyncPayload } from './syncFolder';

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
}

export function clearWebdav() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(STAMP_KEY);
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
        'Die Server-Adresse beginnt mit http:// — eine über https ausgelieferte Seite darf das nicht aufrufen '
        + '(„Mixed Content"). Bitte https:// verwenden.',
      );
    }
    try {
      await fetch(fileUrl(cfg), { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      return new Error(
        `Der Server ist erreichbar, blockiert aber Browser-Zugriffe (fehlende CORS-Freigabe). Das liegt am Server, nicht am Gerät — ${apple() ? 'auf dem iPad ist es genauso wie auf jedem anderen Browser' : 'jeder Browser verhält sich hier gleich'}. `
        + 'Nötig ist eine einmalige Freigabe durch die IT (bei Nextcloud z. B. die App „WebAppPassword" mit dieser PixiNotes-Adresse als erlaubte Herkunft). '
        + 'In ⚙️ → Synchronisation steht ein fertiger Text für die IT zum Kopieren. '
        + `Ohne Freigabe funktioniert ${apple() ? 'auf dem iPad die Synchronisation über die Dateien-App' : 'der Sync-Ordner oder der Datei-Export'}.`,
      );
    } catch {
      return new Error(
        'Server nicht erreichbar — Adresse prüfen (Tippfehler? VPN/Firewall? HTTPS?). '
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
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('Anmeldung abgelehnt — Benutzername/App-Passwort prüfen.');
  if (!res.ok) throw new Error(`WebDAV: HTTP ${res.status}`);
  const p = (await res.json()) as SyncPayload;
  if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0 || !Array.isArray(p.spaces)) return null;
  return p;
}

/** Aktuellen Stand hochladen (Allow-List-Payload — ohne Einstellungen/Schlüssel). */
export async function webdavWrite(cfg: WebdavConfig): Promise<string> {
  const s = useBoard.getState();
  const payload: SyncPayload = {
    app: 'pixinotes',
    version: 2,
    savedAt: new Date().toISOString(),
    boards: s.boards,
    spaces: s.spaces,
    activeId: s.activeId,
    // bewusst OHNE KI-/Konto-Einstellungen: Schlüssel bleiben auf dem Gerät
  };
  const res = await davFetch(cfg, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Anmeldung abgelehnt — Benutzername/App-Passwort prüfen.');
  if (!res.ok && res.status !== 201 && res.status !== 204) throw new Error(`WebDAV: HTTP ${res.status}`);
  localStorage.setItem(STAMP_KEY, payload.savedAt);
  // Nur „sauber" markieren, wenn währenddessen nicht weiter editiert wurde
  const cur = useBoard.getState();
  if (cur.boards === s.boards && cur.spaces === s.spaces) localStorage.removeItem(WEBDAV_DIRTY_KEY);
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
  } catch { return false; }
  emitSyncStatus('webdav', 'ok', p.savedAt);
  return true;
}

// ---------- Auto-Sync (gleiches Konfliktschema wie der Sync-Ordner) ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

/** Server prüfen und einen neueren Fremd-Stand GEFAHRLOS automatisch übernehmen
 *  (Fast-Forward, M82) — gleiche Regeln wie beim Sync-Ordner: nur als Schreiber
 *  und nur ohne eigene lokale Änderungen seit dem letzten Sync. */
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
  if (!localStorage.getItem(WEBDAV_DIRTY_KEY) && applyWebdav(remote)) {
    useBoard.getState().showToast(`☁️ Neuerer Stand vom WebDAV-Server übernommen (${new Date(remote.savedAt).toLocaleString('de-DE')}).`);
    staleHintShown = false;
    return;
  }
  emitSyncStatus('webdav', 'conflict');
  if (!staleHintShown) {
    staleHintShown = true;
    useBoard.getState().showToast('☁️ Auf dem WebDAV-Server liegt ein anderer Stand — hier gibt es aber eigene Änderungen, darum wurde nichts überschrieben. In ⚙️ → Synchronisation wählen.');
  }
}

async function autoPush(): Promise<void> {
  if (getWriterRole() !== 'writer') return; // Mitlese-Fenster synct nie
  const cfg = loadWebdav();
  if (!cfg?.auto) return;
  emitSyncStatus('webdav', 'pending');
  try {
    const remote = await webdavRead(cfg);
    // Fremder/neuerer Stand auf dem Server → warnen statt überschreiben
    if (remote && remote.savedAt !== webdavStamp()) {
      emitSyncStatus('webdav', 'conflict');
      if (!conflictWarned) {
        conflictWarned = true;
        useBoard.getState().showToast('⚠️ Auf dem WebDAV-Server liegt ein neuerer Stand (anderes Gerät?). In ⚙️ → Synchronisation laden oder überschreiben.');
      }
      return;
    }
    await webdavWrite(cfg); // meldet bei Erfolg selbst 'ok'
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
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    // Frisch importierter Stand: kein Re-Upload mit neuem savedAt (s. syncFolder)
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return;
    // Dirty auch hier setzen — auf Browsern ohne Ordner-API (Firefox) läuft
    // der syncFolder-Subscribe nicht, WebDAV aber sehr wohl. Abgeleitete
    // Änderungen (Auto-Einsammeln) zählen nicht als eigene Bearbeitung.
    if (!inDerived()) {
      try { localStorage.setItem(WEBDAV_DIRTY_KEY, '1'); localStorage.setItem(SYNC_DIRTY_KEY, '1'); } catch { /* voll → sicherer ohne Fast-Forward */ }
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
