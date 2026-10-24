// Met l'application en cache pour qu'elle s'ouvre même sans réseau.
// Augmenter VERSION à chaque mise à jour des fichiers.
const VERSION = 'v1';
const CACHE = `chantier-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'js/db.js',
  'js/images.js',
  'js/speech.js',
  'js/ai.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Les appels à l'API IA ne passent jamais par le cache.
  if (url.hostname === 'api.anthropic.com') return;

  const sameOrigin = url.origin === self.location.origin;
  const isSdk = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !isSdk) return;

  // Réseau d'abord (pour avoir la dernière version), cache en secours.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: sameOrigin })),
  );
});
