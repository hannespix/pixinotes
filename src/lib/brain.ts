// M204: Der Gehirn-Kern — ein semantischer Index über ALLE Karten.
//
// Jede Karte wird als Embedding-Vektor gespeichert (IndexedDB, mit Inhalts-
// Hash — nur Geändertes wird neu berechnet). Darauf laufen die „Brain
// Functions": Suche nach BEDEUTUNG (Strg+K) und „Verwandte Karten".
//
// Drei Anbieter, alle über eine Abstraktion:
//  · ollama   — nomic-embed-text über die bestehende Ollama-Anbindung:
//               alles bleibt auf dem eigenen Rechner (Standard, wenn Ollama
//               als KI gewählt ist)
//  · browser  — Transformers.js (Hugging Face) direkt im Browser: Modell
//               (~30 MB) wird EINMAL geladen und im Browser-Cache behalten,
//               danach offline. Der Weg für iPhone/iPad ohne Ollama.
//  · cloud    — OpenAI/OpenRouter-Embeddings über die vorhandenen Schlüssel.
import { idbDel, idbGet, idbKeys, idbSet } from './syncFolder';
import { nodeToText } from './serialize';
import { askAi } from './ai';
import { mutedHistory, useBoard } from '../store';

const PREFIX = 'brain:v1:';
const KEY = (boardId: string, nodeId: string) => `${PREFIX}${boardId}:${nodeId}`;

export interface BrainEntry {
  boardId: string;
  nodeId: string;
  boardName: string;
  title: string;
  hash: number;
  vec: number[];
}
export interface BrainHit extends BrainEntry { score: number }

export type BrainProvider = 'auto' | 'ollama' | 'browser' | 'cloud';
export interface BrainSettings { on: boolean; provider: BrainProvider }

const hashText = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
};

const normalize = (v: number[]): number[] => {
  const len = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / len);
};
const dot = (a: number[], b: number[]): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
};

/** Welcher Anbieter gilt effektiv? 'auto' folgt der KI-Einstellung. */
export function brainProvider(): 'ollama' | 'browser' | 'cloud' {
  const st = useBoard.getState();
  const wanted = st.brain.provider;
  if (wanted !== 'auto') return wanted;
  if (st.ai.provider === 'ollama' && st.ai.baseUrl) return 'ollama';
  if ((st.ai.provider === 'openai' || st.ai.provider === 'openrouter') && st.ai.apiKey) return 'cloud';
  return 'browser';
}

/* ---------- Embeddings je Anbieter ---------- */
// Transformers.js wird bewusst NICHT gebündelt (hielte die Ein-Datei-App
// schlank) — sondern bei Bedarf einmalig vom CDN geladen; das Modell landet
// im Browser-Cache und funktioniert danach offline.
type TfPipe = (texts: string[], opts: unknown) => Promise<{ tolist: () => number[][] }>;
let tfPipe: TfPipe | null = null;
const TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.2/dist/transformers.min.js';
async function browserPipe(): Promise<TfPipe> {
  if (tfPipe) return tfPipe;
  const mod = await import(/* @vite-ignore */ TF_CDN) as {
    pipeline: (task: string, model: string, opts: unknown) => Promise<TfPipe>;
  };
  tfPipe = await mod.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
  return tfPipe;
}

async function embed(texts: string[], kind: 'doc' | 'query'): Promise<number[][]> {
  const ai = useBoard.getState().ai;
  const provider = brainProvider();
  if (provider === 'ollama') {
    const res = await fetch(`${ai.baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama-Embeddings: HTTP ${res.status} — Modell holen mit: ollama pull nomic-embed-text`);
    const data = await res.json();
    return (data.embeddings as number[][]).map(normalize);
  }
  if (provider === 'cloud') {
    const base = ai.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
    });
    if (!res.ok) throw new Error(`Embeddings: HTTP ${res.status}`);
    const data = await res.json();
    return (data.data as Array<{ embedding: number[] }>).map((d) => normalize(d.embedding));
  }
  // browser (Transformers.js): E5 erwartet die passage:/query:-Präfixe
  const pipe = await browserPipe();
  const out = await pipe(texts.map((t) => `${kind === 'query' ? 'query' : 'passage'}: ${t}`), { pooling: 'mean', normalize: true });
  return out.tolist();
}

