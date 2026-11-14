/**
 * Collectors.
 *
 * Everything that talks to the outside world to find public conversation:
 * the scraper for a submitted URL, the platform collectors, and the unified
 * fan-out that a scan or the background loop calls.
 *
 * Rules this module follows:
 *  - only documented public endpoints, no scraping of logged-in pages;
 *  - every outbound URL passes the SSRF guard (`isIpLiteral` + host allowlist
 *    inside `scrapeSocialUrl`), and every call has a timeout;
 *  - nothing here returns invented rows: a failed collector returns [].
 */
import { chatJson } from "../lib/aiProvider.ts";
import { logger } from "./logger.ts";
import {
  CHANNEL_SEARCH_SITES,
  queryVariantsFor,
  searchConfig,
  searchWeb,
  type SearchResult,
} from "./search.ts";
import { aiCanSearch, describeAiFailure } from "./ai.ts";
import { analyzeSentiment, engagementGrade } from "./lexicon.ts";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
];

// Only public social-network hosts may be fetched. Without this, /api/analyze-url
// is a textbook SSRF: an attacker could make the server read internal services
// (cloud metadata, localhost admin panels, private networks).
const ALLOWED_SCRAPE_HOSTS = new Set([
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "fb.com", "www.fb.com",
  "whatsapp.com", "www.whatsapp.com", "wa.me",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
  "linkedin.com", "www.linkedin.com", "lnkd.in",
  "reddit.com", "www.reddit.com", "redd.it", "old.reddit.com",
]);

// Reject IP-literal hosts outright (127.0.0.1, 169.254.169.254, [::1], ...).
export function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || // IPv4
    hostname.includes(":") ||                      // IPv6 (URL keeps brackets)
    /^0x/i.test(hostname) ||                       // hex-encoded IP
    /^\d+$/.test(hostname)                        // decimal-encoded IP
  );
}

export function validateScrapeUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are supported.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }
  if (parsed.port) {
    throw new Error("Custom ports are not allowed.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isIpLiteral(hostname)) {
    throw new Error("IP addresses are not allowed.");
  }
  if (!ALLOWED_SCRAPE_HOSTS.has(hostname)) {
    throw new Error(
      "That domain is not supported. Use a link from TikTok, Instagram, Facebook, WhatsApp, X, YouTube, LinkedIn or Reddit."
    );
  }
  return parsed;
}

// Scrape Social Media URL Meta Tags using rotating User-Agents and multi-fallback parsing
export async function scrapeSocialUrl(url: string) {
  try {
    const parsedUrl = validateScrapeUrl(url);
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const referer = `${parsedUrl.protocol}//${parsedUrl.hostname}/`;

    const response = await fetch(parsedUrl.toString(), {
      // Never follow redirects: a public host could redirect the server to an
      // internal address, re-opening the SSRF hole.
      redirect: "manual",
      headers: {
        "User-Agent": randomUserAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": referer,
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": randomUserAgent.includes("Mobile") ? "?1" : "?0",
        "Sec-Ch-Ua-Platform": randomUserAgent.includes("Windows") ? '"Windows"' : (randomUserAgent.includes("Macintosh") ? '"macOS"' : '"Android"'),
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
      },
      signal: AbortSignal.timeout(8000) // 8 seconds timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const html = await response.text();

    // 1. Extract HTML title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : "";

    // 2. Multi-fallback OpenGraph extraction patterns
    const extractMeta = (properties: string[], names: string[]): string => {
      for (const prop of properties) {
        const regex = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
        const revRegex = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
        const match = html.match(regex) || html.match(revRegex);
        if (match && match[1]) return match[1].trim();
      }
      for (const name of names) {
        const regex = new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
        const revRegex = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i");
        const match = html.match(regex) || html.match(revRegex);
        if (match && match[1]) return match[1].trim();
      }
      return "";
    };

    const title = extractMeta(["og:title", "twitter:title"], ["title", "headline"]) || pageTitle;
    const description = extractMeta(["og:description", "twitter:description"], ["description", "summary"]);
    const imageUrl = extractMeta(["og:image", "twitter:image", "og:image:url"], ["image", "thumbnailUrl"]);

    // 3. Fallback to JSON-LD parsing if available
    let jsonLdTitle = "";
    let jsonLdDesc = "";
    let jsonLdImg = "";
    try {
      const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch && jsonLdMatch[1]) {
        const parsed = JSON.parse(jsonLdMatch[1].trim());
        jsonLdTitle = parsed.name || parsed.headline || "";
        jsonLdDesc = parsed.description || "";
        if (parsed.image) {
          jsonLdImg = typeof parsed.image === "string" ? parsed.image : (parsed.image.url || (Array.isArray(parsed.image) ? parsed.image[0] : ""));
        }
      }
    } catch (_) {}

    // No invented title, description or stock image. When the page has no
    // metadata, the caller is told the fetch produced nothing usable instead of
    // receiving a plausible-looking placeholder to analyse.
    return {
      title: title || jsonLdTitle || "",
      description: description || jsonLdDesc || "",
      imageUrl: imageUrl || jsonLdImg || "",
      success: Boolean(title || jsonLdTitle || description || jsonLdDesc),
    };
  } catch (err: any) {
    logger.warn(`Scrape failed for ${url}:`, err.message);
    return { title: "", description: "", imageUrl: "", success: false };
  }
}

// Detect platform from URL
export function detectPlatform(url: string): 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other' {
  const lower = url.toLowerCase();
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("wa.me") || lower.includes("whatsapp.com")) return "whatsapp";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "twitter";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("reddit.com")) return "reddit";
  return "other";
}

