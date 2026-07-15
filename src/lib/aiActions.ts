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

/* ---------- Robustes JSON-Parsen ----------
   Gerade Gratis-/kleine Modelle liefern gern kaputtes JSON: Markdown-Zäune,
   Geschwätz drumherum, fehlende Kommas, abgeschnittene Antworten. Statt mit
   einer kryptischen Fehlermeldung aufzugeben (User-Screenshot: "Expected ','
   or ']' …"), wird hier repariert — und zur Not einmal strenger nachgefragt. */

/** Abgeschnittene Antwort: offenen String + offene Klammern schließen */
function autoClose(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (inStr && ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inStr ? `${s}"` : s;
  // hängenden Schlüssel ohne Wert bzw. hängendes Komma abschneiden
  out = out.replace(/"[^"\n]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

/** Reparatur-Kandidaten in aufsteigender Aggressivität */
function repairCandidates(core: string): string[] {
  const noTrail = core.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  const commas = noTrail // fehlende Kommas zwischen Array-Elementen
    .replace(/}(\s*){/g, '},$1{')
    .replace(/](\s*)\[/g, '],$1[')
    .replace(/"(\s*\n\s*)"/g, '",$1"');
  return [core, noTrail, commas, autoClose(noTrail), autoClose(commas)];
}

/** Erstes JSON-Objekt aus einer (evtl. geschwätzigen) LLM-Antwort schälen */
function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('Die KI hat kein verwertbares JSON geliefert.');
  const end = cleaned.lastIndexOf('}');
  const core = cleaned.slice(start, end > start ? end + 1 : undefined);
  for (const candidate of repairCandidates(core)) {
    try {
      return JSON.parse(candidate) as T;
    } catch { /* nächsten Kandidaten probieren */ }
  }
  throw new Error('Die KI hat kein verwertbares JSON geliefert.');
}

/** askAi + parseJson mit einem automatischen, strengeren zweiten Versuch */
async function askJson<T>(prompt: string): Promise<T> {
  const first = await askAi(prompt);
  try {
    return parseJson<T>(first);
  } catch { /* einmal strenger nachfragen */ }
  const second = await askAi(
    `${prompt}\n\nWICHTIG: Antworte AUSSCHLIESSLICH mit dem vollständigen, gültigen JSON-Objekt — keine Einleitung, kein Markdown, keine Kommentare, nichts danach.`,
  );
  try {
    return parseJson<T>(second);
  } catch {
    throw new Error('Die KI hat zweimal kein sauberes JSON geliefert — einfach nochmal versuchen (bei Gratis-Modellen passiert das öfter) oder in den Einstellungen ein stärkeres Modell wählen.');
  }
}

const SECTION_COLORS = ['#eef2ff', '#e6f7ec', '#fff4e0', '#ffe9ef', '#f3eeff', '#eef7ff'];

/** Themen-Cluster: Karten gruppieren, in Spalten anordnen, Sektions-Header setzen */
export async function aiCluster(nodes: AppNode[]): Promise<string> {
  const items = gather(nodes);
  if (items.length < 3) throw new Error('Zu wenig Inhalt zum Clustern (mind. 3 Karten mit Text).');
  const { clusters } = await askJson<{ clusters: Array<{ title: string; nodeIds: string[] }> }>(
    `Gruppiere die folgenden Whiteboard-Karten in 2-5 thematische Cluster. Jede Karte gehört in genau ein Cluster. Prägnante deutsche Cluster-Titel (max. 4 Wörter). Antworte NUR mit JSON, exakt in dieser Form: {"clusters":[{"title":"...","nodeIds":["..."]}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
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
  const { tasks } = await askJson<{ tasks: Array<{ text: string; due?: string }> }>(
    `Heute ist ${today}. Extrahiere aus den folgenden Karten alle konkreten Aufgaben/TODOs. Erkenne Termine/Fristen und setze sie als ISO-Datum (yyyy-mm-dd). Antworte NUR mit JSON: {"tasks":[{"text":"...","due":"yyyy-mm-dd"}]} — "due" nur, wenn wirklich ein Termin erkennbar ist.\n\nKarten:\n${JSON.stringify(items)}`,
  );
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
  const { edges } = await askJson<{ edges: Array<{ source: string; target: string; label?: string }> }>(
    `Welche der folgenden Karten hängen inhaltlich zusammen? Schlage 1-6 gerichtete Verbindungen vor, jede mit knappem deutschen Beziehungs-Label (z. B. "blockiert", "gehört zu", "liefert Input für"). Antworte NUR mit JSON: {"edges":[{"source":"id","target":"id","label":"..."}]}\n\nKarten:\n${JSON.stringify(items)}`,
  );
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
