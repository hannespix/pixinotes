// Synchronisation über einen lokalen Sync-Ordner (Nextcloud, OneDrive, Dropbox …):
// Die App speichert ihren kompletten Stand als JSON-Datei in einen Ordner, den
// der Desktop-Client des Cloud-Dienstes auf alle Geräte spiegelt. Kein Server,
// kein CORS, keine App-Passwörter — funktioniert überall, wo der Sync-Client läuft.
// Das Ordner-Handle wird in IndexedDB gemerkt (übersteht Neustarts in Chrome/Edge).
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard, type BoardDoc, type Space } from '../store';

const FILE_NAME = 'pixinotes-daten.json';
const DB_NAME = 'pixinotes-sync';
const STAMP_KEY = 'pixinotes:sync-stamp';

// „Dirty"-Flags (M82): Gibt es lokale Änderungen, die noch nicht im jeweiligen
// Sync-Ziel liegen? Nur wenn NEIN, darf ein neuerer Fremd-Stand beim Start
// automatisch übernommen werden (Fast-Forward) — sonst wäre es ein echter
// Konflikt und der Nutzer entscheidet. Bewusst ohne Uhrzeit-Vergleiche
// (Geräte-Uhren gehen auseinander), nur gesetzt/gelöscht.
export const SYNC_DIRTY_KEY = 'pixinotes:sync-dirty';
export const WEBDAV_DIRTY_KEY = 'pixinotes:webdav-dirty';

// Sync-Status für die Kopfleisten-Anzeige (M85): Der Auto-Sync arbeitete
// bisher komplett unsichtbar — schlief er (Freigabe nach Neustart weg,
// Konflikt, Fehler), wirkte das wie „speichert nicht". Jeder Zustandswechsel
// wird jetzt als Event gemeldet; SyncStatus.tsx zeigt ihn dauerhaft an.
export type SyncState = 'ok' | 'pending' | 'noperm' | 'conflict' | 'error';
export function emitSyncStatus(source: 'ordner' | 'webdav', state: SyncState, at?: string): void {
  window.dispatchEvent(new CustomEvent('pixinotes:sync-status', { detail: { source, state, at } }));
}

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
  // Lokale Änderungen liegen jetzt im Ordner — aber nur als „sauber" markieren,
  // wenn währenddessen nicht weiter editiert wurde (sonst nächster Auto-Save)
  const cur = useBoard.getState();
  if (cur.boards === s.boards && cur.spaces === s.spaces) localStorage.removeItem(SYNC_DIRTY_KEY);
  emitSyncStatus('ordner', 'ok', payload.savedAt);
  return payload.savedAt;
}

/** Geladenen Stand übernehmen. false = konnte NICHT dauerhaft gespeichert
 *  werden (Browser-Speicher voll) — dann bleibt auch der Sync-Stempel
 *  unangetastet, damit Stempel und Daten nie auseinanderlaufen (Audit M81:
 *  vorher stand der Stempel schon auf „synchron", während die Daten noch
 *  400 ms im Puffer hingen — ein Crash in dem Fenster hinterließ den alten
 *  Stand mit neuem Stempel, und der nächste Auto-Save überschrieb still
 *  den Sync-Ordner). */
export function applySync(p: SyncPayload): boolean {
  claimWriter(); // Import ist eine bewusste Nutzer-Aktion — dieses Fenster schreibt ab jetzt
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  if (!flushPersist()) return false;
  try {
    localStorage.setItem(STAMP_KEY, p.savedAt);
    localStorage.removeItem(SYNC_DIRTY_KEY); // deckungsgleich mit dem Ordner
    // Gegenüber einem evtl. verbundenen WebDAV-Server ist der Stand jetzt neu
    localStorage.setItem(WEBDAV_DIRTY_KEY, '1');
  } catch { return false; }
  emitSyncStatus('ordner', 'ok', p.savedAt);
  return true;
}

export const knownStamp = (): string | null => localStorage.getItem(STAMP_KEY);

// ---------- Auto-Sync ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

/** Ordner prüfen und einen neueren Fremd-Stand GEFAHRLOS automatisch übernehmen
 *  (Fast-Forward, M82): nur wenn dieses Fenster der Schreiber ist und es seit
 *  dem letzten Sync keine eigenen lokalen Änderungen gab. Sonst bleibt es beim
 *  ehrlichen Hinweis — echte Konflikte entscheidet der Nutzer. Genau das
 *  erwartet man von „Synchronisation": Nach einem Neustart steht der neueste
 *  Stand da, ohne erst in ⚙️ klicken zu müssen. */
export async function checkSyncRemote(): Promise<void> {
  const now = Date.now();
  if (now - lastRemoteCheck < 15_000) return; // Fokus-Wechsel nicht hämmern
  if (getWriterRole() !== 'writer') return;   // Mitlese-Fenster folgt dem Schreiber
  const handle = await getSyncHandle();
  if (!handle || !(await ensurePermission(handle, false))) return;
  lastRemoteCheck = now;
  const remote = await readSync(handle);
  if (!remote || remote.savedAt === knownStamp()) {
    staleHintShown = false;
    if (remote) emitSyncStatus('ordner', 'ok', remote.savedAt); // in sync
    return;
  }
  if (!localStorage.getItem(SYNC_DIRTY_KEY) && applySync(remote)) {
    useBoard.getState().showToast(`☁️ Neuerer Stand aus dem Sync-Ordner übernommen (${new Date(remote.savedAt).toLocaleString('de-DE')}).`);
    staleHintShown = false;
    return;
  }
  emitSyncStatus('ordner', 'conflict');
  if (!staleHintShown) {
    staleHintShown = true;
    useBoard.getState().showToast('Im Sync-Ordner liegt ein anderer Stand — hier gibt es aber eigene Änderungen, darum wurde nichts überschrieben. In ⚙️ → Synchronisation wählen.');
  }
}

