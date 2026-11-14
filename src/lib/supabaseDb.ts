/**
 * Supabase storage layer — the only persistence in the platform.
 *
 * There is no local database and no Firebase: every read and write goes through
 * the Supabase REST API (PostgREST) with the service-role key. The schema lives
 * in `supabase/schema.sql`.
 *
 * Design notes:
 *
 *  - Writes are upserts keyed on the row id, so re-running a write is harmless.
 *  - A failed query never throws at the caller: data functions return empty
 *    results and set a reason, because the UI must show "database unreachable"
 *    rather than invent numbers.
 *  - The client is created lazily and re-checked, so a missing environment
 *    variable is reported through /api/health instead of crashing the process.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DbStatus = {
  configured: boolean;
  connected: boolean;
  /** Short machine-readable reason when not usable. */
  reason: "not-configured" | "unreachable" | "schema-missing" | null;
  detail: string | null;
  lastCheckedAt: string | null;
  projectHost: string | null;
};

const status: DbStatus = {
  configured: false,
  connected: false,
  reason: "not-configured",
  detail: null,
  lastCheckedAt: null,
  projectHost: null
};

let client: SupabaseClient | null = null;
let clientKey = "";

function envConfig() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    "";
  return { url, key };
}

export function dbConfigSummary() {
  const { url, key } = envConfig();
  return {
    configured: Boolean(url && key),
    projectHost: url ? safeHost(url) : null,
    // The key itself is never exposed; only whether one is present and its kind.
    keyType: !key ? "none" : key.startsWith("sb_secret") || key.length > 200 ? "service-role" : "anon-or-publishable"
  };
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function getClient(): SupabaseClient | null {
  const { url, key } = envConfig();
  if (!url || !key) {
    status.configured = false;
    status.connected = false;
    status.reason = "not-configured";
    return null;
  }
  status.configured = true;
  status.projectHost = safeHost(url);
  const cacheKey = `${url}|${key.slice(-8)}`;
  if (!client || clientKey !== cacheKey) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "smip" } }
    });
    clientKey = cacheKey;
  }
  return client;
}

export function dbStatus(): DbStatus {
  return { ...status };
}

export function markReachable() {
  status.connected = true;
  status.reason = null;
  status.detail = null;
  status.lastCheckedAt = new Date().toISOString();
}

export function markUnreachable(reason: DbStatus["reason"], detail: string) {
  status.connected = false;
  status.reason = reason;
  status.detail = detail;
  status.lastCheckedAt = new Date().toISOString();
}

/** True when a result looks like "this table does not exist yet". */
function errorMessage(error: any): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSchemaError(message: string) {
  return (
    message.includes("does not exist") ||
    message.includes("Could not find the table") ||
    message.includes("relation") ||
    message.includes("schema cache")
  );
}

export type DbResult<T> = { data: T; ok: boolean; error: string | null };

/**
 * Runs a Supabase query and normalises failures.
 *
 * The callback receives a live client; if the database is not configured or
 * answers with an error, `ok` is false and `data` falls back to `fallback`.
 */
export async function query<T>(
  run: (sb: SupabaseClient) => PromiseLike<{ data: T | null; error: any }>,
  fallback: T,
  label: string
): Promise<DbResult<T>> {
  const sb = getClient();
  if (!sb) {
    return { data: fallback, ok: false, error: "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." };
  }
  try {
    const { data, error } = await run(sb);
    if (error) {
      const message = errorMessage(error);
      markUnreachable(isSchemaError(message) ? "schema-missing" : "unreachable", message);
      logDbIssue(label, message);
      return { data: fallback, ok: false, error: message };
    }
    markReachable();
    return { data: (data ?? fallback) as T, ok: true, error: null };
  } catch (err: any) {
    const message = errorMessage(err);
    markUnreachable("unreachable", message);
    logDbIssue(label, message);
    return { data: fallback, ok: false, error: message };
  }
}

let lastLogged = "";
function logDbIssue(label: string, message: string) {
  // A broken database would otherwise log on every request.
  const signature = `${label}:${message}`;
  if (signature === lastLogged) return;
  lastLogged = signature;
  console.warn(`[Supabase] ${label} failed: ${message}`);
}

/** Checks the connection and whether the schema has been applied. */
export async function pingDatabase(): Promise<DbStatus> {
  const sb = getClient();
  if (!sb) return dbStatus();
  try {
    // A GET is used rather than a HEAD: PostgREST sends no body on HEAD, and
    // supabase-js cannot tell a 404 for a missing table from an empty result.
    const { error } = await sb.from("trackers").select("id").limit(1);
    if (error) {
      const message = errorMessage(error);
      markUnreachable(isSchemaError(message) ? "schema-missing" : "unreachable", message);
    } else {
      markReachable();
    }
  } catch (err: any) {
    markUnreachable("unreachable", errorMessage(err));
  }
  return dbStatus();
}

