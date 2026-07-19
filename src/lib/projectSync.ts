// Team-Sync (M145): EINZELNE Projekte in jeweils EIGENE Sync-Ordner spiegeln.
// So arbeitet man in einer Umgebung mit mehreren Teams: Jedes Team bekommt eine
// eigene Ordner-Freigabe (Nextcloud/OneDrive/Dropbox), PixiNotes legt dort ein
// Projekt-Paket `pixinotes-projekt-<id>.json` ab — NUR dieses Projekt und seine
// Boards, nie der Rest der Umgebung. Wer der Ordner-Freigabe beitritt, tritt
// dem Projekt bei; die Zugriffsrechte regelt allein der Cloud-Speicher.
// WICHTIG: Das Paket enthält NIEMALS KI-Schlüssel, WebDAV-Zugangsdaten oder
// OAuth-Tokens — die leben in eigenen localStorage-Schlüsseln außerhalb des
// Board-Stores und werden hier gar nicht erst angefasst.
import { claimWriter, flushPersist, getWriterRole, inDerived, isImportedState, useBoard, type BoardDoc } from '../store';
import { ensurePermission, idbDel, idbGet, idbSet, syncSupported, type SyncDirHandle } from './syncFolder';

export interface ProjectPayload {
  app: 'pixinotes-projekt';
  version: 1;
  savedAt: string;
  project: { id: string; name: string };
  boards: BoardDoc[];
}

const META_KEY = 'pixinotes:psync-meta';
const fileNameFor = (id: string) => `pixinotes-projekt-${id}.json`;
const FILE_RE = /^pixinotes-projekt-.+\.json$/;
const stampKey = (id: string) => `pixinotes:psync-stamp:${id}`;
const dirtyKey = (id: string) => `pixinotes:psync-dirty:${id}`;
const idbKey = (id: string) => `proj:${id}`;

export const projectSyncSupported = syncSupported;

// ---------- Verbindungs-Verzeichnis (nur Ordner-NAMEN, keine Geheimnisse) ----------
export function projectSyncMeta(): Record<string, { folder: string }> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as Record<string, { folder: string }>;
  } catch {
    return {};
  }
}

function setMeta(projectId: string, folder: string | null): void {
  const meta = projectSyncMeta();
  if (folder === null) delete meta[projectId];
  else meta[projectId] = { folder };
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* voll — Verbindung gilt nur für die Sitzung */ }
}

// Session-Cache der Ordner-Handles (IndexedDB-Fallback wie beim globalen Sync)
const handleCache = new Map<string, SyncDirHandle>();

export async function projectHandle(projectId: string): Promise<SyncDirHandle | undefined> {
  const cached = handleCache.get(projectId);
  if (cached) return cached;
  try {
    const h = await idbGet<SyncDirHandle>(idbKey(projectId));
    if (h) handleCache.set(projectId, h);
    return h;
  } catch {
    return undefined;
  }
}

export const projectStamp = (id: string): string | null => localStorage.getItem(stampKey(id));

// ---------- Paket lesen / schreiben ----------
function isPayload(p: unknown): p is ProjectPayload {
  const x = p as ProjectPayload;
  return x?.app === 'pixinotes-projekt' && !!x.project?.id && !!x.project?.name
    && Array.isArray(x.boards) && x.boards.length > 0;
}

export async function readProjectFile(handle: SyncDirHandle, projectId: string): Promise<ProjectPayload | null> {
  try {
    const fh = await handle.getFileHandle(fileNameFor(projectId));
    const p = JSON.parse(await (await fh.getFile()).text()) as unknown;
    return isPayload(p) ? p : null;
  } catch {
    return null; // Datei existiert (noch) nicht oder ist unlesbar
  }
}

