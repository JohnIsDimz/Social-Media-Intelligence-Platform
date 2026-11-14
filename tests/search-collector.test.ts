/**
 * The two-leg collection path, end to end.
 *
 * A stub SearXNG returns two pages for `site:tiktok.com "nike"`, and a stub model
 * returns two mentions: one quoting a real result, one inventing a URL. The
 * invented mention must never reach the caller — that guard is the whole reason
 * this file exists, because a model asked to summarise search results will
 * happily produce a plausible URL that was never there.
 *
 * Everything runs against 127.0.0.1, so no external network is touched.
 */
process.env.SEARCH_PROVIDER = "searxng";
process.env.SEARXNG_URL = "http://127.0.0.1:9188";
process.env.AI_API_KEY = "stub";
process.env.AI_BASE_URL = "http://127.0.0.1:9188/v1";

import http from "node:http";

const realFetch = globalThis.fetch;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.startsWith("/search")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        results: [
          { title: "Nike drop on TikTok", url: "https://www.tiktok.com/@nike/video/77", content: "people love the new Nike drop", engines: ["google"] },
          { title: "Thread about Nike", url: "https://www.tiktok.com/@user/status/9", content: "Nike sizing complaints", engines: ["bing"] },
        ],
      }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      const payload = JSON.parse(body);
      const prompt: string = payload.messages?.[1]?.content || "";
      const urls = [...prompt.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify([
          { url: urls[0], author: "nike", title: "Loved it", content: "great reception", sentiment: "positive", sentimentScore: 0.6, emotion: "Joy", engagement: "High" },
          { url: "https://www.tiktok.com/@fake/video/000", author: "ghost", title: "invented", content: "never in the results", sentiment: "neutral", sentimentScore: 0, emotion: "Neutral", engagement: "Low" },
        ]) } }],
      }));
      return;
    }
    res.statusCode = 404; res.end("no");
  });
});

async function main() {
await new Promise<void>((r) => server.listen(9188, "127.0.0.1", () => r()));

const { fetchUnifiedSocialSignals } = await import("../src/server/collectors.ts");
const rows = await fetchUnifiedSocialSignals({ query: "nike", platforms: ["tiktok"] });

const checks: [string, boolean][] = [];
const allReal = rows.every((r: any) =>
  ["https://www.tiktok.com/@nike/video/77", "https://www.tiktok.com/@user/status/9"].includes(r.url)
);
checks.push(["an invented URL is dropped", !rows.some((r: any) => r.url.includes("/@fake/"))]);
checks.push(["every url came from the search results", allReal]);
checks.push(["the real mention is kept", rows.length === 1]);
checks.push(["the mention carries its channel", rows.every((r: any) => r.platform === "tiktok")]);

for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
const failedCount = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failedCount} passed, ${failedCount} failed`);
server.close();
process.exit(failedCount ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
