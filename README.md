# da-eye

A photo tagger that runs entirely in the browser. Drop a folder of photos, hit **Tag Images**, and the library sorts itself into tags — scenes, photo kinds, people, quality scores — with nothing uploaded anywhere.

Tagging is done on device by [Eye](https://desertant.com/models/eye/), a WebAssembly image model loaded through [`@desert-ant-labs/eye`](https://www.npmjs.com/package/@desert-ant-labs/eye).

## Running it

```sh
npm install
npm run dev
```

Then open the URL Vite prints.

```sh
npm run build     # static bundle in dist/
npm run preview   # serve the build locally
```

## How it works

- **Load** — pick photos, pick a folder, or drop either onto the page. Folders are walked recursively, and repeated picks are de-duplicated by path.
- **Tag** — the Eye model downloads once (progress is shown), then each photo is analysed in turn. A photo can be filed under several tags at once; kinds are always filed, and only the two strongest subject tags are kept so the overview stays readable.
- **Browse** — the overview is one tile per tag with counts. Click a tile to see its photos, click a photo to open it and read its full breakdown: filed tags, size, type, every scored tag, aesthetic/keeper/cover scores, sharpness, faces, detected people and pets, and the raw JSON.
- **Arrow keys** step through the photos of an open tag while the modal is up.

Generic and per-face tags (`photo`, `sharp`, `blurry`, `smiling`) are filtered out of the grouping — they describe the frame, not the subject. Photos flagged `sensitive` are filed under that tag alone.

## Notes on the build

`vite.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. Eye's wasm build is compiled for `wasip1-threads` and needs a `SharedArrayBuffer`, which browsers only grant to cross-origin isolated pages. `credentialless` (rather than `require-corp`) keeps the SDK's own cross-origin fetches — the LiteRT.js runtime on jsDelivr and the model weights on Hugging Face — working.

Static hosts that can't send those headers fall back to `public/coi-serviceworker.js`, which re-issues responses with them. That only takes effect on the next document, so the first load in a fresh tab reloads once; it is guarded so it can never loop.

Set `BASE_PATH` when deploying under a sub-path:

```sh
BASE_PATH=/da-eye-demo/ npm run build
```

## Layout

```
index.html              markup for the drop zone, overview, tag detail and photo modal
src/main.ts             all app logic: loading, tagging, grouping, rendering
src/style.css           styles
public/coi-serviceworker.js   cross-origin isolation shim for static hosts
vite.config.ts          headers, base path, dependency exclusions
```
