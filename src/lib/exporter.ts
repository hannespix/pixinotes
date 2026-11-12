// Export: Board als PNG/SVG/PDF, Boards als Markdown-Dateien in einen Ordner.
import { toPng, toSvg } from 'html-to-image';
import { getNodesBounds } from '@xyflow/react';
import { allesZeigen } from './fernRuhe';
import type { BoardDoc, Space } from '../store';
import type { AppNode } from '../types';
import { nodeToMarkdown } from './serialize';
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
  /** M340: NUR diese Karten zeigen (Auswahl-Export) — Nachbarn im Ausschnitt, fremde Linien und Striche bleiben draußen */
  nurDiese?: boolean;
  /** Linien zwischen den Karten (für den Auswahl-Export: nur die zwischen gewählten Karten) */
  edges?: Array<{ id: string; source: string; target: string }>;
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
  /**
   * M340: Das Druckfenster entsteht SOFORT, noch im Klick. Vorher wurde es erst nach dem Rendern
   * geöffnet (ein, zwei Sekunden später) — für den Browser kein Klick mehr, also ein Pop-up, das
   * er blockiert. Der Druck-Export meldete dann „Popup blockiert", obwohl niemand etwas falsch machte.
   */
  const druck = o.format === 'print' ? window.open('', '_blank') : null;
  if (o.format === 'print' && !druck) throw new Error('Popup blockiert — bitte Popups für diese Seite erlauben.');
  if (druck) druck.document.write('<title>PixiNotes</title><p style="font:14px system-ui;color:#666;padding:24px">Bild wird erstellt …</p>');

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

  // Vorgabe: die Fläche, wie man sie sieht (auch im dunklen Design) — vorher immer hellgrau
  const flaeche = getComputedStyle(document.querySelector('.react-flow') ?? document.body).backgroundColor;
  const bg = o.background === 'white' ? '#ffffff' : o.background === 'transparent' ? undefined
    : (flaeche && flaeche !== 'rgba(0, 0, 0, 0)' && flaeche !== 'transparent' ? flaeche : '#f3f4f6');
  // Auswahl-Export: nur die gewählten Karten und die Linien zwischen ihnen
  const ids = new Set(o.nodes.map((n) => n.id));
  const linien = new Set((o.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.id));
  const filter = (n: HTMLElement): boolean => {
    if (!o.nurDiese || !n.classList) return true;
    if (n.classList.contains('react-flow__node')) return ids.has(n.dataset?.id ?? n.getAttribute('data-id') ?? '');
    // Linien: Die Bildbibliothek übernimmt ein <svg> samt Inhalt am Stück (der Filter sieht dessen Kinder nie) —
    // entschieden wird deshalb am <svg>, das die Linie umschließt.
    const kanten = n.tagName?.toLowerCase() === 'svg' && typeof n.querySelectorAll === 'function' ? Array.from(n.querySelectorAll('.react-flow__edge')) : [];
    if (kanten.length) return kanten.some((k) => linien.has(k.getAttribute('data-id') ?? (k.getAttribute('data-testid') ?? '').replace('rf__edge-', '')));
    return true;
  };
  const scale = Math.min(3, Math.max(1, o.scale ?? 2));
  const opts = {
    width: w,
    height: h,
    backgroundColor: bg,
    pixelRatio: scale,
    cacheBust: true,
    filter,
    // Viewport-Transform überschreiben: Ausschnitt = Inhalts-Box (React-Flow-Muster)
    style: { width: `${w}px`, height: `${h}px`, transform: `translate(${-bx * zoom}px, ${-by * zoom}px) scale(${zoom})` },
  };
  const headerText = o.header
    ? `${o.name} · ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
    : '';

  // M338: Fern ruhende Karten (lib/fernRuhe.ts) für die Aufnahme wecken — sonst wären sie im Bild leer
  const ruheWieder = await allesZeigen();
  /**
   * M340: Stift- und Textmarker-Striche gehören ins Bild. Sie liegen in einer eigenen Ebene ÜBER
   * dem Board (nicht in der Fläche, die hier aufgenommen wird) und fehlten deshalb in jedem
   * Export. Für die Aufnahme wandert eine Kopie in die Fläche — in Board-Koordinaten.
   */
  const strichKopie = stricheInDieFlaeche(el, o.nurDiese ? ids : null);
  let png: string;
  try {
    if (o.format === 'svg') {
      let dataUrl = await toSvg(el, opts);
      if (headerText) dataUrl = svgWithHeader(dataUrl, headerText);
      triggerDownload(dataUrl, `${sanitize(o.name)}.svg`);
      return;
    }
    png = await toPng(el, opts);
  } catch (e) {
    druck?.close();
    throw e;
  } finally {
    strichKopie?.remove();
    ruheWieder();
  }
  if (headerText) png = await pngWithHeader(png, headerText, scale);
  if (druck) {
    openPrint(druck, png, o.name);
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
function openPrint(win: Window, png: string, name: string): void {
  win.document.open();
  win.document.write(
    `<html><head><title>${escapeXml(name)}</title>`
    + '<style>body{margin:0;display:flex;justify-content:center}img{max-width:100%;height:auto}</style></head>'
    + `<body><img src="${png}" onload="setTimeout(function(){window.print()},200)"></body></html>`,
  );
  win.document.close();
}

/** Kopie der Strich-Ebene in die Board-Fläche hängen (nur für die Aufnahme) — `nur`: Striche an diesen Karten */
function stricheInDieFlaeche(flaeche: HTMLElement, nur: Set<string> | null): SVGSVGElement | null {
  const gruppe = document.querySelector('.drawing-layer > g');
  if (!gruppe || gruppe.childElementCount === 0) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'export-striche');
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:3000');
  for (const p of Array.from(gruppe.children)) {
    // M356: Textmarker liegen je Farbe in einer Gruppe (sie trägt Deckkraft und Mischung) — bei „nur Auswahl"
    // kommt die Gruppe mit, aber nur mit den Strichen der gewählten Karten
    if (p.classList.contains('marker-gruppe')) {
      const g = p.cloneNode(false) as Element;
      for (const k of Array.from(p.children)) if (!nur || nur.has(k.getAttribute('data-anker') ?? '')) g.appendChild(k.cloneNode(true));
      if (g.childElementCount > 0) svg.appendChild(g);
      continue;
    }
    if (nur && !nur.has(p.getAttribute('data-anker') ?? '')) continue;
    svg.appendChild(p.cloneNode(true));
  }
  if (svg.childElementCount === 0) return null;
  flaeche.appendChild(svg);
  return svg;
}

/** Ein Board als Markdown (Karten als Abschnitte). */
export function boardToMarkdown(board: BoardDoc): string {
  // M340: echtes Markdown (Überschriften, Listen, Kästchen, Tabellen, Links) statt Klartext mit .md-Endung;
  // archivierte Karten bleiben draußen, die Karten folgen der Lesereihenfolge (oben nach unten, links nach rechts)
  const karten = board.nodes.filter((n) => !n.archived)
    .sort((a, b) => (Math.round(a.position.y / 80) - Math.round(b.position.y / 80)) || (a.position.x - b.position.x));
  const teile = karten.map((n) => nodeToMarkdown(n).trim()).filter(Boolean);
  return `# ${board.name}\n\n${teile.join('\n\n---\n\n')}\n`;
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
    /**
     * Fallback (Firefox/Safari/file://): EINE Datei mit allen Boards, gegliedert nach Bereich und Projekt.
     * M340: Vorher je Board ein eigener Download — Browser lassen von mehreren Downloads hintereinander
     * nur den ersten durch, der Rest verschwand ohne Meldung.
     */
    const teile: string[] = [];
    const drin = new Set<string>();
    for (const space of spaces) for (const project of space.projects) for (const bid of project.boardIds) {
      const b = boardById.get(bid);
      if (!b) continue;
      drin.add(bid);
      teile.push(`<!-- ${space.name} / ${project.name} -->\n\n${boardToMarkdown(b)}`);
    }
    for (const b of boards) if (!drin.has(b.id)) teile.push(boardToMarkdown(b));
    triggerDownload(URL.createObjectURL(new Blob([teile.join('\n\n')], { type: 'text/markdown;charset=utf-8' })), 'pixinotes-export.md');
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
