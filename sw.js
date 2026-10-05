// Offline support. All paths are relative to this file, so the app works under /<repo>/ on GitHub Pages.
//
// - App shell: precached; served from cache and refreshed in the background (changes show on next launch).
//   Bump SHELL_VERSION when adding or removing shell files.
// - API: the whole recipe set (~2 MB) is precached, because the planner needs every recipe's ingredients
//   offline. Served stale-while-revalidate. api/version.json is always fetched from the network; when the
//   page sees a new version it sends 'refresh-api' and everything is downloaded again.
const SHELL_VERSION = 1;
const SHELL = `shell-v${SHELL_VERSION}`;
const API = 'api';

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/data.js', 'js/db.js', 'js/planner.js', 'js/shopping.js', 'js/ui.js', 'js/units.js', 'js/vendor/idb.js',
  'js/views/plan.js', 'js/views/recipe.js', 'js/views/recipes.js', 'js/views/settings.js', 'js/views/shop.js',
  'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

const url = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map(p => new Request(url(p), { cache: 'reload' })));
    await cacheApi();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== API) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** Download every API file into the cache and drop files that no longer exist. */
async function cacheApi() {
  const cache = await caches.open(API);
  const get = async path => {
    const res = await fetch(url(path), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    await cache.put(url(path), res.clone());
    return res;
  };
  const [index, categories, tags] = await Promise.all(
    ['api/index.json', 'api/categories/index.json', 'api/tags/index.json'].map(p => get(p).then(r => r.json())));
  const paths = [
    'api/catalog.json',
    ...categories.map(c => `api/categories/${c.slug}.json`),
    ...tags.map(t => `api/tags/${encodeURIComponent(t.tag)}.json`),
    ...index.map(r => `api/recipes/${r.slug}.json`),
  ];
  for (let i = 0; i < paths.length; i += 8) await Promise.all(paths.slice(i, i + 8).map(get));
  await get('api/version.json');

  const keep = new Set(['api/index.json', 'api/categories/index.json', 'api/tags/index.json', 'api/version.json', ...paths].map(url));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'refresh-api') return;
  event.waitUntil(cacheApi().then(
    () => event.ports[0]?.postMessage({ ok: true }),
    err => { console.warn('API refresh failed', err); event.ports[0]?.postMessage({ ok: false }); }));
});

async function staleWhileRevalidate(event, cacheName, key = event.request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key, { ignoreSearch: true });
  // no-cache: revalidate with the server rather than reuse the browser's HTTP cache (Pages sends max-age=600)
  const network = fetch(event.request.url, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const path = req.url.slice(self.registration.scope.length).split(/[?#]/)[0];

  if (path === 'api/version.json') {
    event.respondWith(fetch(req).catch(() => caches.match(url(path))));
  } else if (path.startsWith('api/')) {
    event.respondWith(staleWhileRevalidate(event, API));
  } else if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, SHELL, url('index.html')));
  } else {
    event.respondWith(staleWhileRevalidate(event, SHELL));
  }
});
