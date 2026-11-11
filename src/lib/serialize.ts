// Karten → Text / HTML: für „Per E-Mail teilen", Zwischenablage (Outlook-Paste)
// und die Suche. Bewusst schlicht gehalten — sauberes Office-taugliches HTML.
import { doneCol, kanbanCols, type AppNode, type SheetData } from '../types';
import { formatBytes } from './parseEmail';
import { indexZuAdresse, rechneBlatt, zeigeWert } from './formel';

/**
 * M256: Rechen-Tabelle als Zeilen — für Suche, Text- und HTML-Export.
 *
 * Ausgegeben wird der errechnete Wert, nicht die Formel: In einer E-Mail oder
 * im PDF nützt „=SUMME(B2:B9)" niemandem, die 12.480 dagegen schon.
 */
function sheetZeilen(s: SheetData): string[][] {
  const zellen = s.cells ?? {};
  const spalten = Math.max(1, s.cols ?? 5);
  const zeilen = Math.max(1, s.rows ?? 8);
  const werte = rechneBlatt(zellen);
  const aus: string[][] = [];
  for (let z = 0; z < zeilen; z += 1) {
    const reihe: string[] = [];
    for (let sp = 0; sp < spalten; sp += 1) {
      const adr = indexZuAdresse(sp, z);
      reihe.push(zeigeWert(werte[adr] ?? null));
    }
    // Komplett leere Zeilen am Ende weglassen — sonst besteht der Export
    // hauptsächlich aus Tabulatoren
    if (reihe.some((c) => c !== '')) aus.push(reihe);
  }
  return aus;
}

/**
 * M283: Dieselbe Ausgabe für die Rechen-Tabelle IN einer Notiz.
 *
 * Der Block trägt seine Zellen als JSON-Text in den Eigenschaften — für
 * Export, Suche und den KI-Kontext wird daraus dieselbe Zeilenform wie bei
 * der Rechen-Karte, samt errechneter Werte.
 */
export function rechenBlockZeilen(props: Record<string, unknown> | undefined): string[][] {
  if (!props) return [];
  let zellen: Record<string, string> = {};
  try {
    const w = JSON.parse(String(props.zellen ?? '{}'));
    if (w && typeof w === 'object') zellen = w as Record<string, string>;
  } catch { /* kaputtes JSON: dann eben leer */ }
  return sheetZeilen({
    cells: zellen,
    cols: Math.max(1, Number(props.spalten) || 3),
    rows: Math.max(1, Number(props.zeilen) || 3),
  } as SheetData);
}

/* ---------- BlockNote-Blöcke → Text/HTML ---------- */

interface AnyBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
  rows?: unknown;
}

function inlineText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const obj = c as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (obj.type === 'link' && typeof obj.href === 'string') {
            // M340: Ein Link ohne Adresse ist im Klartext wertlos — sie steht dahinter (außer sie IST der Text)
            const t = inlineText(obj.content);
            return !t || t === obj.href || `https://${t}` === obj.href ? obj.href : `${t} (${obj.href})`;
          }
          if (obj.content) return inlineText(obj.content);
        }
        return '';
      })
      .join('');
  }
  if (typeof content === 'object' && (content as AnyBlock).rows) {
    // Tabellen-Inhalt
    const rows = (content as { rows: { cells: unknown[] }[] }).rows;
    return rows.map((r) => r.cells.map((cell) => inlineText(cell)).join(' | ')).join('\n');
  }
  return '';
}

/** Vollständiges HTML-Escaping inkl. Quotes — auch für Attribut-Kontexte sicher (Audit SEC-1) */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function blocksToText(blocks: unknown[] | undefined): string {
  if (!blocks) return '';
  const lines: string[] = [];
  const walk = (bs: AnyBlock[], depth: number) => {
    let nummer = 0; // M340: nummerierte Punkte tragen ihre Nummer (vorher „- ")
    for (const b of bs) {
      const text = inlineText(b.content);
      const indent = '  '.repeat(depth);
      if (b.type === 'numberedListItem') nummer = nummer === 0 ? (Number(b.props?.start) || 1) : nummer + 1; else nummer = 0;
      switch (b.type) {
        case 'heading':
          lines.push(`${indent}${text}`);
          break;
        case 'checkListItem':
          lines.push(`${indent}${b.props?.checked ? '☑' : '☐'} ${text}`);
          break;
        case 'bulletListItem':
          lines.push(`${indent}• ${text}`);
          break;
        case 'numberedListItem':
          lines.push(`${indent}${nummer}. ${text}`);
          break;
        case 'quote':
          lines.push(`${indent}„${text}“`);
          break;
        case 'table':
          lines.push(inlineText(b.content));
          break;
        case 'rechentabelle':
          // M283: als Zeilen mit „ | " — dieselbe Form wie die Rechen-Karte,
          // damit Suche und KI die Zahlen wirklich lesen können
          for (const r of rechenBlockZeilen(b.props)) lines.push(`${indent}${r.join(' | ')}`);
          break;
        case 'image': {
          /* M289: Ein Bild im Text hat keinen Text — im Klartext bliebe an
             seiner Stelle eine Lücke. Bildunterschrift und Dateiname sind das,
             wonach Menschen später suchen; die Base64-Daten selbst haben in
             Suche, E-Mail und KI-Anfrage nichts verloren. */
          const p = b.props as { caption?: string; name?: string } | undefined;
          lines.push(`${indent}🖼 ${p?.caption || p?.name || 'Bild'}`);
          break;
        }
        default:
          if (text) lines.push(`${indent}${text}`);
      }
      if (b.children?.length) walk(b.children, depth + 1);
    }
  };
  walk(blocks as AnyBlock[], 0);
  return lines.join('\n');
}

