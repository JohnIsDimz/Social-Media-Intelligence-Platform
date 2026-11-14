/**
 * Search layer tests.
 *
 * Two things must hold: a missing provider yields no results (never invented
 * ones), and a provider's answer is passed through faithfully, deduplicated by
 * URL. A local stub server stands in for Tavily and SearXNG so the shapes are
 * exercised without network access.
 */
import http from "node:http";

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

async function main() {
  // 1. No provider configured: empty, with a reason, and nothing is fetched.
  delete process.env.SEARCH_PROVIDER;
  delete process.env.SEARCH_API_KEY;
  delete process.env.SEARXNG_URL;
  const { searchConfig, searchWeb, queryForChannel, searchSummary } = await import("../src/server/search.ts");

  const unconfigured = searchConfig();
  check("no provider leaves search unconfigured", unconfigured.configured === false && unconfigured.provider === "none");
  check("the reason names both free options",
    unconfigured.detail.includes("searxng") && unconfigured.detail.includes("tavily"),
    unconfigured.detail.slice(0, 60));
  const empty = await searchWeb("anything");
  check("no provider returns an empty list, not a guess", Array.isArray(empty) && empty.length === 0);
  check("health summary reports the disabled state", searchSummary().enabled === false);

  // 2. Tavily shape.
  const stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/tavily") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          results: [
            { title: "Nike on TikTok", url: "https://www.tiktok.com/@nike/video/1", content: "New drop reaction" },
            { title: "Duplicate", url: "https://www.tiktok.com/@nike/video/1/", content: "same page, trailing slash" },
            { title: "Not a url", url: "notaurl", content: "should be dropped" },
            { title: "Nike news", url: "https://example.com/nike", content: "coverage" },
          ],
        }));
      } else if (req.url === "/searxng") {
        res.statusCode = 500;
        res.end("boom");
      } else {
        res.statusCode = 404;
        res.end("no");
      }
    });
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
  const port = (stub.address() as any).port;

  // Point the module at the stub. Tavily's URL is fixed in the module, so the
  // fetch is intercepted instead of redirecting a real host.
  const realFetch = globalThis.fetch;
  let lastQuery = "";
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("https://api.tavily.com")) {
      lastQuery = JSON.parse(init.body).query;
      return realFetch(`http://127.0.0.1:${port}/tavily`, { method: "POST" });
    }
    if (url.startsWith("http://127.0.0.1:9999")) {
      return realFetch(`http://127.0.0.1:${port}/searxng`);
    }
    return realFetch(input, init);
  }) as any;

  process.env.SEARCH_PROVIDER = "tavily";
  process.env.SEARCH_API_KEY = "test-key";
  const tavilyResults = await searchWeb("nike", 8);
  check("tavily results are passed through", tavilyResults.length === 2, `${tavilyResults.length} rows`);
  check("a non-http row is dropped", !tavilyResults.some((r) => r.url === "notaurl"));
  check("duplicate urls are collapsed", new Set(tavilyResults.map((r) => r.url.replace(/\/+$/, ""))).size === tavilyResults.length,
    tavilyResults.map((r) => r.url).join(" | "));
  check("the query reaches the provider verbatim", lastQuery === "nike", lastQuery);

  // 3. A failing provider yields [] rather than throwing.
  process.env.SEARCH_PROVIDER = "searxng";
  process.env.SEARXNG_URL = "http://127.0.0.1:9999";
  delete process.env.SEARCH_API_KEY;
  const failed = await searchWeb("nike");
  check("a 500 from the provider returns an empty list", Array.isArray(failed) && failed.length === 0);

  // 4. Channel queries are site-scoped, so "nike" does not return news about Nike.
  check("tiktok query is site-scoped", queryForChannel("tiktok", "nike") === 'site:tiktok.com "nike"', queryForChannel("tiktok", "nike"));
  check("multi-site channels OR their filters", queryForChannel("forums", "nike").includes("site:reddit.com OR site:quora.com"));
  check("an unknown channel still produces a quoted keyword", queryForChannel("reddit", "nike") === '"nike"');

  globalThis.fetch = realFetch;
  stub.close();

  console.log(results.join("\n"));
  const failedCount = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
  process.exit(failedCount ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
