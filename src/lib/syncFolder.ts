// Synchronisation über einen lokalen Sync-Ordner (Nextcloud, OneDrive, Dropbox …):
// Die App speichert ihren kompletten Stand als JSON-Datei in einen Ordner, den
// der Desktop-Client des Cloud-Dienstes auf alle Geräte spiegelt. Kein Server,
// kein CORS, keine App-Passwörter — funktioniert überall, wo der Sync-Client läuft.
// Das Ordner-Handle wird in IndexedDB gemerkt (übersteht Neustarts in Chrome/Edge).
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard, type BoardDoc, type Space } from '../store';
import { berichtAlsSatz, dreiWegeMerge, type SyncStand } from './syncMerge';

/** Dateiname im Sync-Ordner — auch der Dateien-App-Weg (M190) schreibt GENAU
 *  diese Datei, damit ein iPad und ein Desktop denselben Nextcloud-Ordner
 *  benutzen können. */
export const SYNC_FILE_NAME = 'pixinotes-daten.json';
const FILE_NAME = SYNC_FILE_NAME;
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
// 'manual' (M190) ist der Zustand des Dateien-App-Wegs: Es gibt Änderungen,
// die nur ein bewusster Tipp sichern kann — auf iPad/iPhone darf der Browser
// keinen Ordner anfassen, also kann NICHTS automatisch laufen.
export type SyncState = 'ok' | 'pending' | 'noperm' | 'conflict' | 'error' | 'manual';
export type SyncSource = 'ordner' | 'webdav' | 'dateien';
export function emitSyncStatus(source: SyncSource, state: SyncState, at?: string): void {
  window.dispatchEvent(new CustomEvent('pixinotes:sync-status', { detail: { source, state, at } }));
}

/**
 * M269: Dateien reisen mit.
 *
 * Der Befund kam vom Telefon: Auf der Karte stand „Der Inhalt liegt nicht auf
 * diesem Gerät". Das stimmte auch — der Inhalt einer Datei lag nur in der
 * lokalen Ablage des Geräts, auf dem sie eingefügt wurde, und der Sync-Stand
 * trug bloß Name, Größe und Typ. Auf dem Rechner half der Team-Ordner (M159),
 * am Telefon gibt es den nicht: Kein Browser darf dort einen Ordner anfassen.
 *
 * Deshalb nimmt der Sync-Stand die Inhalte jetzt selbst mit — als Beipack
 * neben den Boards. Das wirkt auf ALLEN Wegen gleichzeitig (Sync-Ordner,
 * Dateien-App, WebDAV), also auch dort, wo es bisher gar keinen Weg gab.
 *
 * Der Preis ist Größe: Aus 3,7 MB PDF werden rund 5 MB in der Datei
 * (Base64 kostet ein Drittel). Deshalb ein BUDGET statt „alles immer":
 * Es wird gepackt, bis die Obergrenze erreicht ist — größte Dateien zuletzt,
 * damit viele kleine nicht an einer einzigen großen scheitern. Was nicht mehr
 * hineinpasst, bleibt wie bisher lokal, und die Karte sagt das auch.
 *
 * Der Beipack ist OPTIONAL im Schema: Ein älterer Stand ohne ihn wird
 * unverändert gelesen, und ein neuer Stand tut einer älteren Fassung nicht
 * weh — sie überliest das Feld.
 */
export interface SyncDatei {
  name: string;
  mime?: string;
  /** Inhalt als Base64 (ohne data:-Präfix) */
  b64: string;
}

export interface SyncPayload {
  app: 'pixinotes';
  version: 2;
  savedAt: string;
  boards: BoardDoc[];
  spaces: Space[];
  activeId: string;
  /** M269: Dateiinhalte je Karten-Id — fehlt bei älteren Ständen */
  dateien?: Record<string, SyncDatei>;
}

