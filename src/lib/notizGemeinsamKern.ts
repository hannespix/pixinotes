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
/** Board → Notiz → Name eines anderen, der gerade darin tippt (Cursor im Editor) — an den Speicher (setzeNotizSchutz) */
const schutz = new Map<string, Map<string, string>>();
function schutzSetzen(boardId: string, nodeId: string, name: string | null): void {
  const m = new Map(schutz.get(boardId) ?? []);
  if ((m.get(nodeId) ?? null) === name) return;
  if (name) m.set(nodeId, name); else m.delete(nodeId);
  if (m.size) schutz.set(boardId, m); else schutz.delete(boardId);
  setzeNotizSchutz(boardId, m);
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
    const ns = [...sitzungen.values()].filter((x) => x.boardId === boardId && x.bereit()).map((x) => x.nodeId).slice(0, 200);
    if (ns.length) liveSenden(boardId, NOTIZ_Y_EREIGNIS, { von: ich().id, c: 1, n: '_', a: 'offen', ns } satisfies NotizYNachricht);
  }, 60 + Math.random() * 240));
}

// ---------- Sitzung ----------
export interface NotizSitzung {
  readonly boardId: string;
  readonly nodeId: string;
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
  aenderung(dokument: unknown[]): void;
  /** Den Editor anbinden: darf er schreiben, woher kommt sein Stand (für den Schreiberwechsel) — gibt das Lösen zurück */
  anbinden(darf: boolean, dokument: () => unknown[]): () => void;
  /** Beim Verlassen: den letzten Stand sichern (der Editor ist dann womöglich schon abgebaut) */
  abschied(): void;
  schliessen(): void;
}
interface SitzungIntern extends NotizSitzung { empfangen(m: NotizYNachricht): void; rundeGeaendert(): void; bereit(): boolean }

interface Anwesenheit { pn?: unknown; schreibt?: unknown; sichert?: unknown }

/**
 * Eine Notiz gemeinsam öffnen. Löst auf, sobald das Dokument steht (Stand der anderen da oder aus dem Block-JSON
 * begonnen) — vorher darf kein Editor entstehen: Ein Editor auf leerem Dokument legte seinen eigenen leeren Absatz
 * an, und zwei Geräte hätten dann zwei.
 */
