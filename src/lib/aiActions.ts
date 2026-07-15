// KI-Aktionen aufs ganze Board oder eine Auswahl: Clustern & Anordnen,
// Aufgaben/Termine extrahieren, Prozesse ableiten, Briefings, Verbindungen.
// Alle Aktionen sind NICHT destruktiv: sie legen neue Karten an bzw. ordnen
// nur Positionen — und jede läuft über die Undo-History.
import { askAi, textToBlocks } from './ai';
import { nodeToText } from './serialize';
import { makeNote } from './nodes';
import { useBoard } from '../store';
import { uid, type AppNode } from '../types';

interface Ctx { id: string; type: string; text: string }

function gather(nodes: AppNode[]): Ctx[] {
  return nodes
    .map((n) => ({ id: n.id, type: n.type ?? '?', text: nodeToText(n).trim().slice(0, 400) }))
    .filter((c) => c.text);
}

/** Erstes JSON-Objekt aus einer (evtl. geschwätzigen) LLM-Antwort schälen */
function parseJson<T>(raw: string): T {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Die KI hat kein verwertbares JSON geliefert.');
  return JSON.parse(m[0]) as T;
}

const SECTION_COLORS = ['#eef2ff', '#e6f7ec', '#fff4e0', '#ffe9ef', '#f3eeff', '#eef7ff'];

