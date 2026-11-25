/**
 * M532: Lesen und Schreiben der Ablage für ausgelagerte data-URLs (siehe ablage.ts). Wird nachgeladen.
 *
 * Dieselbe IndexedDB wie Anhänge, Tool-Quelltexte und die Abgleich-Basis (`pixinotes-sync`, Tabelle `kv`) — hier
 * bewusst ohne lib/syncFolder, damit die Speicherschicht nicht am ganzen Abgleich hängt. Datenbankname, Version und
 * Tabelle müssen mit lib/syncFolder.ts übereinstimmen.
 */
import { A, AUSLAGERN_AB, VERWEIS_MUSTER, ablageErsetzer, abarbeiten as planeLauf, alsGesichertMerken, planen } from './ablage';
import { runDerived, speicherAuswahl } from './speicher';
import type { BoardDoc, BoardState } from './typen';
import { useBoard } from '../store';
/** M397 (nachgeladen, siehe start.ts → alteNamenOhneEmoji) */
export { namenOhneEmoji } from './ohneEmoji';

/** Verweise im rohen JSON-Text (mit Anführungszeichen) */
const VERWEIS_IM_TEXT = /"(pixinotes-ablage:[0-9a-z]{1,12}-[0-9a-z]{1,12}-\d{1,10})"/g;
const verweiseIn = (roh: string): Set<string> => new Set([...roh.matchAll(VERWEIS_IM_TEXT)].map((m) => m[1]));
/** Die gespeicherten Felder, die Inhalte tragen können (alles, was speicherAuswahl schreibt) */
const inhaltsFelder = (s: BoardState): Record<string, unknown> => ({ ...speicherAuswahl(s), boards: s.boards });

/**
 * Nach dem Laden des Stands (speicher.ts → standBereit, main.tsx zeichnet erst danach): Verweise durch ihre Inhalte
 * ersetzen — per runDerived (kein Hochladen, kein Rückgängig-Schritt), Unverändertes bleibt dasselbe Objekt. Ein
 * alter Stand mit eingebetteten Bildern zieht im Leerlauf in die Ablage um (ohne den Start zu verzögern).
 */
export async function nachDemLaden(roh: string): Promise<void> {
  const verweise = verweiseIn(roh);
  if (verweise.size) {
    const inhalte = await inhalteLaden(verweise);
    for (const [v, x] of inhalte) alsGesichertMerken(v, x);
    const s = useBoard.getState();
    const teil: Record<string, unknown> = {};
    for (const [k, alt] of Object.entries(inhaltsFelder(s))) {
      const neu = verweiseEinsetzen(alt, inhalte);
      if (neu !== alt) teil[k] = neu;
    }
    if (Object.keys(teil).length) runDerived(() => useBoard.setState(teil as Partial<BoardState>));
  }
  if (roh.length > AUSLAGERN_AB && roh.includes('"data:')) {
    const umziehen = () => vormerken(inhaltsFelder(useBoard.getState()));
    if (typeof requestIdleCallback === 'function') requestIdleCallback(umziehen, { timeout: 4000 }); else setTimeout(umziehen, 1500);
  }
}
/** Mitlese-Fenster (adoptPersistedState): Boards eines rohen Stands mit eingesetzten Inhalten */
export async function mitInhalten(roh: string, boards: BoardDoc[]): Promise<BoardDoc[]> {
  const inhalte = await inhalteLaden(verweiseIn(roh));
  for (const [v, x] of inhalte) alsGesichertMerken(v, x);
  return verweiseEinsetzen(boards, inhalte);
}

let offen: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!offen) {
    offen = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('pixinotes-sync', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { d.close(); offen = null; };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
    });
    offen.catch(() => { offen = null; });
  }
  return offen;
}

