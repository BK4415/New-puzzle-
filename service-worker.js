/* Number Puzzle Pro — Advanced Service Worker v1.1 */
const CACHE_NAME = 'npp-v1.1';

// In assets ko cache mein store kiya jayega
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './assets/icons/logo.png',
  './assets/images/preset-1.jpg',
  './assets/images/preset-2.jpg',
  './assets/images/preset-3.jpg',
  './assets/images/preset-4.jpg',
  './assets/sound/move.wav',
  './assets/sound/click.wav',
  './assets/sound/win.wav',
  './assets/sound/error.wav',
  './pages/about.html',
  './pages/guide.html',
  './pages/privacy.html'
];

// Install Event: Assets ko cache mein save karna
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate Event: Purane caches ko delete karna
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Offline support + Performance
self.addEventListener('fetch', event => {
  const req = event.request;
  
  // Sirf GET requests handle karein
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cachedResponse => {
      // Agar cache mein hai toh wahi dikhao, saath mein background mein update check karo
      const fetchPromise = fetch(req).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, responseClone));
        }
        return networkResponse;
      }).catch(() => {
        // Agar network fail ho jaye aur cache mein bhi na ho, toh index.html dikhao
        if (req.mode === 'navigate') return caches.match('./index.html');
      });

      return cachedResponse || fetchPromise;
    })
  );
});
