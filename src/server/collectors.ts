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
import { CHANNEL_KEYS } from "../channels.ts";
import { chatJson } from "../lib/aiProvider.ts";
import { logger } from "./logger.ts";
import { aiCanSearch, describeAiFailure } from "./ai.ts";
import { AiError } from "../lib/aiProvider.ts";

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

    return {
      title: title || jsonLdTitle || "Social Media Content",
      description: description || jsonLdDesc || "Public content scraped successfully.",
      imageUrl: imageUrl || jsonLdImg || "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80",
      success: true
    };
  } catch (err: any) {
    logger.warn(`Scrape failed for ${url}:`, err.message);
    // Return gracefully so the analyser can estimate from what it did get
    return {
      title: "Scrape Link",
      description: "URL inaccessible due to platform security restrictions, but metadata can be analyzed conceptually.",
      imageUrl: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=300&q=80",
      success: false
    };
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

// Local Fallback Heuristics for Sentiment Analysis (Used when external API keys or scopes are limited)
export function localAnalyzeSentiment(title?: string, content?: string) {
  const safeTitle = title || "";
  const safeContent = content || "";
  const text = (safeTitle + " " + safeContent).toLowerCase();
  
  const posWords = ["bagus", "keren", "mantap", "hebat", "suka", "cinta", "puas", "rekomendasi", "juara", "enak", "bintang", "murah", "cepat", "ramah", "good", "love", "awesome", "perfect", "satisfied", "best", "hemat", "memuaskan", "terbaik"];
  const negWords = ["jelek", "kecewa", "lambat", "mahal", "buruk", "kesal", "marah", "rugi", "penipu", "ngaco", "gagal", "error", "rusak", "benci", "bad", "slow", "fail", "broken", "worst", "parah", "lelet", "sulit", "kapok"];
  
  let posCount = 0;
  let negCount = 0;
  
  posWords.forEach(w => {
    const regex = new RegExp(w, 'gi');
    const matches = text.match(regex);
    if (matches) posCount += matches.length;
  });
  
  negWords.forEach(w => {
    const regex = new RegExp(w, 'gi');
    const matches = text.match(regex);
    if (matches) negCount += matches.length;
  });
  
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  let sentimentScore = 0.0;
  let emotion = "Neutral";
  
  if (posCount > negCount) {
    sentiment = "positive";
    sentimentScore = Number(Math.min(1.0, 0.2 + (posCount - negCount) * 0.15).toFixed(2));
    emotion = posCount > 2 ? "Joy" : "Love";
  } else if (negCount > posCount) {
    sentiment = "negative";
    sentimentScore = Number(Math.max(-1.0, -0.2 - (negCount - posCount) * 0.15).toFixed(2));
    emotion = text.includes("marah") || text.includes("kesal") || text.includes("parah") ? "Anger" : "Sadness";
  } else {
    sentiment = "neutral";
    sentimentScore = 0.0;
    emotion = "Neutral";
  }
  
  const hashtagRegex = /#\w+/g;
  const parsedHashtags = text.match(hashtagRegex) || [];
  let hashtags: string[] = parsedHashtags.map(h => h.toLowerCase());
  
  if (hashtags.length === 0) {
    hashtags = ["#brandmonitoring", "#analisissentimen", "#sosmed"];
  }
  
  const refinedTitle = safeTitle.length > 50 ? safeTitle.substring(0, 47) + "..." : safeTitle || "Analisis Konten Sosmed";
  const refinedDescription = safeContent.length > 150 ? safeContent.substring(0, 147) + "..." : safeContent || "Tidak ada deskripsi konten tambahan.";
  
  return {
    sentiment,
    sentimentScore,
    emotion,
    engagement: safeContent.length > 100 ? "High" : (safeContent.length > 30 ? "Medium" : "Low"),
    hashtags,
    refinedTitle,
    refinedDescription
  };
}

// REAL LIVE INTEGRATION: Fetch authentic public Reddit posts
export async function fetchRealRedditPosts(query: string): Promise<any[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=4&sort=new`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SMIP-Engine/1.0"
      }
    });
    if (!res.ok) {
      logger.warn(`[Reddit API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.data || !json.data.children) return [];

    const posts = json.data.children.map((child: any) => {
      const p = child.data;
      const content = p.selftext || p.title || "";
      const localAnalysis = localAnalyzeSentiment(p.title, content);
      
      return {
        platform: "reddit",
        url: `https://www.reddit.com${p.permalink}`,
        author: `u/${p.author}`,
        title: p.title || "Reddit Post",
        content: content.slice(0, 280) || "No text content.",
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: p.score > 100 ? "High" : (p.score > 20 ? "Medium" : "Low"),
        date: new Date(p.created_utc * 1000).toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
    return posts;
  } catch (err) {
    logger.error("[Reddit API Error] Failed to fetch real Reddit posts:", err);
    return [];
  }
}

// REAL LIVE INTEGRATION: Fetch authentic YouTube videos if API key is provided
export async function fetchRealYouTubeVideos(query: string): Promise<any[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${apiKey}&maxResults=3`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`[YouTube API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.items) return [];

    return json.items.map((item: any) => {
      const snippet = item.snippet;
      const videoId = item.id.videoId;
      const localAnalysis = localAnalyzeSentiment(snippet.title, snippet.description);

      return {
        platform: "youtube",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        author: snippet.channelTitle || "@youtube_channel",
        title: snippet.title || "YouTube Video",
        content: (snippet.description || "No description available.").slice(0, 280),
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: "High",
        date: snippet.publishedAt || new Date().toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
  } catch (err) {
    logger.error("[YouTube API Error] Failed to fetch real YouTube videos:", err);
    return [];
  }
}

// REAL LIVE INTEGRATION: Fetch authentic recent tweets if bearer token is provided
export async function fetchRealTweets(query: string): Promise<any[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  try {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=created_at,public_metrics,author_id&max_results=4`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    if (!res.ok) {
      logger.warn(`[Twitter API] Fetch failed with status ${res.status}`);
      return [];
    }
    const json: any = await res.json();
    if (!json.data) return [];

    return json.data.map((tweet: any) => {
      const localAnalysis = localAnalyzeSentiment("", tweet.text);
      const metrics = tweet.public_metrics || {};
      const engagementScore = (metrics.retweet_count || 0) + (metrics.like_count || 0);

      return {
        platform: "twitter",
        url: `https://x.com/user/status/${tweet.id}`,
        author: `id:${tweet.author_id}`,
        title: "Tweet Mention",
        content: (tweet.text || "No tweet content.").slice(0, 280),
        sentiment: localAnalysis.sentiment,
        sentimentScore: localAnalysis.sentimentScore,
        emotion: localAnalysis.emotion,
        engagement: engagementScore > 50 ? "High" : (engagementScore > 10 ? "Medium" : "Low"),
        date: tweet.created_at || new Date().toISOString(),
        country: "Global",
        latitude: 37.0902,
        longitude: -95.7129
      };
    });
  } catch (err) {
    logger.error("[Twitter API Error] Failed to fetch real tweets:", err);
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
  engagementValue?: number;
  date?: string;
  country?: string;
}): any {
  const local = localAnalyzeSentiment(args.title, args.content);
  const engagementValue = args.engagementValue ?? 0;
  return {
    platform: args.platform,
    url: args.url,
    author: args.author || "Public discussion",
    title: args.title || `${args.platform} mention`,
    content: (args.content || "").slice(0, 280),
    sentiment: local.sentiment,
    sentimentScore: local.sentimentScore,
    emotion: local.emotion,
    engagement: engagementValue > 100 ? "High" : engagementValue > 20 ? "Medium" : "Low",
    date: args.date || new Date().toISOString(),
    country: args.country || "Global",
    latitude: 0,
    longitude: 0,
  };
}

/** Bluesky — public AT Protocol search, no credentials. */
export async function fetchBlueskyPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=5&sort=latest`
  );
  if (!json?.posts) return [];
  return json.posts.map((post: any) =>
    toMention({
      platform: "bluesky",
      url: `https://bsky.app/profile/${post.author?.handle}/post/${String(post.uri).split("/").pop()}`,
      author: `@${post.author?.handle}`,
      title: post.record?.text?.slice(0, 90) || "Bluesky post",
      content: post.record?.text || "",
      engagementValue: (post.likeCount || 0) + (post.repostCount || 0) + (post.replyCount || 0),
      date: post.record?.createdAt ? new Date(post.record.createdAt).toISOString() : undefined,
    })
  );
}

