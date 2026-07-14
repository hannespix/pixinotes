// Karten → Text / HTML: für „Per E-Mail teilen", Zwischenablage (Outlook-Paste)
// und die Suche. Bewusst schlicht gehalten — sauberes Office-taugliches HTML.
import type { Node } from '@xyflow/react';
import type { EmailData, FileData, ImageData, KanbanData, NoteData } from '../types';
import { KANBAN_COLS } from '../types';
import { formatBytes } from './parseEmail';

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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      default:
        closeList();
        if (text) parts.push(`<p style="margin:4px 0">${text}</p>`);
    }
  }
  closeList();
  return parts.join('\n');
}

/* ---------- Karten → Text/HTML ---------- */

export function nodeToText(node: Node): string {
  switch (node.type) {
    case 'note':
      return blocksToText((node.data as NoteData).blocks);
    case 'email': {
      const e = node.data as unknown as EmailData;
      const atts = e.attachments.length
        ? `\nAnhänge: ${e.attachments.map((a) => a.name).join(', ')}`
        : '';
      return `E-Mail: ${e.subject}\nVon: ${e.fromName}${e.fromAddress ? ` <${e.fromAddress}>` : ''}\n\n${e.text}${atts}`;
    }
    case 'kanban': {
      const k = node.data as unknown as KanbanData;
      return `${k.title}\n${KANBAN_COLS.map(
        (col, i) => `\n${col}:\n${k.items.filter((it) => it.col === i).map((it) => `  ${i === 2 ? '☑' : '☐'} ${it.text}`).join('\n') || '  —'}`,
      ).join('')}`;
    }
    case 'file': {
      const f = node.data as unknown as FileData;
      return `Datei: ${f.name} (${formatBytes(f.size)})`;
    }
    case 'image':
      return `Bild: ${(node.data as unknown as ImageData).name ?? 'Screenshot'}`;
    case 'portal':
      return 'Projekt-Portal';
    default:
      return '';
  }
}

export function nodeToHtml(node: Node): string {
  switch (node.type) {
    case 'note':
      return blocksToHtml((node.data as NoteData).blocks);
    case 'email': {
      const e = node.data as unknown as EmailData;
      const atts = e.attachments.length
        ? `<p><b>Anhänge:</b> ${e.attachments.map((a) => esc(a.name)).join(', ')}</p>`
        : '';
      return `<h3>📧 ${esc(e.subject)}</h3><p><b>Von:</b> ${esc(e.fromName)}${e.fromAddress ? ` &lt;${esc(e.fromAddress)}&gt;` : ''}</p><p style="white-space:pre-wrap">${esc(e.text)}</p>${atts}`;
    }
    case 'kanban': {
      const k = node.data as unknown as KanbanData;
      const cols = KANBAN_COLS.map((col, i) => {
        const items = k.items.filter((it) => it.col === i);
        return `<h4>${esc(col)}</h4><ul>${items.map((it) => `<li>${i === 2 ? '☑' : '☐'} ${esc(it.text)}</li>`).join('') || '<li>—</li>'}</ul>`;
      }).join('');
      return `<h3>${esc(k.title)}</h3>${cols}`;
    }
    case 'image': {
      const img = node.data as unknown as ImageData;
      return `<img src="${img.src}" alt="${esc(img.name ?? 'Bild')}" style="max-width:600px" />`;
    }
    default:
      return `<p style="white-space:pre-wrap">${esc(nodeToText(node))}</p>`;
  }
}

export function nodesToText(nodes: Node[]): string {
  return nodes.map(nodeToText).filter(Boolean).join('\n\n———\n\n');
}

export function nodesToHtml(nodes: Node[]): string {
  const body = nodes.map(nodeToHtml).filter(Boolean).join('\n<hr style="border:none;border-top:1px solid #ddd;margin:14px 0" />\n');
  return `<div style="font-family:Segoe UI,system-ui,sans-serif;font-size:14px;color:#222">${body}</div>`;
}
