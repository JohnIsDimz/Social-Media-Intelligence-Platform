/**
 * Production build: esbuild + the Tailwind CLI. No bundler framework.
 *
 * Two outputs are produced here and nothing else runs at request time:
 *   dist/assets/app.<hash>.js     the whole client, minified
 *   dist/assets/index.<hash>.css  Tailwind output for src/index.css
 *   dist/index.html               the shell, with those hashed names injected
 *   dist/server.cjs               the Express server, dependencies external
 *
 * Asset names carry a content hash so `Cache-Control: immutable` on /assets/ is
 * truthful: a new deployment writes new filenames, and a stale browser copy can
 * never be mistaken for the current build.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pkg from "../package.json" with { type: "json" };

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");

export const SHARED_DEFINE = {
  __APP_VERSION__: JSON.stringify(pkg.version),
};

/** esbuild options for the browser bundle, shared with the dev watcher. */
export function clientOptions({ dev = false, outfile }) {
  return {
    entryPoints: [path.join(ROOT, "src/main.tsx")],
    bundle: true,
    outfile,
    platform: "browser",
    target: ["es2022"],
    format: "esm",
    jsx: "automatic",
    // React and every library below it branch on this at build time; leaving it
    // undefined produces the development build in production, with its warnings
    // and unminified internals.
    define: {
      ...SHARED_DEFINE,
      __DEV__: dev ? "true" : "false",
      "process.env.NODE_ENV": dev ? '"development"' : '"production"',
    },
    minify: !dev,
    // Never in production: a published `.map` is the entire source of the app,
    // comments included, downloadable by anyone who guesses the name. Locally it
    // is the difference between a stack trace and a line number, so dev keeps it.
    sourcemap: dev,
    // Put React's JSX runtime into the same chunk as the app instead of a shared
    // chunk that is fetched separately on first paint.
    splitting: false,
    legalComments: "none",
    logLevel: "warning",
  };
}

async function hashName(dir, file) {
  const buf = await fs.readFile(path.join(dir, file));
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 10);
  const ext = path.extname(file);
  const hashed = `${path.basename(file, ext)}.${hash}${ext}`;
  await fs.rename(path.join(dir, file), path.join(dir, hashed));
  const map = path.join(dir, `${file}.map`);
  try {
    await fs.rename(map, path.join(dir, `${hashed}.map`));
  } catch {
    // No sourcemap emitted; nothing to rename.
  }
  return hashed;
}

export function tailwind({ minify = true, outfile = path.join(ASSETS, "index.css") } = {}) {
  const bin = path.join(ROOT, "node_modules/.bin/tailwindcss");
  const args = ["-i", "src/index.css", "-o", outfile];
  if (minify) args.push("--minify");
  const result = spawnSync(bin, args, { cwd: ROOT, encoding: "utf8" });
  if (result.error) {
    // The CLI is a devDependency. A production image that installed with
    // --omit=dev cannot build, and must say so instead of silently shipping
    // stale CSS from a previous build.
    throw new Error(
      `Could not run the Tailwind CLI (${bin}). Install devDependencies before building.\n${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(`Tailwind failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Writes dist/index.html from the root template, injecting the asset names. */
export async function writeHtml({ js, css }) {
  const template = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const html = template
    .replaceAll("%APP_CSS%", css ? `/assets/${css}` : "/assets/index.css")
    .replaceAll("%APP_JS%", js ? `/assets/${js}` : "/assets/app.js");
  await fs.writeFile(path.join(DIST, "index.html"), html);
}

export async function copyPublic() {
  const from = path.join(ROOT, "public");
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await fs.copyFile(path.join(from, entry.name), path.join(DIST, entry.name));
  }
}

export async function buildServer() {
  await build({
    entryPoints: [path.join(ROOT, "server.ts")],
    outfile: path.join(DIST, "server.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node22"],
    packages: "external",
    sourcemap: true,
    logLevel: "warning",
  });
}

async function main() {
  const t0 = Date.now();
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(ASSETS, { recursive: true });

  await build(clientOptions({ outfile: path.join(ASSETS, "app.js") }));
  const js = await hashName(ASSETS, "app.js");

  tailwind();
  const css = await hashName(ASSETS, "index.css");

  await copyPublic();
  await writeHtml({ js, css });
  await buildServer();

  const sizes = await Promise.all(
    ["index.html", `assets/${js}`, `assets/${css}`, "server.cjs"].map(async (f) => {
      const { size } = await fs.stat(path.join(DIST, f));
      return `  ${f.padEnd(34)} ${(size / 1024).toFixed(1)} kB`;
    })
  );
  console.log(["built in " + ((Date.now() - t0) / 1000).toFixed(1) + "s", ...sizes].join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
