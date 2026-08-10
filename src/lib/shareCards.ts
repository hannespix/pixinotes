// M202: Einzelne Karten teilen — Drucken, PDF, WhatsApp, E-Mail, Übernahme-Link.
// Alles serverlos: Der Übernahme-Link nutzt die #b=-Mechanik der Board-Links
// (gzip+base64 im URL-Fragment), das PDF entsteht komplett im Browser
// (html-to-image → JPEG → minimaler, handgeschriebener PDF-Container).
import { toCanvas } from 'html-to-image';
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
   Die Karten werden offscreen als HTML gerendert, per html-to-image
   rasterisiert, in DIN-A4-Seiten zerlegt und in einen handgeschriebenen
   PDF-Container geschrieben (JPEG als DCTDecode-XObject). Kein jsPDF
   nötig (~350 KB). */

/** DIN A4 in PDF-Punkten (72 dpi) + Seitenrand */
const A4_B = 595.28;
const A4_H = 841.89;
const RAND = 36;               // 12,7 mm — passt in jeden Druckerbereich

interface PdfBild { b64: string; wPx: number; hPx: number }

/**
 * Mehrseitiges PDF aus fertigen JPEG-Seiten.
 *
 * Objektnummern: 1 = Katalog, 2 = Seitenbaum, danach je Seite ein Dreier-Satz
 * (Seite, Inhalt, Bild). Die Kreuzreferenz-Tabelle braucht die Byte-Position
 * jedes Objekts — deshalb wird beim Schreiben mitgezählt statt hinterher
 * gesucht.
 */
function bilderInPdf(seiten: PdfBild[]): Blob {
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
  const nr = (i: number) => 3 + i * 3;   // Seite i: Seite / Inhalt+1 / Bild+2

  push('%PDF-1.4\n');
  obj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n');
  obj(`2 0 obj\n<< /Type /Pages /Kids [${seiten.map((_, i) => `${nr(i)} 0 R`).join(' ')}] `
    + `/Count ${seiten.length} >>\n`);

  seiten.forEach((s, i) => {
    // Bild auf die Nutzbreite bringen, Seitenverhältnis behalten, oben ansetzen
    const bB = A4_B - 2 * RAND;
    const bH = (s.hPx / s.wPx) * bB;
    const y = A4_H - RAND - bH;
    const inhalt = `q ${bB.toFixed(2)} 0 0 ${bH.toFixed(2)} ${RAND} ${y.toFixed(2)} cm /Im Do Q`;
    const bin = atob(s.b64);
    const img = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k += 1) img[k] = bin.charCodeAt(k);
    obj(`${nr(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_B} ${A4_H}] `
      + `/Resources << /XObject << /Im ${nr(i) + 2} 0 R >> >> /Contents ${nr(i) + 1} 0 R >>\n`);
    obj(`${nr(i) + 1} 0 obj\n<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream\n`);
    obj(`${nr(i) + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${s.wPx} /Height ${s.hPx} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`, img);
  });

  const anzahl = offsets.length + 1;     // + freier Eintrag 0
  const xref = pos;
  push(`xref\n0 ${anzahl}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
  push(`trailer\n<< /Size ${anzahl} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/**
 * Ist das Bild (praktisch) leer?
 *
 * Gelesen wird zeilenweise — rund 60 Stichprobenzeilen über die ganze Höhe.
 * Punkt für Punkt zu fragen wäre bei einem 1520 Punkte breiten Bild eine
 * Viertelmillion Einzelaufrufe; das ganze Bild auf einmal zu holen wären bei
 * einer langen Notiz über hundert Megabyte. Eine Zeile je Stichprobe trifft
 * die Mitte.
 */
function istLeer(cv: HTMLCanvasElement): boolean {
  const ctx = cv.getContext('2d');
  if (!ctx) return false;
  const schritt = Math.max(1, Math.floor(cv.height / 60));
  for (let y = 0; y < cv.height; y += schritt) {
    const zeile = ctx.getImageData(0, y, cv.width, 1).data;
    for (let i = 0; i < zeile.length; i += 4) {
      if (zeile[i] < 246 || zeile[i + 1] < 246 || zeile[i + 2] < 246) return false;
    }
  }
  return true;
}

export async function cardsToPdf(nodes: AppNode[], title = 'pixinotes-karten'): Promise<void> {
  // Offscreen rendern — im Layout, aber außerhalb des sichtbaren Bereichs
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;color:#222;'
    + "padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.45;";
  host.innerHTML = nodesToHtml(nodes);
  document.body.appendChild(host);
  try {
    const scale = 2;
    const cv = await toCanvas(host, {
      pixelRatio: scale,
      backgroundColor: '#fff',
      /**
       * DER Punkt, an dem das PDF bisher leer blieb.
       *
       * html-to-image klont den Knoten und übernimmt dabei den KOMPLETTEN
       * berechneten Stil (`cssText`) — samt `position: fixed` und
       * `left: -10000px`, mit denen der Knoten hier aus dem Bild geschoben
       * wird. Der Klon landet dann in einem `foreignObject`, das nur so groß
       * ist wie der Knoten selbst, und der Inhalt steht 10 000 Punkte links
       * davon: außerhalb. Herausgekommen ist ein tadellos aufgebautes PDF mit
       * einer weißen Seite — und ein Erfolgs-Hinweis dazu.
       *
       * `style` wird nach dem Klonen auf den Klon gelegt und hebt die
       * Verschiebung wieder auf.
       */
      style: { position: 'static', left: '0', top: '0', margin: '0', transform: 'none' },
    });
    if (!cv.width || !cv.height) throw new Error('Nichts zu rendern');
    if (istLeer(cv)) throw new Error('Die Karten haben nichts Sichtbares ergeben');

    /**
     * In A4-Seiten zerlegen. Vorher war es EINE Seite in Inhaltsgröße — bei
     * einer kurzen Notiz also ein 20 × 4 cm großer Streifen, den kein Drucker
     * sinnvoll ausgibt. Geschnitten wird an der Stelle, an der die auf
     * Nutzbreite skalierte Höhe die Nutzhöhe füllt.
     */
    const proSeite = Math.max(1, Math.floor(cv.width * ((A4_H - 2 * RAND) / (A4_B - 2 * RAND))));
    const seiten: PdfBild[] = [];
    for (let oben = 0; oben < cv.height; oben += proSeite) {
      const hoch = Math.min(proSeite, cv.height - oben);
      const teil = document.createElement('canvas');
      teil.width = cv.width;
      teil.height = hoch;
      const tctx = teil.getContext('2d');
      if (!tctx) throw new Error('Kein Zeichenkontext');
      tctx.fillStyle = '#fff';
      tctx.fillRect(0, 0, teil.width, teil.height);
      tctx.drawImage(cv, 0, oben, cv.width, hoch, 0, 0, cv.width, hoch);
      // Der Rest am Ende ist oft nur ein paar Punkte hoher weißer Streifen —
      // daraus eine zusätzliche leere A4-Seite zu machen, wäre nur lästig.
      if (seiten.length && oben + hoch >= cv.height && istLeer(teil)) break;
      seiten.push({ b64: teil.toDataURL('image/jpeg', 0.92).split(',')[1], wPx: teil.width, hPx: hoch });
    }

    const url = URL.createObjectURL(bilderInPdf(seiten));
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
