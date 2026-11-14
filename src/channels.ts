/**
 * One record per platform, shared by the server and the UI.
 *
 * Each channel declares how it can actually be collected:
 *   - `api`       a documented public/keyed API is queried directly
 *   - `grounding` no public read API; only reachable through the model
 *   - `none`      no collector is implemented, so nothing is collected
 *
 * `none` is not a placeholder for "probably works": the health report says so
 * in as many words, and no credential is advertised for a channel that has no
 * collector behind it.
 *
 * `endpoint` and `credential` are what the health probe uses, so the audit of
 * "which networks are dead" is driven by data instead of by guesswork.
 */
export type ChannelKind = "api" | "grounding" | "none";

export interface ChannelSpec {
  key: string;
  label: string;
  /** Short description of what is actually collected. */
  collects: string;
  kind: ChannelKind;
  credential?: string;
  /** Probed with GET for the health check. */
  endpoint?: string;
  /** Expected HTTP statuses for a healthy network/probe. */
  okStatus?: number[];
}

export const CHANNEL_SPECS: ChannelSpec[] = [
  {
    key: "reddit",
    label: "Reddit",
    collects: "posts from public subreddit search",
    kind: "api",
    endpoint: "https://www.reddit.com/r/all/search.json?q=test&limit=1",
    okStatus: [200],
  },
  {
    key: "youtube",
    label: "YouTube",
    collects: "videos matching the keyword",
    kind: "api",
    credential: "YOUTUBE_API_KEY",
    endpoint: "https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1",
    okStatus: [200, 400, 403],
  },
  {
    key: "twitter",
    label: "X / Twitter",
    collects: "recent posts via API v2",
    kind: "api",
    credential: "TWITTER_BEARER_TOKEN",
    endpoint: "https://api.twitter.com/2/tweets/search/recent?query=test",
    okStatus: [200, 401, 403],
  },
  {
    key: "mastodon",
    label: "Mastodon",
    collects: "public statuses across instances",
    kind: "api",
    endpoint: "https://mastodon.social/api/v2/search?q=test&type=status",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    collects: "public posts from the AT Protocol",
    kind: "api",
    endpoint: "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=test&limit=1",
    okStatus: [200],
  },
  {
    key: "news",
    label: "Google News",
    collects: "news articles and coverage",
    kind: "api",
    endpoint: "https://news.google.com/rss/search?q=test",
  },
  {
    key: "hackernews",
    label: "Hacker News",
    collects: "stories and comments",
    kind: "api",
    endpoint: "https://hn.algolia.com/api/v1/search?query=test&tags=story",
  },
  {
    key: "lemmy",
    label: "Lemmy",
    collects: "posts and comments across instances",
    kind: "api",
    endpoint: "https://lemmy.world/api/v3/search?q=test&type_=Posts&limit=1",
  },
  {
    key: "github",
    label: "GitHub",
    collects: "issues, discussions and repositories",
    kind: "api",
    credential: "GITHUB_TOKEN",
    endpoint: "https://api.github.com/search/issues?q=test&per_page=1",
    okStatus: [200, 403],
  },
  {
    key: "stackoverflow",
    label: "Stack Overflow",
    collects: "questions that mention the keyword",
    kind: "api",
    endpoint: "https://api.stackexchange.com/2.3/search?order=desc&sort=activity&intitle=test&site=stackoverflow",
  },
  {
    key: "devto",
    label: "DEV Community",
    collects: "articles and comments",
    kind: "api",
    endpoint: "https://dev.to/api/articles?per_page=1",
  },
  {
    key: "medium",
    label: "Medium",
    collects: "publication posts via RSS",
    kind: "api",
    endpoint: "https://medium.com/feed/tag/technology",
  },
  {
    key: "vimeo",
    label: "Vimeo",
    collects: "public videos via oEmbed",
    kind: "api",
    endpoint: "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871",
  },
  {
    key: "twitch",
    label: "Twitch",
    collects: "no collector yet",
    kind: "none",
    endpoint: "https://api.twitch.tv/helix/games/top?first=1",
    okStatus: [200, 401, 403],
  },
  {
    key: "tiktok",
    label: "TikTok",
    collects: "public videos, discovered through search",
    kind: "grounding",
  },
  {
    key: "instagram",
    label: "Instagram",
    collects: "public posts, discovered through search",
    kind: "grounding",
  },
  {
    key: "facebook",
    label: "Facebook",
    collects: "public pages and groups, discovered through search",
    kind: "grounding",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    collects: "public posts, discovered through search",
    kind: "grounding",
  },
  {
    key: "threads",
    label: "Threads",
    collects: "public posts, discovered through search",
    kind: "grounding",
  },
  {
    key: "telegram",
    label: "Telegram",
    collects: "public channel posts, discovered through search",
    kind: "grounding",
  },
  {
    key: "discord",
    label: "Discord",
    collects: "public server discussions, discovered through search",
    kind: "grounding",
  },
  {
    key: "pinterest",
    label: "Pinterest",
    collects: "pins and boards, discovered through search",
    kind: "grounding",
  },
  {
    key: "snapchat",
    label: "Snapchat",
    collects: "public stories, discovered through search",
    kind: "grounding",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    collects: "public channel previews, discovered through search",
    kind: "grounding",
  },
  {
    key: "forums",
    label: "Review sites & forums",
    collects: "reviews and threads from the open web",
    kind: "grounding",
  },
];

export const CHANNEL_KEYS = CHANNEL_SPECS.map((c) => c.key);

export function channelSpec(key: string): ChannelSpec | undefined {
  return CHANNEL_SPECS.find((c) => c.key === key.toLowerCase());
}

export function channelLabelOf(key: string): string {
  return channelSpec(key)?.label ?? key;
}
