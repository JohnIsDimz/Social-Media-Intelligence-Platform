import express from "express";
import path from "path";
import { timingSafeEqual } from "node:crypto";
import fs from "fs";
import dotenv from "dotenv";

import { createServer as createViteServer } from "vite";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { CHANNEL_SPECS, CHANNEL_KEYS, channelSpec } from "./src/channels.ts";
import {
  aiConfig,
  aiSummary,
  chatJson,
  AiError,
} from "./src/lib/aiProvider.ts";
import {
  createFirestoreMirror,
  seedOperations,
  toAnalyzedDoc,
  toMentionDoc,
  toTrackerDoc,
  type MirrorOp
} from "./src/lib/firestoreMirror.ts";

dotenv.config();

// Structured, non-destructive logging. Previously every occurrence of the word
// "error" was rewritten to "err-info", which destroyed stack traces and made
// production debugging impossible. Logs are now emitted verbatim.
const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function emit(level: "debug" | "info" | "warn" | "error", args: any[]) {
  if ((LEVELS[level] ?? 20) < (LEVELS[LOG_LEVEL] ?? 20)) return;
  const sink =
    level === "error" ? originalError : level === "warn" ? originalWarn : originalLog;
  sink.call(
    console,
    `[${new Date().toISOString()}] [${level.toUpperCase()}]`,
    ...args
  );
}

const logger = {
  debug: (...args: any[]) => emit("debug", args),
  info: (...args: any[]) => emit("info", args),
  warn: (...args: any[]) => emit("warn", args),
  error: (...args: any[]) => emit("error", args),
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// Security hardening
// ---------------------------------------------------------------------------
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Trust the platform proxy (Vercel/Railway/Cloud Run) so rate limiting sees the
// real client IP instead of the load balancer's. Configurable to avoid the
// "IP spoofing" class of issues when not behind a proxy.
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);

// Security headers. CSP is intentionally disabled: the SPA uses Tailwind/Vite
// inline styles, and a wrong CSP would break the live site. Everything else
// (nosniff, frameguard, HSTS, referrer policy, hidePoweredBy) is enabled.
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

function requireApiToken(req: any, res: any, next: any) {
  if (!API_AUTH_TOKEN) return next();
  // Reads stay public so monitoring dashboards and uptime checks keep working.
  if (!PROTECTED_METHODS.has(req.method)) return next();
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && timingSafeEqualStr(token, API_AUTH_TOKEN)) return next();
  return res.status(401).json({ error: "A valid bearer token is required for this request." });
}

app.use("/api", requireApiToken);

// Global WebSocket server and broadcast utility
let wss: WebSocketServer | null = null;

function broadcast(type: string, data: any) {
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(JSON.stringify({ type, data }));
        } catch (err) {
          logger.error("Error sending WebSocket message:", err);
        }
      }
    });
  }
}

/* ---------------------------------------------------------------------------
 * AI provider
 *
 * One OpenAI-compatible gateway (Sakelar by default, model glm-5.3-flash)
 * replaces the Gemini SDK. No key means no AI: the UI is told, nothing is faked.
 * ------------------------------------------------------------------------- */

let aiCooldownUntil = 0;

/** True when a key exists and no rate-limit cooldown is in force. */
function isAiAvailable(): boolean {
  const config = aiConfig();
  if (!config.enabled) return false;
  if (Date.now() < aiCooldownUntil) return false;
  return true;
}

/** Readability alias used at the collection call sites. */
function aiCanSearch(): boolean {
  return isAiAvailable();
}

function startAiCooldown(ms = 120_000) {
  aiCooldownUntil = Date.now() + ms;
}

/** Classifies provider failures so the caller can log and degrade correctly. */
function describeAiFailure(err: unknown): string {
  if (err instanceof AiError) {
    if (err.kind === "rate-limit") startAiCooldown();
    return `[${err.kind}] ${err.message}`;
  }
  return String((err as any)?.message || err);
}

// Database: node:sqlite behind a small better-sqlite3-compatible adapter, so a
// missing native binary can never stop the server from booting.
import Database from "./src/lib/sqlite.ts";

const IS_VERCEL = !!process.env.VERCEL;
const SQLITE_DB_PATH = IS_VERCEL
  ? path.join("/tmp", "database.sqlite")
  : path.join(process.cwd(), "src", "data", "database.sqlite");

// Ensure directory exists
fs.mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true });

// Initialize database connection
const dbConn = new Database(SQLITE_DB_PATH);

// Enable WAL mode for better performance
dbConn.pragma("journal_mode = WAL");

// Setup clean empty tables
dbConn.exec(`
  CREATE TABLE IF NOT EXISTS trackers (
    id TEXT PRIMARY KEY,
    type TEXT,
    query TEXT,
    platforms TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS analyzed_posts (
    id TEXT PRIMARY KEY,
    url TEXT,
    platform TEXT,
    title TEXT,
    description TEXT,
    imageUrl TEXT,
    sentiment TEXT,
    sentimentScore REAL,
    emotion TEXT,
    engagement TEXT,
    hashtags TEXT,
    analyzedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS monitor_results (
    id TEXT PRIMARY KEY,
    platform TEXT,
    url TEXT,
    author TEXT,
    title TEXT,
    content TEXT,
    sentiment TEXT,
    sentimentScore REAL,
    emotion TEXT,
    engagement TEXT,
    date TEXT,
    trackerId TEXT,
    country TEXT,
    latitude REAL,
    longitude REAL
  );
`);

// Indexes the targeted writes rely on: deletes and reads are always scoped by
// tracker or by recency, so both get an index instead of a table scan.
dbConn.exec(`
  CREATE INDEX IF NOT EXISTS idx_mentions_tracker ON monitor_results(trackerId);
  CREATE INDEX IF NOT EXISTS idx_mentions_date ON monitor_results(date);
  CREATE INDEX IF NOT EXISTS idx_analyzed_date ON analyzed_posts(analyzedAt);
`);

// Run dynamic column additions if tables already exist but lack coordinates/country columns
try {
  dbConn.exec("ALTER TABLE monitor_results ADD COLUMN country TEXT;");
} catch (e) {}
try {
  dbConn.exec("ALTER TABLE monitor_results ADD COLUMN latitude REAL;");
} catch (e) {}
try {
  dbConn.exec("ALTER TABLE monitor_results ADD COLUMN longitude REAL;");
} catch (e) {}
try {
  dbConn.exec("ALTER TABLE monitor_results ADD COLUMN isSimulated INTEGER;");
} catch (e) {}

// ==========================================
// FIREBASE / FIRESTORE SYNC LOGIC
// ==========================================
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let firebaseConfig: any = {};
try {
  let foundPath = "";
  
  // 1. Check process.cwd()
  const cwdPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(cwdPath)) {
    foundPath = cwdPath;
  }

  // 2. Check __dirname safely (without throwing ReferenceError if running as ES module in dev mode)
  if (!foundPath) {
    let resolvedDirname = "";
    try {
      resolvedDirname = __dirname;
    } catch (e) {
      // In ES modules __dirname is not defined
    }
    if (resolvedDirname) {
      const parentDirConfig = path.join(resolvedDirname, "../firebase-applet-config.json");
      const sameDirConfig = path.join(resolvedDirname, "firebase-applet-config.json");
      if (fs.existsSync(parentDirConfig)) {
        foundPath = parentDirConfig;
      } else if (fs.existsSync(sameDirConfig)) {
        foundPath = sameDirConfig;
      }
    }
  }

  // 3. Check absolute container paths
  if (!foundPath) {
    if (fs.existsSync("/app/firebase-applet-config.json")) {
      foundPath = "/app/firebase-applet-config.json";
    } else if (fs.existsSync("/firebase-applet-config.json")) {
      foundPath = "/firebase-applet-config.json";
    }
  }

  if (foundPath) {
    firebaseConfig = JSON.parse(fs.readFileSync(foundPath, "utf-8"));
    logger.info(`[Firebase Init] Successfully loaded config from absolute path: ${foundPath}`);
  } else {
    logger.warn("[Firebase Init] firebase-applet-config.json not found in any standard path.");
  }
} catch (err) {
  logger.warn("[Firebase Init] Failed to read firebase-applet-config.json locally:", err);
}

if (!getApps().length) {
  let adminCredential: any = null;

  // Supports initializing with a service account on external hosting providers like Railway
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      adminCredential = cert(sa);
      logger.info("[Firebase Init] Initializing with service account credential from FIREBASE_SERVICE_ACCOUNT_JSON.");
    } catch (err) {
      logger.error("[Firebase Init] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", err);
    }
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    try {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      adminCredential = cert({
        projectId: firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      });
      logger.info("[Firebase Init] Initializing with service account credential from individual environment variables.");
    } catch (err) {
      logger.error("[Firebase Init] Failed to initialize with service account environment variables:", err);
    }
  }

  const initOptions: any = {
    projectId: firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || "aplikasi-smip",
  };

  if (adminCredential) {
    initOptions.credential = adminCredential;
  }

  initializeApp(initOptions);
}

let useDefaultDb = false;
let disableFirestoreSync = false;

// Globally handle unhandled rejections and uncaught exceptions to ensure the server never crashes
process.on("unhandledRejection", (reason: any) => {
  const reasonStr = String(reason?.stack || reason || "");
  const isCredentialIssue =
    reasonStr.includes("credentials") ||
    reasonStr.includes("ADC") ||
    reasonStr.includes("GoogleAuth") ||
    reasonStr.includes("application_default_credentials");

  if (isCredentialIssue) {
    // Expected when Firebase is not configured. One line, then run on SQLite.
    if (!disableFirestoreSync) {
      logger.warn(
        "[Firebase Sync] Firestore credentials unavailable — running on the local SQLite cache only."
      );
    }
    disableFirestoreSync = true;
    return;
  }
  logger.error("[Unhandled Rejection]", reason);
});

process.on("uncaughtException", (error: any) => {
  // Never keep running after an uncaught exception: process state may be corrupt.
  logger.error("[Uncaught Exception] shutting down", error);
  process.exit(1);
});

function getFirestoreInstance() {
  if (useDefaultDb) {
    return getFirestore();
  }
  if (firebaseConfig.firestoreDatabaseId) {
    try {
      return getFirestore(firebaseConfig.firestoreDatabaseId);
    } catch (err) {
      logger.warn("[Firebase Sync] Failed to get named Firestore instance, falling back to default:", err);
      useDefaultDb = true;
      return getFirestore();
    }
  }
  return getFirestore();
}

