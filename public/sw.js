// PixiNotes Service Worker — Offline-Betrieb & Installierbarkeit (PWA).
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
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