/* ---------- Index ---------- */
let mem: Map<string, BrainEntry> | null = null;
let loading: Promise<void> | null = null;
let running = false;
let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
let lastError = '';

async function loadIndex(): Promise<void> {
  if (mem) return;
  if (!loading) {
    loading = (async () => {
      const m = new Map<string, BrainEntry>();
      try {
        const keys = (await idbKeys()).filter((k): k is string => typeof k === 'string' && k.startsWith(PREFIX));
        const entries = await Promise.all(keys.map((k) => idbGet<BrainEntry>(k)));
        entries.forEach((e, i) => { if (e) m.set(keys[i], e); });
      } catch { /* leerer Index ist ok */ }
      mem = m;
    })();
  }
  await loading;
}

const emit = (state: 'idle' | 'busy' | 'fehler') => {
  window.dispatchEvent(new CustomEvent('pixinotes:brain', {
    detail: { state, indexed: mem?.size ?? 0, error: lastError },
  }));
};

export function brainStatus(): { on: boolean; provider: string; indexed: number; busy: boolean; error: string } {
  return {
    on: useBoard.getState().brain.on,
    provider: brainProvider(),
    indexed: mem?.size ?? 0,
    busy: running,
    error: lastError,
  };
}

/** Karten-Text fürs Embedding: Titelzeile + Inhalt, gedeckelt (Kosten/Tempo) */
function cardText(nodeText: string): { title: string; text: string } {
  const title = (nodeText.split('\n').find((l) => l.trim()) ?? '').slice(0, 80);
  return { title, text: nodeText.slice(0, 1200) };
}

/** Index mit dem Board-Stand abgleichen — nur Neues/Geändertes wird berechnet */
/**
 * M220: Welche Boards gehören zum Gehirn?
 *
 * Bereiche lassen sich einzeln abschalten („Sub-Brains") — typischer Fall:
 * Private Notizen sollen nicht in dienstlichen KI-Antworten auftauchen. Ein
 * abgeschalteter Bereich wird nicht bloß aus den Ergebnissen gefiltert:
 * syncBrainIndex räumt Einträge weg, die nicht mehr gewünscht sind, also
 * verschwinden auch die bereits berechneten Vektoren aus dem Speicher.
 */
export function brainBoardIds(st = useBoard.getState()): Set<string> {
  const off = new Set(st.brainOffSpaces ?? []);
  const drin = new Set<string>();
  for (const sp of st.spaces) {
    if (off.has(sp.id)) continue;
    for (const p of sp.projects) for (const id of p.boardIds) drin.add(id);
  }
  // Boards ohne Projekt-Zuordnung (frisch angelegt) bleiben dabei
  for (const b of st.boards) {
    const zugeordnet = st.spaces.some((sp) => sp.projects.some((p) => p.boardIds.includes(b.id)));
    if (!zugeordnet) drin.add(b.id);
  }
  return drin;
}

/** Bereichs-Name eines Boards — für die Anzeige im Puls und in Quellen */
export function spaceOfBoard(boardId: string, st = useBoard.getState()): string | null {
  for (const sp of st.spaces) {
    if (sp.projects.some((p) => p.boardIds.includes(boardId))) return sp.name;
  }
  return null;
}

