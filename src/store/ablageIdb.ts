/**
 * M532: Lesen und Schreiben der Ablage für ausgelagerte data-URLs (siehe ablage.ts). Wird nachgeladen.
 *
 * Dieselbe IndexedDB wie Anhänge, Tool-Quelltexte und die Abgleich-Basis (`pixinotes-sync`, Tabelle `kv`) — hier
 * bewusst ohne lib/syncFolder, damit die Speicherschicht nicht am ganzen Abgleich hängt. Datenbankname, Version und
 * Tabelle müssen mit lib/syncFolder.ts übereinstimmen.
 */
import { A, AUSLAGERN_AB, VERWEIS_MUSTER, ablageErsetzer, abarbeiten as planeLauf, alsGesichertMerken, planen, pruefsumme } from './ablage';
import { reserve, RESERVE_MARKE, runDerived, speicherAuswahl, vollText } from './speicher';
import { t } from '../lib/sprache';
import type { BoardDoc, BoardState, Space } from './typen';
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
export async function nachDemLaden(gelesen: string): Promise<void> {
  // M532: Liegt im Ersatzspeicher ein neuerer Stand (der localStorage war voll), gilt er — er wird hier übernommen
  const ersatz = await reserveHolen(gelesen);
  const roh = ersatz ?? gelesen;
  if (ersatz) {
    try {
      const st = (JSON.parse(ersatz) as { state?: Record<string, unknown> }).state;
      if (st && Array.isArray(st.boards) && st.boards.length) {
        const inhalte = await inhalteLaden(verweiseIn(ersatz));
        for (const [v, x] of inhalte) alsGesichertMerken(v, x);
        // KEIN runDerived: Das ist eigene, neuere Arbeit — der Abgleich soll sie weitertragen
        useBoard.setState(verweiseEinsetzen(st, inhalte) as Partial<BoardState>);
        reserve.da = true;
        useBoard.getState().showToast(t('Neuester Stand aus dem Ersatzspeicher geladen – der Browser-Speicher war voll.'), false, 8000);
      }
    } catch { /* unlesbar: der Stand aus dem localStorage bleibt */ }
  }
  const verweise = ersatz ? new Set<string>() : verweiseIn(roh);
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
/** Mitlese-Fenster und Nachfolger (speicher.ts → adoptPersistedState): den gelesenen Stand übernehmen, Bilder eingesetzt */
export async function uebernehmen(raw: string): Promise<void> {
  try {
    const st = (JSON.parse(raw) as { state?: { boards?: BoardDoc[]; spaces?: Space[]; activeId?: string } }).state;
    if (!st || !Array.isArray(st.boards) || st.boards.length === 0 || !Array.isArray(st.spaces)) return;
    const boards = raw.includes('"pixinotes-ablage:') ? await mitInhalten(raw, st.boards).catch(() => st.boards!) : st.boards;
    useBoard.getState().importSync(boards, st.spaces, st.activeId ?? boards[0].id);
  } catch { /* unlesbar: der eigene Stand bleibt */ }
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

/* ───── M532: Ersatzspeicher für den Stand, wenn der localStorage voll ist ─────
   Scheitert das Schreiben des Stands am vollen localStorage, geht derselbe Text in die IndexedDB (dort zählt der Platz
   der Platte). Mit ihm liegt die Prüfsumme dessen, was in dem Moment im localStorage stand (`basis`). Beim Start gilt:
   Stimmt der localStorage noch mit `basis` überein, ist der Ersatz neuer und wird übernommen; wurde der localStorage
   seitdem geschrieben, ist der Ersatz überholt und wird gelöscht. Ein gelungenes Schreiben räumt ihn ohnehin weg
   (speicher.ts → reserve.da). Eine kleine Marke im localStorage sagt dem Start, dass er nachsehen muss. */
const RESERVE = 'pixinotes-stand-reserve';
const SPEICHER_KEY = 'pixinotes-board';
type Ersatz = { text: string; basis: string; at: number };
let reserveLauf: Promise<void> | null = null;
let reserveNaechster: string | null = null;
let gemeldet = false;

async function kv<T>(art: 'get' | 'put' | 'delete', wert?: Ersatz): Promise<T | undefined> {
  const d = await db();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = d.transaction('kv', art === 'get' ? 'readonly' : 'readwrite', { durability: 'strict' } as IDBTransactionOptions);
    const os = tx.objectStore('kv');
    const req = art === 'get' ? os.get(RESERVE) : art === 'put' ? os.put(wert, RESERVE) : os.delete(RESERVE);
    tx.oncomplete = () => resolve(req.result as T | undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Den Stand in den Ersatzspeicher legen (der jeweils neueste; ein laufendes Schreiben wird nicht gestapelt) */
export function reserveSchreiben(text: string): Promise<void> {
  reserveNaechster = text;
  reserveLauf ??= (async () => {
    try {
      while (reserveNaechster !== null) {
        const t = reserveNaechster; reserveNaechster = null;
        await kv('put', { text: t, basis: pruefsumme(localStorage.getItem(SPEICHER_KEY) ?? ''), at: Date.now() });
        reserve.da = true;
        try { localStorage.setItem(RESERVE_MARKE, '1'); } catch { /* voll trotz gleicher Länge: der Start sieht beim Laden der Ablage trotzdem nach */ }
      }
    } catch { /* keine IndexedDB: es bleibt beim Hinweis „Speicher voll" */ } finally { reserveLauf = null; }
    if (reserve.da && !gemeldet) { gemeldet = true; reserveMelden(); }
  })();
  return reserveLauf;
}

/** Einmal je Sitzung: sagen, dass nichts verloren geht, und wo der Platz steckt (die größten Boards) */
function reserveMelden(): void {
  const s = useBoard.getState();
  const mb = (n: number) => `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  const liste = s.boards.map((b) => ({ name: b.name, n: vollText(b).length })).sort((a, b) => b.n - a.n).slice(0, 3)
    .map((b) => `${b.name} (${mb(b.n)})`).join(', ');
  s.showToast(t(`Browser-Speicher voll – die Arbeit liegt sicher im Ersatzspeicher. Größte Boards: ${liste}.`), false, 12000);
}

/** Nach einem gelungenen Schreiben in den localStorage: der Ersatz ist überholt */
export async function reserveLoeschen(): Promise<void> {
  if (reserveLauf) await reserveLauf;
  if (reserve.da) return;   // dazwischen wieder voll geworden: der neue Ersatz gilt
  try { await kv('delete'); } catch { /* egal */ }
  try { localStorage.setItem(RESERVE_MARKE, '0'); } catch { /* egal */ }
}

/** Beim Start: der Text aus dem Ersatzspeicher, wenn er neuer ist als der localStorage — sonst null (und weg damit) */
async function reserveHolen(gelesen: string): Promise<string | null> {
  let r: Ersatz | undefined;
  try { r = await kv<Ersatz>('get'); } catch { return null; }
  if (r && typeof r.text === 'string' && r.basis === pruefsumme(gelesen) && r.text !== gelesen) return r.text;
  if (r) { try { await kv('delete'); } catch { /* egal */ } }
  try { localStorage.setItem(RESERVE_MARKE, '0'); } catch { /* egal */ }
  return null;
}
