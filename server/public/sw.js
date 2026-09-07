/**
 * Service worker do Deck Control.
 *
 * Estrategia: rede primeiro, cache como rede de seguranca. O aplicativo so'
 * tem valor com o servidor no ar, entao o cache existe apenas para que a
 * interface continue de pe' durante uma oscilacao do Wi-Fi em vez de mostrar
 * a tela de erro do navegador.
 *
 * `/api` e `/media` nunca sao cacheados: sao estado vivo.
 */
const CACHE = 'deck-control-v1';

const SHELL = [
  '/',
  '/index.html',
  '/css/deck.css',
  '/js/main.js',
  '/js/DeckApp.js',
  '/js/ConnectionManager.js',
  '/js/IconLibrary.js',
  '/js/KeyGrid.js',
  '/js/DialStrip.js',
  '/js/TelemetryPanel.js',
  '/js/EditorSheet.js',
  '/js/Toaster.js',
  '/icon.svg',
  '/app.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `addAll` falha inteiro se um recurso faltar; individualmente e' tolerante.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname === '/ws') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Navegacao sem cache do recurso exato ainda pode usar a casca do app.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return new Response('offline', { status: 503, statusText: 'offline' });
      })
  );
});
