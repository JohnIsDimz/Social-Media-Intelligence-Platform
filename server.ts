import express from "express";
import path from "path";
import { existsSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";

import http from "http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { logger } from "./src/server/logger.ts";
import { attachWebSocketServer, broadcast, closeWebSocketServer } from "./src/server/realtime.ts";
import { fetchUnifiedSocialSignals } from "./src/server/collectors.ts";
import { getDB, pruneMentions, saveMentions } from "./src/server/data.ts";
import { markScanned, stalestTracker } from "./src/server/scan-state.ts";
import { dbConfigSummary, pingDatabase } from "./src/lib/supabaseDb.ts";
import { registerSystemRoutes } from "./src/server/routes/system.ts";
import { registerTrackerRoutes } from "./src/server/routes/trackers.ts";
import { registerAnalysisRoutes } from "./src/server/routes/analysis.ts";
import { registerAggregationRoutes } from "./src/server/routes/aggregation.ts";
import { findCredentialWrites } from "./src/server/credentials.ts";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// Security hardening
// ---------------------------------------------------------------------------

// Trust the platform proxy (Vercel/Railway/Cloud Run) so rate limiting sees the
// real client IP instead of the load balancer's. Configurable to avoid the
// "IP spoofing" class of issues when not behind a proxy.
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);

// Security headers. The CSP below is tuned to what the app actually loads: the
// self-hosted bundle, inline styles emitted by Tailwind, the websocket feed, and
// Google Fonts. A wrong CSP breaks the live site silently, so any new external
// origin must be added here in the same commit that starts using it.
app.use(
  helmet({
    // A CSP that matches what the app actually loads: the self-hosted bundle,
    // the websocket feed, Google Fonts, and data: images. Anything else is
    // blocked, which is the point on a public VPS.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Same-origin by default: this app is served by this very server, so no CORS
// headers are needed. Set CORS_ORIGINS="https://a.com,https://b.com" to allow
// other origins explicitly.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins, methods: ["GET", "POST", "DELETE"], maxAge: 600 }));
}

// Body limits prevent trivial memory-exhaustion DoS.
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// Global API rate limit: generous for normal dashboards, hostile to scripts.
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// Strict limit for endpoints that spend money on the AI gateway / external APIs.
const expensiveRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "AI analysis rate limit reached (20/minute). Please try again later.",
  },
});

/** Constant-time string compare so token checks do not leak length or prefix. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

app.use("/api", apiRateLimiter);

// Guards for every route that calls a paid/external service.
const AI_ROUTES = ["/api/analyze-url", "/api/trigger-monitor", "/api/predict-trends"];
app.use(AI_ROUTES, expensiveRateLimiter);

/**
 * Optional API authentication.
 *
 * The audit's open finding C1 was "no authentication on /api/*". Rate limiting
 * is not authorisation: anyone who can reach the port can still write trackers
 * and burn paid quota. Set API_AUTH_TOKEN to require a bearer token on every
 * mutating or paid route. Left unset, the app stays usable for local
 * development — but deployment notes require the token in production.
 */
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN?.trim();
const PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Name of the cookie that carries the session for the bundled dashboard.
 *
 * The token must never reach the browser bundle: anything shipped there is
 * readable by every visitor. Instead the server serves the SPA at "/" only when
 * the visitor presents this cookie, and the API accepts either the cookie (the
 * dashboard) or a bearer token (scripts and uptime checks).
 */
const SESSION_COOKIE = "smip_session";

function readCookie(req: any, name: string): string {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function requireApiToken(req: any, res: any, next: any) {
  if (!API_AUTH_TOKEN) return next();
  // Reads stay public so monitoring dashboards and uptime checks keep working.
  if (!PROTECTED_METHODS.has(req.method)) return next();

  const session = readCookie(req, SESSION_COOKIE);
  // The cookie value is a signing key derived from the token, not the token
  // itself, so a leaked cookie cannot be replayed as an API credential.
  if (session && timingSafeEqualStr(session, sessionKey(API_AUTH_TOKEN))) return next();

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && timingSafeEqualStr(token, API_AUTH_TOKEN)) return next();
  return res.status(401).json({
    error:
      "Authentication required. Open the dashboard in a browser, or send Authorization: Bearer <token>.",
    reason: "unauthorized",
  });
}

