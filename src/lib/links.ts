// Obsidian-Gene für PixiNotes: [[Wikilinks]], #Tags und der Board-Graph.
// Wikilinks verweisen auf Board-Namen (normalisiert, Emojis egal) oder
// auf Karten-Titel; der Graph verbindet Boards über Portale UND Wikilinks.
import type { BoardDoc } from '../store';
import { nodeToText } from './serialize';

export const WIKILINK_RE = /\[\[([^[\]]{1,80})\]\]/g;
const TAG_RE = /(^|[\s(])#([\p{L}\d][\p{L}\d_-]{1,29})/gu;

/** Namen vergleichbar machen: Emojis/Satzzeichen raus, Kleinschreibung */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\d ]/gu, '').replace(/\s+/g, ' ').trim();
}

export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 12);
}

export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const tag = `#${m[2]}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Alle Tags über alle Boards, mit Häufigkeit (für die Tag-Übersicht in der Suche) */
export function collectAllTags(boards: BoardDoc[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const b of boards) {
    for (const n of b.nodes) {
      for (const tag of extractTags(nodeToText(n))) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type LinkTarget =
  | { kind: 'board'; boardId: string }
  | { kind: 'card'; boardId: string; nodeId: string }
  | null;

/** [[Name]] auflösen: exakter Board-Name → Board; sonst Karte, deren Titelzeile passt */
export function resolveLink(name: string, boards: BoardDoc[]): LinkTarget {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const board = boards.find((b) => normalizeName(b.name) === wanted);
  if (board) return { kind: 'board', boardId: board.id };
  for (const b of boards) {
    for (const n of b.nodes) {
      // exakter Titel-Vergleich — includes() würde Selbstbezüge matchen
      // (die Notiz enthält ihren eigenen [[Link]] im Text)
      const first = normalizeName(nodeToText(n).split('\n')[0] ?? '');
      if (first && first === wanted) {
        return { kind: 'card', boardId: b.id, nodeId: n.id };
      }
    }
  }
  return null;
}

export interface Backlink {
  boardId: string;
  boardName: string;
  nodeId: string;
  label: string;
  kind: 'portal' | 'wikilink';
}

/** „Was verlinkt hierher?" — Portale und [[Wikilinks]], die auf dieses Board zeigen */
export function collectBacklinks(boards: BoardDoc[], targetBoardId: string): Backlink[] {
  const target = boards.find((b) => b.id === targetBoardId);
  if (!target) return [];
  const out: Backlink[] = [];
  for (const b of boards) {
    for (const n of b.nodes) {
      if (n.type === 'portal' && n.data.boardId === targetBoardId && b.id !== targetBoardId) {
        out.push({ boardId: b.id, boardName: b.name, nodeId: n.id, label: 'Portal', kind: 'portal' });
      } else if (n.type === 'note') {
        const text = nodeToText(n);
        for (const name of extractWikilinks(text)) {
          const t = resolveLink(name, boards);
          if (t && t.boardId === targetBoardId && !(b.id === targetBoardId && t.kind === 'board')) {
            const title = text.split('\n').find((l) => l.trim())?.slice(0, 50) ?? 'Notiz';
            out.push({ boardId: b.id, boardName: b.name, nodeId: n.id, label: title, kind: 'wikilink' });
            break; // eine Notiz zählt einmal
          }
        }
      }
    }
  }
  return out.slice(0, 40);
}

export interface GraphNode { id: string; label: string; cards: number }
export interface GraphLink { a: string; b: string; kind: 'portal' | 'wikilink' }

/** Board-Netz: Portale (feste Verweise) + Wikilinks (Text-Verweise) als Kanten */
export function boardGraph(boards: BoardDoc[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = boards.map((b) => ({ id: b.id, label: b.name, cards: b.nodes.length }));
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, kind: GraphLink['kind']) => {
    if (a === b) return;
    const key = [a, b].sort().join('|') + kind;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ a, b, kind });
  };
  for (const b of boards) {
    for (const n of b.nodes) {
      if (n.type === 'portal' && typeof n.data.boardId === 'string') {
        if (boards.some((x) => x.id === n.data.boardId)) add(b.id, n.data.boardId as string, 'portal');
      } else if (n.type === 'note') {
        for (const name of extractWikilinks(nodeToText(n))) {
          const t = resolveLink(name, boards);
          if (t?.kind === 'board') add(b.id, t.boardId, 'wikilink');
          else if (t?.kind === 'card') add(b.id, t.boardId, 'wikilink');
        }
      }
    }
  }
  return { nodes, links };
}

/** Kleines Force-Layout (Abstoßung + Federn + Zentrums-Gravitation) — deterministisch */
export function layoutGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const cx = width / 2, cy = height / 2;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    pos.set(n.id, { x: cx + Math.cos(angle) * width * 0.3, y: cy + Math.sin(angle) * height * 0.3 });
  });
  const K = 9000;
  for (let iter = 0; iter < 260; iter++) {
    const force = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(400, dx * dx + dy * dy);
        const f = K / d2;
        const d = Math.sqrt(d2);
        force.get(nodes[i].id)!.x += (dx / d) * f;
        force.get(nodes[i].id)!.y += (dy / d) * f;
        force.get(nodes[j].id)!.x -= (dx / d) * f;
        force.get(nodes[j].id)!.y -= (dy / d) * f;
      }
    }
    for (const l of links) {
      const a = pos.get(l.a), b = pos.get(l.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d - 170) * 0.02;
      force.get(l.a)!.x += (dx / d) * f;
      force.get(l.a)!.y += (dy / d) * f;
      force.get(l.b)!.x -= (dx / d) * f;
      force.get(l.b)!.y -= (dy / d) * f;
    }
    const cool = 1 - iter / 260;
    for (const n of nodes) {
      const p = pos.get(n.id)!, f = force.get(n.id)!;
      f.x += (cx - p.x) * 0.005;
      f.y += (cy - p.y) * 0.005;
      p.x = Math.max(50, Math.min(width - 50, p.x + f.x * cool));
      p.y = Math.max(40, Math.min(height - 40, p.y + f.y * cool));
    }
  }
  return pos;
}
