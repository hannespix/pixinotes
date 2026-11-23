// M477: Gemeinsam in einer Notiz tippen — der schwere Teil (nachgeladen, siehe lib/notizGemeinsam.ts).
//
// Yjs ist hier NUR die Live-Schicht. Gespeichert wird weiter das Block-JSON der Notiz (data.blocks) über den
// gewohnten Weg (updateNodeData → Abgleich): Sync, Konto, Export und die ruhende Notiz bleiben unverändert.
//
// Ablauf je Notiz und Gerät („Sitzung"):
//   1. Öffnen: eigenes Y-Dokument (zufällige Yjs-Kennung), Frage `hallo` mit leerem Stand-Vektor in den Kanal.
//   2. Wer die Notiz schon offen hat, antwortet `stand` (gezielt, `an`): genau das, was dem Fragenden fehlt, und den
//      eigenen Stand-Vektor — der Fragende schickt daraus zurück, was nur er hat (zwei Wege, wie y-protocols/sync).
//   3. Antwortet niemand (allein in der Notiz), entsteht das Dokument aus dem Block-JSON — DETERMINISTISCH: in einem
//      Hilfsdokument mit einer Yjs-Kennung, die aus Notiz und Inhalt gerechnet wird, fehlende Block-Kennungen nach
//      ihrer Stelle. Öffnen zwei im selben Augenblick dieselbe gespeicherte Notiz, entstehen Byte für Byte dieselben
//      Einträge — Yjs legt sie beim Zusammenführen übereinander, nichts verdoppelt sich.
//   4. Danach: jede eigene Änderung als `upd` (gebündelt mit Y.mergeUpdates, Takt nach Größe der Runde), Cursor und
//      Markierung als `aw` (y-protocols/awareness). Größeres als NOTIZ_Y_TEIL_ZEICHEN reist in `teil`en.
//   5. Fehlt einem Gerät die Grundlage einer Änderung (Yjs hält sie als „ausstehend"), fragt es mit `hallo` und seinem
//      Stand-Vektor nach; ebenso nach einem Wiederverbinden des Kanals.
//
// Wer speichert? Genau EINER je Notiz: unter allen, die sie gerade offen haben und schreiben dürfen, der mit der
// kleinsten Kennung (Kanal-Kennung, dann Yjs-Kennung — zwei Fenster desselben Geräts haben dieselbe Kanal-Kennung).
// Alle anderen sehen den Stand live im Editor; ihr gespeichertes Block-JSON kommt mit dem Abgleich vom Schreiber. So
// gibt es keine zwei Schreiber derselben Karte und damit keinen Konflikt im kartenweisen Abgleich (M364/M383). Geht
// der Schreiber, wird der Nächste Schreiber und schreibt einmal den ganzen Stand. Ohne Kanal schreibt jeder selbst.
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYXmlFragment, withCollaboration } from '@blocknote/core/yjs';
import { ich, ichIn, LIVE_NACHRICHT, liveSenden, liveVerbunden, TEILNEHMER_EREIGNIS, teilnehmerVon } from './liveStand';
import { notizYVonAussen, NOTIZ_Y_TEIL_ZEICHEN, type NotizYArt, type NotizYNachricht } from './sicherNotizY';
import { NOTIZ_Y_EREIGNIS } from './notizGemeinsam';
import { mutedHistory, selectActiveBoard, setzeNotizSchutz, useBoard } from '../store';

/** Herkunft von Änderungen, die aus dem Kanal kamen — sie gehen nicht wieder hinaus */
const FERN = 'pn-fern';
const FRAGMENT = 'prosemirror';
/** So lange wartet ein Gerät beim Öffnen auf den Stand der anderen, bevor es selbst aus dem Block-JSON beginnt */
const WARTE_MS = 450;
const NOCHMAL_MS = 800;

