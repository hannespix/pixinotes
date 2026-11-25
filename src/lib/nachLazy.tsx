import { lazy, useEffect, useState, type ComponentType } from 'react';

/**
 * M534: Nachladen, das die Darstellung nicht mitreißt.
 *
 * Scheiterte das Nachladen eines Teils (Netz weg, nach einem Update ist die alte Datei auf dem Server nicht mehr da),
 * warf `React.lazy` den Fehler in die nächste Fehlergrenze — bei Einstellungen, Hilfe und Dialogen die äußerste: „PixiNotes
 * lässt sich gerade nicht anzeigen". „Nochmal versuchen" half nicht, weil React sich den gescheiterten Versuch merkt
 * (M523, offen). Jetzt: ein zweiter Versuch nach kurzer Pause; scheitert auch der, steht an der Stelle des Teils ein
 * Hinweis mit „Nochmal versuchen" (lädt wirklich neu und zeigt den Teil, sobald er da ist) und „Neu laden". Der
 * Ersatz versucht es beim nächsten Öffnen außerdem selbst noch einmal — ist das Netz zurück, erscheint der Teil ohne Klick.
 *
 * Der Browser merkt sich ein gescheitertes `import()` ebenfalls (Modul-Tabelle des Dokuments): Derselbe Aufruf scheitert
 * danach sofort, ohne die Datei noch einmal anzufragen. Deshalb holt `neuHolen` die Datei aus der Fehlermeldung unter
 * einer frischen Adresse (`?neu=…`) und nimmt aus ihr den Teil, der wie die Datei heißt (Settings-….js → Settings),
 * sonst den Standard-Export oder den einzigen Komponenten-Export.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Teil = ComponentType<any>;
const istTeil = (k: unknown): k is Teil => typeof k === 'function' || (!!k && typeof k === 'object' && '$$typeof' in k);
async function neuHolen(e: unknown): Promise<Teil> {
  const url = /(?:https?|file):\/\/[^\s'"]+?\.js/.exec(String((e as Error)?.message))?.[0];
  if (!url) throw e;
  const m = await import(/* @vite-ignore */ `${url}?neu=${Date.now()}`) as Record<string, unknown>;
  const name = (url.split('/').pop() ?? '').replace(/-[\w-]{8}\.js$/, '');
  const teile = Object.entries(m).filter(([k, v]) => /^[A-Z]/.test(k) && istTeil(v));
  const k = m[name] ?? m.default ?? (teile.length === 1 ? teile[0][1] : null);
  if (!istTeil(k)) throw e;
  return k;
}
/* Ohne Netz und ohne Service Worker kann nichts kommen — dann gar nicht erst anfragen: Ein gescheiterter Abruf vergiftet
   auch die Dateien, die der Teil mitbringt (dieselbe Modul-Tabelle), und danach hülfe nur noch Neuladen. Mit Service
   Worker wird es versucht: Was im Leerlauf vorgeladen wurde, liegt dort auch ohne Netz bereit (M446/M523). */
const ohneNetz = () => !navigator.onLine && !navigator.serviceWorker?.controller;
export function nachLazy<T extends Teil>(lade: () => Promise<{ default: T }>): T {
  let da: Teil | null = null;
  const versuch1 = () => (ohneNetz() ? Promise.reject(new Error('offline')) : lade().then((m) => m.default as Teil));
  const holen = () => versuch1().catch(() => new Promise((r) => setTimeout(r, 700)).then(versuch1))
    .catch(neuHolen).then((k) => (da = k));
  function Ersatz(p: object) {
    const [K, setK] = useState<Teil | null>(() => da);
    const [fehlt, setFehlt] = useState(false);
    const versuch = () => { setFehlt(false); holen().then((k) => setK(() => k), () => setFehlt(true)); };
    // Kein selbsttätiger Versuch, wenn das Netz zurückkommt: Hat ohne Netz ein anderer Teil eine gemeinsame Datei nicht
    // bekommen, lädt der Abruf die Seite neu (main.tsx, vite:preloadError) — das soll nur auf einen Klick hin geschehen.
    useEffect(() => { if (!K) versuch(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    return K ? <K {...p} /> : fehlt ? (
      <div className="nachlade-fehler" role="alert">
        Teil konnte nicht geladen werden – meist fehlt gerade das Netz.
        <button type="button" onClick={versuch}>Nochmal versuchen</button>
        <button type="button" onClick={() => location.reload()}>Neu laden</button>
      </div>
    ) : null;
  }
  return lazy<Teil>(() => holen().then((k) => ({ default: k }), () => ({ default: Ersatz }))) as unknown as T;
}
