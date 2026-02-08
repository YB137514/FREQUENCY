/**
 * FREQUENCY — Service Worker (offline support)
 * Uses stale-while-revalidate: serves cached version immediately,
 * then fetches fresh copy in background to update cache.
 */

const CACHE_NAME = 'frequency-v13';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/constants.js',
  './js/audio-engine.js',
  './js/visual-engine.js',
  './js/sync-controller.js',
  './js/ui-controls.js',
  './js/pulse-worklet-processor.js',
  './js/diagnostics.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches + take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate
// Serve from cache immediately, but always fetch a fresh copy to update cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (event.request.method === 'GET' && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => cached);

        return cached || networkFetch;
      });
    })
  );
});
