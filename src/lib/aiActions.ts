// KI-Aktionen aufs ganze Board oder eine Auswahl: Clustern & Anordnen,
// Aufgaben/Termine extrahieren, Prozesse ableiten, Briefings, Verbindungen.
// Alle Aktionen sind NICHT destruktiv: sie legen neue Karten an bzw. ordnen
// nur Positionen — und jede läuft über die Undo-History.
import { askAi, MD_HINT, mdToBlocks, prepImageForAi } from './ai';
import { nodeToText } from './serialize';
import { makeFrame, makeGantt, makeKanban, makeMermaid, makeNote, makeShape, makeTime, makeWeek } from './nodes';
import { mutedHistory, selectActiveBoard, useBoard } from '../store';
import { uid, type AppNode, type ShapeKind, type StickyColor } from '../types';
import { findFreeSpot } from './arrange';

/** Kollisionsfreie Zielposition für ein neues KI-Modul (M130): nie einfach
 *  über bestehende Karten legen — freien Platz nahe der Wunschposition suchen.
 *  Liest den Board-Stand FRISCH, damit auch gerade erst angelegte Karten
 *  desselben KI-Plans berücksichtigt werden. */
function freeSpot(pos: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  return findFreeSpot(selectActiveBoard(useBoard.getState()).nodes, pos, { w, h });
}

/** Abgeleitete Module mit ihren Quell-Karten verbinden (M131): Pfeil
 *  Quelle → neues Modul. Nur bei kleinen Quellmengen (Auswahl) — bei
 *  Board-weiten Aktionen entstünde sonst ein Pfeil-Spaghetti. */
const LINK_MAX_SOURCES = 4;
function linkSources(sources: AppNode[], targetId: string, label = ''): void {
  if (sources.length === 0 || sources.length > LINK_MAX_SOURCES) return;
  const st = useBoard.getState();
  for (const s of sources) {
    if (s.id !== targetId) st.addLabeledEdge(s.id, targetId, label);
  }
}

interface Ctx { id: string; type: string; text: string }

// Kontext-Deckel: große Boards würden sonst Prompts >100 KB erzeugen
// (Provider-Limits, Kosten, Timeouts) — Audit R6-K4
const CTX_MAX_NODES = 80;
const CTX_MAX_CHARS = 30_000;

function gather(nodes: AppNode[]): Ctx[] {
  const all = nodes
    .map((n) => ({ id: n.id, type: n.type ?? '?', text: nodeToText(n).trim().slice(0, 400) }))
    .filter((c) => c.text)
    .slice(0, CTX_MAX_NODES);
  let budget = CTX_MAX_CHARS;
  const out: Ctx[] = [];
  for (const c of all) {
    budget -= c.text.length + 60;
    if (budget < 0) break;
    out.push(c);
  }
  return out;
}

/* ---------- Bild-Karten als Foto-Anhänge (M199) ----------
   Screenshots (Einkaufszettel, Tafelbilder, Whiteboard-Fotos) werden der KI
   als echte Bilder mitgegeben — sie liest den Inhalt selbst, statt nur den
   Dateinamen zu sehen. Deckel: die 4 zuerst gefundenen Bilder (Payload/Kosten). */
const IMG_MAX = 4;
async function gatherImages(nodes: AppNode[]): Promise<string[]> {
  const srcs = nodes
    .filter((n) => n.type === 'image' && !n.archived)
    .map((n) => (n.data as { src?: string }).src)
    .filter((s): s is string => !!s)
    .slice(0, IMG_MAX);
  const prepped = await Promise.all(srcs.map(prepImageForAi));
  return prepped.filter((s): s is string => !!s);
}
const imgHint = (imgs: string[]): string => (imgs.length
  ? '\n\nDie angehängten Fotos sind die "image"-Karten (in derselben Reihenfolge). Lies ihren Inhalt (Text, Listen, Termine, Tabellen) direkt aus dem Bild und behandle ihn wie Kartentext.'
  : '');

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

/** Fehlende Kommas zwischen Elementen einfügen — String-bewusst: innerhalb
 *  von "…" wird NICHTS angefasst, sonst verfälscht die Reparatur Inhalte,
 *  die selbst `}{` o. Ä. enthalten (Audit R6-K5) */
