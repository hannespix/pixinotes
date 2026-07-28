// M184: Word-Dokumente (.docx) in Notiz-Karten übersetzen — ohne Konto, ohne
// Netz, ohne Fremdbibliothek. Das ist zugleich der kontofreie Weg für OneNote:
// „Datei → Exportieren → Word", dann die .docx hier hereinziehen.
//
// Ablauf: ZIP öffnen (lib/unzip) → word/document.xml lesen → in schlankes
// HTML übersetzen → htmlToBlocks() macht daraus sichere Blöcke.
// Der Umweg über HTML spart einen zweiten Konverter: OneNote liefert ohnehin
// HTML, beide Wege enden damit im selben, geprüften Code.

import { ZipArchive } from './unzip';
import { htmlToBlocks, type Block } from './htmlBlocks';

export interface DocxResult {
  /** Blöcke für die Notiz-Karte */
  blocks: Block[];
  /** Eingebettete Bilder als data:-URLs (der Aufrufer legt Bild-Karten an) */
  images: Array<{ src: string; alt?: string }>;
  /** Überschrift der ersten Zeile — taugt als Kartenname */
  title: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Kinder mit passendem lokalen Namen (Namensraum-Präfixe sind uns egal) */
const kids = (el: Element, local: string): Element[] =>
  Array.from(el.children).filter((c) => c.localName === local);

const firstKid = (el: Element, local: string): Element | null =>
  Array.from(el.children).find((c) => c.localName === local) ?? null;

/** Attribut ohne Namensraum-Gefrickel lesen (w:val, r:embed, …) */
function attr(el: Element | null, local: string): string | null {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) {
    if (a.localName === local) return a.value;
  }
  return null;
}

/** Tiefensuche nach dem ersten Nachfahren mit diesem lokalen Namen */
function deepFind(el: Element, local: string): Element | null {
  for (const c of Array.from(el.children)) {
    if (c.localName === local) return c;
    const hit = deepFind(c, local);
    if (hit) return hit;
  }
  return null;
}

/** MIME aus der Dateiendung im ZIP */
function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/**
 * numbering.xml auswerten: numId → „ist das eine Aufzählung oder eine
 * Nummerierung?" (je Ebene). Ohne die Datei raten wir auf Aufzählung.
 */
function parseNumbering(xml: string | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!xml) return map;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch { return map; }
  const root = doc.documentElement;
  if (!root) return map;
  // abstractNumId → Formate je Ebene
  const abstract = new Map<string, string[]>();
  for (const an of kids(root, 'abstractNum')) {
    const id = attr(an, 'abstractNumId');
    if (!id) continue;
    const fmts: string[] = [];
    for (const lvl of kids(an, 'lvl')) {
      const ilvl = Number(attr(lvl, 'ilvl') ?? '0');
      fmts[ilvl] = attr(firstKid(lvl, 'numFmt'), 'val') ?? 'bullet';
    }
    abstract.set(id, fmts);
  }
  for (const n of kids(root, 'num')) {
    const numId = attr(n, 'numId');
    const absId = attr(firstKid(n, 'abstractNumId'), 'val');
    if (numId && absId && abstract.has(absId)) map.set(numId, abstract.get(absId)!);
  }
  return map;
}

/** Ein <w:r>-Lauf → HTML-Schnipsel (mit Fett/Kursiv/Unterstrichen) */
function runHtml(run: Element, images: Map<string, string>): string {
  const rPr = firstKid(run, 'rPr');
  let out = '';
  for (const c of Array.from(run.children)) {
    if (c.localName === 't') out += esc(c.textContent ?? '');
    else if (c.localName === 'tab') out += ' ';
    else if (c.localName === 'br') out += '<br>';
    else if (c.localName === 'drawing' || c.localName === 'pict' || c.localName === 'object') {
      const blip = deepFind(c, 'blip') ?? deepFind(c, 'imagedata');
      const rid = attr(blip, 'embed') ?? attr(blip, 'link') ?? attr(blip, 'id');
      const src = rid ? images.get(rid) : undefined;
      if (src) out += `<img src="${src}" alt="Bild aus Word-Dokument">`;
    } else if (c.localName === 'sym') {
      // Symbolzeichen (Wingdings-Kästchen o. Ä.) — als Text durchreichen
      const ch = attr(c, 'char');
      if (ch) out += esc(String.fromCharCode(parseInt(ch, 16) & 0xff));
    }
  }
  if (!out) return '';
  if (rPr) {
    if (firstKid(rPr, 'b')) out = `<b>${out}</b>`;
    if (firstKid(rPr, 'i')) out = `<i>${out}</i>`;
    if (firstKid(rPr, 'u')) out = `<u>${out}</u>`;
    if (firstKid(rPr, 'strike') || firstKid(rPr, 'dstrike')) out = `<s>${out}</s>`;
  }
  return out;
}