/** Alle Projekt-Pakete im Ordner (für den Beitritt — meist genau eines) */
export async function scanProjectFiles(handle: SyncDirHandle): Promise<ProjectPayload[]> {
  const out: ProjectPayload[] = [];
  if (!handle.values) return out;
  try {
    for await (const entry of handle.values()) {
      if (entry.kind !== 'file' || !FILE_RE.test(entry.name)) continue;
      try {
        const fh = await handle.getFileHandle(entry.name);
        const p = JSON.parse(await (await fh.getFile()).text()) as unknown;
        if (isPayload(p)) out.push(p);
      } catch { /* einzelne kaputte Datei überspringen */ }
    }
  } catch { /* Auflistung nicht möglich */ }
  return out;
}

/** Merkt sich pro Projekt den zuletzt geschriebenen Inhalt (ohne Zeitstempel) —
 *  verhindert, dass der Auto-Sync unveränderte Projekte immer wieder mit neuem
 *  savedAt hochlädt und auf den Geräten der Kollegen falsche Konflikte auslöst */
const lastBody = new Map<string, string>();

function buildPayloadBody(projectId: string): { body: string; boards: BoardDoc[]; name: string } | null {
  const s = useBoard.getState();
  for (const sp of s.spaces) {
    for (const p of sp.projects) {
      if (p.id !== projectId) continue;
      const boards = s.boards.filter((b) => p.boardIds.includes(b.id));
      if (boards.length === 0) return null; // leeres Projekt → nichts zu teilen
      return { body: JSON.stringify({ project: { id: p.id, name: p.name }, boards }), boards, name: p.name };
    }
  }
  return null;
}

