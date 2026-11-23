/**
 * M449: Board-Versionen — frühere Stände eines Boards ansehen und zurückholen.
 *
 * Strg+Z reicht 50 Schritte zurück und endet mit dem Neuladen. Was gestern auf
 * dem Board stand, war bisher nur über einen alten Datei-Export zu bekommen.
 * Hier legt PixiNotes selbst Stände ab: beim Verlassen eines Boards, spätestens
 * alle 10 Minuten, wenn sich etwas geändert hat, und VOR Vorgängen, die viel auf
 * einmal umbauen (Import, Abgleich mit Ordner/Konto, KI-Umbau).
 *
 * Wo: IndexedDB (wie die Datei-Inhalte, lib/fileStore.ts) — nicht im
 * localStorage, dessen 5 MB der Board-Stand schon selbst braucht.
 *
 *   ver-ix:<boardId>   Liste der Stände (VersionInfo[], älteste zuerst)
 *   ver:<versionId>    Inhalt eines Standes (Karten, Pfeile, Striche, Gespräche)
 *   ver-blob:<hash>    große Zeichenketten (eingebettete Bilder, kleine Dateien)
 *
 * Größenbewusst: Große Zeichenketten liegen nur EINMAL in `ver-blob:` — ein
 * Foto, das sich über 30 Stände nicht ändert, kostet einmal Platz. Inhalte im
 * Gerätespeicher (große Dateien, Tool-Quelltexte) bleiben unter der Kennung
 * ihrer Karte liegen; der Stand merkt sich nur die Kennung (`anhaenge`), und das
 * Aufräumen beim Start (App.tsx) lässt sie stehen, solange ein Stand sie braucht.
 *
 * Ausdünnen: letzte Stunde alles, letzter Tag einer je Stunde, älter einer je
 * Tag; höchstens 50 Stände und ~20 MB je Board.
 *
 * Wiederherstellen ist eine gewöhnliche Änderung am Board (store.standEinsetzen):
 * ein Rückgängig-Schritt, der wie jede Änderung in den Sync geht — kein
 * Sonderweg, der Ordner oder Konto übergeht.
 */
import { idbDel, idbGet, idbKeys, idbSet } from './syncFolder';
import { persistHaken, useBoard, vorUmbauHaken, type BoardDoc, type CommentThread, type Stroke } from '../store';
import type { AppNode } from '../types';
import { inhaltGeaendert } from './kartenZeit';
import type { Edge } from '@xyflow/react';

export type VersionGrund = 'verlassen' | 'automatisch' | 'sitzung' | 'manuell' | 'abgleich' | 'import' | 'ki' | 'wiederherstellen' | 'team';

export interface VersionInfo {
  id: string;
  boardId: string;
  /** Zeitpunkt (ms) */
  at: number;
  grund: VersionGrund;
  /** Board-Name zum Zeitpunkt des Standes */
  name: string;
  karten: number;
  pfeile: number;
  /** Prüfsumme des Inhalts — gleicher Stand wird nicht doppelt gesichert */
  sig: string;
  /** Größe des Standes ohne die geteilten großen Zeichenketten (Bytes, grob) */
  bytes: number;
  /** Hashes der ausgelagerten großen Zeichenketten */
  blobs: string[];
  /** Karten, deren Inhalt im Gerätespeicher unter ihrer Kennung liegt (Datei, Tool, Excel-Tabelle) */
  anhaenge: string[];
}

export interface VersionStand {
  nodes: AppNode[];
  edges: Edge[];
  drawings?: Stroke[];
  comments?: CommentThread[];
}

export const GRUND_TEXT: Record<VersionGrund, string> = {
  verlassen: 'Board verlassen',
  automatisch: 'Automatisch',
  sitzung: 'Vor der ersten Änderung',
  manuell: 'Von Hand gesichert',
  abgleich: 'Vor Abgleich',
  import: 'Vor Import',
  ki: 'Vor KI-Umbau',
  wiederherstellen: 'Vor Wiederherstellen',
  team: 'Vor Änderungen anderer',
};

