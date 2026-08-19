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
    for (const b of bs) {
      const text = inlineText(b.content);
      const indent = '  '.repeat(depth);
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
          lines.push(`${indent}- ${text}`);
          break;
        case 'table':
          lines.push(inlineText(b.content));
          break;
        case 'rechentabelle':
          // M283: als Zeilen mit „ | " — dieselbe Form wie die Rechen-Karte,
          // damit Suche und KI die Zahlen wirklich lesen können
          for (const r of rechenBlockZeilen(b.props)) lines.push(`${indent}${r.join(' | ')}`);
          break;
        default:
          if (text) lines.push(`${indent}${text}`);
      }
      if (b.children?.length) walk(b.children, depth + 1);
    }
  };
  walk(blocks as AnyBlock[], 0);
  return lines.join('\n');
}

export function blocksToHtml(blocks: unknown[] | undefined): string {
  if (!blocks) return '';
  const parts: string[] = [];
  let listOpen: string | null = null;
  const closeList = () => {
    if (listOpen) {
      parts.push(`</${listOpen}>`);
      listOpen = null;
    }
  };
  for (const b of blocks as AnyBlock[]) {
    const text = esc(inlineText(b.content));
    switch (b.type) {
      case 'heading': {
        closeList();
        const level = Math.min(4, Math.max(1, Number(b.props?.level ?? 3)));
        parts.push(`<h${level}>${text}</h${level}>`);
        break;
      }
      case 'checkListItem':
        closeList();
        parts.push(`<p style="margin:2px 0">${b.props?.checked ? '☑' : '☐'} ${text}</p>`);
        break;
      case 'bulletListItem':
        if (listOpen !== 'ul') { closeList(); parts.push('<ul>'); listOpen = 'ul'; }
        parts.push(`<li>${text}</li>`);
        break;
      case 'numberedListItem':
        if (listOpen !== 'ol') { closeList(); parts.push('<ol>'); listOpen = 'ol'; }
        parts.push(`<li>${text}</li>`);
        break;
      case 'table': {
        closeList();
        const content = b.content as { rows?: { cells: unknown[] }[] } | undefined;
        if (content?.rows) {
          const rows = content.rows
            .map((r) => `<tr>${r.cells.map((cell) => `<td style="border:1px solid #ccc;padding:4px 8px">${esc(inlineText(cell))}</td>`).join('')}</tr>`)
            .join('');
          parts.push(`<table style="border-collapse:collapse">${rows}</table>`);
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
          parts.push(`<table style="border-collapse:collapse">${rows}</table>`);
        }
        break;
      }
      default:
        closeList();
        if (text) parts.push(`<p style="margin:4px 0">${text}</p>`);
    }
  }
  closeList();
  return parts.join('\n');
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
      return `${k.title || 'Kanban'}\n${cols.map(
        (col, i) => `\n${col}:\n${k.items.filter((it) => Math.min(it.col, done) === i).map((it) => line(it, i)).join('\n') || '  —'}`,
      ).join('')}`;
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
        return `<h4>${esc(col)}</h4><ul>${items.map((it) => `<li>${i === done ? '☑' : '☐'} ${esc(it.text)}</li>`).join('') || '<li>—</li>'}</ul>`;
      }).join('');
      return `<h3>${esc(k.title)}</h3>${cols}`;
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
    case 'mermaid':
      return `<pre style="background:#faf8f3;border-radius:8px;padding:10px;font-size:13px;overflow:auto">${esc(node.data.code)}</pre>`;
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

export function nodesToText(nodes: AppNode[]): string {
  return nodes.map(nodeToText).filter(Boolean).join('\n\n———\n\n');
}

export function nodesToHtml(nodes: AppNode[]): string {
  const body = nodes.map(nodeToHtml).filter(Boolean).join('\n<hr style="border:none;border-top:1px solid #ddd;margin:14px 0" />\n');
  return `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:14px;color:#222">${body}</div>`;
}
