// M366: Änderungen an einem Board als Liste der betroffenen Objekte („Patch") — statt des ganzen Boards.
//
// Ein Patch nennt je Art (Karten, Verbindungen, Striche, Kommentar-Gespräche), was gesetzt und was gelöscht wurde.
// „Gesetzt" heißt: Das Objekt ersetzt sein Gegenstück mit derselben Kennung oder kommt neu dazu. Patches sind
// absolut (kein „füge Text ein"), darum schadet es nicht, einen zweimal anzuwenden. Der Server (gast_aendern)
// wendet sie genauso an wie patchAnwenden hier.
//
// M472: Zeit- und Merkfelder (lib/abgleichZeiten.ts) zählen hier bewusst MIT – eine Karte, die nur einen späteren
// Stempel bekam (nach dem Zusammenführen), reist so zu den anderen. Ob zwei Fassungen sich wirklich widersprechen,
// entscheidet allein der Drei-Wege-Abgleich (syncMerge.ts), in den jede Abweichung mündet (gastSync → mischen).
import { karteEntschaerfen, karteGueltig } from './sicher';
import type { BoardDoc } from '../store';

export type Art = 'nodes' | 'edges' | 'drawings' | 'comments';
export const ARTEN: Art[] = ['nodes', 'edges', 'drawings', 'comments'];
type Obj = { id: string };
export type Patch = Partial<Record<Art, { set?: Obj[]; del?: string[] }>>;

const liste = (b: BoardDoc, a: Art): Obj[] => (b as unknown as Record<Art, Obj[] | undefined>)[a] ?? [];

/** Was hat sich von `basis` zu `neu` geändert? `null`: nichts (Reihenfolge und Board-Felder zählen nicht). */
export function patchAus(basis: BoardDoc, neu: BoardDoc): Patch | null {
  const p: Patch = {};
  let etwas = false;
  for (const a of ARTEN) {
    const A = liste(basis, a); const B = liste(neu, a);
    if (A === B) continue;
    const alt = new Map(A.map((o) => [o.id, o]));
    const set: Obj[] = [];
    for (const o of B) {
      const v = alt.get(o.id);
      if (!v || (v !== o && JSON.stringify(v) !== JSON.stringify(o))) set.push(o);
      alt.delete(o.id);
    }
    const del = [...alt.keys()];
    if (set.length || del.length) { p[a] = { ...(set.length ? { set } : {}), ...(del.length ? { del } : {}) }; etwas = true; }
  }
  return etwas ? p : null;
}

/** Patch auf ein Board anwenden: Ersetztes bleibt an seinem Platz, Neues kommt ans Ende */
export function patchAnwenden(b: BoardDoc, p: Patch): BoardDoc {
  let aus = b;
  for (const a of ARTEN) {
    const t = p[a];
    if (!t || (!t.set?.length && !t.del?.length)) continue;
    const set = new Map((t.set ?? []).filter((o) => o && typeof o.id === 'string').map((o) => [o.id, o]));
    const del = new Set(t.del ?? []);
    const neu: Obj[] = [];
    for (const o of liste(aus, a)) {
      if (del.has(o.id)) continue;
      const s = set.get(o.id);
      if (s) { neu.push(s); set.delete(o.id); } else neu.push(o);
    }
    for (const o of set.values()) if (!del.has(o.id)) neu.push(o);
    aus = { ...aus, [a]: neu } as BoardDoc;
  }
  return aus;
}

/** Ist das überhaupt ein Patch? (Nachrichten aus dem Kanal sind fremde Eingaben) */
export function istPatch(x: unknown): x is Patch {
  if (!x || typeof x !== 'object') return false;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!(ARTEN as string[]).includes(k) || !v || typeof v !== 'object') return false;
    const t = v as { set?: unknown; del?: unknown };
    if (t.set !== undefined && !(Array.isArray(t.set) && t.set.every((o) => o && typeof o === 'object' && typeof (o as Obj).id === 'string'))) return false;
    if (t.del !== undefined && !(Array.isArray(t.del) && t.del.every((d) => typeof d === 'string'))) return false;
  }
  return true;
}