export async function syncBrainIndex(): Promise<void> {
  const st = useBoard.getState();
  if (!st.brain.on || running) return;
  running = true;
  lastError = '';
  try {
    await loadIndex();
    const m = mem!;
    const want = new Map<string, { boardId: string; nodeId: string; boardName: string; title: string; text: string; hash: number }>();
    const imGehirn = brainBoardIds(st);
    for (const b of st.boards) {
      if (!imGehirn.has(b.id)) continue; // M220: abgeschalteter Bereich
      for (const n of b.nodes) {
        if (n.archived) continue;
        const raw = nodeToText(n).trim();
        if (!raw) continue;
        const { title, text } = cardText(raw);
        want.set(KEY(b.id, n.id), { boardId: b.id, nodeId: n.id, boardName: b.name, title, text, hash: hashText(text) });
      }
    }
    // Verwaiste Einträge raus (gelöschte/archivierte Karten)
    for (const key of [...m.keys()]) {
      if (!want.has(key)) { m.delete(key); void idbDel(key); }
    }
    const todo = [...want.entries()].filter(([key, w]) => m.get(key)?.hash !== w.hash);
    if (todo.length > 0) {
      emit('busy');
      const BATCH = 8;
      for (let i = 0; i < todo.length; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const vecs = await embed(chunk.map(([, w]) => w.text), 'doc');
        await Promise.all(chunk.map(async ([key, w], j) => {
          const entry: BrainEntry = { boardId: w.boardId, nodeId: w.nodeId, boardName: w.boardName, title: w.title, hash: w.hash, vec: vecs[j] };
          m.set(key, entry);
          await idbSet(key, entry);
        }));
        emit('busy');
      }
    }
    emit('idle');
  } catch (e) {
    lastError = (e as Error).message;
    emit('fehler');
  } finally {
    running = false;
  }
}

/** Index komplett verwerfen und neu aufbauen (Anbieterwechsel!) */
export async function rebuildBrainIndex(): Promise<void> {
  await loadIndex();
  for (const key of [...(mem?.keys() ?? [])]) void idbDel(key);
  mem = new Map();
  await syncBrainIndex();
}

/** Start: Erst-Indexierung kurz nach dem Boot, danach nach Änderungen (entprellt) */
export function initBrain(): void {
  setTimeout(() => void syncBrainIndex(), 3500);
  useBoard.subscribe((s, prev) => {
    if (!s.brain.on || s.boards === prev.boards) return;
    if (dirtyTimer) clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => void syncBrainIndex(), 12_000);
  });
  // M220: Ein Bereich wurde zu-/abgeschaltet — SOFORT abgleichen, nicht erst
  // nach der üblichen Wartezeit. Wer „privat" abschaltet, will nicht zwölf
  // Sekunden lang hoffen, dass die Vektoren wirklich verschwinden.
  window.addEventListener('pixinotes:brain-scope', () => {
    if (dirtyTimer) clearTimeout(dirtyTimer);
    void syncBrainIndex();
  });
}

/* ---------- Abfragen ---------- */