export const VERSIONEN_MAX = 50;
const BYTES_MAX = 20 * 1024 * 1024;
const BLOB_AB = 16 * 1024;
export const TAKT_MS = 10 * 60 * 1000;
/** M460: Höchstens eine Sicherung „Vor Änderungen anderer" je Board in diesem Abstand (ein Team schiebt oft in Schüben) */
export const FREMD_ABSTAND_MS = 2 * 60 * 1000;
const STUNDE = 3600_000;
const TAG = 24 * STUNDE;

const IX = (boardId: string) => `ver-ix:${boardId}`;
const VER = (id: string) => `ver:${id}`;
const BLOB = (h: string) => `ver-blob:${h}`;
const BLOB_MARKE = '__verBlob';

/** Schneller 53-Bit-Hash (cyrb53) — reicht zum Wiedererkennen; die Länge steht mit im Schlüssel */
function hash(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '-' + s.length.toString(36);
}

/** Der Teil des Boards, der zum Stand gehört — Auswahl und Ziehen zählen nicht als Änderung */
function standVon(b: BoardDoc): VersionStand {
  const sauber = persistHaken.board(b); // M388: Mitgelesenes anderer gehört nicht in meinen Stand
  return {
    nodes: sauber.nodes.map((n) => (n.selected || n.dragging ? { ...n, selected: false, dragging: false } : n)),
    edges: sauber.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    ...(sauber.drawings?.length ? { drawings: sauber.drawings } : {}),
    ...(sauber.comments?.length ? { comments: sauber.comments } : {}),
  };
}

const leer = (s: VersionStand) => !s.nodes.length && !s.edges.length && !(s.drawings?.length);

/**
 * Welche Stände bleiben? Neueste zuerst betrachtet: in der letzten Stunde alle, bis 24 Stunden einer je Stunde,
 * älter einer je Kalendertag; danach höchstens VERSIONEN_MAX und BYTES_MAX (die ältesten gehen zuerst).
 * Pur — die Prüfreihe misst das Ergebnis über die Liste im Dialog.
 */
