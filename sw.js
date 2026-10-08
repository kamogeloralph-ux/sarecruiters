/*
 * SA Recruiters service-worker kill switch.
 *
 * The former worker cached navigation documents and runtime responses. That
 * could make a returning PWA render a stale shell or data from another route.
 * This file intentionally has no fetch handler: once it activates, browser
 * navigations and API requests go directly to the network.
 *
 * Keep this file at /sw.js for at least one full release so browsers that have
 * the old worker registered receive and activate the cleanup worker.
 */
const VERSION = 'sa-recruiters-c58858cc35';
const APP_CACHE_PREFIX = 'sa-recruiters-';

self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(name) {
        return name.indexOf(APP_CACHE_PREFIX) === 0;
      }).map(function(name) {
        return caches.delete(name);
      }));
    }).then(function() {
      // Existing PWA tabs can still be rendering the old cached shell even
      // after this cleanup worker activates. Reload those tabs once so the
      // current network HTML/CSS/JS is painted immediately.
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
        return Promise.all(clients.map(function(client) {
          return client.navigate(client.url).catch(function() {});
        }));
      });
    }).then(function() {
      return self.registration.unregister();
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});