/** Suche nach BEDEUTUNG: findet „Betreuungszeiten", wenn man „Kita" tippt */
export async function brainSearch(query: string, k = 6): Promise<BrainHit[]> {
  await loadIndex();
  if (!mem || mem.size === 0) return [];
  const [qv] = await embed([query], 'query');
  return [...mem.values()]
    .map((e) => ({ ...e, score: dot(qv, e.vec) }))
    .filter((h) => h.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/* ---------- M207: Gehirn-Puls — Themen, Knotenpunkte, Digest ----------
   Drei Auswertungen ÜBER den Index, alle rein rechnerisch (keine KI-Kosten):
   Themen-Inseln (Clustering), Knotenpunkte (wer hängt mit vielem zusammen)
   und daraus ein täglicher Kurzbericht. */
export interface TopicCluster { title: string; cards: BrainHit[]; boards: string[] }

/** Themen-Inseln: gierige Clusterung über Kosinus-Ähnlichkeit — die Karte mit
 *  den meisten nahen Nachbarn gründet die Insel und gibt ihr den Namen. */
export async function clusterTopics(minSize = 3, threshold = 0.55): Promise<TopicCluster[]> {
  await loadIndex();
  if (!mem || mem.size < minSize) return [];
  const all = [...mem.values()];
  const used = new Set<string>();
  const key = (e: BrainEntry) => `${e.boardId}:${e.nodeId}`;
  const clusters: TopicCluster[] = [];
  // Nachbarschaften einmal vorberechnen
  const near = new Map<string, BrainEntry[]>();
  for (const a of all) {
    near.set(key(a), all.filter((b) => b !== a && dot(a.vec, b.vec) >= threshold));
  }
  // Immer die dichteste noch freie Karte als Kern nehmen
  for (;;) {
    let seed: BrainEntry | null = null;
    let seedCount = -1;
    for (const e of all) {
      if (used.has(key(e))) continue;
      const n = (near.get(key(e)) ?? []).filter((x) => !used.has(key(x))).length;
      if (n > seedCount) { seedCount = n; seed = e; }
    }
    if (!seed || seedCount + 1 < minSize) break;
    const members = [seed, ...(near.get(key(seed)) ?? []).filter((x) => !used.has(key(x)))];
    members.forEach((m) => used.add(key(m)));
    clusters.push({
      title: seed.title || 'Thema',
      cards: members.map((m) => ({ ...m, score: dot(seed!.vec, m.vec) })).sort((a, b) => b.score - a.score),
      boards: [...new Set(members.map((m) => m.boardName))],
    });
  }
  return clusters;
}

/** Knotenpunkte: Boards mit den meisten echten Verbindungen (Portale/Wikilinks) */
export function hubBoards(max = 3): Array<{ boardId: string; name: string; degree: number }> {
  const st = useBoard.getState();
  const deg = new Map<string, number>();
  const imGehirn = brainBoardIds(st);
  for (const b of st.boards) {
    if (!imGehirn.has(b.id)) continue; // M220
    for (const n of b.nodes) {
      if (n.type !== 'portal') continue;
      const target = (n.data as { boardId?: string }).boardId;
      if (!target) continue;
      deg.set(b.id, (deg.get(b.id) ?? 0) + 1);
      deg.set(target, (deg.get(target) ?? 0) + 1);
    }
  }
  return [...deg.entries()]
    .map(([boardId, degree]) => ({ boardId, degree, name: st.boards.find((b) => b.id === boardId)?.name ?? '?' }))
    .filter((h) => h.degree >= 2)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, max);
}

/* ---------- M208: Auto-Struktur — Themen-Tag & Entitäten ----------
   Aus einer Themen-Insel wird ein KURZES Schlagwort abgeleitet (häufigstes
   inhaltstragendes Wort der Kartentitel, keine KI nötig) und als Eigenschaft
   `thema` auf die Karten geschrieben. Damit sind Themen über Strg+K, die
   Eigenschaften-Ansicht und Anordnen („Schwimmbahnen") nutzbar. */
const STOPP = new Set([
  'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einer', 'eines',
  'für', 'mit', 'von', 'vom', 'zum', 'zur', 'bei', 'auf', 'aus', 'nach', 'über', 'unter', 'ist', 'sind',
  'werden', 'wird', 'wurde', 'haben', 'hat', 'nicht', 'auch', 'noch', 'sich', 'als', 'wie', 'dass',
  'neue', 'neuer', 'neues', 'alle', 'mehr', 'sehr', 'kann', 'muss', 'soll', 'im', 'am', 'an', 'in',
]);

/** Kurzes Schlagwort für eine Themen-Insel (aus den Titeln, ohne KI) */
export function topicLabel(cluster: TopicCluster): string {
  const freq = new Map<string, number>();
  for (const c of cluster.cards) {
    for (const raw of c.title.split(/[^\p{L}\d]+/u)) {
      const w = raw.trim();
      if (w.length < 4 || STOPP.has(w.toLowerCase())) continue;
      const key = w[0].toUpperCase() + w.slice(1).toLowerCase();
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const best = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best?.[0] ?? (cluster.title.split(/\s+/)[0] || 'Thema');
}

/** Themen-Tag auf alle Karten einer Insel schreiben — EIN History-Schritt
 *  über ALLE beteiligten Boards (eine Insel spannt sich typischerweise über
 *  mehrere Boards; ein Undo muss sie komplett zurücknehmen) */
export function applyTopicTag(cluster: TopicCluster, label: string): number {
  const st = useBoard.getState();
  st.pushHistoryBoards(cluster.cards.map((c) => c.boardId));
  let n = 0;
  mutedHistory(() => {
    for (const c of cluster.cards) {
      const board = st.boards.find((b) => b.id === c.boardId);
      const node = board?.nodes.find((x) => x.id === c.nodeId);
      if (!node) continue;
      const attrs = (node.data?.attrs as Record<string, string> | undefined) ?? {};
      if (attrs.thema === label) continue;
      st.updateNodeDataOnBoard(c.boardId, c.nodeId, { attrs: { ...attrs, thema: label } });
      n += 1;
    }
  });
  return n;
}

/* ---------- M209: Übersichts-Notiz aus einer Themen-Insel ----------
   Das klassische „Map of Content"-Muster aus Obsidian: eine Notiz, die ein
   Thema bündelt und auf alle zugehörigen Karten verweist. Hier entsteht sie
   automatisch — mit [[Wikilinks]] auf die Boards (die Chips an der Notiz
   springen dann direkt hin) und einer Checkliste zum Durcharbeiten. */
export function buildTopicOverview(cluster: TopicCluster, label: string): { title: string; markdown: string } {
  const byBoard = new Map<string, string[]>();
  for (const c of cluster.cards) {
    byBoard.set(c.boardName, [...(byBoard.get(c.boardName) ?? []), c.title || '(ohne Titel)']);
  }
  const lines: string[] = [
    `## 🧠 Übersicht: ${label}`,
    '',
    `${cluster.cards.length} Karten aus ${byBoard.size} Board${byBoard.size > 1 ? 's' : ''} — automatisch nach Bedeutung gebündelt.`,
    '',
  ];
  for (const [board, titles] of byBoard) {
    lines.push(`### [[${board}]]`);
    for (const t of titles) lines.push(`- [ ] ${t.slice(0, 90)}`);
    lines.push('');
  }
  lines.push('_Erzeugt vom Gehirn-Puls — Karten ergänzen, umformulieren und verlinken wie in jeder anderen Notiz._');
  return { title: `Übersicht: ${label}`, markdown: lines.join('\n') };
}

export interface DigestLine {
  kind: 'thema' | 'knoten' | 'vorschlag';
  text: string;
  boardId?: string;
  /** nur bei 'thema': die Insel selbst, damit das UI Tag/Übersicht anbieten kann */
  cluster?: TopicCluster;
  label?: string;
}

/** Kurzbericht fürs Gehirn-Panel: Themen, Knotenpunkte, offene Vorschläge */
export async function brainDigest(rejected: Set<string>): Promise<DigestLine[]> {
  const out: DigestLine[] = [];
  const topics = await clusterTopics();
  for (const t of topics.slice(0, 3)) {
    const label = topicLabel(t);
    out.push({
      kind: 'thema',
      text: `${label} — ${t.cards.length} Karten aus ${t.boards.length} Board${t.boards.length > 1 ? 's' : ''} (${t.boards.slice(0, 3).join(', ')})`,
      boardId: t.cards[0]?.boardId,
      cluster: t,
      label,
    });
  }
  for (const h of hubBoards()) {
    out.push({ kind: 'knoten', text: `„${h.name}" ist ein Knotenpunkt (${h.degree} Verbindungen)`, boardId: h.boardId });
  }
  const st = useBoard.getState();
  const existing = new Set<string>();
  const imGehirn = brainBoardIds(st);
  for (const b of st.boards) {
    if (!imGehirn.has(b.id)) continue; // M220
    for (const n of b.nodes) {
      if (n.type !== 'portal') continue;
      const target = (n.data as { boardId?: string }).boardId;
      if (target) existing.add([b.id, target].sort().join('|'));
    }
  }
  const sug = await suggestBoardLinks(existing, rejected, 3);
  const nameOf = (id: string) => st.boards.find((b) => b.id === id)?.name ?? '?';
  for (const s of sug) {
    out.push({
      kind: 'vorschlag',
      text: `„${nameOf(s.a)}" und „${nameOf(s.b)}" passen zusammen (${Math.round(s.score * 100)} %) — noch nicht verknüpft`,
      boardId: s.a,
    });
  }
  return out;
}

/* ---------- M206: „Frag dein Gehirn" (RAG) ----------
   Die Frage wird semantisch beantwortet: passende Karten aus dem Index holen,
   sie der KI als KONTEXT geben und um eine Antwort MIT Belegen bitten. Die
   Belege [1], [2] … verweisen auf die Karten und werden im UI zu Sprung-Chips.
   Ohne Treffer wird gar nicht erst gefragt — lieber ehrlich „nichts gefunden"
   als eine frei erfundene Antwort. */
export interface BrainAnswer { answer: string; sources: BrainHit[] }

/** Volltext einer indexierten Karte für den RAG-Kontext (frisch aus dem Board —
 *  der Index speichert bewusst nur Vektor + Titel, nicht den ganzen Text) */
function cardTextOf(h: BrainHit): string {
  const st = useBoard.getState();
  const board = st.boards.find((b) => b.id === h.boardId);
  const node = board?.nodes.find((n) => n.id === h.nodeId);
  return node ? nodeToText(node).slice(0, 900) : h.title;
}

export async function askBrain(question: string): Promise<BrainAnswer> {
  const hits = await brainSearch(question, 8);
  if (hits.length === 0) return { answer: '', sources: [] };
  const context = hits
    .map((h, i) => `[${i + 1}] Board „${h.boardName}" · ${h.title}\n${cardTextOf(h)}`)
    .join('\n\n');
  const answer = await askAi(
    'Beantworte die Frage AUSSCHLIESSLICH aus den folgenden Notiz-Karten des Nutzers. '
    + 'Erfinde nichts dazu; steht die Antwort nicht in den Karten, sage das offen. '
    + 'Belege jede Aussage mit der Quellennummer in eckigen Klammern, z. B. [2]. '
    + 'Antworte auf Deutsch, knapp (höchstens 6 Sätze), ohne Einleitungsfloskel.\n\n'
    + `Frage: ${question}\n\nKarten:\n${context}`,
  );
  return { answer: answer.trim(), sources: hits };
}

/* ---------- M205: Synapsen — Verknüpfungen, die noch fehlen ----------
   Das Gehirn vergleicht ALLE Board-Paare: Wo sich Inhalte stark ähneln, aber
   weder Portal noch Wikilink existiert, entsteht ein VORSCHLAG. Angenommene
   werden zu echten Portalen, abgelehnte merkt sich der Store dauerhaft. */
export interface LinkSuggestion { a: string; b: string; score: number; why: string }

export async function suggestBoardLinks(
  existing: Set<string>,
  rejected: Set<string>,
  max = 6,
): Promise<LinkSuggestion[]> {
  await loadIndex();
  if (!mem || mem.size === 0) return [];
  // Karten nach Board bündeln
  const byBoard = new Map<string, BrainEntry[]>();
  for (const e of mem.values()) {
    const list = byBoard.get(e.boardId) ?? [];
    list.push(e);
    byBoard.set(e.boardId, list);
  }
  const ids = [...byBoard.keys()];
  const out: LinkSuggestion[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = [ids[i], ids[j]].sort().join('|');
      if (existing.has(key) || rejected.has(key)) continue;
      // Bestes Kartenpaar zwischen den Boards bestimmt die Nähe
      let best = 0;
      let why = '';
      for (const a of byBoard.get(ids[i])!) {
        for (const b of byBoard.get(ids[j])!) {
          const s = dot(a.vec, b.vec);
          if (s > best) { best = s; why = `„${a.title}" ↔ „${b.title}"`; }
        }
      }
      if (best >= 0.62) out.push({ a: ids[i], b: ids[j], score: best, why });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, max);
}

/** Verwandte Karten zum aktiven BOARD: Was aus anderen Boards passt inhaltlich? */
export async function relatedToBoard(boardId: string, k = 5): Promise<BrainHit[]> {
  await loadIndex();
  if (!mem || mem.size === 0) return [];
  const own = [...mem.values()].filter((e) => e.boardId === boardId);
  if (own.length === 0) return [];
  const best = new Map<string, BrainHit>();
  for (const e of mem.values()) {
    if (e.boardId === boardId) continue;
    let s = 0;
    for (const o of own) s = Math.max(s, dot(o.vec, e.vec));
    if (s < 0.45) continue;
    const key = `${e.boardId}:${e.nodeId}`;
    const prev = best.get(key);
    if (!prev || s > prev.score) best.set(key, { ...e, score: s });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