/* M340: Farben der Notiz (BlockNote-Namen) als feste Werte — Outlook, Word und das PDF kennen die Namen nicht */
const TEXT_FARBE: Record<string, string> = { gray: '#9b9a97', brown: '#64473a', red: '#e03e3e', orange: '#d9730d', yellow: '#dfab01', green: '#4d6461', blue: '#0b6e99', purple: '#6940a5', pink: '#ad1a72' };
const GRUND_FARBE: Record<string, string> = { gray: '#ebeced', brown: '#e9e5e3', red: '#fbe4e4', orange: '#f6e9d9', yellow: '#fbf3db', green: '#ddedea', blue: '#ddebf1', purple: '#eae4f2', pink: '#f4dfeb' };
const farbe = (v: unknown, t: Record<string, string>): string | null => {
  if (typeof v !== 'string' || !v || v === 'default') return null;
  if (t[v]) return t[v];
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\([\d\s.,%]+\)$/i.test(v) ? v : null;
};
/** Nur Adressen, die man gefahrlos anklickbar weitergeben kann */
const sichereAdresse = (h: unknown): string | null =>
  (typeof h === 'string' && /^(https?:|mailto:|tel:)/i.test(h.trim()) ? h.trim() : null);

/** Inline-Inhalt MIT Formatierung: fett, kursiv, unterstrichen, durchgestrichen, Code, Farben, Links */
function inlineHtml(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return esc(content);
  if (!Array.isArray(content)) {
    const o = content as { content?: unknown };
    return o && typeof o === 'object' && o.content ? inlineHtml(o.content) : esc(inlineText(content));
  }
  return content.map((c) => {
    if (typeof c === 'string') return esc(c);
    if (!c || typeof c !== 'object') return '';
    const o = c as { type?: string; text?: unknown; styles?: Record<string, unknown>; href?: unknown; content?: unknown };
    if (o.type === 'link') {
      const innen = inlineHtml(o.content) || esc(String(o.href ?? ''));
      const h = sichereAdresse(o.href);
      return h ? `<a href="${esc(h)}" style="color:#3557c9">${innen}</a>` : innen;
    }
    if (typeof o.text !== 'string') return o.content ? inlineHtml(o.content) : '';
    let h = esc(o.text).replace(/\n/g, '<br>');
    const st = o.styles ?? {};
    if (st.code) h = `<code style="background:#f1f1ef;border-radius:3px;padding:0 3px;font-family:Consolas,Menlo,monospace;font-size:.92em">${h}</code>`;
    if (st.bold) h = `<b>${h}</b>`;
    if (st.italic) h = `<i>${h}</i>`;
    if (st.underline) h = `<u>${h}</u>`;
    if (st.strike) h = `<s>${h}</s>`;
    const tc = farbe(st.textColor, TEXT_FARBE); const bc = farbe(st.backgroundColor, GRUND_FARBE);
    if (tc || bc) h = `<span style="${tc ? `color:${tc};` : ''}${bc ? `background:${bc};` : ''}">${h}</span>`;
    return h;
  }).join('');
}

/** Stil eines Blocks aus seinen Eigenschaften: Ausrichtung, Text- und Grundfarbe */
function blockStil(b: AnyBlock, basis = ''): string {
  const p = b.props ?? {};
  const a = typeof p.textAlignment === 'string' && ['center', 'right', 'justify'].includes(p.textAlignment) ? `text-align:${p.textAlignment};` : '';
  const tc = farbe(p.textColor, TEXT_FARBE); const bc = farbe(p.backgroundColor, GRUND_FARBE);
  const st = `${basis}${a}${tc ? `color:${tc};` : ''}${bc ? `background:${bc};` : ''}`;
  return st ? ` style="${st}"` : '';
}

const istLeererAbsatz = (b: AnyBlock): boolean =>
  (b.type === 'paragraph' || !b.type) && !inlineText(b.content) && !(b.children?.length);

/**
 * Blöcke einer Notiz als HTML — für Zwischenablage (Outlook/Word), Druck und PDF.
 * M340: mit allem, was die Notiz zeigt. Vorher fielen Unterpunkte ganz weg, Fett/Kursiv/Farben
 * und Links gingen verloren, Zitate und Code waren schlichte Absätze.
 */
export function blocksToHtml(blocks: unknown[] | undefined): string {
  if (!blocks) return '';
  const alle = [...(blocks as AnyBlock[])];
  while (alle.length && istLeererAbsatz(alle[alle.length - 1])) alle.pop(); // der leere Schluss-Absatz des Editors
  return blocksHtml(alle);
}

