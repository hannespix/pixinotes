// Aufräumen & Anordnen — reiner Algorithmus, keine KI:
// 1. Zusammenhängende Karten (Verbindungen) bilden Cluster und werden als
//    Fluss von links nach rechts geschichtet (Tiefe = Spalte).
// 2. Unverbundene Karten werden nach Modultyp gruppiert (Notizen zu Notizen,
//    Kanbans zu Kanbans …) und als kompakte Raster gelegt.
// 3. Alle Blöcke werden mit sauberen Abständen zeilenweise gepackt
//    (Shelf-Packing), sodass eine harmonische Gesamtfläche entsteht.
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';

const GAP_X = 130;   // Abstand zwischen Schicht-Spalten
const GAP_Y = 56;    // Abstand zwischen Karten in einer Spalte / Rasterzeile
const BLOCK_GAP = 170; // Abstand zwischen Blöcken (Cluster/Gruppen)
const ROW_GAP = 190;
const MARGIN_X = 80;
const MARGIN_Y = 120;

const DEF_W: Record<string, number> = {
  note: 280, email: 320, image: 260, file: 240, kanban: 440, portal: 200,
  shape: 160, mermaid: 400, gantt: 580, calendar: 460, pdf: 280,
};
const DEF_H: Record<string, number> = {
  note: 170, email: 240, image: 200, file: 120, kanban: 260, portal: 150,
  shape: 70, mermaid: 270, gantt: 250, calendar: 350, pdf: 300,
};

/** Reihenfolge der Typ-Gruppen (bestimmt die Lesereihenfolge der Fläche) */
const TYPE_ORDER = ['note', 'kanban', 'gantt', 'calendar', 'mermaid', 'shape', 'email', 'pdf', 'image', 'file', 'portal'];

interface Size { w: number; h: number }
interface Placed { id: string; x: number; y: number }
interface Block { w: number; h: number; nodes: Placed[] }

function sizeOf(n: AppNode): Size {
  return {
    w: n.measured?.width ?? (typeof n.width === 'number' ? n.width : undefined) ?? DEF_W[n.type ?? ''] ?? 280,
    h: n.measured?.height ?? (typeof n.height === 'number' ? n.height : undefined) ?? DEF_H[n.type ?? ''] ?? 170,
  };
}

