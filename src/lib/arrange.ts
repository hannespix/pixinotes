// Aufräumen & Anordnen — reiner Algorithmus, keine KI:
// 1. Zusammenhängende Karten (Verbindungen) bilden Cluster und werden als
//    Fluss von links nach rechts geschichtet (Tiefe = Spalte).
// 2. Unverbundene Karten werden nach Modultyp gruppiert (Notizen zu Notizen,
//    Kanbans zu Kanbans …) und als kompakte Raster gelegt.
// 3. Alle Blöcke werden mit sauberen Abständen zeilenweise gepackt
//    (Shelf-Packing), sodass eine harmonische Gesamtfläche entsteht.
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';

const GAP_X = 100;   // Abstand zwischen Schicht-Spalten
const ANNEX_GAP = 110; // Abstand des „Anbaus" (große Karten) unter dem Prozessband
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

export function sizeOf(n: AppNode): Size {
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

/**
 * Verbundener Cluster → Schichten-Layout nach Sugiyama-Art (M130/M133):
 * 1. „Anbau"-Trennung: Riesen-Karten (Mermaid, Kanban, Notizen …) mit wenig
 *    Verbindungen fliegen aus dem Prozessband und kommen ausgerichtet
 *    DARUNTER — sie blähen sonst die Spalten auf und erzwingen lange Linien.
 * 2. Zyklus-Behandlung: Rückwärts-Kanten (Prozess-Schleifen wie „Nein →
 *    zurück") werden per DFS erkannt und verzerren die Schichten nicht mehr.
 * 3. Tiefe (längster Pfad im azyklischen Teil) = Spalte.
 * 4. Kreuzungsminimierung: Barycenter-Durchläufe ordnen jede Spalte nach der
 *    mittleren Position ihrer Nachbarn (vor- und rückwärts).
 * 5. Y-Feinausrichtung: Karten rücken vertikal zu ihren Nachbarn auf, sodass
 *    Verbindungen möglichst waagerecht laufen.
 */
function layoutComponent(allIds: string[], byId: Map<string, AppNode>, edges: Edge[]): Block {
  const inComp = new Set(allIds);
  const compEdges = edges.filter((e) => inComp.has(e.source) && inComp.has(e.target));

  // 1) Anbau-Trennung: groß + wenig verbunden → unter das Band
  const degree = new Map<string, number>(allIds.map((id) => [id, 0]));
  for (const e of compEdges) {
    degree.set(e.source, degree.get(e.source)! + 1);
    degree.set(e.target, degree.get(e.target)! + 1);
  }
  const isBig = (id: string) => { const s = sizeOf(byId.get(id)!); return s.w >= 380 || s.h >= 300; };
  let annex = allIds.filter((id) => isBig(id) && degree.get(id)! <= 2);
  let ids = allIds.filter((id) => !annex.includes(id));
  if (ids.length < 2) { annex = []; ids = allIds; } // reine Riesen-Cluster normal layouten
  const coreSet = new Set(ids);
  const coreEdges = compEdges.filter((e) => coreSet.has(e.source) && coreSet.has(e.target));

  // 2+3) Feedback-Kanten (Zyklen) + Schichten: Die Leserichtung eines Kreises
  // hängt vom DFS-Start ab — deshalb werden mehrere Startknoten durchprobiert
  // und die Orientierung gewählt, die (a) die wenigsten Rückwärts-Kanten und
  // (b) die längste natürliche Kette ergibt („Antrag → Prüfung → … → zurück").
  const outAdj = new Map<string, Edge[]>(ids.map((id) => [id, []]));
  for (const e of coreEdges) outAdj.get(e.source)!.push(e);
  const startOrder = [...ids].sort((a, b) =>
    byId.get(a)!.position.x - byId.get(b)!.position.x || byId.get(a)!.position.y - byId.get(b)!.position.y);
  const layerDepths = (dag: Edge[]): Map<string, number> => {
    const dep = new Map<string, number>(ids.map((id) => [id, 0]));
    for (let pass = 0; pass < ids.length + 1; pass++) {
      let changed = false;
      for (const e of dag) {
        const d = dep.get(e.source)! + 1;
        if (d > dep.get(e.target)! && d < ids.length) { dep.set(e.target, d); changed = true; }
      }
      if (!changed) break;
    }
    return dep;
  };
  const tryStart = (cand: string): { fb: Set<Edge>; score: number } => {
    const state = new Map<string, number>(ids.map((id) => [id, 0]));
    const fb = new Set<Edge>();
    const dfs = (u: string) => {
      state.set(u, 1);
      for (const e of outAdj.get(u)!) {
        const s = state.get(e.target);
        if (s === 1) fb.add(e);
        else if (s === 0) dfs(e.target);
      }
      state.set(u, 2);
    };
    dfs(cand);
    for (const id of startOrder) if (state.get(id) === 0) dfs(id);
    const dep = layerDepths(coreEdges.filter((e) => !fb.has(e)));
    const depthSum = [...dep.values()].reduce((a, b) => a + b, 0);
    return { fb, score: depthSum - fb.size * 10_000 };
  };
  // Perf-Deckel: bei sehr großen Clustern nur eine Handvoll Kandidaten testen
  const candidates = ids.length <= 40 ? startOrder : startOrder.slice(0, 12);
  let best = tryStart(candidates[0]);
  for (const cand of candidates.slice(1)) {
    const t = tryStart(cand);
    if (t.score > best.score) best = t;
  }
  const depth = layerDepths(coreEdges.filter((e) => !best.fb.has(e)));

  // Ungerichtete Nachbarschaft (für Ordnung + Y-Ausrichtung, inkl. Schleifen)
  const nbrs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of coreEdges) {
    nbrs.get(e.source)!.push(e.target);
    nbrs.get(e.target)!.push(e.source);
  }

  // Spalten füllen (Startreihenfolge: Ursprungs-Y — stabil und vertraut)
  const cols = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id)!;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(id);
  }
  for (const col of cols.values()) col.sort((a, b) => byId.get(a)!.position.y - byId.get(b)!.position.y);
  const colDepths = [...cols.keys()].sort((a, b) => a - b);

  // 2) Barycenter-Ordnung: abwechselnd vor- und rückwärts über die Spalten
  const orderIdx = new Map<string, number>();
  const reindex = () => { for (const col of cols.values()) col.forEach((id, i) => orderIdx.set(id, i)); };
  reindex();
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const seq = forward ? colDepths : [...colDepths].reverse();
    for (const d of seq) {
      const col = cols.get(d)!;
      if (col.length < 2) continue;
      const bary = (id: string): number => {
        const side = nbrs.get(id)!.filter((n) => (forward ? depth.get(n)! < d : depth.get(n)! > d));
        const list = side.length ? side : nbrs.get(id)!;
        if (!list.length) return orderIdx.get(id)!;
        return list.reduce((a, n) => a + orderIdx.get(n)!, 0) / list.length;
      };
      const keyed = col.map((id) => [id, bary(id)] as const);
      keyed.sort((a, b) => a[1] - b[1]);
      cols.set(d, keyed.map(([id]) => id));
      cols.get(d)!.forEach((id, i) => orderIdx.set(id, i));
    }
  }

  // Spaltenmaße + X-Positionen
  const colDims = colDepths.map((d) => {
    const col = cols.get(d)!;
    const w = Math.max(...col.map((id) => sizeOf(byId.get(id)!).w));
    const h = col.reduce((a, id) => a + sizeOf(byId.get(id)!).h, 0) + GAP_Y * (col.length - 1);
    return { d, col, w, h };
  });
  const totalH = Math.max(...colDims.map((c) => c.h));

  // Start: Spalten vertikal zentriert stapeln → Karten-MITTELPUNKTE merken
  const centerY = new Map<string, number>();
  for (const { col, h } of colDims) {
    let yCur = (totalH - h) / 2;
    for (const id of col) {
      const s = sizeOf(byId.get(id)!);
      centerY.set(id, yCur + s.h / 2);
      yCur += s.h + GAP_Y;
    }
  }

  // 3) Y-Feinausrichtung: Karten zum Mittel ihrer Nachbarn ziehen, Ordnung
  // und Mindestabstände innerhalb der Spalte bleiben gewahrt
  for (let pass = 0; pass < 6; pass++) {
    const seq = pass % 2 === 0 ? colDepths : [...colDepths].reverse();
    for (const d of seq) {
      const col = cols.get(d)!;
      const sizes = col.map((id) => sizeOf(byId.get(id)!));
      const want = col.map((id) => {
        const ns = nbrs.get(id)!;
        if (!ns.length) return centerY.get(id)!;
        return ns.reduce((a, n) => a + centerY.get(n)!, 0) / ns.length;
      });
      // Von oben nach unten schieben (Mindestabstand), dann von unten zurück —
      // das mittelt die Wünsche, ohne Kollisionen zuzulassen
      const c = [...want];
      for (let i = 1; i < col.length; i++) {
        const minC = c[i - 1] + sizes[i - 1].h / 2 + GAP_Y + sizes[i].h / 2;
        if (c[i] < minC) c[i] = minC;
      }
      for (let i = col.length - 2; i >= 0; i--) {
        const maxC = c[i + 1] - sizes[i + 1].h / 2 - GAP_Y - sizes[i].h / 2;
        if (c[i] > maxC) c[i] = maxC;
      }
      col.forEach((id, i) => centerY.set(id, c[i]));
    }
  }

  // Ausgabe: auf 0 normalisieren, X wie gehabt spaltenweise
  const minY = Math.min(...ids.map((id) => centerY.get(id)! - sizeOf(byId.get(id)!).h / 2));
  const maxY = Math.max(...ids.map((id) => centerY.get(id)! + sizeOf(byId.get(id)!).h / 2));
  const nodes: Placed[] = [];
  let x = 0;
  for (const { col, w } of colDims) {
    for (const id of col) {
      const s = sizeOf(byId.get(id)!);
      nodes.push({ id, x: x + (w - s.w) / 2, y: centerY.get(id)! - s.h / 2 - minY });
    }
    x += w + GAP_X;
  }
  const coreW = x - GAP_X;
  const coreH = maxY - minY;
  if (annex.length === 0) return { w: coreW, h: coreH, nodes };

  // 1b) Anbau platzieren: eine Reihe UNTER dem Band, horizontal möglichst
  // nahe an den Kern-Nachbarn (kurze, senkrechte Verbindungen)
  const placedX = new Map(nodes.map((p) => [p.id, p.x]));
  const centerOf = (id: string) => placedX.get(id)! + sizeOf(byId.get(id)!).w / 2;
  const nbrsAll = new Map<string, string[]>(allIds.map((id) => [id, []]));
  for (const e of compEdges) {
    nbrsAll.get(e.source)!.push(e.target);
    nbrsAll.get(e.target)!.push(e.source);
  }
  const desiredX = (id: string): number => {
    const cs = nbrsAll.get(id)!.filter((n) => coreSet.has(n));
    if (!cs.length) return 0;
    return cs.reduce((a, n) => a + centerOf(n), 0) / cs.length;
  };
  const annexY = coreH + ANNEX_GAP;
  let cursor = 0;
  let rowH = 0;
  for (const id of [...annex].sort((a, b) => desiredX(a) - desiredX(b))) {
    const s = sizeOf(byId.get(id)!);
    const ax = Math.max(cursor, desiredX(id) - s.w / 2);
    nodes.push({ id, x: ax, y: annexY });
    cursor = ax + s.w + GAP_Y;
    rowH = Math.max(rowH, s.h);
  }
  return { w: Math.max(coreW, cursor - GAP_Y), h: annexY + rowH, nodes };
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

