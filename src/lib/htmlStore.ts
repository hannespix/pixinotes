// M158: Ablage für eingebettete HTML-Apps („Eigene Apps").
//
// Die Dateien sind oft mehrere MEGABYTE groß — sie dürfen deshalb NIEMALS in
// den localStorage-Boardstand wandern (5-MB-Limit, siehe canEmbed): ein
// einziges großes Tool würde sonst jeden weiteren Speichervorgang des ganzen
// Boards zum Scheitern bringen. Darum liegen Quelltext UND der von der App
// gespeicherte Zustand (localStorage-Shim) in IndexedDB; im Board selbst
// stehen nur Name und Größe.
import { idbDel, idbGet, idbKeys, idbSet } from './syncFolder';

const SRC = (id: string) => `happ:${id}`;
const STATE = (id: string) => `happ-state:${id}`;
/** Zeitstempel des lokalen Speicherstands (M162) — Vergleichsbasis, um beim
 *  Start zu entscheiden, ob der Team-Speicherstand neuer ist */
const STATE_AT = (id: string) => `happ-state-at:${id}`;

export const saveHtml = (id: string, html: string) => idbSet(SRC(id), html);
export const loadHtml = (id: string) => idbGet<string>(SRC(id));
/**
 * M371: Der Quelltext eines eigenen Tools reist mit dem Board (Konto, Gäste per Link, kurzer Link) — über
 * denselben Weg wie die Anhänge der Datei-Karten und landet dort unter `file:<id>`. Hier wird er in die
 * Ablage der Tools übernommen; liegt er schon dort, bleibt alles, wie es ist.
 */
export async function htmlUebernehmen(id: string): Promise<boolean> {
  if (await loadHtml(id)) return true;
  const blob = await idbGet<Blob | ArrayBuffer>(`file:${id}`);
  if (!blob) return false;
  const text = await (blob instanceof Blob ? blob : new Blob([blob])).text();
  if (!text) return false;
  await saveHtml(id, text);
  return true;
}
/** Größe des Inhalts auf diesem Gerät in Bytes (Tool-Quelltext vor Datei-Anhang) — −1, wenn nichts da ist */
export async function anhangGroesse(id: string): Promise<number> {
  try {
    const text = await idbGet<string>(SRC(id));
    if (text) return new Blob([text]).size;
    const blob = await idbGet<Blob | ArrayBuffer>(`file:${id}`);
    if (!blob) return -1;
    return blob instanceof Blob ? blob.size : blob.byteLength;
  } catch { return -1; }
}
/** Liegt der Inhalt dieser Karte auf dem Gerät — als Datei-Anhang oder als Tool-Quelltext? */
export async function anhangLokal(id: string): Promise<boolean> {
  try { return !!(await idbGet(`file:${id}`)) || !!(await idbGet(SRC(id))); } catch { return false; }
}

export async function saveAppState(id: string, data: Record<string, string>, at?: string): Promise<void> {
  await idbSet(STATE(id), data);
  await idbSet(STATE_AT(id), at ?? new Date().toISOString());
}
export const loadAppState = (id: string) => idbGet<Record<string, string>>(STATE(id));
export const loadAppStateAt = (id: string) => idbGet<string>(STATE_AT(id));

export async function deleteHtmlApp(id: string): Promise<void> {
  await idbDel(SRC(id));
  await idbDel(STATE(id));
  await idbDel(STATE_AT(id));
  await idbDel(`happ-vorher:${id}`);
}

/**
 * Verwaiste Inhalte entsorgen — NUR beim App-Start aufrufen: dann ist der
 * Verlauf leer und kein Undo kann eine gelöschte App-Karte wiederbeleben,
 * deren Inhalt hier gerade aufgeräumt wurde. (Beim Löschen einer Karte wird
 * bewusst NICHT sofort gelöscht, damit Strg+Z die App komplett zurückholt.)
 */
export async function cleanupOrphanHtml(validIds: Set<string>): Promise<void> {
  try {
    const keys = await idbKeys();
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      const m = /^happ(?:-state(?:-at)?|-vorher)?:(.+)$/.exec(key);   // M428: auch die vorige Fassung
      if (m && !validIds.has(m[1])) await idbDel(key);
    }
  } catch {
    // Aufräumen ist Komfort — ein Fehler hier darf den Start nie stören
  }
}

/* M535: Speicher-Shim und Einsetzen in den Quelltext (storageShim, composeSrcdoc) stehen in lib/htmlShim.ts —
   nur die (nachgeladene) Tool-Karte braucht sie, das Start-Paket nicht. */

/* ───── M428: vorige Fassung einer überarbeiteten Präsentation ─────
   Die KI ersetzt Quelltext und Speicherstand der Karte; die Fassung davor bleibt hier, eine Stufe tief, und lässt sich
   über das Menü der Karte zurückholen (das tauscht beide — so geht es auch wieder vor). */
const VORHER = (id: string) => `happ-vorher:${id}`;
export interface Fassung { html: string; state: Record<string, string>; at: string }
export async function fassungSichern(id: string): Promise<boolean> {
  const [html, state] = await Promise.all([loadHtml(id), loadAppState(id)]);
  if (!html) return false;
  await idbSet(VORHER(id), { html, state: state ?? {}, at: new Date().toISOString() } satisfies Fassung);
  return true;
}
export const vorigeFassung = (id: string) => idbGet<Fassung>(VORHER(id));
/** Vorige und jetzige Fassung tauschen */
export async function fassungTauschen(id: string): Promise<Fassung | null> {
  const alt = await vorigeFassung(id);
  if (!alt?.html) return null;
  await fassungSichern(id);
  await saveHtml(id, alt.html);
  await saveAppState(id, alt.state ?? {});
  return alt;
}