export async function writeProjectSync(projectId: string): Promise<string> {
  const handle = await projectHandle(projectId);
  if (!handle) throw new Error('Kein Sync-Ordner mit diesem Projekt verbunden.');
  const built = buildPayloadBody(projectId);
  if (!built) throw new Error('Projekt ist leer oder existiert nicht mehr — nichts zu speichern.');
  const payload: ProjectPayload = {
    app: 'pixinotes-projekt',
    version: 1,
    savedAt: new Date().toISOString(),
    project: { id: projectId, name: built.name },
    boards: built.boards,
  };
  const fh = await handle.getFileHandle(fileNameFor(projectId), { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(payload));
  await w.close();
  localStorage.setItem(stampKey(projectId), payload.savedAt);
  localStorage.removeItem(dirtyKey(projectId));
  lastBody.set(projectId, built.body);
  return payload.savedAt;
}

/** Paket in die lokale Umgebung übernehmen (ersetzt nur DIESES Projekt).
 *  false = konnte nicht dauerhaft gespeichert werden (Browser-Speicher voll) —
 *  dann bleibt auch der Stempel unangetastet (gleiches Prinzip wie Audit M81). */
export function applyProjectPayload(p: ProjectPayload): boolean {
  claimWriter(); // bewusste Übernahme — dieses Fenster schreibt ab jetzt
  useBoard.getState().importProject(p.project, p.boards);
  if (!flushPersist()) return false;
  try {
    localStorage.setItem(stampKey(p.project.id), p.savedAt);
    localStorage.removeItem(dirtyKey(p.project.id));
  } catch { return false; }
  lastBody.set(p.project.id, JSON.stringify({ project: p.project, boards: p.boards }));
  return true;
}

// ---------- Verbinden / Beitreten / Trennen ----------
async function pickFolder(): Promise<SyncDirHandle> {
  const picker = (window as unknown as { showDirectoryPicker(o?: unknown): Promise<SyncDirHandle> }).showDirectoryPicker;
  return picker({ mode: 'readwrite', id: 'pixinotes-projekt' });
}

/** Eigenes Projekt mit einem (Team-)Ordner verbinden. Ergebnis sagt, was passiert
 *  ist: 'geschrieben' = Paket frisch abgelegt, 'vorhanden' = im Ordner liegt schon
 *  ein anderer Stand dieses Projekts (nichts überschrieben — Nutzer entscheidet). */
export async function connectProjectSync(projectId: string): Promise<{ folder: string; state: 'geschrieben' | 'vorhanden' }> {
  const handle = await pickFolder();
  handleCache.set(projectId, handle);
  try { await idbSet(idbKey(projectId), handle); } catch { /* gilt dann nur für diese Sitzung */ }
  setMeta(projectId, handle.name);
  const remote = await readProjectFile(handle, projectId);
  if (remote && remote.savedAt !== projectStamp(projectId)) {
    return { folder: handle.name, state: 'vorhanden' };
  }
  await writeProjectSync(projectId);
  return { folder: handle.name, state: 'geschrieben' };
}

/** Beitritt: geteilten Ordner wählen, dort gefundene Projekt-Pakete übernehmen
 *  und den Ordner gleich als Sync-Quelle dieser Projekte verbinden. */
export async function joinProjectFolder(): Promise<{ folder: string; names: string[]; persisted: boolean }> {
  const handle = await pickFolder();
  const found = await scanProjectFiles(handle);
  if (found.length === 0) {
    throw new Error('In diesem Ordner liegt kein PixiNotes-Projekt-Paket (pixinotes-projekt-….json). Stimmt der freigegebene Ordner?');
  }
  let persisted = true;
  for (const p of found) {
    handleCache.set(p.project.id, handle);
    try { await idbSet(idbKey(p.project.id), handle); } catch { /* Sitzungs-Cache reicht */ }
    setMeta(p.project.id, handle.name);
    if (!applyProjectPayload(p)) persisted = false;
  }
  return { folder: handle.name, names: found.map((p) => p.project.name), persisted };
}

export async function disconnectProjectSync(projectId: string): Promise<void> {
  handleCache.delete(projectId);
  lastBody.delete(projectId);
  try { await idbDel(idbKey(projectId)); } catch { /* Cache ist weg */ }
  setMeta(projectId, null);
  localStorage.removeItem(stampKey(projectId));
  localStorage.removeItem(dirtyKey(projectId));
}

// ---------- Einladung per E-Mail (bewusst OHNE Passwörter/Zugangsdaten) ----------
export function buildInviteText(projectName: string, folderName: string): string {
  const appUrl = window.location.href.split('#')[0];
  return [
    'Hallo,',
    '',
    `ich lade dich ein, an unserem PixiNotes-Projekt „${projectName}" mitzuarbeiten. So trittst du bei:`,
    '',
    `1) Nimm die Ordner-Freigabe an: [HIER den Freigabe-Link zum Ordner „${folderName}" einfügen — z. B. in Nextcloud über „Teilen"]`,
    '2) Lass den freigegebenen Ordner von deinem Sync-Client (Nextcloud/OneDrive/Dropbox) auf deinen Rechner synchronisieren.',
    `3) Öffne PixiNotes: ${appUrl}`,
    '4) Dort: Einstellungen (Zahnrad) → Synchronisation → „Projekt beitreten…" → wähle den synchronisierten Ordner aus.',
    '',
    'PixiNotes findet darin das Projekt-Paket, richtet den automatischen Abgleich ein und zeigt dir das Projekt neben deinen eigenen.',
    'Wer mitarbeiten darf, regelt allein die Ordner-Freigabe — diese E-Mail enthält keine Passwörter oder Zugangsdaten.',
  ].join('\n');
}

export function buildInviteMailto(projectName: string, folderName: string): string {
  const subject = `Einladung zum PixiNotes-Projekt „${projectName}"`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildInviteText(projectName, folderName))}`;
}

// ---------- Auto-Sync (spiegelt die Logik des globalen Ordner-Syncs) ----------
let started = false;
const conflictWarned = new Set<string>();
let lastRemoteCheck = 0;

async function autoSaveProject(projectId: string): Promise<void> {
  if (getWriterRole() !== 'writer') return;
  const handle = await projectHandle(projectId);
  if (!handle || !(await ensurePermission(handle, false))) return; // Freigabe fehlt → Nutzer regelt es in ⚙️
  const built = buildPayloadBody(projectId);
  if (!built) return; // Projekt gelöscht/leer → nichts hochladen
  // Unverändert? Dann Dirty-Flag löschen und Ruhe geben (keine falschen Konflikte)
  if (lastBody.get(projectId) === built.body) {
    localStorage.removeItem(dirtyKey(projectId));
    return;
  }
  const remote = await readProjectFile(handle, projectId);
  // Konfliktschutz: hat ein Teammitglied seit unserem letzten Abgleich geschrieben?
  if (remote && remote.savedAt !== projectStamp(projectId)) {
    if (!conflictWarned.has(projectId)) {
      conflictWarned.add(projectId);
      useBoard.getState().showToast(`⚠️ Im Team-Ordner liegt ein neuerer Stand von „${built.name}" — in ⚙️ → Synchronisation laden oder überschreiben.`);
    }
    return;
  }
  await writeProjectSync(projectId);
  conflictWarned.delete(projectId);
}

