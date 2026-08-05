// M190: Synchronisation über die Dateien-App — der einzige Weg, der auf
// iPad/iPhone wirklich funktioniert.
//
// Ausgangslage (keine PixiNotes-Schwäche, sondern eine harte Plattformgrenze):
// - Auf iPadOS/iOS steckt in JEDEM Browser WebKit. Die File System Access API
//   (`showDirectoryPicker`) gibt es dort nicht — eine Webseite kann also
//   keinen Ordner anfassen. Der Sync-Ordner-Weg fällt damit komplett aus.
// - WebDAV direkt scheitert an CORS: Nextcloud erlaubt Browser-Zugriffe auf
//   /remote.php/dav standardmäßig nicht. Das betrifft alle Browser gleich,
//   nur kann man auf dem Desktop auf den Sync-Ordner ausweichen.
//
// Was iPadOS SEHR WOHL kann:
// - Dateien AUSWÄHLEN (<input type="file">) — und die Dateien-App zeigt die
//   Nextcloud als Speicherort an, sobald die Nextcloud-App installiert ist.
// - Dateien TEILEN (navigator.share mit files) → „In Dateien sichern" →
//   Zielordner wählen. Damit landet die Datei direkt in der Nextcloud.
//
// Der Clou: Wir schreiben exakt dieselbe `pixinotes-daten.json` im selben
// Format wie der Sync-Ordner. Legt das iPad sie in den Nextcloud-Ordner, den
// der Desktop-Client spiegelt, übernimmt der Desktop den Stand automatisch —
// und umgekehrt. Echte Zwei-Wege-Synchronisation, auf dem iPad eben mit einem
// bewussten Tipp statt automatisch.
import {
  applySync, buildSyncPayload, emitSyncStatus, knownStamp, markSynced,
  SYNC_DIRTY_KEY, SYNC_FILE_NAME, syncSupported, type SyncPayload,
} from './syncFolder';
import { triggerDownload } from './download';
import { getWriterRole, inDerived, isImportedState, useBoard } from '../store';

const ON_KEY = 'pixinotes:files-sync';

/** iPad/iPhone (inkl. iPadOS, das sich als „MacIntel" mit Touch ausgibt) */
export function isAppleTouch(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Mac/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Läuft die App vom Home-Bildschirm (installiert) statt im Safari-Tab? */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as { standalone?: boolean }).standalone === true;
}

/** Kann das Gerät Dateien über das System-Teilen-Blatt weitergeben? */
export function canShareFiles(): boolean {
  try {
    const probe = new File(['{}'], SYNC_FILE_NAME, { type: 'application/json' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export const filesSyncOn = (): boolean => localStorage.getItem(ON_KEY) === '1';
export function setFilesSyncOn(on: boolean): void {
  if (on) localStorage.setItem(ON_KEY, '1');
  else localStorage.removeItem(ON_KEY);
}

/** Ungesicherte Änderungen? (gleiches Flag wie der Sync-Ordner — es ist
 *  dieselbe Zieldatei, nur ein anderer Transportweg) */
export const filesSyncDirty = (): boolean => localStorage.getItem(SYNC_DIRTY_KEY) === '1';

export const filesSyncStamp = knownStamp;

export type SaveWay = 'geteilt' | 'geladen';

/**
 * Aktuellen Stand als `pixinotes-daten.json` ausgeben. Bevorzugt über das
 * System-Teilen-Blatt („In Dateien sichern" → Nextcloud-Ordner), sonst als
 * normaler Download.
 *
 * Wichtig: Der Stempel wird erst NACH dem erfolgreichen Teilen gesetzt.
 * Bricht der Nutzer das Blatt ab, gilt der Stand weiter als ungesichert —
 * lieber einmal zu viel erinnern als stillschweigend Daten verlieren.
 */
export async function saveViaFiles(): Promise<SaveWay> {
  const payload = buildSyncPayload();
  const file = new File([JSON.stringify(payload)], SYNC_FILE_NAME, { type: 'application/json' });
  setFilesSyncOn(true);
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: 'PixiNotes-Stand' });
      markSynced(payload, 'dateien');
      return 'geteilt';
    } catch (e) {
      // AbortError = Nutzer hat das Blatt geschlossen: kein Fehler, aber auch
      // kein Sicherungspunkt. Alles andere (z. B. NotAllowedError, wenn die
      // Geste verloren ging) fällt auf den Download zurück.
      if ((e as { name?: string }).name === 'AbortError') throw new Error('abgebrochen');
    }
  }
  const url = URL.createObjectURL(file);
  triggerDownload(url, SYNC_FILE_NAME);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markSynced(payload, 'dateien');
  return 'geladen';
}

/** Gewählte Datei prüfen und als Sync-Stand zurückgeben (null = passt nicht) */
export async function readSyncFile(file: File): Promise<SyncPayload | null> {
  try {
    const p = JSON.parse(await file.text()) as SyncPayload;
    if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0 || !Array.isArray(p.spaces)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Stand aus der Dateien-App übernehmen (gleiche Buchführung wie der Ordner) */
export function applyFilesSync(p: SyncPayload): boolean {
  setFilesSyncOn(true);
  return applySync(p, 'dateien');
}

// ---------- Erinnerung statt Automatik ----------
let started = false;

/**
 * Auf Geräten ohne Ordner-API kann nichts automatisch speichern. Damit das
 * nicht heimlich auseinanderläuft, meldet der Dateien-Weg ungesicherte
 * Änderungen an die Wolke in der Kopfleiste — ein Tipp darauf sichert.
 */
export function initFilesSync(): void {
  if (started) return;
  started = true;
  const ping = () => {
    if (!filesSyncOn()) return;
    if (filesSyncDirty()) emitSyncStatus('dateien', 'manual');
    else emitSyncStatus('dateien', 'ok', filesSyncStamp() ?? undefined);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    if (isImportedState(s.boards, s.spaces)) return;
    if (getWriterRole() !== 'writer') return;
    // Ohne Ordner-API läuft der Subscribe aus syncFolder.ts nicht — das
    // Dirty-Flag muss hier gesetzt werden, sonst merkt niemand die Änderung.
    if (!syncSupported() && !inDerived()) {
      try { localStorage.setItem(SYNC_DIRTY_KEY, '1'); } catch { /* Speicher voll */ }
    }
    clearTimeout(timer);
    timer = setTimeout(ping, 2000);
  });
  ping();
}