export function ausduennen(liste: VersionInfo[], jetzt = Date.now()): VersionInfo[] {
  const neu = [...liste].sort((a, b) => b.at - a.at);
  const gesehen = new Set<string>();
  const bleibt: VersionInfo[] = [];
  for (const v of neu) {
    const alter = jetzt - v.at;
    let fach: string | null = null;
    if (alter >= TAG) { const d = new Date(v.at); fach = `t${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
    else if (alter >= STUNDE) fach = `h${Math.floor(v.at / STUNDE)}`;
    if (fach) { if (gesehen.has(fach)) continue; gesehen.add(fach); }
    bleibt.push(v);
  }
  let summe = 0;
  const ende: VersionInfo[] = [];
  for (const v of bleibt) {
    if (ende.length >= VERSIONEN_MAX) break;
    if (ende.length >= 3 && summe + v.bytes > BYTES_MAX) break;
    summe += v.bytes;
    ende.push(v);
  }
  return ende.sort((a, b) => a.at - b.at);
}

/** Alle Schreibvorgänge nacheinander — sonst überschrieben sich zwei Sicherungen gegenseitig die Liste */
let kette: Promise<unknown> = Promise.resolve();
function nacheinander<T>(fn: () => Promise<T>): Promise<T> {
  const p = kette.then(fn, fn);
  kette = p.catch(() => {});
  return p;
}

const letzteSig = new Map<string, string>();
const letzteZeit = new Map<string, number>();

export async function versionenVon(boardId: string): Promise<VersionInfo[]> {
  try {
    const l = (await idbGet<VersionInfo[]>(IX(boardId))) ?? [];
    return [...l].sort((a, b) => b.at - a.at);
  } catch { return []; }
}

function auslagern(wert: unknown, blobs: Map<string, string>): unknown {
  if (typeof wert === 'string') {
    if (wert.length < BLOB_AB) return wert;
    const h = hash(wert);
    blobs.set(h, wert);
    return { [BLOB_MARKE]: h };
  }
  if (Array.isArray(wert)) return wert.map((w) => auslagern(w, blobs));
  if (wert && typeof wert === 'object') {
    const aus: Record<string, unknown> = {};
    for (const [k, w] of Object.entries(wert)) aus[k] = auslagern(w, blobs);
    return aus;
  }
  return wert;
}

async function einlagern(wert: unknown, cache: Map<string, string>): Promise<unknown> {
  if (Array.isArray(wert)) return Promise.all(wert.map((w) => einlagern(w, cache)));
  if (wert && typeof wert === 'object') {
    const o = wert as Record<string, unknown>;
    if (typeof o[BLOB_MARKE] === 'string' && Object.keys(o).length === 1) {
      const h = o[BLOB_MARKE] as string;
      if (!cache.has(h)) cache.set(h, (await idbGet<string>(BLOB(h))) ?? '');
      return cache.get(h);
    }
    const aus: Record<string, unknown> = {};
    for (const [k, w] of Object.entries(o)) aus[k] = await einlagern(w, cache);
    return aus;
  }
  return wert;
}

const ANHANG_TYPEN = new Set(['file', 'htmlapp', 'sheet']);

/**
 * Stand eines Boards sichern. Der Inhalt wird SOFORT (synchron) festgehalten — wer direkt danach umbaut
 * (Import, Abgleich), verändert den gesicherten Stand nicht mehr. Geschrieben wird danach in Ruhe.
 * `abstandMs`: nicht sichern, wenn der letzte Stand jünger ist (Abgleich im Hintergrund).
 * Rückgabe: der neue Stand, `'gleich'` (schon gesichert) oder null (leer, zu früh, Fehler).
 */
export function versionSichern(b: BoardDoc | undefined, grund: VersionGrund, abstandMs = 0): Promise<VersionInfo | 'gleich' | null> {
  if (!b) return Promise.resolve(null);
  const stand = standVon(b);
  const name = b.name;
  const jetzt = Date.now();
  return nacheinander(async () => {
    try {
      const json = JSON.stringify(stand);
      const sig = hash(json);
      const liste = (await idbGet<VersionInfo[]>(IX(b.id))) ?? [];
      const letzte = liste[liste.length - 1];
      if (letzte?.sig === sig) { letzteSig.set(b.id, sig); return 'gleich'; }
      if (leer(stand) && !letzte) return null;
      if (abstandMs && letzte && jetzt - letzte.at < abstandMs) return null;
      const blobs = new Map<string, string>();
      const inhalt = auslagern(JSON.parse(json), blobs);
      const vorhanden = new Set((await idbKeys()).map(String));
      for (const [h, s] of blobs) if (!vorhanden.has(BLOB(h))) await idbSet(BLOB(h), s);
      const id = `${b.id}-${jetzt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await idbSet(VER(id), inhalt);
      const info: VersionInfo = {
        id, boardId: b.id, at: jetzt, grund, name,
        karten: stand.nodes.length, pfeile: stand.edges.length, sig,
        bytes: json.length - [...blobs.values()].reduce((s, x) => s + x.length, 0),
        blobs: [...blobs.keys()],
        anhaenge: stand.nodes.filter((n) => ANHANG_TYPEN.has(n.type ?? '')).map((n) => n.id),
      };
      const bleibt = ausduennen([...liste, info], jetzt);
      await idbSet(IX(b.id), bleibt);
      const weg = [...liste, info].filter((v) => !bleibt.includes(v));
      for (const v of weg) await idbDel(VER(v.id));
      if (weg.length) await blobsAufraeumen(vorhanden);
      letzteSig.set(b.id, sig);
      letzteZeit.set(b.id, jetzt);
      return bleibt.includes(info) ? info : null;
    } catch {
      return null; // Eine Sicherung ist Kür — sie darf nie eine Bedienung stören
    }
  });
}

