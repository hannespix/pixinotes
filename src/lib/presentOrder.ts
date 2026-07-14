// Folien-Reihenfolge für den Präsentationsmodus: Verbundene Karten werden
// als Cluster erkannt und zusammenhängend präsentiert — innerhalb eines
// Clusters folgt die Reihenfolge den Pfeilen (Prozess-Logik!), Wurzeln zuerst.
// Unverbundene Karten bleiben in Lesereihenfolge (zeilenweise von links oben)
// und Cluster werden dort einsortiert, wo ihre erste Karte liegt.
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';

const ROW = 260;

function readingCmp(a: AppNode, b: AppNode): number {
  const rowA = Math.round(a.position.y / ROW);
  const rowB = Math.round(b.position.y / ROW);
  return rowA === rowB ? a.position.x - b.position.x : a.position.y - b.position.y;
}

export function presentationOrder(nodes: AppNode[], edges: Edge[]): AppNode[] {
  const present = [...nodes].filter((n) => n.type !== 'portal').sort(readingCmp);
  const byId = new Map(present.map((n) => [n.id, n]));

  // Adjazenz: gerichtet (Pfeil-Logik) + ungerichtet (Cluster-Findung)
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const linked = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!linked.has(a)) linked.set(a, new Set());
    linked.get(a)!.add(b);
  };
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    link(e.source, e.target);
    link(e.target, e.source);
  }

  const seen = new Set<string>();
  const out: AppNode[] = [];

  for (const n of present) {
    if (seen.has(n.id)) continue;

    // Cluster (Zusammenhangskomponente) einsammeln
    const comp: AppNode[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(byId.get(id)!);
      for (const nb of linked.get(id) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }

    if (comp.length === 1) { out.push(comp[0]); continue; }

    // Innerhalb des Clusters: den Pfeilen folgen (Tiefensuche ab den Wurzeln)
    const compIds = new Set(comp.map((c) => c.id));
    const visited = new Set<string>();
    const ordered: AppNode[] = [];
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      ordered.push(byId.get(id)!);
      const nexts = [...(outgoing.get(id) ?? []), ...(linked.get(id) ?? [])]
        .filter((x) => compIds.has(x) && !visited.has(x))
        .map((x) => byId.get(x)!)
        .sort(readingCmp);
      for (const nx of nexts) dfs(nx.id);
    };
    const roots = comp.filter((c) => (incoming.get(c.id) ?? 0) === 0).sort(readingCmp);
    for (const r of roots.length ? roots : [comp.slice().sort(readingCmp)[0]]) dfs(r.id);
    // Sicherheitsnetz für reine Zyklen
    for (const c of [...comp].sort(readingCmp)) dfs(c.id);
    out.push(...ordered);
  }

  return out;
}