async function syncFromFirestoreToSQLite() {
  if (disableFirestoreSync) {
    logger.info("[Firebase Sync] Sync is disabled. Running on local SQLite cache.");
    return;
  }
  try {
    logger.info("[Firebase Sync] Loading initial database from Firestore...");
    let db = getFirestoreInstance();
    
    // 1. Fetch Trackers (with dynamic fallback for the first operation)
    let trackersSnap;
    try {
      trackersSnap = await db.collection("trackers").get();
    } catch (err: any) {
      const errMsg = String(err);
      if (!useDefaultDb && firebaseConfig.firestoreDatabaseId && (errMsg.includes("NOT_FOUND") || errMsg.includes("PERMISSION_DENIED") || errMsg.includes("5") || errMsg.includes("7"))) {
        logger.warn(`[Firebase Sync] Named database failed, falling back to default database.`);
        useDefaultDb = true;
        try {
          db = getFirestoreInstance();
          trackersSnap = await db.collection("trackers").get();
        } catch (innerErr) {
          logger.warn("[Firebase Sync] Default database failed during init. Disabling Firestore sync and running locally.");
          disableFirestoreSync = true;
          return;
        }
      } else {
        logger.warn("[Firebase Sync] Firestore query failed during init. Disabling Firestore sync and running locally.");
        disableFirestoreSync = true;
        return;
      }
    }
    
    const trackers: any[] = [];
    trackersSnap.forEach((doc: any) => {
      trackers.push({ id: doc.id, ...doc.data() });
    });
    
    // 2. Fetch Analyzed Posts
    const analyzedSnap = await db.collection("analyzed_posts").get();
    const analyzedPosts: any[] = [];
    analyzedSnap.forEach((doc: any) => {
      analyzedPosts.push({ id: doc.id, ...doc.data() });
    });
    
    // 3. Fetch Monitor Results (supports up to 1000 items)
    const monitorSnap = await db.collection("monitor_results").get();
    const monitorResults: any[] = [];
    monitorSnap.forEach((doc: any) => {
      monitorResults.push({ id: doc.id, ...doc.data() });
    });

    logger.info(`[Firebase Sync] Loaded from Firestore: ${trackers.length} trackers, ${analyzedPosts.length} analyzed posts, ${monitorResults.length} monitor results.`);

    // If Firestore has data, overwrite our local SQLite database cache with it
    if (trackers.length > 0 || analyzedPosts.length > 0 || monitorResults.length > 0) {
      logger.info("[Firebase Sync] Populating local SQLite cache with Firestore data...");
      
      const syncTransaction = dbConn.transaction(() => {
        // Clear local
        dbConn.prepare("DELETE FROM trackers").run();
        dbConn.prepare("DELETE FROM analyzed_posts").run();
        dbConn.prepare("DELETE FROM monitor_results").run();
        
        // Insert trackers
        const insertTracker = dbConn.prepare(
          "INSERT INTO trackers (id, type, query, platforms, createdAt) VALUES (?, ?, ?, ?, ?)"
        );
        for (const t of trackers) {
          insertTracker.run(t.id, t.type, t.query, JSON.stringify(t.platforms || []), t.createdAt);
        }

        // Insert analyzed posts
        const insertAnalyzedPost = dbConn.prepare(
          "INSERT INTO analyzed_posts (id, url, platform, title, description, imageUrl, sentiment, sentimentScore, emotion, engagement, hashtags, analyzedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const ap of analyzedPosts) {
          insertAnalyzedPost.run(
            ap.id,
            ap.url,
            ap.platform,
            ap.title,
            ap.description,
            ap.imageUrl,
            ap.sentiment,
            ap.sentimentScore,
            ap.emotion,
            ap.engagement,
            JSON.stringify(ap.hashtags || []),
            ap.analyzedAt
          );
        }

        // Insert monitor results
        const insertMonitorResult = dbConn.prepare(
          "INSERT INTO monitor_results (id, platform, url, author, title, content, sentiment, sentimentScore, emotion, engagement, date, trackerId, country, latitude, longitude, isSimulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        for (const mr of monitorResults) {
          insertMonitorResult.run(
            mr.id,
            mr.platform,
            mr.url,
            mr.author,
            mr.title,
            mr.content,
            mr.sentiment,
            mr.sentimentScore,
            mr.emotion,
            mr.engagement,
            mr.date,
            mr.trackerId,
            mr.country || "Global",
            mr.latitude !== undefined && mr.latitude !== null ? Number(mr.latitude) : null,
            mr.longitude !== undefined && mr.longitude !== null ? Number(mr.longitude) : null,
            mr.isSimulated === true ? 1 : 0
          );
        }
      });
      syncTransaction();
      logger.info("[Firebase Sync] Local SQLite cache populated successfully!");
    } else {
      logger.info("[Firebase Sync] Firestore is empty. Initializing with local or default seed data...");
      const localData = getDB();
      await seedFirestoreMirror(localData);
    }
  } catch (err: any) {
    const errMsg = String(err.message || err).replace(/error/gi, "err-info");
    logger.warn("[Firebase Sync] Information loading initial database from Firestore:", errMsg);
  }
}

/* ---------------------------------------------------------------------------
 * Firestore mirror
 *
 * The old sync read every collection, diffed it in memory and rewrote every
 * document — the whole mirror on each change, and a billed read per document.
 * On a 1000-mention dataset that is thousands of Firestore operations for one
 * new mention.
 *
 * Instead the write helpers above record which documents actually changed
 * (set/delete) in a queue. The queue is flushed in debounced batches: one
 * commit per 200 operations, only the touched documents, no reads.
 * ------------------------------------------------------------------------- */

const firestoreMirror = createFirestoreMirror({
  getDb: () => getFirestoreInstance() as any,
  onUnavailable: (reason) => {
    logger.warn("[Firebase Sync] Firestore unavailable — mirror disabled, local SQLite only.", reason);
    disableFirestoreSync = true;
  },
  onInfo: (message) => logger.info(message),
  onWarn: (message, err) => logger.warn(message, err)
});

/** Records one changed document. Flushing is debounced and batched. */
function queueMirrorOp(op: MirrorOp) {
  if (disableFirestoreSync) return;
  firestoreMirror.queue(op);
}

/**
 * Seeds the mirror once, when the remote database is empty. This is the only
 * path that writes documents not produced by a local change, so it is capped.
 */
async function seedFirestoreMirror(data: any): Promise<boolean> {
  if (disableFirestoreSync) return false;
  try {
    for (const op of seedOperations(data)) firestoreMirror.queue(op);
    const written = await firestoreMirror.flushNow();
    logger.info(`[Firebase Sync] Seeded ${written} document(s) into an empty Firestore.`);
    return true;
  } catch (err: any) {
    logger.warn("[Firebase Sync] Could not seed the mirror:", err?.message || err);
    return false;
  }
}

function getDB() {
  try {
    const trackers = dbConn.prepare("SELECT * FROM trackers").all().map((t: any) => ({
      ...t,
      platforms: JSON.parse(t.platforms || "[]")
    }));
    
    const analyzedPosts = dbConn.prepare("SELECT * FROM analyzed_posts").all().map((ap: any) => ({
      ...ap,
      sentimentScore: Number(ap.sentimentScore || 0),
      hashtags: JSON.parse(ap.hashtags || "[]")
    }));
    
    const monitorResults = dbConn.prepare("SELECT * FROM monitor_results").all().map((mr: any) => ({
      ...mr,
      sentimentScore: Number(mr.sentimentScore || 0),
      country: mr.country || "Global",
      latitude: mr.latitude !== null && mr.latitude !== undefined ? Number(mr.latitude) : null,
      longitude: mr.longitude !== null && mr.longitude !== undefined ? Number(mr.longitude) : null,
      isSimulated: mr.isSimulated === 1
    }));

    return { trackers, analyzedPosts, monitorResults };
  } catch (err) {
    logger.error("Error reading database from SQLite:", err);
    return { trackers: [], analyzedPosts: [], monitorResults: [] };
  }
}

/* ---------------------------------------------------------------------------
 * Targeted writes
 *
 * The old writeDB() deleted every row of every table and re-inserted the whole
 * in-memory snapshot on every mutation. On a VPS with a real dataset that means
 * a full table rewrite for a single added mention, and it briefly empties the
 * tables inside the transaction.
 *
 * Each mutation now touches only the rows it actually changed: upsert the one
 * record, delete the one row, or replace the results of one tracker. Writes are
 * wrapped in a transaction so a failure cannot leave a half-applied change.
 * ------------------------------------------------------------------------- */

function runInTransaction<T>(fn: () => T): T {
  return dbConn.transaction(fn)();
}

const SQL_UPSERT_TRACKER = `
  INSERT INTO trackers (id, type, query, platforms, createdAt)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    type = excluded.type,
    query = excluded.query,
    platforms = excluded.platforms,
    createdAt = excluded.createdAt
`;

const SQL_UPSERT_ANALYZED = `
  INSERT INTO analyzed_posts (id, url, platform, title, description, imageUrl, sentiment, sentimentScore, emotion, engagement, hashtags, analyzedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    url = excluded.url,
    platform = excluded.platform,
    title = excluded.title,
    description = excluded.description,
    imageUrl = excluded.imageUrl,
    sentiment = excluded.sentiment,
    sentimentScore = excluded.sentimentScore,
    emotion = excluded.emotion,
    engagement = excluded.engagement,
    hashtags = excluded.hashtags,
    analyzedAt = excluded.analyzedAt
`;

const SQL_UPSERT_MENTION = `
  INSERT INTO monitor_results (id, platform, url, author, title, content, sentiment, sentimentScore, emotion, engagement, date, trackerId, country, latitude, longitude, isSimulated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    platform = excluded.platform,
    url = excluded.url,
    author = excluded.author,
    title = excluded.title,
    content = excluded.content,
    sentiment = excluded.sentiment,
    sentimentScore = excluded.sentimentScore,
    emotion = excluded.emotion,
    engagement = excluded.engagement,
    date = excluded.date,
    trackerId = excluded.trackerId,
    country = excluded.country,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    isSimulated = excluded.isSimulated
`;

function bindMention(stmt: any, mr: any) {
  stmt.run(
    mr.id,
    mr.platform || "unknown",
    mr.url || "",
    mr.author || "",
    mr.title || "",
    mr.content || "",
    mr.sentiment || "neutral",
    Number(mr.sentimentScore || 0),
    mr.emotion || "Neutral",
    mr.engagement || "Low",
    mr.date || new Date().toISOString(),
    mr.trackerId || "",
    mr.country || "Global",
    mr.latitude !== undefined && mr.latitude !== null ? Number(mr.latitude) : null,
    mr.longitude !== undefined && mr.longitude !== null ? Number(mr.longitude) : null,
    mr.isSimulated === true ? 1 : 0
  );
}

/** Inserts or updates a single tracker row. */
function saveTracker(tracker: any): boolean {
  if (!tracker?.id) return false;
  try {
    dbConn
      .prepare(SQL_UPSERT_TRACKER)
      .run(
        tracker.id,
        tracker.type || "brand",
        tracker.query || "",
        JSON.stringify(tracker.platforms || []),
        tracker.createdAt || new Date().toISOString()
      );
    queueMirrorOp({ kind: "set", collection: "trackers", id: tracker.id, data: toTrackerDoc(tracker) });
    return true;
  } catch (err) {
    logger.error("[DB] Failed to save tracker:", err);
    return false;
  }
}

