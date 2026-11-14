/**
 * Firestore mirror tests. Run with: npm test
 *
 * These exercise the queue with a stub Firestore client: no network, no
 * credentials, no emulator. The behaviour that matters is which documents are
 * written for a given set of local changes.
 */
import { createFirestoreMirror, seedOperations } from "../src/lib/firestoreMirror";

type Call = { op: string; path: string; data?: any };

function fakeDb(batches: Call[][], opts: { failFirstCommit?: boolean; credentialError?: boolean } = {}) {
  let fail = Boolean(opts.failFirstCommit);
  return {
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
    batch: () => {
      const calls: Call[] = [];
      batches.push(calls);
      return {
        set: (ref: any, data: any) => calls.push({ op: "set", path: ref.path, data }),
        delete: (ref: any) => calls.push({ op: "delete", path: ref.path }),
        commit: async () => {
          if (opts.credentialError) throw new Error("Could not load the default credentials");
          if (fail) { fail = false; throw new Error("UNAVAILABLE: transient"); }
        }
      };
    }
  } as any;
}

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);
};

(async () => {
  // A burst of changes to the same document is one write, not one per change.
  {
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches), onUnavailable: () => {} });
    for (let i = 0; i < 5; i++) m.queue({ kind: "set", collection: "monitor_results", id: "m1", data: { v: i } });
    for (let i = 0; i < 3; i++) m.queue({ kind: "set", collection: "monitor_results", id: `n${i}`, data: {} });
    check("queue collapses repeats per document", m.pendingCount() === 4, `${m.pendingCount()} pending`);
    const written = await m.flushNow();
    const all = batches.flat();
    check("only touched documents are written", written === 4 && all.length === 4, `${all.length} ops`);
    check("newest value wins", all.find((c) => c.path === "monitor_results/m1")?.data.v === 4);
    m.dispose();
  }

  // A document created and then removed is a single delete.
  {
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches), onUnavailable: () => {} });
    m.queue({ kind: "set", collection: "trackers", id: "t1", data: {} });
    m.queue({ kind: "delete", collection: "trackers", id: "t1" });
    await m.flushNow();
    const all = batches.flat();
    check("set then delete collapses to delete", all.length === 1 && all[0].op === "delete");
    m.dispose();
  }

  // Large batches are split at the commit limit.
  {
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches), onUnavailable: () => {}, batchSize: 200 });
    for (let i = 0; i < 450; i++) m.queue({ kind: "set", collection: "monitor_results", id: `x${i}`, data: { i } });
    await m.flushNow();
    check("450 documents need 3 commits", batches.length === 3, batches.map((b) => b.length).join("+"));
    check("no commit exceeds the batch size", batches.every((b) => b.length <= 200) && batches.flat().length === 450);
    m.dispose();
  }

  // A transient failure must not lose the change.
  {
    const batches: Call[][] = [];
    // One client instance: the failure must be consumed, not recreated per flush.
    const db = fakeDb(batches, { failFirstCommit: true });
    const m = createFirestoreMirror({ getDb: () => db, onUnavailable: () => {}, flushDelayMs: 5 });
    m.queue({ kind: "set", collection: "trackers", id: "t9", data: { q: "x" } });
    const first = await m.flushNow();
    check("transient failure keeps the operation", first === 0 && m.pendingCount() === 1);
    const second = await m.flushNow();
    check("retry writes it", second === 1 && m.pendingCount() === 0);
    m.dispose();
  }

  // Missing credentials disable the mirror instead of retrying forever.
  {
    const reasons: string[] = [];
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches, { credentialError: true }), onUnavailable: (r) => reasons.push(r) });
    m.queue({ kind: "set", collection: "trackers", id: "a", data: {} });
    await m.flushNow();
    check("credential failure reports unavailable once", reasons.length === 1);
    check("queue is drained when unavailable", m.pendingCount() === 0);
    m.dispose();
  }

  // The backlog cap keeps the newest documents.
  {
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches), onUnavailable: () => {}, maxQueue: 10 });
    for (let i = 0; i < 25; i++) m.queue({ kind: "set", collection: "monitor_results", id: `b${i}`, data: { i } });
    check("backlog capped", m.pendingCount() === 10, `${m.pendingCount()} pending`);
    check("newest document kept", m.pendingDocuments().includes("monitor_results/b24"));
    m.dispose();
  }

  // Nothing is written after shutdown.
  {
    const batches: Call[][] = [];
    const m = createFirestoreMirror({ getDb: () => fakeDb(batches), onUnavailable: () => {} });
    m.queue({ kind: "set", collection: "trackers", id: "z", data: {} });
    m.dispose();
    const n = await m.flushNow();
    check("dispose prevents later writes", n === 0 && batches.length === 0);
  }

  // First-boot seeding is capped and skips rows without an id.
  {
    const ops = seedOperations({
      trackers: [{ id: "t1", query: "a" }, { query: "no id" }],
      analyzedPosts: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}` })),
      monitorResults: Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}` }))
    });
    check("seed capped to 50 posts and 1000 mentions", ops.length === 1 + 50 + 1000, `${ops.length} ops`);
    check("seed drops rows without an id", !ops.some((o) => !o.id));
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
