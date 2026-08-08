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
import { useBoard } from '../store';

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
export async function syncBrainIndex(): Promise<void> {
  const st = useBoard.getState();
  if (!st.brain.on || running) return;
  running = true;
  lastError = '';
  try {
    await loadIndex();
    const m = mem!;
    const want = new Map<string, { boardId: string; nodeId: string; boardName: string; title: string; text: string; hash: number }>();
    for (const b of st.boards) {
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
