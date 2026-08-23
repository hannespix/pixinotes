// PixiNotes Service Worker — Offline-Betrieb, Installierbarkeit (PWA) und
// seit M290 das ZIEL des Android-Teilen-Menüs (Web Share Target).
// Strategie:
//  - Navigation (die App-Seite selbst): NETZ ZUERST, damit Deploys sofort
//    ankommen; ohne Netz kommt die zuletzt gecachte Seite (Offline-Start).
//  - Assets (JS/CSS/Fonts/Icons): stale-while-revalidate — sofort aus dem
//    Cache, im Hintergrund aktualisieren.
const CACHE = 'pixinotes-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['./'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * M290: Geteiltes aus anderen Apps annehmen (Android).
 *
 * Das Manifest meldet PixiNotes als Ziel im Teilen-Menü an. Android schickt
 * das Geteilte dann als POST an „./teilen-ziel" — eine Adresse, die es auf dem
 * Server gar nicht gibt: GitHub Pages liefert nur Dateien aus und kann kein
 * Formular entgegennehmen. Genau deshalb schreibt die Spezifikation den
 * Service Worker vor: ER fängt die Anfrage ab, noch bevor sie ins Netz geht.
 *
 * Der Ablauf ist bewusst zweistufig — Daten ablegen, dann zur App umleiten:
 * Eine POST-Antwort kann die App nicht öffnen, und die Dateien passen weder
 * in eine Adresszeile noch in den localStorage. Sie landen deshalb in der
 * Geräte-Ablage (IndexedDB), und die App holt sie sich beim Start ab.
 */
const GETEILT_DB = 'pixinotes-geteilt';
const GETEILT_STORE = 'eingang';

function geteiltDb() {
  return new Promise((ok, err) => {
    const anfrage = indexedDB.open(GETEILT_DB, 1);
    anfrage.onupgradeneeded = () => {
      if (!anfrage.result.objectStoreNames.contains(GETEILT_STORE)) {
        anfrage.result.createObjectStore(GETEILT_STORE);
      }
    };
    anfrage.onsuccess = () => ok(anfrage.result);
    anfrage.onerror = () => err(anfrage.error);
  });
}

async function legeGeteiltesAb(daten) {
  const db = await geteiltDb();
  await new Promise((ok, err) => {
    const t = db.transaction(GETEILT_STORE, 'readwrite');
    t.objectStore(GETEILT_STORE).put(daten, 'letztes');
    t.oncomplete = ok;
    t.onerror = () => err(t.error);
  });
  db.close();
}

async function nimmGeteiltesAn(request) {
  try {
    const form = await request.formData();
    const roh = form.getAll('dateien');
    const dateien = [];
    for (const eintrag of roh) {
      if (typeof eintrag === 'string' || !eintrag) continue;
      dateien.push({
        name: eintrag.name || 'Geteilt',
        typ: eintrag.type || '',
        blob: eintrag.slice(0, eintrag.size, eintrag.type || ''),
      });
    }
    await legeGeteiltesAb({
      titel: form.get('titel') || '',
      text: form.get('text') || '',
      adresse: form.get('adresse') || '',
      dateien,
      wann: new Date().toISOString(),
    });
  } catch (e) {
    // Lieber ohne Inhalt öffnen als mit einer Fehlerseite dastehen — die App
    // sagt dann, dass nichts angekommen ist.
    console.error('Teilen-Ziel:', e);
  }
  return Response.redirect(`${self.registration.scope}?geteilt=1`, 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // M290: Das Teilen-Menü liefert per POST — vor allen anderen Regeln prüfen
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/teilen-ziel')) {
    event.respondWith(nimmGeteiltesAn(req));
    return;
  }

  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Nur echte Erfolge cachen — eine 404/500-Seite würde sonst die
          // funktionierende Offline-Kopie der App ersetzen
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached ?? fresh;
    }),
  );
});