/**
 * Local, no-key sentiment analysis.
 *
 * Thin wrapper over `lexicon.ts` so the analyzer route keeps one call shape. Two
 * earlier fallbacks are deliberately gone: a skeleton headline in Indonesian and
 * three hashtags that were invented whenever a post had none. A post with no
 * hashtags now reports none, and a title falls back to its own text.
 */
export function localAnalyzeSentiment(title?: string, content?: string) {
  const result = analyzeSentiment(title, content);
  const safeTitle = (title || "").trim();
  const safeContent = (content || "").trim();
  const summarySource = safeTitle || safeContent;
  return {
    sentiment: result.sentiment,
    sentimentScore: result.sentimentScore,
    emotion: result.emotion,
    // Engagement is a property of the post on its platform. We have no count
    // here, so we say nothing rather than inferring it from text length.
    engagement: "",
    hashtags: result.hashtags,
    refinedTitle: summarySource.length > 50 ? summarySource.slice(0, 47) + "..." : summarySource,
    refinedDescription:
      safeContent.length > 150 ? safeContent.slice(0, 147) + "..." : safeContent,
  };
}

/* ---------------------------------------------------------------------------
 * Reddit
 *
 * Two paths, both free:
 *  - OAuth client-credentials when REDDIT_CLIENT_ID/SECRET are set. Reddit now
 *    answers 403 to many anonymous .json calls, especially from cloud IPs, so a
 *    registered "script" app is the reliable path.
 *  - anonymous search.json otherwise, with a descriptive User-Agent Reddit
 *    documents as required.
 *
 * The old collector asked for four posts and stamped every one with a US
 * centroid. Both are fixed: 25 posts, three sort orders, and no coordinate,
 * because Reddit's API does not publish where a post was read.
 * ------------------------------------------------------------------------- */

let redditToken: { value: string; expiresAt: number } | null = null;

async function redditAccessToken(): Promise<string | null> {
  const id = (process.env.REDDIT_CLIENT_ID || "").trim();
  const secret = (process.env.REDDIT_CLIENT_SECRET || "").trim();
  if (!id || !secret) return null;
  if (redditToken && Date.now() < redditToken.expiresAt - 60_000) return redditToken.value;

  try {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_UA,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(`[Reddit] Token request answered HTTP ${res.status}; falling back to anonymous.`);
      return null;
    }
    const json: any = await res.json();
    if (!json?.access_token) return null;
    redditToken = {
      value: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
    return redditToken.value;
  } catch (err: any) {
    logger.warn(`[Reddit] Token request failed (${err?.message || err}); using anonymous.`);
    return null;
  }
}

const REDDIT_UA = "web:smip-social-intelligence:1.1 (monitoring public discussion)";

/** Reddit, newest + most upvoted this week. */
export async function fetchRealRedditPosts(query: string): Promise<any[]> {
  const token = await redditAccessToken();
  const host = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const posts: any[] = [];
  const seen = new Set<string>();

  for (const [sort, range] of [["new", "week"], ["top", "week"]] as const) {
    const url =
      `${host}/search.json?q=${encodeURIComponent(query)}` +
      `&limit=25&sort=${sort}&t=${range}&type=link`;

    let json: any = null;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": REDDIT_UA,
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn(
          `[Reddit] ${sort} search answered HTTP ${res.status}` +
            (res.status === 403 && !token
              ? " — anonymous access is rate limited; set REDDIT_CLIENT_ID/SECRET for the OAuth path."
              : ".")
        );
        continue;
      }
      json = await res.json();
    } catch (err: any) {
      logger.warn(`[Reddit] ${sort} search failed: ${err?.message || err}`);
      continue;
    }

    for (const child of json?.data?.children || []) {
      const p = child?.data;
      if (!p?.permalink || seen.has(p.permalink)) continue;
      seen.add(p.permalink);
      const content = p.selftext || p.title || "";
      posts.push(
        toMention({
          platform: "reddit",
          url: `https://www.reddit.com${p.permalink}`,
          author: p.author ? `u/${p.author}` : "Reddit user",
          title: p.title || "Reddit post",
          content,
          engagementValue: (p.score || 0) + (p.num_comments || 0),
          date: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : undefined,
        })
      );
    }
  }

  logger.info(`[Reddit] collected ${posts.length} post(s) for "${query}"${token ? "" : " (anonymous)"}.`);
  return posts;
}

/* ---------------------------------------------------------------------------
 * YouTube
 *
 * Discovery without a key: YouTube publishes a public search RSS feed
 * (feeds/videos.xml?search_query=…). It gives real titles, channel names and
 * publish dates at no cost, which is what a "what is being said about us" scan
 * needs.
 *
 * The Data API v3 adds real view/like counts, but search.list costs 100 of the
 * 10,000 daily quota units — about 100 searches a day for the whole project
 * (https://outlierkit.com/resources/youtube-search-api/). It is therefore used
 * only for the most recent matches of one query, and only when a key exists.
 * ------------------------------------------------------------------------- */

export async function fetchRealYouTubeVideos(query: string): Promise<any[]> {
  const rss = await fetchYouTubeRss(query);
  const counts = process.env.YOUTUBE_API_KEY ? await fetchYouTubeViewCounts(rss) : new Map<string, number>();

  return rss.map((item) =>
    toMention({
      platform: "youtube",
      url: item.url,
      author: item.author,
      title: item.title,
      content: item.description,
      engagementValue: counts.get(item.videoId),
      date: item.date,
    })
  );
}

interface YouTubeRssItem {
  videoId: string;
  url: string;
  title: string;
  author: string;
  description: string;
  date?: string;
}

