/**
 * Development runner: `npm run dev`.
 *
 * Replaces the Vite dev server with three plain processes: esbuild in watch mode
 * for the client, the Tailwind CLI in watch mode for the stylesheet, and the
 * Express server itself. Nothing runs a compiler inside a request, and the server
 * serves exactly the same `dist/` shape it serves in production — so the thing
 * tested locally is the thing deployed.
 *
 * Client rebuilds do not restart the API; only an edit to `server.ts` or anything
 * under `src/server/` does, which is what `--watch` on the server bundle gives.
 */
import { context } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { clientOptions, copyPublic, tailwind, writeHtml } from "./build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");
const PORT = process.env.PORT || "3000";

const children = [];

function run(name, bin, args) {
  const child = spawn(bin, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  children.push({ name, child });
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.log(`[dev] ${name} exited with code ${code}`);
    if (code !== 0) shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  for (const { child } of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await fs.mkdir(ASSETS, { recursive: true });
await copyPublic();

// Shell first: without it the browser would get the Express 503 while the first
// client build is still running.
await writeHtml({ js: "app.js", css: "index.css" });

// Unhashed names in dev on purpose: a content hash changes every keystroke and
// would make the browser re-download the whole bundle on each save anyway.
let rebuilds = 0;
const ctx = await context({
  ...clientOptions({ dev: true, outfile: path.join(ASSETS, "app.js") }),
  plugins: [
    {
      name: "dev-log",
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length) return;
          rebuilds += 1;
          console.log(`[dev] client rebuilt (#${rebuilds})`);
        });
      },
    },
  ],
});
await ctx.watch();

// `--watch=always` is required, not cosmetic: with a plain `--watch` the CLI
// exits as soon as stdin is closed, which is the case for every process a script
// runner spawns. The stylesheet then silently stops updating after the first build.
run("css", path.join(ROOT, "node_modules/.bin/tailwindcss"), [
  "-i",
  "src/index.css",
  "-o",
  path.join(ASSETS, "index.css"),
  "--watch=always",
]);

// Server in watch mode: `tsx watch` restarts on any change under server.ts or
// src/server/. Client edits are excluded by watching only the server entry and
// its imports, which tsx resolves itself.
run("server", path.join(ROOT, "node_modules/.bin/tsx"), ["watch", "server.ts"]);

console.log(`[dev] http://localhost:${PORT} — client and CSS rebuild on save`);