export async function sitzungOeffnen(
  boardId: string, nodeId: string, blocks: unknown[], // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any, darf: boolean,
  /** Arbeitet hier schon jemand (lib/notizGemeinsam.ts gemeinsamGewuenscht)? Nur dann auf seinen Stand warten */
  warten = true,
): Promise<NotizSitzung> {
  horchen();
  const alt = sitzungen.get(schluessel(boardId, nodeId));
  if (alt) alt.schliessen();
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(FRAGMENT);
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
    if (!leer(u)) senden(boardId, { c: doc.clientID, n: nodeId, a: 'upd', d: zuB64(u) });
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
    senden(boardId, { c: doc.clientID, n: nodeId, a: 'aw', d: zuB64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
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
      schutzSetzen(boardId, nodeId, wer);
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
    senden(boardId, { c: doc.clientID, n: nodeId, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
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
  let letzter: unknown[] | null = null;
  const sichern = (jetzt: unknown[]) => {
    if (!istSchreiber()) return;
    const st = useBoard.getState();
    if (st.activeId !== boardId) return;   // Board gewechselt: updateNodeData träfe das neue
    const alt = selectActiveBoard(st).nodes.find((n) => n.id === nodeId)?.data.blocks;
    if (alt && JSON.stringify(alt) === JSON.stringify(jetzt)) return;
    mutedHistory(() => st.updateNodeData(nodeId, { blocks: jetzt }));
  };
  let standKam: (() => void) | null = null;
  const s: SitzungIntern = {
    boardId, nodeId, doc, awareness,
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
        const n = st.activeId === boardId ? selectActiveBoard(st).nodes.find((x) => x.id === nodeId) : undefined;
        if (!n || n === alt) return;
        alt = n;
        if (istSchreiber()) queueMicrotask(() => { if (!zu) sichern(dokument()); });
      });
      return () => { ab(); abo(); };
    },
    abschied() { if (letzter) sichern(letzter); },
    bereit: () => bereit && !zu,
    empfangen(m) {
      if (zu || m.c === doc.clientID || m.a === 'offen') return;
      if (m.a === 'hallo') {
        if (!bereit) return;   // wer selbst noch wartet, hat nichts zu geben
        let sv: Uint8Array | undefined;
        try { sv = m.sv ? ausB64(m.sv) : undefined; Y.decodeStateVector(sv ?? new Uint8Array([0])); } catch { return; }
        jetztSenden();
        // Der Neue soll den Cursor gleich sehen. M484: VOR dem Stand — mit dem Stand beginnt er, und wer schon sichert,
        // muss er da schon kennen, sonst meldet er selbst Anspruch an
        if (awareness.getLocalState() !== null) awSenden();
        senden(boardId, { c: doc.clientID, n: nodeId, a: 'stand', an: m.c, d: zuB64(Y.encodeStateAsUpdate(doc, sv)), sv: zuB64(Y.encodeStateVector(doc)) });
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
            if (!leer(fehlt)) senden(boardId, { c: doc.clientID, n: nodeId, a: 'upd', d: zuB64(fehlt) });
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
      schutzSetzen(boardId, nodeId, null);
      clearTimeout(awTimer);
      schreiberRufe.clear();
      if (sitzungen.get(schluessel(boardId, nodeId)) === s) sitzungen.delete(schluessel(boardId, nodeId));
      awareness.destroy();
      doc.destroy();
    },
  };
  sitzungen.set(schluessel(boardId, nodeId), s);

  // --- Start: erst fragen, dann (falls niemand antwortet) aus dem Block-JSON beginnen ---
  const andere = teilnehmerVon(boardId).some((t) => t.id !== selbst) || teilnehmerVon(boardId).length === 0;
  if (liveVerbunden(boardId) && andere && !warten) {
    // Niemand arbeitet in dieser Notiz: sofort beginnen, die anderen nur wecken (sie fragen dann selbst)
    senden(boardId, { c: doc.clientID, n: nodeId, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
  } else if (liveVerbunden(boardId) && andere) {
    const warten = (ms: number) => new Promise<void>((auf) => {
      const t = setTimeout(() => { standKam = null; auf(); }, ms);
      standKam = () => { clearTimeout(t); standKam = null; auf(); };
    });
    senden(boardId, { c: doc.clientID, n: nodeId, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
    await warten(WARTE_MS);
    if (!bekamStand && bekamAenderung) {
      // Es wird getippt, aber die Grundlage fehlt noch: einmal nachfragen
      senden(boardId, { c: doc.clientID, n: nodeId, a: 'hallo', sv: zuB64(Y.encodeStateVector(doc)) });
      await warten(NOCHMAL_MS);
    }
  }
  if (zu) return s;
  if (!bekamStand && fragment.length === 0) {
    // Aus dem gespeicherten Block-JSON beginnen — deterministisch (siehe Kopf)
    const roh = Array.isArray(blocks) && blocks.length ? blocks : [{ type: 'paragraph' }];
    const mitIds = mitKennungen(roh, `pn${streuwert(nodeId).toString(36)}`);
    const hilf = new Y.Doc();
    hilf.clientID = (streuwert(`${nodeId}\n${JSON.stringify(mitIds)}`) % 0x7ffffffe) + 1;
    const ed = BlockNoteEditor.create({ schema });
    blocksToYXmlFragment(ed as never, mitIds as never, hilf.getXmlFragment(FRAGMENT));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(hilf), 'init');
    hilf.destroy();
  }
  bereit = true;
  anwesenheitSetzen();
  // Änderungen, die während des Wartens hier entstanden (sollte nicht vorkommen), jetzt hinaus
  if (offen.length) jetztSenden();
  warSchreiber = istSchreiber();
  anspruchMelden(warSchreiber);
  return s;
}