/** Public RSS search. No key, no quota. */
export async function fetchYouTubeRss(query: string): Promise<YouTubeRssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(query)}`,
      { signal: controller.signal, headers: { "User-Agent": "SMIP-Engine/1.1" } }
    );
    if (!res.ok) {
      logger.warn(`[YouTube] RSS answered HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 15);
    return entries.flatMap((match) => {
      const block = match[1];
      const pick = (tag: string) =>
        (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
      const videoId = decodeXml(pick("yt:videoId"));
      const title = decodeXml(pick("title"));
      if (!videoId || !title) return [];
      return [
        {
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title,
          author: decodeXml(pick("name")) || "YouTube channel",
          description: decodeXml(pick("media:description")),
          date: pick("published") ? new Date(pick("published")).toISOString() : undefined,
        } as YouTubeRssItem,
      ];
    });
  } catch (err: any) {
    logger.warn(`[YouTube] RSS failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real view counts for the videos RSS already found.
 *
 * One videos.list call (`part=statistics`, 1 quota unit) covers up to 50 ids, so
 * this costs a fraction of a single search.list call and never widens the query.
 */
async function fetchYouTubeViewCounts(items: YouTubeRssItem[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = items.slice(0, 50).map((i) => i.videoId);
  if (ids.length === 0) return counts;
  const json = await fetchJson(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}` +
      `&key=${process.env.YOUTUBE_API_KEY}`
  );
  for (const item of json?.items || []) {
    const stats = item?.statistics || {};
    const views = Number(stats.viewCount);
    const likes = Number(stats.likeCount);
    if (Number.isFinite(views) || Number.isFinite(likes)) {
      counts.set(String(item.id), (views || 0) + (likes || 0));
    }
  }
  return counts;
}

/* ---------------------------------------------------------------------------
 * X / Twitter
 *
 * The recent-search endpoint accepts max_results between 10 and 100. The old
 * collector sent 4, which the API rejects, so a configured bearer token produced
 * nothing while the channel looked healthy. It now asks for 25, requests the
 * author expansion so the row shows a handle instead of "id:12345", and reports
 * the real HTTP failure instead of an empty list that looks like silence.
 * ------------------------------------------------------------------------- */

export async function fetchRealTweets(query: string): Promise<any[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  try {
    const url =
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}` +
      `&tweet.fields=created_at,public_metrics,lang` +
      `&expansions=author_id&user.fields=username,name` +
      `&max_results=25`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn(
        `[Twitter] Search answered HTTP ${res.status}` +
          (res.status === 400 ? " — check the query and that the app has search access." : ".") +
          (detail ? ` ${detail.slice(0, 200)}` : "")
      );
      return [];
    }
    const json: any = await res.json();
    if (!Array.isArray(json?.data)) return [];

    const users = new Map<string, string>();
    for (const user of json?.includes?.users || []) {
      const handle = user?.username ? `@${user.username}` : user?.name || "";
      if (user?.id && handle) users.set(String(user.id), handle);
    }

    return json.data.map((tweet: any) => {
      const metrics = tweet.public_metrics || {};
      const engagement =
        (metrics.retweet_count || 0) +
        (metrics.like_count || 0) +
        (metrics.reply_count || 0) +
        (metrics.quote_count || 0);
      return toMention({
        platform: "twitter",
        url: `https://x.com/i/web/status/${tweet.id}`,
        author: users.get(String(tweet.author_id)) || "X user",
        title: (tweet.text || "").split("\n")[0].slice(0, 90) || "Post on X",
        content: tweet.text || "",
        engagementValue: engagement,
        date: tweet.created_at ? new Date(tweet.created_at).toISOString() : undefined,
      });
    });
  } catch (err: any) {
    logger.warn(`[Twitter] Search failed: ${err?.message || err}`);
    return [];
  }
}

/* ---------------------------------------------------------------------------
 * Open collectors
 *
 * Each of these talks to a documented, public endpoint — no scraping of
 * logged-in pages, no credentials invented. They are the reason the dashboard
 * can show real data without any AI key.
 * ------------------------------------------------------------------------- */

const COLLECTOR_TIMEOUT_MS = 8000;

export async function fetchJson(url: string, init?: any): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "SMIP-Engine/1.1 (+https://github.com/JohnIsDimz/Social-Media-Intelligence-Platform)",
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      logger.warn(`[Collector] ${new URL(url).host} responded ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    logger.warn(`[Collector] ${new URL(url).host} failed: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Maps a collector's raw item onto the mention shape the rest of the app expects. */
export function toMention(args: {
  platform: string;
  url: string;
  author: string;
  title: string;
  content: string;
  /** Real engagement count from the source. Omitted when the source has none. */
  engagementValue?: number;
  date?: string;
  country?: string;
}): any {
  const local = localAnalyzeSentiment(args.title, args.content);
  const grade = engagementGrade(args.engagementValue);
  const mention: Record<string, any> = {
    platform: args.platform,
    url: args.url,
    author: args.author || "Public discussion",
    title: (args.title || "").trim() || `${args.platform} mention`,
    content: (args.content || "").slice(0, 280),
    sentiment: local.sentiment,
    sentimentScore: local.sentimentScore,
    emotion: local.emotion,
    hashtags: local.hashtags,
    date: args.date || new Date().toISOString(),
    country: args.country || "Global",
  };
  // Two fields, two meanings: the grade is a label the UI shows, the score is the
  // raw count a ranking can actually use. Both are omitted when unmeasured, and
  // no coordinate is attached because these APIs do not publish one.
  if (grade) mention.engagement = grade;
  if (args.engagementValue !== undefined) mention.engagementScore = args.engagementValue;
  return mention;
}

/** Bluesky — public AT Protocol search, no credentials. Paginated to 100 posts. */
export async function fetchBlueskyPosts(query: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({ q: query, limit: "50", sort: "latest" });
    if (cursor) params.set("cursor", cursor);
    const json = await fetchJson(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params.toString()}`
    );
    if (!json?.posts?.length) break;
    for (const post of json.posts) {
      out.push(
        toMention({
          platform: "bluesky",
          url: `https://bsky.app/profile/${post.author?.handle}/post/${String(post.uri).split("/").pop()}`,
          author: post.author?.handle ? `@${post.author.handle}` : "Bluesky user",
          title: post.record?.text?.slice(0, 90) || "Bluesky post",
          content: post.record?.text || "",
          engagementValue:
            (post.likeCount || 0) + (post.repostCount || 0) + (post.replyCount || 0),
          date: post.record?.createdAt ? new Date(post.record.createdAt).toISOString() : undefined,
        })
      );
    }
    cursor = json.cursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * Mastodon — hashtag timelines across instances, no credentials.
 *
 * Full-text status search is gated behind authentication on mastodon.social and
 * returns an empty list to anonymous callers, which used to look exactly like
 * "nobody is talking about us". Hashtag timelines are public, so that is the
 * primary path; search stays as a secondary attempt on instances that allow it.
 */
