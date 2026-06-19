// ============================================================
// AgriTrack Service Worker
// Enables offline support and PWA installability
// ============================================================

const CACHE_NAME = 'agritrack-v4';
const TILE_CACHE  = 'agritrack-tiles-v2';
const ROUTE_CACHE = 'agritrack-routes-v2';

// Files to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/auth.js',
  '/styles.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/ffc-logo.png',
  // CDN assets cached on first load
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// ===== INSTALL — cache all static assets =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
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
          .filter(key => key !== CACHE_NAME && key !== TILE_CACHE && key !== ROUTE_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST to Supabase etc.)
  if (request.method !== 'GET') return;

  // Skip Supabase API calls — always need live data
  if (url.hostname.includes('supabase.co')) return;

  // --- Map tiles: cache-first with background refresh ---
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('tiles.osm.org')
  ) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(() => null);
          // Return cached tile immediately; refresh in background
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // --- OSRM routing: network with cache fallback ---
  if (url.hostname.includes('router.project-osrm.org')) {
    event.respondWith(
      caches.open(ROUTE_CACHE).then(cache =>
        fetch(request)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cache.match(request))
      )
    );
    return;
  }

  // --- Everything else: network first, cache fallback ---
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then(cached => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