/** Kreis-Bündel: Karten eines Blocks auf einem Ring (Mittelpunkte gleichverteilt).
 *  Hat der Block einen „Hub" (Karte, die mit fast allen anderen verbunden ist —
 *  z. B. die Titel-Bubble eines KI-Clusters), kommt er in die Ringmitte. */
function layoutCircle(group: AppNode[], edges?: Edge[]): Block {
  if (group.length === 1) return layoutGrid(group);
  let hub: AppNode | undefined;
  if (edges && group.length >= 3) {
    const ids = new Set(group.map((n) => n.id));
    const deg = new Map<string, number>();
    for (const e of edges) {
      if (ids.has(e.source) && ids.has(e.target)) {
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
      }
    }
    const best = [...deg.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= (group.length - 1) * 0.6) hub = group.find((n) => n.id === best[0]);
  }
  const ringGroup = hub ? group.filter((n) => n.id !== hub.id) : group;
  if (ringGroup.length < 2) return layoutGrid(group);
  const sorted = [...ringGroup].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const sizes = sorted.map(sizeOf);
  // Umfang muss alle Karten (plus Luft) aufnehmen — Diagonale als sichere
  // Schranke, damit auch breite Karten (Kanban, Gantt) nirgends kollidieren
  const diags = sizes.map((s) => Math.hypot(s.w, s.h));
  const perim = diags.reduce((a, d) => a + d + GAP_Y, 0);
  const maxDiag = Math.max(...diags);
  // Sehnenabstand benachbarter Mittelpunkte ≥ größte Diagonale
  const rChord = maxDiag / (2 * Math.sin(Math.PI / sorted.length));
  // Ring muss auch den Hub in der Mitte freihalten
  const rHub = hub ? Math.hypot(sizeOf(hub).w, sizeOf(hub).h) / 2 + maxDiag / 2 + GAP_Y : 0;
  const r = Math.max(160, perim / (2 * Math.PI), rChord, rHub);
  const maxW = Math.max(...sizes.map((s) => s.w));
  const maxH = Math.max(...sizes.map((s) => s.h));
  const cx = r + maxW / 2;
  const cy = r + maxH / 2;
  const nodes: Placed[] = sorted.map((n, i) => {
    const a = (i / sorted.length) * Math.PI * 2 - Math.PI / 2;
    const s = sizes[i];
    return { id: n.id, x: cx + Math.cos(a) * r - s.w / 2, y: cy + Math.sin(a) * r - s.h / 2 };
  });
  if (hub) {
    const hs = sizeOf(hub);
    nodes.push({ id: hub.id, x: cx - hs.w / 2, y: cy - hs.h / 2 });
  }
  return { w: 2 * r + maxW, h: 2 * r + maxH, nodes };
}

