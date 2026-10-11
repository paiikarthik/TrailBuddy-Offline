/**
 * TrailBuddy Offline - Service Worker
 * Provides offline-first Progressive Web App capabilities for Hacktoberfest 2026.
 *
 * Strategies:
 * 1. App Shell & Static Assets: Cache-First with Network fallback.
 * 2. Navigation (HTML pages): Network-First with Cache fallback -> Offline Fallback Page.
 * 3. Read-only Data (/api/activities, /api/challenges): Stale-While-Revalidate.
 * 4. Plan Generation (/api/plan): Network-Only (never caches stale AI or private plans).
 */

const CACHE_NAME = 'trailbuddy-v1.0.0';

const PRECACHE_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/static/css/styles.css',
  '/static/js/app.js',
  '/static/js/journal.js',
  '/static/js/offline.js',
  '/static/icons/icon.svg',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/api/activities',
  '/api/challenges'
];

// Install Event: Pre-cache App Shell and Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching application shell and datasets...');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing deprecated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Implement specialized caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept non-GET requests (e.g. POST /api/plan)
  // Let the browser handle POST requests directly so client JS can handle network errors gracefully
  if (request.method !== 'GET') {
    return;
  }

  // 2. Navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache fresh copy of navigable pages
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed: return cached page or offline fallback
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // 3. Bundled datasets (/api/activities, /api/challenges): Stale-While-Revalidate
  if (url.pathname === '/api/activities' || url.pathname === '/api/challenges') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => null);

          // Return cached response immediately if available, else await network
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. Static assets (CSS, JS, images, icons, fonts, manifest): Cache-First
  if (
    url.pathname.startsWith('/static/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 5. Default network-first for other GET requests
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
