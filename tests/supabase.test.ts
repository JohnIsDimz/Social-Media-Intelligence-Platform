/**
 * Supabase data-layer tests. Run with: npm test
 *
 * These run the real code in src/lib/supabaseDb.ts against a stub PostgREST
 * server on localhost: no Supabase project, no credentials, no network.
 *
 * What matters here is the contract the rest of the app relies on:
 *   - reads return rows in the camelCase shape the API/UI expect,
 *   - a write is an upsert keyed on id (idempotent),
 *   - an unreachable or unconfigured database yields empty data plus a reason,
 *     never fabricated rows.
 */
import http from "node:http";
import { createClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ harness */

type Request = { method: string; path: string; query: URLSearchParams; body: any };
const requests: Request[] = [];
let mode: "ok" | "empty-tables" | "down" = "ok";
let server: http.Server;
let port = 0;

// In-memory tables used by the "ok" mode.
const tables: Record<string, any[]> = {
  trackers: [],
  analyzed_posts: [],
  monitor_results: []
};

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : null;
        requests.push({ method: req.method || "GET", path: url.pathname, query: url.searchParams, body });

        if (mode === "down") {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ message: "connection refused" }));
        }
        if (mode === "empty-tables") {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({ message: "relation \"public.trackers\" does not exist", code: "42P01" })
          );
        }

        // /rest/v1/<table>
        const table = url.pathname.replace("/rest/v1/", "");
        const rows = tables[table] || [];
        const method = req.method || "GET";

        if (method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(rows));
        }
        if (method === "POST") {
          const incoming = Array.isArray(body) ? body : [body];
          for (const row of incoming) {
            const i = rows.findIndex((r) => r.id === row.id);
            if (i >= 0) rows[i] = { ...rows[i], ...row };
            else rows.push({ ...row });
          }
          res.writeHead(201, { "content-type": "application/json" });
          return res.end(JSON.stringify(incoming));
        }
        if (method === "DELETE") {
          const id = url.searchParams.get("id")?.replace("eq.", "");
          const trackerId = url.searchParams.get("tracker_id")?.replace("eq.", "");
          const inIds = url.searchParams.get("id")?.startsWith("in.(")
            ? url.searchParams.get("id")!.slice(4, -1).split(",")
            : null;
          for (let i = rows.length - 1; i >= 0; i--) {
            if (id && rows[i].id === id) rows.splice(i, 1);
            else if (trackerId && rows[i].tracker_id === trackerId) rows.splice(i, 1);
            else if (inIds && inIds.includes(rows[i].id)) rows.splice(i, 1);
          }
          res.writeHead(204);
          return res.end();
        }
        res.writeHead(405).end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
}

/* -------------------------------------------------------------------- tests */

