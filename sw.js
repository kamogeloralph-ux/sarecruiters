const CACHE_NAME = 'sa-recruiters-v3';
const ASSETS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') {
    return; // let POST/PATCH/DELETE (Supabase writes) pass through untouched
  }
  var isOwnAsset = event.request.url.indexOf(self.location.origin) === 0;
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (isOwnAsset && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
        }
        return response;
      })
      .catch(function() {
        return caches.match(event.request);
      })
  );
});

