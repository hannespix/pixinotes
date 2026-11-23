/**
 * Verlauf (Rückgängig/Wiederholen): Schnappschüsse, gezieltes Zurücknehmen in der Gruppe (M365), Tipp-Bündelung
 * (M122) und die Aktionen pushHistory, undo, redo, schritt.
 *
 * M480: aus src/store.ts herausgelöst (reiner Umbau) – src/store.ts bleibt der Einstieg und exportiert alles weiter.
 */
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types';
import type { Stroke, BoardDoc, CommentThread, BoardSnap, HistoryEntry, BoardState, Setzen, Holen } from './typen';
import { ohneStempel } from './schutz';
import { inDerived } from './speicher';
import { useBoard } from '../store';

/** Momentaufnahme aller genannten Boards (für mehrbrettrige Undo-Schritte) */
export const snapBoards = (boards: BoardDoc[], ids: string[]): BoardSnap[] =>
  ids.flatMap((id) => {
    const b = boards.find((x) => x.id === id);
    return b ? [{ boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments }] : [];
  });

/**
 * M388: Gespräche bei Rückgängig/Wiederholen. Sie sind kein eigener Schritt (ein Kommentar sichert nichts in den
 * Verlauf) — den alten Stand zurückzulegen, nähme darum Beiträge weg, die seither dazukamen. Stattdessen gehen sie
 * mit ihrer Karte: Verschwindet die Karte durch den Schritt, verschwinden ihre Gespräche; kehrt sie zurück, kehren
 * die Gespräche aus dem gemerkten Stand zurück. (Vorher waren sie nach „Löschen + Strg+Z" für immer weg und nach
 * „Verschieben + Strg+Z" hingen sie verwaist am Ziel-Board.)
 */
function kommentareNach(jetzt: CommentThread[] | undefined, gemerkt: CommentThread[] | undefined, vorher: AppNode[], nachher: AppNode[]): CommentThread[] | undefined {
  if (!jetzt?.length && !gemerkt?.length) return jetzt;
  const bleibt = new Set(nachher.map((n) => n.id));
  const war = new Set(vorher.map((n) => n.id));
  const aus = (jetzt ?? []).filter((c) => !c.nodeId || bleibt.has(c.nodeId));
  const da = new Set(aus.map((c) => c.id));
  let dazu = false;
  for (const c of gemerkt ?? []) {
    if (c.nodeId && bleibt.has(c.nodeId) && !war.has(c.nodeId) && !da.has(c.id)) { aus.push(c); dazu = true; }
  }
  return !dazu && aus.length === (jetzt ?? []).length ? jetzt : aus;
}

export const HISTORY_LIMIT = 50;

// ---------- M365: Rückgängig in der Gruppe — nur der eigene Schritt ----------
type Stand = { nodes: AppNode[]; edges: Edge[]; drawings?: Stroke[] };
const FLUECHTIG = new Set(['selected', 'dragging', 'resizing', 'measured']);
const ohneFluechtiges = (x: object): string => JSON.stringify(x, (k, v) => (FLUECHTIG.has(k) ? undefined : v));
export const gleichesObjekt = (a: object, b: object): boolean => a === b || ohneFluechtiges(a) === ohneFluechtiges(b);
/**
 * Einen eigenen Schritt gezielt umkehren. Der Schritt hat das Board von `zu` nach `von` gebracht; jetzt soll alles,
 * was er anfasste, wieder wie in `zu` sein — aber nur dort, wo es noch so ist, wie der Schritt es hinterließ.
 * Was andere inzwischen geändert haben, bleibt (und wird gezählt); was andere neu angelegt haben, sowieso.
 */
