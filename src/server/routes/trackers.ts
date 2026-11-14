/**
 * Tracker routes.
 *
 * A tracker is one keyword or brand being watched, with the channels it should
 * be collected from. Writes touch only the row they change.
 */
import type { Express } from "express";
import { CHANNEL_KEYS, channelSpec } from "../../channels.ts";
import { broadcast } from "../realtime.ts";
import { deleteTracker, getDB, saveTracker } from "../data.ts";

export function registerTrackerRoutes(app: Express) {
// 1. Get Trackers
app.get("/api/trackers", async (_req, res) => {
  const db = await getDB();
  if (!db.ok) {
    // Empty data with a reason, never fabricated rows.
    res.setHeader("X-Data-Status", "unavailable");
    return res.json([]);
  }
  res.json(db.trackers);
});

// 2. Add Tracker
const ALLOWED_TRACKER_TYPES = ["brand", "hashtag", "url", "topic", "product"];
const ALLOWED_PLATFORMS = [...CHANNEL_KEYS, "x"];

/** Handles a tracker may name for channels that have no keyword search. */
const MAX_ACCOUNTS = 5;
const ACCOUNT_RE = /^[A-Za-z0-9_]{2,64}$/;

function cleanAccounts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "").replace(/\/+$/, ""))
        .filter((a) => ACCOUNT_RE.test(a))
    ),
  ].slice(0, MAX_ACCOUNTS);
}

app.post("/api/trackers", async (req, res) => {
  const { type, query, platforms, accounts } = req.body || {};
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

  const newTracker = {
    id: `t-${Date.now()}`,
    type,
    query: cleanQuery,
    platforms: cleanPlatforms.length > 0 ? cleanPlatforms : CHANNEL_KEYS.filter((k) => channelSpec(k)?.kind === "api"),
    accounts: cleanAccounts(accounts),
    createdAt: new Date().toISOString()
  };

  // A tracker that was not stored must not be reported as created: the UI would
  // show it until the next poll made it vanish. Fail loudly instead.
  const saved = await saveTracker(newTracker);
  if (!saved) {
    return res.status(503).json({
      error: "The tracker could not be saved. The database is not writable right now.",
      reason: "storage-unavailable",
    });
  }
  broadcast("SYNC", { event: "tracker_added", tracker: newTracker });
  res.status(201).json(newTracker);
});

// 3. Delete Tracker
app.delete("/api/trackers/:id", async (req, res) => {
  const { id } = req.params;
  
  // Same rule as creation: a deletion that did not reach storage is not done.
  const removed = await deleteTracker(id);
  if (!removed) {
    return res.status(503).json({
      error: "The tracker could not be deleted. The database is not writable right now.",
      reason: "storage-unavailable",
    });
  }
  broadcast("SYNC", { event: "tracker_deleted", trackerId: id });
  res.json({ success: true, message: "Tracker deleted successfully" });
});

// 4. Get Analyzed Posts
app.get("/api/analyzed-posts", async (_req, res) => {
  const db = await getDB();
  res.json(db.analyzedPosts);
});

// 4b. Get Monitor Results
app.get("/api/monitor-results", async (req, res) => {
  const db = await getDB();
  const { trackerId } = req.query;
  if (trackerId) {
    const filtered = db.monitorResults.filter((mr: any) => mr.trackerId === trackerId);
    return res.json(filtered);
  }
  res.json(db.monitorResults);
});

// 5. Analyze URL or Text directly
}
