/* App shell only. API responses are never stored. */

const CACHE = "smart-shield-shell-v1";
const SHELL = [
  "/",
  "/mobile",
  "/manifest.webmanifest",
  "/static/favicon.svg",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/static/icons/apple-touch-icon.png",
];

/* The demo sends Cache-Control: no-store on the page and /static/. The Cache API
   refuses to store those responses, so the copy saved here drops that header.
   The HTTP response the browser sees is unchanged, and /api/ is never stored. */
async function remember(request, response) {
  if (!response || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.delete("Cache-Control");
  headers.delete("Expires");
  headers.delete("Pragma");
  const body = await response.clone().arrayBuffer();
  const cache = await caches.open(CACHE);
  await cache.put(request, new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await Promise.all(SHELL.map(async (path) => {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok) throw new Error(path);
      await remember(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  const shell = url.pathname === "/"
    || url.pathname === "/mobile"
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === "/sw.js"
    || url.pathname.startsWith("/static/");
  if (!shell) return;

  event.respondWith(
    fetch(request).then((response) => remember(request, response).catch(() => response)).catch(async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      if (request.mode === "navigate") {
        const home = await caches.match("/");
        if (home) return home;
      }
      return new Response("", { status: 504, statusText: "offline" });
    })
  );
});