/** Überlappender Stapel: Kaskaden-Versatz, sodass die Überschriften sichtbar bleiben.
 *  Titel-Bubbles (Formen) liegen zuoberst im Kaskaden-Kopf — so bleibt der
 *  Cluster-Titel eines KI-Themas lesbar. */
function layoutStack(group: AppNode[]): Block {
  const sorted = [...group].sort((a, b) => {
    const sa = (a.type ?? '') === 'shape' ? 0 : 1;
    const sb = (b.type ?? '') === 'shape' ? 0 : 1;
    return sa - sb || a.position.y - b.position.y || a.position.x - b.position.x;
  });
  const STEP_X = 26;
  const STEP_Y = 46; // genug für Titel-/Kopfzeile der darunterliegenden Karte
  const nodes: Placed[] = sorted.map((n, i) => ({ id: n.id, x: i * STEP_X, y: i * STEP_Y }));
  const last = sizeOf(sorted[sorted.length - 1]);
  const maxW = Math.max(...sorted.map((n, i) => i * STEP_X + sizeOf(n).w));
  return { w: maxW, h: (sorted.length - 1) * STEP_Y + last.h, nodes };
}

export type ArrangeMode =
  | 'flow' | 'flowV' | 'grid' | 'circles' | 'stack'
  | 'lanes' | 'timeline' | 'metro' | 'compact' | 'quadrant';

