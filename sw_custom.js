// ╔═══════════════════════════════════════════════════════════════════════╗
// ║          PERLO — Service Worker Personalizado (sw_custom.js)          ║
// ║  Estrategias: Network-First para API, Fallback a SW de Flutter        ║
// ╚═══════════════════════════════════════════════════════════════════════╝

'use strict';

const CACHE_VERSION = 'perlo-v2';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

// Dominios que identifican llamadas a Supabase (Network-First)
const SUPABASE_HOSTS = [
  'supabase.co',
  'supabase.com',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(['./offline.html']).catch(function (err) {
        console.warn('[Perlo SW] Error precargando offline.html:', err);
      });
    })
  );
  self.skipWaiting();
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
  const url = new URL(event.request.url);

  // Ignorar requests que no son GET (POST, PUT, DELETE van siempre a red)
  if (event.request.method !== 'GET') return;

  // Ignorar chrome-extension y otros esquemas no http
  if (!event.request.url.startsWith('http')) return;

  // ── Estrategia A: Supabase / API → Network-First con fallback a cache ──
  const isSupabase = SUPABASE_HOSTS.some(host => url.hostname.includes(host));
  if (isSupabase) {
    event.respondWith(networkFirstWithCache(event.request, DATA_CACHE));
    return;
  }

  // ── Estrategia B: Página offline.html ──────────
  if (url.pathname.endsWith('offline.html')) {
    event.respondWith(
      caches.match('./offline.html').then(function (response) {
        return response || fetch(event.request);
      })
    );
    return;
  }

  // Nota: Todas las demás peticiones (HTML, JS de Flutter, Assets, Fuentes)
  // NO llaman a event.respondWith(), por lo que se delegan al service worker
  // nativo de Flutter importado abajo.
});

/**
 * Network-First con fallback a cache para datos dinámicos.
 */
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

// ── IMPORTAR SERVICE WORKER GENERADO POR FLUTTER ──────────────────────────────
// Esto permite que el Service Worker nativo de Flutter gestione la caché de todos
// los assets de la aplicación (main.dart.js, canvaskit, fuentes, etc.) sin interferir.
importScripts('flutter_service_worker.js');
