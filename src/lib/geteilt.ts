/**
 * M290: Die App-Seite des Android-Teilen-Menüs.
 *
 * Der Service Worker nimmt das Geteilte an (er ist der Einzige, der eine
 * POST-Anfrage abfangen kann, siehe public/sw.js) und legt es in der
 * Geräte-Ablage ab. Hier wird es wieder abgeholt — genau EINMAL: Was
 * übernommen oder verworfen wurde, darf beim nächsten Start nicht erneut
 * auftauchen.
 *
 * Die IndexedDB-Zugriffe stehen bewusst zweimal im Quelltext (hier und im
 * Service Worker): Der Worker ist eine eigenständige Datei ohne Bündelung —
 * er kann nichts importieren, was durch Vite läuft. Name der Datenbank und
 * des Speichers sind deshalb an beiden Stellen dieselbe Verabredung.
 */
const DB = 'pixinotes-geteilt';
const STORE = 'eingang';
const SCHLUESSEL = 'letztes';

export interface GeteilteDatei { name: string; typ: string; blob: Blob }
export interface Geteiltes {
  titel: string;
  text: string;
  adresse: string;
  dateien: GeteilteDatei[];
  wann: string;
}

function db(): Promise<IDBDatabase> {
  return new Promise((ok, err) => {
    const a = indexedDB.open(DB, 1);
    a.onupgradeneeded = () => {
      if (!a.result.objectStoreNames.contains(STORE)) a.result.createObjectStore(STORE);
    };
    a.onsuccess = () => ok(a.result);
    a.onerror = () => err(a.error);
  });
}

/** Was zuletzt geteilt wurde — oder null */
export async function leseGeteiltes(): Promise<Geteiltes | null> {
  try {
    const d = await db();
    const wert = await new Promise<Geteiltes | undefined>((ok, err) => {
      const t = d.transaction(STORE, 'readonly');
      const a = t.objectStore(STORE).get(SCHLUESSEL);
      a.onsuccess = () => ok(a.result as Geteiltes | undefined);
      a.onerror = () => err(a.error);
    });
    d.close();
    return wert ?? null;
  } catch {
    return null;   // privates Fenster, kein IndexedDB — dann eben nichts
  }
}

/** Eingang leeren (nach Übernehmen ODER Verwerfen) */
export async function loescheGeteiltes(): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((ok, err) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(SCHLUESSEL);
      t.oncomplete = () => ok();
      t.onerror = () => err(t.error);
    });
    d.close();
  } catch { /* dann bleibt es liegen und wird beim nächsten Mal angeboten */ }
}

/** Aus den abgelegten Blobs wieder echte Dateien machen (für den Import) */
export function alsDateien(g: Geteiltes): File[] {
  return g.dateien.map((d) => new File([d.blob], d.name || 'Geteilt', { type: d.typ || d.blob.type }));
}

/**
 * Hat Android gerade etwas hereingereicht? Der Service Worker leitet nach
 * „./?geteilt=1" um. Die Marke wird sofort aus der Adresse genommen — ein
 * Neuladen soll den Dialog nicht ein zweites Mal öffnen.
 */
export function geteiltMarkeAbholen(): boolean {
  const da = new URLSearchParams(location.search).has('geteilt');
  if (da) {
    const u = new URL(location.href);
    u.searchParams.delete('geteilt');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  return da;
}