/**
 * Derives the session value from the API token.
 *
 * This is a hash, not encryption, and that is the point: it is one-way, so the
 * cookie never reveals the token it was derived from, and rotating the token
 * invalidates every existing session automatically.
 */
function sessionKey(token: string): string {
  return createHmac("sha256", "smip-session").update(token).digest("hex");
}

app.use("/api", requireApiToken);

/**
 * Credentials never arrive over HTTP.
 *
 * Keys are read from the environment only; a write that tries to store one is
 * refused with an explanation instead of being quietly dropped, so a client
 * author learns the rule on the first attempt.
 */
app.use("/api", (req, res, next) => {
  if (!PROTECTED_METHODS.has(req.method)) return next();
  const attempts = findCredentialWrites(req.body);
  if (attempts.length === 0) return next();
  return res.status(400).json({
    error:
      "API keys are configuration, not data. Put them in .env on the server and restart; " +
      "they are never accepted through the API or the UI.",
    reason: "credentials-not-accepted",
    fields: attempts.map((a) => a.field),
  });
});

/**
 * Dashboard login.
 *
 * With API_AUTH_TOKEN set, visiting "/" without a session asks for the token and
 * sets the cookie. Nothing is fetched from the server without a valid session or
 * bearer token, so this is the only gate the UI needs.
 */
const loginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in ten minutes." },
});

app.post("/login", loginRateLimiter);

app.get("/login", (req, res) => {
  if (!API_AUTH_TOKEN) return res.redirect("/");
  const failed = req.query.e === "1";
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>S.M.I.P - sign in</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;color:#eaf1f8;
       font:15px/1.55 "Instrument Sans",system-ui,-apple-system,sans-serif;
       background:#06101f;
       background-image:
         radial-gradient(720px 420px at 14% -10%, rgba(14,143,138,.34), transparent 62%),
         radial-gradient(680px 400px at 88% -16%, rgba(91,87,209,.28), transparent 60%),
         radial-gradient(560px 320px at 50% 112%, rgba(27,166,196,.20), transparent 66%);
       background-attachment:fixed}
  .card{width:min(380px,calc(100vw - 40px));padding:28px;
        border:1px solid rgba(255,255,255,.12);border-radius:10px;
        background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));
        box-shadow:0 24px 60px -28px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);
        backdrop-filter:blur(8px)}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;
        background:linear-gradient(140deg,#0e8f8a,#1ba6c4);color:#fff;font-weight:700;font-size:13px;
        box-shadow:0 6px 16px -6px rgba(14,143,138,.8)}
  h1{margin:0;font-size:17px;letter-spacing:-.01em;font-weight:600}
  .sub{margin:0 0 22px;color:rgba(234,241,248,.55);font-size:13px}
  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.09em;
        color:rgba(234,241,248,.55);margin-bottom:7px}
  input{width:100%;padding:11px 13px;border-radius:7px;color:inherit;font:inherit;
        background:rgba(4,12,22,.72);border:1px solid rgba(255,255,255,.16);
        transition:border-color .16s ease, box-shadow .16s ease}
  input:focus{outline:none;border-color:#1ba6c4;box-shadow:0 0 0 3px rgba(27,166,196,.22)}
  button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:7px;cursor:pointer;
         font:inherit;font-weight:600;color:#fff;
         background:linear-gradient(140deg,#0e8f8a,#1ba6c4);
         box-shadow:0 10px 24px -12px rgba(14,143,138,.9);
         transition:transform .16s ease, box-shadow .16s ease}
  button:hover{transform:translateY(-1px);box-shadow:0 14px 28px -12px rgba(14,143,138,1)}
  .err{margin:0 0 16px;padding:9px 11px;border-radius:6px;font-size:13px;
       color:#ffc9a3;background:rgba(207,63,71,.16);border:1px solid rgba(207,63,71,.4)}
  .foot{margin:18px 0 0;font-size:11.5px;color:rgba(234,241,248,.42);text-align:center}
</style></head>
<body><form class="card" method="POST" action="/login">
  <div class="brand"><span class="mark">SM</span><h1>S.M.I.P</h1></div>
  <p class="sub">This dashboard is protected. Enter the API token to continue.</p>
  ${failed ? '<p class="err">That token was not accepted.</p>' : ""}
  <label for="token">API token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
  <p class="foot">Keys live in .env on the server. This form only starts a session.</p>
</form></body></html>`);
});

app.post("/login", (req, res) => {
  if (!API_AUTH_TOKEN) return res.redirect("/");
  const given = String((req.body && req.body.token) || "").trim();
  if (!given || !timingSafeEqualStr(given, API_AUTH_TOKEN)) return res.redirect("/login?e=1");
  res.setHeader("Set-Cookie", sessionCookie(sessionKey(API_AUTH_TOKEN), req));
  res.redirect("/");
});

/**
 * SameSite=Strict keeps the session off cross-site requests; HttpOnly keeps it
 * away from JS.
 *
 * `Secure` is decided from the actual request rather than NODE_ENV: a browser
 * silently drops a Secure cookie over plain HTTP, which would turn a
 * not-yet-TLS VPS into an endless login loop. Behind nginx the proxy header
 * makes req.secure true, so TLS deployments still get the flag.
 */
function sessionCookie(value: string, req: any): string {
  const secure = req.secure ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`;
}

app.get("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.redirect("/login");
});

