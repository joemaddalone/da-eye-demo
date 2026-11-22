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


## Layout

```
index.html              markup for the drop zone, overview, tag detail and photo modal
src/main.ts             all app logic: loading, tagging, grouping, rendering
src/style.css           styles
vite.config.ts          base path, dependency exclusions
```