/** Große Zeichenketten, die kein Stand mehr braucht, entsorgen */
async function blobsAufraeumen(schluessel?: Set<string>): Promise<void> {
  const keys = schluessel ?? new Set((await idbKeys()).map(String));
  const gebraucht = new Set<string>();
  for (const k of keys) {
    if (!k.startsWith('ver-ix:')) continue;
    for (const v of (await idbGet<VersionInfo[]>(k)) ?? []) for (const h of v.blobs ?? []) gebraucht.add(h);
  }
  for (const k of keys) if (k.startsWith('ver-blob:') && !gebraucht.has(k.slice(9))) await idbDel(k);
}

/**
 * M460: Einen Stand löschen. Geteilte große Zeichenketten (`ver-blob:`) bleiben, solange ein anderer Stand sie
 * braucht. Datei- und Tool-Inhalte (`file:`/`html:` unter der Kartenkennung) werden hier NICHT angefasst: Sie können
 * auch an Karten jetzt, an anderen Ständen, an Vorlagen oder an einem Rückgängig-Schritt hängen. Das Aufräumen beim
 * Start (App.tsx, `versionsAnhaenge`) gibt sie frei, sobald sie niemand mehr braucht — dieselbe Regel wie bisher.
 */
export function versionLoeschen(boardId: string, versionId: string): Promise<boolean> {
  return nacheinander(async () => {
    try {
      const liste = (await idbGet<VersionInfo[]>(IX(boardId))) ?? [];
      const bleibt = liste.filter((v) => v.id !== versionId);
      if (bleibt.length === liste.length) return false;
      if (bleibt.length) await idbSet(IX(boardId), bleibt); else await idbDel(IX(boardId));
      await idbDel(VER(versionId));
      await blobsAufraeumen();
      // Der „gleiche Stand"-Schutz merkt sich die letzte Prüfsumme — nach dem Löschen des jüngsten gilt die davor
      const letzte = bleibt[bleibt.length - 1];
      if (letzte) { letzteSig.set(boardId, letzte.sig); letzteZeit.set(boardId, letzte.at); }
      else { letzteSig.delete(boardId); letzteZeit.delete(boardId); }
      return true;
    } catch { return false; }
  });
}

export interface KartenVergleich {
  /** Seitdem neu (gibt es jetzt, damals nicht) */
  neu: AppNode[];
  /** Seitdem gelöscht (die Fassung aus dem Stand) */
  geloescht: AppNode[];
  /** Seitdem inhaltlich geändert: damalige und jetzige Fassung */
  geaendert: { dann: AppNode; jetzt: AppNode }[];
  /** M470: Seitdem gelöschte Verbindungen (die Fassung aus dem Stand) */
  pfeileGeloescht: Edge[];
  /** M470: Seitdem geänderte Verbindungen (Beschriftung, Enden, Aussehen) */
  pfeileGeaendert: { dann: Edge; jetzt: Edge }[];
  /** M470: Seitdem gelöschte Striche */
  stricheGeloescht: Stroke[];
  /** M470: Seitdem geänderte Striche (Farbe, Breite, Punkte) */
  stricheGeaendert: { dann: Stroke; jetzt: Stroke }[];
}

/** M470: Vergleichstext eines Objekts — Schlüssel sortiert (zwei Wege bauen dieselben Daten in anderer Reihenfolge),
 *  Auswahl und Ziehen zählen nicht */
function stabil(wert: unknown): string {
  const ordnen = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordnen);
    if (v && typeof v === 'object') {
      const aus: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (k === 'selected' || k === 'dragging') continue;
        aus[k] = ordnen((v as Record<string, unknown>)[k]);
      }
      return aus;
    }
    return v;
  };
  return JSON.stringify(ordnen(wert)) ?? '';
}

