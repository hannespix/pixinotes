// Export: Board als PNG/SVG/PDF, Boards als Markdown-Dateien in einen Ordner.
import { toPng, toSvg } from 'html-to-image';
import { getNodesBounds } from '@xyflow/react';
import type { BoardDoc, Space } from '../store';
import type { AppNode } from '../types';
import { nodeToText } from './serialize';
import { triggerDownload } from './download';

export interface BoardExportOptions {
  format: 'png' | 'svg' | 'print';
  name: string;
  /** Zu exportierende Karten — bestimmen den Zuschnitt (Auswahl-Export!) */
  nodes: AppNode[];
  /** Auflösungs-Faktor für PNG/Druck (1–3) */
  scale?: number;
  background?: 'beige' | 'white' | 'transparent';
  /** Kopfzeile mit Board-Name + Datum */
  header?: boolean;
}

const PAD = 60;       // Rand um den Inhalt
const HEADER_H = 46;  // Platz für die Kopfzeile
const MAX_DIM = 4000; // Sicherheitsdeckel gegen Riesen-Canvas

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Board exportieren (M140): automatisch auf den INHALT zugeschnitten statt
 * riesiger Leerfläche, mit wählbarer Auflösung, Hintergrund und Kopfzeile.
 * „print" öffnet den Druckdialog — dort „Als PDF speichern" wählen.
 */
export async function exportBoard(o: BoardExportOptions): Promise<void> {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!el) throw new Error('Kein Board sichtbar');
  if (o.nodes.length === 0) throw new Error('Keine Karten zum Exportieren (Auswahl leer?)');

  // Zuschnitt: Bounding-Box der Karten + Rand (+ Platz für die Kopfzeile)
  const b = getNodesBounds(o.nodes as unknown as Parameters<typeof getNodesBounds>[0]);
  const headerH = o.header ? HEADER_H : 0;
  const bx = b.x - PAD;
  const by = b.y - PAD - headerH;
  const bw = b.width + PAD * 2;
  const bh = b.height + PAD * 2 + headerH;
  const zoom = Math.min(1, MAX_DIM / Math.max(bw, bh));
  const w = Math.round(bw * zoom);
  const h = Math.round(bh * zoom);

  const bg = o.background === 'white' ? '#ffffff' : o.background === 'transparent' ? undefined : '#f2efe9';
  const scale = Math.min(3, Math.max(1, o.scale ?? 2));
  const opts = {
    width: w,
    height: h,
    backgroundColor: bg,
    pixelRatio: scale,
    cacheBust: true,
    // Viewport-Transform überschreiben: Ausschnitt = Inhalts-Box (React-Flow-Muster)
    style: { width: `${w}px`, height: `${h}px`, transform: `translate(${-bx * zoom}px, ${-by * zoom}px) scale(${zoom})` },
  };
  const headerText = o.header
    ? `${o.name} · ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
    : '';

  if (o.format === 'svg') {
    let dataUrl = await toSvg(el, opts);
    if (headerText) dataUrl = svgWithHeader(dataUrl, headerText);
    triggerDownload(dataUrl, `${sanitize(o.name)}.svg`);
    return;
  }
  let png = await toPng(el, opts);
  if (headerText) png = await pngWithHeader(png, headerText, scale);
  if (o.format === 'print') {
    openPrint(png, o.name);
    return;
  }
  triggerDownload(png, `${sanitize(o.name)}.png`);
}

/** Kopfzeile (Board-Name + Datum) oben links ins fertige PNG zeichnen */
async function pngWithHeader(dataUrl: string, text: string, scale: number): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Export-Bild konnte nicht geladen werden'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  ctx.font = `600 ${13 * scale}px system-ui, sans-serif`;
  ctx.fillStyle = '#8a857c';
  ctx.fillText(text, 18 * scale, 28 * scale);
  return canvas.toDataURL('image/png');
}

/** Kopfzeile in den SVG-Quelltext einsetzen (Vektor bleibt Vektor) */
function svgWithHeader(dataUrl: string, text: string): string {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma + 1);
  const svg = decodeURIComponent(dataUrl.slice(comma + 1));
  const label = `<text x="18" y="28" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#8a857c">${escapeXml(text)}</text>`;
  return head + encodeURIComponent(svg.replace('</svg>', `${label}</svg>`));
}

/** PNG in einem Druckfenster öffnen — „Als PDF speichern" macht daraus das PDF */
function openPrint(png: string, name: string): void {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Popup blockiert — bitte Popups für diese Seite erlauben.');
  win.document.write(
    `<html><head><title>${escapeXml(name)}</title>`
    + '<style>body{margin:0;display:flex;justify-content:center}img{max-width:100%;height:auto}</style></head>'
    + `<body><img src="${png}" onload="setTimeout(function(){window.print()},200)"></body></html>`,
  );
  win.document.close();
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