function blocksHtml(bs: AnyBlock[]): string {
  const parts: string[] = [];
  let listOpen: string | null = null;
  const closeList = () => {
    if (listOpen) {
      parts.push(`</${listOpen === 'check' ? 'ul' : listOpen}>`);
      listOpen = null;
    }
  };
  const kinder = (b: AnyBlock) => (b.children?.length ? blocksHtml(b.children) : '');
  const eingerueckt = (b: AnyBlock) => { const k = kinder(b); return k ? `<div style="margin-left:24px">${k}</div>` : ''; };
  for (const b of bs) {
    const text = inlineHtml(b.content);
    switch (b.type) {
      case 'heading': {
        closeList();
        const level = Math.min(4, Math.max(1, Number(b.props?.level ?? 3)));
        parts.push(`<h${level}${blockStil(b, 'margin:10px 0 4px;')}>${text}</h${level}>${eingerueckt(b)}`);
        break;
      }
      case 'checkListItem':
        if (listOpen !== 'check') { closeList(); parts.push('<ul style="list-style:none;padding-left:2px;margin:4px 0">'); listOpen = 'check'; }
        parts.push(`<li${blockStil(b, 'margin:2px 0;')}>${b.props?.checked ? '☑' : '☐'} ${text}${kinder(b) ? `<div style="margin-left:22px">${kinder(b)}</div>` : ''}</li>`);
        break;
      case 'bulletListItem':
        if (listOpen !== 'ul') { closeList(); parts.push('<ul style="margin:4px 0">'); listOpen = 'ul'; }
        parts.push(`<li${blockStil(b)}>${text}${kinder(b)}</li>`);
        break;
      case 'numberedListItem':
        if (listOpen !== 'ol') {
          closeList();
          const start = Number(b.props?.start);
          parts.push(`<ol style="margin:4px 0"${start > 1 ? ` start="${Math.floor(start)}"` : ''}>`);
          listOpen = 'ol';
        }
        parts.push(`<li${blockStil(b)}>${text}${kinder(b)}</li>`);
        break;
      case 'quote':
        closeList();
        parts.push(`<blockquote${blockStil(b, 'margin:6px 0;padding:2px 12px;border-left:3px solid #c9c6bd;color:#555;')}>${text}</blockquote>${eingerueckt(b)}`);
        break;
      case 'codeBlock':
        closeList();
        parts.push(`<pre style="background:#f4f3ef;border-radius:6px;padding:8px 10px;font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap">${esc(inlineText(b.content))}</pre>`);
        break;
      case 'table': {
        closeList();
        const content = b.content as { rows?: { cells: unknown[] }[] } | undefined;
        if (content?.rows) {
          const rows = content.rows
            .map((r) => `<tr>${r.cells.map((cell) => `<td style="border:1px solid #ccc;padding:4px 8px;vertical-align:top">${inlineHtml(cell)}</td>`).join('')}</tr>`)
            .join('');
          parts.push(`<table style="border-collapse:collapse;margin:6px 0">${rows}</table>`);
        }
        break;
      }
      case 'image': {
        // M289: Das Bild wandert MIT — Ausdruck, PDF und Outlook-Einfügen
        // zeigen es, weil die Daten in der Adresse selbst stecken.
        closeList();
        const p = b.props as { url?: string; caption?: string; name?: string } | undefined;
        if (p?.url) {
          const alt = esc(p.caption || p.name || 'Bild');
          parts.push(`<figure style="margin:6px 0"><img src="${esc(p.url)}" alt="${alt}" style="max-width:100%;height:auto" />${
            p.caption ? `<figcaption style="font-size:12px;color:#666">${esc(p.caption)}</figcaption>` : ''
          }</figure>`);
        }
        break;
      }
      case 'rechentabelle': {
        // M283: mit Werten statt Formeln — in einer E-Mail nützt „=SUMME(B2:B9)"
        // niemandem, die 12.480 dagegen schon
        closeList();
        const zeilen = rechenBlockZeilen(b.props);
        if (zeilen.length) {
          const rows = zeilen
            .map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px">${esc(c)}</td>`).join('')}</tr>`)
            .join('');
          parts.push(`<table style="border-collapse:collapse;margin:6px 0">${rows}</table>`);
        }
        break;
      }
      default:
        closeList();
        // ein leerer Absatz ist eine gewollte Leerzeile
        parts.push(`<p${blockStil(b, 'margin:4px 0;')}>${text || '&nbsp;'}</p>${eingerueckt(b)}`);
    }
  }
  closeList();
  return parts.join('\n');
}

/* ---------- M340: Blöcke → Markdown (Ordner-Export, „Als Markdown") ---------- */
function inlineMd(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return inlineText(content);
  return content.map((c) => {
    if (typeof c === 'string') return c;
    if (!c || typeof c !== 'object') return '';
    const o = c as { type?: string; text?: unknown; styles?: Record<string, unknown>; href?: unknown; content?: unknown };
    if (o.type === 'link') { const t = inlineMd(o.content) || String(o.href ?? ''); return typeof o.href === 'string' ? `[${t}](${o.href})` : t; }
    if (typeof o.text !== 'string') return o.content ? inlineMd(o.content) : '';
    const st = o.styles ?? {};
    // Leerraum bleibt AUSSEN — „** fett**" liest kein Markdown-Programm als fett
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(o.text) ?? ['', '', o.text, ''];
    let t = m[2];
    if (!t) return o.text;
    if (st.code) t = `\`${t}\``;
    if (st.bold) t = `**${t}**`;
    if (st.italic) t = `*${t}*`;
    if (st.strike) t = `~~${t}~~`;
    return `${m[1]}${t}${m[3]}`;
  }).join('');
}