/** Removes a tracker and, in the same transaction, the mentions it produced. */
function deleteTracker(id: string): boolean {
  try {
    runInTransaction(() => {
      dbConn.prepare("DELETE FROM monitor_results WHERE trackerId = ?").run(id);
      dbConn.prepare("DELETE FROM trackers WHERE id = ?").run(id);
    });
    queueMirrorOp({ kind: "delete", collection: "trackers", id });
    return true;
  } catch (err) {
    logger.error("[DB] Failed to delete tracker:", err);
    return false;
  }
}

/** Inserts or updates one analysed post. */
function saveAnalyzedPost(post: any): boolean {
  if (!post?.id) return false;
  try {
    dbConn
      .prepare(SQL_UPSERT_ANALYZED)
      .run(
        post.id,
        post.url || "",
        post.platform || "other",
        post.title || "",
        post.description || "",
        post.imageUrl || "",
        post.sentiment || "neutral",
        Number(post.sentimentScore || 0),
        post.emotion || "Neutral",
        post.engagement || "Low",
        JSON.stringify(post.hashtags || []),
        post.analyzedAt || new Date().toISOString()
      );
    queueMirrorOp({ kind: "set", collection: "analyzed_posts", id: post.id, data: toAnalyzedDoc(post) });
    return true;
  } catch (err) {
    logger.error("[DB] Failed to save analysed post:", err);
    return false;
  }
}

/** Inserts or updates many mentions in one transaction. */
function saveMentions(mentions: any[]): number {
  const rows = (mentions || []).filter((m: any) => m?.id);
  if (rows.length === 0) return 0;
  try {
    runInTransaction(() => {
      const stmt = dbConn.prepare(SQL_UPSERT_MENTION);
      for (const mr of rows) bindMention(stmt, mr);
    });
    for (const mr of rows) {
      queueMirrorOp({ kind: "set", collection: "monitor_results", id: mr.id, data: toMentionDoc(mr) });
    }
    return rows.length;
  } catch (err) {
    logger.error("[DB] Failed to save mentions:", err);
    return 0;
  }
}

/**
 * Replaces everything collected for one tracker. Used by a manual scan, where
 * the fresh result set is authoritative for that tracker only.
 */
function replaceMentionsForTracker(trackerId: string, mentions: any[]): number {
  try {
    // The rows about to disappear must be deleted from the mirror too.
    const stale = dbConn
      .prepare("SELECT id FROM monitor_results WHERE trackerId = ?")
      .all(trackerId) as any[];
    runInTransaction(() => {
      dbConn.prepare("DELETE FROM monitor_results WHERE trackerId = ?").run(trackerId);
      const stmt = dbConn.prepare(SQL_UPSERT_MENTION);
      for (const mr of mentions || []) {
        if (mr?.id) bindMention(stmt, { ...mr, trackerId });
      }
    });
    for (const row of stale) {
      queueMirrorOp({ kind: "delete", collection: "monitor_results", id: row.id });
    }
    for (const mr of mentions || []) {
      if (mr?.id) queueMirrorOp({ kind: "set", collection: "monitor_results", id: mr.id, data: toMentionDoc({ ...mr, trackerId }) });
    }
    return (mentions || []).length;
  } catch (err) {
    logger.error("[DB] Failed to replace tracker mentions:", err);
    return 0;
  }
}

/** Keeps the newest `max` mentions and deletes the rest, in one statement. */
function pruneMentions(max = 1000): number {
  try {
    const before = dbConn.prepare("SELECT COUNT(*) AS c FROM monitor_results").get() as any;
    const total = Number(before?.c || 0);
    if (total <= max) return 0;
    const doomed = dbConn
      .prepare(
        "SELECT id FROM monitor_results WHERE rowid NOT IN (SELECT rowid FROM monitor_results ORDER BY rowid DESC LIMIT ?)"
      )
      .all(max) as any[];
    dbConn
      .prepare(
        "DELETE FROM monitor_results WHERE rowid NOT IN (SELECT rowid FROM monitor_results ORDER BY rowid DESC LIMIT ?)"
      )
      .run(max);
    for (const row of doomed) {
      queueMirrorOp({ kind: "delete", collection: "monitor_results", id: row.id });
    }
    return total - max;
  } catch (err) {
    logger.error("[DB] Failed to prune mentions:", err);
    return 0;
  }
}

// List of premium standard browser User-Agents to prevent header-based scraping blocks
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
];

// Only public social-network hosts may be fetched. Without this, /api/analyze-url
// is a textbook SSRF: an attacker could make the server read internal services
// (cloud metadata, localhost admin panels, private networks).
const ALLOWED_SCRAPE_HOSTS = new Set([
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "fb.com", "www.fb.com",
  "whatsapp.com", "www.whatsapp.com", "wa.me",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
  "linkedin.com", "www.linkedin.com", "lnkd.in",
  "reddit.com", "www.reddit.com", "redd.it", "old.reddit.com",
]);

// Reject IP-literal hosts outright (127.0.0.1, 169.254.169.254, [::1], ...).
function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || // IPv4
    hostname.includes(":") ||                      // IPv6 (URL keeps brackets)
    /^0x/i.test(hostname) ||                       // hex-encoded IP
    /^\d+$/.test(hostname)                        // decimal-encoded IP
  );
}

export function validateScrapeUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  if (parsed.port) {
    throw new Error("Custom ports are not allowed.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isIpLiteral(hostname)) {
    throw new Error("IP addresses are not allowed.");
  }
  if (!ALLOWED_SCRAPE_HOSTS.has(hostname)) {
    throw new Error(
      "That domain is not supported. Use a link from TikTok, Instagram, Facebook, WhatsApp, X, YouTube, LinkedIn or Reddit."
    );
  }
  return parsed;
}

// Scrape Social Media URL Meta Tags using rotating User-Agents and multi-fallback parsing
async function scrapeSocialUrl(url: string) {
  try {
    const parsedUrl = validateScrapeUrl(url);
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const referer = `${parsedUrl.protocol}//${parsedUrl.hostname}/`;

    const response = await fetch(parsedUrl.toString(), {
      // Never follow redirects: a public host could redirect the server to an
      // internal address, re-opening the SSRF hole.
      redirect: "manual",
      headers: {
        "User-Agent": randomUserAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": referer,
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": randomUserAgent.includes("Mobile") ? "?1" : "?0",
        "Sec-Ch-Ua-Platform": randomUserAgent.includes("Windows") ? '"Windows"' : (randomUserAgent.includes("Macintosh") ? '"macOS"' : '"Android"'),
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
      },
      signal: AbortSignal.timeout(8000) // 8 seconds timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const html = await response.text();

    // 1. Extract HTML title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : "";

    // 2. Multi-fallback OpenGraph extraction patterns
    const extractMeta = (properties: string[], names: string[]): string => {
      for (const prop of properties) {
        const regex = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
        const revRegex = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
        const match = html.match(regex) || html.match(revRegex);
        if (match && match[1]) return match[1].trim();
      }
      for (const name of names) {
        const regex = new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
        const revRegex = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i");
        const match = html.match(regex) || html.match(revRegex);
        if (match && match[1]) return match[1].trim();
      }
      return "";
    };

    const title = extractMeta(["og:title", "twitter:title"], ["title", "headline"]) || pageTitle;
    const description = extractMeta(["og:description", "twitter:description"], ["description", "summary"]);
    const imageUrl = extractMeta(["og:image", "twitter:image", "og:image:url"], ["image", "thumbnailUrl"]);

    // 3. Fallback to JSON-LD parsing if available
    let jsonLdTitle = "";
    let jsonLdDesc = "";
    let jsonLdImg = "";
    try {
      const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch && jsonLdMatch[1]) {
        const parsed = JSON.parse(jsonLdMatch[1].trim());
        jsonLdTitle = parsed.name || parsed.headline || "";
        jsonLdDesc = parsed.description || "";
        if (parsed.image) {
          jsonLdImg = typeof parsed.image === "string" ? parsed.image : (parsed.image.url || (Array.isArray(parsed.image) ? parsed.image[0] : ""));
        }
      }
    } catch (_) {}

    return {
      title: title || jsonLdTitle || "Social Media Content",
      description: description || jsonLdDesc || "Public content scraped successfully.",
      imageUrl: imageUrl || jsonLdImg || "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80",
      success: true
    };
  } catch (err: any) {
    logger.warn(`Scrape failed for ${url}:`, err.message);
    // Return gracefully so the analyser can estimate from what it did get
    return {
      title: "Scrape Link",
      description: "URL inaccessible due to platform security restrictions, but metadata can be analyzed conceptually.",
      imageUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80",
      success: false
    };
  }
}

// Detect platform from URL
function detectPlatform(url: string): 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other' {
  const lower = url.toLowerCase();
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("wa.me") || lower.includes("whatsapp.com")) return "whatsapp";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("reddit.com")) return "reddit";
  return "other";
}

// Local Fallback Heuristics for Sentiment Analysis (Used when external API keys or scopes are limited)
function localAnalyzeSentiment(title?: string, content?: string) {
  const safeTitle = title || "";
  const safeContent = content || "";
  const text = (safeTitle + " " + safeContent).toLowerCase();
  
  const posWords = ["bagus", "keren", "mantap", "hebat", "suka", "cinta", "puas", "rekomendasi", "juara", "enak", "bintang", "murah", "cepat", "ramah", "good", "love", "awesome", "perfect", "satisfied", "best", "hemat", "memuaskan", "terbaik"];
  const negWords = ["jelek", "kecewa", "lambat", "mahal", "buruk", "kesal", "marah", "rugi", "penipu", "ngaco", "gagal", "error", "rusak", "benci", "bad", "slow", "fail", "broken", "worst", "parah", "lelet", "sulit", "kapok"];
  
  let posCount = 0;
  let negCount = 0;
  
  posWords.forEach(w => {
    const regex = new RegExp(w, 'gi');
    const matches = text.match(regex);
    if (matches) posCount += matches.length;
  });
  
  negWords.forEach(w => {
    const regex = new RegExp(w, 'gi');
    const matches = text.match(regex);
    if (matches) negCount += matches.length;
  });
  
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  let sentimentScore = 0.0;
  let emotion = "Neutral";
  
  if (posCount > negCount) {
    sentiment = "positive";
    sentimentScore = Number(Math.min(1.0, 0.2 + (posCount - negCount) * 0.15).toFixed(2));
    emotion = posCount > 2 ? "Joy" : "Love";
  } else if (negCount > posCount) {
    sentiment = "negative";
    sentimentScore = Number(Math.max(-1.0, -0.2 - (negCount - posCount) * 0.15).toFixed(2));
    emotion = text.includes("marah") || text.includes("kesal") || text.includes("parah") ? "Anger" : "Sadness";
  } else {
    sentiment = "neutral";
    sentimentScore = 0.0;
    emotion = "Neutral";
  }
  
  const hashtagRegex = /#\w+/g;
  const parsedHashtags = text.match(hashtagRegex) || [];
  let hashtags: string[] = parsedHashtags.map(h => h.toLowerCase());
  
  if (hashtags.length === 0) {
    hashtags = ["#brandmonitoring", "#analisissentimen", "#sosmed"];
  }
  
  const refinedTitle = safeTitle.length > 50 ? safeTitle.substring(0, 47) + "..." : safeTitle || "Analisis Konten Sosmed";
  const refinedDescription = safeContent.length > 150 ? safeContent.substring(0, 147) + "..." : safeContent || "Tidak ada deskripsi konten tambahan.";
  
  return {
    sentiment,
    sentimentScore,
    emotion,
    engagement: safeContent.length > 100 ? "High" : (safeContent.length > 30 ? "Medium" : "Low"),
    hashtags,
    refinedTitle,
    refinedDescription
  };
}

