/**
 * Route-level tests for the split server.
 *
 * `server.ts` registers its routes at import time, so importing it into the test
 * process is enough to exercise them: no listen(), no port, and the network is
 * never touched because SUPABASE_URL points at a closed local port.
 */
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.TRUST_PROXY = "false";
process.env.NODE_ENV = "test";
process.env.SMIP_NO_LISTEN = "1";

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

async function main() {
  const { default: app } = await import("../server");

  // Express 4: walk the registered stack instead of trying to bind a port.
  const layers: any[] = (app as any)._router?.stack || [];
  const routes = layers
    .filter((l) => l.route)
    .map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));

  const required = [
    "/api/health",
    "/api/data-sources",
    "/api/channel-health",
    "/api/trackers",
    "/api/trackers/:id",
    "/api/analyzed-posts",
    "/api/monitor-results",
    "/api/analyze-url",
    "/api/trigger-monitor",
    "/api/social-signals",
    "/api/dashboard-stats",
    "/api/predict-trends",
  ];
  const paths = routes.map((r) => r.path);
  const missing = required.filter((p) => !paths.includes(p));
  check("every API route is registered", missing.length === 0, missing.join(", ") || `${routes.length} routes`);

  // The /api catch-all returns a JSON 404 for unknown API paths. It must be
  // mounted AFTER the real routes, or it swallows them — that bug shipped once.
  // Identify it precisely: a handler mounted on the plain /api prefix, with no
  // route object (routes create one; app.use("/api", handler) does not).
  const apiPrefixLayers = layers
    .map((l, i) => ({
      i,
      isRoute: Boolean(l.route),
      path: l.route?.path as string | undefined,
      re: String(l.regexp || "")
    }))
    .filter((x) => x.re.includes("api"));
  // The catch-all is mounted on exactly the /api prefix. The rate limiter and the
  // token guard sit on the same prefix but come before the routes; the catch-all
  // is the LAST non-route layer on that prefix.
  const apiNonRoute = apiPrefixLayers.filter((x) => !x.isRoute);
  const catchAll = apiNonRoute[apiNonRoute.length - 1];
  const middlewareBeforeRoutes = apiNonRoute.slice(0, -1);
  check(
    "rate limit and auth guards run before the routes",
    middlewareBeforeRoutes.length >= 2 &&
      middlewareBeforeRoutes.every((x) => x.i < (apiPrefixLayers.find((y) => y.isRoute)?.i ?? 0)),
    `${middlewareBeforeRoutes.length} middleware layers`
  );
  const lastReal = apiPrefixLayers.filter((x) => x.isRoute).pop();
  check(
    "the /api catch-all comes after the real routes",
    Boolean(catchAll && lastReal && catchAll.i > lastReal.i),
    `catch-all at ${catchAll?.i}, last real route at ${lastReal?.i}`
  );

  // Method coverage per route, so a moved handler cannot silently lose its verb.
  // A path can be registered by several layers (one per verb, or one per file).
  const byPath: Record<string, string[]> = {};
  for (const r of routes) {
    byPath[r.path] = [...new Set([...(byPath[r.path] || []), ...r.methods])];
  }
  check("trackers exposes GET and POST", ["get", "post"].every((m) => byPath["/api/trackers"]?.includes(m)),
    (byPath["/api/trackers"] || []).join(","));
  check("trackers delete is registered", byPath["/api/trackers/:id"]?.includes("delete"));
  check("analyze and forecast accept POST/GET", byPath["/api/analyze-url"]?.includes("post") && byPath["/api/predict-trends"]?.includes("get"));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