/** Inhalt eines <w:p> (alle Läufe, auch die in Hyperlinks/SDTs) */
function paraInner(p: Element, images: Map<string, string>): string {
  let out = '';
  const walk = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === 'r') out += runHtml(c, images);
      else if (c.localName === 'hyperlink' || c.localName === 'sdt' || c.localName === 'sdtContent'
        || c.localName === 'smartTag' || c.localName === 'ins') walk(c);
    }
  };
  walk(p);
  return out;
}

interface ParaInfo { style: string; numId: string | null; ilvl: number }

function paraInfo(p: Element): ParaInfo {
  const pPr = firstKid(p, 'pPr');
  const style = (attr(firstKid(pPr ?? p, 'pStyle'), 'val') ?? '').toLowerCase();
  const numPr = pPr ? firstKid(pPr, 'numPr') : null;
  return {
    style,
    numId: numPr ? attr(firstKid(numPr, 'numId'), 'val') : null,
    ilvl: numPr ? Number(attr(firstKid(numPr, 'ilvl'), 'val') ?? '0') : 0,
  };
}

/** „Heading2" / „berschrift2" → 2; Title → 1 */
function headingLevel(style: string): number | null {
  if (/^(title|titel)$/.test(style)) return 1;
  const m = style.match(/(?:heading|berschrift|rubrik)\s*(\d)/);
  return m ? Math.min(3, Math.max(1, Number(m[1]))) : null;
}

