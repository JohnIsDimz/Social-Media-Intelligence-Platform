import express from "express";
import path from "path";
import { createHmac, timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";

import { createServer as createViteServer } from "vite";
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

// Security headers. The CSP below is tuned to what the app actually loads:
// the self-hosted bundle, Tailwind/Vite inline styles, the dev websocket, and
// Google Fonts. A wrong CSP breaks the live site silently, so any new external
// origin must be added here in the same commit that starts using it.
app.use(
  helmet({
    // A CSP that matches what the app actually loads: self-hosted bundle, the
    // Vite dev websocket, Google Fonts, and data: images. Anything else is
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
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E1B20;color:#E8EDEB;
       font:15px/1.5 "Instrument Sans",system-ui,sans-serif}
  form{width:min(360px,calc(100vw - 40px));border:1px solid rgba(255,255,255,.14);padding:24px;background:rgba(255,255,255,.03)}
  h1{margin:0 0 4px;font-size:18px;letter-spacing:-.01em}
  p{margin:0 0 18px;color:rgba(232,237,235,.55);font-size:13px}
  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(232,237,235,.55);margin-bottom:6px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;background:#0A1417;border:1px solid rgba(255,255,255,.16);
        color:inherit;font:inherit;border-radius:3px}
  button{margin-top:14px;width:100%;padding:10px;background:#0F7A75;border:0;color:#fff;font:inherit;
         font-weight:600;border-radius:3px;cursor:pointer}
  .err{margin:0 0 14px;color:#E0A03A;font-size:13px}
</style></head>
<body><form method="POST" action="/login">
  <h1>S.M.I.P</h1>
  <p>This dashboard is protected. Enter the API token to continue.</p>
  ${failed ? '<p class="err">That token was not accepted.</p>' : ""}
  <label for="token">API token</label>
  <input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
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

if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Hashed assets are immutable; the shell must always be revalidated so a
    // deploy is picked up instead of served from a stale cache.
    app.use(
      express.static(distPath, {
        index: false,
        maxAge: "1y",
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html") || filePath.endsWith("sw.js") || filePath.endsWith("manifest.json")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

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