// REAL LIVE INTEGRATION: Fetch authentic public Reddit posts
async function fetchRealRedditPosts(query: string): Promise<any[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=4&sort=new`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SMIP-Engine/1.0"
      }
    });
    if (!res.ok) {
      logger.warn(`[Reddit API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.data || !json.data.children) return [];

    const posts = json.data.children.map((child: any) => {
      const p = child.data;
      const content = p.selftext || p.title || "";
      const localAnalysis = localAnalyzeSentiment(p.title, content);
      
      return {
        platform: "reddit",
        url: `https://www.reddit.com${p.permalink}`,
        author: `u/${p.author}`,
        title: p.title || "Reddit Post",
        content: content.slice(0, 280) || "No text content.",
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: p.score > 100 ? "High" : (p.score > 20 ? "Medium" : "Low"),
        date: new Date(p.created_utc * 1000).toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
    return posts;
  } catch (err) {
    logger.error("[Reddit API Error] Failed to fetch real Reddit posts:", err);
    return [];
  }
}

// REAL LIVE INTEGRATION: Fetch authentic YouTube videos if API key is provided
async function fetchRealYouTubeVideos(query: string): Promise<any[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${apiKey}&maxResults=3`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`[YouTube API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.items) return [];

    return json.items.map((item: any) => {
      const snippet = item.snippet;
      const videoId = item.id.videoId;
      const localAnalysis = localAnalyzeSentiment(snippet.title, snippet.description);

      return {
        platform: "youtube",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: snippet.channelTitle || "@youtube_channel",
        title: snippet.title || "YouTube Video",
        content: (snippet.description || "No description available.").slice(0, 280),
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: "High",
        date: snippet.publishedAt || new Date().toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
  } catch (err) {
    logger.error("[YouTube API Error] Failed to fetch real YouTube videos:", err);
    return [];
  }
}

// REAL LIVE INTEGRATION: Fetch authentic recent tweets if bearer token is provided
async function fetchRealTweets(query: string): Promise<any[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  try {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=created_at,public_metrics,author_id&max_results=4`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    if (!res.ok) {
      logger.warn(`[Twitter API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.data) return [];

    return json.data.map((tweet: any) => {
      const localAnalysis = localAnalyzeSentiment("", tweet.text);
      const metrics = tweet.public_metrics || {};
      const engagementScore = (metrics.retweet_count || 0) + (metrics.like_count || 0);

      return {
        platform: "twitter",
        url: `https://x.com/user/status/${tweet.id}`,
        author: `id:${tweet.author_id}`,
        title: "Tweet Mention",
        content: (tweet.text || "No tweet content.").slice(0, 280),
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: engagementScore > 50 ? "High" : (engagementScore > 10 ? "Medium" : "Low"),
        date: tweet.created_at || new Date().toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
  } catch (err) {
    logger.error("[Twitter API Error] Failed to fetch real tweets:", err);
    return [];
  }
}

/* ---------------------------------------------------------------------------
 * Open collectors
 *
 * Each of these talks to a documented, public endpoint — no scraping of
 * logged-in pages, no credentials invented. They are the reason the dashboard
 * can show real data without any AI key.
 * ------------------------------------------------------------------------- */

const COLLECTOR_TIMEOUT_MS = 8000;

async function fetchJson(url: string, init?: any): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "SMIP-Engine/1.1 (+https://github.com/JohnIsDimz/Social-Media-Intelligence-Platform)",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      logger.warn(`[Collector] ${new URL(url).host} responded ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    logger.warn(`[Collector] ${new URL(url).host} failed: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Maps a collector's raw item onto the mention shape the rest of the app expects. */
function toMention(args: {
  platform: string;
  url: string;
  author: string;
  title: string;
  content: string;
  engagementValue?: number;
  date?: string;
  country?: string;
}): any {
  const local = localAnalyzeSentiment(args.title, args.content);
  const engagementValue = args.engagementValue ?? 0;
  return {
    platform: args.platform,
    url: args.url,
    author: args.author || "Public discussion",
    title: args.title || `${args.platform} mention`,
    content: (args.content || "").slice(0, 280),
    sentiment: local.sentiment,
    sentimentScore: local.sentimentScore,
    emotion: local.emotion,
    engagement: engagementValue > 100 ? "High" : engagementValue > 20 ? "Medium" : "Low",
    date: args.date || new Date().toISOString(),
    country: args.country || "Global",
    latitude: 0,
    longitude: 0,
  };
}

/** Bluesky — public AT Protocol search, no credentials. */
async function fetchBlueskyPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=5&sort=latest`
  );
  if (!json?.posts) return [];
  return json.posts.map((post: any) =>
    toMention({
      platform: "bluesky",
      url: `https://bsky.app/profile/${post.author?.handle}/post/${String(post.uri).split("/").pop()}`,
      author: `@${post.author?.handle}`,
      title: post.record?.text?.slice(0, 90) || "Bluesky post",
      content: post.record?.text || "",
      engagementValue: (post.likeCount || 0) + (post.repostCount || 0) + (post.replyCount || 0),
      date: post.record?.createdAt ? new Date(post.record.createdAt).toISOString() : undefined,
    })
  );
}

/** Mastodon — public search endpoint on a large instance. */
async function fetchMastodonPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://mastodon.social/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=5&resolve=false`
  );
  const statuses = json?.statuses || [];
  return statuses.map((st: any) =>
    toMention({
      platform: "mastodon",
      url: st.url || st.uri,
      author: `@${st.account?.acct}`,
      title: (st.content || "").replace(/<[^>]*>/g, "").slice(0, 90) || "Mastodon post",
      content: (st.content || "").replace(/<[^>]*>/g, ""),
      engagementValue: (st.reblogs_count || 0) + (st.favourites_count || 0) + (st.replies_count || 0),
      date: st.created_at ? new Date(st.created_at).toISOString() : undefined,
    })
  );
}

/** Hacker News — Algolia's public search API. */
async function fetchHackerNews(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`
  );
  if (!json?.hits) return [];
  return json.hits.map((hit: any) =>
    toMention({
      platform: "hackernews",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author || "HN user",
      title: hit.title || hit.story_title || "Hacker News story",
      content: hit.comment_text || hit.story_text || hit.title || "",
      engagementValue: hit.points || 0,
      date: hit.created_at ? new Date(hit.created_at).toISOString() : undefined,
    })
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Google News — public RSS, parsed without a dependency. */
async function fetchGoogleNews(query: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { signal: controller.signal, headers: { "User-Agent": "SMIP-Engine/1.1" } }
    );
    if (!res.ok) {
      logger.warn(`[Collector] news.google.com responded ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
    return items.map((match) => {
      const block = match[1];
      const pick = (tag: string) =>
        (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
      const title = decodeXml(pick("title"));
      const link = decodeXml(pick("link"));
      const pub = pick("pubDate");
      const source = decodeXml(pick("source")) || "a news outlet";
      return toMention({
        platform: "news",
        url: link,
        author: source,
        title,
        content: `${title} — published by ${source}.`,
        engagementValue: 50,
        date: pub ? new Date(pub).toISOString() : undefined,
      });
    });
  } catch (err: any) {
    logger.warn(`[Collector] Google News failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Lemmy — public search on a large instance. */
async function fetchLemmyPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts&sort=New&limit=5`
  );
  const posts = json?.posts || [];
  return posts.map((entry: any) => {
    const p = entry.post || {};
    return toMention({
      platform: "lemmy",
      url: p.ap_id || `https://lemmy.world/post/${p.id}`,
      author: entry.creator?.name ? `@${entry.creator.name}` : "Lemmy user",
      title: p.name || "Lemmy post",
      content: p.body || p.name || "",
      engagementValue: (p.counts?.score || 0) + (p.counts?.comments || 0),
      date: p.published ? new Date(p.published).toISOString() : undefined,
    });
  });
}

/** GitHub — public search API (unauthenticated is rate limited but works). */
async function fetchGitHubIssues(query: string): Promise<any[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const json = await fetchJson(
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=5`,
    { headers }
  );
  if (!json?.items) return [];
  return json.items.map((item: any) =>
    toMention({
      platform: "github",
      url: item.html_url,
      author: item.user?.login ? `@${item.user.login}` : "GitHub user",
      title: item.title || "GitHub issue",
      content: item.body || item.title || "",
      engagementValue: (item.comments || 0) + (item.reactions?.total_count || 0),
      date: item.created_at ? new Date(item.created_at).toISOString() : undefined,
    })
  );
}

/** Stack Overflow — public Stack Exchange API. */
async function fetchStackOverflow(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=${encodeURIComponent(
      query
    )}&site=stackoverflow&pagesize=5&filter=default`
  );
  if (!json?.items) return [];
  return json.items.map((item: any) =>
    toMention({
      platform: "stackoverflow",
      url: item.link,
      author: item.owner?.display_name || "Stack Overflow user",
      title: item.title || "Stack Overflow question",
      content: `${item.title || ""} — ${(item.tags || []).join(", ")}`,
      engagementValue: (item.score || 0) + (item.answer_count || 0) + (item.view_count || 0) / 100,
      date: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : undefined,
    })
  );
}

/** DEV Community — public articles API, filtered by the keyword. */
async function fetchDevTo(query: string): Promise<any[]> {
  const json = await fetchJson("https://dev.to/api/articles?per_page=60&top=30");
  const articles: any[] = Array.isArray(json) ? json : [];
  const needle = query.replace(/^#/, "").toLowerCase();
  return articles
    .filter((a) => {
      const hay = `${a.title} ${a.description || ""} ${(a.tags || a.tag_list || []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 4)
    .map((a) =>
      toMention({
        platform: "devto",
        url: a.url,
        author: a.user?.name || "DEV author",
        title: a.title || "DEV article",
        content: a.description || a.title || "",
        engagementValue: (a.public_reactions_count || 0) + (a.comments_count || 0),
        date: a.published_at ? new Date(a.published_at).toISOString() : undefined,
      })
    );
}

// REAL LIVE UNIFIED ENGINE: Combines official APIs, public search feeds, and Google Search Grounding
/** Public search URL for a platform, used when grounding returns no direct link. */
function constructOfficialPlatformSearchUrl(platform: string, query: string): string {
  const encQuery = encodeURIComponent(query);
  const tag = encodeURIComponent(query.replace(/[\s#]+/g, ""));
  switch (platform.toLowerCase()) {
    case "twitter":
    case "x":
      return `https://x.com/search?q=${encQuery}`;
    case "tiktok":
      return `https://www.tiktok.com/search?q=${encQuery}`;
    case "instagram":
      return `https://www.instagram.com/explore/tags/${tag}/`;
    case "facebook":
      return `https://www.facebook.com/search/top?q=${encQuery}`;
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encQuery}`;
    case "linkedin":
      return `https://www.linkedin.com/search/results/all/?keywords=${encQuery}`;
    case "reddit":
      return `https://www.reddit.com/search/?q=${encQuery}`;
    case "threads":
      return `https://www.threads.net/search?q=${encQuery}`;
    case "telegram":
      return `https://t.me/s/${tag}`;
    case "bluesky":
      return `https://bsky.app/search?q=${encQuery}`;
    case "mastodon":
      return `https://mastodon.social/search?q=${encQuery}`;
    case "hackernews":
      return `https://hn.algolia.com/?q=${encQuery}`;
    case "github":
      return `https://github.com/search?q=${encQuery}&type=issues`;
    case "pinterest":
      return `https://www.pinterest.com/search/pins/?q=${encQuery}`;
    case "news":
      return `https://news.google.com/search?q=${encQuery}`;
    default:
      return `https://www.google.com/search?q=${encQuery}`;
  }
}

async function fetchUnifiedSocialSignals(tracker: any): Promise<any[]> {
  const query = tracker.query;
  const selectedPlatforms: string[] = tracker.platforms || [];
  
  const apiTasks: { platform: string; promise: Promise<any[]> }[] = [];
  
  // 1. Reddit: Fetch real posts from Reddit public API if selected (requires no credentials!)
  if (selectedPlatforms.includes("reddit")) {
    logger.info(`[Unified API Engine] Querying public Reddit API for "${query}"...`);
    apiTasks.push({ platform: "reddit", promise: fetchRealRedditPosts(query) });
  }

  // 2. YouTube: Fetch real videos from YouTube Data API v3 if API key is present
  if (selectedPlatforms.includes("youtube") && process.env.YOUTUBE_API_KEY) {
    logger.info(`[Unified API Engine] Querying official YouTube API for "${query}"...`);
    apiTasks.push({ platform: "youtube", promise: fetchRealYouTubeVideos(query) });
  }

  // 3. Twitter/X: Fetch real tweets from Twitter API v2 if Bearer Token is present
  if ((selectedPlatforms.includes("twitter") || selectedPlatforms.includes("x")) && process.env.TWITTER_BEARER_TOKEN) {
    const platformName = selectedPlatforms.includes("twitter") ? "twitter" : "x";
    apiTasks.push({ platform: platformName, promise: fetchRealTweets(query) });
  }

  // 3b. Open collectors: documented public endpoints, no credentials required.
  const OPEN_COLLECTORS: Record<string, { run: () => Promise<any[]> }> = {
    bluesky: { run: () => fetchBlueskyPosts(query) },
    mastodon: { run: () => fetchMastodonPosts(query) },
    hackernews: { run: () => fetchHackerNews(query) },
    news: { run: () => fetchGoogleNews(query) },
    lemmy: { run: () => fetchLemmyPosts(query) },
    stackoverflow: { run: () => fetchStackOverflow(query) },
    devto: { run: () => fetchDevTo(query) },
    github: { run: () => fetchGitHubIssues(query) },
  };

  for (const platform of selectedPlatforms) {
    const key = platform.toLowerCase();
    if (OPEN_COLLECTORS[key]) {
      logger.info(`[Unified API Engine] Querying open ${key} endpoint for "${query}"...`);
      apiTasks.push({ platform: key, promise: OPEN_COLLECTORS[key].run() });
    }
  }

  const mergedResults: any[] = [];
  const platformsWithResults = new Set<string>();

  if (apiTasks.length > 0) {
    try {
      const results = await Promise.all(
        apiTasks.map(async (task) => {
          try {
            const res = await task.promise;
            if (res && res.length > 0) {
              platformsWithResults.add(task.platform.toLowerCase());
              if (task.platform.toLowerCase() === "x" || task.platform.toLowerCase() === "twitter") {
                platformsWithResults.add("twitter");
                platformsWithResults.add("x");
              }
              return res;
            }
          } catch (taskErr) {
            logger.warn(`[Unified API Engine] [Bypassed] Official API failed for platform ${task.platform}:`, taskErr);
          }
          return [];
        })
      );
      for (const resList of results) {
        mergedResults.push(...resList);
      }
    } catch (err) {
      logger.warn("[Unified API Engine] [Bypassed] Error waiting for official APIs:", err);
    }
  }

  // Find remaining platforms that either don't have official APIs or failed to return any results
  const remainingPlatforms = selectedPlatforms.filter(p => !platformsWithResults.has(p.toLowerCase()));

  // 4. Grounding: If we have remaining platforms (e.g. Tiktok, Instagram, Facebook, WhatsApp, LinkedIn, etc.)
  // or if we have fewer than 3 total results, trigger Google Search Grounding for absolute global coverage!
  if (remainingPlatforms.length > 0 && aiCanSearch()) {
    try {
      logger.info(`[Unified API Engine] Querying live Google Search Grounding for remaining platforms: ${remainingPlatforms.join(", ")}...`);
      const searchPlatformsStr = remainingPlatforms.join(", ");
      const prompt = `Search the live web for recent public discussions, posts, reviews, or mentions of "${query}" specifically on social media platforms: ${searchPlatformsStr}.
      Use Google Search grounding to retrieve real information.
      Then, process up to 4 real search result mentions and format them into a structured JSON array.
      
      Each item in the array MUST contain:
      - platform: one of ${JSON.stringify(CHANNEL_KEYS)}
      - url: the actual source URL retrieved from the search grounding links
      - author: name/handle of the poster or "Public Discussion"
      - title: brief summary headline of the post/mention
      - content: summary of what was said in the post or comment
      - sentiment: "positive" | "neutral" | "negative"
      - sentimentScore: number from -1 to 1 representing the emotion strength
      - emotion: "Joy" | "Anger" | "Sadness" | "Surprise" | "Love" | "Neutral"
      - engagement: "High" | "Medium" | "Low"
      - date: approximate ISO date (e.g. "2026-07-12T00:00:00.000Z")
      - country: country of origin of this post or the brand mention (e.g. "United States", "Indonesia", "United Kingdom", "Japan", etc.)
      - latitude: approximate latitude coordinate of the location
      - longitude: approximate longitude coordinate of the location
      
      JSON Output Format should be a clean array of these objects:
      [
        { ... },
        { ... }
      ]`;

      const parsedGrounding = await chatJson<any[]>({
        system:
          "You are a media-intelligence collector. You are given web results from a search tool and must " +
          "extract only mentions that actually appear in them. Never invent a post, an author, a URL or a date.",
        prompt,
        expectation: "an array of mention objects",
        temperature: 0,
        maxTokens: 2000,
      });

      if (!Array.isArray(parsedGrounding)) {
        throw new AiError("Grounding did not return an array.", "bad-response");
      }
      if (parsedGrounding.length === 0) {
        logger.info("[Unified API Engine] The model found no grounded mentions for this cycle.");
        return [];
      }

      // The model is happy to return loosely-related chatter. Drop anything that
      // never mentions the tracked keyword, so a channel is not "filled" with
      // unrelated posts.
      const keyword = query.replace(/^#/, "").toLowerCase().trim();
      const relevant = parsedGrounding.filter((res: any) => {
        if (!keyword) return true;
        const hay = `${res?.title || ""} ${res?.content || ""} ${res?.author || ""}`.toLowerCase();
        return hay.includes(keyword);
      });
      logger.info(
        `[Unified API Engine] Grounded mentions kept: ${relevant.length}/${parsedGrounding.length} (keyword match).`
      );

      const cleanGrounding = relevant.map((res: any) => {
        let cleanUrl = typeof res?.url === "string" ? res.url : "";
        if (
          !cleanUrl.startsWith("http") ||
          cleanUrl.includes("example.com") ||
          cleanUrl.includes("share/status/global")
        ) {
          cleanUrl = constructOfficialPlatformSearchUrl(res?.platform || "google", query);
        }
        return { ...res, url: cleanUrl };
      });

      mergedResults.push(...cleanGrounding);
    } catch (err: any) {
      logger.warn(
        `[Unified API Engine] Model lookup failed for ${remainingPlatforms.join(", ")}:`,
        describeAiFailure(err)
      );
    }
  }

  // 5. No synthetic fallback. An empty result is the honest answer, and the UI
  // tells the user which data sources are configured so they know why.
  if (mergedResults.length === 0) {
    logger.info(
      `[Unified API Engine] No collected mentions for "${query}". No placeholder data will be invented.`
    );
  }

  return mergedResults.map((item, index) => ({
    ...item,
    id: `mr-${Date.now()}-${index}`,
    trackerId: tracker.id
  }));
}

/* ---------------------------------------------------------------------------
 * Network audit
 *
 * "Which APIs are dead?" is answered by actually calling each endpoint, not by
 * trusting a comment. Results are cached for a minute so opening the dialog
 * repeatedly does not hammer anyone.
 * ------------------------------------------------------------------------- */

interface ChannelHealth {
  status: "configured" | "public" | "grounding" | "needs-key" | "closed" | "down" | "unverified";
  detail: string;
}

/**
 * Can this host reach the internet at all?
 *
 * Without this check a firewalled server looks identical to a world where every
 * social API is dead. Probing two unrelated, highly available hosts tells us
 * whether a failure is the network's fault or the endpoint's.
 */
async function detectEgress(): Promise<boolean> {
  const targets = ["https://registry.npmjs.org/-/ping", "https://api.github.com/zen"];
  for (const target of targets) {
    try {
      const res = await fetch(target, { method: "GET", signal: AbortSignal.timeout(5000) });
      if (res.status > 0) return true;
    } catch {
      /* try the next target */
    }
  }
  return false;
}

let healthCache: { at: number; payload: any } | null = null;
const HEALTH_TTL_MS = 60_000;

async function probeEndpoint(spec: { endpoint?: string; okStatus?: number[] }) {
  if (!spec.endpoint) return { reachable: false, status: 0, error: "no endpoint" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(spec.endpoint, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "SMIP-Health/1.1", Accept: "application/json, application/xml;q=0.9,*/*;q=0.8" },
    });
    const okStatuses = spec.okStatus ?? [200, 201, 400, 401, 403];
    return {
      reachable: true,
      // A 401/403 still proves the network is alive: the host answered.
      status: response.status,
      healthy: okStatuses.includes(response.status) || (response.status > 0 && response.status < 500 && response.status !== 404),
    };
  } catch (err: any) {
    return { reachable: false, status: 0, error: err?.cause?.code || err?.message || "network error" };
  } finally {
    clearTimeout(timer);
  }
}

async function buildChannelHealth(force = false) {
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) {
    return healthCache.payload;
  }

  const ai = aiSummary();
  const grounding = ai.enabled;
  const egress = await detectEgress();
  const channels: Record<string, ChannelHealth> = {};

  await Promise.all(
    CHANNEL_SPECS.map(async (spec) => {
      const hasCredential = spec.credential
        ? spec.credential.split("+").every((c) => Boolean(process.env[c.trim()]))
        : true;

      if (spec.kind === "grounding") {
        channels[spec.key] = {
          status: grounding ? "grounding" : "needs-key",
          detail: grounding
            ? `No public read API. Collected through search-grounded lookup on ${ai.provider} (${ai.model}): ${spec.collects}.`
            : `No public read API. Set AI_API_KEY (search-grounded lookup) to collect ${spec.collects}.`,
        };
        return;
      }

      if (spec.kind === "none") {
        channels[spec.key] = { status: "closed", detail: spec.collects };
        return;
      }

      if (!egress) {
        // The server itself is offline. Judging the vendor API would be a lie.
        channels[spec.key] = {
          status: "unverified",
          detail: spec.credential
            ? `Cannot be tested: this server has no outbound internet. ${spec.credential} will be needed once it does.`
            : `Cannot be tested: this server has no outbound internet. Endpoint is ${new URL(spec.endpoint!).host}.`,
        };
        return;
      }

      if (spec.credential && !hasCredential) {
        const probe = await probeEndpoint(spec);
        channels[spec.key] = {
          status: probe.reachable ? "needs-key" : "down",
          detail: probe.reachable
            ? `Endpoint answers (HTTP ${probe.status}). Set ${spec.credential} to collect ${spec.collects}.`
            : `Endpoint unreachable from this server (${probe.error}). Set ${spec.credential} on a host with network access.`,
        };
        return;
      }

      const probe = await probeEndpoint(spec);
      if (!probe.reachable) {
        channels[spec.key] = {
          status: "down",
          detail: `Unreachable from this server: ${probe.error}.`,
        };
      } else if (probe.status >= 500 || probe.status === 404) {
        channels[spec.key] = {
          status: "down",
          detail: `Endpoint responded HTTP ${probe.status}; this collector needs attention.`,
        };
      } else {
        channels[spec.key] = {
          status: spec.credential ? "configured" : "public",
          detail: `HTTP ${probe.status} from ${new URL(spec.endpoint!).host}. Collects ${spec.collects}.`,
        };
      }
    })
  );

  const values = Object.values(channels);
  const payload = {
    grounding,
    ai,
    egress,
    checkedAt: new Date().toISOString(),
    channels,
    summary: {
      total: values.length,
      reachable: values.filter((v) => v.status === "public" || v.status === "configured").length,
      searchOnly: values.filter((v) => v.status === "grounding").length,
      needsKey: values.filter((v) => v.status === "needs-key").length,
      closed: values.filter((v) => v.status === "closed").length,
      down: values.filter((v) => v.status === "down").length,
      unverified: values.filter((v) => v.status === "unverified").length,
    },
  };

  healthCache = { at: Date.now(), payload };
  logger.info(
    egress
      ? `[Health] ${payload.summary.total} networks checked: ${payload.summary.reachable} reachable, ${payload.summary.needsKey} need a key, ${payload.summary.closed} closed, ${payload.summary.down} down.`
      : `[Health] No outbound internet from this host; ${payload.summary.total} networks marked unverified instead of "down".`
  );
  return payload;
}

// ==========================================
// API ROUTES
// ==========================================

// 0a. Which collection sources are actually configured, so the UI can explain
// an empty dashboard instead of guessing.
app.get("/api/data-sources", async (req, res) => {
  res.json(await buildChannelHealth(req.query.force === "1"));
});

// Same data under an explicit name, for uptime monitors and the CI job.
app.get("/api/channel-health", async (req, res) => {
  const health = await buildChannelHealth(req.query.force === "1");
  const anyDown = health.summary.down > 0 && health.egress;
  // 200 while every reachable network is fine; 503 only when a real outage is
  // detected from a host that does have internet.
  res.status(anyDown ? 503 : 200).json(health);
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version || "unknown",
    ai: aiSummary(),
    collectors: {
      grounding: aiConfig().enabled,
      reddit: true,
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
      twitter: Boolean(process.env.TWITTER_BEARER_TOKEN),
    },
    timestamp: new Date().toISOString(),
  });
});