/** Kästchen-Zeichen am Zeilenanfang (Word-Export aus OneNote/Checklisten) */
const BOX_OPEN = /^\s*(?:&#9744;|[☐□❑▢⬜])\s*/;
const BOX_DONE = /^\s*(?:&#9746;|[☑☒✔✓■⬛])\s*/;

/** Word-Dokument einlesen und in Notiz-Blöcke übersetzen */
export async function docxToBlocks(file: File | ArrayBuffer): Promise<DocxResult> {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const zip = await ZipArchive.open(buf);
  const docXml = await zip.text('word/document.xml');
  if (!docXml) throw new Error('Das ist keine Word-Datei (word/document.xml fehlt).');

  // Bild-Beziehungen auflösen: rId → data:-URL
  const images = new Map<string, string>();
  const relsXml = await zip.text('word/_rels/document.xml.rels');
  if (relsXml) {
    try {
      const rels = new DOMParser().parseFromString(relsXml, 'application/xml');
      for (const r of Array.from(rels.getElementsByTagName('Relationship'))) {
        const type = r.getAttribute('Type') ?? '';
        const target = r.getAttribute('Target') ?? '';
        const id = r.getAttribute('Id') ?? '';
        if (!/\/image$/.test(type) || !id || !target || /^https?:/i.test(target)) continue;
        const path = target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/\/\.\//g, '/');
        const url = await zip.dataUrl(path.replace(/^word\/\.\.\//, ''), mimeOf(path));
        if (url) images.set(id, url);
      }
    } catch { /* Bilder sind Beiwerk — Text ist wichtiger */ }
  }

  const numbering = parseNumbering(await zip.text('word/numbering.xml'));

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(docXml, 'application/xml');
  } catch {
    throw new Error('Das Word-Dokument ließ sich nicht lesen (fehlerhaftes XML).');
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Das Word-Dokument ließ sich nicht lesen (fehlerhaftes XML).');
  }
  const body = deepFind(doc.documentElement, 'body');
  if (!body) throw new Error('Das Word-Dokument enthält keinen Textkörper.');

  // ---- Word-XML → schlankes HTML ----
  const html: string[] = [];

  // Word kennt keine verschachtelten Listen-Elemente, sondern nur eine
  // Ebenen-Nummer (w:ilvl) je Absatz. Die Punkte werden deshalb gepuffert und
  // erst am Listenende zu echtem, verschachteltem HTML gefaltet.
  interface LItem { tag: 'ul' | 'ol'; level: number; inner: string }
  let pending: LItem[] = [];

  /** Ab `start` alle Punkte ab Ebene `level` zu einer Liste falten */
  const fold = (items: LItem[], start: number, level: number): [string, number] => {
    const tag = items[start].tag;
    let out = `<${tag}>`;
    let i = start;
    while (i < items.length && items[i].level >= level) {
      if (items[i].level > level) {
        // Tiefere Ebene ohne Elternpunkt davor — als eigene Unterliste anhängen
        const [sub, next] = fold(items, i, items[i].level);
        out += sub;
        i = next;
        continue;
      }
      if (items[i].tag !== tag) break;   // Wechsel Aufzählung ↔ Nummerierung
      out += `<li>${items[i].inner}`;
      i += 1;
      if (i < items.length && items[i].level > level) {
        const [sub, next] = fold(items, i, items[i].level);
        out += sub;      // Unterliste gehört INNERHALB des Punktes
        i = next;
      }
      out += '</li>';
    }
    return [`${out}</${tag}>`, i];
  };

  const closeList = () => {
    if (pending.length === 0) return;
    let i = 0;
    while (i < pending.length) {
      const [chunk, next] = fold(pending, i, pending[i].level);
      html.push(chunk);
      i = next > i ? next : i + 1;
    }
    pending = [];
  };

  const paraHtml = (p: Element): void => {
    const info = paraInfo(p);
    let inner = paraInner(p, images);
    const plain = inner.replace(/<[^>]+>/g, '').trim();

    if (info.numId) {
      if (!plain && !/<img /.test(inner)) return;
      const fmts = numbering.get(info.numId);
      const fmt = fmts?.[info.ilvl] ?? fmts?.[0] ?? 'bullet';
      const tag: 'ul' | 'ol' = fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
      // Kästchen-Zeichen gewinnen auch innerhalb einer Liste
      if (BOX_DONE.test(plain) || BOX_OPEN.test(plain)) {
        const done = BOX_DONE.test(plain);
        pending.push({ tag: 'ul', level: info.ilvl, inner: `<input type="checkbox"${done ? ' checked' : ''}>${inner.replace(BOX_DONE, '').replace(BOX_OPEN, '')}` });
        return;
      }
      pending.push({ tag, level: info.ilvl, inner });
      return;
    }
    closeList();
    if (!plain && !/<img /.test(inner)) return;   // Leerabsätze schlucken

    // Kästchen am Zeilenanfang → echte Checkliste
    if (BOX_DONE.test(plain) || BOX_OPEN.test(plain)) {
      const done = BOX_DONE.test(plain);
      inner = inner.replace(BOX_DONE, '').replace(BOX_OPEN, '');
      html.push(`<ul><li><input type="checkbox"${done ? ' checked' : ''}>${inner}</li></ul>`);
      return;
    }
    const lvl = headingLevel(info.style);
    if (lvl) { html.push(`<h${lvl}>${inner}</h${lvl}>`); return; }
    html.push(`<p>${inner}</p>`);
  };

  const tableHtml = (tbl: Element): void => {
    closeList();
    const rows: string[] = [];
    for (const tr of kids(tbl, 'tr')) {
      const cells: string[] = [];
      for (const tc of kids(tr, 'tc')) {
        const inner = kids(tc, 'p').map((p) => paraInner(p, images)).filter(Boolean).join(' ');
        cells.push(`<td>${inner}</td>`);
      }
      if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`);
    }
    if (rows.length) html.push(`<table>${rows.join('')}</table>`);
  };

  const walkBody = (el: Element): void => {
    for (const c of Array.from(el.children)) {
      if (c.localName === 'p') paraHtml(c);
      else if (c.localName === 'tbl') tableHtml(c);
      else if (c.localName === 'sdt' || c.localName === 'sdtContent') walkBody(c);
    }
  };
  walkBody(body);
  closeList();

  const parsed = htmlToBlocks(html.join(''));
  // Titel: erste Überschrift, sonst erste Textzeile
  let title = '';
  for (const b of parsed.blocks) {
    const c = b.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((s) => (s as { text?: string }).text ?? '').join('') : '';
    if (text.trim()) { title = text.trim().slice(0, 60); if (b.type === 'heading') break; }
    if (title) break;
  }
  return { blocks: parsed.blocks, images: parsed.images, title };
}
