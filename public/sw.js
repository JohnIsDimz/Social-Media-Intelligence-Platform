const CACHE_NAME = 'smip-static-v4';

// Only images are precached. The documents used to be in here as well, which
// meant the worker kept a frozen copy of the app shell: the phone would load the
// HTML it stored weeks ago alongside freshly fetched scripts, and the mixed pair
// rendered a layout nobody had shipped. Documents are network-only now, so there
// is nothing to precache except the icon a notification needs while offline.
const PRE_CACHE_RESOURCES = ['/favicon.png'];

self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installed');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRE_CACHE_RESOURCES);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activated');
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );

      await self.clients.claim();

      // Reload every open tab once, right after taking control.
      //
      // This is the part that actually fixes a device stuck on an old build, and
      // it has to run here rather than in the page: `sw.js` is fetched from the
      // network by the browser's update check, while the page itself may still be
      // the stale HTML the previous worker kept on disk — a page that cannot
      // repair itself because the code containing the repair is the code it is
      // not running. Activating navigates those windows into the current build.
      //
      // It runs at most once per worker version (`activate` fires once), and the
      // reload it causes is served by this worker, which never returns a cached
      // document, so it cannot loop.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try {
          await client.navigate(client.url);
        } catch (err) {
          console.warn('[Service Worker] Could not reload client:', err);
        }
      }
    })()
  );
});

// Cache-First strategy for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Avoid caching non-GET requests, API endpoints, or WebSockets
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // Never take part in serving the app shell itself.
  //
  // Vite serves the dashboard as unbundled modules (/src/main.tsx, /src/App.tsx,
  // /src/index.css) in development, and as hashed bundles in production. A
  // cache-first match on anything that ends in .js/.css/.tsx pins whichever build
  // was online first: a phone kept rendering a palette and a radar that no longer
  // exist in the repository, because the service worker kept answering from disk.
  // The shell is cheap to fetch and always correct from the network, so it is
  // simply skipped here.
  const isSourceModule = /\/src\/|\/@vite\/|\/@react-refresh|\/node_modules\//.test(url.pathname);
  if (isSourceModule) return;

  // Bumped build assets are content-addressed and safe to cache forever; the
  // service worker only needs to cache the icons a notification shows offline.
  const isStaticAsset =
    event.request.destination === 'image' ||
    event.request.destination === 'font' ||
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf)$/.test(url.pathname);

  // Network-first for documents so a new deployment is picked up immediately
  // instead of being pinned to an old cached index.html.
  if (event.request.destination === 'document') {
    // Network only. A cached document is a cached build, and this app deploys
    // often enough that "open the app and see last week's version" is worse than
    // an honest offline error.
    event.respondWith(fetch(event.request));
    return;
  }

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Serve from cache immediately
          return cachedResponse;
        }

        // Fetch from network, cache it for future, and return
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Fetch failed, offline fallback:', err);
          // If offline and request is document, try to serve root index.html
          if (event.request.destination === 'document') {
            return caches.match('/');
          }
        });
      })
    );
  }
});

self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received');
  let data = { title: 'Peringatan S.M.I.P', body: 'Deteksi anomali di latar belakang!' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Peringatan S.M.I.P', body: event.data.text() };
    }
  }
  
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      vibrate: [200, 100, 200],
      tag: data.tag || 'smip-alert',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
            break;
          }
        }
        return client.focus();
      }
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
