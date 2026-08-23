/* ==========================================================================
   SA Recruiters — Service Worker
   Strategies:
     - Precache core app shell on install
     - Cache-first for static assets (icons, screenshots, fonts cache)
     - Stale-while-revalidate for same-origin JS/CSS/JSON
     - Network-first for navigation (HTML) with offline fallback
     - passthrough + cache for cross-origin (CDN/Supabase)
   Handles: install, activate, fetch, message, push, notificationclick,
            sync, periodicsync, beforeevicted, controllerchange-friendly skipWaiting
   ========================================================================== */

const VERSION = 'sa-recruiters-v51';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const IMAGE_CACHE = VERSION + '-images';

const CORE_ASSETS = [
  './',
  './index.html',
  './admin.html',
  './offline.html',
  './manifest.json',
  './content.js',
  './content-manager.js',
  './privacy.html',
  './icon-192.png',
  './icon-512.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/favicon.ico',
  './screenshots/mobile-1.png',
  './screenshots/desktop-1.png'
];

// ---------- INSTALL: precache core shell ----------
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CORE_CACHE).then(function(cache) {
      // addAll fails atomically if one request fails; use tolerant add
      return Promise.all(
        CORE_ASSETS.map(function(url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function() {
            /* ignore individual failures (e.g. missing optional asset) */
          });
        })
      );
    }).then(function() {
      // enable navigation preload if supported
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable();
      }
    })
  );
});

// ---------- ACTIVATE: clean old caches + claim clients ----------
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names
          .filter(function(n) { return n.indexOf('sa-recruiters-') === 0 && n !== VERSION + '-core' && n !== VERSION + '-runtime' && n !== VERSION + '-images'; })
          .map(function(n) { return caches.delete(n); })
      );
    }).then(function() {
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.reset();
      }
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ---------- helpers ----------
function isImageRequest(req) {
  return req.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(req.url);
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var fetchPromise = fetch(request).then(function(response) {
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() { return caches.match('./offline.html'); });
    });
  });
}

function networkFirstWithFallback(request) {
  return fetch(request).then(function(response) {
    if (response && response.status === 200 && response.type === 'basic') {
      var copy = response.clone();
      caches.open(RUNTIME_CACHE).then(function(cache) { cache.put(request, copy); });
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      return cached || caches.match('./index.html').then(function(idx) {
        return idx || caches.match('./offline.html');
      });
    });
  });
}

// ---------- FETCH ----------
self.addEventListener('fetch', function(event) {
  var req = event.request;

  // Only handle GET
  if (req.method !== 'GET') {
    // Allow share_target POST to be received offline — store and let app handle
    if (req.method === 'POST' && req.url.indexOf('action=share') !== -1) {
      event.respondWith(Response.redirect('/?source=pwa&action=share-received', 303));
      return;
    }
    return;
  }

  var url = new URL(req.url);

  // Navigation requests -> network first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      (function() {
        var preload = event.preloadResponse;
        if (preload) {
          return preload.then(function(resp) {
            if (resp && resp.ok) {
              var copy = resp.clone();
              caches.open(RUNTIME_CACHE).then(function(c) { c.put(req, copy); });
              return resp;
            }
            return networkFirstWithFallback(req);
          }).catch(function() { return networkFirstWithFallback(req); });
        }
        return networkFirstWithFallback(req);
      })()
    );
    return;
  }

  // Images -> cache first, then runtime
  if (isImageRequest(req)) {
    event.respondWith(cacheFirst(req, IMAGE_CACHE));
    return;
  }

  // Same-origin static assets (js, css, json, fonts) -> stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Cross-origin (CDNs / Supabase) -> network, cache good responses, fallback to cache
  event.respondWith(
    fetch(req).then(function(response) {
      if (response && (response.status === 200 || response.status === 0)) {
        var copy = response.clone();
        caches.open(RUNTIME_CACHE).then(function(cache) { cache.put(req, copy); });
      }
      return response;
    }).catch(function() {
      return caches.match(req);
    })
  );
});

// ---------- MESSAGE: allow page to trigger update ----------
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

// ---------- PUSH notifications ----------
self.addEventListener('push', function(event) {
  var payload = { title: 'SA Recruiters', body: 'You have a new update', data: { url: '/' } };
  try { if (event.data) payload = Object.assign(payload, event.data.json()); } catch (e) { if (event.data) payload.body = event.data.text(); }
  var options = {
    body: payload.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/monochrome-192.png',
    vibrate: [80, 40, 80],
    data: payload.data || { url: '/' },
    tag: payload.tag || 'sa-recruiters',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ---------- NOTIFICATION CLICK ----------
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        if ('focus' in c) { c.focus(); c.navigate(targetUrl); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// ---------- BACKGROUND SYNC (resubmit pending reports/suggestions) ----------
self.addEventListener('sync', function(event) {
  if (event.tag === 'sa-sync-pending') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
        clients.forEach(function(c) { c.postMessage({ type: 'SYNC_PENDING' }); });
      })
    );
  }
});

// ---------- PERIODIC SYNC ----------
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'sa-refresh-content') {
    event.waitUntil(
      fetch('./content.js', { cache: 'reload' }).then(function(r) {
        return caches.open(RUNTIME_CACHE).then(function(c) { return c.put('./content.js', r); });
      }).catch(function() {})
    );
  }
});

// ---------- EVICTION / clean shutdown ----------
self.addEventListener('beforeevicted', function() { /* allow cleanup before eviction */ });
self.addEventListener('evicted', function() { /* SW was evicted */ });
