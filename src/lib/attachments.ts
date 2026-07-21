// M159: Anlagen im Team-Ordner. Lokale Dateien, die aufs Board kommen, werden
// zusätzlich als KOPIE in den verbundenen Projekt-Sync-Ordner gespiegelt —
// sauber strukturiert nach Board und Datei-Art:
//
//   <Team-Ordner>/pixinotes-anlagen/<Board-Name>/<Kategorie>/<Dateiname>
//
// So liegen alle Anlagen eines Teams menschenlesbar neben dem Projekt-Paket
// und synchronisieren über denselben Freigabe-Ordner (Nextcloud & Co.) auf
// alle Geräte. Karten merken sich den relativen Pfad (`ref`) — Dateien, die
// zu groß fürs Einbetten ins Board sind, holen Teammitglieder darüber direkt
// aus dem Ordner. Es gelten dieselben Regeln wie beim Team-Sync: Zugriff
// regelt allein die Ordner-Freigabe, hier wandern keinerlei Zugangsdaten.
import { useBoard } from '../store';
import { ensurePermission, type SyncDirHandle } from './syncFolder';
import { projectHandle, projectSyncMeta } from './projectSync';

export const ATT_ROOT = 'pixinotes-anlagen';

/** Verbotene Pfadzeichen raus — der Ordnername muss auf allen Systemen gehen */
const sanitize = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Unbenannt';

export function categoryFor(name: string, mime = ''): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'Bilder';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'Videos';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'Audio';
  if (ext === 'pdf') return 'PDFs';
  if (ext === 'eml' || ext === 'msg') return 'E-Mails';
  if (ext === 'html' || ext === 'htm') return 'Apps';
  return 'Dokumente';
}

/** Projekt des AKTIVEN Boards — aber nur, wenn es einen Team-Ordner hat */
export function activeTeamProjectId(): string | null {
  const s = useBoard.getState();
  const meta = projectSyncMeta();
  for (const sp of s.spaces) {
    for (const p of sp.projects) {
      if (p.boardIds.includes(s.activeId) && meta[p.id]) return p.id;
    }
  }
  return null;
}

async function descend(handle: SyncDirHandle, segments: string[], create: boolean): Promise<SyncDirHandle | null> {
  let dir = handle;
  for (const seg of segments) {
    if (!dir.getDirectoryHandle) return null; // alte Browser ohne Unterordner-API
    try {
      dir = await dir.getDirectoryHandle(seg, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

/**
 * Kopie der Datei im Team-Ordner ablegen. Gibt den relativen Pfad zurück
 * (für `ref` an der Karte) — oder null, wenn das aktive Board zu keinem
 * verbundenen Team-Projekt gehört oder der Ordner gerade nicht erreichbar
 * ist. Gleichnamige Dateien werden überschrieben (gleiche Datei = gleicher
 * Stand — der Cloud-Ordner hat seinen eigenen Versionsverlauf).
 */
export async function mirrorAttachment(file: File): Promise<string | null> {
  const projectId = activeTeamProjectId();
  if (!projectId) return null;
  const handle = await projectHandle(projectId);
  if (!handle || !(await ensurePermission(handle, false))) return null;
  const s = useBoard.getState();
  const board = s.boards.find((b) => b.id === s.activeId);
  const segs = [ATT_ROOT, sanitize(board?.name ?? 'Board'), categoryFor(file.name, file.type)];
  const dir = await descend(handle, segs, true);
  if (!dir) return null;
  try {
    const name = sanitize(file.name);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(await file.arrayBuffer());
    await w.close();
    return [...segs, name].join('/');
  } catch {
    return null;
  }
}

/**
 * Anlage über ihren relativen Pfad aus einem der verbundenen Team-Ordner
 * holen — zuerst aus dem Projekt des aktiven Boards, dann aus allen anderen
 * (die Karte kann per Team-Sync in ein fremdes Projekt gewandert sein).
 */
export async function loadAttachment(ref: string): Promise<File | null> {
  const segs = ref.split('/').filter(Boolean);
  const name = segs.pop();
  if (!name) return null;
  const ids = Object.keys(projectSyncMeta());
  const active = activeTeamProjectId();
  if (active) ids.sort((a, b) => (a === active ? -1 : b === active ? 1 : 0));
  for (const id of ids) {
    const handle = await projectHandle(id);
    if (!handle || !(await ensurePermission(handle, false))) continue;
    const dir = await descend(handle, segs, false);
    if (!dir) continue;
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      continue;
    }
  }
  return null;
}