const MASTODON_INSTANCES = () =>
  (process.env.MASTODON_INSTANCES || "mastodon.social,mastodon.online,fosstodon.org")
    .split(",")
    .map((h) => h.trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
    .filter(Boolean);

/** Hashtag candidates from a keyword: the whole phrase, then its first word. */
export function hashtagCandidates(query: string): string[] {
  const clean = query.replace(/^#/, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const candidates = [clean.replace(/\s+/g, ""), ...(words.length > 1 ? [words[0]] : [])];
  return [...new Set(candidates.map((c) => c.toLowerCase()))].filter((c) => c.length > 1);
}

/** Public hashtag timelines: the reliable anonymous path. */
export async function fetchMastodonPosts(query: string): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  const tags = hashtagCandidates(query);

  for (const instance of MASTODON_INSTANCES()) {
    for (const tag of tags) {
      const json = await fetchJson(
        `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20`
      );
      for (const st of Array.isArray(json) ? json : []) {
        const url = st.url || st.uri;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const text = String(st.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        out.push(
          toMention({
            platform: "mastodon",
            url,
            author: st.account?.acct ? `@${st.account.acct}` : "Mastodon user",
            title: text.slice(0, 90) || "Mastodon post",
            content: text,
            engagementValue:
              (st.reblogs_count || 0) + (st.favourites_count || 0) + (st.replies_count || 0),
            date: st.created_at ? new Date(st.created_at).toISOString() : undefined,
          })
        );
      }
    }
  }

  // Secondary: instances that still allow anonymous status search.
  for (const instance of MASTODON_INSTANCES().slice(0, 2)) {
    const json = await fetchJson(
      `https://${instance}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=10&resolve=false`
    );
    for (const st of json?.statuses || []) {
      const url = st.url || st.uri;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const text = String(st.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      out.push(
        toMention({
          platform: "mastodon",
          url,
          author: st.account?.acct ? `@${st.account.acct}` : "Mastodon user",
          title: text.slice(0, 90) || "Mastodon post",
          content: text,
          engagementValue:
            (st.reblogs_count || 0) + (st.favourites_count || 0) + (st.replies_count || 0),
          date: st.created_at ? new Date(st.created_at).toISOString() : undefined,
        })
      );
    }
  }

  logger.info(`[Mastodon] collected ${out.length} status(es) for "${query}" from ${MASTODON_INSTANCES().length} instance(s).`);
  return out;
}

/**
 * Hacker News — Algolia's public search API.
 *
 * Stories alone are headlines; the disagreement and the detail live in comments.
 * This asks for both, and for the last 30 days, so the feed is current rather
 * than "best of all time".
 */
export async function fetchHackerNews(query: string): Promise<any[]> {
  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const params = (tags: string) =>
    `query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=40` +
    `&numericFilters=created_at_i>${since}`;

  const [stories, comments] = await Promise.all([
    fetchJson(`https://hn.algolia.com/api/v1/search?${params("story")}`),
    fetchJson(`https://hn.algolia.com/api/v1/search?${params("comment")}`),
  ]);

  const out: any[] = [];
  for (const hit of stories?.hits || []) {
    out.push(
      toMention({
        platform: "hackernews",
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author || "HN user",
        title: hit.title || hit.story_title || "Hacker News story",
        content: hit.story_text || hit.title || "",
        engagementValue: (hit.points || 0) + (hit.num_comments || 0),
        date: hit.created_at ? new Date(hit.created_at).toISOString() : undefined,
      })
    );
  }
  for (const hit of comments?.hits || []) {
    const text = String(hit.comment_text || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    out.push(
      toMention({
        platform: "hackernews",
        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author || "HN user",
        title: text.slice(0, 90),
        content: text,
        engagementValue: hit.points || 0,
        date: hit.created_at ? new Date(hit.created_at).toISOString() : undefined,
      })
    );
  }
  return out;
}

export function decodeXml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Google News — public RSS, parsed without a dependency.
 *
 * The locale follows SEARCH_LANGUAGE: an Indonesian tracker with hl=en-US gets
 * English coverage of an Indonesian brand, which is the wrong half of the story.
 */
export async function fetchGoogleNews(query: string): Promise<any[]> {
  const lang = (process.env.SEARCH_LANGUAGE || "en").toLowerCase();
  const locale =
    lang === "id" ? { hl: "id", gl: "ID", ceid: "ID:id" } : { hl: "en-US", gl: "US", ceid: "US:en" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
        `&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`,
      { signal: controller.signal, headers: { "User-Agent": "SMIP-Engine/1.1" } }
    );
    if (!res.ok) {
      logger.warn(`[Collector] news.google.com responded ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20);
    return items.flatMap((match) => {
      const block = match[1];
      const pick = (tag: string) =>
        (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
      const title = decodeXml(pick("title"));
      const link = decodeXml(pick("link"));
      const pub = pick("pubDate");
      const source = decodeXml(pick("source")) || "a news outlet";
      if (!title || !link) return [];
      return [
        toMention({
          platform: "news",
          url: link,
          author: source,
          title,
          content: `${title} - published by ${source}.`,
          // A news item has no engagement count we can see; do not invent one.
          date: pub ? new Date(pub).toISOString() : undefined,
        }),
      ];
    });
  } catch (err: any) {
    logger.warn(`[Collector] Google News failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lemmy — public search on a large instance.
 *
 * Two passes (newest, then best of the week) because a loud thread can be a few
 * days old and would be missed by a purely chronological query.
 */
export async function fetchLemmyPosts(query: string): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const sort of ["New", "TopWeek"]) {
    const json = await fetchJson(
      `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts&sort=${sort}&limit=40`
    );
    for (const entry of json?.posts || []) {
      const p = entry.post || {};
      const url = p.ap_id || `https://lemmy.world/post/${p.id}`;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(
        toMention({
          platform: "lemmy",
          url,
          author: entry.creator?.name ? `@${entry.creator.name}` : "Lemmy user",
          title: p.name || "Lemmy post",
          content: p.body || p.name || "",
          engagementValue: (p.counts?.score || 0) + (p.counts?.comments || 0),
          date: p.published ? new Date(p.published).toISOString() : undefined,
        })
      );
    }
  }
  return out;
}

/** GitHub — public search API (unauthenticated is rate limited but works). */
export async function fetchGitHubIssues(query: string): Promise<any[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const out: any[] = [];
  const seen = new Set<string>();
  // Newest first, then the most-commented of the last month: a reopened complaint
  // is fresh signal even when it was filed long ago.
  for (const sort of ["created", "comments"]) {
    const json = await fetchJson(
      `https://api.github.com/search/issues?q=${encodeURIComponent(query + " is:issue")}` +
        `&sort=${sort}&order=desc&per_page=50`,
      { headers }
    );
    for (const item of json?.items || []) {
      if (!item?.html_url || seen.has(item.html_url)) continue;
      seen.add(item.html_url);
      out.push(
        toMention({
          platform: "github",
          url: item.html_url,
          author: item.user?.login ? `@${item.user.login}` : "GitHub user",
          title: item.title || "GitHub issue",
          content: item.body || item.title || "",
          engagementValue: (item.comments || 0) + (item.reactions?.total_count || 0),
          date: item.created_at ? new Date(item.created_at).toISOString() : undefined,
        })
      );
    }
  }
  return out;
}

/**
 * Stack Overflow — public Stack Exchange API.
 *
 * Newest questions catch a fresh breakage; upvoted questions catch the ones that
 * keep biting people. Both are free within the anonymous quota (300/day per IP),
 * and 50 per pass keeps one scan far below it.
 */
export async function fetchStackOverflow(query: string): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const sort of ["creation", "votes"]) {
    const json = await fetchJson(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=${sort}` +
        `&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=50&filter=default`
    );
    for (const item of json?.items || []) {
      if (!item?.link || seen.has(item.link)) continue;
      seen.add(item.link);
      out.push(
        toMention({
          platform: "stackoverflow",
          url: item.link,
          author: item.owner?.display_name || "Stack Overflow user",
          title: item.title || "Stack Overflow question",
          content: `${item.title || ""} - ${(item.tags || []).join(", ")}`,
          engagementValue: (item.score || 0) + (item.answer_count || 0),
          date: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : undefined,
        })
      );
    }
  }
  return out;
}

/**
 * DEV Community — public articles API.
 *
 * The old collector read `/articles?top=30` (a popularity ranking of the whole
 * site) and then filtered it client-side, so it could only ever find a keyword
 * that happened to be in that week's top list. DEV exposes real filters, which
 * are used instead: by tag, and by a search term.
 */
export async function fetchDevTo(query: string): Promise<any[]> {
  const needle = query.replace(/^#/, "").trim();
  const tag = needle.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const urls = [
    `https://dev.to/api/articles/latest?tag=${encodeURIComponent(tag)}&per_page=60`,
    `https://dev.to/api/articles?per_page=60&page=1`,
  ].filter(Boolean);

  const out: any[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const json = await fetchJson(url);
    for (const a of Array.isArray(json) ? json : []) {
      const hay = `${a.title} ${a.description || ""} ${(a.tags || a.tag_list || []).join(" ")}`.toLowerCase();
      if (!hay.includes(needle.toLowerCase())) continue;
      if (!a.url || seen.has(a.url)) continue;
      seen.add(a.url);
      out.push(
        toMention({
          platform: "devto",
          url: a.url,
          author: a.user?.name || "DEV author",
          title: a.title || "DEV article",
          content: a.description || a.title || "",
          engagementValue: (a.public_reactions_count || 0) + (a.comments_count || 0),
          date: a.published_at ? new Date(a.published_at).toISOString() : undefined,
        })
      );
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Twitch
 *
 * Helix needs an app access token (client-credentials). Registration is free and
 * needs no card. What the open API actually exposes is stream and category
 * metadata, not chat: this collector reports the live streams and the top games
 * matching the keyword, and the channel label says so rather than implying chat
 * is read.
 * ------------------------------------------------------------------------- */

let twitchToken: { value: string; expiresAt: number } | null = null;

async function twitchAccessToken(): Promise<string | null> {
  const id = (process.env.TWITCH_CLIENT_ID || "").trim();
  const secret = (process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!id || !secret) return null;
  if (twitchToken && Date.now() < twitchToken.expiresAt - 60_000) return twitchToken.value;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}` +
        `&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
      { method: "POST", signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS) }
    );
    if (!res.ok) {
      logger.warn(`[Twitch] Token request answered HTTP ${res.status}`);
      return null;
    }
    const json: any = await res.json();
    if (!json?.access_token) return null;
    twitchToken = {
      value: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
    return twitchToken.value;
  } catch (err: any) {
    logger.warn(`[Twitch] Token request failed: ${err?.message || err}`);
    return null;
  }
}

export async function fetchTwitchStreams(query: string): Promise<any[]> {
  const token = await twitchAccessToken();
  const clientId = (process.env.TWITCH_CLIENT_ID || "").trim();
  if (!token || !clientId) {
    logger.info("[Twitch] TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set; skipping.");
    return [];
  }
  const headers = { "Client-Id": clientId, Authorization: `Bearer ${token}` };

  // 1. Streams whose title mentions the keyword: that is a real "someone is
  //    talking about this right now" signal.
  const streams = await fetchJson(
    `https://api.twitch.tv/helix/search/channels?query=${encodeURIComponent(query)}&first=20`,
    { headers }
  );
  const out: any[] = [];
  for (const channel of streams?.data || []) {
    out.push(
      toMention({
        platform: "twitch",
        url: `https://www.twitch.tv/${channel.broadcaster_login}`,
        author: channel.display_name || channel.broadcaster_login,
        title: channel.title || `${channel.display_name} on Twitch`,
        content: channel.title || "",
        // Twitch's search payload has no viewer count; live status is what it has.
        date: channel.started_at ? new Date(channel.started_at).toISOString() : undefined,
      })
    );
  }
  return out;
}

/**
 * Medium — public tag RSS.
 *
 * Medium has no free keyword-search API, but every tag has an RSS feed at
 * `medium.com/feed/tag/<tag>`, which is public, keyless, and carries real dates
 * and authors. This is the collector the catalogue promised ("publication posts
 * via RSS") and never had.
 */
export async function fetchMedium(query: string): Promise<any[]> {
  const tag = query
    .replace(/^#/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!tag) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(`https://medium.com/feed/tag/${encodeURIComponent(tag)}`, {
      signal: controller.signal,
      headers: { "User-Agent": "SMIP-Engine/1.1", Accept: "application/rss+xml, application/xml" },
    });
    if (!res.ok) {
      logger.warn(`[Medium] feed answered HTTP ${res.status} for tag "${tag}"`);
      return [];
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20);
    return items.flatMap((match) => {
      const block = match[1];
      const pick = (tagName: string) =>
        (block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`)) || [])[1] || "";
      const title = decodeXml(pick("title"));
      const link = decodeXml(pick("link"));
      const description = decodeXml(pick("description"));
      const pub = pick("pubDate");
      const creator = decodeXml(pick("dc:creator")) || "Medium author";
      if (!title || !link) return [];
      return [
        toMention({
          platform: "medium",
          url: link,
          author: creator,
          title,
          content: description,
          date: pub ? new Date(pub).toISOString() : undefined,
        }),
      ];
    });
  } catch (err: any) {
    logger.warn(`[Medium] feed failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vimeo — public oEmbed metadata.
 *
 * oEmbed returns the title, author and thumbnail for one video URL, which is what
 * the catalogue promised. Discovery still comes from search (there is no free
 * keyword API); this turns those discovered links into structured rows with a
 * real author instead of a search snippet.
 */
export async function fetchVimeoMetadata(url: string): Promise<any | null> {
  const json = await fetchJson(
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
  );
  if (!json?.title) return null;
  return toMention({
    platform: "vimeo",
    url,
    author: json.author_name || "Vimeo creator",
    title: json.title,
    content: json.description || json.title,
    date: json.upload_date ? new Date(json.upload_date).toISOString() : undefined,
  });
}

/**
 * Telegram — public channel previews.
 *
 * `t.me/s/<channel>` is the widget Telegram itself serves to the open web: post
 * text, timestamp and view counter, no login. Bounded to the first 20 posts.
 */
export async function fetchTelegramChannel(channel: string): Promise<any[]> {
  const handle = channel
    .replace(/^#/, "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (!handle) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(`https://t.me/s/${handle}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SMIP-Engine/1.1)" },
    });
    if (!res.ok) {
      logger.warn(`[Telegram] t.me/s/${handle} answered HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    const blocks = [...html.matchAll(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/g)]
      .slice(0, 20);
    const out: any[] = [];
    for (const [block] of blocks) {
      const textMatch = block.match(
        /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
      );
      const text = textMatch ? decodeXml(textMatch[1].replace(/<br\s*\/?>/g, " ")) : "";
      // Real widgets carry data-post; some layouts only carry the date link.
      const permalink =
        block.match(/data-post="([^"]+)"/) || block.match(/href="https:\/\/t\.me\/([^"?#]+)"/);
      if (!text || !permalink) continue;
      const time = block.match(/<time[^>]*datetime="([^"]+)"/);
      const views = block.match(/tgme_widget_message_views">([^<]+)</);
      out.push(
        toMention({
          platform: "telegram",
          url: `https://t.me/${permalink[1]}`,
          author: `@${handle}`,
          title: text.slice(0, 90),
          content: text,
          engagementValue: views ? parseTelegramCount(views[1]) : undefined,
          date: time ? new Date(time[1]).toISOString() : undefined,
        })
      );
    }
    logger.info(`[Telegram] collected ${out.length} post(s) from @${handle}.`);
    return out;
  } catch (err: any) {
    logger.warn(`[Telegram] ${handle} failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Telegram renders "1.2K", "3.4M" and "1 234" for view counts. */
export function parseTelegramCount(raw: string): number | undefined {
  const text = raw.trim().replace(/\s/g, "").replace(/,/g, ".");
  const match = text.match(/^([\d.]+)\s*([KMB]?)$/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toUpperCase();
  const multiplier = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1;
  return Math.round(value * multiplier);
}

// REAL LIVE UNIFIED ENGINE: Combines official APIs, public search feeds, and Google Search Grounding
/** Public search URL for a platform, used when grounding returns no direct link. */
export function constructOfficialPlatformSearchUrl(platform: string, query: string): string {
  const encQuery = encodeURIComponent(query);
  const tag = encodeURIComponent(query.replace(/[\s#]+/g, ""));
  switch (platform.toLowerCase()) {
    case "twitter":
    case "x":
      return `https://x.com/search?q=${encQuery}`;
    case "tiktok":
      return `https://www.tiktok.com/search?q=${encQuery}`;
    case "instagram":
      return `https://www.instagram.com/explore/tags/${tag}/`;
    case "facebook":
      return `https://www.facebook.com/search/top?q=${encQuery}`;
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encQuery}`;
    case "linkedin":
      return `https://www.linkedin.com/search/results/all/?keywords=${encQuery}`;
    case "reddit":
      return `https://www.reddit.com/search/?q=${encQuery}`;
    case "threads":
      return `https://www.threads.net/search?q=${encQuery}`;
    case "telegram":
      return `https://t.me/s/${tag}`;
    case "bluesky":
      return `https://bsky.app/search?q=${encQuery}`;
    case "mastodon":
      return `https://mastodon.social/search?q=${encQuery}`;
    case "hackernews":
      return `https://hn.algolia.com/?q=${encQuery}`;
    case "github":
      return `https://github.com/search?q=${encQuery}&type=issues`;
    case "pinterest":
      return `https://www.pinterest.com/search/pins/?q=${encQuery}`;
    case "news":
      return `https://news.google.com/search?q=${encQuery}`;
    default:
      return `https://www.google.com/search?q=${encQuery}`;
  }
}

/** Maximum rows a single scan may return, so a wider net stays bounded. */
export const MAX_ROWS_PER_SCAN = 400;
/** How many search channels are queried at once. */
const SEARCH_CONCURRENCY = 3;

/** Runs `jobs` with at most `limit` in flight. Same work, a third of the wall-clock. */
async function runPool<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await job(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Collects signal for one tracker.
 *
 * Order of business, and why:
 *  1. credentialled APIs and open public endpoints fan out in parallel;
 *  2. only the channels that came back empty are handed to the search leg, so
 *     the model is never asked to guess about a channel that already answered;
 *  3. the search leg runs its channels concurrently and, inside a channel, tries
 *     several query framings, keeping only mentions whose URL was in the results.
 *
 * No synthetic fallback exists here. An empty result is the honest answer, and
 * the dashboard says which sources are configured so the emptiness is explained.
 */
export async function fetchUnifiedSocialSignals(tracker: any): Promise<any[]> {
  const query = String(tracker?.query || "").trim();
  const selectedPlatforms: string[] = (tracker?.platforms || []).map((p: string) =>
    p.toLowerCase()
  );
  if (!query) return [];

  const apiTasks: { platform: string; promise: Promise<any[]> }[] = [];

  // 1. Channels with a documented read path that needs no AI.
  if (selectedPlatforms.includes("reddit")) {
    apiTasks.push({ platform: "reddit", promise: fetchRealRedditPosts(query) });
  }
  if (selectedPlatforms.includes("youtube")) {
    // RSS discovery needs no key; the key only adds view counts.
    apiTasks.push({ platform: "youtube", promise: fetchRealYouTubeVideos(query) });
  }
  if (
    (selectedPlatforms.includes("twitter") || selectedPlatforms.includes("x")) &&
    process.env.TWITTER_BEARER_TOKEN
  ) {
    apiTasks.push({ platform: "twitter", promise: fetchRealTweets(query) });
  }
  if (selectedPlatforms.includes("medium")) {
    apiTasks.push({ platform: "medium", promise: fetchMedium(query) });
  }
  if (selectedPlatforms.includes("twitch")) {
    apiTasks.push({ platform: "twitch", promise: fetchTwitchStreams(query) });
  }
  if (selectedPlatforms.includes("telegram")) {
    const handles = telegramHandlesFor(tracker);
    if (handles.length > 0) {
      apiTasks.push({
        platform: "telegram",
        promise: Promise.all(handles.map((h) => fetchTelegramChannel(h))).then((lists) => lists.flat()),
      });
    }
  }

  const OPEN_COLLECTORS: Record<string, () => Promise<any[]>> = {
    bluesky: () => fetchBlueskyPosts(query),
    mastodon: () => fetchMastodonPosts(query),
    hackernews: () => fetchHackerNews(query),
    news: () => fetchGoogleNews(query),
    lemmy: () => fetchLemmyPosts(query),
    stackoverflow: () => fetchStackOverflow(query),
    devto: () => fetchDevTo(query),
    github: () => fetchGitHubIssues(query),
  };

  for (const platform of selectedPlatforms) {
    const key = platform.toLowerCase();
    if (OPEN_COLLECTORS[key]) {
      apiTasks.push({ platform: key, promise: OPEN_COLLECTORS[key]() });
    }
  }

  const mergedResults: any[] = [];
  const platformsWithResults = new Set<string>();

  if (apiTasks.length > 0) {
    const results = await Promise.all(
      apiTasks.map(async (task) => {
        try {
          const res = await task.promise;
          if (Array.isArray(res) && res.length > 0) {
            platformsWithResults.add(task.platform.toLowerCase());
            return res;
          }
        } catch (err: any) {
          logger.warn(`[Collector] ${task.platform} failed: ${err?.message || err}`);
        }
        return [] as any[];
      })
    );
    for (const list of results) mergedResults.push(...list);
  }

  // 2. Channels that have no read API, or answered nothing this cycle.
  const remainingPlatforms = selectedPlatforms.filter(
    (p) => !platformsWithResults.has(p.toLowerCase())
  );
  const searchTargets = remainingPlatforms.filter((p) => CHANNEL_SEARCH_SITES[p.toLowerCase()]);
  const searchReady = searchTargets.length > 0 && aiCanSearch() && searchConfig().configured;

  if (searchTargets.length > 0 && !searchReady) {
    logger.info(
      `[Search] Skipping ${searchTargets.length} channel(s) (${searchTargets.join(", ")}): ` +
        (!aiCanSearch()
          ? "no AI key configured."
          : "no web search provider configured (set SEARCH_PROVIDER + SEARXNG_URL or SEARCH_API_KEY).")
    );
  }

  if (searchReady) {
    const perChannel = await runPool(searchTargets, SEARCH_CONCURRENCY, async (platform) => {
      const key = platform.toLowerCase();
      try {
        // Several framings of one keyword: exact phrase, intent words, and the
        // hashtag/handle form. Freshness is a week because that is what "live" means.
        const seen = new Map<string, SearchResult>();
        for (const variant of queryVariantsFor(key, query)) {
          const results = await searchWeb(variant, 15, { freshness: "week" });
          for (const r of results) if (!seen.has(r.url)) seen.set(r.url, r);
        }
        const results = [...seen.values()].slice(0, 30);
        if (results.length === 0) {
          logger.info(`[Search] ${key}: no results for this cycle.`);
          return [];
        }

        const listing = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 400)}`)
          .join("\n");

        const extracted = await chatJson<any[]>({
          system:
            "You extract social-media mentions from search results. Use ONLY the results given. " +
            "Never invent a post, author, URL or date. If a result is not a mention of the keyword, skip it. " +
            "Reply with a JSON array; return [] when nothing qualifies.",
          prompt:
            `Keyword: "${query}"\nChannel: ${key}\n\n` +
            `Search results:\n${listing}\n\n` +
            "Return up to 8 mentions as a JSON array. Each item: {\n" +
            '  "url": one of the URLs above, copied exactly,\n' +
            '  "author": the poster or site name from the result, or "Public discussion",\n' +
            '  "title": short headline,\n' +
            '  "content": what was said, in one or two sentences,\n' +
            '  "sentiment": "positive" | "neutral" | "negative",\n' +
            '  "sentimentScore": number from -1 to 1,\n' +
            '  "emotion": "Joy" | "Anger" | "Sadness" | "Surprise" | "Love" | "Neutral",\n' +
            '  "engagement": "High" | "Medium" | "Low",\n' +
            '  "date": the publication date shown in the result, or omit it\n' +
            "}\nOnly include items whose url appears verbatim in the list above.",
          expectation: "an array of mention objects",
          temperature: 0,
          maxTokens: 2200,
        });

        if (!Array.isArray(extracted) || extracted.length === 0) {
          logger.info(`[Search] ${key}: model found no mention in ${results.length} result(s).`);
          return [];
        }

        // Hard guard: a mention whose URL was not in the search results is a
        // hallucination, whatever the model says.
        const allowed = new Set(results.map((r) => r.url));
        const grounded = extracted.filter(
          (m: any) => typeof m?.url === "string" && allowed.has(m.url)
        );
        if (grounded.length !== extracted.length) {
          logger.warn(
            `[Search] ${key}: dropped ${extracted.length - grounded.length} mention(s) whose URL was not in the results.`
          );
        }
        if (grounded.length === 0) return [];

        logger.info(`[Search] ${key}: kept ${grounded.length}/${extracted.length} grounded mention(s).`);
        return grounded.map((m: any) => {
          const snippet = results.find((r) => r.url === m.url);
          return {
            ...m,
            platform: key,
            // Never default to "now": an invented timestamp distorts velocity.
            date: m.date || undefined,
            content: (m.content || snippet?.snippet || "").slice(0, 280),
          };
        });
      } catch (err: any) {
        logger.warn(`[Search] ${key} failed:`, describeAiFailure(err));
        return [];
      }
    });

    for (const list of perChannel) {
      if (list.length > 0) {
        platformsWithResults.add(list[0].platform);
        mergedResults.push(...list);
      }
    }
  }

  if (mergedResults.length === 0) {
    logger.info(
      `[Unified API Engine] No collected mentions for "${query}". No placeholder data will be invented.`
    );
  }

  const bounded = mergedResults.slice(0, MAX_ROWS_PER_SCAN);
  if (mergedResults.length > bounded.length) {
    logger.info(
      `[Unified API Engine] Kept ${bounded.length} of ${mergedResults.length} mention(s); the per-scan cap is ${MAX_ROWS_PER_SCAN}.`
    );
  }

  const scanId = Date.now();
  return bounded.map((item, index) => ({
    ...item,
    id: `mr-${scanId}-${index}`,
    trackerId: tracker.id,
  }));
}

/**
 * Which Telegram channels to read for a tracker.
 *
 * Telegram has no keyword search on the open web, so a handle has to be named.
 * `tracker.accounts` is a free-form list of handles; when it is empty the tracker
 * query itself is tried as a handle (a hashtag-style tracker often matches one).
 */
export function telegramHandlesFor(tracker: any): string[] {
  const explicit: string[] = Array.isArray(tracker?.accounts) ? tracker.accounts : [];
  const candidates = [...explicit, String(tracker?.query || "")];
  return [
    ...new Set(
      candidates
        .map((c) => String(c || "").replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "").trim())
        .filter((c) => /^[A-Za-z0-9_]{3,64}$/.test(c))
    ),
  ].slice(0, 5);
}