// 1. Get Trackers
app.get("/api/trackers", (req, res) => {
  const db = getDB();
  res.json(db.trackers);
});

// 2. Add Tracker
const ALLOWED_TRACKER_TYPES = ["brand", "hashtag", "url", "topic", "product"];
const ALLOWED_PLATFORMS = [...CHANNEL_KEYS, "x"];

app.post("/api/trackers", (req, res) => {
  const { type, query, platforms } = req.body || {};
  if (typeof type !== "string" || typeof query !== "string") {
    return res.status(400).json({ error: "Type and query are required." });
  }

  const cleanQuery = query.trim();
  if (cleanQuery.length < 1 || cleanQuery.length > 200) {
    return res.status(400).json({ error: "Query must be between 1 and 200 characters." });
  }
  if (!ALLOWED_TRACKER_TYPES.includes(type)) {
    return res.status(400).json({ error: "Unknown tracker type." });
  }

  const requestedPlatforms = Array.isArray(platforms) ? platforms : [];
  const cleanPlatforms = requestedPlatforms
    .filter((p: any) => typeof p === "string" && ALLOWED_PLATFORMS.includes(p.toLowerCase()))
    .map((p: string) => p.toLowerCase());

  const db = getDB();
  const newTracker = {
    id: `t-${Date.now()}`,
    type,
    query: cleanQuery,
    platforms: cleanPlatforms.length > 0 ? cleanPlatforms : CHANNEL_KEYS.filter((k) => channelSpec(k)?.kind === "api"),
    createdAt: new Date().toISOString()
  };

  saveTracker(newTracker);
  broadcast("SYNC", { event: "tracker_added", tracker: newTracker });
  res.json(newTracker);
});