/** M470: gelöscht und geändert je Kennung (Pfeile, Striche) */
function listenVergleich<T extends { id: string }>(dann: T[], jetzt: T[]): { geloescht: T[]; geaendert: { dann: T; jetzt: T }[] } {
  const hier = new Map(jetzt.map((x) => [x.id, x]));
  const geloescht: T[] = [];
  const geaendert: { dann: T; jetzt: T }[] = [];
  for (const d of dann) {
    const j = hier.get(d.id);
    if (!j) geloescht.push(d);
    else if (j !== d && stabil(j) !== stabil(d)) geaendert.push({ dann: d, jetzt: j });
  }
  return { geloescht, geaendert };
}

const inhalt = (n: AppNode) => (n.data ?? {}) as Record<string, unknown>;
/**
 * M460: Was ist seit dem Stand passiert — Karte für Karte. „Geändert" heißt: der INHALT (data) ist anders; Lage,
 * Größe und Ansichtsfelder (Monat, Zoom, Filter … — dieselbe Liste wie M453) zählen nicht. Pur.
 */
export function kartenVergleich(stand: VersionStand, jetzt: AppNode[], jetztPfeile: Edge[] = [], jetztStriche: Stroke[] = []): KartenVergleich {
  const dann = new Map(stand.nodes.map((n) => [n.id, n]));
  const hier = new Map(jetzt.map((n) => [n.id, n]));
  const neu = jetzt.filter((n) => !dann.has(n.id));
  const geloescht = stand.nodes.filter((n) => !hier.has(n.id));
  const geaendert: KartenVergleich['geaendert'] = [];
  for (const d of stand.nodes) {
    const j = hier.get(d.id);
    if (!j || j.data === d.data) continue;
    if (j.type !== d.type || inhaltGeaendert(inhalt(d), inhalt(j)) || inhaltGeaendert(inhalt(j), inhalt(d))) geaendert.push({ dann: d, jetzt: j });
  }
  // M470: auch Verbindungen und Striche
  const p = listenVergleich(stand.edges ?? [], jetztPfeile);
  const s = listenVergleich(stand.drawings ?? [], jetztStriche);
  return {
    neu, geloescht, geaendert,
    pfeileGeloescht: p.geloescht, pfeileGeaendert: p.geaendert,
    stricheGeloescht: s.geloescht, stricheGeaendert: s.geaendert,
  };
}

export async function versionLaden(id: string): Promise<VersionStand | null> {
  try {
    const roh = await idbGet<unknown>(VER(id));
    if (!roh) return null;
    return (await einlagern(roh, new Map())) as VersionStand;
  } catch { return null; }
}

/** Kennungen von Karten, deren Gerätespeicher-Inhalt ein Stand noch braucht (fürs Aufräumen beim Start) */
export async function versionsAnhaenge(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    for (const k of (await idbKeys()).map(String)) {
      if (!k.startsWith('ver-ix:')) continue;
      for (const v of (await idbGet<VersionInfo[]>(k)) ?? []) for (const a of v.anhaenge ?? []) ids.add(a);
    }
  } catch { /* lieber nichts aufräumen als falsch */ }
  return ids;
}

/** Beim Start: Stände gelöschter Boards nach 30 Tagen entsorgen (Löschen lässt sich bis dahin noch bereuen) */
export function verwaisteAufraeumen(boardIds: Set<string>): Promise<void> {
  return nacheinander(async () => {
    try {
      const keys = new Set((await idbKeys()).map(String));
      let weg = false;
      for (const k of keys) {
        if (!k.startsWith('ver-ix:') || boardIds.has(k.slice(7))) continue;
        const l = (await idbGet<VersionInfo[]>(k)) ?? [];
        if (l.length && Date.now() - Math.max(...l.map((v) => v.at)) < 30 * TAG) continue;
        for (const v of l) await idbDel(VER(v.id));
        await idbDel(k);
        weg = true;
      }
      if (weg) await blobsAufraeumen();
    } catch { /* Kür */ }
  });
}