// ---------- Hilfen ----------
const zuB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const ausB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Eine leere Yjs-Änderung ist zwei Byte lang (keine Einträge, keine Löschungen) */
const leer = (u: Uint8Array): boolean => u.length <= 2;
/** FNV-1a, 32 Bit */
function streuwert(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Takt fürs Bündeln: zu zweit flüssig, in großer Runde seltener (wie die Mitschrift M366) */
const takt = (boardId: string, klein: number): number => {
  const n = teilnehmerVon(boardId).length;
  return n <= 8 ? klein : n <= 20 ? klein * 3 : klein * 6;
};
type Roh = { id?: unknown; children?: unknown };
/** Fehlende Block-Kennungen nach ihrer Stelle — BlockNote würfelte sonst je Gerät eine andere */
function mitKennungen(blocks: unknown[], vorne: string): unknown[] {
  return blocks.map((b, i) => {
    if (!b || typeof b !== 'object') return b;
    const r = b as Roh;
    const id = typeof r.id === 'string' && r.id ? r.id : `${vorne}-${i}`;
    const kinder = Array.isArray(r.children) ? mitKennungen(r.children, `${id}k`) : r.children;
    return { ...(b as object), id, ...(kinder !== undefined ? { children: kinder } : {}) };
  });
}

/**
 * Enthält eine Awareness-Meldung nur den Eintrag dieses Absenders (Yjs-Kennung `cid`, Kanal-Kennung `von`)?
 * Aufbau (y-protocols): Anzahl, dann je Eintrag Kennung, Uhr, JSON-Zustand — Zahlen als varUint, Text mit Länge.
 */
function awareEigene(u: Uint8Array, cid: number, von: string): boolean {
  let p = 0;
  const zahl = (): number => {
    let n = 0; let f = 1;
    for (;;) {
      if (p >= u.length || f > 2 ** 49) throw new Error('kurz');
      const b = u[p++];
      n += (b & 0x7f) * f; f *= 128;
      if (b < 0x80) return n;
    }
  };
  const anzahl = zahl();
  if (anzahl !== 1) return false;
  if (zahl() !== cid) return false;
  zahl();   // Uhr
  const len = zahl();
  if (p + len > u.length) return false;
  const st = JSON.parse(new TextDecoder().decode(u.subarray(p, p + len))) as Anwesenheit | null;
  return st === null || (typeof st === 'object' && st.pn === von);
}

// ---------- Senden (zerlegt, wenn groß) ----------
function senden(boardId: string, m: Omit<NotizYNachricht, 'von'>): void {
  const voll: NotizYNachricht = { von: ich().id, ...m };
  const d = voll.d ?? '';
  if (d.length <= NOTIZ_Y_TEIL_ZEICHEN) { liveSenden(boardId, NOTIZ_Y_EREIGNIS, voll); return; }
  const z = Math.ceil(d.length / NOTIZ_Y_TEIL_ZEICHEN);
  const k = Math.random().toString(36).slice(2, 12);
  for (let i = 0; i < z; i++) {
    liveSenden(boardId, NOTIZ_Y_EREIGNIS, {
      von: voll.von, c: voll.c, n: voll.n, a: 'teil', k, i, z, ganz: voll.a as Exclude<NotizYArt, 'teil' | 'offen'>,
      ...(voll.an !== undefined ? { an: voll.an } : {}), ...(i === 0 && voll.sv ? { sv: voll.sv } : {}),
      d: d.slice(i * NOTIZ_Y_TEIL_ZEICHEN, (i + 1) * NOTIZ_Y_TEIL_ZEICHEN),
    } satisfies NotizYNachricht);
  }
}

// ---------- Empfangen ----------
interface Teile { teile: string[]; da: number; z: number; ganz: Exclude<NotizYArt, 'teil' | 'offen'>; an?: number; sv?: string; seit: number }
const teilLager = new Map<string, Teile>();
function zusammensetzen(m: NotizYNachricht): NotizYNachricht | null {
  const key = `${m.von}\n${m.c}\n${m.k}`;
  const jetzt = Date.now();
  for (const [k, t] of teilLager) if (jetzt - t.seit > 20_000) teilLager.delete(k);   // Reste verwerfen
  let t = teilLager.get(key);
  if (!t) {
    // je Absender höchstens drei offene Zerlegungen — sonst ließe sich hier beliebig Speicher füllen
    if ([...teilLager.keys()].filter((k) => k.startsWith(`${m.von}\n`)).length >= 3) return null;
    t = { teile: new Array<string>(m.z ?? 0), da: 0, z: m.z ?? 0, ganz: m.ganz ?? 'upd', seit: jetzt };
    teilLager.set(key, t);
  }
  if (t.z !== m.z || t.ganz !== m.ganz || t.teile[m.i ?? 0] !== undefined) return null;
  t.teile[m.i ?? 0] = m.d ?? '';
  t.da += 1;
  if (m.an !== undefined) t.an = m.an;
  if (m.sv) t.sv = m.sv;
  if (t.da < t.z) return null;
  teilLager.delete(key);
  return { von: m.von, c: m.c, n: m.n, a: t.ganz, d: t.teile.join(''), ...(t.an !== undefined ? { an: t.an } : {}), ...(t.sv ? { sv: t.sv } : {}) };
}

const sitzungen = new Map<string, SitzungIntern>();
/**
 * Board → Sitzung (Kanal-Schlüssel) → Karte und Name eines anderen, der gerade darin tippt (Cursor im Editor bzw. im
 * Feld) — je Karte an den Speicher (setzeNotizSchutz). M487: Eine Karte kann mehrere Sitzungen haben (Protokoll: je
 * Sitzungstermin eine), darum wird je Sitzung gemerkt und je Karte zusammengefasst.
 */
const schutz = new Map<string, Map<string, { nodeId: string; name: string }>>();
function schutzSetzen(boardId: string, n: string, nodeId: string, name: string | null): void {
  const m = new Map(schutz.get(boardId) ?? []);
  if ((m.get(n)?.name ?? null) === name) return;
  if (name) m.set(n, { nodeId, name }); else m.delete(n);
  if (m.size) schutz.set(boardId, m); else schutz.delete(boardId);
  const jeKarte = new Map<string, string>();
  for (const v of m.values()) if (!jeKarte.has(v.nodeId)) jeKarte.set(v.nodeId, v.name);
  setzeNotizSchutz(boardId, jeKarte);
}
const schluessel = (boardId: string, nodeId: string): string => `${boardId}\n${nodeId}`;
let horchtSchon = false;
function horchen(): void {
  if (horchtSchon) return;
  horchtSchon = true;
  window.addEventListener(LIVE_NACHRICHT, (e) => {
    const { boardId, ereignis, inhalt } = (e as CustomEvent<{ boardId: string; ereignis: string; inhalt: unknown }>).detail ?? {};
    if (ereignis !== NOTIZ_Y_EREIGNIS || typeof boardId !== 'string') return;
    // M477: durch lib/sicher.ts — Gestalt, Größe, nur Anwesende
    let m = notizYVonAussen(inhalt, new Set(teilnehmerVon(boardId).map((t) => t.id)));
    if (!m) return;
    if (m.a === 'teil') { m = zusammensetzen(m); if (!m) return; }
    sitzungen.get(schluessel(boardId, m.n))?.empfangen(m);
  });
  window.addEventListener(TEILNEHMER_EREIGNIS, (e) => {
    const boardId = (e as CustomEvent<string>).detail;
    for (const s of sitzungen.values()) if (!boardId || s.boardId === boardId) s.rundeGeaendert();
    if (boardId) neueMelden(boardId);
  });
}

/**
 * Wer neu in den Kanal kommt, erfährt einmal, in welchen Notizen hier gerade gemeinsam gearbeitet wird (`offen`).
 * Nur für diese wartet sein Öffnen auf den Stand der anderen; jede andere Notiz beginnt sofort aus dem Block-JSON
 * (niemand hält ein Y-Dokument dazu). Die Meldung kommt mit kleiner Streuung, damit nicht alle zugleich senden.
 */
const bekannt = new Map<string, Set<string>>();
const meldeTimer = new Map<string, ReturnType<typeof setTimeout>>();
function neueMelden(boardId: string): void {
  const jetzt = new Set(teilnehmerVon(boardId).map((t) => t.id));
  const vorher = bekannt.get(boardId) ?? new Set<string>();
  bekannt.set(boardId, jetzt);
  if (![...jetzt].some((id) => !vorher.has(id) && id !== ich().id) || meldeTimer.has(boardId)) return;
  meldeTimer.set(boardId, setTimeout(() => {
    meldeTimer.delete(boardId);
    const ns = [...sitzungen.values()].filter((x) => x.boardId === boardId && x.bereit()).map((x) => x.n).slice(0, 200);
    if (ns.length) liveSenden(boardId, NOTIZ_Y_EREIGNIS, { von: ich().id, c: 1, n: '_', a: 'offen', ns } satisfies NotizYNachricht);
  }, 60 + Math.random() * 240));
}

// ---------- Sitzung ----------
export interface NotizSitzung {
  readonly boardId: string;
  readonly nodeId: string;
  /** M487: Schlüssel im Kanal — die Notiz selbst, beim Protokoll `Karte:Sitzungstermin`, beim Kanban die Karte */
  readonly n: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** Die Editor-Optionen mit Kollaboration (BlockNote withCollaboration) */
  optionen<T extends object>(basis: T): T;
  /** Speichert dieses Gerät das Block-JSON der Notiz? */
  istSchreiber(): boolean;
  /** Rückruf, sobald dieses Gerät Schreiber wird (der Vorige ging) — gibt das Abmelden zurück */
  beiSchreiber(cb: () => void): () => void;
  /** Darf dieses Gerät gerade schreiben (Rolle, Rechte der Gruppe)? */
  darfSchreiben(an: boolean): void;
  /** Ausstehende Änderungen sofort senden */
  jetztSenden(): void;
  /** Der Editor hat sich geändert (hier oder bei anderen): sichern, wenn dieses Gerät Schreiber ist */
  aenderung(dokument: unknown): void;
  /** Den Editor anbinden: darf er schreiben, woher kommt sein Stand (für den Schreiberwechsel) — gibt das Lösen zurück */
  anbinden(darf: boolean, dokument: () => unknown): () => void;
  /** Beim Verlassen: den letzten Stand sichern (der Editor ist dann womöglich schon abgebaut) */
  abschied(): void;
  schliessen(): void;
}
interface SitzungIntern extends NotizSitzung { empfangen(m: NotizYNachricht): void; rundeGeaendert(): void; bereit(): boolean; beimSchliessen(f: () => void): void }

interface Anwesenheit { pn?: unknown; schreibt?: unknown }

/** M487: Was eine Sitzung über ihren Inhalt wissen muss — der Rest (Kanal, Schreiber, Cursor) ist für alle gleich */
interface KernAuftrag {
  boardId: string;
  /** die Karte (Schutz, Speicher) */
  nodeId: string;
  /** Schlüssel im Kanal (Notiz und Kanban: die Karte; Protokoll: `Karte:Sitzungstermin`) */
  n: string;
  darf: boolean;
  warten: boolean;
  /** Ist das Dokument noch leer (niemand hat seinen Stand geschickt)? Dann beginnt `anfangen` aus dem Gespeicherten */
  leer(doc: Y.Doc): boolean;
  anfangen(doc: Y.Doc): void;
  /** Den Stand ins Board schreiben — nur beim Schreiber, im aktiven Board, ohne Rückgängig-Schritt; vergleicht selbst */
  schreiben(wert: unknown): void;
}

/** Die gespeicherten Blöcke deterministisch ins Dokument legen (siehe Kopf, Schritt 3) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockAnfang(doc: Y.Doc, n: string, blocks: unknown[], schema: any): void {
  const roh = Array.isArray(blocks) && blocks.length ? blocks : [{ type: 'paragraph' }];
  const mitIds = mitKennungen(roh, `pn${streuwert(n).toString(36)}`);
  const hilf = new Y.Doc();
  hilf.clientID = (streuwert(`${n}\n${JSON.stringify(mitIds)}`) % 0x7ffffffe) + 1;
  const ed = BlockNoteEditor.create({ schema });
  blocksToYXmlFragment(ed as never, mitIds as never, hilf.getXmlFragment(FRAGMENT));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(hilf), 'init');
  hilf.destroy();
}

/**
 * Eine Notiz gemeinsam öffnen. Löst auf, sobald das Dokument steht (Stand der anderen da oder aus dem Block-JSON
 * begonnen) — vorher darf kein Editor entstehen: Ein Editor auf leerem Dokument legte seinen eigenen leeren Absatz
 * an, und zwei Geräte hätten dann zwei.
 */
export function sitzungOeffnen(
  boardId: string, nodeId: string, blocks: unknown[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, darf: boolean,
  /** Arbeitet hier schon jemand (lib/notizGemeinsam.ts gemeinsamGewuenscht)? Nur dann auf seinen Stand warten */
  warten = true,
): Promise<NotizSitzung> {
  return kernOeffnen({
    boardId, nodeId, n: nodeId, darf, warten,
    leer: (doc) => doc.getXmlFragment(FRAGMENT).length === 0,
    anfangen: (doc) => blockAnfang(doc, nodeId, blocks, schema),
    schreiben: (jetzt) => {
      const st = useBoard.getState();
      const alt = selectActiveBoard(st).nodes.find((x) => x.id === nodeId)?.data.blocks;
      if (alt && JSON.stringify(alt) === JSON.stringify(jetzt)) return;
      st.updateNodeData(nodeId, { blocks: jetzt });
    },
  });
}

/**
 * M487: Den Text EINER Sitzung eines Protokolls gemeinsam öffnen — derselbe Weg wie bei der Notiz (BlockNote + Yjs),
 * gespeichert wird `entries[…].blocks` des Sitzungstermins. Kanal-Schlüssel `Karte:Sitzungstermin`: Wer eine andere
 * Sitzung derselben Reihe offen hat, arbeitet in einem eigenen Dokument.
 */
export function protokollOeffnen(
  boardId: string, nodeId: string, entryId: string, blocks: unknown[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, darf: boolean, warten: boolean,
): Promise<NotizSitzung> {
  const n = `${nodeId}:${entryId}`;
  return kernOeffnen({
    boardId, nodeId, n, darf, warten,
    leer: (doc) => doc.getXmlFragment(FRAGMENT).length === 0,
    anfangen: (doc) => blockAnfang(doc, n, blocks, schema),
    schreiben: (jetzt) => {
      const st = useBoard.getState();
      const node = selectActiveBoard(st).nodes.find((x) => x.id === nodeId);
      const eintraege = (node?.data as { entries?: Array<{ id: string; blocks?: unknown }> } | undefined)?.entries;
      const alt = eintraege?.find((e) => e.id === entryId);
      if (!eintraege || !alt) return;   // Sitzung gelöscht
      if (JSON.stringify(alt.blocks ?? []) === JSON.stringify(jetzt)) return;
      st.updateNodeData(nodeId, { entries: eintraege.map((e) => (e.id === entryId ? { ...e, blocks: jetzt } : e)) });
    },
  });
}

// ---------- M487: Texte in Feldern (Kanban-Tickets) ----------
// Titel und Beschreibung eines Tickets sind schlichte Eingabefelder, kein Block-Editor. Je Feld ein Y.Text in der
// Y.Map `texte` des Dokuments der Kanban-Karte (Schlüssel `Ticket:text` bzw. `Ticket:note`) — Yjs führt zwei, die im
// selben Feld tippen, zeichengenau zusammen, wie in der Notiz. Gespeichert wird weiter das gewohnte `items`-JSON der
// Karte, vom selben einen Schreiber wie bei der Notiz.
const TEXTE = 'texte';
/** Herkunft der eigenen Eingaben in Feldern — nur sie nimmt Strg+Z im Feld zurück */
const LOKAL = 'pn-feld';

/** Wer tippt gerade in einem Feld (Name und Teilnehmerfarbe) */
export interface Tippende { name: string; farbe: string }
export interface FeldSitzung extends NotizSitzung {
  /** Ein Eingabefeld an den Text `key` binden (fehlt er, beginnt er deterministisch mit `anfang`) — gibt das Lösen zurück */
  feldBinden(el: HTMLInputElement | HTMLTextAreaElement, key: string, anfang: string): () => void;
  /** Die anderen, deren Cursor gerade in diesem Feld steht */
  tippende(key: string): Tippende[];
  /** Rückruf, wenn sich Cursor der anderen ändern — gibt das Abmelden zurück */
  beiAnwesenheit(cb: () => void): () => void;
}

/** Eine Stelle im Text nach einer fremden Änderung (Yjs-Delta) — so bleibt der eigene Cursor, wo er inhaltlich war */
function verschieben(delta: Array<{ insert?: unknown; retain?: number; delete?: number }>, pos: number): number {
  let i = 0; let p = pos;
  for (const op of delta) {
    if (op.retain) i += op.retain;
    else if (typeof op.insert === 'string') { if (i < p) p += op.insert.length; i += op.insert.length; }
    else if (op.delete) { if (i < p) p -= Math.min(op.delete, p - i); }
    if (i > p) break;
  }
  return p;
}

/**
 * M487: Die Texte einer Kanban-Karte gemeinsam öffnen (Ticket-Fenster im Live-Board). Anders als beim Block-Editor
 * entsteht das Dokument nicht beim Öffnen, sondern je Feld beim ersten Binden — ebenso deterministisch (Hilfsdokument
 * mit einer Yjs-Kennung aus Karte, Feld und gespeichertem Text): Zwei, die dasselbe Ticket zugleich öffnen, legen
 * dieselben Einträge an.
 */
export async function kanbanOeffnen(boardId: string, nodeId: string, darf: boolean, warten: boolean): Promise<FeldSitzung> {
  const texteAus = (doc: Y.Doc): Record<string, string> => {
    const aus: Record<string, string> = {};
    for (const [k, v] of doc.getMap(TEXTE).entries()) if (v instanceof Y.Text) aus[k] = v.toString();
    return aus;
  };
  const s = await kernOeffnen({
    boardId, nodeId, n: nodeId, darf, warten,
    leer: () => false,
    anfangen: () => { /* je Feld, siehe feldText */ },
    schreiben: (wert) => {
      const texte = wert as Record<string, string>;
      const st = useBoard.getState();
      const node = selectActiveBoard(st).nodes.find((x) => x.id === nodeId);
      if (!node || node.type !== 'kanban') return;
      const items = ((node.data as unknown as { items?: Array<Record<string, unknown> & { id: string }> }).items) ?? [];
      let anders = false;
      const neu = items.map((it) => {
        let x = it;
        for (const f of ['text', 'note'] as const) {
          const v = texte[`${it.id}:${f}`];
          if (v === undefined) continue;
          // Eine leere Beschreibung heißt „keine" (wie im Ticket-Fenster ohne Live-Kanal)
          const soll = f === 'note' && v === '' ? undefined : v;
          if ((x[f] ?? undefined) === soll) continue;
          x = { ...x };
          if (soll === undefined) delete x[f]; else x[f] = soll;
          anders = true;
        }
        return x;
      });
      if (anders) st.updateNodeData(nodeId, { items: neu });
    },
  });
  const { doc, awareness } = s;
  const karte = doc.getMap(TEXTE);
  // Jede Änderung (eigene und fremde) an den Schreiber; der Speicher-Abo heilt Fassungen von außen (wie bei der Notiz)
  const beiAenderung = () => s.aenderung(texteAus(doc));
  karte.observeDeep(beiAenderung);
  s.beimSchliessen(() => karte.unobserveDeep(beiAenderung));
  s.beimSchliessen(s.anbinden(darf, () => texteAus(doc)));

  const feldText = (key: string, anfang: string): Y.Text => {
    const da = karte.get(key);
    if (da instanceof Y.Text) return da;
    const hilf = new Y.Doc();
    hilf.clientID = (streuwert(`${nodeId}\n${key}\n${anfang}`) % 0x7ffffffe) + 1;
    hilf.getMap(TEXTE).set(key, new Y.Text(anfang));
    // geht hinaus (andere, die dieses Feld noch nicht gebunden haben, brauchen die Grundlage der folgenden Eingaben)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(hilf), 'feld-anfang');
    hilf.destroy();
    return karte.get(key) as Y.Text;
  };
  const f = s as SitzungIntern & FeldSitzung;
  f.feldBinden = (el, key, anfang) => {
    const t = feldText(key, anfang);
    const um = new Y.UndoManager(t, { trackedOrigins: new Set([LOKAL]), captureTimeout: 500 });
    el.value = t.toString();
    const cursorMelden = () => {
      if (document.activeElement !== el || awareness.getLocalState() === null) return;
      awareness.setLocalStateField('cursor', { feld: key, a: el.selectionStart ?? 0, k: el.selectionEnd ?? 0 });
    };
    const cursorWeg = () => { if (awareness.getLocalState() !== null && (awareness.getLocalState() as { cursor?: { feld?: string } }).cursor?.feld === key) awareness.setLocalStateField('cursor', null); };
    const eingabe = () => {
      const alt = t.toString(); const neu = el.value;
      if (alt !== neu) {
        // Was sich geändert hat: gleicher Anfang, gleiches Ende — dazwischen ersetzt (Tippen, Löschen, Einfügen, Ersetzen)
        let a = 0;
        while (a < alt.length && a < neu.length && alt[a] === neu[a]) a++;
        let e = 0;
        while (e < alt.length - a && e < neu.length - a && alt[alt.length - 1 - e] === neu[neu.length - 1 - e]) e++;
        doc.transact(() => {
          if (alt.length - a - e > 0) t.delete(a, alt.length - a - e);
          if (neu.length - a - e > 0) t.insert(a, neu.slice(a, neu.length - e));
        }, LOKAL);
      }
      cursorMelden();
    };
    const beobachter = (ev: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOKAL) return;
      const neu = t.toString();
      if (el.value === neu) return;
      const fokus = document.activeElement === el;
      const a = el.selectionStart ?? 0; const k = el.selectionEnd ?? 0;
      const delta = ev.delta as Array<{ insert?: unknown; retain?: number; delete?: number }>;
      el.value = neu;
      if (fokus) { try { el.setSelectionRange(verschieben(delta, a), verschieben(delta, k)); } catch { /* Feld weg */ } }
    };
    t.observe(beobachter);
    // Strg+Z / Strg+Y im Feld: nur die eigenen Eingaben (Yjs), nicht die der anderen
    const taste = (e: Event) => {
      const k = e as KeyboardEvent;
      if (!(k.ctrlKey || k.metaKey) || k.altKey) return;
      const z = k.key.toLowerCase();
      const zurueck = z === 'z' && !k.shiftKey; const vor = z === 'y' || (z === 'z' && k.shiftKey);
      if (!zurueck && !vor) return;
      k.preventDefault(); k.stopPropagation();
      const vorher = el.value;
      if (zurueck) um.undo(); else um.redo();
      if (el.value !== vorher) { const p = Math.min(el.value.length, el.selectionStart ?? 0); el.setSelectionRange(p, p); }
      cursorMelden();
    };
    const ereignisse: Array<[string, EventListener]> = [
      ['input', eingabe], ['focus', cursorMelden], ['select', cursorMelden], ['keyup', cursorMelden], ['mouseup', cursorMelden],
      ['blur', cursorWeg], ['keydown', taste],
    ];
    for (const [e, h] of ereignisse) el.addEventListener(e, h);
    if (document.activeElement === el) cursorMelden();
    return () => {
      for (const [e, h] of ereignisse) el.removeEventListener(e, h);
      t.unobserve(beobachter);
      um.destroy();
      cursorWeg();
    };
  };
  f.tippende = (key) => {
    const aus: Tippende[] = [];
    for (const [cid, st] of awareness.getStates()) {
      const x = st as { cursor?: { feld?: unknown } | null; user?: { name?: unknown; color?: unknown } } | null;
      if (cid === doc.clientID || !x || x.cursor?.feld !== key) continue;
      aus.push({ name: typeof x.user?.name === 'string' ? x.user.name.slice(0, 40) : 'Jemand', farbe: typeof x.user?.color === 'string' ? x.user.color : '' });
    }
    return aus;
  };
  f.beiAnwesenheit = (cb) => { awareness.on('change', cb); return () => awareness.off('change', cb); };
  return f;
}

async function kernOeffnen(auftrag: KernAuftrag): Promise<SitzungIntern> {
  const { boardId, nodeId, n, darf, warten } = auftrag;
  horchen();
  const alt = sitzungen.get(schluessel(boardId, n));
  if (alt) alt.schliessen();
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT);
  /** M487: was beim Schließen noch zu lösen ist (Feld-Sitzungen: Speicher-Abo) */
  const aufraeumen: Array<() => void> = [];
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);   // erst sichtbar, wenn bereit
  const selbst = ich().id;
  let darfSchreiben = darf;
  let bereit = false;
  let zu = false;
  let bekamStand = false;
  let bekamAenderung = false;
  let warVerbunden = liveVerbunden(boardId);
  let warSchreiber = false;
  const schreiberRufe = new Set<() => void>();

  // --- eigene Änderungen bündeln und senden ---
  let offen: Uint8Array[] = [];
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  const jetztSenden = () => {
    clearTimeout(sendTimer); sendTimer = undefined;
    if (!offen.length) return;
    const u = offen.length === 1 ? offen[0] : Y.mergeUpdates(offen);
    offen = [];
    if (!leer(u)) senden(boardId, { c: doc.clientID, n, a: 'upd', d: zuB64(u) });
  };
  /** Hat sich das Dokument seit dem Start geändert (hier oder bei anderen)? Nur dann gibt es beim Schreiberwechsel etwas zu sichern */
  let geaendert = false;
  doc.on('update', (u: Uint8Array, herkunft: unknown) => {
    if (bereit && herkunft !== 'init') geaendert = true;
    if (herkunft === FERN || herkunft === 'init' || zu) return;
    offen.push(u);
    if (!bereit) return;   // vor dem Start nichts senden (der Stand geht mit der Antwort auf `hallo`)
    if (!sendTimer) sendTimer = setTimeout(jetztSenden, takt(boardId, 40));
  });
  // --- Cursor und Markierung (Awareness) ---
  let awTimer: ReturnType<typeof setTimeout> | undefined;
  const awSenden = () => {
    clearTimeout(awTimer); awTimer = undefined;
    if (zu && awareness.getLocalState() !== null) return;
    senden(boardId, { c: doc.clientID, n, a: 'aw', d: zuB64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
  };
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, herkunft: unknown) => {
    if (herkunft === 'local' && bereit && [...added, ...updated, ...removed].includes(doc.clientID)) {
      if (awareness.getLocalState() === null) awSenden();   // Abschied sofort
      else if (!awTimer) awTimer = setTimeout(awSenden, takt(boardId, 90));
    }
    schreiberPruefen();
    // Tippt (Cursor im Editor) gerade jemand anderes hier? Dann bleibt die Karte, wie sie ist — bis auf den Text
    if (!zu) {
      let wer: string | null = null;
      for (const [cid, st] of awareness.getStates()) {
        const x = st as (Anwesenheit & { cursor?: unknown; user?: { name?: unknown } }) | null;
        if (cid === doc.clientID || !x || x.pn === selbst || !x.cursor) continue;
        wer = typeof x.user?.name === 'string' ? x.user.name.slice(0, 40) : 'Jemand';
        break;
      }
      schutzSetzen(boardId, n, nodeId, wer);
    }
  });

  /** Wer speichert? Unter allen mit offener Notiz, die schreiben dürfen: die kleinste Kennung */
  const schreiberKennung = (): string | null => {
    let best: string | null = null;
    for (const [cid, st] of awareness.getStates()) {
      const s = st as Anwesenheit | null;
      if (!s || typeof s.pn !== 'string' || s.schreibt !== true) continue;
      const k = `${s.pn}\u0000${String(cid).padStart(10, '0')}`;
      if (best === null || k < best) best = k;
    }
    return best;
  };
  const meineKennung = (): string => `${selbst}\u0000${String(doc.clientID).padStart(10, '0')}`;
  const istSchreiber = (): boolean => {
    if (!darfSchreiben) return false;
    if (!bereit || !liveVerbunden(boardId)) return true;   // ohne Kanal schreibt jeder selbst (wie vorher)
    const k = schreiberKennung();
    return k === null || k === meineKennung();
  };
  function schreiberPruefen(): void {
    if (!bereit || zu) return;
    const jetzt = istSchreiber();
    if (jetzt && !warSchreiber) { warSchreiber = true; if (geaendert) for (const cb of [...schreiberRufe]) { try { cb(); } catch { /* egal */ } } }
    else if (!jetzt) warSchreiber = false;
  }
  const anwesenheitSetzen = () => {
    const ichHier = ichIn(boardId);
    awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), pn: selbst, schreibt: darfSchreiben, user: { name: ichHier.name, color: ichHier.farbe } });
  };

  let nachfrageAm = 0;
  const nachfragen = () => {
    // Höchstens einmal je Sekunde — eine Lücke meldet sich bei jeder weiteren Änderung wieder
    const jetzt = Date.now();
    if (jetzt - nachfrageAm < 1000) return;
    nachfrageAm = jetzt;
    senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
  };
  const lueckenPruefen = () => {
    const st = doc.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
    if (st.pendingStructs || st.pendingDs) nachfragen();
  };
  const einspielen = (d: string | undefined): boolean => {
    if (!d) return false;
    try { Y.applyUpdate(doc, ausB64(d), FERN); return true; } catch { return false; }
  };

  /**
   * Das Block-JSON sichern — nur, wer Schreiber ist, nur ins eigene Board, nur wenn es anders ist, und ohne eigenen
   * Rückgängig-Schritt im Board: Den Text nimmt Strg+Z im Editor zurück (nur das Eigene, Yjs); ein Board-Rückgängig,
   * das die Zeilen der anderen mitnähme, gäbe es sonst obendrein.
   */
  let letzter: unknown = null;
  const sichern = (jetzt: unknown) => {
    if (!istSchreiber()) return;
    const st = useBoard.getState();
    if (st.activeId !== boardId) return;   // Board gewechselt: updateNodeData träfe das neue
    mutedHistory(() => auftrag.schreiben(jetzt));
  };
  let standKam: (() => void) | null = null;
  const s: SitzungIntern = {
    boardId, nodeId, n, doc, awareness,
    optionen<T extends object>(basis: T): T {
      const ichHier = ichIn(boardId);
      return withCollaboration({
        ...basis,
        collaboration: { fragment, user: { name: ichHier.name, color: ichHier.farbe }, provider: { awareness }, showCursorLabels: 'activity' },
      } as never) as T;
    },
    istSchreiber,
    beiSchreiber(cb) { schreiberRufe.add(cb); return () => { schreiberRufe.delete(cb); }; },
    darfSchreiben(an) {
      if (an === darfSchreiben) return;
      darfSchreiben = an;
      if (bereit) anwesenheitSetzen();
    },
    jetztSenden,
    aenderung(dokument) { letzter = dokument; sichern(dokument); },
    anbinden(darf, dokument) {
      s.darfSchreiben(darf);
      // Der bisherige Schreiber ging: einmal den ganzen Stand sichern
      const ab = s.beiSchreiber(() => sichern(dokument()));
      // Der Schreiber heilt: Kommt die Notiz von außen mit anderem Text an (ein anderer hat sie verschoben oder umgefärbt
      // und dabei seinen etwas älteren gespeicherten Text mitgeschickt; eine ältere App-Fassung), gilt das Y-Dokument —
      // Lage und Farbe bleiben, der Text wird wieder der gemeinsame.
      let alt: unknown = null;
      const abo = useBoard.subscribe((st) => {
        const k = st.activeId === boardId ? selectActiveBoard(st).nodes.find((x) => x.id === nodeId) : undefined;
        if (!k || k === alt) return;
        alt = k;
        if (istSchreiber()) queueMicrotask(() => { if (!zu) sichern(dokument()); });
      });
      return () => { ab(); abo(); };
    },
    abschied() { if (letzter) sichern(letzter); },
    bereit: () => bereit && !zu,
    beimSchliessen(f) { if (zu) f(); else aufraeumen.push(f); },
    empfangen(m) {
      if (zu || m.c === doc.clientID || m.a === 'offen') return;
      if (m.a === 'hallo') {
        if (!bereit) return;   // wer selbst noch wartet, hat nichts zu geben
        let sv: Uint8Array | undefined;
        try { sv = m.sv ? ausB64(m.sv) : undefined; Y.decodeStateVector(sv ?? new Uint8Array([0])); } catch { return; }
        jetztSenden();
        senden(boardId, { c: doc.clientID, n, a: 'stand', an: m.c, d: zuB64(Y.encodeStateAsUpdate(doc, sv)), sv: zuB64(Y.encodeStateVector(doc)) });
        if (awareness.getLocalState() !== null) awSenden();   // der Neue soll den Cursor gleich sehen
        return;
      }
      if (m.a === 'stand') {
        if (m.an !== doc.clientID) return;
        if (!einspielen(m.d)) return;
        bekamStand = true;
        // Was nur ich habe (zwei Wege): zurück an alle
        if (m.sv && bereit) {
          try {
            const fehlt = Y.encodeStateAsUpdate(doc, ausB64(m.sv));
            if (!leer(fehlt)) senden(boardId, { c: doc.clientID, n, a: 'upd', d: zuB64(fehlt) });
          } catch { /* kaputter Vektor: egal */ }
        }
        standKam?.();
        lueckenPruefen();
        return;
      }
      if (m.a === 'upd') {
        if (einspielen(m.d)) { bekamAenderung = true; if (bereit) lueckenPruefen(); }
        return;
      }
      if (m.a === 'aw' && m.d) {
        try {
          const u = ausB64(m.d);
          // Jeder meldet nur sich selbst: nur der eigene Eintrag des Absenders, mit seiner Kanal-Kennung
          if (awareEigene(u, m.c, m.von)) applyAwarenessUpdate(awareness, u, FERN);
        } catch { /* kaputt: egal */ }
      }
    },
    rundeGeaendert() {
      if (zu) return;
      // Wer den Kanal verlassen hat, verschwindet auch aus der Notiz (Cursor weg, Schreiber neu bestimmt)
      const da = new Set(teilnehmerVon(boardId).map((t) => t.id));
      const weg: number[] = [];
      for (const [cid, st] of awareness.getStates()) {
        if (cid === doc.clientID) continue;
        const pn = (st as Anwesenheit | null)?.pn;
        if (typeof pn !== 'string' || !da.has(pn)) weg.push(cid);
      }
      if (weg.length) removeAwarenessStates(awareness, weg, FERN);
      // Kanal wieder da (nach einem Abriss): Stände abgleichen, Cursor neu melden
      const verbunden = liveVerbunden(boardId);
      if (verbunden && !warVerbunden && bereit) { nachfrageAm = 0; nachfragen(); if (awareness.getLocalState() !== null) awSenden(); }
      warVerbunden = verbunden;
      schreiberPruefen();
    },
    schliessen() {
      if (zu) return;
      jetztSenden();
      if (bereit) { awareness.setLocalState(null); awSenden(); }
      zu = true;
      schutzSetzen(boardId, n, nodeId, null);
      clearTimeout(awTimer);
      schreiberRufe.clear();
      for (const f of aufraeumen.splice(0)) { try { f(); } catch { /* egal */ } }
      if (sitzungen.get(schluessel(boardId, n)) === s) sitzungen.delete(schluessel(boardId, n));
      awareness.destroy();
      doc.destroy();
    },
  };
  sitzungen.set(schluessel(boardId, n), s);

  // --- Start: erst fragen, dann (falls niemand antwortet) aus dem Block-JSON beginnen ---
  const andere = teilnehmerVon(boardId).some((t) => t.id !== selbst) || teilnehmerVon(boardId).length === 0;
  if (liveVerbunden(boardId) && andere && !warten) {
    // Niemand arbeitet in dieser Notiz: sofort beginnen, die anderen nur wecken (sie fragen dann selbst)
    senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
  } else if (liveVerbunden(boardId) && andere) {
    const warteAuf = (ms: number) => new Promise<void>((auf) => {
      const t = setTimeout(() => { standKam = null; auf(); }, ms);
      standKam = () => { clearTimeout(t); standKam = null; auf(); };
    });
    senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
    await warteAuf(WARTE_MS);
    if (!bekamStand && bekamAenderung) {
      // Es wird getippt, aber die Grundlage fehlt noch: einmal nachfragen
      senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
      await warteAuf(NOCHMAL_MS);
    }
  }
  if (zu) return s;
  // Aus dem Gespeicherten beginnen — deterministisch (siehe Kopf)
  if (!bekamStand && auftrag.leer(doc)) auftrag.anfangen(doc);
  bereit = true;
  anwesenheitSetzen();
  // Änderungen, die während des Wartens hier entstanden (sollte nicht vorkommen), jetzt hinaus
  if (offen.length) jetztSenden();
  warSchreiber = istSchreiber();
  return s;
}