/** Status-Chip „Freigabe nötig": Zugriff neu erteilen (braucht eine Nutzer-
 *  Geste, deshalb nicht automatisch möglich) und den Sync sofort fortsetzen. */
export async function regrantSyncAccess(): Promise<boolean> {
  const handle = await getSyncHandle();
  if (!handle || !(await ensurePermission(handle, true))) return false;
  useBoard.getState().showToast('Zugriff erlaubt — Auto-Sync läuft wieder.');
  await checkSyncRemote().catch(() => {});
  if (localStorage.getItem(SYNC_DIRTY_KEY)) await autoSave().catch(() => {});
  return true;
}

async function autoSave(): Promise<void> {
  if (getWriterRole() !== 'writer') return; // Mitlese-Fenster synct nie
  const handle = await getSyncHandle();
  if (!handle) return;
  if (!(await ensurePermission(handle, false))) {
    // Freigabe weg (typisch nach Browser-/PWA-Neustart): bisher schlief der
    // Auto-Sync hier LAUTLOS ein — jetzt zeigt der Status-Chip es dauerhaft an
    emitSyncStatus('ordner', 'noperm');
    return;
  }
  emitSyncStatus('ordner', 'pending');
  try {
    const remote = await readSync(handle);
    // Konfliktschutz: hat ein anderes Gerät seit unserem letzten Sync geschrieben?
    // WICHTIG: auch OHNE eigenen Stempel (frisch verbundenes Gerät) gilt fremder
    // Bestand als Konflikt — sonst überschreibt das erste lokale Edit die Daten
    // des anderen Geräts (Audit R6-S4)
    if (remote && remote.savedAt !== knownStamp()) {
      emitSyncStatus('ordner', 'conflict');
      if (!conflictWarned) {
        conflictWarned = true;
        useBoard.getState().showToast('⚠️ Der Sync-Ordner hat einen neueren Stand (anderes Gerät?). In ⚙️ → Synchronisation laden oder überschreiben.');
      }
      return;
    }
    await writeSync(handle); // meldet bei Erfolg selbst 'ok'
    conflictWarned = false;
  } catch {
    emitSyncStatus('ordner', 'error');
  }
}

/** Einmal beim App-Start aufrufen: speichert Änderungen automatisch in den Sync-Ordner. */
export function initAutoSync(): void {
  if (started || !syncSupported()) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    // Frisch importierter Stand (Sync/Datei/anderes Fenster): nichts Neues zu
    // sichern — ein Re-Upload mit neuem savedAt würde auf allen anderen
    // Geräten nur falsche „fremder Stand"-Warnungen auslösen
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return; // Mitleser markiert/synct nichts
    // Echte lokale Änderung → ab jetzt kein automatisches Fast-Forward mehr.
    // Abgeleitete Änderungen (Kanban-Auto-Einsammeln) zählen nicht — sie sind
    // rekonstruierbar und dürfen die Übernahme eines Sync-Stands nicht blocken.
    if (!inDerived()) {
      try { localStorage.setItem(SYNC_DIRTY_KEY, '1'); localStorage.setItem(WEBDAV_DIRTY_KEY, '1'); } catch { /* voll → sicherer ohne Fast-Forward */ }
    }
    clearTimeout(timer);
    timer = setTimeout(() => { void autoSave().catch(() => {}); }, 1800);
  });
  // Start-Check: Berechtigung erloschen? Neuerer Stand im Ordner? → Fast-Forward
  void (async () => {
    const handle = await getSyncHandle();
    if (!handle) return;
    if (!(await ensurePermission(handle, false))) {
      // Browser hat den Zugriff nach Neustart zurückgesetzt — ehrlich sagen,
      // statt den Auto-Sync still zu deaktivieren; der Status-Chip bleibt
      // sichtbar und erteilt die Freigabe per Klick
      emitSyncStatus('ordner', 'noperm');
      useBoard.getState().showToast('Sync-Ordner verbunden, aber der Browser braucht eine neue Freigabe — oben auf „Zugriff erlauben" klicken.');
      return;
    }
    await checkSyncRemote();
    // Ausstehende Änderungen aus der letzten Sitzung (z. B. Fenster innerhalb
    // der Speicher-Verzögerung geschlossen) jetzt nachschreiben — bisher
    // passierte das erst bei der NÄCHSTEN Bearbeitung
    if (localStorage.getItem(SYNC_DIRTY_KEY)) void autoSave().catch(() => {});
  })().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Beim Zurückkehren prüfen: der Cloud-Client kann die Datei inzwischen
      // von einem anderen Gerät hereingespiegelt haben
      void checkSyncRemote().catch(() => {});
    } else if (localStorage.getItem(SYNC_DIRTY_KEY)) {
      // Fenster verlassen: sofort sichern statt auf die 1,8-s-Verzögerung zu
      // hoffen — sonst fehlt beim schnellen Schließen der letzte Stand
      clearTimeout(timer);
      void autoSave().catch(() => {});
    }
  });
}
