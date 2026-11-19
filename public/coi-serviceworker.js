// Static hosts like GitHub Pages cannot send COOP/COEP headers, and without them
// a page is not cross-origin isolated: no SharedArrayBuffer, so Eye's threaded
// wasm core falls back to something much slower. This worker re-issues every
// response with those headers, which isolates the page after one reload.
//
// Registered from src/main.ts, and only when the page is not already isolated —
// a Vite dev/preview server sends the real headers, so this stays out of the way.
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  event.respondWith(
    (async () => {
      const response = await fetch(request);
      // Opaque and error responses have no readable headers to copy.
      if (response.status === 0 || response.type === "opaque") return response;

      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
