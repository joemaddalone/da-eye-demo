import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Where the built app will be served from. Vite bakes this into `index.html`
 * and the hashed asset URLs, so a build made for one location will 404 at
 * another — always build for the address you are actually going to deploy to.
 *
 * Accepted forms:
 *
 *   BASE_PATH=/da-eye/                       an absolute path
 *   BASE_PATH=da-eye-demo                    a bare name (slashes added)
 *   BASE_PATH=https://example.com/da-eye/    a full URL, origin and all
 *   BASE_PATH=.                              relative — see below
 *
 * `relative` emits `./assets/…` instead of `/…/assets/…`, so the same `dist/`
 * works at a domain root and at any sub-path without rebuilding. That is the
 * safest choice for GitHub Pages; absolute is for when the URL is fixed and
 * you would rather a move fail loudly.
 */
function resolveBase(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value || value === "/") return "/";
  if (value === "." || value === "./" || value === "relative") return "./";

  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
    return url.href;
  }

  const path = value.split(/[?#]/)[0];
  return `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

const base = resolveBase(process.env.BASE_PATH ?? process.env.PUBLIC_URL);

/**
 * Fail the build if `index.html` points somewhere other than the base. A wrong
 * base is invisible locally (the dev server rewrites paths) and only shows up
 * as a blank page at the deployed URL, so it is worth a hard stop here. Reads
 * the *resolved* base, so `vite build --base=…` is checked too.
 */
function verifyBase(): Plugin {
  let outDir = "dist";
  let expected = "/";
  return {
    name: "eye-verify-base",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      expected = config.base;
    },
    closeBundle() {
      if (expected === "./") return;

      const html = readFileSync(resolve(outDir, "index.html"), "utf8");
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((url) => url.startsWith("/") || url.startsWith("."));

      const wrong = refs.filter((url) => url.startsWith("/") && !url.startsWith(expected));
      if (wrong.length > 0) {
        throw new Error(
          `Built for base "${expected}" but index.html references ${wrong.join(", ")}.\n` +
            `Set BASE_PATH to the path the app is served from, or use BASE_PATH=. for a build that works anywhere.`,
        );
      }
    },
  };
}

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
  plugins: [verifyBase(base)],
});
