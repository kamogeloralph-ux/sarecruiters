/*
 * SA Recruiters service worker
 *
 * Navigation strategy: CACHE-FIRST with background revalidation.
 *   - A reload / pull-to-refresh / app-resume-from-idle is a navigation
 *     request. We answer it INSTANTLY from the cached app shell
 *     (index.html / admin.html / privacy.html) whenever one is cached —
 *     no network round trip gates the paint at all.
 *   - Immediately after serving the cached shell, we kick off a SILENT
 *     background fetch to refresh that shell in the cache for next time,
 *     and tell any open clients a new version is available (see the
 *     SW_UPDATE_AVAILABLE postMessage below).
 *   - Only when NOTHING is cached for the route do we touch the network
 *     on the critical path — and even then, with a hard timeout.
 *   - offline.html is only ever shown as an ABSOLUTE last resort: no
 *     cached shell for the route AND the network fetch failed/timed out.
 *
 * WHY IT CAN STILL HAPPEN EVEN WITH CACHE-FIRST:
 *   Every write into Cache Storage can THROW instead of succeeding — most
 *   commonly because the response carries a `Vary: *` header (or another
 *   header combination the Cache Storage spec forbids storing). Earlier
 *   versions of this file wrapped those cache.put() calls in a bare
 *   .catch(() => {}), which means a shell could silently, permanently fail
 *   to ever get cached — with nothing in the console to say so. From the
 *   outside that looks identical to "cache-first isn't working": there's
 *   simply nothing in the cache to be first with, so every idle/resume
 *   navigation falls through to a live network fetch, and mobile networks
 *   right after resume are exactly when that's likely to fail or hang.
 *
 *   This version (a) logs every cache-write failure loudly instead of
 *   swallowing it, (b) records precache/runtime cache failures into a
 *   queryable diagnostics entry, and (c) automatically retries a failed
 *   shell write with the problematic response headers stripped, so a
 *   Vary:* (or similar) response from your server no longer permanently
 *   blocks the shell from ever being cached.
 *
 * IMPORTANT DEPLOYMENT NOTE:
 *   Browsers only pick up a new service worker when this file's BYTES
 *   change, and only after re-fetching it — sw.js must be served with
 *   Cache-Control: no-cache (or equivalent) at your CDN/host, or devices
 *   can keep running an old worker indefinitely.
 */

const VERSION = 'sa-recruiters-v139';
const CORE_CACHE = VERSION + '-core';
const RUNTIME_CACHE = VERSION + '-runtime';
const IMAGE_CACHE = VERSION + '-images';
const DIAGNOSTICS_KEY = './__sw-diagnostics.json';

// How long we'll wait on the network when there is NO cached shell to fall
// back to.
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
const CORE_SHELLS = {
  '/': './index.html',
  '/index.html': './index.html',
  '/admin.html': './admin.html',
  '/privacy.html': './privacy.html',
  '/offline.html': './offline.html'
};

// --- Diagnostics -----------------------------------------------------------
// Cache-write failures used to be swallowed silently. We now record them
// here (fetchable at runtime as GET /__sw-diagnostics.json against the SW's
// own scope via caches, or by the app calling navigator.serviceWorker to ask)
// so a repeat of "shell never actually got cached" is visible, not a guess.
var diagnosticsLog = [];

