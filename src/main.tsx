import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';

// Register the service worker, but never in development.
//
// A cache-first service worker pins whichever build it saw first. That is how a
// device can keep showing a palette and a radar that were deleted weeks ago: the
// HTML is fetched from the network, the modules come from disk. Registration in
// dev is therefore refused outright, and any previously installed worker is
// removed.
//
// `__DEV__` is substituted at build time by scripts/build.mjs, which is the only
// way this flag can be dead-code-eliminated out of the production bundle.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  if (__DEV__) {
    // Development: remove any worker a previous production visit left behind, and
    // drop its caches. A stale worker would otherwise answer for /assets/* and the
    // page would render a build that is not on disk.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) registration.unregister();
    });
    if (typeof caches !== "undefined") {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    }
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        console.log("[Service Worker] Registration successful with scope: ", registration.scope);
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[Service Worker] A new version is available. Refresh to update.");
            }
          });
        });
      }).catch((error) => {
        console.error("[Service Worker] Registration failed: ", error);
      });
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

