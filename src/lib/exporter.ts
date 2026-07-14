// Export: Board als PNG/SVG, Boards als Markdown-Dateien in einen Ordner.
import { toPng, toSvg } from 'html-to-image';
import type { BoardDoc, Space } from '../store';
import { nodeToText } from './serialize';
import { triggerDownload } from './download';

/** Sichtbares Board als PNG oder SVG exportieren (für Weitergabe an Dritte). */
export async function exportViewport(format: 'png' | 'svg', name: string): Promise<void> {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!el) throw new Error('Kein Board sichtbar');
  const opts = { backgroundColor: '#f2efe9', pixelRatio: 2, cacheBust: true };
  const dataUrl = format === 'png' ? await toPng(el, opts) : await toSvg(el, opts);
  triggerDownload(dataUrl, `${sanitize(name)}.${format}`);
}

/** Ein Board als Markdown (Karten als Abschnitte). */
export function boardToMarkdown(board: BoardDoc): string {
  const lines = [`# ${board.name}`, ''];
  for (const n of board.nodes) {
    const text = nodeToText(n);
    if (text) lines.push(text, '');
  }
  return lines.join('\n');
}

function sanitize(s: string): string {
  return s.replace(/[^\p{L}\d\-_ ]/gu, '').trim().slice(0, 60) || 'board';
}

interface DirHandle {
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
}

/**
 * Datenordner-Export via File System Access API: legt die 3-Ebenen-Struktur
 * als echte Ordner + eine .md-Datei pro Board an. Fallback: einzelne Downloads.
 */
export async function exportToFolder(spaces: Space[], boards: BoardDoc[]): Promise<'ok' | 'fallback'> {
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> }).showDirectoryPicker;

  if (!picker) {
    // Fallback (Firefox/Safari/file://): alle Boards als Einzeldownloads
    for (const b of boards) {
      triggerDownload(
        `data:text/markdown;charset=utf-8,${encodeURIComponent(boardToMarkdown(b))}`,
        `${sanitize(b.name)}.md`,
      );
    }
    return 'fallback';
  }

  const root = await picker();
  for (const space of spaces) {
    const spaceDir = await root.getDirectoryHandle(sanitize(space.name), { create: true });
    for (const project of space.projects) {
      const projDir = await spaceDir.getDirectoryHandle(sanitize(project.name), { create: true });
      for (const bid of project.boardIds) {
        const board = boardById.get(bid);
        if (!board) continue;
        const fh = await projDir.getFileHandle(`${sanitize(board.name)}.md`, { create: true });
        const w = await fh.createWritable();
        await w.write(boardToMarkdown(board));
        await w.close();
      }
    }
  }
  return 'ok';
}
