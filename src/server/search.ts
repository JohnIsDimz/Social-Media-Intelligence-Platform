/**
 * Web search layer.
 *
 * The channels without a public read API (TikTok, Instagram, Facebook, ...) are
 * only reachable through search. An earlier version asked the chat model to
 * "search the web" while sending it no tools at all, so nothing was ever
 * collected — the model can only answer from memory. This module supplies the
 * missing half: real search results, which then go to the model for extraction.
 *
 * Providers, chosen with SEARCH_PROVIDER:
 *
 *   searxng  a SearXNG instance you host. Free, no quota, no key, no card.
 *            Recommended for a VPS that must stay at zero cost.
 *   tavily   1,000 credits/month free, no credit card. Good without your own
 *            infrastructure; basic search costs 1 credit.
 *   none     explicit off switch. No search happens and no channel pretends
 *            otherwise.
 *
 * Accuracy rule: `searchWeb` returns only what the provider returned. It never
 * synthesises a URL, and a failed call returns [] with a logged reason rather
 * than a plausible-looking list.
 */

export type SearchProviderName = "searxng" | "tavily" | "none";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which engine produced it, for the audit trail. */
  engine: string;
}

export interface SearchConfig {
  provider: SearchProviderName;
  configured: boolean;
  /** Human-readable reason when not configured. */
  detail: string;
  host: string;
}

const TIMEOUT_MS = 12_000;