/** Themen-Cluster: Karten gruppieren, in Spalten anordnen, Sektions-Header setzen */
export async function aiCluster(nodes: AppNode[]): Promise<string> {
  const items = gather(nodes);
  if (items.length < 3) throw new Error('Zu wenig Inhalt zum Clustern (mind. 3 Karten mit Text).');
  const res = await askAi(
    `Gruppiere die folgenden Whiteboard-Karten in 2-5 thematische Cluster. Jede Karte gehört in genau ein Cluster. Prägnante deutsche Cluster-Titel (max. 4 Wörter). Antworte NUR mit JSON, exakt in dieser Form: {"clusters":[{"title":"...","nodeIds":["..."]}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const { clusters } = parseJson<{ clusters: Array<{ title: string; nodeIds: string[] }> }>(res);
  if (!clusters?.length) throw new Error('Keine Cluster erkannt.');

  const st = useBoard.getState();
  st.pushHistory();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const X0 = 80, Y0 = 140, GAP_X = 90, GAP_Y = 44, COLW = 380;
  const moves: Array<[string, number, number]> = [];
  clusters.forEach((c, i) => {
    const x = X0 + i * (COLW + GAP_X);
    st.addNode({
      id: uid(), type: 'shape', width: 320, height: 52,
      position: { x, y: Y0 - 80 },
      data: { shape: 'terminator', text: c.title || `Thema ${i + 1}`, color: SECTION_COLORS[i % SECTION_COLORS.length] },
    } as AppNode);
    let y = Y0;
    for (const nid of c.nodeIds ?? []) {
      const node = byId.get(nid);
      if (!node) continue;
      moves.push([nid, x, y]);
      y += (node.measured?.height ?? (node.height as number | undefined) ?? 170) + GAP_Y;
    }
  });
  if (moves.length === 0) throw new Error('Die KI hat keine bekannten Karten-IDs geliefert.');
  st.setNodePositions(moves);
  return `${clusters.length} Themen-Cluster angeordnet: ${clusters.map((c) => c.title).join(' · ')}`;
}

/** Aufgaben & Termine aus dem Inhalt ziehen → Kanban mit Fälligkeiten */
export async function aiTasks(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const today = new Date().toISOString().slice(0, 10);
  const res = await askAi(
    `Heute ist ${today}. Extrahiere aus den folgenden Karten alle konkreten Aufgaben/TODOs. Erkenne Termine/Fristen und setze sie als ISO-Datum (yyyy-mm-dd). Antworte NUR mit JSON: {"tasks":[{"text":"...","due":"yyyy-mm-dd"}]} — "due" nur, wenn wirklich ein Termin erkennbar ist.\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const { tasks } = parseJson<{ tasks: Array<{ text: string; due?: string }> }>(res);
  const clean = (tasks ?? []).filter((t) => t.text?.trim()).slice(0, 30);
  if (clean.length === 0) throw new Error('Keine Aufgaben im Inhalt erkannt.');
  const st = useBoard.getState();
  st.addNode({
    id: uid(), type: 'kanban', width: 430, position: pos,
    data: {
      title: '✨ Extrahierte Aufgaben',
      items: clean.map((t) => ({
        id: uid(), text: t.text.trim().slice(0, 140), col: 0,
        due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : undefined,
      })),
    },
  } as AppNode);
  const withDue = clean.filter((t) => t.due).length;
  return `${clean.length} Aufgabe(n) extrahiert${withDue ? `, davon ${withDue} mit Termin` : ''} — als Kanban aufs Board gelegt`;
}

/** Prozess/Workflow aus dem Inhalt ableiten → Mermaid-Flowchart */
export async function aiProcess(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const res = await askAi(
    `Leite aus den folgenden Karten den beschriebenen Ablauf/Workflow ab und modelliere ihn als Mermaid-Flowchart (flowchart TD, deutsche Beschriftung, max. 12 Knoten, Entscheidungen als {Raute}). Antworte NUR mit dem Mermaid-Code, ohne Markdown-Zaun.\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const code = res.replace(/```(mermaid)?/g, '').trim();
  if (!/^(flowchart|graph)\s/.test(code)) throw new Error('Die KI hat kein gültiges Flowchart geliefert.');
  const st = useBoard.getState();
  st.addNode({ id: uid(), type: 'mermaid', width: 420, height: 280, position: pos, data: { code } } as AppNode);
  return 'Workflow als Mermaid-Diagramm aufs Board gelegt';
}

/** Analytisches Briefing: Überblick, offene Punkte, nächste Schritte */
export async function aiBriefing(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const res = await askAi(
    `Erstelle aus den folgenden Projekt-Karten ein knappes analytisches Briefing auf Deutsch mit genau diesen drei Abschnitten (als Stichpunkte, mit "- " beginnend): Überblick, Offene Punkte, Nächste Schritte. Maximal 12 Zeilen gesamt.\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const st = useBoard.getState();
  st.addNode(makeNote(pos, { color: 'sky', blocks: textToBlocks('✨ Board-Briefing', res.trim()) }));
  return 'Briefing als Notiz aufs Board gelegt';
}

/** Sinnvolle Verbindungen zwischen den Karten vorschlagen und ziehen */
export async function aiEdges(nodes: AppNode[]): Promise<string> {
  const items = gather(nodes);
  if (items.length < 2) throw new Error('Mindestens 2 Karten mit Inhalt nötig.');
  const res = await askAi(
    `Welche der folgenden Karten hängen inhaltlich zusammen? Schlage 1-6 gerichtete Verbindungen vor, jede mit knappem deutschen Beziehungs-Label (z. B. "blockiert", "gehört zu", "liefert Input für"). Antworte NUR mit JSON: {"edges":[{"source":"id","target":"id","label":"..."}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
  const { edges } = parseJson<{ edges: Array<{ source: string; target: string; label?: string }> }>(res);
  const valid = new Set(items.map((i) => i.id));
  const st = useBoard.getState();
  const existing = new Set(
    useBoard.getState().boards.flatMap((b) => b.edges.map((e) => `${e.source}>${e.target}`)),
  );
  let created = 0;
  for (const e of (edges ?? []).slice(0, 8)) {
    if (!valid.has(e.source) || !valid.has(e.target) || e.source === e.target) continue;
    if (existing.has(`${e.source}>${e.target}`) || existing.has(`${e.target}>${e.source}`)) continue;
    st.addLabeledEdge(e.source, e.target, (e.label ?? '').slice(0, 30));
    created++;
  }
  if (created === 0) throw new Error('Keine neuen sinnvollen Verbindungen gefunden.');
  return `${created} Verbindung(en) mit Beziehungs-Label gezogen`;
}