function recordDiagnostic(entry) {
  entry.time = new Date().toISOString();
  diagnosticsLog.push(entry);
  if (diagnosticsLog.length > 50) diagnosticsLog.shift();
  console.error('[sw diagnostics]', entry);
  return caches.open(RUNTIME_CACHE).then(function(cache) {
    return cache.put(
      DIAGNOSTICS_KEY,
      new Response(JSON.stringify({ version: VERSION, log: diagnosticsLog }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  }).catch(function() {
    // If even this fails, there's nothing further we can safely do —
    // but the console.error above still got the info out.
  });
}

// Cache Storage rejects writes for responses with certain header
// combinations — most commonly `Vary: *`. Try the write as-is first; if it
// throws, retry with a clean Response that drops the problematic headers so
// legitimate content isn't lost just because of response headers we don't
// actually need for a cached shell.
function safeCachePut(cache, key, response) {
  return cache.put(key, response.clone()).catch(function(err) {
    return response.clone().blob().then(function(body) {
      var cleanHeaders = new Headers();
      response.headers.forEach(function(value, name) {
        var lower = name.toLowerCase();
        if (lower === 'vary' || lower === 'set-cookie') return;
        cleanHeaders.set(name, value);
      });
      var cleaned = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: cleanHeaders
      });
      return cache.put(key, cleaned).catch(function(err2) {
        return recordDiagnostic({
          type: 'cache-put-failed',
          key: key,
          firstError: String(err && err.message || err),
          retryError: String(err2 && err2.message || err2)
        });
      });
    });
  });
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(function(cache) {
        return Promise.all(CORE_ASSETS.map(function(asset) {
          return fetch(asset).then(function(response) {
            if (!response || !response.ok) {
              return recordDiagnostic({ type: 'precache-bad-response', asset: asset, status: response && response.status });
            }
            return safeCachePut(cache, asset, response);
          }).catch(function(err) {
            return recordDiagnostic({ type: 'precache-fetch-failed', asset: asset, error: String(err && err.message || err) });
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

// icons.svg is the app's icon SPRITE (referenced everywhere via <use>), not
// a photo — it's precached into CORE_CACHE alongside the rest of the shell
// at install. isImageRequest() above would otherwise route it into
// IMAGE_CACHE instead, where it was never stored, guaranteeing a cache miss
// on every single icon lookup. That miss then falls to the network, and
// when offline, falls further to offline.html's markup being handed back
// for an SVG request — which is what rendered as solid black icon shapes.
function isSpriteAsset(request) {
  return /\/icons\.svg(?:$|\?)/i.test(request.url);
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
          safeCachePut(cache, request, response.clone());
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
          safeCachePut(cache, request, response.clone());
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
        safeCachePut(cache, request, response.clone());
      });
      return response;
    }).catch(function() {
      return caches.match(request).then(function(exactCached) {
        return exactCached || caches.match('./offline.html');
      });
    });
  });
}

function cachedShellResponse(request) {
  var shell = shellForNavigation(request);
  return caches.match(shell, { ignoreSearch: true }).then(function(response) {
    if (response) return response;
    return shell === './index.html' ? undefined : caches.match('./index.html', { ignoreSearch: true });
  });
}

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

function notifyClientsOfUpdate(shellPath) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'SW_UPDATE_AVAILABLE', shell: shellPath, version: VERSION });
    });
  });
}

function revalidateShellInBackground(request, preloadResponsePromise) {
  var shell = shellForNavigation(request);
  return Promise.resolve(preloadResponsePromise)
    .then(function(preloaded) {
      return preloaded || fetch(request);
    })
    .then(function(response) {
      if (!response || !response.ok) {
        return recordDiagnostic({ type: 'revalidate-bad-response', shell: shell, status: response && response.status });
      }
      return caches.open(CORE_CACHE).then(function(cache) {
        return cache.match(shell).then(function(previous) {
          return safeCachePut(cache, shell, response.clone()).then(function() {
            var prevLen = previous && previous.headers.get('content-length');
            var nextLen = response.headers.get('content-length');
            if (!previous || prevLen !== nextLen) {
              return notifyClientsOfUpdate(shell);
            }
          });
        });
      });
    })
    .catch(function(err) {
      return recordDiagnostic({ type: 'revalidate-fetch-failed', shell: shell, error: String(err && err.message || err) });
    });
}

function cacheFirstNavigation(request, event) {
  return cachedShellResponse(request).then(function(cached) {
    if (cached) {
      var preload = event && event.preloadResponse;
      event && event.waitUntil && event.waitUntil(
        revalidateShellInBackground(request, preload)
      );
      return cached;
    }

    var networkPromise = (event && event.preloadResponse
      ? event.preloadResponse.then(function(preloaded) { return preloaded || fetch(request); })
      : fetch(request)
    ).then(function(response) {
      if (response && response.ok) {
        var shell = shellForNavigation(request);
        caches.open(CORE_CACHE).then(function(cache) {
          safeCachePut(cache, shell, response.clone());
        });
        return response;
      }
      throw new Error('Navigation response was not successful');
    });

    return withTimeout(networkPromise, NAVIGATION_NETWORK_TIMEOUT_MS).catch(function(err) {
      return cachedShellResponse(request).then(function(shell) {
        if (shell) return shell;
        return recordDiagnostic({
          type: 'navigation-fell-back-to-offline',
          url: request.url,
          error: String(err && err.message || err)
        }).then(function() {
          return caches.match('./offline.html', { ignoreSearch: true });
        });
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

  // Lets the app fetch its own diagnostics on demand, e.g.
  // fetch('./__sw-diagnostics.json').then(r => r.json())
  if (url.pathname.endsWith('/__sw-diagnostics.json')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(function(cache) {
        return cache.match(DIAGNOSTICS_KEY).then(function(response) {
          return response || new Response(JSON.stringify({ version: VERSION, log: [] }), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    if (isPublicListingNavigation(request)) {
      event.respondWith(publicListingNavigation(request));
      return;
    }

    event.respondWith(cacheFirstNavigation(request, event));
    return;
  }

  if (isSpriteAsset(request)) {
    event.respondWith(cacheFirst(request, CORE_CACHE));
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
          safeCachePut(cache, request, response.clone());
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
          return safeCachePut(cache, './content.js', response);
        });
      }).catch(function() {})
    );
  }
});
