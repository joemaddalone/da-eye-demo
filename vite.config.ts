import { defineConfig } from "vite";

// Eye's browser build is WebAssembly compiled for wasip1-threads: it needs a
// SharedArrayBuffer, which a page only gets when it is cross-origin isolated.
// `credentialless` keeps that working while still allowing the SDK's own
// cross-origin requests (the LiteRT.js runtime on jsDelivr, the weights on
// Hugging Face) that `require-corp` would block.
const crossOriginHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

// Set BASE_PATH when the app is served from a sub-path (a project page at
// /<repo>/); anywhere else it is "/".
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  // Serve these as source instead of prebundling them: the Eye runtime fetches
  // `EyeWeb.wasm` relative to its own module URL, and `#platform` resolves
  // through the package's own `imports` map.
  optimizeDeps: {
    exclude: ["@desert-ant-labs/eye", "@desert-ant-labs/core", "@litertjs/core"],
  },
  // The SDK instantiates its wasm core with top-level await.
  build: { target: "esnext" },
  server: { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
});