function gezieltZurueck(jetzt: Stand, von: Stand, zu: Stand, fremd?: Set<string>, gemischt?: Set<string>): { stand: Stand; getan: number; uebersprungen: number } {
  let getan = 0; let uebersprungen = gemischt?.size ?? 0;
  const liste = <T extends { id: string }>(cur: T[], vonL: T[], zuL: T[]): T[] => {
    if (vonL === zuL) return cur;
    const V = new Map(vonL.map((x) => [x.id, x]));
    const Z = new Map(zuL.map((x) => [x.id, x]));
    const C = new Map(cur.map((x) => [x.id, x]));
    const ersetzt = new Map<string, T>();
    const weg = new Set<string>();
    const dazu: T[] = [];
    for (const id of new Set([...V.keys(), ...Z.keys()])) {
      if (fremd?.has(id)) continue;   // hat (auch) jemand anderes angefasst — gehört nicht zu diesem Schritt
      const v = V.get(id); const z = Z.get(id); const c = C.get(id);
      if (v && z) {
        if (v === z || gleichesObjekt(v, z)) continue;
        if (c && gleichesObjekt(c, v)) { ersetzt.set(id, z); getan += 1; } else uebersprungen += 1;
      } else if (v && !z) {            // der Schritt hat es angelegt → wieder weg
        if (!c) continue;
        if (gleichesObjekt(c, v)) { weg.add(id); getan += 1; } else uebersprungen += 1;
      } else if (z && !c) { dazu.push(z); getan += 1; }   // der Schritt hat es entfernt → wieder da
    }
    if (ersetzt.size === 0 && weg.size === 0 && dazu.length === 0) return cur;
    // Reihenfolge: die des Ziel-Stands als Rückgrat (Eltern vor Kindern), danach, was andere neu angelegt haben
    const bleibt = new Map<string, T>();
    for (const x of cur) if (!weg.has(x.id)) bleibt.set(x.id, ersetzt.get(x.id) ?? x);
    for (const x of dazu) bleibt.set(x.id, x);
    const aus: T[] = [];
    for (const x of zuL) { const m = bleibt.get(x.id); if (m) { aus.push(m); bleibt.delete(x.id); } }
    for (const m of bleibt.values()) aus.push(m);
    return aus;
  };
  const nodes = liste(jetzt.nodes, von.nodes, zu.nodes);
  let edges = liste(jetzt.edges, von.edges, zu.edges);
  const ids = new Set(nodes.map((n) => n.id));   // Verbindungen ohne Karte gibt es nicht
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const drawings = jetzt.drawings || zu.drawings || von.drawings ? liste(jetzt.drawings ?? [], von.drawings ?? [], zu.drawings ?? []) : jetzt.drawings;
  return { stand: { nodes, edges, drawings }, getan, uebersprungen };
}
/** Kennungen der Karten, Verbindungen und Striche, die sich zwischen zwei Ständen unterscheiden */
export function geaenderteIds(a: Stand, b: Stand): string[] {
  const aus: string[] = [];
  const liste = <T extends { id: string }>(x: T[], y: T[]): void => {
    if (x === y) return;
    const Y = new Map(y.map((o) => [o.id, o]));
    for (const o of x) { const m = Y.get(o.id); if (!m || !gleichesObjekt(o, m)) aus.push(o.id); Y.delete(o.id); }
    for (const id of Y.keys()) aus.push(id);
  };
  liste(a.nodes, b.nodes); liste(a.edges, b.edges); liste(a.drawings ?? [], b.drawings ?? []);
  return aus;
}
/**
 * Es kommt etwas von außen in dieses Board (`fremdIds`: was sich dadurch ändert). Der JÜNGSTE Schritt bleibt offen —
 * Ziehen oder Tippen können noch laufen — und merkt sich nur, was die anderen angefasst haben. Ältere Schritte sind
 * abgeschlossen: Sie merken sich den Stand, den sie hinterließen (das „Vorher" ihres Nachfolgers).
 */
