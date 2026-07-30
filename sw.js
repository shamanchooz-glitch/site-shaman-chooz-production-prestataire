/* Service worker SHAMAN CHOOZ PRODUCTION
   Rôle : garder l'application accessible (ouverture + formulaires) même sans
   wifi ni données mobiles, pour les personnes qui l'ont installée sur leur
   téléphone. Les appels vers Firebase / Cloudinary ne sont jamais mis en
   cache : ils passent toujours par le réseau, et c'est le code de la page
   (file d'attente locale) qui gère les envois en cas de coupure. */

const CACHE_NAME = 'shaman-chooz-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ne jamais intercepter les appels vers des services externes dynamiques
  // (base de données, hébergement des fichiers, etc.) : ils doivent aller
  // au réseau directement, la page gère elle-même le mode hors-ligne.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Ouverture de la page (navigation) : réseau en priorité pour avoir la
  // dernière version, mais on retombe sur la version en cache si hors-ligne.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Fichiers de l'app shell : cache en priorité, réseau en secours.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(() => cached))
  );
});