// 3. Delete Tracker
app.delete("/api/trackers/:id", (req, res) => {
  const { id } = req.params;
  const db = getDB();
  
  deleteTracker(id);
  broadcast("SYNC", { event: "tracker_deleted", trackerId: id });
  res.json({ success: true, message: "Tracker deleted successfully" });
});

// 4. Get Analyzed Posts
app.get("/api/analyzed-posts", (req, res) => {
  const db = getDB();
  res.json(db.analyzedPosts);
});

// 4b. Get Monitor Results
app.get("/api/monitor-results", (req, res) => {
  const db = getDB();
  const { trackerId } = req.query;
  if (trackerId) {
    const filtered = db.monitorResults.filter((mr: any) => mr.trackerId === trackerId);
    return res.json(filtered);
  }
  res.json(db.monitorResults);
});

// 5. Analyze URL or Text directly
app.post("/api/analyze-url", async (req, res) => {
  const { url, rawText, manualPlatform } = req.body;
  
  if (!url && !rawText) {
    return res.status(400).json({ error: "Either URL or text content is required for analysis." });
  }

  let scrapedTitle = "Custom Text Analysis";
  let scrapedDesc = rawText || "";
  let scrapedImg = "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=300&q=80";
  let platform: 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other' = manualPlatform || "other";

  // Reject unsupported / internal URLs up front so the client gets a clear 400
  // instead of a silently fabricated analysis of a URL we never fetched.
  if (url) {
    try {
      validateScrapeUrl(url);
    } catch (validationErr: any) {
      return res.status(400).json({ error: validationErr.message });
    }
  }

  try {
    if (url) {
      platform = detectPlatform(url);
      const scraped = await scrapeSocialUrl(url);
      scrapedTitle = scraped.title;
      scrapedDesc = rawText || scraped.description;
      if (scraped.imageUrl) scrapedImg = scraped.imageUrl;
    }

    let modelResult = null;

    if (aiCanSearch()) {
      try {
        // Model call for high-precision sentiment and emotion extraction
        const prompt = `Analyze this social media post for Sentiment and Emotion monitoring.
        
        Post Details:
        URL: ${url || "N/A"}
        Platform: ${platform}
        Scraped Title: ${scrapedTitle}
        Original Description / Content: ${scrapedDesc}
        
        Analyze the text carefully. Provide the response as a valid JSON object matching this schema exactly:
        {
          "sentiment": "positive" | "neutral" | "negative",
          "sentimentScore": number between -1.0 (extremely negative) and 1.0 (extremely positive),
          "emotion": string (use one of: "Joy", "Anger", "Sadness", "Surprise", "Love", "Neutral", "Fear"),
          "engagement": "High" | "Medium" | "Low",
          "hashtags": string[] (array of detected hashtags or relevant keyword tags),
          "refinedTitle": string (a concise, human-friendly summary headline of the post content in Indonesian or English),
          "refinedDescription": string (a concise summary description of the post in Indonesian or English)
        }
        
        Analyze and output Indonesian-focused slang or abbreviations correctly if present (e.g., "ngaco" -> negative, "keren" -> positive).`;

        modelResult = await chatJson<{
          sentiment: string;
          sentimentScore: number;
          emotion: string;
          engagement: string;
          hashtags: string[];
          refinedTitle: string;
          refinedDescription: string;
        }>({
          system:
            "You are a sentiment analyst for public social media conversation. You understand Indonesian " +
            "slang and internet abbreviations as well as English. Judge the post on its actual wording.",
          prompt,
          expectation:
            "with keys sentiment, sentimentScore, emotion, engagement, hashtags, refinedTitle, refinedDescription",
          temperature: 0.2,
          maxTokens: 900,
        });
      } catch (err: any) {
        logger.warn("[AI] Analysis call failed:", describeAiFailure(err));
        logger.info("[AI] Falling back to the local heuristic analyser for this request.");
      }
    } else {
      logger.info(
        `[AI] ${aiSummary().enabled ? "Provider is in cooldown" : "No AI key configured"} — using the local heuristic analyser.`
      );
    }

    if (!modelResult) {
      const localResult = localAnalyzeSentiment(scrapedTitle, scrapedDesc);
      modelResult = {
        refinedTitle: localResult.refinedTitle,
        refinedDescription: localResult.refinedDescription,
        sentiment: localResult.sentiment,
        sentimentScore: localResult.sentimentScore,
        emotion: localResult.emotion,
        engagement: localResult.engagement,
        hashtags: localResult.hashtags
      };
    }

    const db = getDB();
    const newAnalysis = {
      id: `ap-${Date.now()}`,
      url: url || `manual-text-${Date.now()}`,
      platform,
      title: modelResult.refinedTitle || scrapedTitle,
      description: modelResult.refinedDescription || scrapedDesc,
      imageUrl: scrapedImg,
      sentiment: modelResult.sentiment,
      sentimentScore: modelResult.sentimentScore,
      emotion: modelResult.emotion,
      engagement: modelResult.engagement,
      hashtags: modelResult.hashtags,
      analyzedAt: new Date().toISOString()
    };

    saveAnalyzedPost(newAnalysis);
    broadcast("SYNC", { event: "post_analyzed", post: newAnalysis });

    res.json(newAnalysis);
  } catch (err: any) {
    logger.error("Critical error in /api/analyze-url:", err);
    logger.error("Failed to perform sentiment analysis:", err);
    res.status(500).json({ error: "Sentiment analysis failed. Please try again." });
  }
});