export function schritteAbgrenzen(liste: HistoryEntry[], boardId: string, jetzt: Stand, fremdIds: string[]): HistoryEntry[] {
  if (!liste.some((e) => e.boardId === boardId)) return liste;
  const aus = [...liste];
  let danach: Stand | null = null;
  for (let i = aus.length - 1; i >= 0; i -= 1) {
    const e = aus[i];
    if (e.boardId !== boardId) continue;
    if (danach === null) {
      // der jüngste Schritt dieses Boards
      if (!e.nach && fremdIds.length) {
        const vor = new Map<string, object>([...e.nodes, ...e.edges, ...(e.drawings ?? [])].map((o) => [o.id, o]));
        const hier = new Map<string, object>([...jetzt.nodes, ...jetzt.edges, ...(jetzt.drawings ?? [])].map((o) => [o.id, o]));
        const fremd = new Set(e.fremd ?? []); const gemischt = new Set(e.gemischt ?? []);
        for (const id of fremdIds) {
          const v = vor.get(id); const h = hier.get(id);
          // Hatte der Schritt die Stelle selbst schon geändert (oder angelegt/entfernt), bevor der andere kam?
          if (!fremd.has(id) && (!!v !== !!h || (v && h && !gleichesObjekt(v, h)))) gemischt.add(id);
          fremd.add(id);
        }
        aus[i] = { ...e, fremd: [...fremd], ...(gemischt.size ? { gemischt: [...gemischt] } : {}) };
      }
    } else if (!e.nach) aus[i] = { ...e, nach: danach };
    danach = { nodes: e.nodes, edges: e.edges, drawings: e.drawings };
  }
  return aus;
}
/** M365: Gleich kommt eine Karte von außen in dieses Board (Mitlesen beim Tippen) — die eigenen Schritte abgrenzen */
export function verlaufAbgrenzen(boardId: string, fremdIds: string[]): void {
  const s = useBoard.getState();
  const b = s.boards.find((x) => x.id === boardId);
  if (!b || (s.past.length === 0 && s.future.length === 0)) return;
  const jetzt: Stand = { nodes: b.nodes, edges: b.edges, drawings: b.drawings };
  const past = schritteAbgrenzen(s.past, boardId, jetzt, fremdIds);
  const future = schritteAbgrenzen(s.future, boardId, jetzt, fremdIds);
  if (past !== s.past || future !== s.future) useBoard.setState({ past, future });
}
/**
 * Rückgängig (`zurueck`) oder Wiederholen (`vor`) eines Schritts, nach dem Fremdes dazukam: gezielt statt als
 * ganzer Stand. Der Eintrag wandert mit vertauschten Rollen auf den anderen Stapel.
 */
function schrittGezielt(
  set: (teil: Partial<BoardState>) => void, s: BoardState, entry: HistoryEntry, richtung: 'zurueck' | 'vor',
): void {
  const board = s.boards.find((b) => b.id === entry.boardId);
  if (!board) return;
  const jetzt: Stand = { nodes: board.nodes, edges: board.edges, drawings: board.drawings };
  const zu: Stand = { nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings };
  // Abgeschlossener Schritt: sein gemerkter Stand danach. Offener (jüngster) Schritt: der Stand von jetzt.
  const von: Stand = entry.nach ?? jetzt;
  const r = gezieltZurueck(jetzt, von, zu, new Set(entry.fremd ?? []), new Set(entry.gemischt ?? []));
  const gegen: HistoryEntry = { boardId: entry.boardId, ...von, nach: zu, ...(entry.fremd ? { fremd: entry.fremd } : {}) };
  const stapel = richtung === 'zurueck'
    ? { past: s.past.slice(0, -1), future: r.getan ? [...s.future, gegen] : s.future }
    : { future: s.future.slice(0, -1), past: r.getan ? [...s.past, gegen] : s.past };
  const notizen = s.activeId === entry.boardId ? geaenderteNotizen(board.nodes, r.stand.nodes) : [];
  set({
    ...stapel,
    ...(r.getan ? { boards: s.boards.map((b) => (b.id === entry.boardId ? { ...b, nodes: r.stand.nodes, edges: r.stand.edges, drawings: r.stand.drawings } : b)) } : {}),
  });
  if (notizen.length) window.dispatchEvent(new CustomEvent(NOTIZ_EXTERN, { detail: notizen }));
  const was = richtung === 'zurueck' ? 'Zurückgenommen' : 'Wiederholt';
  if (r.uebersprungen && r.getan) useBoard.getState().showToast(`↩ ${was} – ${r.uebersprungen === 1 ? 'eine Stelle blieb' : `${r.uebersprungen} Stellen blieben`}, wie sie ist: Jemand anderes hat sie inzwischen geändert.`, false, 6000);
  else if (r.uebersprungen) useBoard.getState().showToast('↩ Nichts zurückgenommen – was dieser Schritt betraf, hat inzwischen jemand anderes geändert.', false, 6000);
}

/** Sammel-Aktionen (z. B. KI-Pläne): innere Mutatoren pushen KEINE eigenen
 *  History-Einträge — der Aufrufer sichert vorher genau einen Snapshot.
 *  So macht wirklich EIN Strg+Z den kompletten Plan rückgängig (Audit R6-K1). */
export let historyMuted = false;

export function mutedHistory<T>(fn: () => T): T {
  historyMuted = true;
  try {
    return fn();
  } finally {
    historyMuted = false;
  }
}

