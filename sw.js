/*
 * SA Recruiters production service worker.
 *
 * Navigation is network-first so users receive fresh HTML whenever possible;
 * the last good shell (or offline page) is used when the network is unavailable.
 * Static assets are stale-while-revalidate, while startup data is network-first
 * because it changes independently of the app shell.
 */
const VERSION = 'sa-recruiters-3b2b5f1bdc';
const CACHE_NAME = VERSION + '-runtime';
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/styles.css',
  '/community.css',
  '/static-pages.css',
  '/app.bundle.min.js',
  '/vendor/supabase.min.js',
  '/icons/v2-icon-192.png',
  '/icons/v2-icon-512.png',
  '/icons/v2-Maskable-512.png',
];

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function cacheResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.put(request, response.clone()).then(function() { return response; });
  }).catch(function() { return response; });
}

function networkFirst(request, fallbackRequest) {
  return fetch(request).then(function(response) {
    return cacheResponse(request, response);
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      return fallbackRequest ? caches.match(fallbackRequest) : null;
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(function(cached) {
    var refresh = fetch(request).then(function(response) {
      return cacheResponse(request, response);
    }).catch(function() { return null; });
    return cached || refresh;
  });
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return fetch(new Request(url, { cache: 'no-cache' }))
          .then(function(response) {
            if (response.ok) return cache.put(url, response);
            return null;
          })
          .catch(function() { return null; });
      }));
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(name) {
        return name.indexOf('sa-recruiters-') === 0 && name !== CACHE_NAME;
      }).map(function(name) { return caches.delete(name); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET' || !isSameOrigin(request)) return;

  var url = new URL(request.url);
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, '/').then(function(response) {
        if (!response) {
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) { clients.forEach(function(client) { client.postMessage({ type: 'OFFLINE_LAUNCH' }); }); });
      }
      return response || caches.match('/offline.html');
      })
    );
    return;
  }

  if (url.pathname === '/data/startup.json' || url.pathname.indexOf('/api/') === 0) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (['style', 'script', 'image', 'font'].indexOf(request.destination) !== -1) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', function(event) {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'SA Recruiters', body: event.data ? event.data.text() : 'New vacancy alert' }; }
  var title = data.title || 'New vacancy match';
  var options = { body: data.body || 'A new vacancy matches one of your saved searches.', icon: '/icons/v2-icon-192.png', badge: '/icons/v2-monochrome-192.png', tag: data.tag || 'sa-recruiters-vacancy', renotify: true, data: { url: data.url || '/?source=push' } };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = event.notification.data && event.notification.data.url || '/?source=push';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
    for (var i = 0; i < clients.length; i++) { if ('focus' in clients[i]) { clients[i].navigate(target); return clients[i].focus(); } }
    return self.clients.openWindow(target);
  }));
});
