// M443: Der Motor des MCP-Servers — Boards lesen, anlegen und mit der Operations-Sprache der eingebauten KI
// bearbeiten. Dieselbe Logik wie in der App (lib/kiPlan.ts, lib/kiModule.ts), ausgeführt auf einem Stand im Speicher.
import { GRUND_OPS, planAusfuehren, type AiOp } from '../src/lib/kiPlan';
import * as km from '../src/lib/kiModule';
import { textZuBloecken } from '../src/lib/notiz';
import { CARD_WIDTHS } from '../src/lib/nodes';
import { uid, type AppNode } from '../src/types';
import { standHolen, standSetzen, useBoard, type BoardDoc, type Space } from './storeShim';

export interface Stand { boards: BoardDoc[]; spaces: Space[]; activeId: string }

const ALLE_MODULE = new Set(['note', 'sheet', 'kanban', 'gantt', 'week', 'minutes', 'time', 'bubbles', 'mermaid']);

/** Ein Board über Kennung oder Namen finden (Groß-/Kleinschreibung egal) */
export function boardFinden(stand: Stand, wer: string): BoardDoc | undefined {
  const w = wer.trim();
  return stand.boards.find((b) => b.id === w)
    ?? stand.boards.find((b) => b.name.trim().toLowerCase() === w.toLowerCase())
    ?? stand.boards.find((b) => b.name.trim().toLowerCase().includes(w.toLowerCase()));
}

/* ─────────────────────────── Markdown → Blöcke (ohne Browser) ─────────────────────────── */

/** **fett**, *kursiv*, `code`, ~~durch~~ und [Text](Adresse) als BlockNote-Inhalt */
function inline(text: string): unknown {
  const teile: unknown[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let rest = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > rest) teile.push({ type: 'text', text: text.slice(rest, m.index), styles: {} });
    if (m[2] ?? m[3]) teile.push({ type: 'text', text: m[2] ?? m[3], styles: { bold: true } });
    else if (m[4] ?? m[5]) teile.push({ type: 'text', text: m[4] ?? m[5], styles: { italic: true } });
    else if (m[6]) teile.push({ type: 'text', text: m[6], styles: { code: true } });
    else if (m[7]) teile.push({ type: 'text', text: m[7], styles: { strike: true } });
    else if (m[8]) teile.push({ type: 'link', href: m[9], content: [{ type: 'text', text: m[8], styles: {} }] });
    rest = m.index + m[0].length;
  }
  if (rest < text.length) teile.push({ type: 'text', text: text.slice(rest), styles: {} });
  return teile.length ? teile : '';
}

export function markdownZuBloecken(md: string): unknown[] {
  return (textZuBloecken(md) as Array<{ content?: unknown }>).map((b) => (typeof b.content === 'string' ? { ...b, content: inline(b.content) } : b));
}
const mdAsync = async (titel: string, md: string) => markdownZuBloecken(titel ? `### ${titel}\n\n${md}` : md);

/* ─────────────────────────── Lesen ─────────────────────────── */

export function uebersicht(stand: Stand): string {
  const zeilen: string[] = [];
  const zugeordnet = new Set<string>();
  const beschreibe = (b: BoardDoc) => {
    const arten = new Map<string, number>();
    for (const n of b.nodes) arten.set(n.type ?? '?', (arten.get(n.type ?? '?') ?? 0) + 1);
    return `[${b.id}] ${b.name} · ${b.nodes.length} Karten${arten.size ? ` (${[...arten].map(([t, z]) => `${z}× ${t}`).join(', ')})` : ''}${b.archived ? ' · archiviert' : ''}`;
  };
  for (const sp of stand.spaces) {
    zeilen.push(`Bereich „${sp.name}" [${sp.id}]`);
    for (const p of sp.projects) {
      zeilen.push(`  Projekt „${p.name}" [${p.id}]`);
      for (const id of p.boardIds) {
        const b = stand.boards.find((x) => x.id === id);
        if (!b) continue;
        zugeordnet.add(b.id);
        zeilen.push(`    Board ${beschreibe(b)}`);
      }
    }
  }
  const lose = stand.boards.filter((b) => !zugeordnet.has(b.id) && !b.geteiltVon);
  if (lose.length) { zeilen.push('Ohne Projekt'); for (const b of lose) zeilen.push(`    Board ${beschreibe(b)}`); }
  return zeilen.length ? zeilen.join('\n') : '(noch keine Boards)';
}