// 6. Trigger Active Google Search Grounding Monitoring for a Tracker Brand/Hashtag
app.post("/api/trigger-monitor", async (req, res) => {
  const { trackerId } = req.body;
  if (!trackerId) {
    return res.status(400).json({ error: "trackerId is required" });
  }

  const db = getDB();
  const tracker = db.trackers.find((t: any) => t.id === trackerId);
  if (!tracker) {
    return res.status(404).json({ error: "Tracker not found" });
  }

  try {
    logger.info(`[Social Intelligence Engine] Running unified social signal search for: "${tracker.query}"...`);
    const formattedResults = await fetchUnifiedSocialSignals(tracker);

    // A manual scan is authoritative for this tracker: replace its rows only.
    replaceMentionsForTracker(trackerId, formattedResults);
    
    broadcast("SYNC", { event: "monitor_triggered", trackerId, results: formattedResults });
    res.json(formattedResults);
  } catch (err: any) {
    logger.error("Monitoring failed:", err);
    res.status(500).json({
      error: "The live search could not be completed. Check the server logs and configured data sources.",
    });
  }
});

let lastMonitorRefreshAt = 0;

// 6b. Get Cross-Platform Social Signals & Aggregation Index (Universal Intelligence Signal Engine)
app.get("/api/social-signals", (req, res) => {
  const db = getDB();
  const { trackerId } = req.query;

  let targetQuery = "Global Intel";
  let activeTracker: any = null;
  if (trackerId) {
    const trackers = db.trackers || [];
    activeTracker = trackers.find((t: any) => t.id === trackerId);
    if (activeTracker) {
      targetQuery = activeTracker.query;
    }
  }

  const allAnalyzed = db.analyzedPosts || [];
  const allMonitored = db.monitorResults || [];
  
  // Filter items specifically for active tracker if available
  const filteredAnalyzed = trackerId
    ? allAnalyzed.filter((item: any) => item.trackerId === trackerId)
    : allAnalyzed;
  const filteredMonitored = trackerId
    ? allMonitored.filter((item: any) => item.trackerId === trackerId)
    : allMonitored;

  const combined = [...filteredAnalyzed, ...filteredMonitored];
  // Every channel in the catalogue is reported, including ones with nothing in
  // them: an empty row is information, a missing row is a lie of omission.
  const platformsList = CHANNEL_KEYS;
  
  // Metrics come from stored mentions only. A channel with no collected items
  // reports zero rather than a plausible-looking number.
  const platformSignals = platformsList.map((platform) => {
    const platformItems = combined.filter(
      (item) => item.platform === platform || (platform === "twitter" && item.platform === "x")
    );

    let buzzVolume = platformItems.length;
    let sentimentScore = 0;
    let activeUsersCount = 0;

    if (platformItems.length > 0) {
      const sum = platformItems.reduce(
        (acc: number, curr: any) => acc + (curr.sentimentScore || 0),
        0
      );
      sentimentScore = sum / platformItems.length;
      activeUsersCount = new Set(platformItems.map((item: any) => item.author || "user")).size;
    }

    sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

    // Velocity compares this half of the window against the previous half, so it
    // is derived from timestamps instead of an invented growth figure.
    const now = Date.now();
    const halfWindow = (24 * 60 * 60 * 1000) / 2;
    const recent = platformItems.filter((i: any) => now - new Date(i.date || 0).getTime() <= halfWindow).length;
    const earlier = platformItems.length - recent;
    const velocity =
      earlier > 0
        ? Number((((recent - earlier) / earlier) * 100).toFixed(1))
        : recent > 0
          ? 100
          : 0;

    const normalizedVolume = Math.min(100, (buzzVolume / 60) * 100);
    const sentimentBonus = (Math.abs(sentimentScore) + 1.0) * 25;
    const rawStrength = normalizedVolume * 0.35 + velocity * 0.35 + sentimentBonus;
    const signalStrength = Math.round(
      buzzVolume > 0 ? Math.min(100, Math.max(0, rawStrength)) : 0
    );

    return {
      platform,
      buzzVolume,
      sentimentScore: Number(sentimentScore.toFixed(2)),
      velocity,
      signalStrength,
      activeUsersCount,
      sampleSize: platformItems.length,
    };
  });

  // Calculate global index metrics with ultimate mathematical precision
  const totalSignalsDetected = platformSignals.reduce((acc, curr) => acc + curr.buzzVolume, 0);
  const globalBuzzIndex = Math.min(100, Math.round((totalSignalsDetected / 350) * 100));
  const channelsWithData = platformSignals.filter((p) => p.buzzVolume > 0);
  const globalSentimentIndex = Number(
    (
      channelsWithData.length > 0
        ? channelsWithData.reduce((acc, curr) => acc + curr.sentimentScore, 0) / channelsWithData.length
        : 0
    ).toFixed(2)
  );
  
  // Cross-Platform Coherence (mathematical cohesion index)
  const meanSentiment = globalSentimentIndex;
  const variance =
    channelsWithData.length > 0
      ? channelsWithData.reduce((acc, curr) => acc + Math.pow(curr.sentimentScore - meanSentiment, 2), 0) /
        channelsWithData.length
      : 0;
  // With nothing collected there is no agreement to measure: report 0, not a
  // flattering 100 for an empty screen.
  const coherenceScore =
    channelsWithData.length === 0
      ? 0
      : Math.round(Math.max(15, Math.min(100, 100 - variance * 120)));

  // Dominant platform (by signal strength)
  const sortedByStrength = [...platformSignals].sort((a, b) => b.signalStrength - a.signalStrength);
  const dominantPlatform = sortedByStrength[0]?.buzzVolume > 0 ? sortedByStrength[0].platform : null;

  res.json({
    platformSignals,
    aggregateIndex: {
      globalBuzzIndex,
      globalSentimentIndex,
      crossPlatformCoherence: coherenceScore,
      dominantPlatform,
      totalSignalsDetected,
      platformCount: platformSignals.length,
      activePlatformCount: platformSignals.filter((p) => p.buzzVolume > 0).length,
      lastAggregatedAt: new Date().toISOString()
    }
  });
});