/** Inhalt unter seinem Verweis ablegen; true erst, wenn die Schreibtransaktion abgeschlossen ist */
export async function inhaltSichern(verweis: string, daten: string): Promise<boolean> {
  try {
    const d = await db();
    return await new Promise<boolean>((resolve) => {
      // `strict`: erst nach dem Schreiben auf die Platte melden — danach darf der Text den Verweis tragen
      const tx = d.transaction('kv', 'readwrite', { durability: 'strict' } as IDBTransactionOptions);
      tx.objectStore('kv').put(daten, verweis);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch { return false; }
}

/** Inhalte zu den Verweisen holen (was fehlt, fehlt in der Antwort) */
export async function inhalteLaden(verweise: Iterable<string>): Promise<Map<string, string>> {
  const aus = new Map<string, string>();
  const liste = [...new Set(verweise)].filter((v) => VERWEIS_MUSTER.test(v));
  if (!liste.length) return aus;
  const d = await db();
  await new Promise<void>((resolve) => {
    const tx = d.transaction('kv', 'readonly');
    const kv = tx.objectStore('kv');
    for (const v of liste) {
      const req = kv.get(v);
      req.onsuccess = () => {
        const x = req.result as unknown;
        if (typeof x === 'string' && x.startsWith('data:')) { aus.set(v, x); A.zaehler.geladen += 1; } else A.zaehler.fehlt += 1;
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  return aus;
}

/** Verweise in einem Wert durch ihre Inhalte ersetzen; Unverändertes bleibt dasselbe Objekt (M525-Speichergedächtnis) */
export function verweiseEinsetzen<T>(wert: T, inhalte: Map<string, string>): T {
  const tausch = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length < 64 && inhalte.has(v) ? inhalte.get(v) : v;
    if (Array.isArray(v)) {
      let neu: unknown[] | null = null;
      for (let i = 0; i < v.length; i++) {
        const t = tausch(v[i]);
        if (t !== v[i]) { neu ??= v.slice(); neu[i] = t; }
      }
      return neu ?? v;
    }
    if (v && typeof v === 'object') {
      let neu: Record<string, unknown> | null = null;
      for (const k of Object.keys(v)) {
        const alt = (v as Record<string, unknown>)[k];
        const t = tausch(alt);
        if (t !== alt) { neu ??= { ...(v as Record<string, unknown>) }; neu[k] = t; }
      }
      return neu ?? v;
    }
    return v;
  };
  return tausch(wert) as T;
}

let dauerhaftGefragt = false;
/** Alles Offene sichern, eins nach dem anderen (ein großer Schub würde die IndexedDB für Sekunden belegen). Läuft als A.lauf. */
export async function abarbeiten(): Promise<void> {
  // Erst am Ende (gemeinsam mit nachSichern) als gesichert führen: Wüchse `gesichert` mittendrin, passte ein vorher
  // gemerkter Text (mit data-URL) nicht mehr zum Stand, den ein Schreiben dazwischen prüft
  const neu: string[] = [];
  try {
    for (;;) {
      const naechster = A.offen.entries().next();
      if (naechster.done) break;
      const [r, daten] = naechster.value;
      A.offen.delete(r);
      if (A.gesichert.has(r)) continue;
      if (await inhaltSichern(r, daten)) { neu.push(r); A.zaehler.gesichert += 1; } else A.zaehler.fehler += 1;
    }
  } catch {
    // keine IndexedDB (privates Fenster, gesperrt): die data-URLs bleiben im Text — wie bisher
    A.zaehler.fehler += 1;
    A.offen.clear();
  } finally {
    A.lauf = null;
    if (A.offen.size) planen();   // kam während des Laufs noch etwas dazu
  }
  if (neu.length > 0) {
    for (const r of neu) A.gesichert.add(r);
    // Den Browser bitten, die Ablage nicht bei Platzmangel zu räumen (einmal; er entscheidet selbst)
    if (!dauerhaftGefragt) { dauerhaftGefragt = true; void navigator.storage?.persist?.().catch(() => false); }
    A.nachSichern();
  }
}

/** Alle großen data-URLs in einem Wert zum Sichern vormerken (ohne Text zu bauen) */
export function vormerken(wert: unknown): void {
  const gehe = (v: unknown): void => {
    if (typeof v === 'string') { if (v.length >= AUSLAGERN_AB) ablageErsetzer('', v); return; }
    if (Array.isArray(v)) { for (const x of v) gehe(x); return; }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) gehe((v as Record<string, unknown>)[k]);
  };
  gehe(wert);
}

/** Vormerken und warten, bis alles gesichert ist (siehe ablage.ts → ablageVorab) */
export async function vorab(wert: unknown): Promise<void> {
  vormerken(wert);
  for (let i = 0; i < 50 && (A.offen.size || A.lauf); i++) await (A.lauf ?? planeLauf());
}