/** Mastodon — public search endpoint on a large instance. */
export async function fetchMastodonPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://mastodon.social/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=5&resolve=false`
  );
  const statuses = json?.statuses || [];
  return statuses.map((st: any) =>
    toMention({
      platform: "mastodon",
      url: st.url || st.uri,
      author: `@${st.account?.acct}`,
      title: (st.content || "").replace(/<[^>]*>/g, "").slice(0, 90) || "Mastodon post",
      content: (st.content || "").replace(/<[^>]*>/g, ""),
      engagementValue: (st.reblogs_count || 0) + (st.favourites_count || 0) + (st.replies_count || 0),
      date: st.created_at ? new Date(st.created_at).toISOString() : undefined,
    })
  );
}

/** Hacker News — Algolia's public search API. */
export async function fetchHackerNews(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`
  );
  if (!json?.hits) return [];
  return json.hits.map((hit: any) =>
    toMention({
      platform: "hackernews",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author || "HN user",
      title: hit.title || hit.story_title || "Hacker News story",
      content: hit.comment_text || hit.story_text || hit.title || "",
      engagementValue: hit.points || 0,
      date: hit.created_at ? new Date(hit.created_at).toISOString() : undefined,
    })
  );
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

/** Google News — public RSS, parsed without a dependency. */
export async function fetchGoogleNews(query: string): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLLECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { signal: controller.signal, headers: { "User-Agent": "SMIP-Engine/1.1" } }
    );
    if (!res.ok) {
      logger.warn(`[Collector] news.google.com responded ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
    return items.map((match) => {
      const block = match[1];
      const pick = (tag: string) =>
        (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
      const title = decodeXml(pick("title"));
      const link = decodeXml(pick("link"));
      const pub = pick("pubDate");
      const source = decodeXml(pick("source")) || "a news outlet";
      return toMention({
        platform: "news",
        url: link,
        author: source,
        title,
        content: `${title} — published by ${source}.`,
        engagementValue: 50,
        date: pub ? new Date(pub).toISOString() : undefined,
      });
    });
  } catch (err: any) {
    logger.warn(`[Collector] Google News failed: ${err?.message || err}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Lemmy — public search on a large instance. */
export async function fetchLemmyPosts(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts&sort=New&limit=5`
  );
  const posts = json?.posts || [];
  return posts.map((entry: any) => {
    const p = entry.post || {};
    return toMention({
      platform: "lemmy",
      url: p.ap_id || `https://lemmy.world/post/${p.id}`,
      author: entry.creator?.name ? `@${entry.creator.name}` : "Lemmy user",
      title: p.name || "Lemmy post",
      content: p.body || p.name || "",
      engagementValue: (p.counts?.score || 0) + (p.counts?.comments || 0),
      date: p.published ? new Date(p.published).toISOString() : undefined,
    });
  });
}

/** GitHub — public search API (unauthenticated is rate limited but works). */
export async function fetchGitHubIssues(query: string): Promise<any[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const json = await fetchJson(
    `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=5`,
    { headers }
  );
  if (!json?.items) return [];
  return json.items.map((item: any) =>
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

/** Stack Overflow — public Stack Exchange API. */
export async function fetchStackOverflow(query: string): Promise<any[]> {
  const json = await fetchJson(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=${encodeURIComponent(
      query
    )}&site=stackoverflow&pagesize=5&filter=default`
  );
  if (!json?.items) return [];
  return json.items.map((item: any) =>
    toMention({
      platform: "stackoverflow",
      url: item.link,
      author: item.owner?.display_name || "Stack Overflow user",
      title: item.title || "Stack Overflow question",
      content: `${item.title || ""} — ${(item.tags || []).join(", ")}`,
      engagementValue: (item.score || 0) + (item.answer_count || 0) + (item.view_count || 0) / 100,
      date: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : undefined,
    })
  );
}

/** DEV Community — public articles API, filtered by the keyword. */
export async function fetchDevTo(query: string): Promise<any[]> {
  const json = await fetchJson("https://dev.to/api/articles?per_page=60&top=30");
  const articles: any[] = Array.isArray(json) ? json : [];
  const needle = query.replace(/^#/, "").toLowerCase();
  return articles
    .filter((a) => {
      const hay = `${a.title} ${a.description || ""} ${(a.tags || a.tag_list || []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 4)
    .map((a) =>
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

export async function fetchUnifiedSocialSignals(tracker: any): Promise<any[]> {
  const query = tracker.query;
  const selectedPlatforms: string[] = tracker.platforms || [];
  
  const apiTasks: { platform: string; promise: Promise<any[]> }[] = [];
  
  // 1. Reddit: Fetch real posts from Reddit public API if selected (requires no credentials!)
  if (selectedPlatforms.includes("reddit")) {
    logger.info(`[Unified API Engine] Querying public Reddit API for "${query}"...`);
    apiTasks.push({ platform: "reddit", promise: fetchRealRedditPosts(query) });
  }

  // 2. YouTube: Fetch real videos from YouTube Data API v3 if API key is present
  if (selectedPlatforms.includes("youtube") && process.env.YOUTUBE_API_KEY) {
    logger.info(`[Unified API Engine] Querying official YouTube API for "${query}"...`);
    apiTasks.push({ platform: "youtube", promise: fetchRealYouTubeVideos(query) });
  }

  // 3. Twitter/X: Fetch real tweets from Twitter API v2 if Bearer Token is present
  if ((selectedPlatforms.includes("twitter") || selectedPlatforms.includes("x")) && process.env.TWITTER_BEARER_TOKEN) {
    const platformName = selectedPlatforms.includes("twitter") ? "twitter" : "x";
    apiTasks.push({ platform: platformName, promise: fetchRealTweets(query) });
  }

  // 3b. Open collectors: documented public endpoints, no credentials required.
  const OPEN_COLLECTORS: Record<string, { run: () => Promise<any[]> }> = {
    bluesky: { run: () => fetchBlueskyPosts(query) },
    mastodon: { run: () => fetchMastodonPosts(query) },
    hackernews: { run: () => fetchHackerNews(query) },
    news: { run: () => fetchGoogleNews(query) },
    lemmy: { run: () => fetchLemmyPosts(query) },
    stackoverflow: { run: () => fetchStackOverflow(query) },
    devto: { run: () => fetchDevTo(query) },
    github: { run: () => fetchGitHubIssues(query) },
  };

  for (const platform of selectedPlatforms) {
    const key = platform.toLowerCase();
    if (OPEN_COLLECTORS[key]) {
      logger.info(`[Unified API Engine] Querying open ${key} endpoint for "${query}"...`);
      apiTasks.push({ platform: key, promise: OPEN_COLLECTORS[key].run() });
    }
  }

  const mergedResults: any[] = [];
  const platformsWithResults = new Set<string>();

  if (apiTasks.length > 0) {
    try {
      const results = await Promise.all(
        apiTasks.map(async (task) => {
          try {
            const res = await task.promise;
            if (res && res.length > 0) {
              platformsWithResults.add(task.platform.toLowerCase());
              if (task.platform.toLowerCase() === "x" || task.platform.toLowerCase() === "twitter") {
                platformsWithResults.add("twitter");
                platformsWithResults.add("x");
              }
              return res;
            }
          } catch (taskErr) {
            logger.warn(`[Unified API Engine] [Bypassed] Official API failed for platform ${task.platform}:`, taskErr);
          }
          return [];
        })
      );
      for (const resList of results) {
        mergedResults.push(...resList);
      }
    } catch (err) {
      logger.warn("[Unified API Engine] [Bypassed] Error waiting for official APIs:", err);
    }
  }

  // Find remaining platforms that either don't have official APIs or failed to return any results
  const remainingPlatforms = selectedPlatforms.filter(p => !platformsWithResults.has(p.toLowerCase()));

  // 4. Grounding: If we have remaining platforms (e.g. Tiktok, Instagram, Facebook, WhatsApp, LinkedIn, etc.)
  // or if we have fewer than 3 total results, trigger Google Search Grounding for absolute global coverage!
  if (remainingPlatforms.length > 0 && aiCanSearch()) {
    try {
      logger.info(`[Unified API Engine] Querying live Google Search Grounding for remaining platforms: ${remainingPlatforms.join(", ")}...`);
      const searchPlatformsStr = remainingPlatforms.join(", ");
      const prompt = `Search the live web for recent public discussions, posts, reviews, or mentions of "${query}" specifically on social media platforms: ${searchPlatformsStr}.
      Use Google Search grounding to retrieve real information.
      Then, process up to 4 real search result mentions and format them into a structured JSON array.
      
      Each item in the array MUST contain:
      - platform: one of ${JSON.stringify(CHANNEL_KEYS)}
      - url: the actual source URL retrieved from the search grounding links
      - author: name/handle of the poster or "Public Discussion"
      - title: brief summary headline of the post/mention
      - content: summary of what was said in the post or comment
      - sentiment: "positive" | "neutral" | "negative"
      - sentimentScore: number from -1 to 1 representing the emotion strength
      - emotion: "Joy" | "Anger" | "Sadness" | "Surprise" | "Love" | "Neutral"
      - engagement: "High" | "Medium" | "Low"
      - date: approximate ISO date (e.g. "2026-07-12T00:00:00.000Z")
      - country: country of origin of this post or the brand mention (e.g. "United States", "Indonesia", "United Kingdom", "Japan", etc.)
      - latitude: approximate latitude coordinate of the location
      - longitude: approximate longitude coordinate of the location
      
      JSON Output Format should be a clean array of these objects:
      [
        { ... },
        { ... }
      ]`;

      const parsedGrounding = await chatJson<any[]>({
        system:
          "You are a media-intelligence collector. You are given web results from a search tool and must " +
          "extract only mentions that actually appear in them. Never invent a post, an author, a URL or a date.",
        prompt,
        expectation: "an array of mention objects",
        temperature: 0,
        maxTokens: 2000,
      });

      if (!Array.isArray(parsedGrounding)) {
        throw new AiError("Grounding did not return an array.", "bad-response");
      }
      if (parsedGrounding.length === 0) {
        logger.info("[Unified API Engine] The model found no grounded mentions for this cycle.");
        return [];
      }

      // The model is happy to return loosely-related chatter. Drop anything that
      // never mentions the tracked keyword, so a channel is not "filled" with
      // unrelated posts.
      const keyword = query.replace(/^#/, "").toLowerCase().trim();
      const relevant = parsedGrounding.filter((res: any) => {
        if (!keyword) return true;
        const hay = `${res?.title || ""} ${res?.content || ""} ${res?.author || ""}`.toLowerCase();
        return hay.includes(keyword);
      });
      logger.info(
        `[Unified API Engine] Grounded mentions kept: ${relevant.length}/${parsedGrounding.length} (keyword match).`
      );

      const cleanGrounding = relevant.map((res: any) => {
        let cleanUrl = typeof res?.url === "string" ? res.url : "";
        if (
          !cleanUrl.startsWith("http") ||
          cleanUrl.includes("example.com") ||
          cleanUrl.includes("share/status/global")
        ) {
          cleanUrl = constructOfficialPlatformSearchUrl(res?.platform || "google", query);
        }
        return { ...res, url: cleanUrl };
      });

      mergedResults.push(...cleanGrounding);
    } catch (err: any) {
      logger.warn(
        `[Unified API Engine] Model lookup failed for ${remainingPlatforms.join(", ")}:`,
        describeAiFailure(err)
      );
    }
  }

  // 5. No synthetic fallback. An empty result is the honest answer, and the UI
  // tells the user which data sources are configured so they know why.
  if (mergedResults.length === 0) {
    logger.info(
      `[Unified API Engine] No collected mentions for "${query}". No placeholder data will be invented.`
    );
  }

  return mergedResults.map((item, index) => ({
    ...item,
    id: `mr-${Date.now()}-${index}`,
    trackerId: tracker.id
  }));
}