/* ---------- M142: weitere Anordnungen ---------- */

/** Person einer Karte: Eigenschaft wer/who/person, sonst häufigste Person der Einträge */
function personOf(n: AppNode): string | null {
  const d = n.data as { attrs?: Record<string, string>; items?: Array<{ who?: string }>; rows?: Array<{ who?: string }> } | undefined;
  const a = d?.attrs?.wer ?? d?.attrs?.who ?? d?.attrs?.person;
  if (a?.trim()) return a.trim();
  const counts = new Map<string, number>();
  const bump = (w?: string) => { const t = w?.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); };
  if (n.type === 'kanban') for (const it of d?.items ?? []) bump(it.who);
  if (n.type === 'gantt') for (const r of d?.rows ?? []) bump(r.who);
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  return best?.[0] ?? null;
}

/** Früheste Frist / frühester Start einer Karte (ISO-Datum) */
function dateOf(n: AppNode): string | null {
  const d = n.data as { items?: Array<{ due?: string }>; rows?: Array<{ start?: string }> } | undefined;
  const dates: string[] = [];
  if (n.type === 'kanban') for (const it of d?.items ?? []) if (it.due) dates.push(it.due);
  if (n.type === 'gantt') for (const r of d?.rows ?? []) if (r.start) dates.push(r.start);
  return dates.sort()[0] ?? null;
}

