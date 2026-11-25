/**
 * M538: Verwaiste Einträge der Geräte-Ablage aufräumen (offen aus M532).
 *
 * Seit M532 liegen große eingebettete Inhalte (Bilder, kleine Anhänge) unter ihrem Verweis `pixinotes-ablage:…` in der
 * IndexedDB; der gespeicherte Stand trägt nur den Verweis. Wird ein Bild gelöscht, ersetzt oder geändert, blieb sein
 * alter Inhalt für immer liegen — die Ablage wuchs mit jeder Änderung an einem Bild.
 *
 * Gelöscht wird nur, was NIRGENDS mehr genannt wird und das seit einer Schonfrist (7 Tage) nicht mehr:
 *   - der gespeicherte Stand (`pixinotes-board`, alle Boards samt Archiv, Vorlagen, …),
 *   - der Ersatzspeicher (M532, `pixinotes-stand-reserve`) und die Rettungskopien (M529, auch die in sessionStorage),
 *   - dieses Fenster: der Stand im Arbeitsspeicher und der Rückgängig-Verlauf (past/future) — beides hält die
 *     data-URLs selbst, gezählt wird ihr Verweis.
 * Versionen (M449), Sicherungen und der Abgleich speichern das ganze Bild, nicht den Verweis — sie hängen nicht an der
 * Ablage. Andere offene Fenster: Ihr Rückgängig-Verlauf ist von hier nicht zu sehen. Darum (a) die Schonfrist — ein
 * Eintrag muss in mehreren Läufen über sieben Tage verwaist sein — und (b) eine Nachricht an alle Fenster
 * (BroadcastChannel), welche Verweise gelöscht sind: Sie führen diese nicht mehr als „liegt sicher" (A.gesichert) und
 * legen den Inhalt beim nächsten Schreiben wieder ab, statt einen Verweis ohne Inhalt zu schreiben.
 *
 * Läuft im Leerlauf, eine Minute nach dem Start, höchstens einmal am Tag (`pixinotes-ablage-aufgeraeumt`), nur in einem
 * Fenster zugleich (Web Locks). Nachgeladen (App.tsx → Vorladen), nicht im Start-Paket.
 */
import { useBoard } from '../store';
import type { BoardState } from './typen';
import { AUSLAGERN_AB, speicherAuswahl } from './speicher';

const PRAEFIX = 'pixinotes-ablage:';
const VERWEIS_MUSTER = /^pixinotes-ablage:[0-9a-z]{1,12}-[0-9a-z]{1,12}-\d{1,10}$/;
/** ablage.ts erst laden, wenn es überhaupt Einträge gibt: Ihr Laden schaltet das Auslagern ein und schreibt den Stand einmal neu */
type AblageModul = typeof import('./ablage');
/** Merkzettel in der IndexedDB: Verweis → seit wann er verwaist ist (ms) */
const WAISEN = 'pixinotes-ablage-waisen';
const ZULETZT = 'pixinotes-ablage-aufgeraeumt';
export const SCHONFRIST_MS = 7 * 24 * 3600_000;
const ABSTAND_MS = 20 * 3600_000;
export const ABLAGE_KANAL = 'pixinotes-ablage';
const VERWEIS_IM_TEXT = /"(pixinotes-ablage:[0-9a-z]{1,12}-[0-9a-z]{1,12}-\d{1,10})"/g;
const verweiseIn = (roh: string | null | undefined, in_: Set<string>): void => { if (roh) for (const m of roh.matchAll(VERWEIS_IM_TEXT)) in_.add(m[1]); };

