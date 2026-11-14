/**
 * Data access for the API.
 *
 * `getDB()` returns the whole dataset in the camelCase shape the aggregation
 * routes expect. The write helpers keep the call sites readable and make the
 * failure mode explicit: a write returns 0/false on failure and the caller
 * decides whether that is worth reporting to the client. Nothing here invents
 * data — a failure yields empty results plus a reason.
 */
import {
  loadDatabase,
  pruneHistories,
  removeTracker,
  mergeTrackerMentions,
  upsertAnalyzedPost,
  upsertMentions,
  upsertTracker,
} from "../lib/supabaseDb.ts";
import { logger } from "./logger.ts";

export async function getDB() {
  const data = await loadDatabase();
  return {
    trackers: data.trackers,
    analyzedPosts: data.analyzedPosts,
    monitorResults: data.monitorResults,
    ok: data.ok,
    error: data.error,
  };
}

/** Records one tracker, or updates it if the id already exists. */
export async function saveTracker(tracker: any): Promise<boolean> {
  try {
    return await upsertTracker(tracker);
  } catch (err) {
    logger.error("[DB] Failed to save tracker:", err);
    return false;
  }
}

/** Removes a tracker together with the mentions it produced. */
export async function deleteTracker(id: string): Promise<boolean> {
  try {
    return await removeTracker(id);
  } catch (err) {
    logger.error("[DB] Failed to delete tracker:", err);
    return false;
  }
}

/** Records one analysed post. */
export async function saveAnalyzedPost(post: any): Promise<boolean> {
  try {
    return await upsertAnalyzedPost(post);
  } catch (err) {
    logger.error("[DB] Failed to save analysed post:", err);
    return false;
  }
}

/** Records many mentions. Returns how many were written. */
export async function saveMentions(mentions: any[]): Promise<number> {
  try {
    return await upsertMentions(mentions);
  } catch (err) {
    logger.error("[DB] Failed to save mentions:", err);
    return 0;
  }
}

/**
 * Merges a scan into a tracker's history.
 *
 * It used to delete everything first, so one bad cycle erased a good one. Now a
 * channel that answers nothing keeps the rows it already had.
 */
export async function mergeMentionsForTracker(trackerId: string, mentions: any[]): Promise<number> {
  try {
    return await mergeTrackerMentions(trackerId, mentions);
  } catch (err) {
    logger.error("[DB] Failed to merge tracker mentions:", err);
    return 0;
  }
}

/** Trims history so the tables cannot grow without bound. */
export async function pruneMentions(max = 1000): Promise<number> {
  try {
    return await pruneHistories(max);
  } catch (err) {
    logger.error("[DB] Failed to prune history:", err);
    return 0;
  }
}