/* ---------------------------------------------------------------------------
 * Row mapping. The database uses snake_case columns; the API and UI keep the
 * camelCase shape they have always used, so this is the only translation point.
 * ------------------------------------------------------------------------- */

export type Tracker = {
  id: string;
  type: string;
  query: string;
  platforms: string[];
  createdAt: string;
};

export type AnalyzedPost = {
  id: string;
  url: string;
  platform: string;
  title: string;
  description: string;
  imageUrl: string;
  sentiment: string;
  sentimentScore: number;
  emotion: string;
  engagement: string;
  hashtags: string[];
  analyzedAt: string;
};

export type Mention = {
  id: string;
  platform: string;
  url: string;
  author: string;
  title: string;
  content: string;
  sentiment: string;
  sentimentScore: number;
  emotion: string;
  engagement: string;
  date: string;
  trackerId: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
};

const trackerRow = (t: any) => ({
  id: t.id,
  type: t.type || "brand",
  query: t.query || "",
  platforms: t.platforms || [],
  created_at: t.createdAt || new Date().toISOString()
});

const analyzedRow = (ap: any) => ({
  id: ap.id,
  url: ap.url || "",
  platform: ap.platform || "other",
  title: ap.title || "",
  description: ap.description || "",
  image_url: ap.imageUrl || "",
  sentiment: ap.sentiment || "neutral",
  sentiment_score: Number(ap.sentimentScore || 0),
  emotion: ap.emotion || "Neutral",
  engagement: ap.engagement || "Low",
  hashtags: ap.hashtags || [],
  analyzed_at: ap.analyzedAt || new Date().toISOString()
});

const mentionRow = (mr: any) => ({
  id: mr.id,
  platform: mr.platform || "unknown",
  url: mr.url || "",
  author: mr.author || "",
  title: mr.title || "",
  content: mr.content || "",
  sentiment: mr.sentiment || "neutral",
  sentiment_score: Number(mr.sentimentScore || 0),
  emotion: mr.emotion || "Neutral",
  engagement: mr.engagement || "Low",
  date: mr.date || new Date().toISOString(),
  tracker_id: mr.trackerId || "",
  country: mr.country || "Global",
  latitude: mr.latitude === undefined || mr.latitude === null ? null : Number(mr.latitude),
  longitude: mr.longitude === undefined || mr.longitude === null ? null : Number(mr.longitude)
});

export const fromTrackerRow = (r: any): Tracker => ({
  id: String(r.id),
  type: r.type || "brand",
  query: r.query || "",
  platforms: Array.isArray(r.platforms) ? r.platforms : [],
  createdAt: r.created_at || ""
});

export const fromAnalyzedRow = (r: any): AnalyzedPost => ({
  id: String(r.id),
  url: r.url || "",
  platform: r.platform || "other",
  title: r.title || "",
  description: r.description || "",
  imageUrl: r.image_url || "",
  sentiment: r.sentiment || "neutral",
  sentimentScore: Number(r.sentiment_score || 0),
  emotion: r.emotion || "Neutral",
  engagement: r.engagement || "Low",
  hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
  analyzedAt: r.analyzed_at || ""
});

export const fromMentionRow = (r: any): Mention => ({
  id: String(r.id),
  platform: r.platform || "unknown",
  url: r.url || "",
  author: r.author || "",
  title: r.title || "",
  content: r.content || "",
  sentiment: r.sentiment || "neutral",
  sentimentScore: Number(r.sentiment_score || 0),
  emotion: r.emotion || "Neutral",
  engagement: r.engagement || "Low",
  date: r.date || "",
  trackerId: r.tracker_id || "",
  country: r.country || "Global",
  latitude: r.latitude === null || r.latitude === undefined ? null : Number(r.latitude),
  longitude: r.longitude === null || r.longitude === undefined ? null : Number(r.longitude)
});

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------- */

export const MAX_MENTIONS = 1000;
export const MAX_ANALYZED = 200;

export async function listTrackers(): Promise<DbResult<Tracker[]>> {
  const res = await query<any[]>(
    (sb) => sb.from("trackers").select("*").order("created_at", { ascending: true }),
    [],
    "list trackers"
  );
  return { ...res, data: (res.data || []).map(fromTrackerRow) };
}

export async function listAnalyzedPosts(): Promise<DbResult<AnalyzedPost[]>> {
  const res = await query<any[]>(
    (sb) =>
      sb
        .from("analyzed_posts")
        .select("*")
        .order("analyzed_at", { ascending: false })
        .limit(MAX_ANALYZED),
    [],
    "list analyzed posts"
  );
  return { ...res, data: (res.data || []).map(fromAnalyzedRow) };
}