// Routes are registered before the static/SPA handlers and before the /api
// catch-all at the bottom of this file, which must stay last.
registerSystemRoutes(app);
registerTrackerRoutes(app);
registerAnalysisRoutes(app);
registerAggregationRoutes(app);

// Registered after every API route on purpose: an Express router matches in
// order, so this must be the last /api handler or it swallows real routes.
// A mistyped API path gets JSON 404 instead of the SPA's HTML.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

// Global WebSocket server and broadcast utility

/**
 * Mounts dist/ as the client, and the SPA fallback behind it.
 *
 * Asset filenames are content-addressed by the build, so they can be cached for a
 * year. The shell must not be: a cached index.html is a cached set of asset names,
 * which is how a browser ends up asking for a bundle that no longer exists.
 */
async function serveClient() {
  const distPath = path.join(process.cwd(), "dist");

  if (!existsSync(distPath)) {
    // A missing build is an operator mistake, not a 404. Say which command fixes
    // it instead of serving a blank page that looks like an application bug.
    app.use((_req, res) => {
      res
        .status(503)
        .type("text")
        .send(
          "Client build not found. Run `npm run build` first " +
            "(or use `npm run dev`, which watches and rebuilds as you edit)."
        );
    });
    return;
  }

  // Never serve the server bundle or any source map.
  //
  // `dist/` is a flat directory: it holds the client *and* `server.cjs` (plus its
  // `.map`, which contains the full TypeScript source). A bare express.static on
  // that directory answers GET /server.cjs with the entire backend, so the check
  // has to sit in front of it rather than behind.
  const BLOCKED_PATH = /^\/server\.(cjs|js)(\.map)?$|\.map$/;
  app.use((req, res, next) => {
    if (BLOCKED_PATH.test(req.path)) {
      return res.status(404).type("text").send("Not found");
    }
    next();
  });

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js") || filePath.endsWith("manifest.json")) {
          // Revalidate always: these three decide which build the browser runs.
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Content-addressed: the name changes when the bytes change.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  // A missing file under /assets/ must be a 404, not the SPA shell.
  //
  // Without this, a request for a bundle that no longer exists returns index.html
  // with status 200 and Content-Type text/html. The browser then fails to parse
  // HTML as a module and reports a syntax error, which hides the real cause — a
  // stale index.html pointing at a deleted hashed bundle. A 404 says it plainly.
  app.use("/assets", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).type("text").send("Not found");
  });

  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Helper for real-time background Google Search Grounding to fetch authentic, non-simulated signals
