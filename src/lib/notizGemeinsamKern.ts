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
import { blocksToYXmlFragment, withCollaboration, yXmlFragmentToBlocks } from '@blocknote/core/yjs';
import type { Beschluss, ProtokollLive } from './protokollLive';
import type { KanbanLive } from './kanbanLive';
import type { KanbanItem } from '../types';
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
interface SitzungIntern extends NotizSitzung {
  empfangen(m: NotizYNachricht): void; rundeGeaendert(): void; bereit(): boolean; beimSchliessen(f: () => void): void;
  /** M493: noch einmal sichern (Beschlüsse geändert) — mit dem Stand des Editors, sonst nur das Übrige */
  neuSichern(): void;
}

interface Anwesenheit { pn?: unknown; schreibt?: unknown; sichert?: unknown }

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
function blockAnfang(doc: Y.Doc, n: string, blocks: unknown[], schema: any, zusatz?: { kennung: string; anlegen(hilf: Y.Doc): void }): void {
  const roh = Array.isArray(blocks) && blocks.length ? blocks : [{ type: 'paragraph' }];
  const mitIds = mitKennungen(roh, `pn${streuwert(n).toString(36)}`);
  const hilf = new Y.Doc();
  // M493: Was sonst noch hineinkommt (Beschlüsse des Protokolls), gehört in die Kennung — gleiche Kennung heißt in Yjs
  // gleicher Inhalt
  hilf.clientID = (streuwert(`${n}\n${JSON.stringify(mitIds)}${zusatz ? `\n${zusatz.kennung}` : ''}`) % 0x7ffffffe) + 1;
  const ed = BlockNoteEditor.create({ schema });
  blocksToYXmlFragment(ed as never, mitIds as never, hilf.getXmlFragment(FRAGMENT));
  zusatz?.anlegen(hilf);
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
      const daten = selectActiveBoard(st).nodes.find((x) => x.id === nodeId)?.data;
      const alt = daten?.blocks;
      if (alt && JSON.stringify(alt) === JSON.stringify(jetzt)) return;
      // M493: extEpoch unverändert mitgeben — sonst zählte der Speicher es hoch (M323), und der Editor des Schreibers
      // ersetzte daraufhin seinen ganzen Inhalt durch genau diesen Stand (NoteCard). Kam dazwischen ein Zeichen (eigenes
      // oder fremdes), drehte das Ersetzen es über Yjs bei allen zurück und warf den Cursor um.
      st.updateNodeData(nodeId, { blocks: jetzt, extEpoch: daten?.extEpoch });
    },
  });
}

/**
 * M487: Den Text EINER Sitzung eines Protokolls gemeinsam öffnen — derselbe Weg wie bei der Notiz (BlockNote + Yjs),
 * gespeichert wird `entries[…].blocks` des Sitzungstermins. Kanal-Schlüssel `Karte:Sitzungstermin`: Wer eine andere
 * Sitzung derselben Reihe offen hat, arbeitet in einem eigenen Dokument.
 *
 * M493: Im selben Dokument liegen die Beschlüsse der Sitzung (Y.Map `beschluesse`: Kennung → { text, o }, `o` = Lage
 * in der Reihe) — der Schreiber sichert sie mit `entries[…].decisions`. Eine Y.Map statt einer Liste: Ändern zwei
 * denselben Beschluss, gilt der letzte (eine Liste aus Löschen + Einfügen verdoppelte ihn). Die Marke `pn.beschluesse`
 * sagt, dass das Dokument die Beschlüsse trägt — ein Dokument aus einer älteren Fassung (ohne) lässt sie im Speicher.
 */