/** Das Ereignis, das den Dialog öffnet (App.tsx lädt ihn erst dann) */
export const VERSIONEN_EREIGNIS = 'pixinotes:versionen';
export const versionenOeffnen = (boardId?: string) =>
  window.dispatchEvent(new CustomEvent(VERSIONEN_EREIGNIS, { detail: { boardId } }));

let gestartet = false;
/**
 * Auslöser verdrahten: Board verlassen, Takt (10 min bei Änderungen), Fenster verdeckt,
 * und der Haken im Store vor Abgleich/Import (vorUmbauHaken).
 */
export function initBoardVersionen(): void {
  if (gestartet) return;
  gestartet = true;
  /** Boards mit Änderungen seit ihrer letzten Sicherung */
  const geaendert = new Set<string>();
  /** Boards, deren Stand VOR der ersten Änderung dieser Sitzung schon gesichert ist */
  const basis = new Set<string>();

  // M460: Große Änderung anderer — vorher sichern, gedrosselt je Board (nicht über die 10-Minuten-Bremse des Abgleichs)
  const letzterSchub = new Map<string, number>();
  vorUmbauHaken.fremdSchub = (b) => {
    const jetzt = Date.now();
    if (jetzt - (letzterSchub.get(b.id) ?? 0) < FREMD_ABSTAND_MS) return;
    letzterSchub.set(b.id, jetzt);
    void versionSichern(b, 'team');
    basis.add(b.id);
  };
  vorUmbauHaken.sichern = (boards, grund) => {
    for (const b of boards) {
      void versionSichern(b, grund, grund === 'abgleich' ? TAKT_MS : 0);
      basis.add(b.id);
    }
  };

  // Was beim Start von selbst nachgetragen wird (Fristen, Seitenbreiten, Abgleich hat seinen eigenen Haken), ist keine
  // Änderung des Nutzers — sonst entstünde bei jedem Start eine Version
  const bereitAb = Date.now() + 2500;
  useBoard.subscribe((s, prev) => {
    if (s.boards !== prev.boards && Date.now() >= bereitAb) {
      const alt = new Map(prev.boards.map((b) => [b.id, b]));
      for (const b of s.boards) {
        const a = alt.get(b.id);
        if (!a || a === b) continue;
        if (a.nodes === b.nodes && a.edges === b.edges && a.drawings === b.drawings && a.comments === b.comments) continue;
        geaendert.add(b.id);
        // Der Stand vor der ersten Änderung dieser Sitzung — der wichtigste, wenn etwas schiefgeht
        if (!basis.has(b.id)) { basis.add(b.id); void versionSichern(a, 'sitzung'); }
      }
    }
    const verlassen = prev.activeId !== s.activeId || (prev.view === 'board' && s.view !== 'board');
    if (verlassen && geaendert.has(prev.activeId)) {
      geaendert.delete(prev.activeId);
      void versionSichern(s.boards.find((b) => b.id === prev.activeId), 'verlassen');
    }
  });

  const faelligeSichern = (grund: VersionGrund, sofort: boolean) => {
    const st = useBoard.getState();
    for (const id of [...geaendert]) {
      const zuletzt = letzteZeit.get(id) ?? 0;
      if (!sofort && Date.now() - zuletzt < TAKT_MS) continue;
      geaendert.delete(id);
      void versionSichern(st.boards.find((b) => b.id === id), grund);
    }
  };
  // Die Zeit der letzten Sicherung je Board aus dem Speicher holen (sonst sicherte der erste Takt sofort)
  void (async () => {
    for (const b of useBoard.getState().boards) {
      const l = await versionenVon(b.id);
      if (l[0] && !letzteZeit.has(b.id)) letzteZeit.set(b.id, l[0].at);
    }
  })();
  window.setInterval(() => faelligeSichern('automatisch', false), 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') faelligeSichern('verlassen', true); });
}