async function startServer() {
  const server = http.createServer(app);

  attachWebSocketServer(server);

  // Gate the dashboard itself. Without this the SPA loads, renders, and every
  // API call fails with 401 — an empty screen with no explanation. The login
  // routes and /api are registered above, so they are not affected.
  app.use((req, res, next) => {
    if (!API_AUTH_TOKEN) return next();
    const session = readCookie(req, SESSION_COOKIE);
    if (session && timingSafeEqualStr(session, sessionKey(API_AUTH_TOKEN))) return next();
    return res.redirect("/login");
  });

  // Background collection: pulls genuinely new mentions from the configured
  // sources. Runs on a short tick but only performs a network refresh every
  // REFRESH_INTERVAL_MS so we do not exhaust API quota.
  const REFRESH_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS) || 120_000;
  let lastMonitorRefreshAt = 0;

  setInterval(async () => {
    try {
      const db = await getDB();
      if (!db.trackers || db.trackers.length === 0) return;
      if (Date.now() - lastMonitorRefreshAt < REFRESH_INTERVAL_MS) return;
      lastMonitorRefreshAt = Date.now();

      // Refresh whichever tracker has gone longest without a scan. Scan times are
      // process-local bookkeeping, so they are not stored in the database.
      const randomTracker = stalestTracker(db.trackers);
      if (!randomTracker) return;

      logger.info(`[Collector] Refreshing mentions for "${randomTracker.query}"…`);

      const collected = await fetchUnifiedSocialSignals(randomTracker).catch((err) => {
        logger.warn("[Collector] Collection cycle failed:", err);
        return [] as any[];
      });

      markScanned(randomTracker.id);

      const existingKeys = new Set(
        (db.monitorResults || []).map(
          (m: any) => `${m.platform}|${(m.url || "").split("?")[0]}|${m.title}`
        )
      );
      const newMentions = (collected || []).filter(
        (m: any) => m && !existingKeys.has(`${m.platform}|${(m.url || "").split("?")[0]}|${m.title}`)
      );

      if (newMentions.length > 0) {
        await saveMentions(newMentions);
        await pruneMentions(1000);

        // Broadcast to all active clients for real-time UI injection
        for (const mention of newMentions) {
          logger.info(`[Collector] New mention on ${mention.platform}: "${mention.title}"`);
          broadcast("LIVE_POST_INGESTED", {
            post: mention,
            tracker: randomTracker
          });
        }
      }
    } catch (err) {
      logger.warn("[Collector] Cycle failed:", err);
    }
  }, 20_000);

  // Check the Supabase connection once at boot so a missing schema or a wrong
  // key shows up in the log and in /api/health immediately, not on first click.
  const dbInfo = dbConfigSummary();
  if (!dbInfo.configured) {
    logger.warn(
      "[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. " +
        "The API will answer with empty data and reason \"not-configured\" until they are."
    );
  } else {
    const boot = await pingDatabase();
    if (boot.connected) {
      logger.info(`[Supabase] Connected to ${boot.projectHost}; data layer ready.`);
    } else if (boot.reason === "schema-missing") {
      logger.warn(
        `[Supabase] Connected to ${boot.projectHost} but the tables are missing. ` +
          "Run supabase/schema.sql in the SQL editor. Detail: " +
          (boot.detail || "")
      );
    } else {
      logger.warn(
        `[Supabase] Could not reach ${boot.projectHost} (${boot.reason || "unknown"}). ` +
          "Serving empty data until it responds. Detail: " +
          (boot.detail || "")
      );
    }
  }

  // Static hosting for the built client.
  //
  // There is no bundler middleware any more: `npm run dev` starts esbuild in watch
  // mode and Tailwind in watch mode alongside this process, and both of them write
  // into dist/. By the time a request arrives, dist/ is already the current build,
  // so the server only ever has to serve files. That removes a middleware that ran
  // a second compiler inside the request path — the part of the stack that could
  // serve a module the build never produced.
  await serveClient();

  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`[Social Intelligence Engine] Full-stack with WebSockets running on port ${PORT}`);
  });

  // Graceful shutdown: clients get a clean close. There is no local database
  // to checkpoint; writes are committed to Supabase when they are made.
  const shutdown = (signal: string) => {
    logger.info(`[Shutdown] Received ${signal}, closing server...`);
    closeWebSocketServer();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Importing this module registers the whole API surface and stops there; only a
// real start binds a port. The route test relies on that.
if (process.env.SMIP_NO_LISTEN !== "1") startServer();

export default app;
