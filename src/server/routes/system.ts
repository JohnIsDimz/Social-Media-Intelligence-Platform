/**
 * System routes: data sources, the network audit, and /api/health.
 *
 * A health check that says "ok" while the database is unreachable is worse than
 * no health check, so the database state is part of the answer.
 */
import type { Express } from "express";
import { aiConfig, aiSummary } from "../../lib/aiProvider.ts";
import { searchSummary } from "../search.ts";
import { dbStatus } from "../../lib/supabaseDb.ts";
import { buildChannelHealth } from "../network-audit.ts";

export function registerSystemRoutes(app: Express) {
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

app.get("/api/health", async (_req, res) => {
  // A health check that says "ok" while the database is unreachable is worse
  // than no health check, so the database state is part of the answer.
  const db = dbStatus();
  const database = {
    provider: "supabase",
    configured: db.configured,
    connected: db.connected,
    reason: db.reason,
    detail: db.detail,
    projectHost: db.projectHost,
    lastCheckedAt: db.lastCheckedAt,
  };
  const degraded = db.configured && !db.connected;
  res.status(degraded ? 503 : 200).json({
    status: degraded ? "degraded" : "ok",
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version || "unknown",
    database,
    ai: aiSummary(),
    search: searchSummary(),
    collectors: {
      grounding: aiConfig().enabled,
      reddit: true,
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
      twitter: Boolean(process.env.TWITTER_BEARER_TOKEN),
    },
    timestamp: new Date().toISOString(),
  });
});
}