export async function listMentions(trackerId?: string): Promise<DbResult<Mention[]>> {
  const res = await query<any[]>(
    (sb) => {
      let q = sb.from("monitor_results").select("*");
      if (trackerId) q = q.eq("tracker_id", trackerId);
      return q.order("date", { ascending: false }).limit(MAX_MENTIONS);
    },
    [],
    "list mentions"
  );
  return { ...res, data: (res.data || []).map(fromMentionRow) };
}

/**
 * Everything the dashboard needs, in three parallel queries.
 * `ok` is false when any part failed; the UI then shows the empty state with a
 * reason instead of a partial picture presented as complete.
 */
export async function loadDatabase(): Promise<{
  trackers: Tracker[];
  analyzedPosts: AnalyzedPost[];
  monitorResults: Mention[];
  ok: boolean;
  error: string | null;
}> {
  const [trackers, analyzedPosts, monitorResults] = await Promise.all([
    listTrackers(),
    listAnalyzedPosts(),
    listMentions()
  ]);
  return {
    trackers: trackers.data,
    analyzedPosts: analyzedPosts.data,
    monitorResults: monitorResults.data,
    ok: trackers.ok && analyzedPosts.ok && monitorResults.ok,
    error: trackers.error || analyzedPosts.error || monitorResults.error
  };
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------- */

export async function upsertTracker(t: Tracker): Promise<boolean> {
  if (!t?.id) return false;
  const res = await query<any>((sb) => sb.from("trackers").upsert(trackerRow(t)), null, "save tracker");
  return res.ok;
}

/** Deletes a tracker and its mentions. Mentions go first, like a cascade. */
export async function removeTracker(id: string): Promise<boolean> {
  const mentions = await query<any>((sb) => sb.from("monitor_results").delete().eq("tracker_id", id), null, "delete tracker mentions");
  const tracker = await query<any>((sb) => sb.from("trackers").delete().eq("id", id), null, "delete tracker");
  return mentions.ok && tracker.ok;
}

export async function upsertAnalyzedPost(post: AnalyzedPost): Promise<boolean> {
  if (!post?.id) return false;
  const res = await query<any>((sb) => sb.from("analyzed_posts").upsert(analyzedRow(post)), null, "save analyzed post");
  return res.ok;
}

export async function upsertMentions(mentions: Mention[]): Promise<number> {
  const rows = (mentions || []).filter((m) => m?.id).map(mentionRow);
  if (rows.length === 0) return 0;
  let written = 0;
  // PostgREST payloads stay small: 200 rows per request.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await query<any>((sb) => sb.from("monitor_results").upsert(chunk), null, "save mentions");
    if (!res.ok) break;
    written += chunk.length;
  }
  return written;
}

/** Replaces everything collected for one tracker: the scan is authoritative. */
export async function replaceTrackerMentions(trackerId: string, mentions: Mention[]): Promise<number> {
  const removed = await query<any>(
    (sb) => sb.from("monitor_results").delete().eq("tracker_id", trackerId),
    null,
    "clear tracker mentions"
  );
  if (!removed.ok) return 0;
  return upsertMentions((mentions || []).map((m) => ({ ...m, trackerId })));
}

/** Trim histories so the database cannot grow without bound. */
export async function pruneHistories(maxMentions = MAX_MENTIONS, maxAnalyzed = MAX_ANALYZED): Promise<number> {
  const kept = await query<any[]>(
    (sb) =>
      sb
        .from("monitor_results")
        .select("id")
        .order("date", { ascending: false })
        .range(maxMentions, maxMentions + 499),
    [],
    "list mentions to prune"
  );
  let removed = 0;
  if (kept.ok && kept.data.length > 0) {
    const ids = kept.data.map((r) => r.id);
    const res = await query<any>((sb) => sb.from("monitor_results").delete().in("id", ids), null, "prune mentions");
    if (res.ok) removed += ids.length;
  }

  const stalePosts = await query<any[]>(
    (sb) =>
      sb
        .from("analyzed_posts")
        .select("id")
        .order("analyzed_at", { ascending: false })
        .range(maxAnalyzed, maxAnalyzed + 499),
    [],
    "list posts to prune"
  );
  if (stalePosts.ok && stalePosts.data.length > 0) {
    const ids = stalePosts.data.map((r) => r.id);
    const res = await query<any>((sb) => sb.from("analyzed_posts").delete().in("id", ids), null, "prune posts");
    if (res.ok) removed += ids.length;
  }
  return removed;
}