/**
 * M388: Ein Patch aus dem Kanal oder vom Server, bevor er ins Board kommt: Karten müssen Karten sein (Lage, Art,
 * Inhalt), Verbindungen zwei Enden haben, Striche Punkte, Gespräche Beiträge — sonst fällt das Stück weg.
 * Adressen in Karten werden entschärft.
 */
export function patchSaeubern(p: Patch): Patch {
  const aus: Patch = {};
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  for (const a of ARTEN) {
    const t = p[a];
    if (!t) continue;
    let set = t.set as unknown[] | undefined;
    if (set) {
      if (a === 'nodes') set = set.filter(karteGueltig).map((n) => karteEntschaerfen(n));
      else if (a === 'edges') set = set.filter((e) => text((e as { source?: unknown }).source) && text((e as { target?: unknown }).target));
      else if (a === 'drawings') set = set.filter((s) => Array.isArray((s as { points?: unknown }).points));
      else if (a === 'comments') set = set.filter((c) => Array.isArray((c as { msgs?: unknown }).msgs));
    }
    (aus as Record<string, unknown>)[a] = { ...(set ? { set } : {}), ...(t.del ? { del: t.del } : {}) };
  }
  return aus;
}

type Mass = { id: string; measured?: unknown };
/** Karten des einen Stands mit den Maßen des anderen (nach Kennung) — die misst jedes Gerät selbst, sie sind keine Änderung */
function mitMassenVon(b: BoardDoc, quelle: BoardDoc): BoardDoc {
  const q = new Map(quelle.nodes.map((n) => [n.id, n as Mass]));
  let anders = false;
  const nodes = b.nodes.map((n) => {
    const m = q.get(n.id);
    const eigen = (n as Mass).measured;
    if (!m || eigen === m.measured || JSON.stringify(eigen) === JSON.stringify(m.measured)) return n;
    anders = true;
    const kopie = { ...n } as Mass;
    if (m.measured === undefined) delete kopie.measured; else kopie.measured = m.measured;
    return kopie as typeof n;
  });
  return anders ? { ...b, nodes } : b;
}
const kanonisch = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(kanonisch);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, kanonisch((x as Record<string, unknown>)[k])]));
  return x;
};
/** Die Angaben des Boards selbst (Name, Tönung, Archiv …) — ohne Karten, Verbindungen, Striche, Kommentare */
const boardFelder = (b: BoardDoc): string => {
  const rest: Record<string, unknown> = { ...(b as unknown as Record<string, unknown>) };
  for (const a of ARTEN) delete rest[a];
  return JSON.stringify(kanonisch(rest));
};

/**
 * M383: Lässt sich der Schritt von `basis` (dem Stand auf dem Server) zu `lokal` als Patch ausdrücken?
 *   · `null`: nein — die Angaben des Boards selbst oder die Reihenfolge (was liegt vor was) haben sich geändert;
 *     dann reist das ganze Board.
 *   · sonst der Patch (`p: null` = inhaltlich gleich, höchstens anders gemessen) und der Stand, den der Server
 *     danach hält.
 */
export function patchFuer(basis: BoardDoc, lokal: BoardDoc): { p: Patch | null; stand: BoardDoc } | null {
  if (boardFelder(basis) !== boardFelder(lokal)) return null;
  const ziel = mitMassenVon(lokal, basis);
  const p = patchAus(basis, ziel);
  const stand = p ? patchAnwenden(basis, p) : basis;
  for (const a of ARTEN) {
    const A = liste(stand, a); const B = liste(ziel, a);
    if (A.length !== B.length) return null;
    for (let i = 0; i < A.length; i += 1) if (A[i].id !== B[i].id) return null;
  }
  return { p, stand };
}