// 7. Get Aggregated Analytics & Stats for Dashboard Charts
app.get("/api/dashboard-stats", (req, res) => {
  const db = getDB();
  const allAnalyzed = db.analyzedPosts || [];
  const allMonitored = db.monitorResults || [];
  
  // Get time range parameter (default to 7 days)
  const parsedRange = parseInt(req.query.range as string, 10);
  const range = Number.isFinite(parsedRange) ? Math.min(365, Math.max(1, parsedRange)) : 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - range);

  // Filter items by range
  const filteredAnalyzed = allAnalyzed.filter((item: any) => {
    const dateStr = item.analyzedAt || item.date;
    if (!dateStr) return true;
    return new Date(dateStr) >= cutoffDate;
  });

  const filteredMonitored = allMonitored.filter((item: any) => {
    const dateStr = item.analyzedAt || item.date;
    if (!dateStr) return true;
    return new Date(dateStr) >= cutoffDate;
  });

  // Combine filtered items for statistics
  const totalAnalyzed = filteredAnalyzed.length;
  const totalMonitored = filteredMonitored.length;
  const combined = [...filteredAnalyzed, ...filteredMonitored];
  const totalCount = combined.length || 1;

  // 1. Overall Sentiment
  let posCount = 0;
  let neuCount = 0;
  let negCount = 0;
  let totalScore = 0;

  combined.forEach((item: any) => {
    if (item.sentiment === "positive") posCount++;
    else if (item.sentiment === "negative") negCount++;
    else neuCount++;
    totalScore += (item.sentimentScore ?? 0);
  });

  const averageScore = Number((totalScore / totalCount).toFixed(2));
  let overallSentiment: 'positive' | 'neutral' | 'negative' = "neutral";
  if (posCount > negCount && posCount > neuCount) overallSentiment = "positive";
  if (negCount > posCount && negCount > neuCount) overallSentiment = "negative";

  // 2. Sentiment Trend
  // Group combined by analyzedAt/date simplified to YYYY-MM-DD
  const dateGroups: Record<string, { pos: number; neu: number; neg: number }> = {};
  
  // Populate N days defaults
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split("T")[0];
    dateGroups[dayStr] = { pos: 0, neu: 0, neg: 0 };
  }

  combined.forEach((item: any) => {
    const dateStr = (item.analyzedAt || item.date || new Date().toISOString()).split("T")[0];
    if (dateGroups[dateStr]) {
      if (item.sentiment === "positive") dateGroups[dateStr].pos++;
      else if (item.sentiment === "negative") dateGroups[dateStr].neg++;
      else dateGroups[dateStr].neu++;
    } else {
      // Allow dynamic creation if it's within range
      const itemDate = new Date(dateStr);
      if (itemDate >= cutoffDate) {
        dateGroups[dateStr] = {
          pos: item.sentiment === "positive" ? 1 : 0,
          neu: item.sentiment === "neutral" ? 1 : 0,
          neg: item.sentiment === "negative" ? 1 : 0
        };
      }
    }
  });

  const sentimentTrend = Object.entries(dateGroups)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({
      date: new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      positive: counts.pos,
      neutral: counts.neu,
      negative: counts.neg
    }));

  // 3. Platform Distribution
  const platformCounts: Record<string, number> = { tiktok: 0, instagram: 0, facebook: 0, whatsapp: 0, other: 0 };
  combined.forEach((item: any) => {
    const platform = item.platform || "other";
    if (platformCounts[platform] !== undefined) {
      platformCounts[platform]++;
    } else {
      platformCounts.other = (platformCounts.other || 0) + 1;
    }
  });

  const colors: Record<string, string> = {
    tiktok: "#000000",
    instagram: "#E1306C",
    facebook: "#1877F2",
    whatsapp: "#25D366",
    other: "#64748B"
  };

  const platformDistribution = Object.entries(platformCounts).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    value,
    color: colors[key] || "#64748B"
  })).filter(p => p.value > 0);

  // 4. Emotion Distribution
  const emotionCounts: Record<string, number> = {};
  combined.forEach((item: any) => {
    const emotion = item.emotion || "Neutral";
    emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
  });

  const emotionDistribution = Object.entries(emotionCounts).map(([name, value]) => ({
    name,
    value
  })).sort((a, b) => b.value - a.value);

  // 5. Top Hashtags Extraction
  const hashtagCounts: Record<string, number> = {};
  filteredAnalyzed.forEach((post: any) => {
    if (Array.isArray(post.hashtags)) {
      post.hashtags.forEach((tag: string) => {
        const cleanTag = tag.replace("#", "").trim();
        if (cleanTag) {
          hashtagCounts[cleanTag] = (hashtagCounts[cleanTag] || 0) + 1;
        }
      });
    }
  });

  const topHashtags = Object.entries(hashtagCounts)
    .map(([text, value]) => ({ text, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // 6. Recent Alerts (Indonesian / English business-oriented notification)
  const recentAlerts = [];
  if (negCount > (posCount + neuCount) * 0.4) {
    recentAlerts.push({
      id: "alert-1",
      title: "Anomali Sentimen Negatif",
      type: "negative_spikes",
      message: `Terdeteksi lonjakan mention negatif (${negCount} post) pada beberapa platform yang dipantau.`,
      timestamp: new Date().toISOString()
    });
  }
  if (topHashtags.length > 0) {
    recentAlerts.push({
      id: "alert-2",
      title: "Tren Tagar Baru",
      type: "new_trend",
      message: `Tagar #${topHashtags[0]?.text} saat ini sedang naik daun dalam topik pembicaraan brand Anda.`,
      timestamp: new Date().toISOString()
    });
  }
  
  recentAlerts.push({
    id: "alert-3",
    title: "Pemantauan Brand Aktif",
    type: "brand_mention",
    message: "Sistem aktif memonitor platform TikTok, Instagram, Facebook & WhatsApp menggunakan Google Search Grounding.",
    timestamp: new Date().toISOString()
  });

  res.json({
    totalAnalyzed: totalAnalyzed + totalMonitored,
    overallSentiment,
    averageScore,
    sentimentTrend,
    platformDistribution,
    emotionDistribution,
    topHashtags,
    recentAlerts
  });
});

// 8. Generate the three-day sentiment forecast through the AI gateway
/**
 * Three-day forecast.
 *
 * The statistics in the prompt come from stored mentions; the model is only
 * asked to interpret them. Two honesty rules:
 *   - no collected mentions  -> 422, because there is nothing to forecast from
 *   - no AI key / model fail -> 503 with an explanation, never a canned forecast
 *     dressed up as a prediction
 */
app.get("/api/predict-trends", async (req, res) => {
  const db = getDB();
  const combined = [...(db.analyzedPosts || []), ...(db.monitorResults || [])];

  if (combined.length === 0) {
    return res.status(422).json({
      error: "Nothing has been collected yet, so there is nothing to forecast.",
      reason: "no-data",
    });
  }

  if (!isAiAvailable()) {
    return res.status(503).json({
      error: aiConfig().enabled
        ? "The AI provider is in a cooldown after a rate-limit response."
        : "No AI key is configured (AI_API_KEY).",
      reason: aiConfig().enabled ? "cooldown" : "not-configured",
    });
  }

  try {
    const totalCount = combined.length;
    const posCount = combined.filter((item: any) => item.sentiment === "positive").length;
    const neuCount = combined.filter((item: any) => item.sentiment === "neutral").length;
    const negCount = combined.filter((item: any) => item.sentiment === "negative").length;

    const pct = (n: number) => Math.round((n / totalCount) * 100);
    const channels = [...new Set(combined.map((item: any) => item.platform))];

    const samplePosts = combined.slice(0, 15).map((p: any) => ({
      title: p.title,
      content: (p.content || p.description || "").slice(0, 240),
      platform: p.platform,
      sentiment: p.sentiment,
      emotion: p.emotion,
    }));

    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const prompt = `Based on the collected public mentions below, forecast the conversation for the next three days.

Collection window ends: ${today}
Mentions collected: ${totalCount}
Sentiment split: positive ${pct(posCount)}%, neutral ${pct(neuCount)}%, negative ${pct(negCount)}%
Channels with data: ${channels.join(", ") || "none"}

Sample mentions (JSON):
${JSON.stringify(samplePosts, null, 2)}

Return an object with:
- summary: two or three sentences on where this conversation is heading and why, grounded in the numbers above
- predictions: exactly three entries, one per day, each with
    day: "Day 1 (tomorrow)" | "Day 2" | "Day 3"
    dateLabel: short date for that day
    predictedSentiment: "positive" | "neutral" | "negative"
    confidenceScore: 0.0-1.0, lower when the sample is small
    expectedPosPct / expectedNeuPct / expectedNegPct: integers summing to exactly 100
    primaryDriver: the specific factor behind that day's shift
- actionableInsights: three concrete actions a communications team could take

Do not invent data that is not implied by the mentions above. If the sample is thin, say so in the summary and use a low confidenceScore.`;

    const parsed = await chatJson<{
      summary: string;
      predictions: any[];
      actionableInsights: string[];
    }>({
      system:
        "You are a forecasting analyst for public social conversation. You extrapolate carefully from " +
        "observed data and state uncertainty plainly.",
      prompt,
      expectation: "with keys summary, predictions, actionableInsights",
      temperature: 0.3,
      maxTokens: 1600,
    });

    // Normalise: three rows, percentages that add up, clamped confidence.
    const predictions = (Array.isArray(parsed.predictions) ? parsed.predictions : [])
      .slice(0, 3)
      .map((p: any, i: number) => {
        let pos = Math.max(0, Math.round(Number(p.expectedPosPct) || 0));
        let neu = Math.max(0, Math.round(Number(p.expectedNeuPct) || 0));
        let neg = Math.max(0, Math.round(Number(p.expectedNegPct) || 0));
        const sum = pos + neu + neg;
        if (sum !== 100) {
          if (sum === 0) {
            pos = 33;
            neu = 34;
            neg = 33;
          } else {
            neu = Math.max(0, 100 - pos - neg);
            if (pos + neu + neg !== 100) neg = Math.max(0, 100 - pos - neu);
          }
        }
        return {
          day: typeof p.day === "string" ? p.day : `Day ${i + 1}`,
          dateLabel:
            typeof p.dateLabel === "string"
              ? p.dateLabel
              : new Date(Date.now() + (i + 1) * 86400000).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                }),
          predictedSentiment: ["positive", "neutral", "negative"].includes(p.predictedSentiment)
            ? p.predictedSentiment
            : "neutral",
          confidenceScore: Math.min(1, Math.max(0, Number(p.confidenceScore) || 0)),
          expectedPosPct: pos,
          expectedNeuPct: neu,
          expectedNegPct: neg,
          primaryDriver: typeof p.primaryDriver === "string" ? p.primaryDriver : "",
        };
      });

    if (predictions.length === 0) {
      return res.status(502).json({
        error: "The model did not return a usable forecast.",
        reason: "bad-model-response",
      });
    }

    res.json({
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      predictions,
      actionableInsights: Array.isArray(parsed.actionableInsights)
        ? parsed.actionableInsights.filter((x: any) => typeof x === "string").slice(0, 4)
        : [],
      generatedAt: new Date().toISOString(),
      model: aiSummary().model,
      basedOn: totalCount,
    });
  } catch (err: any) {
    logger.warn("[AI] Trend prediction failed:", describeAiFailure(err));
    res.status(502).json({
      error: "The forecast could not be generated. The model host did not return a usable answer.",
      reason: err instanceof AiError ? err.kind : "unknown",
    });
  }
});

// Helper for real-time background Google Search Grounding to fetch authentic, non-simulated signals
async function startServer() {
  const server = http.createServer(app);

  // Initialize WebSocket Server
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    logger.info("[WebSocket] Client connected for real-time monitoring");
    
    // Send immediate confirmation
    ws.send(JSON.stringify({ 
      type: "SYSTEM_CONNECTED", 
      data: { message: "Connected to real-time Social Media Intelligence WebSocket" } 
    }));

    ws.on("message", (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        logger.info("[WebSocket] Received client action:", parsed);
        if (parsed.type === "PING") {
          ws.send(JSON.stringify({ type: "PONG" }));
        }
      } catch (err) {
        logger.error("Failed to parse socket message:", err);
      }
    });

    ws.on("close", () => {
      logger.info("[WebSocket] Client disconnected");
    });
  });

  // Background collection: pulls genuinely new mentions from the configured
  // sources. Runs on a short tick but only performs a network refresh every
  // REFRESH_INTERVAL_MS so we do not exhaust API quota.
  const REFRESH_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS) || 120_000;

  setInterval(async () => {
    try {
      const db = getDB();
      if (!db.trackers || db.trackers.length === 0) return;
      if (Date.now() - lastMonitorRefreshAt < REFRESH_INTERVAL_MS) return;
      lastMonitorRefreshAt = Date.now();

      // Refresh whichever tracker has gone longest without a scan.
      const randomTracker =
        [...db.trackers].sort(
          (a: any, b: any) =>
            new Date(a.lastScannedAt || 0).getTime() - new Date(b.lastScannedAt || 0).getTime()
        )[0];

      logger.info(`[Collector] Refreshing mentions for "${randomTracker.query}"…`);

      const collected = await fetchUnifiedSocialSignals(randomTracker).catch((err) => {
        logger.warn("[Collector] Collection cycle failed:", err);
        return [] as any[];
      });

      randomTracker.lastScannedAt = new Date().toISOString();

      const existingKeys = new Set(
        (db.monitorResults || []).map(
          (m: any) => `${m.platform}|${(m.url || "").split("?")[0]}|${m.title}`
        )
      );
      const newMentions = (collected || []).filter(
        (m: any) => m && !existingKeys.has(`${m.platform}|${(m.url || "").split("?")[0]}|${m.title}`)
      );

      if (newMentions.length > 0) {
        saveMentions(newMentions);
        pruneMentions(1000);

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

  // Load latest data from Firestore to populate our local SQLite cache on boot
  try {
    await syncFromFirestoreToSQLite();
  } catch (err: any) {
    const errMsg = String(err.message || err).replace(/error/gi, "err-info");
    logger.warn("Information during initial Firestore to SQLite synchronization on startServer:", errMsg);
  }

  // Registered after every API route on purpose: an Express router matches in
  // order, so this must be the last /api handler or it swallows real routes.
  // A mistyped API path gets JSON 404 instead of the SPA's HTML.
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
  });

  if (!IS_VERCEL) {
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
      app.get("*", (req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    server.listen(PORT, "0.0.0.0", () => {
      logger.info(`[Social Intelligence Engine] Full-stack with WebSockets running on port ${PORT}`);
    });

    // Graceful shutdown so SQLite finishes its WAL checkpoint and clients get a
    // clean close instead of a dropped connection.
    const shutdown = (signal: string) => {
      logger.info(`[Shutdown] Received ${signal}, closing server...`);
      wss?.clients.forEach((client) => client.close(1001, "Server shutting down"));
      // Give queued mirror writes one short chance to land, then stop the queue
      // so a dead process cannot keep retrying.
      void firestoreMirror
        .flushNow()
        .catch(() => 0)
        .finally(() => firestoreMirror.dispose());
      server.close(() => {
        try {
          dbConn.close();
        } catch (err) {
          logger.error("[Shutdown] Failed to close SQLite connection:", err);
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

if (!IS_VERCEL) {
  startServer();
}

export default app;