export function blocksToMarkdown(blocks: unknown[] | undefined): string {
  if (!blocks) return '';
  const alle = [...(blocks as AnyBlock[])];
  while (alle.length && istLeererAbsatz(alle[alle.length - 1])) alle.pop();
  const lines: string[] = [];
  const istListe = (t?: string) => t === 'bulletListItem' || t === 'numberedListItem' || t === 'checkListItem';
  const walk = (bs: AnyBlock[], depth: number) => {
    let nummer = 0;
    let vorher: string | undefined;
    for (const b of bs) {
      const ein = '  '.repeat(depth);
      const text = inlineMd(b.content);
      if (b.type === 'numberedListItem') nummer = nummer === 0 ? (Number(b.props?.start) || 1) : nummer + 1; else nummer = 0;
      // Leerzeile zwischen Blöcken — außer innerhalb einer Liste
      // (ein Wechsel zwischen Punkten und Nummern beginnt eine neue Liste)
      const gleicheListe = istListe(b.type) && istListe(vorher) && (b.type === 'numberedListItem') === (vorher === 'numberedListItem');
      if (lines.length && depth === 0 && !gleicheListe) lines.push('');
      switch (b.type) {
        case 'heading': lines.push(`${ein}${'#'.repeat(Math.min(6, Math.max(1, Number(b.props?.level ?? 3))))} ${text}`); break;
        case 'checkListItem': lines.push(`${ein}- [${b.props?.checked ? 'x' : ' '}] ${text}`); break;
        case 'bulletListItem': lines.push(`${ein}- ${text}`); break;
        case 'numberedListItem': lines.push(`${ein}${nummer}. ${text}`); break;
        case 'quote': lines.push(`${ein}> ${text}`); break;
        case 'codeBlock': lines.push(`${ein}\`\`\``, ...inlineText(b.content).split('\n').map((z) => `${ein}${z}`), `${ein}\`\`\``); break;
        case 'table': {
          const rows = (b.content as { rows?: { cells: unknown[] }[] } | undefined)?.rows ?? [];
          const zelle = (c: unknown) => inlineMd((c as { content?: unknown })?.content ?? c).replace(/\|/g, '\\|').replace(/\n/g, ' ');
          rows.forEach((r, i) => {
            lines.push(`${ein}| ${r.cells.map(zelle).join(' | ')} |`);
            if (i === 0) lines.push(`${ein}| ${r.cells.map(() => '---').join(' | ')} |`);
          });
          break;
        }
        case 'rechentabelle': {
          const z = rechenBlockZeilen(b.props);
          z.forEach((r, i) => {
            lines.push(`${ein}| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
            if (i === 0) lines.push(`${ein}| ${r.map(() => '---').join(' | ')} |`);
          });
          break;
        }
        case 'image': {
          const p = b.props as { caption?: string; name?: string; url?: string } | undefined;
          // die Bilddaten selbst (data:…) gehören nicht in eine Textdatei
          const ziel = p?.url && !p.url.startsWith('data:') ? p.url : (p?.name || 'bild');
          lines.push(`${ein}![${p?.caption || p?.name || 'Bild'}](${ziel})`);
          break;
        }
        default: lines.push(text ? `${ein}${text}` : '');
      }
      vorher = b.type;
      if (b.children?.length) walk(b.children, depth + 1);
    }
  };
  walk(alle, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ---------- Karten → Text/HTML ---------- */

export function nodeToText(node: AppNode): string {
  const base = baseNodeText(node);
  // Attribute (Trilium-Stil: schlüssel=wert) anhängen — damit sind sie
  // durchsuchbar und landen in Export/Clipboard
  const attrs = node.data?.attrs as Record<string, string> | undefined;
  if (attrs && Object.keys(attrs).length > 0) {
    const lines = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join('\n');
    return base ? `${base}\n${lines}` : lines;
  }
  return base;
}

function baseNodeText(node: AppNode): string {
  switch (node.type) {
    case 'note':
      return blocksToText(node.data.blocks);
    case 'email': {
      const e = node.data;
      const atts = e.attachments.length
        ? `\nAnhänge: ${e.attachments.map((a) => a.name).join(', ')}`
        : '';
      return `E-Mail: ${e.subject}\nVon: ${e.fromName}${e.fromAddress ? ` <${e.fromAddress}>` : ''}\n\n${e.text}${atts}`;
    }
    case 'kanban': {
      const k = node.data;
      const cols = kanbanCols(k);
      const done = doneCol(k);
      // Ticket-Details (Person/Frist/Beschreibung) mit ausgeben — sonst sind
      // sie weder durchsuchbar noch im E-Mail-/Clipboard-Export (Audit R6-F2)
      const line = (it: (typeof k.items)[number], i: number) =>
        `  ${i === done ? '☑' : '☐'} ${it.text}${it.due ? ` (bis ${it.due})` : ''}${it.who ? ` @${it.who}` : ''}${it.note ? ` — ${it.note}` : ''}`;
      // M293: Archivierte Tickets hängen als eigener Abschnitt an — so bleiben
      // sie durchsuchbar (Strg+K) und fehlen in keinem Export
      const arch = k.archiv ?? [];
      const archText = arch.length
        ? `\n\nArchiv (${arch.length}):\n${arch.map((it) => `  🗃 ${it.text}${it.who ? ` @${it.who}` : ''}`).join('\n')}`
        : '';
      return `${k.title || 'Kanban'}\n${cols.map(
        (col, i) => `\n${col}:\n${k.items.filter((it) => Math.min(it.col, done) === i).map((it) => line(it, i)).join('\n') || '  —'}`,
      ).join('')}${archText}`;
    }
    case 'file': {
      // M263: Der eigene Titel steht vorn — danach wird gesucht und gefiltert.
      // Der Dateiname bleibt trotzdem im Text, sonst findet ihn niemand mehr.
      const f = node.data;
      const t = f.titel?.trim();
      return t && t !== f.name
        ? `Datei: ${t} (${f.name}, ${formatBytes(f.size)})`
        : `Datei: ${f.name} (${formatBytes(f.size)})`;
    }
    case 'image': {
      const i = node.data;
      const t = i.titel?.trim();
      return t && t !== i.name
        ? `Bild: ${t}${i.name ? ` (${i.name})` : ''}`
        : `Bild: ${i.name ?? 'Screenshot'}`;
    }
    case 'shape':
      return node.data.text || '';
    case 'mermaid':
      return `Diagramm:\n${node.data.code}`;
    case 'gantt': {
      const g = node.data;
      return `${g.title || 'Zeitplan'}\n${g.rows
        .map((r) => `  ${r.start === r.end ? '◆' : '▬'} ${r.name}: ${r.start} → ${r.end}${r.progress ? ` (${r.progress}%)` : ''}${(r as { who?: string }).who ? ` @${(r as { who?: string }).who}` : ''}`)
        .join('\n')}`;
    }
    case 'calendar':
      return `Kalender (Monatsansicht${node.data.month ? ` ${node.data.month}` : ''})`;
    case 'portal':
      return 'Projekt-Portal';
    case 'frame':
      // M287: „Rahmen“, nicht „Bereich“ — siehe makeFrame
      return `Rahmen: ${node.data.name}`;
    case 'htmlapp':
      return `Eigene App: ${node.data.name} (${formatBytes(node.data.size)})`;
    case 'time': {
      const t = node.data;
      const labels: Record<string, string> = { arbeit: 'Arbeit', pause: 'Pause' };
      const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const rows = [...t.segs]
        .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
        .map((s) => `${s.date} ${hm(s.start)}-${s.end !== undefined ? hm(s.end) : 'läuft'} ${labels[s.kind] ?? s.kind}${s.note ? ` (${s.note})` : ''}`);
      return `${t.title || 'Zeiterfassung'}\n${rows.join('\n')}`;
    }
    case 'minutes': {
      // M186: bewusst ALLE Sitzungen — nur so findet die Suche (Strg+K) auch
      // ein Protokoll von vor zwei Jahren, obwohl die Karte nur eines zeigt.
      const mn = node.data as { title?: string; entries?: Array<{ date: string; title?: string; attendees?: string; blocks?: unknown[]; decisions?: Array<{ text: string }> }> };
      const parts = [...(mn.entries ?? [])]
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .map((e) => {
          const head = `— ${e.title?.trim() || e.date}${e.attendees ? ` (${e.attendees})` : ''}`;
          const body = blocksToText(e.blocks);
          const dec = (e.decisions ?? []).map((d) => `\u00a7 ${d.text}`).join('\n');
          return [head, body, dec].filter(Boolean).join('\n');
        });
      return `${mn.title ?? 'Besprechungsreihe'}\n${parts.join('\n\n')}`;
    }
    case 'sheet': {
      // M256: Ausgegeben werden die ERRECHNETEN Werte — eine Suche nach „1.240"
      // soll die Summenzeile finden, nicht nur wer „=SUMME(" tippt.
      const s = node.data;
      const zeilen = sheetZeilen(s);
      return `${s.title || 'Rechen-Tabelle'}\n${zeilen.map((r) => r.join('\t')).join('\n')}`;
    }
    case 'week': {
      const w = node.data;
      const cols = w.cols?.length ? w.cols : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].slice(0, w.days === 7 ? 7 : 5);
      const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const slotName = (m: number) => w.slots?.[m / 60] ?? `Zeile ${m / 60 + 1}`;
      const when = (e: { start: number; dur: number }) => w.axis === 'slots'
        ? (e.dur <= 60 ? slotName(e.start) : `${slotName(e.start)}–${slotName(e.start + e.dur - 60)}`)
        : `${fmt(e.start)}-${fmt(e.start + e.dur)}`;
      const rows = [...w.entries]
        .sort((a, b) => a.day - b.day || a.start - b.start)
        .map((e) => `${cols[e.day] ?? '?'} ${when(e)} ${e.text}${e.who ? ` (${e.who})` : ''}`);
      return `${w.title || 'Planer'}\n${rows.join('\n')}`;
    }
    default:
      return '';
  }
}

export function nodeToHtml(node: AppNode): string {
  switch (node.type) {
    case 'note':
      return blocksToHtml(node.data.blocks);
    case 'email': {
      const e = node.data;
      const atts = e.attachments.length
        ? `<p><b>Anhänge:</b> ${e.attachments.map((a) => esc(a.name)).join(', ')}</p>`
        : '';
      return `<h3>📧 ${esc(e.subject)}</h3><p><b>Von:</b> ${esc(e.fromName)}${e.fromAddress ? ` &lt;${esc(e.fromAddress)}&gt;` : ''}</p><p style="white-space:pre-wrap">${esc(e.text)}</p>${atts}`;
    }
    case 'kanban': {
      const k = node.data;
      const done = doneCol(k);
      const cols = kanbanCols(k).map((col, i) => {
        const items = k.items.filter((it) => Math.min(it.col, done) === i);
        // M340: Frist, Person und Beschreibung gehören dazu — im Text standen sie schon, im HTML fehlten sie
        const zeile = (it: (typeof k.items)[number]) => `<li>${i === done ? '☑' : '☐'} ${esc(it.text)}${it.due ? ` <span style="color:#777">(bis ${esc(it.due)})</span>` : ''}${it.who ? ` <span style="color:#777">@${esc(it.who)}</span>` : ''}${it.note ? `<br><span style="color:#555;font-size:.93em">${esc(it.note)}</span>` : ''}</li>`;
        return `<h4>${esc(col)}</h4><ul style="list-style:none;padding-left:2px">${items.map(zeile).join('') || '<li>—</li>'}</ul>`;
      }).join('');
      const arch = k.archiv ?? []; // M293
      const archHtml = arch.length
        ? `<h4>Archiv (${arch.length})</h4><ul>${arch.map((it) => `<li>🗃 ${esc(it.text)}</li>`).join('')}</ul>`
        : '';
      return `<h3>${esc(k.title)}</h3>${cols}${archHtml}`;
    }
    case 'image': {
      const img = node.data;
      return `<img src="${esc(img.src)}" alt="${esc(img.name ?? 'Bild')}" style="max-width:600px" />`;
    }
    case 'shape':
      return node.data.text ? `<p style="text-align:center;font-weight:600">${esc(node.data.text)}</p>` : '';
    case 'gantt': {
      const g = node.data;
      const items = g.rows
        .map((r) => `<li>${r.start === r.end ? '◆' : '▬'} ${esc(r.name)}: ${esc(r.start)} → ${esc(r.end)}${r.progress ? ` (${r.progress}%)` : ''}</li>`)
        .join('');
      return `<h3>${esc(g.title)}</h3><ul>${items || '<li>—</li>'}</ul>`;
    }
    case 'mermaid': {
      // M340: das Diagramm als BILD, wenn es gerade auf dem Board steht — der Quelltext allein hilft im Ausdruck niemandem
      const bild = diagrammBild(node.id);
      return bild
        ? `<img src="${bild.src}" alt="Diagramm" style="max-width:100%;height:auto" width="${bild.w}" />`
        : `<pre style="background:#faf8f3;border-radius:8px;padding:10px;font-size:13px;overflow:auto;white-space:pre-wrap">${esc(node.data.code)}</pre>`;
    }
    case 'file': {
      const f = node.data;
      const t = f.titel?.trim();
      return `<p>📎 <b>${esc(t && t !== f.name ? t : f.name)}</b>${t && t !== f.name ? ` — ${esc(f.name)}` : ''} <span style="color:#777">(${formatBytes(f.size)})</span></p>`;
    }
    case 'frame':
      // Abschnitts-Folie im Presenter: der Rahmen-Name als Zwischentitel
      return `<h2 style="text-align:center;margin-top:1.4em">${esc(node.data.name)}</h2>`;
    case 'htmlapp':
      return `<p>Eigene App: <b>${esc(node.data.name)}</b> (${formatBytes(node.data.size)}) — läuft nur live auf dem Board.</p>`;
    case 'time': {
      const t = node.data;
      const labels: Record<string, string> = { arbeit: 'Arbeit', pause: 'Pause' };
      const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const byDate = new Map<string, typeof t.segs>();
      for (const s of [...t.segs].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)) {
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date)!.push(s);
      }
      const parts = [...byDate.entries()].map(([date, list]) => {
        const items = list.map((s) =>
          `<li>${hm(s.start)}–${s.end !== undefined ? hm(s.end) : 'läuft'} ${labels[s.kind] ?? s.kind}${s.note ? ` <i>(${esc(s.note)})</i>` : ''}</li>`).join('');
        const work = list.reduce((a, s) => a + (s.kind === 'pause' || s.end === undefined ? 0 : s.end - s.start), 0);
        return `<h4>${date}</h4><ul>${items}</ul><p><b>Summe (ohne Pausen): ${hm(work)} h</b></p>`;
      });
      return `<h3>${esc(t.title)}</h3>${parts.join('') || '<p>—</p>'}`;
    }
    case 'minutes': {
      const mn = node.data as { title?: string; entries?: Array<{ date: string; title?: string; attendees?: string; blocks?: unknown[]; decisions?: Array<{ text: string }> }> };
      const parts = [...(mn.entries ?? [])]
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .map((e) => {
          const dec = (e.decisions ?? []).map((d) => `<li>${esc(d.text)}</li>`).join('');
          return `<h4>${esc(e.title?.trim() || e.date)}</h4>`
            + (e.attendees ? `<p><i>Teilnehmende: ${esc(e.attendees)}</i></p>` : '')
            + blocksToHtml(e.blocks)
            + (dec ? `<p><b>Beschl\u00fcsse</b></p><ul>${dec}</ul>` : '');
        });
      return `<h3>${esc(mn.title ?? 'Besprechungsreihe')}</h3>${parts.join('<hr>') || '<p>\u2014</p>'}`;
    }
    case 'sheet': {
      const s = node.data;
      const zeilen = sheetZeilen(s);
      const tr = zeilen.map((r, i) => `<tr>${r.map((c) => (i === 0
        ? `<th style="border:1px solid #ccc;padding:4px 7px;background:#f2f2f2;text-align:left">${esc(c)}</th>`
        : `<td style="border:1px solid #ccc;padding:4px 7px">${esc(c)}</td>`)).join('')}</tr>`).join('');
      return `<h3>${esc(s.title ?? 'Rechen-Tabelle')}</h3>`
        + (tr ? `<table style="border-collapse:collapse;font-size:13px">${tr}</table>` : '<p>—</p>');
    }
    case 'week': {
      const w = node.data;
      const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
      const cols = w.cols?.length ? w.cols : dayNames.slice(0, w.days === 7 ? 7 : 5);
      const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      const slotName = (m: number) => w.slots?.[m / 60] ?? `Zeile ${m / 60 + 1}`;
      const when = (e: { start: number; dur: number }) => w.axis === 'slots'
        ? (e.dur <= 60 ? slotName(e.start) : `${slotName(e.start)}–${slotName(e.start + e.dur - 60)}`)
        : `${fmt(e.start)}–${fmt(e.start + e.dur)}`;
      const perDay = cols.map((name, day) => {
        const items = [...w.entries].filter((e) => e.day === day).sort((a, b) => a.start - b.start)
          .map((e) => `<li>${esc(when(e))} ${esc(e.text)}${e.who ? ` <i>(${esc(e.who)})</i>` : ''}</li>`).join('');
        return items ? `<h4>${esc(name)}</h4><ul>${items}</ul>` : '';
      }).join('');
      return `<h3>${esc(w.title)}</h3>${perDay || '<p>—</p>'}`;
    }
    default:
      return `<p style="white-space:pre-wrap">${esc(nodeToText(node))}</p>`;
  }
}

/** Das gerenderte Diagramm einer Karte als SVG-Bildadresse (nur im Browser, nur wenn es auf dem Board steht) */
function diagrammBild(nodeId: string): { src: string; w: number } | null {
  if (typeof document === 'undefined') return null;
  for (const n of Array.from(document.querySelectorAll('.react-flow__node-mermaid')) as HTMLElement[]) {
    if (n.dataset.id !== nodeId) continue;
    const svg = n.querySelector('svg[id^="pn-mermaid"], svg[id^="mermaid"]') as SVGSVGElement | null;
    if (!svg) return null;
    const klon = svg.cloneNode(true) as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    const w = Math.round(vb && vb.width ? vb.width : r.width) || 600;
    const h = Math.round(vb && vb.height ? vb.height : r.height) || 400;
    klon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    klon.setAttribute('width', String(w)); klon.setAttribute('height', String(h));
    klon.removeAttribute('style');
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(klon))}`, w: Math.min(w, 700) };
  }
  return null;
}

/** M340: Eine Karte als Markdown — Notizen mit Formatierung, Listen und Tabellen; Module in lesbarer Form */
export function nodeToMarkdown(node: AppNode): string {
  const attrs = node.data?.attrs as Record<string, string> | undefined;
  const anhang = attrs && Object.keys(attrs).length ? `\n\n${Object.entries(attrs).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '';
  const tabelle = (z: string[][]) => z.map((r, i) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |${i === 0 ? `\n| ${r.map(() => '---').join(' | ')} |` : ''}`).join('\n');
  switch (node.type) {
    case 'note':
      return blocksToMarkdown(node.data.blocks) + anhang;
    case 'kanban': {
      const k = node.data;
      const done = doneCol(k);
      const cols = kanbanCols(k).map((col, i) => {
        const items = k.items.filter((it) => Math.min(it.col, done) === i);
        return `**${col}**\n\n${items.map((it) => `- [${i === done ? 'x' : ' '}] ${it.text}${it.due ? ` (bis ${it.due})` : ''}${it.who ? ` @${it.who}` : ''}${it.note ? ` — ${it.note}` : ''}`).join('\n') || '- —'}`;
      });
      return `### ${k.title || 'Kanban'}\n\n${cols.join('\n\n')}${anhang}`;
    }
    case 'sheet': {
      const z = sheetZeilen(node.data);
      return `### ${node.data.title || 'Rechen-Tabelle'}\n\n${z.length ? tabelle(z) : '—'}${anhang}`;
    }
    case 'minutes': {
      const mn = node.data as { title?: string; entries?: Array<{ date: string; title?: string; attendees?: string; blocks?: unknown[]; decisions?: Array<{ text: string }> }> };
      const parts = [...(mn.entries ?? [])].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((e) =>
        [`#### ${e.title?.trim() || e.date}`, e.attendees ? `*Teilnehmende: ${e.attendees}*` : '', blocksToMarkdown(e.blocks),
          (e.decisions ?? []).length ? `**Beschlüsse**\n\n${(e.decisions ?? []).map((d) => `- ${d.text}`).join('\n')}` : ''].filter(Boolean).join('\n\n'));
      return `### ${mn.title ?? 'Besprechungsreihe'}\n\n${parts.join('\n\n')}${anhang}`;
    }
    case 'mermaid':
      return `\`\`\`mermaid\n${node.data.code}\n\`\`\`${anhang}`;
    case 'frame':
      return `## ${node.data.name}`;
    case 'email':
      return `### 📧 ${node.data.subject}\n\n*Von: ${node.data.fromName}${node.data.fromAddress ? ` <${node.data.fromAddress}>` : ''}*\n\n${node.data.text}${anhang}`;
    default:
      return nodeToText(node);
  }
}

/* ---------- M341: Karten → WhatsApp-Nachricht ----------
   WhatsApp kennt eine eigene, kleine Auszeichnung: *fett*, _kursiv_, ~durchgestrichen~, `Code`,
   Listen mit „- " und „1. ", Zitate mit „> ". Vorher ging roher Klartext hinaus — Überschriften
   waren nicht zu erkennen, Hervorhebungen weg. */
function inlineWa(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return inlineText(content);
  return content.map((c) => {
    if (typeof c === 'string') return c;
    if (!c || typeof c !== 'object') return '';
    const o = c as { type?: string; text?: unknown; styles?: Record<string, unknown>; href?: unknown; content?: unknown };
    if (o.type === 'link') {
      // WhatsApp macht aus der nackten Adresse selbst einen Link — „[Text](…)" versteht es nicht
      const t = inlineText(o.content);
      const h = typeof o.href === 'string' ? o.href : '';
      return !h ? t : (!t || t === h || `https://${t}` === h ? h : `${t}: ${h}`);
    }
    if (typeof o.text !== 'string') return o.content ? inlineWa(o.content) : '';
    const st = o.styles ?? {};
    // die Zeichen müssen direkt am Wort stehen, Leerraum bleibt außen
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(o.text);
    let t = m ? m[2] : o.text;
    if (!t) return o.text;
    if (st.code) t = `\`${t}\``;
    else {
      if (st.bold) t = `*${t}*`;
      if (st.italic) t = `_${t}_`;
      if (st.strike) t = `~${t}~`;
    }
    return `${m ? m[1] : ''}${t}${m ? m[3] : ''}`;
  }).join('');
}
/** Eine ganze Zeile fett — ohne doppelte Sternchen, wenn Teile schon fett waren */
const waFett = (zeile: string): string => {
  const t = zeile.replace(/\*/g, '').trim();
  return t ? `*${t}*` : '';
};

export function blocksToWhatsapp(blocks: unknown[] | undefined): string {
  if (!blocks) return '';
  const alle = [...(blocks as AnyBlock[])];
  while (alle.length && istLeererAbsatz(alle[alle.length - 1])) alle.pop();
  const lines: string[] = [];
  const istListe = (t?: string) => t === 'bulletListItem' || t === 'numberedListItem' || t === 'checkListItem';
  // wie auf der Karte: der erste Absatz einer mehrzeiligen Notiz ist ihr Titel
  const titelZeile = alle.length > 1 && (alle[0].type === 'paragraph' || !alle[0].type) ? alle[0] : null;
  const walk = (bs: AnyBlock[], depth: number) => {
    let nummer = 0;
    let vorher: string | undefined;
    for (const b of bs) {
      // WhatsApp kennt keine verschachtelten Listen: Unterpunkte bekommen ein eigenes Zeichen und stehen eingerückt
      const ein = '   '.repeat(depth);
      const text = inlineWa(b.content);
      if (b.type === 'numberedListItem') nummer = nummer === 0 ? (Number(b.props?.start) || 1) : nummer + 1; else nummer = 0;
      // (ein Wechsel zwischen Punkten und Nummern beginnt eine neue Liste)
      const gleicheListe = istListe(b.type) && istListe(vorher) && (b.type === 'numberedListItem') === (vorher === 'numberedListItem');
      const hatInhalt = !!text || b.type === 'table' || b.type === 'image' || b.type === 'rechentabelle';
      if (lines.length && depth === 0 && !gleicheListe && hatInhalt) lines.push('');
      switch (b.type) {
        case 'heading': lines.push(`${ein}${waFett(text)}`); break;
        case 'checkListItem': lines.push(`${ein}${b.props?.checked ? '✅' : '⬜'} ${b.props?.checked && text ? `~${text.replace(/~/g, '')}~` : text}`); break;
        case 'bulletListItem': lines.push(depth === 0 ? `- ${text}` : `${ein}◦ ${text}`); break;
        case 'numberedListItem': lines.push(`${ein}${nummer}. ${text}`); break;
        case 'quote': lines.push(`${ein}> ${text}`); break;
        case 'codeBlock': lines.push(`\`\`\`${inlineText(b.content)}\`\`\``); break;
        case 'table': {
          const rows = (b.content as { rows?: { cells: unknown[] }[] } | undefined)?.rows ?? [];
          for (const r of rows) lines.push(`${ein}${r.cells.map((c) => inlineWa((c as { content?: unknown })?.content ?? c).replace(/\n/g, ' ')).join(' | ')}`);
          break;
        }
        case 'rechentabelle': for (const r of rechenBlockZeilen(b.props)) lines.push(`${ein}${r.join(' | ')}`); break;
        case 'image': { const p = b.props as { caption?: string; name?: string } | undefined; lines.push(`${ein}🖼 ${p?.caption || p?.name || 'Bild'}`); break; }
        default: if (text) lines.push(b === titelZeile ? waFett(text) : `${ein}${text}`);
      }
      vorher = b.type;
      if (b.children?.length) walk(b.children, depth + 1);
    }
  };
  walk(alle, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function nodeToWhatsapp(node: AppNode): string {
  if (node.type === 'note') {
    const attrs = node.data?.attrs as Record<string, string> | undefined;
    const anhang = attrs && Object.keys(attrs).length ? `\n\n${Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join('\n')}` : '';
    return blocksToWhatsapp(node.data.blocks) + anhang;
  }
  if (node.type === 'frame') return waFett(node.data.name);
  if (node.type === 'kanban') {
    // Spalten kursiv, leere Spalten bleiben weg — in einer Nachricht ist „Doing: —" nur Rauschen
    const k = node.data;
    const done = doneCol(k);
    const spalten = kanbanCols(k).map((col, i) => {
      const items = k.items.filter((it) => Math.min(it.col, done) === i);
      if (!items.length) return '';
      return `_${col}_\n${items.map((it) => `${i === done ? '✅' : '⬜'} ${it.text}${it.due ? ` (bis ${it.due})` : ''}${it.who ? ` @${it.who}` : ''}${it.note ? ` — ${it.note}` : ''}`).join('\n')}`;
    }).filter(Boolean);
    return `${waFett(k.title || 'Kanban')}\n\n${spalten.join('\n\n') || '—'}`;
  }
  // Module: wie im Klartext, die Titelzeile fett, Haken als gut lesbare Zeichen
  const text = nodeToText(node).replace(/☑/g, '✅').replace(/☐/g, '⬜');
  const nl = text.indexOf('\n');
  const kopf = nl < 0 ? text : text.slice(0, nl);
  const titel = ['kanban', 'gantt', 'time', 'minutes', 'sheet', 'week', 'email'].includes(node.type ?? '');
  return titel && kopf.trim() ? `${waFett(kopf)}${nl < 0 ? '' : text.slice(nl)}` : text;
}

export function nodesToWhatsapp(nodes: AppNode[]): string {
  return nodes.map(nodeToWhatsapp).filter(Boolean).join('\n\n———\n\n');
}

/**
 * Text auf höchstens `max` Zeichen kürzen — an einem Zeilenende, wenn eines in der Nähe liegt, und nie
 * mitten in einem Emoji: Ein halbes Zeichenpaar lässt `encodeURIComponent` mit einem Fehler abbrechen,
 * der Knopf tat dann einfach nichts.
 */
export function sicherKuerzen(text: string, max: number): string {
  if (text.length <= max) return text;
  let ende = max;
  const c = text.charCodeAt(ende - 1);
  if (c >= 0xd800 && c <= 0xdbff) ende -= 1;
  const zeile = text.lastIndexOf('\n', ende);
  if (zeile > ende * 0.8) ende = zeile;
  return text.slice(0, ende).trimEnd();
}

export function nodesToText(nodes: AppNode[]): string {
  return nodes.map(nodeToText).filter(Boolean).join('\n\n———\n\n');
}

export function nodesToHtml(nodes: AppNode[]): string {
  const body = nodes.map(nodeToHtml).filter(Boolean).join('\n<hr style="border:none;border-top:1px solid #ddd;margin:14px 0" />\n');
  return `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:14px;color:#222">${body}</div>`;
}
