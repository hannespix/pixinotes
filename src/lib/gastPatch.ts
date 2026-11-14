// M366: Änderungen an einem Board als Liste der betroffenen Objekte („Patch") — statt des ganzen Boards.
//
// Ein Patch nennt je Art (Karten, Verbindungen, Striche, Kommentar-Gespräche), was gesetzt und was gelöscht wurde.
// „Gesetzt" heißt: Das Objekt ersetzt sein Gegenstück mit derselben Kennung oder kommt neu dazu. Patches sind
// absolut (kein „füge Text ein"), darum schadet es nicht, einen zweimal anzuwenden. Der Server (gast_aendern)
// wendet sie genauso an wie patchAnwenden hier.
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
