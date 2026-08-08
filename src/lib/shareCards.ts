// M202: Einzelne Karten teilen — Drucken, PDF, WhatsApp, E-Mail, Übernahme-Link.
// Alles serverlos: Der Übernahme-Link nutzt die #b=-Mechanik der Board-Links
// (gzip+base64 im URL-Fragment), das PDF entsteht komplett im Browser
// (html-to-image → JPEG → minimaler, handgeschriebener PDF-Container).
import { toJpeg } from 'html-to-image';
import { uid, type AppNode } from '../types';
import type { BoardDoc, Stroke } from '../store';
import { nodesToHtml, nodesToText } from './serialize';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from './share';

/** Auswahl als Mini-Board fürs Teilen: Karten + Verbindungen dazwischen +
 *  geankerte Markierungen. Der Empfänger bekommt es über den bestehenden
 *  #b=-Import als eigenes Board angeboten (frische IDs, Portale entwertet). */
export function cardsToBoardDoc(nodes: AppNode[], board: BoardDoc, name: string): BoardDoc {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    id: uid(),
    name,
    nodes: nodes.map((n) => ({ ...n, selected: false })),
    edges: (board.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)),
    drawings: ((board.drawings ?? []) as Stroke[]).filter((s) => s.anchor && ids.has(s.anchor)),
  };
}

/** Übernahme-Link erzeugen — bei Übergröße (Bilder!) Datei-Fallback */
export async function cardsShareUrl(doc: BoardDoc): Promise<string | null> {
  const url = await boardToShareUrl(doc);
  if (url.length > SHARE_URL_LIMIT) {
    downloadBoardFile(doc);
    return null;
  }
  return url;
}

const PRINT_CSS = `
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         color: #222; max-width: 760px; margin: 24px auto; padding: 0 16px; line-height: 1.45; }
  h1, h2, h3 { line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 4px 8px; }
  .pn-print-foot { margin-top: 28px; font-size: 11px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
`;

function cardsHtmlDoc(nodes: AppNode[], title: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>`
    + `<style>${PRINT_CSS}</style></head><body>${nodesToHtml(nodes)}`
    + `<div class="pn-print-foot">Aus PixiNotes geteilt · ${new Date().toLocaleDateString('de-DE')}</div>`
    + '</body></html>';
}

/** Druckfenster (dort bietet jeder Browser auch „Als PDF sichern" an) */
export function printCards(nodes: AppNode[], title = 'PixiNotes'): boolean {
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return false;
  win.document.write(cardsHtmlDoc(nodes, title));
  win.document.close();
  // Bilder erst laden lassen, sonst druckt der Dialog leere Kästen
  win.addEventListener('load', () => setTimeout(() => win.print(), 150));
  return true;
}

/* ---------- PDF-Datei ohne Fremdbibliothek ----------
   Die Karten werden offscreen als HTML gerendert, per html-to-image zu einem
   JPEG rasterisiert und in einen minimalen PDF-Container geschrieben (eine
   Seite in Inhaltsgröße, DCTDecode-XObject). Kein jsPDF nötig (~350 KB). */
function jpegIntoPdf(jpegB64: string, wPx: number, hPx: number, scale: number): Blob {
  const bin = atob(jpegB64);
  const img = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) img[i] = bin.charCodeAt(i);
  const wPt = (wPx / scale) * 0.75; // CSS-px (96 dpi) → PDF-Punkte (72 dpi)
  const hPt = (hPx / scale) * 0.75;
  const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im Do Q`;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    pos += bytes.length;
  };
  const obj = (body: string, stream?: Uint8Array) => {
    offsets.push(pos);
    push(body);
    if (stream) { push(stream); push('\nendstream\nendobj\n'); } else push('endobj\n');
  };
  push('%PDF-1.4\n');
  obj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n');
  obj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
  obj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] `
    + '/Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>\n');
  obj(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
  obj(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} `
    + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`, img);
  const xref = pos;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export async function cardsToPdf(nodes: AppNode[], title = 'pixinotes-karten'): Promise<void> {
  // Offscreen rendern — sichtbar fürs Rasterisieren, aber außerhalb des Schirms
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;color:#222;'
    + "padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.45;";
  host.innerHTML = nodesToHtml(nodes);
  document.body.appendChild(host);
  try {
    const scale = 2;
    const jpeg = await toJpeg(host, { pixelRatio: scale, quality: 0.92, backgroundColor: '#fff' });
    const wPx = host.offsetWidth * scale;
    const hPx = host.offsetHeight * scale;
    const blob = jpegIntoPdf(jpeg.split(',')[1], wPx, hPx, scale);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    host.remove();
  }
}

/** WhatsApp: Text-Teilen über den offiziellen wa.me-Weg (App ODER Web) */
export function whatsappUrl(nodes: AppNode[]): string {
  let text = nodesToText(nodes);
  if (text.length > 3500) text = `${text.slice(0, 3500)}\n… (gekürzt)`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