/** Gruppen als umbrechende Reihen untereinander (Schwimmbahnen, Zeitstrahl) */
function arrangeRows(
  groups: Array<{ nodes: AppNode[]; keepOrder?: boolean }>,
  targetW = 2200,
): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  let y0 = MARGIN_Y;
  for (const g of groups) {
    if (g.nodes.length === 0) continue;
    const list = g.keepOrder
      ? g.nodes
      : [...g.nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    let x = MARGIN_X;
    let lineY = y0;
    let bottom = y0;
    for (const n of list) {
      const s = sizeOf(n);
      if (x > MARGIN_X && x + s.w > targetW) { x = MARGIN_X; lineY = bottom + GAP_Y; }
      out.push([n.id, x, lineY]);
      x += s.w + GAP_Y;
      bottom = Math.max(bottom, lineY + s.h);
    }
    y0 = bottom + ROW_GAP;
  }
  return out;
}

/** Schwimmbahnen: eine Bahn pro Person (Eigenschaft wer/who oder Ticket-Personen) */
function arrangeLanes(nodes: AppNode[]): { moves: Array<[string, number, number]>; lanes: string[] } {
  const byLane = new Map<string, AppNode[]>();
  const rest: AppNode[] = [];
  for (const n of nodes) {
    const p = personOf(n);
    if (p) { if (!byLane.has(p)) byLane.set(p, []); byLane.get(p)!.push(n); }
    else rest.push(n);
  }
  const lanes = [...byLane.keys()].sort((a, b) => a.localeCompare(b, 'de'));
  const groups = lanes.map((l) => ({ nodes: byLane.get(l)! }));
  if (rest.length) groups.push({ nodes: rest });
  return { moves: arrangeRows(groups), lanes: rest.length ? [...lanes, 'Ohne Zuordnung'] : lanes };
}

/** Zeitstrahl: Karten mit Frist chronologisch in einer Reihe, Undatiertes darunter */
function arrangeTimeline(nodes: AppNode[]): Array<[string, number, number]> {
  const dated = nodes
    .map((n) => ({ n, d: dateOf(n) }))
    .filter((x): x is { n: AppNode; d: string } => !!x.d)
    .sort((a, b) => a.d.localeCompare(b.d))
    .map((x) => x.n);
  const undated = nodes.filter((n) => !dateOf(n));
  return arrangeRows([{ nodes: dated, keepOrder: true }, { nodes: undated }], 2600);
}