// Feingranulare History (M122): Modul-Bearbeitungen (Ticket-Felder, Diagramm-
// Code, Gantt-Zeilen, Notiz-Tipp-Bursts) werden undo-fähig. Aufeinander-
// folgende Änderungen am SELBEN Ziel innerhalb von 1,5 s teilen sich einen
// Eintrag — sonst würde jeder Tastendruck die History fluten.
export let lastEditKey = '';
export let lastEditAt = 0;
/** M480: Andere Scheiben (Karten, Struktur) setzen die Bündelung über diese beiden – ein importiertes `let` ist nur lesbar */
export function tippBuendelEnde(): void { lastEditKey = ''; }
export function tippBuendelMerken(key: string, at: number): void { lastEditKey = key; lastEditAt = at; }
export const EDIT_COALESCE_MS = 1500;

/** Haben sich Notiz-INHALTE zwischen zwei Ständen geändert? (Referenzvergleich)
 *  Dann muss Undo/Redo den Board-Remount erzwingen — BlockNote-Editoren lesen
 *  ihre Blöcke nur beim Mount und würden sonst alten Text zurückschreiben. */
function notesDiffer(a: AppNode[], b: AppNode[]): boolean {
  const blocksById = new Map(a.filter((n) => n.type === 'note').map((n) => [n.id, n.data.blocks]));
  return b.some((n) => {
    if (n.type !== 'note') return false;
    const prev = blocksById.get(n.id);
    return prev !== undefined && prev !== n.data.blocks;
  });
}
/** M364: Kennungen der Notizen, deren Inhalt sich zwischen zwei Ständen geändert hat (Referenzvergleich) */
export function geaenderteNotizen(a: AppNode[], b: AppNode[]): string[] {
  const blocksById = new Map(a.filter((n) => n.type === 'note').map((n) => [n.id, n.data.blocks]));
  return b.filter((n) => n.type === 'note' && blocksById.has(n.id) && blocksById.get(n.id) !== n.data.blocks).map((n) => n.id);
}
/** M365: Notizen, die von außen ins Board kamen (Abgleich) — sie ziehen den Schreib-Cursor nicht an sich. Eine
 *  frische, leere Notiz setzt den Cursor sonst sofort hinein; das gilt nur für selbst angelegte: Legt in der
 *  Gruppenarbeit jemand eine Notiz an, spränge bei allen anderen der Cursor dorthin (und sie „hielten" die Karte). */
const vonAussen = new Set<string>();
export const kamVonAussen = (id: string): boolean => vonAussen.has(id);
export function fremdeNotizenMerken(alt: BoardDoc[], neu: BoardDoc[]): void {
  const da = new Set<string>();
  for (const b of alt) for (const n of b.nodes) da.add(n.id);
  if (vonAussen.size > 4000) vonAussen.clear();
  for (const b of neu) for (const n of b.nodes) if (n.type === 'note' && !da.has(n.id)) vonAussen.add(n.id);
}
/** M364: „Diese Notizen wurden von außen geändert" — `detail`: Kennungen. Der Editor der Karte übernimmt den Stand. */
export const NOTIZ_EXTERN = 'pixinotes:notiz-extern';