// Minimale Typen für die File System Access API (nicht in allen TS-Libs)
interface SyncFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string | Blob | ArrayBuffer): Promise<void>; close(): Promise<void> }>;
}
export interface SyncDirHandle {
  name: string;
  queryPermission?(o: { mode: string }): Promise<PermissionState>;
  requestPermission?(o: { mode: string }): Promise<PermissionState>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<SyncFileHandle>;
  /** Verzeichnis auflisten (Team-Sync M145: Projekt-Pakete im Ordner finden) */
  values?(): AsyncIterable<{ kind: string; name: string }>;
  /** Unterordner (M159: strukturierte Anlagen-Ablage pixinotes-anlagen/…) */
  getDirectoryHandle?(name: string, o?: { create?: boolean }): Promise<SyncDirHandle>;
  /** Datei entfernen (M311: eingearbeitete Konfliktkopien des Cloud-Clients) */
  removeEntry?(name: string, o?: { recursive?: boolean }): Promise<void>;
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

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbKeys(): Promise<IDBValidKey[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDel(key: string): Promise<void> {
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
  await basisVergessen('ordner');
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

// ---------- M311: Basis-Stand je Sync-Weg ----------
// Was dieses Gerät zuletzt mit dem Ziel getauscht hat — die dritte Seite der
// Drei-Wege-Zusammenführung (syncMerge.ts). Liegt in IndexedDB, weil ein
// kompletter Stand für localStorage zu groß ist. Fehlt die Basis (Umstieg von
// einer älteren Fassung), bleibt es beim vorsichtigen Verhalten von früher:
// Fremdes wird nur ohne eigene Änderungen übernommen, sonst fragt die App.
const basisKey = (source: SyncSource) => `basis:${source === 'dateien' ? 'ordner' : source}`;

export async function basisLesen(source: SyncSource): Promise<SyncStand | null> {
  try {
    const b = await idbGet<SyncStand>(basisKey(source));
    return b && Array.isArray(b.boards) && Array.isArray(b.spaces) ? b : null;
  } catch {
    return null;
  }
}

export async function basisMerken(source: SyncSource, stand: SyncStand): Promise<void> {
  try { await idbSet(basisKey(source), { boards: stand.boards, spaces: stand.spaces }); } catch { /* ohne Basis gilt das vorsichtige Verhalten */ }
}

export async function basisVergessen(source: SyncSource): Promise<void> {
  try { await idbDel(basisKey(source)); } catch { /* egal */ }
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

/** Den zu sichernden Stand zusammenstellen — eine Quelle für Ordner, WebDAV
 *  und Dateien-App, damit die drei Wege garantiert dasselbe Format schreiben. */
export function buildSyncPayload(): SyncPayload {
  const s = useBoard.getState();
  return {
    app: 'pixinotes',
    version: 2,
    savedAt: new Date().toISOString(),
    boards: s.boards,
    spaces: s.spaces,
    activeId: s.activeId,
    // bewusst OHNE KI-Einstellungen: API-Schlüssel bleiben auf dem Gerät
  };
}

/** Voreinstellung des Budgets für mitreisende Dateien (Megabyte) */
export const DATEI_BUDGET_MB = 25;

/** Base64 aus einem Blob — in Blöcken, damit große Dateien den Aufrufstapel
 *  nicht sprengen (btoa(String.fromCharCode(...bytes)) knallt ab ~100 kB) */
async function alsBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let roh = '';
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    roh += String.fromCharCode(...bytes.subarray(i, i + BLOCK));
  }
  return btoa(roh);
}

export function base64AlsBlob(b64: string, mime?: string): Blob {
  const roh = atob(b64);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

/**
 * Derselbe Stand, aber mit den Dateiinhalten im Beipack (M269).
 *
 * Bewusst eine eigene, asynchrone Fassung: Der Beipack muss aus der lokalen
 * Ablage gelesen werden, und alle drei Sicherungswege sind ohnehin
 * asynchron. `buildSyncPayload` bleibt daneben bestehen — es gibt Stellen
 * (Vergleiche, Stempel), die nur die Boards brauchen und nicht auf Megabyte
 * warten sollen.
 *
 * `budgetMb <= 0` heißt: keine Dateien mitnehmen (der Schalter ist aus).
 */
export async function buildSyncPayloadMitDateien(budgetMb = DATEI_BUDGET_MB): Promise<SyncPayload> {
  const p = buildSyncPayload();
  if (budgetMb <= 0) return p;
  // Alle Datei-Karten aller Boards — die kleinsten zuerst, damit ein einzelner
  // Brocken nicht zwanzig kleine Anhänge verdrängt
  const karten: Array<{ id: string; name: string; mime?: string; size: number }> = [];
  for (const b of p.boards) {
    for (const n of b.nodes) {
      if (n.type !== 'file') continue;
      const d = n.data as { name?: string; mime?: string; size?: number };
      karten.push({ id: n.id, name: d.name ?? 'Datei', mime: d.mime, size: d.size ?? 0 });
    }
  }
  karten.sort((a, b) => a.size - b.size);
  const dateien: Record<string, SyncDatei> = {};
  let rest = budgetMb * 1_000_000;
  for (const k of karten) {
    if (rest <= 0) break;
    try {
      const blob = await idbGet<Blob | ArrayBuffer>(`file:${k.id}`);
      if (!blob) continue;
      const b = blob instanceof Blob ? blob : new Blob([blob]);
      if (b.size > rest) continue;            // passt nicht — nächste probieren
      dateien[k.id] = { name: k.name, mime: k.mime, b64: await alsBase64(b) };
      rest -= b.size;
    } catch {
      // Eine unlesbare Datei darf das Sichern des ganzen Stands nicht aufhalten
    }
  }
  return Object.keys(dateien).length ? { ...p, dateien } : p;
}

/**
 * Beipack aus einem übernommenen Stand in die lokale Ablage schreiben.
 *
 * Läuft NACH `applySync` und bewusst ohne Rückmeldung an den Aufrufer: Die
 * Boards sind da, egal ob eine einzelne Datei klemmt. Vorhandene Inhalte
 * werden überschrieben — der übernommene Stand ist der neuere.
 */
export async function uebernimmDateien(p: SyncPayload): Promise<number> {
  const d = p.dateien;
  if (!d) return 0;
  let n = 0;
  for (const [id, eintrag] of Object.entries(d)) {
    try {
      await idbSet(`file:${id}`, base64AlsBlob(eintrag.b64, eintrag.mime));
      n += 1;
    } catch { /* Platte voll oder Eintrag kaputt — der Rest zählt trotzdem */ }
  }
  return n;
}

/** Nach erfolgreichem Sichern buchen: Stempel setzen und „sauber" markieren —
 *  Letzteres nur, wenn währenddessen nicht weiter editiert wurde. */
export function markSynced(payload: SyncPayload, source: SyncSource = 'ordner'): string {
  localStorage.setItem(STAMP_KEY, payload.savedAt);
  const cur = useBoard.getState();
  if (cur.boards === payload.boards && cur.spaces === payload.spaces) localStorage.removeItem(SYNC_DIRTY_KEY);
  emitSyncStatus(source, 'ok', payload.savedAt);
  return payload.savedAt;
}

export async function writeSync(handle: SyncDirHandle): Promise<string> {
  // M269: mit Beipack — die Obergrenze steht in den Einstellungen
  const payload = await buildSyncPayloadMitDateien(useBoard.getState().syncDateienMb ?? DATEI_BUDGET_MB);
  const fh = await handle.getFileHandle(FILE_NAME, { create: true });
  // createWritable schreibt in eine Schattendatei und tauscht erst bei close()
  // — der Cloud-Client sieht nie eine halbe Datei
  const w = await fh.createWritable();
  await w.write(JSON.stringify(payload));
  await w.close();
  await basisMerken('ordner', payload);
  letzteSignatur = await dateiSignatur(handle); // eigenes Schreiben ist kein Fremd-Stand
  return markSynced(payload, 'ordner');
}

/** Geladenen Stand übernehmen. false = konnte NICHT dauerhaft gespeichert
 *  werden (Browser-Speicher voll) — dann bleibt auch der Sync-Stempel
 *  unangetastet, damit Stempel und Daten nie auseinanderlaufen (Audit M81:
 *  vorher stand der Stempel schon auf „synchron", während die Daten noch
 *  400 ms im Puffer hingen — ein Crash in dem Fenster hinterließ den alten
 *  Stand mit neuem Stempel, und der nächste Auto-Save überschrieb still
 *  den Sync-Ordner). */
export function applySync(p: SyncPayload, source: SyncSource = 'ordner'): boolean {
  claimWriter(); // Import ist eine bewusste Nutzer-Aktion — dieses Fenster schreibt ab jetzt
  useBoard.getState().importSync(p.boards, p.spaces, p.activeId);
  if (!flushPersist()) return false;
  try {
    localStorage.setItem(STAMP_KEY, p.savedAt);
    localStorage.removeItem(SYNC_DIRTY_KEY); // deckungsgleich mit dem Ordner
    // Gegenüber einem evtl. verbundenen WebDAV-Server ist der Stand jetzt neu
    localStorage.setItem(WEBDAV_DIRTY_KEY, '1');
  } catch { return false; }
  emitSyncStatus(source, 'ok', p.savedAt);
  void basisMerken(source, p); // M311: ab hier ist das der gemeinsame Stand
  /**
   * M269: Der Beipack landet in der lokalen Ablage — bewusst NACHGELAGERT.
   *
   * Die Boards sind damit sofort da; die Dateien trudeln ein, sobald sie
   * geschrieben sind. Andersherum müsste man vor jedem Board-Wechsel auf
   * Megabyte warten, und eine klemmende Datei würde den ganzen Stand
   * blockieren. Wenn sie da sind, sagt ein Ereignis den Karten Bescheid,
   * damit sie ihre Vorschau nachziehen, statt beim Platzhalter zu bleiben.
   */
  void uebernimmDateien(p).then((n) => {
    if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
  });
  return true;
}

export const knownStamp = (): string | null => localStorage.getItem(STAMP_KEY);

// ---------- M311: Fremden Stand einarbeiten (Ordner UND WebDAV) ----------
// Die Ordner-Synchronisation läuft typischerweise über einen Ordner, den der
// Nextcloud-Client zwischen den Rechnern spiegelt. Früher hieß „ein anderes
// Gerät hat geschrieben" sofort: Konflikt, laden oder überschreiben. Jetzt
// wird zusammengeführt — Basis, lokal und fremd (syncMerge.ts) — und der
// Ordner bekommt anschließend beide Anteile. Beide Richtungen, ohne Nachfrage.

/** Ein Sync-Ziel aus Sicht der Zusammenführung */
export interface SyncWeg {
  source: SyncSource;
  stampKey: string;
  dirtyKey: string;
  /** Aktuellen Stand ins Ziel schreiben — setzt selbst Stempel, Basis und Status */
  schreiben: () => Promise<string>;
  /** Fremden Stand ohne Zusammenführung übernehmen (Umstieg ohne Basis) */
  uebernehmen: (p: SyncPayload) => boolean;
}

export type EinarbeitenErgebnis =
  | 'gleich'            // Ziel und lokal decken sich — nur Stempel übernommen
  | 'uebernommen'       // ohne Basis: fremder Stand ersetzt den lokalen (wie früher)
  | 'zusammengefuehrt'  // lokal hat Fremdes bekommen (und das Ziel ggf. Eigenes)
  | 'geschrieben'       // lokal unverändert, Ziel bekam den eigenen Anteil
  | 'spaeter'           // der Nutzer tippt gerade auf einem betroffenen Board
  | 'konflikt'          // ohne Basis UND eigene Änderungen — der Nutzer entscheidet
  | 'fehler';           // Browser-Speicher voll o. Ä.

// Tipp-Schutz: Ein Abgleich, der das aktive Board neu aufbaut, soll nicht
// mitten ins Wort fallen. Nur gesetzt bei echten eigenen Änderungen.
let letzteAenderung = 0;
export const notiereAenderung = (): void => { letzteAenderung = Date.now(); };
const tippt = (): boolean => Date.now() - letzteAenderung < 2500;

/**
 * Fremden Stand einarbeiten. `nebenkopie` = eine Konfliktkopie des Cloud-
 * Clients: Sie liefert nur Inhalte, trägt aber nie Stempel oder Basis —
 * beides gehört der Hauptdatei; was aus der Kopie übernommen wurde, wird
 * danach ganz normal als eigener Anteil in die Hauptdatei geschrieben.
 */
export async function fremdStandEinarbeiten(remote: SyncPayload, weg: SyncWeg, nebenkopie = false): Promise<EinarbeitenErgebnis> {
  const basis = await basisLesen(weg.source);
  if (!basis) {
    if (nebenkopie || localStorage.getItem(weg.dirtyKey)) return 'konflikt';
    return weg.uebernehmen(remote) ? 'uebernommen' : 'fehler';
  }
  const s = useBoard.getState();
  const erg = dreiWegeMerge(basis, { boards: s.boards, spaces: s.spaces }, remote);
  if (erg.lokalNeu) {
    if (erg.geaendert.includes(s.activeId) && tippt()) return 'spaeter';
    useBoard.getState().importSync(erg.boards, erg.spaces, s.activeId, { geaendert: erg.geaendert });
    if (!flushPersist()) return 'fehler';
    // Beipack (M269) nachgelagert — Karten holen ihre Vorschau, sobald er da ist
    void uebernimmDateien(remote).then((n) => {
      if (n > 0) window.dispatchEvent(new CustomEvent('pixinotes:dateien-da'));
    });
  }
  if (nebenkopie) {
    if (erg.lokalNeu) {
      try { localStorage.setItem(weg.dirtyKey, '1'); } catch { /* voll */ }
      await weg.schreiben();
      useBoard.getState().showToast(`☁️ Konfliktkopie eingearbeitet: ${berichtAlsSatz(erg.bericht)}.`);
    }
    return erg.lokalNeu ? 'zusammengefuehrt' : 'gleich';
  }
  if (erg.fremdNeu) {
    await weg.schreiben();
  } else {
    try {
      localStorage.setItem(weg.stampKey, remote.savedAt);
      localStorage.removeItem(weg.dirtyKey);
    } catch { /* voll — beim nächsten Schreiben erneut */ }
    await basisMerken(weg.source, remote);
    emitSyncStatus(weg.source, 'ok', remote.savedAt);
  }
  if (erg.lokalNeu) useBoard.getState().showToast(`☁️ Abgeglichen: ${berichtAlsSatz(erg.bericht)}.`);
  return erg.lokalNeu ? 'zusammengefuehrt' : erg.fremdNeu ? 'geschrieben' : 'gleich';
}

const ordnerWeg = (handle: SyncDirHandle): SyncWeg => ({
  source: 'ordner',
  stampKey: STAMP_KEY,
  dirtyKey: SYNC_DIRTY_KEY,
  schreiben: () => writeSync(handle),
  uebernehmen: (p) => applySync(p),
});

// Lesen, Zusammenführen und Schreiben laufen nie gleichzeitig (Poll, Fokus-
// Wechsel und Auto-Save sind alle asynchron und könnten sich sonst überholen)
let kette: Promise<unknown> = Promise.resolve();
function exklusiv<T>(fn: () => Promise<T>): Promise<T> {
  const p = kette.then(fn, fn);
  kette = p.catch(() => {});
  return p;
}

// ---------- M311: Konfliktkopien des Cloud-Clients ----------
// Schreiben zwei Rechner, bevor der Client abgeglichen hat, legt Nextcloud
// „pixinotes-daten (conflicted copy 2026-10-14 101010).json" daneben (Dropbox:
// „conflicted copy"/„in Konflikt stehende Kopie", ältere Clients „_conflict-").
// Früher lag so eine Kopie stumm im Ordner, bis jemand sie fand. Jetzt wird
// sie wie ein fremder Stand eingearbeitet und danach entfernt.
const KOPIE_RE = /^pixinotes-daten.*(conflict|konflikt).*\.json$/i;
const kopienErledigt = new Set<string>();

async function konfliktkopien(handle: SyncDirHandle): Promise<string[]> {
  const out: string[] = [];
  if (!handle.values) return out;
  try {
    for await (const e of handle.values()) {
      if (e.kind === 'file' && KOPIE_RE.test(e.name) && !kopienErledigt.has(e.name)) out.push(e.name);
    }
  } catch { /* Auflistung nicht möglich */ }
  return out;
}

async function konfliktkopienEinarbeiten(handle: SyncDirHandle): Promise<void> {
  for (const name of await konfliktkopien(handle)) {
    kopienErledigt.add(name); // nie zweimal — auch wenn das Entfernen scheitert
    try {
      const fh = await handle.getFileHandle(name);
      const p = JSON.parse(await (await fh.getFile()).text()) as SyncPayload;
      if (p?.app !== 'pixinotes' || !Array.isArray(p.boards) || p.boards.length === 0 || !Array.isArray(p.spaces)) continue;
      const r = await fremdStandEinarbeiten(p, ordnerWeg(handle), true);
      if (r === 'spaeter') { kopienErledigt.delete(name); continue; }
      if (r === 'konflikt' || r === 'fehler') continue; // bleibt liegen — der Nutzer entscheidet
      await handle.removeEntry?.(name);
    } catch { /* nächste Kopie */ }
  }
}

// ---------- Auto-Sync ----------
let started = false;
let conflictWarned = false;
let lastRemoteCheck = 0;
let staleHintShown = false;

/** Datei-Signatur (Änderungszeit + Größe) — billiger als Lesen und Vergleichen */
async function dateiSignatur(handle: SyncDirHandle): Promise<string | null> {
  try {
    const f = await (await handle.getFileHandle(FILE_NAME)).getFile();
    return `${f.lastModified}:${f.size}`;
  } catch {
    return null;
  }
}
let letzteSignatur: string | null | undefined;

/** Ordner prüfen und einen fremden Stand einarbeiten. Mit Basis (M311) wird
 *  zusammengeführt — in beide Richtungen, ohne Nachfrage. Ohne Basis gilt
 *  das alte Fast-Forward: übernehmen nur ohne eigene Änderungen, sonst
 *  ehrlicher Hinweis. `erzwingen` übergeht die Fokus-Drossel (Poll). */
export async function checkSyncRemote(erzwingen = false): Promise<EinarbeitenErgebnis | 'ruhe'> {
  const now = Date.now();
  if (!erzwingen && now - lastRemoteCheck < 15_000) return 'ruhe'; // Fokus-Wechsel nicht hämmern
  if (getWriterRole() !== 'writer') return 'ruhe';   // Mitlese-Fenster folgt dem Schreiber
  const handle = await getSyncHandle();
  if (!handle || !(await ensurePermission(handle, false))) return 'ruhe';
  lastRemoteCheck = now;
  return exklusiv(async () => {
    const remote = await readSync(handle);
    let r: EinarbeitenErgebnis | 'ruhe' = 'ruhe';
    if (!remote || remote.savedAt === knownStamp()) {
      staleHintShown = false;
      if (remote) {
        emitSyncStatus('ordner', 'ok', remote.savedAt); // in sync
        if (!(await basisLesen('ordner'))) await basisMerken('ordner', remote); // Umstieg: Basis nachziehen
      }
    } else {
      r = await fremdStandEinarbeiten(remote, ordnerWeg(handle));
      if (r === 'uebernommen') {
        useBoard.getState().showToast(`☁️ Neuerer Stand aus dem Sync-Ordner übernommen (${new Date(remote.savedAt).toLocaleString('de-DE')}).`);
        staleHintShown = false;
      } else if (r === 'konflikt') {
        emitSyncStatus('ordner', 'conflict');
        if (!staleHintShown) {
          staleHintShown = true;
          useBoard.getState().showToast('Sync-Ordner und lokaler Stand weichen ab, nichts wurde überschrieben. Unter ⚙ → Synchronisation wählen.');
        }
      } else if (r === 'fehler') {
        emitSyncStatus('ordner', 'error');
      } else {
        staleHintShown = false;
      }
    }
    if (r !== 'spaeter') letzteSignatur = await dateiSignatur(handle);
    await konfliktkopienEinarbeiten(handle);
    return r;
  });
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

let nachzuegler: ReturnType<typeof setTimeout> | undefined;

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
  await exklusiv(async () => {
    try {
      const remote = await readSync(handle);
      // Ein anderes Gerät hat seit unserem letzten Abgleich geschrieben?
      // WICHTIG: auch OHNE eigenen Stempel (frisch verbundenes Gerät) gilt
      // fremder Bestand als fremd — sonst überschreibt das erste lokale Edit
      // die Daten des anderen Geräts (Audit R6-S4). M311: statt zu warnen
      // wird zusammengeführt; geschrieben wird dann das Ergebnis.
      if (remote && remote.savedAt !== knownStamp()) {
        const r = await fremdStandEinarbeiten(remote, ordnerWeg(handle));
        if (r === 'konflikt') {
          emitSyncStatus('ordner', 'conflict');
          if (!conflictWarned) {
            conflictWarned = true;
            useBoard.getState().showToast('⚠️ Der Sync-Ordner hat einen anderen Stand. Unter ⚙ → Synchronisation laden oder überschreiben.');
          }
          return;
        }
        if (r === 'fehler') { emitSyncStatus('ordner', 'error'); return; }
        if (r === 'spaeter') {
          // Der Nutzer tippt auf einem betroffenen Board — gleich noch einmal
          clearTimeout(nachzuegler);
          nachzuegler = setTimeout(() => { void autoSave().catch(() => {}); }, 3000);
          return;
        }
        letzteSignatur = await dateiSignatur(handle);
        conflictWarned = false;
        return;
      }
      await writeSync(handle); // meldet bei Erfolg selbst 'ok'
      conflictWarned = false;
    } catch {
      emitSyncStatus('ordner', 'error');
    }
  });
}

/** M311: Ordner-Überwachung. Der Cloud-Client spiegelt fremde Änderungen
 *  jederzeit herein — nicht nur, wenn das Fenster den Fokus wechselt. Alle
 *  zehn Sekunden wird nur die Datei-Signatur geholt (kein Lesen, kein
 *  Vergleich); erst eine Änderung löst den Abgleich aus. Jede Minute wird
 *  zusätzlich nach Konfliktkopien geschaut. */
const TAKT_MS = 10_000;
function startePoll(): void {
  let takt = 0;
  setInterval(() => {
    void (async () => {
      if (document.visibilityState !== 'visible' || getWriterRole() !== 'writer') return;
      const handle = await getSyncHandle();
      if (!handle || !(await ensurePermission(handle, false))) return;
      takt += 1;
      const sig = await dateiSignatur(handle);
      const kopien = takt % 6 === 0 ? await konfliktkopien(handle) : [];
      if (sig === letzteSignatur && kopien.length === 0) return;
      await checkSyncRemote(true);
    })().catch(() => {});
  }, TAKT_MS);
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
      notiereAenderung();
      try { localStorage.setItem(SYNC_DIRTY_KEY, '1'); localStorage.setItem(WEBDAV_DIRTY_KEY, '1'); } catch { /* voll → sicherer ohne Fast-Forward */ }
    }
    clearTimeout(timer);
    timer = setTimeout(() => { void autoSave().catch(() => {}); }, 1800);
  });
  // Start-Check: Berechtigung erloschen? Fremder Stand im Ordner? → einarbeiten
  void (async () => {
    const handle = await getSyncHandle();
    if (!handle) return;
    if (!(await ensurePermission(handle, false))) {
      // Browser hat den Zugriff nach Neustart zurückgesetzt — ehrlich sagen,
      // statt den Auto-Sync still zu deaktivieren; der Status-Chip bleibt
      // sichtbar und erteilt die Freigabe per Klick
      emitSyncStatus('ordner', 'noperm');
      useBoard.getState().showToast('Der Sync-Ordner braucht eine neue Freigabe: oben auf die Wolke klicken.');
      return;
    }
    await checkSyncRemote();
    // Ausstehende Änderungen aus der letzten Sitzung (z. B. Fenster innerhalb
    // der Speicher-Verzögerung geschlossen) jetzt nachschreiben — bisher
    // passierte das erst bei der NÄCHSTEN Bearbeitung
    if (localStorage.getItem(SYNC_DIRTY_KEY)) void autoSave().catch(() => {});
  })().catch(() => {});
  startePoll();
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