/** Team-Ordner prüfen und neuere Stände GEFAHRLOS übernehmen (Fast-Forward):
 *  nur ohne eigene ungesicherte Änderungen am jeweiligen Projekt. */
export async function checkProjectRemotes(): Promise<void> {
  const now = Date.now();
  if (now - lastRemoteCheck < 15_000) return;
  if (getWriterRole() !== 'writer') return;
  lastRemoteCheck = now;
  for (const projectId of Object.keys(projectSyncMeta())) {
    const handle = await projectHandle(projectId);
    if (!handle || !(await ensurePermission(handle, false))) continue;
    const remote = await readProjectFile(handle, projectId);
    if (!remote || remote.savedAt === projectStamp(projectId)) continue;
    if (!localStorage.getItem(dirtyKey(projectId)) && applyProjectPayload(remote)) {
      useBoard.getState().showToast(`☁️ Team-Projekt „${remote.project.name}" aktualisiert (${new Date(remote.savedAt).toLocaleString('de-DE')}).`);
      conflictWarned.delete(projectId);
    } else if (!conflictWarned.has(projectId)) {
      conflictWarned.add(projectId);
      useBoard.getState().showToast(`⚠️ Team-Projekt „${remote.project.name}": im Ordner liegt ein anderer Stand, hier gibt es aber eigene Änderungen — in ⚙️ → Synchronisation entscheiden.`);
    }
  }
}

/** Einmal beim App-Start aufrufen: hält alle verbundenen Team-Projekte aktuell. */
export function initProjectAutoSync(): void {
  if (started || !syncSupported()) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saveAll = () => {
    for (const id of Object.keys(projectSyncMeta())) void autoSaveProject(id).catch(() => {});
  };
  useBoard.subscribe((s, prev) => {
    if (s.boards === prev.boards && s.spaces === prev.spaces) return;
    if (isImportedState(s.boards, s.spaces)) return; // kam von außen — nicht zurückspiegeln
    if (getWriterRole() !== 'writer') return;
    if (!inDerived()) {
      // Grobkörnig alle verbundenen Projekte als „ungesichert" markieren — ob sich
      // WIRKLICH etwas geändert hat, entscheidet autoSaveProject per Inhaltsvergleich
      try {
        for (const id of Object.keys(projectSyncMeta())) localStorage.setItem(dirtyKey(id), '1');
      } catch { /* voll → sicherer ohne Fast-Forward */ }
    }
    clearTimeout(timer);
    timer = setTimeout(saveAll, 1800);
  });
  // Start: neuere Team-Stände übernehmen, dann eigene Reste nachschreiben
  void (async () => {
    if (Object.keys(projectSyncMeta()).length === 0) return;
    await checkProjectRemotes();
    for (const id of Object.keys(projectSyncMeta())) {
      if (localStorage.getItem(dirtyKey(id))) void autoSaveProject(id).catch(() => {});
    }
  })().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkProjectRemotes().catch(() => {});
    } else {
      // Fenster verlassen → sofort sichern statt auf die Verzögerung zu hoffen
      clearTimeout(timer);
      saveAll();
    }
  });
}