/** Kompakt packen: minimale Fläche (Masonry/Shelf, höchste Karten zuerst) */
function arrangeCompact(nodes: AppNode[]): Array<[string, number, number]> {
  const GAP = 28;
  const sorted = [...nodes].sort((a, b) => sizeOf(b).h - sizeOf(a).h);
  const area = sorted.reduce((s, n) => { const z = sizeOf(n); return s + (z.w + GAP) * (z.h + GAP); }, 0);
  const targetW = Math.max(1100, Math.sqrt(area * 1.35));
  const out: Array<[string, number, number]> = [];
  let x = MARGIN_X;
  let y = MARGIN_Y;
  let rowH = 0;
  for (const n of sorted) {
    const s = sizeOf(n);
    if (x > MARGIN_X && x + s.w > targetW) { x = MARGIN_X; y += rowH + GAP; rowH = 0; }
    out.push([n.id, x, y]);
    x += s.w + GAP;
    rowH = Math.max(rowH, s.h);
  }
  return out;
}

/** Eisenhower-Quadrant: wichtig (Prio) × dringend (Frist ≤ 7 Tage) */
function arrangeQuadrant(nodes: AppNode[]): Array<[string, number, number]> {
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const important = (n: AppNode): boolean => {
    const d = n.data as { attrs?: Record<string, string>; items?: Array<{ prio?: number }> } | undefined;
    const a = (d?.attrs?.prio ?? d?.attrs?.wichtig ?? '').toLowerCase();
    if (a === '1' || a === '2' || a === 'hoch' || a === 'ja') return true;
    return (d?.items ?? []).some((it) => it.prio !== undefined && it.prio <= 2);
  };
  const urgent = (n: AppNode): boolean => { const d = dateOf(n); return !!d && d <= soon; };
  const q: AppNode[][] = [[], [], [], []]; // [wichtig+dringend, wichtig, dringend, Rest]
  for (const n of nodes) {
    const i = important(n) ? (urgent(n) ? 0 : 1) : urgent(n) ? 2 : 3;
    q[i].push(n);
  }
  const blocks = q.map((g) => (g.length ? layoutGrid(g) : { w: 0, h: 0, nodes: [] }));
  const colW = Math.max(blocks[0].w, blocks[2].w);
  const rowH = Math.max(blocks[0].h, blocks[1].h);
  const at = (b: Block, ox: number, oy: number): Array<[string, number, number]> =>
    b.nodes.map((p) => [p.id, MARGIN_X + ox + p.x, MARGIN_Y + oy + p.y]);
  return [
    ...at(blocks[0], 0, 0),
    ...at(blocks[1], colW + BLOCK_GAP, 0),
    ...at(blocks[2], 0, rowH + BLOCK_GAP),
    ...at(blocks[3], colW + BLOCK_GAP, rowH + BLOCK_GAP),
  ];
}

/** Bahnen-Namen für den Toast der Schwimmbahnen-Anordnung */
export function laneNames(nodes: AppNode[]): string[] {
  return arrangeLanes(nodes).lanes;
}

/**
 * Vertikaler Fluss (M141): derselbe Schichten-Algorithmus, nur transponiert —
 * die Karten werden mit vertauschten Achsen layoutet (Spalten → Zeilen,
 * Anbau rechts statt unten) und das Ergebnis zurückgetauscht.
 */
function transposeNode(n: AppNode): AppNode {
  const s = sizeOf(n);
  return {
    ...n,
    position: { x: n.position.y, y: n.position.x },
    width: s.h,
    height: s.w,
    measured: { width: s.h, height: s.w },
  } as AppNode;
}

/**
 * Freien Platz für eine neue Karte suchen (M130): Wunschposition behalten,
 * wenn dort nichts liegt — sonst in wachsenden Ringen darum die nächste
 * kollisionsfreie Stelle finden. So landet kein neues (KI-)Modul mehr
 * einfach ÜBER bestehenden Karten.
 */
