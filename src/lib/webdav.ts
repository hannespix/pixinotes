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
import { useBoard } from '../store';
import type { SyncPayload } from './syncFolder';

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

/** Netzwerk-/CORS-Fehler in verständliche Meldungen übersetzen */
function friendly(e: unknown): Error {
  if (e instanceof TypeError) {
    return new Error(
      'Server nicht erreichbar oder CORS blockiert. Nextcloud/ownCloud erlauben Browser-Zugriffe erst, '
      + 'wenn die IT diese Adresse als erlaubte Origin einträgt — Alternative: Sync-Ordner (Desktop-Client).',
    );
  }
  return e as Error;
}

async function davFetch(cfg: WebdavConfig, init: RequestInit): Promise<Response> {
  try {
    return await fetch(fileUrl(cfg), {
      ...init,
      headers: { Authorization: basicAuth(cfg.user, cfg.secret), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw friendly(e);
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
  return payload.savedAt;
}

/** Verbindung prüfen: erreichbar + Anmeldung ok (404 = ok, Datei kommt noch). */
export async function webdavTest(cfg: WebdavConfig): Promise<'leer' | 'vorhanden'> {
  const p = await webdavRead(cfg);
  return p ? 'vorhanden' : 'leer';
}

export function applyWebdav(p: SyncPayload): void {
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  localStorage.setItem(STAMP_KEY, p.savedAt);
}

// ---------- Auto-Sync (gleiches Konfliktschema wie der Sync-Ordner) ----------
let started = false;
let conflictWarned = false;

async function autoPush(): Promise<void> {
  const cfg = loadWebdav();
  if (!cfg?.auto) return;
  const remote = await webdavRead(cfg);
  // Fremder/neuerer Stand auf dem Server → warnen statt überschreiben
  if (remote && remote.savedAt !== webdavStamp()) {
    if (!conflictWarned) {
      conflictWarned = true;
      useBoard.getState().showToast('⚠️ Auf dem WebDAV-Server liegt ein neuerer Stand (anderes Gerät?). In ⚙️ → Synchronisation laden oder überschreiben.');
    }
    return;
  }
  await webdavWrite(cfg);
  conflictWarned = false;
}

/** Einmal beim App-Start aufrufen: lädt Hinweise & pusht Änderungen automatisch. */
export function initWebdavSync(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    if (!loadWebdav()?.auto) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void autoPush().catch(() => { /* offline o. Ä. — nächster Versuch beim nächsten Edit */ }); }, 2500);
  });
  // Start-Check: neuerer Stand auf dem Server? (nur Hinweis, nie Auto-Laden)
  void (async () => {
    const cfg = loadWebdav();
    if (!cfg) return;
    const remote = await webdavRead(cfg);
    if (remote && remote.savedAt !== webdavStamp()) {
      useBoard.getState().showToast('☁️ Auf dem WebDAV-Server liegt ein anderer Stand — in ⚙️ → Synchronisation laden.');
    }
  })().catch(() => {});
}