/** M480: Teil des Board-Speichers – Verlauf (Rückgängig/Wiederholen) */
export function verlaufScheibe(set: Setzen, get: Holen) {
  return {
    // ---------- Undo/Redo (Board-Struktur) ----------
    past: [],
    future: [],

    pushHistory: () => {
      if (historyMuted) return; // Sammel-Aktionen (KI-Pläne) sichern EINEN Snapshot selbst
      lastEditKey = ''; // Struktur-Snapshot beendet jede Tipp-Bündelung (M122)
      const s = get();
      const b = s.boards.find((x) => x.id === s.activeId);
      if (!b) return;
      set({
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), { boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments }],
        future: [],
      });
    },

    pushHistoryBoards: (boardIds) => {
      if (historyMuted) return;
      lastEditKey = '';
      const s = get();
      const b = s.boards.find((x) => x.id === s.activeId);
      if (!b) return;
      const others = snapBoards(s.boards, [...new Set(boardIds)].filter((id) => id !== b.id));
      set({
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), {
          boardId: b.id, nodes: b.nodes, edges: b.edges, drawings: b.drawings, comments: b.comments, others,
        }],
        future: [],
      });
    },

    undo: () => ohneStempel(() => {
      const s = get();
      const entry = s.past[s.past.length - 1];
      if (!entry) return;
      const board = s.boards.find((b) => b.id === entry.boardId);
      if (!board) { set({ past: s.past.slice(0, -1) }); return; }
      // M365: Seit diesem Schritt kam Fremdes dazu → nur das Eigene zurücknehmen
      if (entry.nach || entry.fremd) { schrittGezielt(set, s, entry, 'zurueck'); return; }
      // Remount, wenn Notiz-Inhalte betroffen sind — egal woher der Eintrag
      // stammt (Versions-Restore, KI-Edit, Struktur-Undo über Tipp-Grenzen)
      const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
      // Mehr-Board-Schritt: alle Mitbetroffenen gemeinsam zurückdrehen
      const restore = new Map((entry.others ?? []).map((o) => [o.boardId, o]));
      // M388: Strg+Z beendet die Tipp-Bündelung (sonst sicherte die nächste Eingabe in dieselbe Karte keinen Schritt
      // und „Wiederholen" legte danach den alten Text über den neuen) — und das „zuletzt Gelöschte" ist mit dem
      // Zurücknehmen erledigt: Der Hinweis-Knopf legte es sonst ein zweites Mal aufs Board.
      lastEditKey = '';
      set({
        lastDeleted: null,
        past: s.past.slice(0, -1),
        future: [...s.future, {
          boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, comments: board.comments, remount,
          others: snapBoards(s.boards, [...restore.keys()]),
        }],
        activeId: entry.boardId,
        view: 'board',
        boards: s.boards.map((b) => {
          if (b.id === entry.boardId) return { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings, comments: kommentareNach(b.comments, entry.comments, b.nodes, entry.nodes) };
          const o = restore.get(b.id);
          return o ? { ...b, nodes: o.nodes, edges: o.edges, drawings: o.drawings, comments: kommentareNach(b.comments, o.comments, b.nodes, o.nodes) } : b;
        }),
        ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
      });
    }),

    redo: () => ohneStempel(() => {
      const s = get();
      const entry = s.future[s.future.length - 1];
      if (!entry) return;
      const board = s.boards.find((b) => b.id === entry.boardId);
      if (!board) { set({ future: s.future.slice(0, -1) }); return; }
      if (entry.nach || entry.fremd) { schrittGezielt(set, s, entry, 'vor'); return; }
      const remount = entry.remount || notesDiffer(board.nodes, entry.nodes);
      const restore = new Map((entry.others ?? []).map((o) => [o.boardId, o]));
      lastEditKey = '';
      set({
        lastDeleted: null,
        future: s.future.slice(0, -1),
        past: [...s.past, {
          boardId: board.id, nodes: board.nodes, edges: board.edges, drawings: board.drawings, comments: board.comments, remount,
          others: snapBoards(s.boards, [...restore.keys()]),
        }],
        activeId: entry.boardId,
        view: 'board',
        boards: s.boards.map((b) => {
          if (b.id === entry.boardId) return { ...b, nodes: entry.nodes, edges: entry.edges, drawings: entry.drawings, comments: kommentareNach(b.comments, entry.comments, b.nodes, entry.nodes) };
          const o = restore.get(b.id);
          return o ? { ...b, nodes: o.nodes, edges: o.edges, drawings: o.drawings, comments: kommentareNach(b.comments, o.comments, b.nodes, o.nodes) } : b;
        }),
        ...(remount ? { importEpoch: s.importEpoch + 1 } : {}),
      });
    }),

    /**
     * M390: Ein eigener Rückgängig-Schritt für Änderungen, die bisher keinen hatten (Etikett, Art und Aussehen
     * einer Verbindung, Größe ziehen, mit Pfeiltasten schieben). Ohne ihn nahm Strg+Z den Schritt DAVOR mit
     * zurück. Gebündelt wie beim Tippen: Dieselbe Sache innerhalb kurzer Zeit ist EIN Schritt.
     */
    schritt: (key) => {
      if (historyMuted || inDerived()) return;
      const now = Date.now();
      const k = `${get().activeId}:${key}`;
      const neu = k !== lastEditKey || now - lastEditAt > EDIT_COALESCE_MS;
      if (neu) get().pushHistory();
      lastEditKey = k;
      lastEditAt = now;
    },
  } satisfies Partial<BoardState>;
}