function insertMissingCommas(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  const boundary = (i: number) => {
    // nächstes Nicht-Whitespace-Zeichen: beginnt dort ein neues Element?
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    return j < s.length && (s[j] === '{' || s[j] === '[' || s[j] === '"');
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (esc) { esc = false; continue; }
    if (inStr && ch === '\\') { esc = true; continue; }
    if (ch === '"') {
      inStr = !inStr;
      // gerade einen String GESCHLOSSEN → Element-Grenze prüfen
      if (!inStr && boundary(i)) out += ',';
      continue;
    }
    if (inStr) continue;
    if ((ch === '}' || ch === ']') && boundary(i)) out += ',';
  }
  return out;
}

/** Reparatur-Kandidaten in aufsteigender Aggressivität */
function repairCandidates(core: string): string[] {
  const noTrail = core.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  const commas = insertMissingCommas(noTrail);
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
async function askJson<T>(prompt: string, images: string[] = []): Promise<T> {
  const first = await askAi(prompt, images);
  try {
    return parseJson<T>(first);
  } catch { /* einmal strenger nachfragen */ }
  const second = await askAi(
    `${prompt}\n\nWICHTIG: Antworte AUSSCHLIESSLICH mit dem vollständigen, gültigen JSON-Objekt — keine Einleitung, kein Markdown, keine Kommentare, nichts danach.`,
    images,
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
  // Cluster-Raster nicht über UNBETEILIGTE Karten legen (M130): freien
  // Ursprung relativ zu den Karten suchen, die nicht mitgeclustert werden
  const GAP_X = 90, GAP_Y = 44, COLW = 380;
  const moved = new Set(nodes.map((n) => n.id));
  const others = selectActiveBoard(useBoard.getState()).nodes.filter((n) => !moved.has(n.id));
  const origin = findFreeSpot(others, { x: 80, y: 140 }, { w: clusters.length * (COLW + GAP_X), h: 680 });
  const X0 = origin.x, Y0 = origin.y;
  const moves: Array<[string, number, number]> = [];
  mutedHistory(() => clusters.forEach((c, i) => {
    const x = X0 + i * (COLW + GAP_X);
    const titleId = uid();
    st.addNode({
      id: titleId, type: 'shape', width: 320, height: 52,
      position: { x, y: Y0 - 80 },
      data: { shape: 'terminator', text: c.title || `Thema ${i + 1}`, color: SECTION_COLORS[i % SECTION_COLORS.length] },
    } as AppNode);
    let y = Y0;
    for (const nid of c.nodeIds ?? []) {
      const node = byId.get(nid);
      if (!node) continue;
      moves.push([nid, x, y]);
      y += (node.measured?.height ?? (node.height as number | undefined) ?? 170) + GAP_Y;
      // Titel-Bubble mit jeder Karte verbinden (dezente Linie ohne Pfeil) —
      // so bleibt das Thema beim Aufräumen als Cluster zusammen
      st.addLabeledEdge(titleId, nid, '', 'line');
    }
  }));
  if (moves.length === 0) throw new Error('Die KI hat keine bekannten Karten-IDs geliefert.');
  st.setNodePositions(moves);
  return `${clusters.length} Themen-Cluster angeordnet: ${clusters.map((c) => c.title).join(' · ')}`;
}

/** Aufgaben & Termine aus dem Inhalt ziehen → Kanban mit Fälligkeiten */
export async function aiTasks(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const today = new Date().toISOString().slice(0, 10);
  const { tasks } = await askJson<{ tasks: Array<{ text: string; due?: string }> }>(
    `Heute ist ${today}. Extrahiere aus den folgenden Karten alle konkreten Aufgaben/TODOs. Erkenne Termine/Fristen und setze sie als ISO-Datum (yyyy-mm-dd). Antworte NUR mit JSON: {"tasks":[{"text":"...","due":"yyyy-mm-dd"}]} — "due" nur, wenn wirklich ein Termin erkennbar ist.${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const clean = (tasks ?? []).filter((t) => t.text?.trim()).slice(0, 30);
  if (clean.length === 0) throw new Error('Keine Aufgaben im Inhalt erkannt.');
  const st = useBoard.getState();
  const kanbanId = uid();
  st.pushHistory();
  mutedHistory(() => {
    st.addNode({
      id: kanbanId, type: 'kanban', width: 430, position: freeSpot(pos, 430, 300),
      data: {
        title: '✨ Extrahierte Aufgaben',
        items: clean.map((t) => ({
          id: uid(), text: t.text.trim().slice(0, 140), col: 0,
          due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : undefined,
        })),
      },
    } as AppNode);
    linkSources(nodes, kanbanId);
  });
  const withDue = clean.filter((t) => t.due).length;
  return `${clean.length} Aufgabe(n) extrahiert${withDue ? `, davon ${withDue} mit Termin` : ''} — als Kanban aufs Board gelegt`;
}

/** Prozess/Workflow aus dem Inhalt ableiten → Mermaid-Flowchart */
export async function aiProcess(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const res = await askAi(
    `Leite aus den folgenden Karten den beschriebenen Ablauf/Workflow ab und modelliere ihn als Mermaid-Flowchart (flowchart TD, deutsche Beschriftung, max. 12 Knoten, Entscheidungen als {Raute}). Antworte NUR mit dem Mermaid-Code, ohne Markdown-Zaun.${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const code = res.replace(/```(mermaid)?/g, '').trim();
  if (!/^(flowchart|graph)\s/.test(code)) throw new Error('Die KI hat kein gültiges Flowchart geliefert.');
  const st = useBoard.getState();
  // fitOnLoad (M122): Karte passt sich nach dem ersten Render der Diagramm-
  // größe an — nichts wird abgeschnitten
  const mermaidId = uid();
  st.pushHistory();
  mutedHistory(() => {
    st.addNode({ id: mermaidId, type: 'mermaid', width: 420, height: 280, position: freeSpot(pos, 420, 280), data: { code, fitOnLoad: true } } as AppNode);
    linkSources(nodes, mermaidId);
  });
  return 'Workflow als Mermaid-Diagramm aufs Board gelegt';
}

/** Analytisches Briefing: Überblick, offene Punkte, nächste Schritte */
export async function aiBriefing(nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const items = gather(nodes);
  if (items.length === 0) throw new Error('Keine Inhalte gefunden.');
  const imgs = await gatherImages(nodes);
  const res = await askAi(
    `Erstelle aus den folgenden Projekt-Karten ein knappes analytisches Briefing auf Deutsch mit genau diesen drei Abschnitten (als "## "-Überschriften): Überblick, Offene Punkte, Nächste Schritte. Maximal 12 Inhaltszeilen gesamt. ${MD_HINT}${imgHint(imgs)}\n\nKarten:\n${JSON.stringify(items)}`,
    imgs,
  );
  const st = useBoard.getState();
  const briefNote = makeNote(freeSpot(pos, 280, 340), { color: 'sky', blocks: await mdToBlocks('✨ Board-Briefing', res.trim()) });
  st.pushHistory();
  mutedHistory(() => {
    st.addNode(briefNote);
    linkSources(nodes, briefNote.id);
  });
  return 'Briefing als Notiz aufs Board gelegt';
}

/** Wochenbriefing aus den offenen Aufgaben (Aufgaben-Zentrale, M115) */
export async function aiWeekPlan(
  tasks: Array<{ text: string; due?: string; who?: string; prio?: number; boardName: string }>,
  pos: { x: number; y: number },
): Promise<string> {
  if (tasks.length === 0) throw new Error('Keine offenen Aufgaben gefunden.');
  const items = tasks.slice(0, 60).map((t) => ({
    aufgabe: t.text.slice(0, 160),
    frist: t.due,
    person: t.who,
    prio: t.prio === 1 ? 'hoch' : t.prio === 2 ? 'mittel' : t.prio === 3 ? 'niedrig' : undefined,
    board: t.boardName,
  }));
  const res = await askAi(
    `Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}. `
    + 'Erstelle aus den folgenden offenen Aufgaben ein knappes Wochen-Briefing auf Deutsch mit genau diesen '
    + '"## "-Abschnitten: Diese Woche zuerst, Fristen im Blick, Bei anderen nachhaken, Empfehlung. '
    + 'Alle konkret erledigbaren Aufgaben als Checklisten-Punkte "- [ ] …" (die Empfehlung als normale Stichpunkte). '
    + `Priorisiere nach Frist und Priorität, nenne Personen beim Namen. Maximal 16 Inhaltszeilen gesamt. ${MD_HINT}\n\nAufgaben:\n`
    + JSON.stringify(items),
  );
  const st = useBoard.getState();
  st.addNode(makeNote(freeSpot(pos, 280, 380), { color: 'sky', blocks: await mdToBlocks('🗓️ Wochenplan', res.trim()) }));
  return 'Wochenplan als Notiz aufs Board gelegt';
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
  st.pushHistory();
  mutedHistory(() => {
    for (const e of (edges ?? []).slice(0, 8)) {
      if (!valid.has(e.source) || !valid.has(e.target) || e.source === e.target) continue;
      if (existing.has(`${e.source}>${e.target}`) || existing.has(`${e.target}>${e.source}`)) continue;
      st.addLabeledEdge(e.source, e.target, (e.label ?? '').slice(0, 30));
      created++;
    }
  });
  if (created === 0) throw new Error('Keine neuen sinnvollen Verbindungen gefunden.');
  return `${created} Verbindung(en) mit Beziehungs-Label gezogen`;
}

/** Notiz-Politur: verbesserte Fassung als NEUE Notiz daneben (Original bleibt) */
export async function aiPolish(nodes: AppNode[]): Promise<string> {
  const note = nodes.find((n) => n.type === 'note');
  if (!note) throw new Error('Bitte eine Notiz auswählen.');
  const text = nodeToText(note);
  if (!text.trim()) throw new Error('Die Notiz ist leer.');
  const answer = await askAi(
    `Verbessere den folgenden Notiztext: korrigiere Rechtschreibung und Grammatik, straffe Formulierungen, behalte Bedeutung, Sprache (Deutsch) und Aufzählungsstruktur bei. Du darfst Markdown nutzen (## Überschriften, **fett**, "- " Punkte, "- [ ] " Checklisten). Antworte NUR mit dem verbesserten Text.\n\n${text.slice(0, 6000)}`,
  );
  const st = useBoard.getState();
  const suggestion = makeNote(
    freeSpot({ x: note.position.x + ((note.width as number | undefined) ?? 280) + 40, y: note.position.y }, 280, 320),
    { color: 'mint', blocks: await mdToBlocks('✨ Vorschlag', answer) },
  );
  st.pushHistory();
  mutedHistory(() => {
    st.addNode(suggestion);
    st.addLabeledEdge(note.id, suggestion.id, 'Vorschlag');
  });
  return 'Verbesserter Text liegt als Vorschlag daneben — das Original bleibt unangetastet';
}

/* ---------- Freitext-Kommando: die KI darf (fast) alles ---------- */

interface AiOp {
  op: string;
  id?: string;
  ids?: string[];
  title?: string;
  text?: string;
  color?: string;
  code?: string;
  shape?: string;
  source?: string;
  target?: string;
  label?: string;
  /** M131: id einer bestehenden Karte, aus der dieses neue Modul abgeleitet
   *  ist — die App zieht dann automatisch einen Pfeil Quelle → neues Modul */
  from?: string;
  items?: Array<{ text?: string; due?: string }>;
  rows?: Array<{ name?: string; start?: string; end?: string; who?: string }>;
  /** M165: Wochenplan-Blöcke (day 0 = Montag, start/dur in Minuten) */
  days?: number;
  entries?: Array<{ day?: number; start?: number; dur?: number; text?: string; who?: string }>;
  /** M165: Rahmen — Name + ids der Karten, um die er gelegt wird */
  name?: string;
  around?: string[];
}

const STICKY = new Set(['yellow', 'pink', 'mint', 'sky', 'white']);
const SHAPES = new Set(['process', 'decision', 'terminator']);

/**
 * Freitext-Anweisung ausführen: „Erstelle …", „Verbessere …", „Verbinde …".
 * Die KI liefert einen Operationsplan (JSON), der validiert und über die
 * Undo-History ausgeführt wird — Strg+Z macht ALLES auf einmal rückgängig.
 */
export async function aiCommand(instruction: string, nodes: AppNode[], pos: { x: number; y: number }): Promise<string> {
  const wish = instruction.trim();
  if (!wish) throw new Error('Bitte zuerst eine Anweisung eingeben.');
  const items = gather(nodes);
  const imgs = await gatherImages(nodes);
  const { summary, ops } = await askJson<{ summary?: string; ops: AiOp[] }>(
    `Du bist der Assistent eines Whiteboard-Tools (Karten auf einer Leinwand). Setze den Wunsch des Nutzers als Operationsplan um.

Wunsch: "${wish}"

Vorhandene Karten (id, type, text):
${JSON.stringify(items)}

Antworte NUR mit JSON: {"summary":"1 kurzer deutscher Satz, was du getan hast","ops":[...]}
Erlaubte Operationen (max. 15):
{"op":"note","title":"...","text":"Markdown: '## ' Überschriften, **fett**, '- ' Punkte, '- [ ] ' Checklisten","color":"yellow|pink|mint|sky|white","from":"<optional: id der Quell-Karte>"}
{"op":"kanban","title":"...","items":[{"text":"...","due":"yyyy-mm-dd"}],"from":"<optional>"}
{"op":"gantt","title":"...","rows":[{"name":"...","start":"yyyy-mm-dd","end":"yyyy-mm-dd","who":"Name"}],"from":"<optional>"}
{"op":"mermaid","code":"flowchart TD\\n  A[Start] --> B[Ende]","from":"<optional>"}
{"op":"shape","shape":"process|decision|terminator","text":"...","from":"<optional>"}
{"op":"week","title":"...","days":5|7,"entries":[{"day":0,"start":540,"dur":90,"text":"...","who":"optional"}],"from":"<optional>"} (Stunden-/Wochen-/Dienstplan: day 0=Montag … 6=Sonntag, start/dur in MINUTEN seit Mitternacht)
{"op":"time","title":"...","from":"<optional>"} (Arbeitszeiterfassungs-Karte mit Start/Stop — Einträge macht der Nutzer selbst)
{"op":"frame","name":"...","around":["<id>","<id>"]} (benannter Rahmen-Bereich UM die genannten vorhandenen Karten — gruppiert sie)
{"op":"edit_note","id":"<existierende Notiz-id>","text":"KOMPLETTER neuer Inhalt als Markdown; erste Zeile = '## Überschrift'"}
{"op":"edit_title","id":"<id>","title":"..."} (für Kanban/Zeitplan-Titel oder Form-Text)
{"op":"add_tickets","id":"<Kanban-id>","items":[{"text":"...","due":"yyyy-mm-dd"}]}
{"op":"edge","source":"<id>","target":"<id>","label":"kurzes Label"}
{"op":"delete","ids":["<id>"]} (NUR wenn der Nutzer ausdrücklich löschen will)
Modulwahl: Prozesse/Abläufe → mermaid · Aufgabenlisten → kanban · Phasen/Zeiträume/Termine → gantt · Stundenplan/Wochenplan/Dienstplan → week · Arbeitszeit erfassen → time · Karten thematisch gruppieren → frame · Wissen/Text → note (Markdown voll ausnutzen, erledigbare Punkte als '- [ ] ' Checklisten).
Regeln: verwende nur existierende ids aus der Liste; bei "verbessern/umschreiben" nutze edit_note mit dem vollständigen neuen Text; erfinde keine Fakten. Leitest du ein neues Modul aus dem Inhalt einer bestehenden Karte ab (oder bezieht es sich klar auf sie), setze deren id als "from" — das Board verbindet beide dann automatisch mit einem Pfeil.${imgHint(imgs)}`,
    imgs,
  );

  const plan = (ops ?? []).slice(0, 15);
  if (plan.length === 0) throw new Error('Die KI hat keine ausführbaren Schritte geliefert — Anweisung bitte konkreter formulieren.');

  const st = useBoard.getState();
  const known = new Map(nodes.map((n) => [n.id, n]));

  // Markdown VOR dem synchronen Ausführen parsen (mdToBlocks ist async, M117)
  const preBlocks = new Map<AiOp, unknown[]>();
  for (const o of plan) {
    if (o.op === 'note') {
      const md = [o.title?.trim() ? `### ${o.title.trim()}` : '', o.text ?? ''].filter(Boolean).join('\n\n');
      if (md) preBlocks.set(o, await mdToBlocks('', md));
    } else if (o.op === 'edit_note' && o.text?.trim()) {
      preBlocks.set(o, await mdToBlocks('', o.text));
    }
  }

  st.pushHistory();

  let done = 0;
  let editedNote = false;
  let y = pos.y;
  const place = (h: number) => {
    // Kollisionsfrei (M130): freien Platz suchen — dank frischem Store-Stand
    // stapeln sich auch mehrere Module EINES Plans sauber untereinander
    const p = freeSpot({ x: pos.x, y }, 420, h);
    y = p.y + h + 40;
    return p;
  };

  // EIN Snapshot für den ganzen Plan (oben gesichert): innere Mutatoren
  // (addNode/removeNodes/addLabeledEdge) pushen keine eigenen Einträge
  // M131: „from" an Erzeugungs-Ops → Pfeil von der Quell-Karte zum neuen Modul
  const linkFrom = (o: AiOp, newId: string) => {
    if (o.from && known.has(o.from)) st.addLabeledEdge(o.from, newId, '');
  };
  mutedHistory(() => {
  for (const o of plan) {
    switch (o.op) {
      case 'note': {
        const blocks = preBlocks.get(o);
        if (!blocks || blocks.length === 0) break;
        const color = STICKY.has(o.color ?? '') ? (o.color as StickyColor) : undefined;
        const node = makeNote(place(180), { color, blocks: blocks as never[] });
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'gantt': {
        const iso = /^\d{4}-\d{2}-\d{2}$/;
        const rows = (o.rows ?? [])
          .filter((r) => r.name?.trim() && iso.test(r.start ?? '') && iso.test(r.end ?? ''))
          .slice(0, 20)
          .map((r) => ({
            id: uid(), name: r.name!.trim().slice(0, 80),
            start: r.start!, end: r.end! >= r.start! ? r.end! : r.start!,
            who: r.who?.trim().slice(0, 40) || undefined,
          }));
        if (rows.length === 0) break;
        const node = makeGantt(place(240));
        (node.data as { title: string; rows: unknown[] }).title = (o.title ?? '📅 Zeitplan').slice(0, 60);
        (node.data as { rows: unknown[] }).rows = rows;
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'kanban': {
        const node = makeKanban(place(220), (o.title ?? 'Aufgaben').slice(0, 60));
        (node.data as { items: unknown[] }).items = (o.items ?? [])
          .filter((t) => t.text?.trim())
          .slice(0, 30)
          .map((t) => ({
            id: uid(), text: t.text!.trim().slice(0, 140), col: 0,
            due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : undefined,
          }));
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'mermaid': {
        const code = (o.code ?? '').replace(/```(mermaid)?/g, '').trim();
        if (!code) break;
        const node = makeMermaid(place(260));
        (node.data as { code: string; fitOnLoad?: boolean }).code = code;
        (node.data as { fitOnLoad?: boolean }).fitOnLoad = true; // Karte ans Diagramm anpassen (M122)
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'shape': {
        const node = makeShape(place(90), SHAPES.has(o.shape ?? '') ? (o.shape as ShapeKind) : 'process');
        (node.data as { text: string }).text = (o.text ?? '').slice(0, 60);
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'week': {
        // Wochen-/Stundenplan (M165): Blöcke validieren, Zeitfenster ableiten
        const days = o.days === 7 ? 7 : 5;
        const entries = (o.entries ?? [])
          .filter((e) => e.text?.trim()
            && Number.isFinite(e.day) && e.day! >= 0 && e.day! < days
            && Number.isFinite(e.start) && e.start! >= 0 && e.start! < 1440)
          .slice(0, 40)
          .map((e) => ({
            id: uid(), day: e.day!, start: Math.round(e.start! / 30) * 30,
            dur: Math.min(720, Math.max(30, Math.round((e.dur ?? 60) / 30) * 30)),
            text: e.text!.trim().slice(0, 80),
            who: e.who?.trim().slice(0, 30) || undefined,
          }));
        const node = makeWeek(place(440));
        const minStart = Math.min(8 * 60, ...entries.map((e) => e.start));
        const maxEnd = Math.max(17 * 60, ...entries.map((e) => e.start + e.dur));
        Object.assign(node.data, {
          title: (o.title ?? 'Wochenplan').slice(0, 60),
          days,
          from: Math.max(0, Math.floor(minStart / 60) * 60),
          to: Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60),
          entries,
        });
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'time': {
        const node = makeTime(place(380));
        (node.data as { title: string }).title = (o.title ?? 'Zeiterfassung').slice(0, 60);
        st.addNode(node);
        linkFrom(o, node.id);
        done++;
        break;
      }
      case 'frame': {
        // Rahmen UM vorhandene Karten legen (M165) — Bounding-Box + Luft
        const members = (o.around ?? []).map((mid) => known.get(mid)).filter((n): n is AppNode => !!n && n.type !== 'frame');
        if (members.length === 0) break;
        const sx = Math.min(...members.map((n) => n.position.x));
        const sy = Math.min(...members.map((n) => n.position.y));
        const ex = Math.max(...members.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 260)));
        const ey = Math.max(...members.map((n) => n.position.y + (n.height ?? n.measured?.height ?? 160)));
        const node = makeFrame({ x: sx - 30, y: sy - 56 }, (o.name ?? o.title ?? 'Bereich').slice(0, 50));
        node.width = ex - sx + 60;
        node.height = ey - sy + 86;
        st.addNode(node);
        done++;
        break;
      }
      case 'edit_note': {
        const target = known.get(o.id ?? '');
        const blocks = preBlocks.get(o);
        if (!target || target.type !== 'note' || !blocks || blocks.length === 0) break;
        st.updateNodeData(target.id, { blocks });
        editedNote = true;
        done++;
        break;
      }
      case 'edit_title': {
        const target = known.get(o.id ?? '');
        if (!target || !o.title?.trim()) break;
        const title = o.title.trim().slice(0, 80);
        if (target.type === 'kanban' || target.type === 'gantt' || target.type === 'week' || target.type === 'time') st.updateNodeData(target.id, { title });
        else if (target.type === 'shape') st.updateNodeData(target.id, { text: title });
        else if (target.type === 'frame' || target.type === 'htmlapp') st.updateNodeData(target.id, { name: title });
        else break;
        done++;
        break;
      }
      case 'add_tickets': {
        const target = known.get(o.id ?? '');
        if (!target || target.type !== 'kanban') break;
        const fresh = (o.items ?? [])
          .filter((t) => t.text?.trim())
          .slice(0, 30)
          .map((t) => ({
            id: uid(), text: t.text!.trim().slice(0, 140), col: 0,
            due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : undefined,
          }));
        if (fresh.length === 0) break;
        const existing = (target.data as { items?: unknown[] }).items ?? [];
        st.updateNodeData(target.id, { items: [...existing, ...fresh] });
        done++;
        break;
      }
      case 'edge': {
        if (!known.has(o.source ?? '') || !known.has(o.target ?? '') || o.source === o.target) break;
        st.addLabeledEdge(o.source!, o.target!, (o.label ?? '').slice(0, 30));
        done++;
        break;
      }
      case 'delete': {
        const ids = (o.ids ?? []).filter((id) => known.has(id));
        if (ids.length === 0) break;
        st.removeNodes(ids);
        done++;
        break;
      }
      default:
        break;
    }
  }
  });

  if (done === 0) throw new Error('Kein Schritt war ausführbar (unbekannte ids?) — Anweisung bitte konkreter formulieren.');
  if (editedNote) {
    // BlockNote liest Inhalte nur beim Mount — geänderte Notizen brauchen
    // einen Board-Remount, sonst zeigt der Editor den alten Text. Der
    // History-Eintrag wird markiert, damit auch Undo/Redo neu mountet.
    useBoard.setState((s) => ({
      importEpoch: s.importEpoch + 1,
      past: s.past.map((e, i) => (i === s.past.length - 1 ? { ...e, remount: true } : e)),
    }));
  }
  return `${summary?.trim() || 'Anweisung umgesetzt'} (${done} Schritt${done > 1 ? 'e' : ''} — Strg+Z macht alles rückgängig)`;
}
