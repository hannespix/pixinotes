// Synchronisation über einen lokalen Sync-Ordner (Nextcloud, OneDrive, Dropbox …):
// Die App speichert ihren kompletten Stand als JSON-Datei in einen Ordner, den
// der Desktop-Client des Cloud-Dienstes auf alle Geräte spiegelt. Kein Server,
// kein CORS, keine App-Passwörter — funktioniert überall, wo der Sync-Client läuft.
// Das Ordner-Handle wird in IndexedDB gemerkt (übersteht Neustarts in Chrome/Edge).
import { useBoard, type BoardDoc, type Space } from '../store';

const FILE_NAME = 'pixinotes-daten.json';
const DB_NAME = 'pixinotes-sync';
const STAMP_KEY = 'pixinotes:sync-stamp';

export interface SyncPayload {
  app: 'pixinotes';
  version: 2;
  savedAt: string;
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
}

// Minimale Typen für die File System Access API (nicht in allen TS-Libs)
interface SyncFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
}
export interface SyncDirHandle {
  name: string;
  queryPermission?(o: { mode: string }): Promise<PermissionState>;
  requestPermission?(o: { mode: string }): Promise<PermissionState>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<SyncFileHandle>;
}

export const syncSupported = (): boolean => 'showDirectoryPicker' in window;

// ---------- IndexedDB: Ordner-Handle merken ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Handle-Verwaltung ----------
// Session-Cache: greift auch, wenn IndexedDB das Handle nicht persistieren kann
let cachedHandle: SyncDirHandle | undefined;

export async function pickSyncFolder(): Promise<SyncDirHandle> {
  const picker = (window as unknown as { showDirectoryPicker(o?: unknown): Promise<SyncDirHandle> }).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite', id: 'pixinotes-sync' });
  cachedHandle = handle;
  try { await idbSet('dir', handle); } catch { /* Handle gilt dann nur für diese Sitzung */ }
  return handle;
}

export async function getSyncHandle(): Promise<SyncDirHandle | undefined> {
  if (cachedHandle) return cachedHandle;
  try {
    cachedHandle = await idbGet<SyncDirHandle>('dir');
  } catch { /* IndexedDB nicht verfügbar */ }
  return cachedHandle;
}

export async function disconnectSync(): Promise<void> {
  cachedHandle = undefined;
  try { await idbDel('dir'); } catch { /* egal — Cache ist weg */ }
  localStorage.removeItem(STAMP_KEY);
}

/** true = Zugriff erlaubt (fragt nur nach, wenn `ask`) */
export async function ensurePermission(handle: SyncDirHandle, ask: boolean): Promise<boolean> {
  const q = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (q === 'granted') return true;
  if (!ask) return false;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** Aktueller Berechtigungs-Status ohne Nachfrage */
export async function permissionState(handle: SyncDirHandle): Promise<'granted' | 'prompt'> {
  const q = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  return q === 'granted' ? 'granted' : 'prompt';
}

// ---------- Lesen / Schreiben ----------
export async function readSync(handle: SyncDirHandle): Promise<SyncPayload | null> {
  try {
    const fh = await handle.getFileHandle(FILE_NAME);
    const text = await (await fh.getFile()).text();
    const p = JSON.parse(text) as SyncPayload;
    if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0 || !Array.isArray(p.spaces)) return null;
    return p;
  } catch {
    return null; // Datei existiert (noch) nicht oder ist unlesbar
  }
}

export async function writeSync(handle: SyncDirHandle): Promise<string> {
  const s = useBoard.getState();
  const payload: SyncPayload = {
    app: 'pixinotes',
    version: 2,
    savedAt: new Date().toISOString(),
    boards: s.boards,
    spaces: s.spaces,
    activeId: s.activeId,
    // bewusst OHNE KI-Einstellungen: API-Schlüssel bleiben auf dem Gerät
  };
  const fh = await handle.getFileHandle(FILE_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(payload));
  await w.close();
  localStorage.setItem(STAMP_KEY, payload.savedAt);
  return payload.savedAt;
}

export function applySync(p: SyncPayload): void {
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  localStorage.setItem(STAMP_KEY, p.savedAt);
}

export const knownStamp = (): string | null => localStorage.getItem(STAMP_KEY);

// ---------- Auto-Sync ----------
let started = false;
let conflictWarned = false;

async function autoSave(): Promise<void> {
  const handle = await getSyncHandle();
  if (!handle || !(await ensurePermission(handle, false))) return;
  const remote = await readSync(handle);
  // Konfliktschutz: hat ein anderes Gerät seit unserem letzten Sync geschrieben?
  if (remote && knownStamp() && remote.savedAt !== knownStamp()) {
    if (!conflictWarned) {
      conflictWarned = true;
      useBoard.getState().showToast('⚠️ Der Sync-Ordner hat einen neueren Stand (anderes Gerät?). In ⚙️ → Synchronisation laden oder überschreiben.');
    }
    return;
  }
  await writeSync(handle);
  conflictWarned = false;
}

/** Einmal beim App-Start aufrufen: speichert Änderungen automatisch in den Sync-Ordner. */
export function initAutoSync(): void {
  if (started || !syncSupported()) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void autoSave().catch(() => {}); }, 1800);
  });
  // Start-Check: Berechtigung erloschen? Neuerer Stand im Ordner? (nur Hinweise, nie Auto-Laden)
  void (async () => {
    const handle = await getSyncHandle();
    if (!handle) return;
    if (!(await ensurePermission(handle, false))) {
      // Browser hat den Zugriff nach Neustart zurückgesetzt — ehrlich sagen,
      // statt den Auto-Sync still zu deaktivieren
      useBoard.getState().showToast('Sync-Ordner verbunden, aber der Browser braucht eine neue Freigabe — in ⚙️ → Synchronisation „Zugriff erlauben" klicken.');
      return;
    }
    const remote = await readSync(handle);
    if (remote && remote.savedAt !== knownStamp()) {
      useBoard.getState().showToast('Im Sync-Ordner liegt ein anderer Stand — in ⚙️ → Synchronisation laden.');
    }
  })().catch(() => {});
}
