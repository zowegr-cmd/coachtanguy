/* ============================================================
   Service Worker — PWA Calculateur Alimentaire CoachTanguy
   - cache-first pour les assets (icônes, police…)
   - network-first pour le document (toujours la dernière version,
     avec repli sur le cache hors-ligne)
   ============================================================ */
const CACHE = 'coachtanguy-calc-v2';

// Ressources mises en cache à l'installation (coquille offline)
const PRECACHE = [
  '/calculateur/',
  '/calculateur/index.html',
  '/calculateur/manifest.webmanifest',
  '/calculateur/installer.html',
  '/calculateur/pwa.js',
  '/calculateur/icons/icon-192.png',
  '/calculateur/icons/icon-512.png',
  '/calculateur/icons/icon-512-maskable.png',
  '/calculateur/icons/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  const isDocument = req.mode === 'navigate' || accept.includes('text/html');

  if (isDocument) {
    // network-first : on tente le réseau, on met à jour le cache, repli hors-ligne
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/calculateur/index.html')))
    );
  } else {
    // cache-first : assets (icônes, police, polices woff2…)
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
  }
});
