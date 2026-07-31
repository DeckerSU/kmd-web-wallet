/*
 * Service worker, kept deliberately small.
 *
 * Its job is to make the app installable, which Chrome gates on the page
 * returning something useful while offline. It is not an attempt at an offline
 * wallet: the wallet cannot do anything without Electrum servers and JSON-RPC
 * nodes, so "works offline" here means the app's own screen appears and says so,
 * rather than the browser's error page.
 *
 * The KDF wasm binary is emphatically NOT cached. It is ~36 MB; precaching it
 * would consume most of a typical origin's storage quota, and a stale copy would
 * silently pin users to an old wallet engine after a deploy. It is fetched from
 * the network every time and left to the browser's own HTTP cache, which honours
 * the content hash in its filename.
 */

/*
 * `ignoreVary` is load-bearing. Static hosts commonly answer with
 * `Vary: Origin`, and Vite marks its module script `crossorigin`, so the page
 * requests the asset with an `Origin` header while the worker's own precache
 * fetch has none. Cache matching then compares the varied header, misses on an
 * identical URL, and the offline page renders blank with `ERR_FAILED` — the
 * request having been intercepted and then failed on the network fallback.
 */
const MATCH = { ignoreVary: true };

const VERSION = 'v1';
const SHELL_CACHE = `kmd-wallet-shell-${VERSION}`;
const SHELL_URL = '/index.html';

/**
 * Precache the shell and the build assets it references.
 *
 * The asset filenames are content-hashed, so they cannot be listed here — but
 * index.html names them, so reading it is enough and stays correct across
 * deploys without a build step. Doing this at install time matters: on a first
 * visit the assets are fetched before the worker takes control, so relying on
 * runtime caching alone leaves the very first offline load blank.
 */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const request = new Request(SHELL_URL, { cache: 'reload' });
  const response = await fetch(request);
  await cache.put(request, response.clone());

  const html = await response.text();
  const assets = [...html.matchAll(/["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((m) => m[1]);
  await Promise.all(
    // Best-effort per asset: one 404 must not abandon the whole install.
    assets.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Hashed build assets: safe to cache, and the hash makes staleness impossible. */
const isBuildAsset = (url) =>
  url.origin === self.location.origin &&
  url.pathname.startsWith('/assets/') &&
  (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intervene in the wasm, in RPC traffic, or in anything cross-origin —
  // Electrum over WSS and the explorer APIs must reach the network untouched.
  if (url.pathname.endsWith('.wasm') || url.origin !== self.location.origin) return;

  // Navigations: network first, so a deploy is picked up immediately, with the
  // cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(SHELL_URL, MATCH).then((r) => r ?? Response.error()),
      ),
    );
    return;
  }

  if (isBuildAsset(url)) {
    event.respondWith(
      caches.match(request, MATCH).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
