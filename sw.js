/*
 * SA Recruiters service worker
 *
 * Navigation uses the cached app shell first. This is intentional: a browser
 * reload/pull-to-refresh is a navigation request, and the app shell must be
 * available even when the network is slow or temporarily unavailable. The
 * application then refreshes its directory data independently after startup.
 */

const VERSION = 'sa-recruiters-v132';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const IMAGE_CACHE = VERSION + '-images';

const CORE_ASSETS = [
  './index.html',
  './admin.html',
  './privacy.html',
  './styles.css',
  './app.js',
  './icons.svg',
  './offline.html',
  './manifest.json',
  './content.js',
  './content-manager.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/Maskable-192.png',
  './icons/favicon.ico'
];

const CORE_SHELLS = {
  '/': './index.html',
  '/admin.html': './admin.html',
  '/privacy.html': './privacy.html',
  '/offline.html': './offline.html'
};

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CORE_CACHE)
      // Keep installation atomic for the app shell. Activating a worker with
      // a partial shell is what causes an offline page after the next reload.
      .then(function(cache) { return cache.addAll(CORE_ASSETS); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names
        .filter(function(name) {
          return name.indexOf('sa-recruiters-') === 0 &&
            name !== CORE_CACHE &&
            name !== RUNTIME_CACHE &&
            name !== IMAGE_CACHE;
        })
        .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.registration.navigationPreload
        ? self.registration.navigationPreload.disable().catch(function() {})
        : undefined;
    }).then(function() {
      return self.clients.claim();
    })
  );
});

function isImageRequest(request) {
  return request.destination === 'image' ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(request.url);
}

function isCacheableSameOriginResponse(response) {
  return response && response.status === 200 &&
    (response.type === 'basic' || response.type === 'cors');
}

function isCacheableCrossOriginResponse(response) {
  return response && (response.status === 200 || response.status === 0);
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var network = fetch(request).then(function(response) {
        if (isCacheableSameOriginResponse(response)) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() { return cached; });
      return cached || network;
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (isCacheableSameOriginResponse(response) ||
            isCacheableCrossOriginResponse(response)) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() {
        return caches.match('./offline.html');
      });
    });
  });
}

function shellForNavigation(request) {
  var pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  return CORE_SHELLS[pathname] || './index.html';
}

function isPublicListingNavigation(request) {
  var pathname = new URL(request.url).pathname;
  return /^\/(agency|vacancy)(?:\/|$)/i.test(pathname);
}

function publicListingNavigation(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(response) {
      if (!response || !response.ok) {
        throw new Error('Public listing response was not successful');
      }
      caches.open(RUNTIME_CACHE).then(function(cache) {
        cache.put(request, response.clone());
      });
      return response;
    }).catch(function() {
      // Never substitute the SPA shell for a public listing URL. If the page
      // was visited before, an exact runtime-cached copy is valid; otherwise
      // show the true offline page rather than a misleading empty home screen.
      return caches.match(request).then(function(exactCached) {
        return exactCached || caches.match('./offline.html');
      });
    });
  });
}

function cachedShellResponse(request) {
  var shell = shellForNavigation(request);
  return caches.match(shell).then(function(response) {
    if (response) return response;
    // A route-specific shell may be absent in an older installation; the main
    // app shell is still a valid fallback for all application routes.
    return shell === './index.html' ? undefined : caches.match('./index.html');
  });
}

function networkNavigationFallback(request) {
  return fetch(request).then(function(response) {
    // Do not return a server error as a successful navigation response.
    if (response && response.ok) return response;
    throw new Error('Navigation response was not successful');
  }).catch(function() {
    return cachedShellResponse(request).then(function(shell) {
      return shell || caches.match('./offline.html');
    });
  });
}

self.addEventListener('fetch', function(event) {
  var request = event.request;

  if (request.method !== 'GET') {
    if (request.method === 'POST' && request.url.indexOf('action=share') !== -1) {
      event.respondWith(Response.redirect('/?source=pwa&action=share-received', 303));
    }
    return;
  }

  var url = new URL(request.url);

  if (request.mode === 'navigate') {
    if (isPublicListingNavigation(request)) {
      event.respondWith(publicListingNavigation(request));
      return;
    }

    event.respondWith(
      // Cache-first is the key fix for the SPA shell. A pull-to-refresh must
      // never replace a healthy cached app shell with offline.html merely
      // because the network request is slow or momentarily unavailable.
      cachedShellResponse(request).then(function(cached) {
        return cached || networkNavigationFallback(request);
      })
    );
    return;
  }

  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(
    fetch(request).then(function(response) {
      if (isCacheableCrossOriginResponse(response)) {
        caches.open(RUNTIME_CACHE).then(function(cache) {
          cache.put(request, response.clone());
        });
      }
      return response;
    }).catch(function() {
      return caches.match(request);
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('push', function(event) {
  var payload = { title: 'SA Recruiters', body: 'You have a new update', data: { url: '/' } };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (error) {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: 'icons/icon-192.png',
    badge: 'icons/monochrome-192.png',
    vibrate: [80, 40, 80],
    data: payload.data || { url: '/' },
    tag: payload.tag || 'sa-recruiters',
    renotify: true
  }));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if ('focus' in clients[i]) {
          clients[i].focus();
          clients[i].navigate(targetUrl);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('sync', function(event) {
  if (event.tag === 'sa-sync-pending') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SYNC_PENDING' });
        });
      })
    );
  }
});

self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'sa-refresh-content') {
    event.waitUntil(
      fetch('./content.js', { cache: 'reload' }).then(function(response) {
        if (!response.ok) throw new Error('Content refresh failed');
        return caches.open(RUNTIME_CACHE).then(function(cache) {
          return cache.put('./content.js', response);
        });
      }).catch(function() {})
    );
  }
});
