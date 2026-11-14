/**
 * Incremental Firestore mirror.
 *
 * The platform keeps SQLite as its source of truth and mirrors to Firestore so
 * a second instance can pick the data up. The first implementation mirrored by
 * reading every collection, diffing in memory and rewriting every document on
 * each change: a full read + full write per mutation, billed per document.
 *
 * This module inverts that. Callers report the documents they actually changed
 * (`setDoc`, `deleteDoc`); the queue collapses repeats per document, is flushed
 * in debounced batches of at most 200 writes, and never reads Firestore.
 *
 * The Firestore client is injected, so the queue is unit-testable with a stub.
 */

export type MirrorOp = {
  kind: "set" | "delete";
  collection: string;
  id: string;
  data?: Record<string, unknown>;
};

/** The subset of the Firestore client this module needs. */
export interface MirrorDocRef {
  set(data: Record<string, unknown>): void;
  delete(): void;
}
export interface MirrorBatch {
  set(ref: MirrorDocRef, data: Record<string, unknown>): void;
  delete(ref: MirrorDocRef): void;
  commit(): Promise<void>;
}
export interface MirrorDb {
  collection(name: string): { doc(id: string): MirrorDocRef };
  batch(): MirrorBatch;
}

export interface MirrorOptions {
  getDb: () => MirrorDb;
  /** Called once when the mirror cannot work at all (credentials, permissions). */
  onUnavailable: (reason: string) => void;
  onInfo?: (message: string) => void;
  onWarn?: (message: string, err?: unknown) => void;
  /** Maximum writes per commit. Firestore's hard limit is 500. */
  batchSize?: number;
  /** Debounce window for automatic flushes. */
  flushDelayMs?: number;
  /** Hard cap on queued documents; the newest win. */
  maxQueue?: number;
  /** Timers are cleared on shutdown; injected so tests stay deterministic. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface FirestoreMirror {
  queue(op: MirrorOp): void;
  flushNow(): Promise<number>;
  pendingCount(): number;
  pendingDocuments(): string[];
  dispose(): void;
}

const UNAVAILABLE_PATTERNS = [
  "credentials",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "Could not load the default credentials",
  "UNAUTHENTICATED"
];

export function createFirestoreMirror(options: MirrorOptions): FirestoreMirror {
  const {
    getDb,
    onUnavailable,
    onInfo = () => {},
    onWarn = () => {},
    batchSize = 200,
    flushDelayMs = 1500,
    maxQueue = 5000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = options;

  const queue = new Map<string, MirrorOp>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let disposed = false;

  const keyOf = (op: { collection: string; id: string }) => `${op.collection}/${op.id}`;

  function clearTimer() {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function schedule(delay = flushDelayMs) {
    if (disposed) return;
    clearTimer();
    timer = setTimeoutFn(() => {
      timer = null;
      void flushNow();
    }, delay);
    // A pending mirror write must never keep the process alive.
    (timer as any)?.unref?.();
  }

  async function commitOps(ops: MirrorOp[]): Promise<void> {
    if (ops.length === 0) return;
    const db = getDb();
    let batch = db.batch();
    let count = 0;

    for (const op of ops) {
      const ref = db.collection(op.collection).doc(op.id);
      if (op.kind === "delete") batch.delete(ref);
      else batch.set(ref, op.data || {});
      count++;
      if (count >= batchSize) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  }

  async function flushNow(): Promise<number> {
    if (disposed || inFlight || queue.size === 0) return 0;
    inFlight = true;
    clearTimer();

    const ops = [...queue.values()];
    queue.clear();

    try {
      await commitOps(ops);
      onInfo(`[Firebase Sync] Mirrored ${ops.length} changed document(s).`);
      return ops.length;
    } catch (err: any) {
      const message = String(err?.message || err);
      const unavailable = UNAVAILABLE_PATTERNS.some((p) => message.includes(p));
      if (unavailable) {
        queue.clear();
        onUnavailable(message);
      } else {
        // Transient failure: put the documents back (newer ops win) and retry.
        for (const op of ops) {
          if (!queue.has(keyOf(op))) queue.set(keyOf(op), op);
        }
        onWarn(`[Firebase Sync] Mirror batch failed, will retry: ${message}`, err);
        schedule(Math.max(flushDelayMs, 10_000));
      }
      return 0;
    } finally {
      inFlight = false;
    }
  }

  function queueOp(op: MirrorOp) {
    if (disposed || !op?.id || !op.collection) return;
    // One pending operation per document: the newest write wins, and a delete
    // followed by a write collapses into a single set.
    queue.delete(keyOf(op));
    queue.set(keyOf(op), op);

    if (queue.size > maxQueue) {
      // Pathological backlog: drop the oldest, SQLite remains authoritative.
      const excess = queue.size - maxQueue;
      let dropped = 0;
      for (const key of queue.keys()) {
        if (dropped >= excess) break;
        queue.delete(key);
        dropped++;
      }
      onWarn(`[Firebase Sync] Mirror backlog exceeded ${maxQueue}; dropped ${dropped} oldest operation(s).`);
    }

    schedule();
  }

  return {
    queue: queueOp,
    flushNow,
    pendingCount: () => queue.size,
    pendingDocuments: () => [...queue.keys()],
    dispose() {
      disposed = true;
      clearTimer();
      queue.clear();
    }
  };
}

/* ---------------------------------------------------------------------------
 * Document shapes. One definition, so the mirror and the first-boot import
 * cannot drift apart.
 * ------------------------------------------------------------------------- */

export const toTrackerDoc = (t: any) => ({
  type: t.type || "",
  query: t.query || "",
  platforms: t.platforms || [],
  createdAt: t.createdAt || ""
});

export const toAnalyzedDoc = (ap: any) => ({
  url: ap.url || "",
  platform: ap.platform || "",
  title: ap.title || "",
  description: ap.description || "",
  imageUrl: ap.imageUrl || "",
  sentiment: ap.sentiment || "neutral",
  sentimentScore: Number(ap.sentimentScore || 0),
  emotion: ap.emotion || "neutral",
  engagement: ap.engagement || "0",
  hashtags: ap.hashtags || [],
  analyzedAt: ap.analyzedAt || ""
});

export const toMentionDoc = (mr: any) => ({
  platform: mr.platform || "",
  url: mr.url || "",
  author: mr.author || "",
  title: mr.title || "",
  content: mr.content || "",
  sentiment: mr.sentiment || "neutral",
  sentimentScore: Number(mr.sentimentScore || 0),
  emotion: mr.emotion || "neutral",
  engagement: mr.engagement || "0",
  date: mr.date || "",
  trackerId: mr.trackerId || "",
  country: mr.country || "Global",
  latitude: mr.latitude !== undefined && mr.latitude !== null ? Number(mr.latitude) : null,
  longitude: mr.longitude !== undefined && mr.longitude !== null ? Number(mr.longitude) : null
});

/** Builds the first-boot seeding operations for an empty remote database. */
export function seedOperations(data: {
  trackers?: any[];
  analyzedPosts?: any[];
  monitorResults?: any[];
}): MirrorOp[] {
  return [
    ...(data.trackers || []).map((t) => ({ kind: "set" as const, collection: "trackers", id: t.id, data: toTrackerDoc(t) })),
    ...(data.analyzedPosts || []).slice(0, 50).map((ap) => ({ kind: "set" as const, collection: "analyzed_posts", id: ap.id, data: toAnalyzedDoc(ap) })),
    ...(data.monitorResults || []).slice(0, 1000).map((mr) => ({ kind: "set" as const, collection: "monitor_results", id: mr.id, data: toMentionDoc(mr) }))
  ].filter((op) => Boolean(op.id));
}
