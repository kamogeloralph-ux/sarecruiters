/*
 * SA Recruiters service worker
 *
 * Navigation strategy: CACHE-FIRST with background revalidation.
 *   - A reload / pull-to-refresh / app-resume-from-idle is a navigation
 *     request. We now answer it INSTANTLY from the cached app shell
 *     (index.html / admin.html / privacy.html) whenever one is cached —
 *     no network round trip gates the paint at all. The app already
 *     refreshes its own directory data client-side after startup, so the
 *     HTML shell itself rarely needs to be network-fresh on every load.
 *   - Immediately after serving the cached shell, we kick off a SILENT
 *     background fetch to refresh that shell in the cache for next time,
 *     and tell any open clients a new version is available (see the
 *     SW_UPDATE_AVAILABLE postMessage below) so the app can offer a
 *     "refresh to update" prompt on its own terms, instead of the
 *     service worker deciding when to interrupt the user.
 *   - Only when NOTHING is cached for the route do we touch the network
 *     on the critical path — and even then, with a hard timeout, so a
 *     stalled connection (very common right after a device wakes up)
 *     can't hang the navigation indefinitely.
 *   - offline.html is only ever shown as an ABSOLUTE last resort: no
 *     cached shell for the route AND the network fetch failed/timed out.
 *
 * WHY THE PREVIOUS NETWORK-FIRST FIX DIDN'T FULLY WORK:
 *   Network-first still gated every navigation on a real fetch resolving
 *   in a reasonable time. On mobile, resuming from backgrounded/idle
 *   often leaves the connection in a slow-to-fail limbo rather than a
 *   clean, fast error — the fetch just hangs. Cache-first removes the
 *   network from the critical path entirely for the common case, and the
 *   timeout below bounds the worst case when there's truly no cache yet.
 *
 * IMPORTANT DEPLOYMENT NOTE:
 *   Browsers only pick up a new service worker when this file's BYTES
 *   change, and only after actually re-fetching it — so sw.js must be
 *   served with Cache-Control: no-cache (or equivalent) at your CDN/host.
 *   If sw.js itself is being cached upstream, devices can keep running an
 *   old worker indefinitely regardless of what ships here.
 *
 * Precaching is NON-ATOMIC: each core asset is cached independently so a
 * single 404 (e.g. an icon not yet shipped) can't prevent the whole app
 * shell from installing.
 */

const VERSION = 'sa-recruiters-v137';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const IMAGE_CACHE = VERSION + '-images';

// How long we'll wait on the network when there is NO cached shell to fall
// back to. Keep this short: the goal is a bounded worst case, not a fully
// reliable fetch — cachedShellResponse()/offline.html already back it up.
const NAVIGATION_NETWORK_TIMEOUT_MS = 4000;

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
      // Navigation preload is RE-ENABLED (previous version disabled it).
      // With cache-first navigations, preload mainly helps the background
      // revalidation fetch start a beat earlier, and helps the cache-miss
      // fallback path resolve faster too.
      return self.registration.navigationPreload
        ? self.registration.navigationPreload.enable().catch(function() {})
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

// Race a promise against a timeout. Used only for the cache-MISS network
// leg below, so a stalled connection can never hang a navigation.
function withTimeout(promise, ms) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error('Navigation network timeout'));
    }, ms);
    promise.then(function(value) {
      clearTimeout(timer);
      resolve(value);
    }, function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Tell any open clients a fresher shell has been cached, so the app can
// decide when (and whether) to prompt the user to refresh. We never force
// a reload from the service worker itself — that decision belongs to the
// UI, which knows if the user is mid-action.
function notifyClientsOfUpdate(shellPath) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'SW_UPDATE_AVAILABLE', shell: shellPath, version: VERSION });
    });
  });
}

// Silently refresh a shell in the background. Never throws, never blocks
// the navigation that triggered it — this is fire-and-forget.
function revalidateShellInBackground(request, preloadResponsePromise) {
  var shell = shellForNavigation(request);
  Promise.resolve(preloadResponsePromise)
    .then(function(preloaded) {
      return preloaded || fetch(request);
    })
    .then(function(response) {
      if (!response || !response.ok) return;
      return caches.open(CORE_CACHE).then(function(cache) {
        return cache.match(shell).then(function(previous) {
          return cache.put(shell, response.clone()).then(function() {
            // Only nag the UI if the shell actually changed; comparing
            // Content-Length is a cheap, good-enough heuristic here.
            var prevLen = previous && previous.headers.get('content-length');
            var nextLen = response.headers.get('content-length');
            if (!previous || prevLen !== nextLen) {
              return notifyClientsOfUpdate(shell);
            }
          });
        });
      });
    })
    .catch(function() {
      // Offline or flaky network during background revalidation is
      // expected and totally fine — the cached shell already served.
    });
}

// CACHE-FIRST navigation with background revalidation. This is the fix for
// "every time the app idles or you drag down to refresh it falls back to
// its offline page": a cached shell now answers instantly, with no network
// round trip on the critical path. The network is only ever load-bearing
// when there is genuinely no cached shell yet (e.g. first install), and
// even then it's bounded by NAVIGATION_NETWORK_TIMEOUT_MS.
function cacheFirstNavigation(request, event) {
  return cachedShellResponse(request).then(function(cached) {
    if (cached) {
      // Serve instantly, refresh in the background, never block on it.
      var preload = event && event.preloadResponse;
      event && event.waitUntil && event.waitUntil(
        revalidateShellInBackground(request, preload)
      );
      return cached;
    }

    // No cached shell at all (e.g. very first load before install ran, or
    // a brand-new route). Fall back to a time-boxed network fetch.
    var networkPromise = (event && event.preloadResponse
      ? event.preloadResponse.then(function(preloaded) { return preloaded || fetch(request); })
      : fetch(request)
    ).then(function(response) {
      if (response && response.ok) {
        var shell = shellForNavigation(request);
        caches.open(CORE_CACHE).then(function(cache) {
          cache.put(shell, response.clone()).catch(function() {});
        });
        return response;
      }
      throw new Error('Navigation response was not successful');
    });

    return withTimeout(networkPromise, NAVIGATION_NETWORK_TIMEOUT_MS).catch(function() {
      // Re-check the cache in case another in-flight request populated it
      // while we were waiting, then fall back to the true offline page.
      return cachedShellResponse(request).then(function(shell) {
        return shell || caches.match('./offline.html', { ignoreSearch: true });
      });
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

    event.respondWith(cacheFirstNavigation(request, event));
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