async function main() {
  await startServer();

  const db = await import("../src/lib/supabaseDb");

  // --- not configured -----------------------------------------------------
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  {
    const info = db.dbConfigSummary();
    check("no env reports unconfigured", info.configured === false);
    const res = await db.listTrackers();
    check("unconfigured read is empty, not invented", res.data.length === 0 && res.ok === false);
    check("unconfigured has a reason", String(res.error).includes("not configured"));
    const wrote = await db.upsertTracker({ id: "t0", type: "brand", query: "x", platforms: [], createdAt: "" });
    check("unconfigured write returns false", wrote === false);
  }

  // --- configured but unreachable ----------------------------------------
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-not-real";
  mode = "down";
  {
    const res = await db.listMentions();
    check("unreachable read is empty", res.data.length === 0 && res.ok === false);
    const status = await db.pingDatabase();
    check("ping marks unreachable", status.connected === false && status.reason === "unreachable", String(status.detail).slice(0, 40));
  }

  // --- schema not applied -------------------------------------------------
  mode = "empty-tables";
  {
    const status = await db.pingDatabase();
    check("missing tables reported as schema-missing", status.reason === "schema-missing", String(status.reason));
  }

  // --- happy path ---------------------------------------------------------
  mode = "ok";
  requests.length = 0;
  {
    const tracker = {
      id: "t-1",
      type: "brand",
      query: "Kopi Kenangan",
      platforms: ["reddit", "news"],
      createdAt: "2026-01-01T00:00:00.000Z"
    };
    check("tracker write succeeds", (await db.upsertTracker(tracker)) === true);

    const post = {
      id: "ap-1",
      url: "https://example.test/a",
      platform: "reddit",
      title: "t",
      description: "d",
      imageUrl: "",
      sentiment: "positive",
      sentimentScore: 0.6,
      emotion: "Joy",
      engagement: "High",
      hashtags: ["#a"],
      analyzedAt: "2026-01-02T00:00:00.000Z"
    };
    check("analysed post write succeeds", (await db.upsertAnalyzedPost(post)) === true);

    const mention = {
      id: "m-1",
      platform: "reddit",
      url: "https://example.test/m",
      author: "someone",
      title: "m",
      content: "c",
      sentiment: "neutral",
      sentimentScore: 0.1,
      emotion: "Neutral",
      engagement: "Low",
      date: "2026-01-03T00:00:00.000Z",
      trackerId: "t-1",
      country: "ID",
      latitude: -6.2,
      longitude: 106.8
    };
    check("mention write succeeds", (await db.upsertMentions([mention])) === 1);

    // Writing the same rows again must not duplicate them.
    await db.upsertTracker(tracker);
    await db.upsertMentions([mention]);
    check("upsert is idempotent", tables.trackers.length === 1 && tables.monitor_results.length === 1,
      `trackers=${tables.trackers.length} mentions=${tables.monitor_results.length}`);

    // Row shape: the API contract is camelCase, the columns are snake_case.
    const loaded = await db.loadDatabase();
    check("load returns camelCase rows", loaded.trackers[0]?.createdAt === "2026-01-01T00:00:00.000Z");
    check("arrays survive the round trip", Array.isArray(loaded.trackers[0]?.platforms) && loaded.trackers[0].platforms.length === 2);
    check("numbers survive the round trip", loaded.monitorResults[0]?.latitude === -6.2);
    check("mentions carry trackerId", loaded.monitorResults[0]?.trackerId === "t-1");
    check("load reports ok", loaded.ok === true);

    // The wire format really uses snake_case columns.
    const postBody = requests.find((r) => r.method === "POST")?.body;
    const firstWrite = Array.isArray(postBody) ? postBody[0] : postBody;
    check("writes use snake_case columns", "created_at" in firstWrite && !("createdAt" in firstWrite),
      Object.keys(firstWrite).slice(0, 3).join(","));

    // Deleting a tracker removes its mentions first.
    check("tracker delete succeeds", (await db.removeTracker("t-1")) === true);
    check("tracker delete removes mentions too", tables.monitor_results.length === 0 && tables.trackers.length === 0,
      `mentions=${tables.monitor_results.length} trackers=${tables.trackers.length}`);

    // A manual scan replaces the tracker's rows rather than appending.
    await db.replaceTrackerMentions("t-2", [
      { ...mention, id: "m-2" },
      { ...mention, id: "m-3" }
    ]);
    check("replace stores the new rows", tables.monitor_results.length === 2);
    await db.replaceTrackerMentions("t-2", [{ ...mention, id: "m-4" }]);
    check("replace removes the previous rows", tables.monitor_results.length === 1 && tables.monitor_results[0].id === "m-4");

    // Pruning asks for the ids past the limit and deletes only those.
    for (let i = 0; i < 5; i++) {
      tables.monitor_results.push({ id: `old-${i}`, tracker_id: "t-2", date: `2020-01-0${i + 1}` });
    }
    const before = tables.monitor_results.length;
    requests.length = 0;
    await db.pruneHistories(3);
    const pruneCall = requests.find((r) => r.method === "DELETE" && r.path.endsWith("monitor_results"));
    check("prune deletes by id list only", Boolean(pruneCall && pruneCall.query.get("id")?.startsWith("in.(")),
      pruneCall ? pruneCall.query.get("id")?.slice(0, 24) : "no delete call");
    check("prune leaves the database smaller", tables.monitor_results.length < before, `${before} -> ${tables.monitor_results.length}`);
  }

  // --- batching -----------------------------------------------------------
  requests.length = 0;
  {
    const many = Array.from({ length: 450 }, (_, i) => ({
      id: `bulk-${i}`, platform: "news", url: "u", author: "a", title: "t", content: "c",
      sentiment: "neutral", sentimentScore: 0, emotion: "Neutral", engagement: "Low",
      date: "2026-01-01T00:00:00.000Z", trackerId: "t-3", country: "Global", latitude: null, longitude: null
    }));
    await db.upsertMentions(many);
    const postBatches = requests.filter((r) => r.method === "POST");
    check("450 mentions split into 3 requests", postBatches.length === 3, postBatches.length + " requests");
    check("no request exceeds 200 rows", postBatches.every((r) => (Array.isArray(r.body) ? r.body.length : 1) <= 200),
      postBatches.map((r) => (Array.isArray(r.body) ? r.body.length : 1)).join("+"));
  }

  server.close();
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