/** Zusammenhangskomponenten über die (ungerichteten) Verbindungen */
function components(nodes: AppNode[], edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const comp: string[] = [];
    const queue = [n.id];
    seen.add(n.id);
    while (queue.length) {
      const id = queue.shift()!;
      comp.push(id);
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Verbundener Cluster → Schichten-Layout: Tiefe (längster Pfad) = Spalte */
function layoutComponent(ids: string[], byId: Map<string, AppNode>, edges: Edge[]): Block {
  const inComp = new Set(ids);
  const compEdges = edges.filter((e) => inComp.has(e.source) && inComp.has(e.target));

  // Tiefe über Longest-Path-Relaxation (Zyklen durch Pass-Limit abgefangen)
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length + 1; pass++) {
    let changed = false;
    for (const e of compEdges) {
      const d = depth.get(e.source)! + 1;
      if (d > depth.get(e.target)! && d < ids.length) {
        depth.set(e.target, d);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Spalten füllen (stabile Reihenfolge: erst nach Tiefe, dann Ursprungs-Y)
  const cols = new Map<number, AppNode[]>();
  for (const id of ids) {
    const d = depth.get(id)!;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(byId.get(id)!);
  }
  for (const col of cols.values()) col.sort((a, b) => a.position.y - b.position.y);

  const colDepths = [...cols.keys()].sort((a, b) => a - b);
  const colDims = colDepths.map((d) => {
    const col = cols.get(d)!;
    const w = Math.max(...col.map((n) => sizeOf(n).w));
    const h = col.reduce((a, n) => a + sizeOf(n).h, 0) + GAP_Y * (col.length - 1);
    return { d, col, w, h };
  });
  const totalH = Math.max(...colDims.map((c) => c.h));
  const nodes: Placed[] = [];
  let x = 0;
  for (const { col, w, h } of colDims) {
    let y = (totalH - h) / 2; // Spalten vertikal zentrieren
    for (const n of col) {
      const s = sizeOf(n);
      nodes.push({ id: n.id, x: x + (w - s.w) / 2, y });
      y += s.h + GAP_Y;
    }
    x += w + GAP_X;
  }
  return { w: x - GAP_X, h: totalH, nodes };
}

/** Unverbundene Karten eines Typs → kompaktes Raster (≈ 3:2-Blöcke) */
function layoutGrid(group: AppNode[]): Block {
  const sorted = [...group].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const colCount = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.4)));
  const rows: AppNode[][] = [];
  for (let i = 0; i < sorted.length; i += colCount) rows.push(sorted.slice(i, i + colCount));
  const nodes: Placed[] = [];
  let y = 0;
  let maxW = 0;
  for (const row of rows) {
    let x = 0;
    const rowH = Math.max(...row.map((n) => sizeOf(n).h));
    for (const n of row) {
      const s = sizeOf(n);
      nodes.push({ id: n.id, x, y: y + (rowH - s.h) / 2 });
      x += s.w + GAP_Y;
    }
    maxW = Math.max(maxW, x - GAP_Y);
    y += rowH + GAP_Y;
  }
  return { w: maxW, h: y - GAP_Y, nodes };
}

/** Kreis-Bündel: Karten eines Blocks auf einem Ring (Mittelpunkte gleichverteilt) */
function layoutCircle(group: AppNode[]): Block {
  if (group.length === 1) return layoutGrid(group);
  const sorted = [...group].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const sizes = sorted.map(sizeOf);
  // Umfang muss alle Karten (plus Luft) aufnehmen — Diagonale als sichere
  // Schranke, damit auch breite Karten (Kanban, Gantt) nirgends kollidieren
  const diags = sizes.map((s) => Math.hypot(s.w, s.h));
  const perim = diags.reduce((a, d) => a + d + GAP_Y, 0);
  const maxDiag = Math.max(...diags);
  // Sehnenabstand benachbarter Mittelpunkte ≥ größte Diagonale
  const rChord = maxDiag / (2 * Math.sin(Math.PI / sorted.length));
  const r = Math.max(160, perim / (2 * Math.PI), rChord);
  const maxW = Math.max(...sizes.map((s) => s.w));
  const maxH = Math.max(...sizes.map((s) => s.h));
  const cx = r + maxW / 2;
  const cy = r + maxH / 2;
  const nodes: Placed[] = sorted.map((n, i) => {
    const a = (i / sorted.length) * Math.PI * 2 - Math.PI / 2;
    const s = sizes[i];
    return { id: n.id, x: cx + Math.cos(a) * r - s.w / 2, y: cy + Math.sin(a) * r - s.h / 2 };
  });
  return { w: 2 * r + maxW, h: 2 * r + maxH, nodes };
}

/** Überlappender Stapel: Kaskaden-Versatz, sodass die Überschriften sichtbar bleiben */
function layoutStack(group: AppNode[]): Block {
  const sorted = [...group].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const STEP_X = 26;
  const STEP_Y = 46; // genug für Titel-/Kopfzeile der darunterliegenden Karte
  const nodes: Placed[] = sorted.map((n, i) => ({ id: n.id, x: i * STEP_X, y: i * STEP_Y }));
  const last = sizeOf(sorted[sorted.length - 1]);
  const maxW = Math.max(...sorted.map((n, i) => i * STEP_X + sizeOf(n).w));
  return { w: maxW, h: (sorted.length - 1) * STEP_Y + last.h, nodes };
}

export type ArrangeMode = 'flow' | 'grid' | 'circles' | 'stack';

/** Komplettes Board anordnen → Ziel-Positionen [id, x, y] */
export function computeArrangement(nodes: AppNode[], edges: Edge[], mode: ArrangeMode = 'flow'): Array<[string, number, number]> {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const comps = components(nodes, edges);
  const typeGroups = (): AppNode[][] => {
    const out: AppNode[][] = [];
    for (const type of TYPE_ORDER) {
      const g = nodes.filter((n) => (n.type ?? '') === type);
      if (g.length) out.push(g);
    }
    const rest = nodes.filter((n) => !TYPE_ORDER.includes(n.type ?? ''));
    if (rest.length) out.push(rest);
    return out;
  };

  const blocks: Block[] = [];
  if (mode === 'grid') {
    // Reines Raster: Verbindungen ignorieren, alles nach Typ sortiert rastern
    for (const g of typeGroups()) blocks.push(layoutGrid(g));
  } else if (mode === 'stack') {
    // Überlappende Stapel pro Modultyp — Überschriften bleiben lesbar
    for (const g of typeGroups()) blocks.push(layoutStack(g));
  } else if (mode === 'circles') {
    // Kreis-Bündel: verbundene Cluster + Typ-Gruppen jeweils als Ring
    for (const comp of comps.filter((c) => c.length > 1).sort((a, b) => b.length - a.length)) {
      blocks.push(layoutCircle(comp.map((id) => byId.get(id)!)));
    }
    const singles = comps.filter((c) => c.length === 1).map((c) => byId.get(c[0])!);
    for (const type of TYPE_ORDER) {
      const group = singles.filter((n) => (n.type ?? '') === type);
      if (group.length) blocks.push(layoutCircle(group));
    }
    const rest = singles.filter((n) => !TYPE_ORDER.includes(n.type ?? ''));
    if (rest.length) blocks.push(layoutCircle(rest));
  } else {
    // 'flow' (Standard):
    // 1) verbundene Cluster (größte zuerst — sie prägen das Bild)
    for (const comp of comps.filter((c) => c.length > 1).sort((a, b) => b.length - a.length)) {
      blocks.push(layoutComponent(comp, byId, edges));
    }
    // 2) Singles nach Modultyp gruppieren
    const singles = comps.filter((c) => c.length === 1).map((c) => byId.get(c[0])!);
    for (const type of TYPE_ORDER) {
      const group = singles.filter((n) => (n.type ?? '') === type);
      if (group.length) blocks.push(layoutGrid(group));
    }
    const rest = singles.filter((n) => !TYPE_ORDER.includes(n.type ?? ''));
    if (rest.length) blocks.push(layoutGrid(rest));
  }

  // 3) Shelf-Packing: Blöcke zeilenweise auf eine harmonische Zielbreite legen
  const totalArea = blocks.reduce((a, b) => a + (b.w + BLOCK_GAP) * (b.h + ROW_GAP), 0);
  const targetW = Math.max(1500, Math.sqrt(totalArea * 2.1));
  const out: Array<[string, number, number]> = [];
  let cursorX = MARGIN_X;
  let cursorY = MARGIN_Y;
  let rowH = 0;
  for (const b of blocks) {
    if (cursorX > MARGIN_X && cursorX + b.w > targetW) {
      cursorX = MARGIN_X;
      cursorY += rowH + ROW_GAP;
      rowH = 0;
    }
    for (const p of b.nodes) out.push([p.id, cursorX + p.x, cursorY + p.y]);
    cursorX += b.w + BLOCK_GAP;
    rowH = Math.max(rowH, b.h);
  }
  return out;
}
