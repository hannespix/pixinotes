/**
 * M532: Große eingebettete Inhalte (data-URLs: Bilder, kleine Anhänge) liegen nicht mehr im localStorage-Stand.
 *
 * Der ganze App-Stand liegt in EINEM localStorage-Eintrag, und den riegeln Browser bei rund 5 Mio. Zeichen je
 * Herkunft ab. Ein paar Boards mit eingebetteten Bildern (eine SVG-Grafik sind schnell 80 000 Zeichen) reichten,
 * damit jedes weitere Speichern scheiterte — der Stand lebte dann nur noch im Arbeitsspeicher, beim Neuladen war die
 * Arbeit weg, und auch der Konto-Abgleich brach ab („Browser-Speicher voll?").
 *
 * Jetzt geht jede data-URL ab AUSLAGERN_AB Zeichen in den Datei-Speicher des Geräts (IndexedDB, dieselbe Ablage wie
 * Anhänge und Tool-Quelltexte; dort zählt der freie Platz der Platte, nicht ein 5-MB-Deckel). Im gespeicherten Text
 * steht an ihrer Stelle nur ein Verweis aus Prüfsumme und Länge. Im laufenden Programm bleibt alles, wie es war: Der
 * Store hält die data-URL — darum ändern sich Export, Teilen, Abgleich, Präsentation und Kopieren nicht, und Geräte
 * mit älterem Programmstand bekommen über Konto, Ordner, WebDAV und Links weiter das ganze Bild.
 *
 * Reihenfolge, damit nie ein Verweis ohne Inhalt entsteht: Eine data-URL wird erst dann durch ihren Verweis ersetzt,
 * wenn ihr Inhalt nachweislich in der IndexedDB liegt (`gesichert`). Bis dahin bleibt sie im Text, und das Sichern
 * läuft im Hintergrund; danach schreibt der Speicher den Stand noch einmal (`nachSichern`).
 *
 * Dieses Stück liegt im Start-Paket und bleibt klein; Lesen und Schreiben der IndexedDB lädt nach (ablageIdb.ts).
 */

/** Ab dieser Länge wird eine data-URL ausgelagert (kleine Symbole bleiben im Text — sie kosten dort nichts) */
export const AUSLAGERN_AB = 10_000;
const PRAEFIX = 'pixinotes-ablage:';
/** Ein Verweis, wie er im gespeicherten Text steht — und nur so (ganzer Wert, keine Teilzeichenkette) */
export const VERWEIS_MUSTER = /^pixinotes-ablage:[0-9a-z]{1,12}-[0-9a-z]{1,12}-\d{1,10}$/;
/** dasselbe zum Finden im rohen JSON-Text (mit Anführungszeichen) */
export const VERWEIS_IM_TEXT = /"(pixinotes-ablage:[0-9a-z]{1,12}-[0-9a-z]{1,12}-\d{1,10})"/g;

/** Prüfsumme (cyrb53) — zwei Durchläufe mit verschiedenem Startwert ergeben mit der Länge rund 106 Bit */
function streu(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed; let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** Kleiner Merkzettel: dieselbe data-URL nicht bei jedem Schreiben neu durchrechnen */
const verweise = new Map<string, string>();
export function verweisVon(daten: string): string {
  let v = verweise.get(daten);
  if (v === undefined) {
    if (verweise.size > 2000) verweise.clear();
    v = `${PRAEFIX}${streu(daten, 1).toString(36)}-${streu(daten, 7).toString(36)}-${daten.length}`;
    verweise.set(daten, v);
  }
  return v;
}

/** Verweise, deren Inhalt auf diesem Gerät nachweislich in der IndexedDB liegt */
const gesichert = new Set<string>();
/** Noch zu sichern: Verweis → data-URL */
const offen = new Map<string, string>();
let geplant = false;
/** Meldet der Speicherschicht: Es liegt Neues sicher in der Ablage — den Stand jetzt mit Verweisen schreiben */
let nachSichern: () => void = () => {};
export const beimSichern = (fn: () => void): void => { nachSichern = fn; };
/** Aus der Ablage geladen: Der Inhalt liegt sicher, und sein Verweis ist bekannt (kein erneutes Durchrechnen) */
export const alsGesichertMerken = (v: string, daten?: string): void => {
  gesichert.add(v);
  if (daten !== undefined && verweise.size < 2000) verweise.set(daten, v);
};
/** Zähler für Prüfreihen und Fehlersuche */
export const ablageZaehler = { gesichert: 0, fehler: 0, geladen: 0, fehlt: 0 };

/** Ersetzer für JSON.stringify: große data-URLs werden zu Verweisen — aber nur, wenn ihr Inhalt schon sicher liegt */
export function ablageErsetzer(_k: string, v: unknown): unknown {
  if (typeof v !== 'string' || v.length < AUSLAGERN_AB || !v.startsWith('data:')) return v;
  const r = verweisVon(v);
  if (gesichert.has(r)) return r;
  if (!offen.has(r)) { offen.set(r, v); planen(); }
  return v;
}

let lauf: Promise<void> | null = null;
let dauerhaftGefragt = false;
function planen(): void {
  if (geplant || lauf) return;
  geplant = true;
  // Im Leerlauf: Sichern darf weder den Start noch ein Ziehen bremsen
  const los = () => { geplant = false; void abarbeiten(); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(los, { timeout: 1500 }); else setTimeout(los, 200);
}

/** Alles Offene sichern, eins nach dem anderen (ein großer Schub würde die IndexedDB für Sekunden belegen) */
function abarbeiten(): Promise<void> {
  lauf ??= (async () => {
    let neu = 0;
    try {
      const { inhaltSichern } = await import('./ablageIdb');
      for (;;) {
        const naechster = offen.entries().next();
        if (naechster.done) break;
        const [r, daten] = naechster.value;
        offen.delete(r);
        if (gesichert.has(r)) continue;
        if (await inhaltSichern(r, daten)) { gesichert.add(r); neu += 1; ablageZaehler.gesichert += 1; } else ablageZaehler.fehler += 1;
      }
    } catch {
      // keine IndexedDB (privates Fenster, gesperrt): die data-URLs bleiben im Text — wie bisher
      ablageZaehler.fehler += 1;
      offen.clear();
    } finally {
      lauf = null;
      if (offen.size) planen();   // kam während des Laufs noch etwas dazu
    }
    if (neu > 0) {
      // Den Browser bitten, die Ablage nicht bei Platzmangel zu räumen (einmal; er entscheidet selbst)
      if (!dauerhaftGefragt) { dauerhaftGefragt = true; void navigator.storage?.persist?.().catch(() => false); }
      nachSichern();
    }
  })();
  return lauf;
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

/**
 * Einen Stand von außen (Konto, Ordner, WebDAV) VOR dem Übernehmen in die Ablage legen: Dann trägt schon das erste
 * Speichern nach dem Einarbeiten Verweise statt der Bilder — und scheitert nicht am vollen localStorage. (Ohne das
 * käme das Bild erst im Leerlauf in die Ablage; bis dahin wäre der Abgleich mit „Speicher voll" abgebrochen.)
 */
export async function ablageVorab(wert: unknown): Promise<void> {
  vormerken(wert);
  for (let i = 0; i < 50 && (offen.size || lauf); i++) await (lauf ?? abarbeiten());
}