let offen: Promise<IDBDatabase> | null = null;
/** Dieselbe Datenbank wie ablageIdb.ts und lib/syncFolder.ts (`pixinotes-sync`, Tabelle `kv`) */
function db(): Promise<IDBDatabase> {
  offen ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('pixinotes-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); offen = null; }; resolve(d); };
    req.onerror = () => reject(req.error);
  });
  offen.catch(() => { offen = null; });
  return offen;
}
function tx<T>(art: IDBTransactionMode, fn: (kv: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction('kv', art, art === 'readwrite' ? { durability: 'strict' } as IDBTransactionOptions : undefined);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req ? req.result as T : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const schluessel = (): Promise<string[]> => tx<IDBValidKey[]>('readonly', (kv) => kv.getAllKeys(IDBKeyRange.bound(PRAEFIX, `${PRAEFIX}￿`)))
  .then((k) => (k ?? []).filter((x): x is string => typeof x === 'string' && VERWEIS_MUSTER.test(x)));

/** Verweise großer data-URLs in einem Wert (Store, Verlauf) — ohne Text zu bauen */
function verweiseInWert(wert: unknown, in_: Set<string>, verweisVon: (s: string) => string): void {
  const gesehen = new WeakSet<object>();
  const gehe = (v: unknown): void => {
    if (typeof v === 'string') { if (v.length >= AUSLAGERN_AB && v.startsWith('data:')) in_.add(verweisVon(v)); return; }
    if (!v || typeof v !== 'object' || gesehen.has(v)) return;
    gesehen.add(v);
    if (Array.isArray(v)) { for (const x of v) gehe(x); return; }
    for (const k of Object.keys(v)) gehe((v as Record<string, unknown>)[k]);
  };
  gehe(wert);
}

/** Alles, was gerade einen Verweis nennt (siehe Kopf der Datei) */
async function genannt(m: AblageModul): Promise<Set<string>> {
  const g = new Set<string>();
  try { verweiseIn(localStorage.getItem('pixinotes-board'), g); } catch { /* gesperrt */ }
  try { verweiseIn(sessionStorage.getItem('pixinotes-rettung'), g); } catch { /* gesperrt */ }
  const reserve = await tx<{ text?: string }>('readonly', (kv) => kv.get('pixinotes-stand-reserve')).catch(() => undefined);
  verweiseIn(reserve?.text, g);
  const rettungen = await tx<{ text?: string }[]>('readonly', (kv) => kv.get('pixinotes:rettung')).catch(() => undefined);
  for (const r of Array.isArray(rettungen) ? rettungen : []) verweiseIn(r?.text, g);
  const s = useBoard.getState() as BoardState;
  verweiseInWert({ ...speicherAuswahl(s), boards: s.boards }, g, m.verweisVon);
  verweiseInWert([s.past, s.future], g, m.verweisVon);
  for (const v of m.A.offen.keys()) g.add(v);
  return g;
}

export interface Ergebnis { eintraege: number; verwaist: number; geloescht: string[] }
/**
 * Ein Lauf. `jetzt`/`schonfrist` nur für Prüfreihen. Unbekanntes (anderer Schlüssel) wird nie angefasst; was eben
 * erst verwaist ist, wird nur vorgemerkt.
 */
export async function aufraeumen(jetzt = Date.now(), schonfrist = SCHONFRIST_MS): Promise<Ergebnis> {
  const alle = await schluessel();
  const alt0 = await tx<Record<string, number>>('readonly', (kv) => kv.get(WAISEN)).catch(() => undefined);
  if (!alle.length) { if (alt0) await tx('readwrite', (kv) => kv.delete(WAISEN)); return { eintraege: 0, verwaist: 0, geloescht: [] }; }
  const m = await import('./ablage');
  const g = await genannt(m);
  const alt = alt0 ?? {};
  const waisen: Record<string, number> = {};
  const faellig: string[] = [];
  for (const k of alle) {
    if (g.has(k)) continue;
    const seit = typeof alt[k] === 'number' && alt[k] <= jetzt ? alt[k] : jetzt;
    if (jetzt - seit >= schonfrist) faellig.push(k); else waisen[k] = seit;
  }
  // Unmittelbar vor dem Löschen noch einmal frisch nachsehen (ein anderes Fenster kann eben geschrieben haben)
  const frisch = faellig.length ? await genannt(m) : g;
  const weg = faellig.filter((k) => !frisch.has(k));
  for (const k of faellig) if (frisch.has(k)) delete waisen[k];
  await tx('readwrite', (kv) => {
    for (const k of weg) kv.delete(k);
    kv.put(waisen, WAISEN);
  });
  if (weg.length) {
    for (const k of weg) m.A.gesichert.delete(k);
    try { const c = new BroadcastChannel(ABLAGE_KANAL); c.postMessage({ geloescht: weg }); c.close(); } catch { /* kein Kanal */ }
  }
  return { eintraege: alle.length, verwaist: Object.keys(waisen).length, geloescht: weg };
}

/** Einmal am Tag, nur ein Fenster zugleich */
async function vielleicht(): Promise<void> {
  try { if (Date.now() - Number(localStorage.getItem(ZULETZT) ?? 0) < ABSTAND_MS) return; } catch { return; }
  const lauf = async () => {
    await aufraeumen();
    try { localStorage.setItem(ZULETZT, String(Date.now())); } catch { /* voll: dann morgen eben nochmal */ }
  };
  if (navigator.locks) await navigator.locks.request('pixinotes-ablage-aufraeumen', { ifAvailable: true }, (l) => (l ? lauf() : undefined));
  else await lauf();
}
(window as Window & { pixinotesAblageAufraeumen?: typeof aufraeumen }).pixinotesAblageAufraeumen = aufraeumen;
{
  const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  window.setTimeout(() => { const los = () => void vielleicht().catch(() => {}); if (ric) ric(los, { timeout: 10_000 }); else los(); }, 60_000);
}