export function findFreeSpot(
  existing: AppNode[],
  desired: { x: number; y: number },
  size: { w: number; h: number },
  gap = 48,
): { x: number; y: number } {
  const rects = existing
    // Rahmen zählen nicht als Hindernis — IN einen Frame legen ist erwünscht (M149)
    .filter((n) => !n.archived && n.type !== 'frame')
    .map((n) => { const s = sizeOf(n); return { x: n.position.x, y: n.position.y, w: s.w, h: s.h }; });
  const collides = (x: number, y: number) => rects.some((r) =>
    x < r.x + r.w + gap && x + size.w + gap > r.x && y < r.y + r.h + gap && y + size.h + gap > r.y);
  if (!collides(desired.x, desired.y)) return desired;
  const STEP = 80;
  for (let ring = 1; ring <= 40; ring++) {
    const r = ring * STEP;
    const samples = Math.max(8, ring * 6);
    for (let i = 0; i < samples; i++) {
      // Start rechts (Leserichtung), dann im Uhrzeigersinn; leicht gestaucht,
      // damit die Suche eher in die Breite als in die Tiefe ausweicht
      const a = (i / samples) * 2 * Math.PI;
      const x = desired.x + Math.cos(a) * r;
      const y = desired.y + Math.sin(a) * r * 0.8;
      if (!collides(x, y)) return { x, y };
    }
  }
  return desired;
}

/** Komplettes Board anordnen → Ziel-Positionen [id, x, y] */
export function computeArrangement(allNodes: AppNode[], edges: Edge[], mode: ArrangeMode = 'flow'): Array<[string, number, number]> {
  // Rahmen (M149) werden vom Aufräumen NIE bewegt — sie sind Hintergrund-Struktur
  const nodes = allNodes.filter((n) => n.type !== 'frame');
  if (nodes.length === 0) return [];
  if (mode === 'flowV') {
    return computeArrangement(nodes.map(transposeNode), edges, 'flow').map(([id, x, y]) => [id, y, x]);
  }
  // Metro-Grid (M142): Fluss-Layout, auf ein 40-px-Raster gerastet — zusammen
  // mit Winkel-Kanten (setzt der Aufräumen-Knopf) entsteht der U-Bahn-Plan-Look
  if (mode === 'metro') {
    return computeArrangement(nodes, edges, 'flow').map(([id, x, y]) => [id, Math.round(x / 40) * 40, Math.round(y / 40) * 40]);
  }
  if (mode === 'lanes') return arrangeLanes(nodes).moves;
  if (mode === 'timeline') return arrangeTimeline(nodes);
  if (mode === 'compact') return arrangeCompact(nodes);
  if (mode === 'quadrant') return arrangeQuadrant(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const comps = components(nodes, edges);

  // Themen-Cluster = Zusammenhangskomponenten (z. B. KI-Cluster: Titel-Bubble
  // ist mit ihren Karten verbunden). Sie bleiben in JEDEM Modus zusammen und
  // werden nur intern nach dem gewählten Modus gelegt.
  const clusters = comps
    .filter((c) => c.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((c) => c.map((id) => byId.get(id)!));
  const singles = comps.filter((c) => c.length === 1).map((c) => byId.get(c[0])!);
  const singleGroups = (): AppNode[][] => {
    const out: AppNode[][] = [];
    for (const type of TYPE_ORDER) {
      const g = singles.filter((n) => (n.type ?? '') === type);
      if (g.length) out.push(g);
    }
    const rest = singles.filter((n) => !TYPE_ORDER.includes(n.type ?? ''));
    if (rest.length) out.push(rest);
    return out;
  };

  const clusterBlock = (c: AppNode[]): Block =>
    mode === 'grid' ? layoutGrid(c)
    : mode === 'stack' ? layoutStack(c)
    : mode === 'circles' ? layoutCircle(c, edges)
    : layoutComponent(c.map((n) => n.id), byId, edges);
  const singleBlock = (g: AppNode[]): Block =>
    mode === 'stack' ? layoutStack(g)
    : mode === 'circles' ? layoutCircle(g)
    : layoutGrid(g);

  const blocks: Block[] = [];
  for (const c of clusters) blocks.push(clusterBlock(c));
  for (const g of singleGroups()) blocks.push(singleBlock(g));

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