export function boardLesen(stand: Stand, b: BoardDoc): string {
  const umfeld = { alle: b.nodes as AppNode[], boards: stand.boards.map((x) => ({ id: x.id, name: x.name })) };
  const karten = (b.nodes as AppNode[]).map((n) => {
    const w = Math.round((n.width as number | undefined) ?? (n.measured?.width ?? 0));
    const h = Math.round((n.height as number | undefined) ?? (n.measured?.height ?? 0));
    return `── Karte [${n.id}] · ${n.type} · pos ${Math.round(n.position.x)},${Math.round(n.position.y)}${w ? ` · ${w}×${h}` : ''}\n${km.kiLesen(n, umfeld)}`;
  });
  const titel = new Map((b.nodes as AppNode[]).map((n) => [n.id, km.kiKurz(n, umfeld, 60).split('\n')[0]]));
  const pfeile = b.edges.map((e) => `[${e.source}] ${titel.get(e.source) ?? ''} → [${e.target}] ${titel.get(e.target) ?? ''}${(e.data as { label?: string } | undefined)?.label ? ` („${(e.data as { label: string }).label}")` : ''}`);
  return `Board „${b.name}" [${b.id}] · ${b.nodes.length} Karten · ${b.edges.length} Pfeile\n\n${karten.join('\n\n') || '(leer)'}${pfeile.length ? `\n\nPfeile:\n${pfeile.join('\n')}` : ''}`;
}

/* ─────────────────────────── Anlegen ─────────────────────────── */

export function boardAnlegen(stand: Stand, name: string, bereich?: string, projekt?: string): { stand: Stand; board: BoardDoc } {
  const board: BoardDoc = { id: uid(), name: name.trim().slice(0, 80) || 'Neues Board', nodes: [], edges: [], drawings: [] };
  const spaces = stand.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p) => ({ ...p, boardIds: [...p.boardIds] })) }));
  const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  let sp = bereich ? spaces.find((s) => gleich(s.name, bereich) || s.id === bereich) : spaces[0];
  if (!sp) { sp = { id: uid(), name: (bereich ?? 'Bereich').trim().slice(0, 60) || 'Bereich', projects: [] }; spaces.push(sp); }
  let p = projekt ? sp.projects.find((x) => gleich(x.name, projekt) || x.id === projekt) : sp.projects[0];
  if (!p) { p = { id: uid(), name: (projekt ?? 'Projekt').trim().slice(0, 60) || 'Projekt', boardIds: [] }; sp.projects.push(p); }
  p.boardIds.push(board.id);
  return { stand: { ...stand, boards: [...stand.boards, board], spaces, activeId: stand.activeId || board.id }, board };
}

/* ─────────────────────────── Bearbeiten ─────────────────────────── */

/** Neue Karten legen sich unter den vorhandenen Inhalt, in Reihen zu drei — nichts überdeckt etwas */
function platzierer(b: BoardDoc) {
  const knoten = b.nodes as AppNode[];
  const breite = (n: AppNode) => (n.width as number | undefined) ?? n.measured?.width ?? 300;
  const hoehe = (n: AppNode) => (n.height as number | undefined) ?? n.measured?.height ?? 200;
  const x0 = knoten.length ? Math.min(...knoten.map((n) => n.position.x)) : 0;
  let y = knoten.length ? Math.max(...knoten.map((n) => n.position.y + hoehe(n))) + 80 : 0;
  let x = x0; let spalte = 0; let reiheHoehe = 0;
  const SPALTE = Math.max(CARD_WIDTHS.gantt, 460) + 60;
  return (h: number) => {
    if (spalte === 3) { spalte = 0; x = x0; y += reiheHoehe + 60; reiheHoehe = 0; }
    const pos = { x, y };
    x += SPALTE; spalte += 1; reiheHoehe = Math.max(reiheHoehe, h);
    return pos;
  };
}

export interface AusfuehrErgebnis { erledigt: number; neu: Array<{ id: string; type: string }>; antworten: string[]; abgelehnt: string[] }

