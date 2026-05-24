// ============================================================
// AgriTrack Service Worker
// Enables offline support and PWA installability
// ============================================================

const CACHE_NAME = 'agritrack-v1';

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // CDN assets cached on first load
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// ===== INSTALL — cache all static assets =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      // Cache each asset individually so one failure doesn't break all
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Failed to cache:', url, err.message);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ===== ACTIVATE — clean up old caches =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH — network first, fall back to cache =====
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST to Supabase etc.)
  if (request.method !== 'GET') return;

  // Skip Supabase API calls — always need live data
  if (url.hostname.includes('supabase.co')) return;

  // For everything else: try network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache a fresh copy of successful responses
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(request).then(cached => {
          if (cached) return cached;
          // If it's a navigation request, serve index.html
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