export function searchConfig(): SearchConfig {
  const raw = (process.env.SEARCH_PROVIDER || "").trim().toLowerCase();

  if (raw === "none") {
    return { provider: "none", configured: false, detail: "SEARCH_PROVIDER=none disables web search.", host: "" };
  }

  if (raw === "tavily" || (!raw && process.env.SEARCH_API_KEY)) {
    const key = (process.env.SEARCH_API_KEY || "").trim();
    return {
      provider: "tavily",
      configured: Boolean(key),
      detail: key
        ? "Tavily (1,000 free credits per month, no card required)."
        : "SEARCH_PROVIDER=tavily needs SEARCH_API_KEY.",
      host: "api.tavily.com",
    };
  }

  if (raw === "searxng" || process.env.SEARXNG_URL) {
    const url = (process.env.SEARXNG_URL || "").trim();
    return {
      provider: "searxng",
      configured: Boolean(url),
      detail: url
        ? "Self-hosted SearXNG: no quota, no key, no cost."
        : "SEARCH_PROVIDER=searxng needs SEARXNG_URL (e.g. http://127.0.0.1:8080).",
      host: url ? safeHost(url) : "",
    };
  }

  return {
    provider: "none",
    configured: false,
    detail:
      "No web search provider is configured, so channels without a public read API collect nothing. " +
      "Set SEARCH_PROVIDER=searxng with SEARXNG_URL (free, self-hosted) or SEARCH_PROVIDER=tavily with SEARCH_API_KEY (1,000 free credits/month).",
    host: "",
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Short, provider-facing description of the search layer, for /api/health. */
export function searchSummary() {
  const config = searchConfig();
  return {
    enabled: config.configured,
    provider: config.provider,
    host: config.host || null,
    detail: config.detail,
  };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; results: SearchResult[] }>();

/**
 * Runs one web search.
 *
 * @param query  Free-text query. Site filters are added by the caller.
 * @param limit  Maximum results to return (providers cap this themselves).
 */
export async function searchWeb(
  query: string,
  limit = 8,
  options: { freshness?: "day" | "week" | "month" | "year"; useCache?: boolean } = {}
): Promise<SearchResult[]> {
  const config = searchConfig();
  if (!config.configured) return [];

  // A short cache: the background loop re-scans the stalest tracker every couple
  // of minutes, and re-buying the same query from a free quota is waste.
  const cacheKey = `${config.provider}|${query}|${limit}|${options.freshness || ""}`;
  if (options.useCache !== false) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const results =
      config.provider === "tavily"
        ? await searchTavily(query, limit, controller.signal, options.freshness)
        : await searchSearxng(query, limit, controller.signal, options.freshness);
    const deduped = dedupeByUrl(results).slice(0, limit);
    if (options.useCache !== false) cache.set(cacheKey, { at: Date.now(), results: deduped });
    return deduped;
  } catch (err: any) {
    // A failed search is an empty search with a reason, never a fabricated list.
    const reason = err?.name === "AbortError" ? "timed out" : err?.cause?.code || err?.message || "search failed";
    console.warn(`[Search] ${config.provider} query failed (${reason}).`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavily(
  query: string,
  limit: number,
  signal: AbortSignal,
  freshness?: "day" | "week" | "month" | "year"
): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      api_key: (process.env.SEARCH_API_KEY || "").trim(),
      query,
      // "basic" costs 1 credit; "advanced" costs 2. The free tier is the point
      // here, and the model only needs snippets, not deep crawling.
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      max_results: Math.min(20, limit),
      // Freshness is most of what "live signal" means. Tavily takes a day count.
      ...(freshness ? { days: freshness === "day" ? 1 : freshness === "week" ? 7 : freshness === "month" ? 30 : 365 } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Tavily answered HTTP ${res.status}`);
  const json: any = await res.json();
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];

  return rows
    .filter((r) => typeof r?.url === "string" && r.url.startsWith("http"))
    .map((r) => ({
      title: String(r.title || "").trim(),
      url: r.url,
      snippet: String(r.content || "").trim(),
      engine: "tavily",
    }));
}

async function searchSearxng(
  query: string,
  limit: number,
  signal: AbortSignal,
  freshness?: "day" | "week" | "month" | "year"
): Promise<SearchResult[]> {
  const base = (process.env.SEARXNG_URL || "").trim().replace(/\/+$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  // News first: brand mentions are usually recent, and SearXNG's general
  // engines already include social results.
  // `social` is where Mastodon/Reddit results come from; without it the social
  // channels depend on a general engine's index and find very little.
  url.searchParams.set("categories", "general,news,social");
  url.searchParams.set("limit", String(Math.min(20, limit)));
  url.searchParams.set("language", process.env.SEARCH_LANGUAGE || "en");
  if (freshness) url.searchParams.set("time_range", freshness);

  const res = await fetch(url, {
    method: "GET",
    signal,
    headers: { Accept: "application/json", "User-Agent": "SMIP-Search/1.0" },
  });

  if (!res.ok) throw new Error(`SearXNG answered HTTP ${res.status}`);
  const json: any = await res.json();
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];

  return rows
    .filter((r) => typeof r?.url === "string" && r.url.startsWith("http"))
    .map((r) => ({
      title: String(r.title || "").trim(),
      url: r.url,
      snippet: String(r.content || "").trim(),
      engine: String(Array.isArray(r.engines) ? r.engines.join(",") : r.engine || "searxng"),
    }));
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    // Normalise the trailing slash and fragment so the same page is not counted
    // twice; providers frequently return both forms.
    const key = r.url.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Site filters per channel. A search engine needs to be pointed at the network;
 * "tiktok brand" would return news *about* TikTok instead of posts on it.
 */
export const CHANNEL_SEARCH_SITES: Record<string, string[]> = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com"],
  linkedin: ["linkedin.com"],
  threads: ["threads.net"],
  telegram: ["t.me"],
  discord: ["discord.com", "discord.gg"],
  pinterest: ["pinterest.com"],
  snapchat: ["snapchat.com"],
  whatsapp: ["whatsapp.com", "wa.me"],
  medium: ["medium.com"],
  vimeo: ["vimeo.com"],
  forums: ["reddit.com", "quora.com", "trustpilot.com", "yelp.com"],
};

/** Builds the provider query for one channel, e.g. `site:tiktok.com "nike"`. */
/**
 * One keyword, several framings.
 *
 * A single exact-phrase query is why coverage felt thin: people rarely write the
 * brand and nothing else. Intent words surface the complaints a plain brand
 * search misses, and the hashtag/handle forms are how the platforms are actually
 * used. Every variant stays site-scoped, so recall widens without pulling in news
 * *about* the platform.
 */
const INTENT_WORDS = ["review", "problem", "complaint"];

export function queryVariantsFor(channelKey: string, keyword: string): string[] {
  const base = queryForChannel(channelKey, keyword);
  const sites = CHANNEL_SEARCH_SITES[channelKey] || [];
  if (sites.length === 0) return [base];
  const siteClause = sites.map((s) => `site:${s}`).join(" OR ");
  const clean = keyword.replace(/^#/, "").replace(/"/g, "").trim();
  if (!clean) return [base];
  const compact = clean.replace(/\s+/g, "");

  const variants = [
    base,
    `${siteClause} "${clean}" (${INTENT_WORDS.join(" OR ")})`,
    `${siteClause} #${compact} OR @${compact}`,
  ];
  return [...new Set(variants)];
}

export function queryForChannel(channelKey: string, keyword: string): string {
  const sites = CHANNEL_SEARCH_SITES[channelKey] || [];
  const quoted = `"${keyword.replace(/"/g, "")}"`;
  if (sites.length === 0) return quoted;
  const siteClause = sites.map((s) => `site:${s}`).join(" OR ");
  return `${siteClause} ${quoted}`;
}
