/*
 * SA Recruiters service worker
 *
 * Navigation strategy: NETWORK-FIRST with a cached-shell fallback.
 *   - A reload / pull-to-refresh is a navigation request. When the device is
 *     online we serve the freshest shell from the network so the app always
 *     reflects the latest deployed HTML/JS.
 *   - When the network is slow or unavailable we fall back to the cached app
 *     shell (index.html / admin.html / privacy.html). The app then refreshes
 *     its directory data independently after startup.
 *   - offline.html is only ever shown as an ABSOLUTE last resort, when no
 *     shell for the route is cached at all. This stops the recurring bug where
 *     an idle app or a pull-to-refresh "fell back to its offline page" simply
 *     because the network was momentarily flaky.
 *
 * Precaching is NON-ATOMIC: each core asset is cached independently so that a
 * single 404 (e.g. an icon not yet shipped) can no longer prevent the whole
 * app shell from installing — which was another cause of the offline page
 * appearing after the next reload.
 */

const VERSION = 'sa-recruiters-v141-wallpaper';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const IMAGE_CACHE = VERSION + '-images';

const CORE_ASSETS = [
  './index.html',
  './admin.html',
  './privacy.html',
  './styles.css',
  './assets/sa-recruiters-signature-wallpaper.png',
  './app.js',
  './icons.svg',
  './offline.html',
  './manifest.json',
  './content.js',
  './content-manager.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/Maskable-192.png',
  './icons/favicon.ico',
  './favicon.ico'
];

// Map of "clean" route paths -> the cached shell document that represents them.
// All SPA routes (home, ?manage=TOKEN, ?manage_employer=TOKEN, ?tab=..., etc.)
// resolve to the same index.html shell, so a token/manager URL always rehydrates
// the app rather than being mistaken for a missing page.
const CORE_SHELLS = {
  '/': './index.html',
  '/index.html': './index.html',
  '/admin.html': './admin.html',
  '/privacy.html': './privacy.html',
  '/offline.html': './offline.html'
};

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CORE_CACHE)
      // Cache each asset independently (non-atomic). A failed addAll leaves
      // the cache empty and is the root cause of "offline page on reload"
      // after a partial install; caching item-by-item guarantees we keep
      // everything that IS available.
      .then(function(cache) {
        return Promise.all(CORE_ASSETS.map(function(asset) {
          return cache.add(asset).catch(function(err) {
            console.warn('[sw] precache miss:', asset, err && err.message);
          });
        }));
      })
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

// Resolve which cached shell document represents a given navigation URL.
// The query string (e.g. ?manage=TOKEN) is intentionally ignored: every SPA
// route is backed by the same index.html shell, and the app reads its own
// query params on startup. Ignoring the query here is what lets a token URL
// hit the cached shell instead of falling through to offline.html.
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

// Return a cached shell for a navigation, ignoring the query string so that
// SPA routes such as /?manage=TOKEN resolve to the cached index.html.
function cachedShellResponse(request) {
  var shell = shellForNavigation(request);
  return caches.match(shell, { ignoreSearch: true }).then(function(response) {
    if (response) return response;
    // A route-specific shell may be absent in an older installation; the main
    // app shell is still a valid fallback for all application routes.
    return shell === './index.html' ? undefined : caches.match('./index.html', { ignoreSearch: true });
  });
}

// NETWORK-FIRST navigation with a cached-shell fallback. This is the fix for
// "every time the app idles or you drag down to refresh it falls back to its
// offline page": a reload now tries the network, and only falls back to the
// cached shell (never offline.html) when the network is unavailable.
function networkFirstNavigation(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      // Keep the freshest shell in the core cache for offline use.
      var shell = shellForNavigation(request);
      if (shell) {
        caches.open(CORE_CACHE).then(function(cache) {
          cache.put(shell, response.clone()).catch(function() {});
        });
      }
      return response;
    }
    throw new Error('Navigation response was not successful');
  }).catch(function() {
    return cachedShellResponse(request).then(function(shell) {
      // Only when there is genuinely no cached shell do we show offline.html.
      return shell || caches.match('./offline.html', { ignoreSearch: true });
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

    event.respondWith(networkFirstNavigation(request));
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
