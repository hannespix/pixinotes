// Karten → Text: für die Suche, den KI-Kontext, Verknüpfungen und die Zwischenablage.
// M535: HTML, Markdown und WhatsApp liegen in serializeFormate.ts — sie braucht nur, wer teilt, druckt oder
// exportiert (alles nachgeladen); im Start-Paket bleibt nur der Text.
import { doneCol, kanbanCols, type AppNode, type KontaktData, type SheetData } from '../types';
import { bubblesAlsText } from './bubbles';
import { fluessigText } from './fluessigDaten';
import { formatBytes } from './parseEmail';
import { indexZuAdresse, plus, rechneBlatt, zeigeWert } from './formel';

/**
 * M256: Rechen-Tabelle als Zeilen — für Suche, Text- und HTML-Export.
 *
 * Ausgegeben wird der errechnete Wert, nicht die Formel: In einer E-Mail oder
 * im PDF nützt „=SUMME(B2:B9)" niemandem, die 12.480 dagegen schon.
 */
export function sheetZeilen(s: SheetData): string[][] {
  const zellen = s.cells ?? {};
  const spalten = Math.max(1, s.cols ?? 5);
  const zeilen = Math.max(1, s.rows ?? 8);
  // M528: Datumsrechnung, ganze Spalten — liegen nicht im Start-Paket; ab dem nächsten Aufruf rechnen sie mit
  if (!plus.rechne) void import('./formelPlus').catch(() => null);
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

export interface AnyBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
  rows?: unknown;
}

export function inlineText(content: unknown): string {
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
  // M388: Tabellenzelle in der Form des Editors ({ type: 'tableCell', content: […] }). Sie wurde nicht erkannt —
  // der Text aus Notiz-Tabellen fehlte darum in Suche, KI-Kontext, Verknüpfungen und im Text-Export.
  if (typeof content === 'object' && content !== null && (content as { content?: unknown }).content !== undefined) {
    return inlineText((content as { content: unknown }).content);
  }
  return '';
}

/** Vollständiges HTML-Escaping inkl. Quotes — auch für Attribut-Kontexte sicher (Audit SEC-1) */
export function esc(s: string): string {
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
          lines.push(`${indent}[Bild: ${p?.caption || p?.name || 'ohne Namen'}]`);
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


/* ---------- Karten → Text/HTML ---------- */

/** M450: Kontakt-Karte als Zeilen — Name zuerst (Titel in Suche und Fokus), dann Funktion/Firma, Rufnummern, E-Mail … */
export function kontaktZeilen(d0: Partial<KontaktData> | undefined): string[] {
  const d = d0 ?? {};
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const tel = (Array.isArray(d.telefone) ? d.telefone : []).filter((t) => t && s(t.nummer)).map((t) => `Tel.${s(t.art) ? ` (${s(t.art)})` : ''}: ${s(t.nummer)}`);
  const mail = (Array.isArray(d.emails) ? d.emails : []).map(s).filter(Boolean).map((m) => `E-Mail: ${m}`);
  return [
    s(d.name) || s(d.firma) || 'Kontakt',
    [s(d.funktion), s(d.firma)].filter(Boolean).join(' · '),
    ...tel, ...mail,
    s(d.adresse) ? `Anschrift: ${s(d.adresse).replace(/\s*\n\s*/g, ', ')}` : '',
    s(d.web) ? `Web: ${s(d.web)}` : '',
    s(d.notiz),
  ].filter(Boolean);
}

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
      const atts = e.attachments?.length
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
        `  ${i === done ? '☑' : '☐'} ${it.text}${it.due ? ` (bis ${it.due})` : ''}${it.who ? ` @${it.who}` : ''}${it.note ? ` – ${it.note}` : ''}`;
      // M293: Archivierte Tickets hängen als eigener Abschnitt an — so bleiben
      // sie durchsuchbar (Strg+K) und fehlen in keinem Export
      const arch = k.archiv ?? [];
      const archText = arch.length
        ? `\n\nArchiv (${arch.length}):\n${arch.map((it) => `  ${it.text}${it.who ? ` @${it.who}` : ''}`).join('\n')}`
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
    case 'bubbles':
      return bubblesAlsText(node.data);
    case 'pixi':
      // M501: nur Schmuck, kein Inhalt — der Name (falls vergeben) macht sie in der Suche auffindbar
      return `Maskottchen Pixi${typeof node.data.name === 'string' && node.data.name.trim() ? ` „${node.data.name.trim()}“` : ''}`;
    case 'kontakt':
      // M450: alle Felder — so findet die Suche (Strg+K) einen Kontakt auch über Firma, Ort oder Rufnummer
      return kontaktZeilen(node.data).join('\n');
    case 'fluessig':
      // M500: nur der Text — die Flüssigkeit selbst ist Darstellung
      return fluessigText(node.data.text);
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

export function nodesToText(nodes: AppNode[]): string {
  return nodes.map(nodeToText).filter(Boolean).join('\n\n———\n\n');
}