/** Zusätzliche Operationen, die es nur hier gibt: Karte verschieben, Größe, Board umbenennen */
function zusatz(o: AiOp, b: () => BoardDoc): boolean | undefined {
  const st = useBoard.getState();
  if (o.op === 'move') {
    const n = (b().nodes as AppNode[]).find((k) => k.id === o.id);
    if (!n || typeof o.x !== 'number' || typeof o.y !== 'number') return false;
    useBoard.setState({ boards: st.boards.map((x) => (x.id === st.activeId ? { ...x, nodes: x.nodes.map((k) => (k.id === n.id ? { ...k, position: { x: o.x as number, y: o.y as number } } : k)) } : x)) });
    return true;
  }
  if (o.op === 'resize') {
    const n = (b().nodes as AppNode[]).find((k) => k.id === o.id);
    if (!n || typeof o.width !== 'number' || typeof o.height !== 'number') return false;
    st.resizeNode(n.id, Math.max(80, Math.min(2400, o.width as number)), Math.max(60, Math.min(2400, o.height as number)));
    return true;
  }
  return undefined;
}

export async function ausfuehren(stand: Stand, boardId: string, ops: AiOp[]): Promise<{ stand: Stand; ergebnis: AusfuehrErgebnis }> {
  standSetzen({ ...stand, activeId: boardId });
  const board = () => standHolen().boards.find((x) => x.id === boardId)!;
  const vorher = new Set(board().nodes.map((n) => n.id));
  const place = platzierer(board());
  const ergebnis: AusfuehrErgebnis = { erledigt: 0, neu: [], antworten: [], abgelehnt: [] };
  const bloecke = await km.kiVorbereiten(ops as km.KiOp[], mdAsync);
  // Einzeln ausführen: So kennt jede Operation die Karten, die die vorigen angelegt haben, und eine abgelehnte
  // Operation lässt sich genau benennen
  for (const o of ops) {
    if (!o || typeof o.op !== 'string') { ergebnis.abgelehnt.push(JSON.stringify(o).slice(0, 120)); continue; }
    const z = zusatz(o, board);
    if (z !== undefined) { if (z) ergebnis.erledigt += 1; else ergebnis.abgelehnt.push(`${o.op}: ungültig (id/x/y/width/height prüfen)`); continue; }
    const known = new Map((board().nodes as AppNode[]).map((n) => [n.id, n]));
    const preBlocks = new Map<AiOp, unknown[]>();
    if (o.op === 'note') {
      const md = [typeof o.title === 'string' && o.title.trim() ? `### ${o.title.trim()}` : '', typeof o.text === 'string' ? o.text : ''].filter(Boolean).join('\n\n');
      if (md) preBlocks.set(o, markdownZuBloecken(md));
    } else if (o.op === 'edit_note' && typeof o.text === 'string' && o.text.trim()) {
      preBlocks.set(o, markdownZuBloecken(o.text));
    }
    const r = planAusfuehren([o], preBlocks, known, useBoard.getState() as never, place, { km, bloecke });
    ergebnis.erledigt += r.done;
    ergebnis.antworten.push(...r.antworten);
    if (!r.done && o.op !== 'answer') ergebnis.abgelehnt.push(`${o.op}${o.id ? ` (${o.id})` : ''}: nicht ausgeführt – Kennungen und Pflichtfelder prüfen`);
  }
  for (const n of board().nodes as AppNode[]) if (!vorher.has(n.id)) ergebnis.neu.push({ id: n.id, type: n.type ?? '?' });
  const z = standHolen();
  return { stand: { boards: z.boards, spaces: z.spaces, activeId: stand.activeId || boardId }, ergebnis };
}

/** Die Operations-Sprache — für die Beschreibung des Werkzeugs */
export function opsBeschreibung(): string {
  return `${GRUND_OPS}\n${km.kiOpsText(ALLE_MODULE)}\n{"op":"move","id":"<Karten-id>","x":0,"y":0} (Karte an eine Stelle der Leinwand legen; x nach rechts, y nach unten)\n{"op":"resize","id":"<Karten-id>","width":400,"height":300} (Größe einer Karte)`;
}