export interface ProtokollSitzung extends NotizSitzung, ProtokollLive {
  /** Einen Checklisten-Punkt abhaken bzw. wieder öffnen — im Y-Dokument (Kennung oder `pos:`-Pfad, wie lib/tasks.ts) */
  aufgabeHaken(blockId: string): boolean;
  /** Trägt das Dokument die Beschlüsse (sonst begann es auf einem Gerät mit älterer Fassung — dann gilt der Speicher)? */
  mitBeschluessen(): boolean;
}
const BESCHLUESSE = 'beschluesse';
const MARKE = 'pn';
/** Herkunft eigener Änderungen an Beschlüssen und Haken (nicht aus dem Editor) — gehen hinaus wie jede eigene */
const LOKAL_PROTOKOLL = 'pn-protokoll';
type BeschlussY = { text?: unknown; o?: unknown };
function beschluesseAus(doc: Y.Doc): Beschluss[] {
  const m = doc.getMap(BESCHLUESSE);
  const liste: Array<{ id: string; text: string; o: number }> = [];
  for (const [id, v] of m.entries()) {
    const x = v as BeschlussY | null;
    if (!x || typeof x.text !== 'string') continue;
    liste.push({ id, text: x.text, o: typeof x.o === 'number' ? x.o : 0 });
  }
  liste.sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return liste.map(({ id, text }) => ({ id, text }));
}
export function protokollOeffnen(
  boardId: string, nodeId: string, entryId: string, blocks: unknown[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, darf: boolean, warten: boolean, beschluesse: Beschluss[] = [],
): Promise<ProtokollSitzung> {
  const n = `${nodeId}:${entryId}`;
  let docHier: Y.Doc | null = null;
  const traegtBeschluesse = (d: Y.Doc): boolean => d.getMap(MARKE).get('beschluesse') === true;
  return kernOeffnen({
    boardId, nodeId, n, darf, warten,
    leer: (doc) => doc.getXmlFragment(FRAGMENT).length === 0,
    anfangen: (doc) => blockAnfang(doc, n, blocks, schema, {
      kennung: JSON.stringify(beschluesse.map((b) => [b.id, b.text])),
      anlegen: (hilf) => {
        const m = hilf.getMap(BESCHLUESSE);
        beschluesse.forEach((b, i) => { if (b && typeof b.id === 'string' && typeof b.text === 'string') m.set(b.id, { text: b.text, o: i }); });
        hilf.getMap(MARKE).set('beschluesse', true);
      },
    }),
    schreiben: (jetzt) => {
      const st = useBoard.getState();
      const node = selectActiveBoard(st).nodes.find((x) => x.id === nodeId);
      const eintraege = (node?.data as { entries?: Array<{ id: string; blocks?: unknown; decisions?: Beschluss[] }> } | undefined)?.entries;
      const alt = eintraege?.find((e) => e.id === entryId);
      if (!eintraege || !alt) return;   // Sitzung gelöscht
      const neu: { blocks?: unknown; decisions?: Beschluss[] } = {};
      // `jetzt` fehlt, wenn sich nur die Beschlüsse änderten und noch kein Editor-Stand bekannt ist
      if (jetzt !== undefined && jetzt !== null && JSON.stringify(alt.blocks ?? []) !== JSON.stringify(jetzt)) neu.blocks = jetzt;
      if (docHier && traegtBeschluesse(docHier)) {
        const b = beschluesseAus(docHier);
        if (JSON.stringify(alt.decisions ?? []) !== JSON.stringify(b)) neu.decisions = b;
      }
      if (!('blocks' in neu) && !('decisions' in neu)) return;
      st.updateNodeData(nodeId, { entries: eintraege.map((e) => (e.id === entryId ? { ...e, ...neu } : e)) });
    },
  }).then((s) => {
    const doc = s.doc;
    docHier = doc;
    const karte = doc.getMap(BESCHLUESSE);
    const p = s as SitzungIntern & ProtokollSitzung;
    // Beschlüsse geändert (hier oder bei anderen): der Schreiber sichert
    const beiAenderung = () => s.neuSichern();
    karte.observe(beiAenderung);
    s.beimSchliessen(() => karte.unobserve(beiAenderung));
    p.mitBeschluessen = () => traegtBeschluesse(doc);
    p.beschluesse = () => (traegtBeschluesse(doc) ? beschluesseAus(doc) : beschluesse);
    p.beschlussSetzen = (id, text) => {
      if (!traegtBeschluesse(doc)) return;
      const alt = karte.get(id) as BeschlussY | undefined;
      doc.transact(() => {
        if (text === null) karte.delete(id);
        else karte.set(id, { text, o: typeof alt?.o === 'number' ? alt.o : karte.size });
      }, LOKAL_PROTOKOLL);
    };
    p.beschlussDazu = (text) => {
      if (!traegtBeschluesse(doc)) return;
      let o = 0;
      for (const v of karte.values()) { const x = v as BeschlussY; if (typeof x?.o === 'number' && x.o >= o) o = x.o + 1; }
      const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      doc.transact(() => karte.set(id, { text, o }), LOKAL_PROTOKOLL);
    };
    p.beiBeschluessen = (cb) => { karte.observe(cb); return () => karte.unobserve(cb); };
    p.aufgabeHaken = (blockId) => {
      const el = checkpunkt(doc.getXmlFragment(FRAGMENT), blockId);
      if (!el) return false;
      const an = el.getAttribute('checked') as unknown;
      doc.transact(() => el.setAttribute('checked', (!(an === true || an === 'true')) as never), LOKAL_PROTOKOLL);
      return true;
    };
    return p;
  });
}
/**
 * Den Checklisten-Punkt im Y-Dokument finden: BlockNote legt je Block ein `blockContainer` (Attribut `id`) mit dem
 * Inhalt als erstem Kind (`checkListItem`, Attribut `checked`) und den Unterpunkten in einer `blockGroup` an. `pos:`-
 * Pfade (Blöcke ohne Kennung im Speicher, lib/minutes.ts) zählen die Blöcke je Ebene wie lib/tasks.ts.
 */
function checkpunkt(fragment: Y.XmlFragment, blockId: string): Y.XmlElement | null {
  const byPos = blockId.startsWith('pos:') ? blockId.slice(4).split('.').map(Number) : null;
  const elemente = (x: Y.XmlElement | Y.XmlFragment): Y.XmlElement[] =>
    x.toArray().filter((k): k is Y.XmlElement => k instanceof Y.XmlElement);
  const behaelter = (gruppe: Y.XmlElement): Y.XmlElement[] => elemente(gruppe).filter((k) => k.nodeName === 'blockContainer');
  const inhalt = (bc: Y.XmlElement): Y.XmlElement | null => {
    const k = elemente(bc).find((x) => x.nodeName !== 'blockGroup');
    return k && k.nodeName === 'checkListItem' ? k : null;
  };
  const kinder = (bc: Y.XmlElement): Y.XmlElement | null => elemente(bc).find((x) => x.nodeName === 'blockGroup') ?? null;
  const wurzel = elemente(fragment).find((x) => x.nodeName === 'blockGroup');
  if (!wurzel) return null;
  if (byPos) {
    let ebene: Y.XmlElement | null = wurzel;
    let bc: Y.XmlElement | null = null;
    for (const i of byPos) {
      if (!ebene || !Number.isInteger(i)) return null;
      bc = behaelter(ebene)[i] ?? null;
      if (!bc) return null;
      ebene = kinder(bc);
    }
    return bc ? inhalt(bc) : null;
  }
  const suche = (gruppe: Y.XmlElement): Y.XmlElement | null => {
    for (const bc of behaelter(gruppe)) {
      if (bc.getAttribute('id') === blockId) return inhalt(bc);
      const g = kinder(bc);
      const tiefer = g ? suche(g) : null;
      if (tiefer) return tiefer;
    }
    return null;
  };
  return suche(wurzel);
}

/**
 * M493: Einen Punkt eines Protokolls abhaken, während im Live-Board womöglich jemand gemeinsam in derselben Sitzung
 * schreibt (Übersicht der Karte). Vorher ging der Haken über den Speicher — der Schreiber der gemeinsamen Sitzung
 * „heilte" die Karte danach mit seinem Y-Dokument, der Haken war wieder weg (M489, offen). Jetzt: kurz der Sitzung
 * beitreten (Stand der anderen abwarten), den Haken im Y-Dokument setzen, sichern (wer gerade Schreiber ist) und
 * wieder gehen. Liefert false, wenn der Punkt im gemeinsamen Stand nicht vorkommt.
 */
export async function protokollHaken(
  boardId: string, nodeId: string, entryId: string, blocks: unknown[], beschluesse: Beschluss[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, blockId: string,
): Promise<boolean> {
  const s = await protokollOeffnen(boardId, nodeId, entryId, blocks, schema, true, true, beschluesse);
  try {
    if (!s.aufgabeHaken(blockId)) return false;
    // Ohne Editor: den Stand selbst in Blöcke wandeln (nur, wenn dieses Gerät gerade sichert)
    if (s.istSchreiber()) {
      const ed = BlockNoteEditor.create({ schema });
      s.aenderung(yXmlFragmentToBlocks(ed as never, s.doc.getXmlFragment(FRAGMENT)));
    }
    s.jetztSenden();
    return true;
  } finally {
    s.schliessen();
  }
}

// ---------- M487: Texte in Feldern (Kanban-Tickets) ----------
// Titel und Beschreibung eines Tickets sind schlichte Eingabefelder, kein Block-Editor. Je Feld ein Y.Text in der
// Y.Map `texte` des Dokuments der Kanban-Karte (Schlüssel `Ticket:text` bzw. `Ticket:note`) — Yjs führt zwei, die im
// selben Feld tippen, zeichengenau zusammen, wie in der Notiz. Gespeichert wird weiter das gewohnte `items`-JSON der
// Karte, vom selben einen Schreiber wie bei der Notiz.
//
// M498: Auch alle übrigen Felder eines Tickets, seine Checkliste und die Reihenfolge der Tickets laufen über dieses
// Dokument — in der Y.Map `kanban` als Überlagerung des Gespeicherten (nur was jemand seit dem Öffnen geändert hat):
//   f␟Ticket␟Feld          → Wert (Person, Frist, Priorität, Spalte, Stempel, Abhängigkeiten …; null = entfernt)
//   o␟Ticket               → Rang in der Reihe (beim Umsortieren bekommen ALLE Tickets einen neuen Rang)
//   s␟Ticket␟Punkt␟Feld    → Checklisten-Punkt: text, done, o (Rang), x (entfernt)
// Flache Schlüssel in EINER Map der Wurzel statt verschachtelter Typen: Zwei, die zugleich zum ersten Mal etwas an
// einem Ticket ändern, legten sonst je eine eigene Y.Map an, und eine davon ginge verloren. So ändert jeder genau den
// Schlüssel, den er meint — Person und Haken zugleich kommen beide an; ändern zwei dasselbe Feld, gilt der letzte.
const TEXTE = 'texte';
const KANBAN = 'kanban';
const TR = '\u001f';
/** Herkunft der eigenen Eingaben in Feldern — nur sie nimmt Strg+Z im Feld zurück */
const LOKAL = 'pn-feld';
/** M498: Herkunft eigener Änderungen an Tickets außerhalb der Textfelder (geht hinaus wie jede eigene) */
const LOKAL_KANBAN = 'pn-kanban';

/** Wer tippt gerade in einem Feld (Name, Teilnehmerfarbe — M498: und wo, als Stelle im Text dieses Geräts) */
export interface Tippende { name: string; farbe: string; a: number; k: number; cid: number }
export interface FeldSitzung extends NotizSitzung, KanbanLive {
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

/** Einen Y.Text auf `neu` bringen: gleicher Anfang, gleiches Ende — dazwischen ersetzt (Tippen, Löschen, Einfügen) */
function textAngleichen(t: Y.Text, neu: string): void {
  const alt = t.toString();
  if (alt === neu) return;
  let a = 0;
  while (a < alt.length && a < neu.length && alt[a] === neu[a]) a++;
  let e = 0;
  while (e < alt.length - a && e < neu.length - a && alt[alt.length - 1 - e] === neu[neu.length - 1 - e]) e++;
  if (alt.length - a - e > 0) t.delete(a, alt.length - a - e);
  if (neu.length - a - e > 0) t.insert(a, neu.slice(a, neu.length - e));
}

type TicketRoh = Record<string, unknown> & { id: string };
/**
 * M498: Reihenfolge aus Rängen. Mit Rang: aufsteigend (gleich → nach Kennung, auf allen Geräten gleich). Ohne Rang
 * (seit dem letzten Umsortieren über einen anderen Weg dazugekommen): direkt hinter dem Vorgänger, hinter dem es im
 * Gespeicherten steht. Das ist stabil — schreibt der Schreiber die so geordnete Liste, ergibt sie geordnet wieder
 * dieselbe (ein Rang „Stelle im Gespeicherten" für die übrigen wäre es nicht: die Stellen verrutschen beim Schreiben).
 */
function ordnen<T extends { id: string }>(liste: T[], rang: (id: string) => number | undefined): T[] {
  if (!liste.some((x) => rang(x.id) !== undefined)) return liste;
  const mit = liste.filter((x) => rang(x.id) !== undefined)
    .sort((a, b) => (rang(a.id)! - rang(b.id)!) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const folger = new Map<string | null, T[]>();
  let vor: string | null = null;
  for (const x of liste) {
    if (rang(x.id) === undefined) { const l = folger.get(vor) ?? []; l.push(x); folger.set(vor, l); }
    vor = x.id;
  }
  const aus: T[] = [];
  const nach = (id: string | null, tiefe: number): void => {
    if (tiefe > 5000) return;
    for (const f of folger.get(id) ?? []) { aus.push(f); nach(f.id, tiefe + 1); }
  };
  nach(null, 0);
  for (const x of mit) { aus.push(x); nach(x.id, 0); }
  return aus.length === liste.length && aus.every((x, i) => x === liste[i]) ? liste : aus;
}
const zahl = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** Werte für das Dokument: nur, was JSON ist (undefined → null = „Feld entfernt") */
const rein = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)) as unknown);
const gleich = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * M498: Welche Felder eines Tickets über das Dokument laufen — und wie ein gültiger Wert aussieht. Das Dokument ist eine
 * fremde Eingabe (Kanal): Was nicht passt, bleibt beim Lesen außen vor (der Schreiber speichert nur Gültiges); ein
 * unbekanntes Feld geht beim Ändern den Weg über den Speicher.
 */
const kurz = (v: unknown, n = 400): boolean => typeof v === 'string' && v.length <= n;
const kennung = (v: unknown): boolean => kurz(v, 200);
const FELD_OK: Record<string, (v: unknown) => boolean> = {
  col: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 100,
  due: (v) => kurz(v, 40),
  prio: (v) => v === 1 || v === 2 || v === 3,
  who: (v) => kurz(v, 200),
  deps: (v) => Array.isArray(v) && v.length <= 200 && v.every(kennung),
  links: (v) => Array.isArray(v) && v.length <= 100 && v.every((l) => !!l && typeof l === 'object' && kennung((l as { boardId?: unknown }).boardId) && kennung((l as { nodeId?: unknown }).nodeId)),
  link: (v) => !!v && typeof v === 'object' && kennung((v as { boardId?: unknown }).boardId)
    && ['nodeId', 'itemId'].every((k) => (v as Record<string, unknown>)[k] === undefined || kennung((v as Record<string, unknown>)[k])),
  erledigtAm: (v) => kurz(v, 40),
  archiviertAm: (v) => kurz(v, 40),
  zurueckAm: (v) => kurz(v, 40),
  spalteSeit: (v) => typeof v === 'number' && Number.isFinite(v),
};
const PUNKT_OK: Record<string, (v: unknown) => boolean> = { text: (v) => kurz(v, 2000), done: (v) => typeof v === 'boolean' };

/** M498: Die Überlagerung aus der Y.Map `kanban`, einmal je Durchgang zerlegt */
interface Ueberlagerung {
  felder: Map<string, Map<string, unknown>>;
  rang: Map<string, number>;
  punkte: Map<string, Map<string, Map<string, unknown>>>;
}
function ueberlagerung(m: Y.Map<unknown>): Ueberlagerung {
  const u: Ueberlagerung = { felder: new Map(), rang: new Map(), punkte: new Map() };
  for (const [key, v] of m.entries()) {
    const t = key.split(TR);
    if (t[0] === 'f' && t.length === 3 && t[2] !== 'id') {
      const f = u.felder.get(t[1]) ?? new Map<string, unknown>();
      f.set(t[2], v); u.felder.set(t[1], f);
    } else if (t[0] === 'o' && t.length === 2) {
      const r = zahl(v); if (r !== undefined) u.rang.set(t[1], r);
    } else if (t[0] === 's' && t.length === 4 && t[3] !== 'id') {
      const je = u.punkte.get(t[1]) ?? new Map<string, Map<string, unknown>>();
      const p = je.get(t[2]) ?? new Map<string, unknown>();
      p.set(t[3], v); je.set(t[2], p); u.punkte.set(t[1], je);
    }
  }
  return u;
}
type Punkt = { id: string; text: string; done?: boolean };
function punkteAnwenden(subs: Punkt[], je: Map<string, Map<string, unknown>>): Punkt[] {
  const da = new Set(subs.map((p) => p.id));
  const liste: Punkt[] = [];
  for (const p of subs) {
    const o = je.get(p.id);
    if (!o) { liste.push(p); continue; }
    if (o.get('x') === true) continue;
    const q = { ...p } as Record<string, unknown>;
    for (const [k, v] of o) {
      if (!PUNKT_OK[k] || (v !== null && !PUNKT_OK[k](v))) continue;
      if (v === null || v === undefined) delete q[k]; else q[k] = v;
    }
    if (typeof q.text !== 'string') q.text = p.text;
    liste.push(q as Punkt);
  }
  for (const [sid, o] of je) {
    if (da.has(sid) || o.get('x') === true || !PUNKT_OK.text(o.get('text')) || !kennung(sid)) continue;
    liste.push({ id: sid, text: o.get('text') as string, ...(o.get('done') === true ? { done: true } : {}) });
  }
  return ordnen(liste, (id) => zahl(je.get(id)?.get('o')));
}

/**
 * M487: Die Texte einer Kanban-Karte gemeinsam öffnen (Ticket-Fenster im Live-Board). Anders als beim Block-Editor
 * entsteht das Dokument nicht beim Öffnen, sondern je Feld beim ersten Binden — ebenso deterministisch (Hilfsdokument
 * mit einer Yjs-Kennung aus Karte, Feld und gespeichertem Text): Zwei, die dasselbe Ticket zugleich öffnen, legen
 * dieselben Einträge an. M498: dazu die übrigen Felder, Checklisten und die Reihenfolge (Y.Map `kanban`, siehe oben).
 */
export async function kanbanOeffnen(boardId: string, nodeId: string, darf: boolean, warten: boolean): Promise<FeldSitzung> {
  let docHier: Y.Doc | null = null;
  const texteAus = (doc: Y.Doc): Record<string, string> => {
    const aus: Record<string, string> = {};
    for (const [k, v] of doc.getMap(TEXTE).entries()) if (v instanceof Y.Text) aus[k] = v.toString();
    return aus;
  };
  /** M498: Die gespeicherten Tickets mit dem gemeinsamen Stand (dieselbe Liste, wenn nichts anders ist) */
  const anwenden = (items: KanbanItem[]): KanbanItem[] => {
    const doc = docHier;
    if (!doc || !Array.isArray(items)) return items;
    const u = ueberlagerung(doc.getMap(KANBAN));
    const texte = texteAus(doc);
    const geordnet = ordnen(items, (id) => u.rang.get(id));
    let anders = geordnet !== items;
    const aus = geordnet.map((it) => {
      const roh = it as unknown as TicketRoh;
      let x = roh;
      const kopie = () => { if (x === roh) x = { ...roh }; };
      for (const [feld, v] of u.felder.get(it.id) ?? []) {
        if (!FELD_OK[feld] || (v !== null && !FELD_OK[feld](v)) || gleich(x[feld], v)) continue;
        kopie();
        if (v === null || v === undefined) delete x[feld]; else x[feld] = v;
      }
      for (const f of ['text', 'note'] as const) {
        const v = texte[`${it.id}:${f}`];
        if (v === undefined) continue;
        // Eine leere Beschreibung heißt „keine" (wie im Ticket-Fenster ohne Live-Kanal)
        const soll = f === 'note' && v === '' ? undefined : v;
        if ((x[f] ?? undefined) === soll) continue;
        kopie();
        if (soll === undefined) delete x[f]; else x[f] = soll;
      }
      const je = u.punkte.get(it.id);
      if (je) {
        const vorher = (Array.isArray(x.subs) ? x.subs : []) as Punkt[];
        const nachher = punkteAnwenden(vorher, je);
        if (!gleich(vorher, nachher)) { kopie(); x.subs = nachher; }
      }
      if (x !== roh) anders = true;
      return x as unknown as KanbanItem;
    });
    return anders ? aus : items;
  };
  const s = await kernOeffnen({
    boardId, nodeId, n: nodeId, darf, warten,
    leer: () => false,
    anfangen: () => { /* je Feld, siehe feldText; M498: die Überlagerung beginnt leer */ },
    schreiben: () => {
      const st = useBoard.getState();
      const node = selectActiveBoard(st).nodes.find((x) => x.id === nodeId);
      if (!node || node.type !== 'kanban') return;
      const items = ((node.data as unknown as { items?: KanbanItem[] }).items) ?? [];
      const neu = anwenden(items);
      if (neu === items || gleich(neu, items)) return;
      st.updateNodeData(nodeId, { items: neu });
    },
  });
  const { doc, awareness } = s;
  docHier = doc;
  const karte = doc.getMap(TEXTE);
  const ueber = doc.getMap(KANBAN);
  // Jede Änderung (eigene und fremde) an den Schreiber; der Speicher-Abo heilt Fassungen von außen (wie bei der Notiz).
  // M498: jede Änderung im Dokument (Texte, Felder, Checklisten, Reihenfolge) — der Schreiber liest den Stand selbst
  const beiAenderung = () => s.aenderung(texteAus(doc));
  doc.on('update', beiAenderung);
  s.beimSchliessen(() => doc.off('update', beiAenderung));
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
  f.anwenden = anwenden;
  f.bei = (cb) => { doc.on('update', cb); return () => doc.off('update', cb); };
  /**
   * M498: Eine Änderung der Ticketliste als Überlagerung — nur, was sich zwischen `alt` und `neu` unterscheidet. Neue
   * oder entfernte Tickets lassen sich so nicht ausdrücken (sie gehen über den Speicher, siehe lib/kanbanLive.ts).
   */
  f.uebernehmen = (alt, neu) => {
    if (!Array.isArray(alt) || !Array.isArray(neu) || alt.length !== neu.length) return false;
    const A = new Map(alt.map((x) => [x.id, x]));
    if (A.size !== alt.length || new Set(neu.map((x) => x.id)).size !== neu.length || neu.some((x) => !A.has(x.id))) return false;
    // Wer nicht schreiben darf (nur lesen, Rechte der Gruppe), geht den Weg über den Speicher — dort greift der Schutz
    if ((awareness.getLocalState() as Anwesenheit | null)?.schreibt !== true) return false;
    // Nur Felder, die das Dokument kennt (und gültige Werte): sonst alles über den Speicher, nichts halb
    for (const x of neu) {
      const a = A.get(x.id)!;
      if (a === x) continue;
      const ra = a as unknown as TicketRoh; const rx = x as unknown as TicketRoh;
      for (const k of new Set([...Object.keys(ra), ...Object.keys(rx)])) {
        if (k === 'id' || gleich(ra[k], rx[k])) continue;
        if (k === 'text' || k === 'note') { if (rx[k] !== undefined && typeof rx[k] !== 'string') return false; continue; }
        if (k === 'subs') {
          const n = rx.subs;
          if (n !== undefined && (!Array.isArray(n) || n.some((p) => !p || typeof p !== 'object' || !kennung((p as Punkt).id) || !PUNKT_OK.text((p as Punkt).text)))) return false;
          continue;
        }
        if (!FELD_OK[k] || (rx[k] !== undefined && !FELD_OK[k](rx[k]))) return false;
      }
    }
    doc.transact(() => {
      if (alt.some((x, i) => x.id !== neu[i].id)) neu.forEach((x, i) => ueber.set(`o${TR}${x.id}`, i));
      for (const x of neu) {
        const a = A.get(x.id)!;
        if (a === x) continue;
        const ra = a as unknown as TicketRoh; const rx = x as unknown as TicketRoh;
        for (const k of new Set([...Object.keys(ra), ...Object.keys(rx)])) {
          if (k === 'id' || gleich(ra[k], rx[k])) continue;
          if (k === 'text' || k === 'note') {
            const anfang = typeof ra[k] === 'string' ? ra[k] as string : '';
            textAngleichen(feldText(`${x.id}:${k}`, anfang), typeof rx[k] === 'string' ? rx[k] as string : '');
            continue;
          }
          if (k === 'subs') { punkteSetzen(x.id, (Array.isArray(ra.subs) ? ra.subs : []) as Punkt[], (Array.isArray(rx.subs) ? rx.subs : []) as Punkt[]); continue; }
          ueber.set(`f${TR}${x.id}${TR}${k}`, rein(rx[k]));
        }
      }
    }, LOKAL_KANBAN);
    return true;
  };
  /** Checkliste: Punkte dazu, weg (Grabstein `x`), Text/Haken je Punkt; bei Dazu, Weg oder Umsortieren neue Ränge für alle */
  const punkteSetzen = (tid: string, a: Punkt[], n: Punkt[]): void => {
    const sk = (sid: string, k: string) => `s${TR}${tid}${TR}${sid}${TR}${k}`;
    const An = new Map(a.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
    const Nn = new Map(n.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
    let gebaut = false;
    for (const p of An.values()) if (!Nn.has(p.id)) { ueber.set(sk(p.id, 'x'), true); gebaut = true; }
    for (const p of Nn.values()) {
      const q = An.get(p.id) as unknown as Record<string, unknown> | undefined;
      const rp = p as unknown as Record<string, unknown>;
      if (!q) gebaut = true;
      for (const k of new Set([...Object.keys(rp), ...Object.keys(q ?? {})])) {
        if (!PUNKT_OK[k] || (q && gleich(q[k], rp[k]))) continue;
        if (!q && rp[k] === undefined) continue;
        ueber.set(sk(p.id, k), rein(rp[k]));
      }
    }
    const reiheA = [...An.keys()].filter((id) => Nn.has(id)).join(TR);
    const reiheN = [...Nn.keys()].filter((id) => An.has(id)).join(TR);
    if (gebaut || reiheA !== reiheN) [...Nn.keys()].forEach((sid, i) => ueber.set(sk(sid, 'o'), i));
  };
  f.feldBinden = (el, key, anfang) => {
    const t = feldText(key, anfang);
    const um = new Y.UndoManager(t, { trackedOrigins: new Set([LOKAL]), captureTimeout: 500 });
    el.value = t.toString();
    const cursorMelden = () => {
      if (document.activeElement !== el || awareness.getLocalState() === null) return;
      const a = el.selectionStart ?? 0; const k = el.selectionEnd ?? 0;
      // M498: die Stelle auch als relative Yjs-Position — sie wandert beim Empfänger mit, wenn davor getippt wird
      const rel = (i: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(t, Math.min(i, t.length))) as unknown;
      awareness.setLocalStateField('cursor', { feld: key, a, k, ra: rel(a), rk: rel(k) });
    };
    const cursorWeg = () => { if (awareness.getLocalState() !== null && (awareness.getLocalState() as { cursor?: { feld?: string } }).cursor?.feld === key) awareness.setLocalStateField('cursor', null); };
    const eingabe = () => {
      if (t.toString() !== el.value) doc.transact(() => textAngleichen(t, el.value), LOKAL);
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
    const t = karte.get(key);
    const len = t instanceof Y.Text ? t.length : 0;
    /** M498: Stelle des anderen in diesem Dokument — die relative Position zuerst, sonst die Zahl (ältere Fassung) */
    const stelle = (rel: unknown, roh: unknown): number => {
      if (rel && typeof rel === 'object' && t instanceof Y.Text) {
        try {
          const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), doc);
          if (abs && abs.type === t) return Math.max(0, Math.min(len, abs.index));
        } catch { /* fremde Eingabe: nicht lesbar */ }
      }
      return typeof roh === 'number' && Number.isFinite(roh) ? Math.max(0, Math.min(len, Math.round(roh))) : len;
    };
    for (const [cid, st] of awareness.getStates()) {
      const x = st as { cursor?: { feld?: unknown; a?: unknown; k?: unknown; ra?: unknown; rk?: unknown } | null; user?: { name?: unknown; color?: unknown } } | null;
      if (cid === doc.clientID || !x || x.cursor?.feld !== key) continue;
      aus.push({
        name: typeof x.user?.name === 'string' ? x.user.name.slice(0, 40) : 'Jemand',
        farbe: typeof x.user?.color === 'string' ? x.user.color : '',
        a: stelle(x.cursor.ra, x.cursor.a), k: stelle(x.cursor.rk, x.cursor.k), cid,
      });
    }
    return aus;
  };
  f.beiAnwesenheit = (cb) => { awareness.on('change', cb); return () => awareness.off('change', cb); };
  return f;
}

/**
 * M498: Einen Checklisten-Punkt einer Notiz setzen (erledigt bzw. offen), während im Live-Board womöglich jemand
 * gemeinsam darin schreibt — ein eingesammeltes Ticket, das erledigt wird, oder der Haken in der Aufgaben-Zentrale.
 * Vorher ging das über den Speicher: Der Schreiber der Notiz „heilte" den Haken wieder weg, und das Ersetzen im Editor
 * (extEpoch) drehte die letzten Zeichen der anderen zurück (wie beim Protokoll vor M493). Hält dieses Gerät die Notiz
 * schon gemeinsam offen, ändert es deren Dokument (der Editor sichert); sonst tritt es kurz bei. False, wenn der Punkt
 * im gemeinsamen Stand nicht vorkommt.
 */
export async function notizHaken(
  boardId: string, nodeId: string, blocks: unknown[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, blockId: string, an: boolean,
): Promise<boolean> {
  const da = sitzungen.get(schluessel(boardId, nodeId));
  const s: NotizSitzung = da && da.bereit() ? da : await sitzungOeffnen(boardId, nodeId, blocks, schema, true, true);
  const eigen = s !== da;
  try {
    const el = checkpunkt(s.doc.getXmlFragment(FRAGMENT), blockId);
    if (!el) return false;
    const war = el.getAttribute('checked') as unknown;
    if ((war === true || war === 'true') !== an) s.doc.transact(() => el.setAttribute('checked', an as never), LOKAL_PROTOKOLL);
    // Ohne eigenen Editor: den Stand selbst in Blöcke wandeln (nur, wenn dieses Gerät gerade sichert)
    if (eigen && s.istSchreiber()) {
      const ed = BlockNoteEditor.create({ schema });
      s.aenderung(yXmlFragmentToBlocks(ed as never, s.doc.getXmlFragment(FRAGMENT)));
    } else if (!eigen) (da as SitzungIntern).neuSichern();   // der Editor hat den Haken schon (y-prosemirror, synchron)
    s.jetztSenden();
    return true;
  } finally {
    if (eigen) s.schliessen();
  }
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

  /**
   * Wer speichert? Unter allen mit offener Notiz, die schreiben dürfen: wer es schon tut (`sichert`), sonst die kleinste
   * Kennung. M484: Vorher galt allein die kleinste Kennung — kam jemand mit kleinerer Kennung dazu (seine Notiz wacht
   * auf, weil ein anderer darin tippt), wechselte der Schreiber mitten im Tippen: Beide sicherten kurz nacheinander,
   * der Besitzer schrieb den Text des Gasts ins Konto (m383 D2, unter Last). Jetzt bleibt der Schreiber, bis er geht;
   * melden zwei zugleich Anspruch an, gilt unter ihnen die kleinste Kennung.
   */
  const schreiberKennung = (): string | null => {
    let best: string | null = null;
    let bestMitAnspruch: string | null = null;
    for (const [cid, st] of awareness.getStates()) {
      const s = st as Anwesenheit | null;
      if (!s || typeof s.pn !== 'string' || s.schreibt !== true) continue;
      const k = `${s.pn}\u0000${String(cid).padStart(10, '0')}`;
      if (best === null || k < best) best = k;
      if (s.sichert === true && (bestMitAnspruch === null || k < bestMitAnspruch)) bestMitAnspruch = k;
    }
    return bestMitAnspruch ?? best;
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
    anspruchMelden(jetzt);
  }
  /** M484: den anderen sagen, ob dieses Gerät gerade sichert (Feld `sichert` in der Anwesenheit) */
  function anspruchMelden(an: boolean): void {
    const st = awareness.getLocalState() as Anwesenheit | null;
    if (!st || zu || (st.sichert === true) === an) return;
    awareness.setLocalState({ ...st, sichert: an });
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
  /** M493: woher der aktuelle Stand des Editors kommt (anbinden) */
  let quelle: (() => unknown) | null = null;
  const sichern = (jetzt: unknown) => {
    if (!istSchreiber()) return;
    const st = useBoard.getState();
    if (st.activeId !== boardId) return;   // Board gewechselt: updateNodeData träfe das neue
    mutedHistory(() => auftrag.schreiben(jetzt));
  };
  let standKam: (() => void) | null = null;
  /** M493: Fragen (`hallo`), die kamen, während dieses Gerät selbst noch wartete — beantwortet, sobald es steht */
  const fragen: Array<{ c: number; sv: Uint8Array | undefined }> = [];
  /** M493: Ein anderes Gerät mit kleinerer Kennung öffnet dieselbe Sitzung gerade auch — sein Anfang gilt */
  let kleinererBeginnt = false;
  const antworten = (an: number, sv: Uint8Array | undefined) => {
    jetztSenden();
    // Der Neue soll den Cursor gleich sehen. M484: VOR dem Stand — mit dem Stand beginnt er, und wer schon sichert,
    // muss er da schon kennen, sonst meldet er selbst Anspruch an
    if (awareness.getLocalState() !== null) awSenden();
    senden(boardId, { c: doc.clientID, n, a: 'stand', an, d: zuB64(Y.encodeStateAsUpdate(doc, sv)), sv: zuB64(Y.encodeStateVector(doc)) });
  };
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
      quelle = dokument;
      // Der bisherige Schreiber ging: einmal den ganzen Stand sichern
      const ab = s.beiSchreiber(() => sichern(dokument()));
      // Der Schreiber heilt: Kommt die Notiz von außen mit anderem Text an (ein anderer hat sie verschoben oder umgefärbt
      // und dabei seinen etwas älteren gespeicherten Text mitgeschickt; eine ältere App-Fassung), gilt das Y-Dokument —
      // Lage und Farbe bleiben, der Text wird wieder der gemeinsame.
      let alt: unknown = null;
      // M493: Das eigene Heilen löst kein weiteres aus. Nimmt der Schutz der Karte (store/schutz.ts: ein anderer hält
      // sie oder tippt darin) den geschriebenen Stand sofort zurück, ist die Karte danach wieder „von außen anders" —
      // vorher sicherte der Schreiber dann in einer endlosen Kette von Mikroaufgaben, die Seite stand still (m477 lief
      // so ins Zeitlimit, hängend bei `keyboard.type`). Gesichert wird wieder bei der nächsten echten Änderung.
      let heilt = false;
      const abo = useBoard.subscribe((st) => {
        const k = st.activeId === boardId ? selectActiveBoard(st).nodes.find((x) => x.id === nodeId) : undefined;
        if (!k || k === alt) return;
        alt = k;
        if (heilt || !istSchreiber()) return;
        queueMicrotask(() => {
          if (zu) return;
          heilt = true;
          try { sichern(dokument()); } finally { heilt = false; }
        });
      });
      return () => { ab(); abo(); if (quelle === dokument) quelle = null; };
    },
    abschied() { if (letzter) sichern(letzter); },
    neuSichern() { sichern(quelle ? quelle() : letzter ?? undefined); },
    bereit: () => bereit && !zu,
    beimSchliessen(f) { if (zu) f(); else aufraeumen.push(f); },
    empfangen(m) {
      if (zu || m.c === doc.clientID || m.a === 'offen') return;
      if (m.a === 'hallo') {
        let sv: Uint8Array | undefined;
        try { sv = m.sv ? ausB64(m.sv) : undefined; Y.decodeStateVector(sv ?? new Uint8Array([0])); } catch { return; }
        if (!bereit) {
          // M493: Wer selbst noch wartet, hat noch nichts zu geben — er merkt sich die Frage und antwortet, sobald er
          // steht. Vorher blieb die Frage unbeantwortet, der andere begann nach seiner Wartezeit selbst aus SEINEM
          // gespeicherten Stand, und zwei verschiedene Anfänge landeten übereinander im Dokument (m487 B5).
          if (fragen.length < 20 && !fragen.some((f) => f.c === m.c)) fragen.push({ c: m.c, sv });
          // Beginnt gerade ein anderer mit kleinerer Kennung: auf SEINEN Stand warten statt selbst anzufangen
          if (`${m.von}\u0000${String(m.c).padStart(10, '0')}` < meineKennung()) kleinererBeginnt = true;
          return;
        }
        antworten(m.c, sv);
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
    if (!bekamStand && (bekamAenderung || kleinererBeginnt)) {
      // Es wird getippt, aber die Grundlage fehlt noch — oder ein anderer fängt gerade an (M493): einmal nachfragen
      senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
      await warteAuf(NOCHMAL_MS);
    }
    if (!bekamStand && kleinererBeginnt && !zu) {
      // M493: unter Last kann sein Anfang länger brauchen — noch einmal, dann (Rückfall) selbst
      senden(boardId, { c: doc.clientID, n, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
      await warteAuf(NOCHMAL_MS * 2);
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
  anspruchMelden(warSchreiber);
  // M493: wer während des Wartens fragte, bekommt jetzt den Stand
  for (const f of fragen.splice(0)) antworten(f.c, f.sv);
  return s;
}
