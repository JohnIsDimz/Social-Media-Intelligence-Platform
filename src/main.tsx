import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register the service worker, but never in development.
//
// In dev the dashboard is served as unbundled /src modules, and a cache-first
// service worker pins whichever copy it saw first. That is how a device can keep
// showing a palette and a radar that were deleted weeks ago: the HTML is fetched
// from the network, the modules come from disk. Registration in dev is therefore
// refused outright, and any previously installed worker is removed.
const isDev = import.meta.env.DEV;

if (typeof window !== "undefined" && "serviceWorker" in navigator && isDev) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) registration.unregister();
  });
  if (typeof caches !== "undefined") {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }
}

if (typeof window !== "undefined" && "serviceWorker" in navigator && !isDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[Service Worker] Registration successful with scope: ', registration.scope);

        // Handle updates gracefully
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[Service Worker] A new version is available. Refresh to update.');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error('[Service Worker] Registration failed: ', error);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

