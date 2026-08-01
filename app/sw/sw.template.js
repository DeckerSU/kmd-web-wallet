/*
 * Service worker template. The two constants below are filled in at build time
 * by the swBuildManifest plugin in vite.config.ts; the result lands at /sw.js
 * and this template is never served.
 *
 * Why generated rather than static: a browser reinstalls a service worker only
 * when the script's *bytes* change. A hand-written worker is identical on every
 * deploy, so `install` never runs again and its cache stays frozen at whatever
 * the first install captured. Embedding the content-hashed filenames makes the
 * script change whenever the build does, which is what drives the whole update
 * cycle below.
 *
 * The filename must stay `/sw.js`: registration is by URL, so a hashed worker
 * name would register a *new* worker each deploy and leave the old one running.
 * The version therefore lives inside the file.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE = `kmd-wallet-${BUILD_ID}`;
const SHELL_URL = '/index.html';

/** Every build artefact the app needs to start, except the wasm. */
const PRECACHE = __PRECACHE__;

/*
 * `Vary: Origin` is common on static hosts, and Vite marks its module script
 * `crossorigin`, so the page requests an asset with an `Origin` header the
 * worker's own precache fetch never sent. Matching would then compare the varied
 * header and miss on an identical URL.
 */
const MATCH = { ignoreVary: true };

/*
 * Atomic on purpose. `addAll` rejects if any single entry fails, which fails the
 * install and leaves the previous worker in charge. The alternative — caching
 * whatever succeeded — can store a shell whose script is missing, and that shell
 * is unbootable: it asks for a file that is in no cache and, after the next
 * deploy, no longer on the server either.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const precached = (pathname) => PRECACHE.includes(pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The wasm is ~36 MB: precaching it would take most of a typical storage
  // quota, and a stale copy would pin the user to an old wallet engine. Electrum
  // over WSS and the explorer APIs are cross-origin and must not be touched.
  if (url.origin !== self.location.origin || url.pathname.endsWith('.wasm')) return;

  /*
   * Navigations are served from the precache, not the network.
   *
   * Network-first looks fresher but is what broke installed apps: the HTML is
   * cacheable (`max-age=600` on GitHub Pages), so a navigation could be answered
   * with a shell whose content-hashed assets the latest deploy had already
   * deleted, leaving the app asking for files that return 404. A precached shell
   * is always consistent with precached assets, because the two were installed
   * together or not at all. Freshness comes from the update cycle instead: a new
   * deploy changes this file, the worker reinstalls, and the next launch is new.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      caches
        .match(SHELL_URL, MATCH)
        .then((cached) => cached ?? fetch(request))
        .catch(() => fetch(request)),
    );
    return;
  }

  if (precached(url.pathname)) {
    event.respondWith(caches.match(request, MATCH).then((cached) => cached ?? fetch(request)));
  }
});
