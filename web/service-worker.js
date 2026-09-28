const CACHE_NAME = 'sondas-v2.6-cache';
const TILE_CACHE_NAME = 'sondas-v2-tiles';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './leaflet/leaflet.css',
  './leaflet/leaflet.js',
  './leaflet/images/marker-icon.png',
  './leaflet/images/marker-icon-2x.png',
  './leaflet/images/marker-shadow.png',
  './js/app.js',
  './js/trajetoria.js',
  './js/offline_tiles.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pré-carregando arquivos estáticos');
      return cache.addAll(CORE_ASSETS).catch(err => {
        console.warn('[SW] Aviso ao pré-carregar alguns arquivos:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Map Tiles (Google Hybrid, Satélite, OpenStreetMap, Topo) -> Cache First + Network Fallback
  if (url.hostname.includes('tile.openstreetmap.org') || 
      url.hostname.includes('tile.opentopomap.org') ||
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('google.com')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response && (response.status === 200 || response.type === 'opaque')) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (err) {
          // Offline e não está em cache
          return new Response('', { status: 408, statusText: 'Offline Tile Unavailable' });
        }
      })
    );
    return;
  }

  // 2. API Endpoints (/api/sondas) -> Network First + Cache Fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'offline', dados: [] }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 3. Demais arquivos (App Shell) -> Cache First + Network Fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
