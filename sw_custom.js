// ╔═══════════════════════════════════════════════════════════════════════╗
// ║          PERLO — Service Worker Personalizado (sw_custom.js)          ║
// ║  Network-First para Supabase API, cache de assets Flutter, offline    ║
// ║                                                                       ║
// ║  NOTA: NO se importa flutter_service_worker.js porque el import       ║
// ║  síncrono bloquea el registro y causa timeout > 4s (ciclo de F5).    ║
// ║  En su lugar, se cachean manualmente los assets críticos.             ║
// ╚═══════════════════════════════════════════════════════════════════════╝

'use strict';

const CACHE_VERSION = 'perlo-v3';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

const SUPABASE_HOSTS = [
  'supabase.co',
  'supabase.com',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll([
        './',
        './offline.html',
        './manifest.json',
        './favicon.png',
        './icons/Icon-192.png',
        './icons/Icon-512.png',
      ]).catch(function (err) {
        console.warn('[Perlo SW] Error precargando assets:', err);
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) {
            return name.startsWith('perlo-') && name !== STATIC_CACHE && name !== DATA_CACHE;
          })
          .map(function (name) {
            return caches.delete(name);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // ── Supabase / API → Network-First con fallback a cache ──
  const isSupabase = SUPABASE_HOSTS.some(function (host) {
    return url.hostname.includes(host);
  });
  if (isSupabase) {
    event.respondWith(networkFirstWithCache(event.request, DATA_CACHE));
    return;
  }

  // ── Navegación HTML → Network con fallback a cache ──
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match('./offline.html');
      })
    );
    return;
  }

  // ── Assets estáticos (JS, CSS, imágenes, fuentes) → Cache-First ──
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response.ok && response.type === 'basic') {
          var cloned = response.clone();
          caches.open(STATIC_CACHE).then(function (cache) {
            cache.put(event.request, cloned);
          });
        }
        return response;
      });
    })
  );
});

async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Sin conexión y sin datos en caché' }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
