// Keeps the app working with weak or no signal (e.g. inside a grocery store)
// once it has been opened online at least once.
const CACHE = 'fat-pct-v3';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cacheable = (res) => res && (res.ok || res.type === 'opaque');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // App files: newest version when online, saved copy when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res.clone();
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else {
    // Text-reader files from the CDN are versioned and large: saved copy first.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (cacheable(res)) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res.clone();
      }))
    );
  }
});
