/**
 * Collector shapes.
 *
 * Every collector talks to a public endpoint whose response shape we now depend
 * on. These tests run each one against a local stub that returns that shape, so a
 * renamed field, a dropped expansion or an off-by-one in pagination fails here
 * instead of silently producing an empty channel in production.
 *
 * No network access: `globalThis.fetch` is replaced per test.
 */
const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

const realFetch = globalThis.fetch;
type Handler = (url: string, init?: any) => { status?: number; body?: any; text?: string };
let handler: Handler = () => ({ status: 404, body: {} });
let calls: string[] = [];

function stub(next: Handler) {
  handler = next;
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    const out = handler(url, init);
    const status = out.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => out.body,
      text: async () => out.text ?? JSON.stringify(out.body ?? {}),
    } as any;
  }) as any;
}

async function main() {
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.TWITTER_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;

  const c = await import("../src/server/collectors.ts");

  // ---------------------------------------------------------------- Reddit
  stub((url) => {
    if (url.includes("/search.json")) {
      const sort = new URL(url).searchParams.get("sort");
      return {
        body: {
          data: {
            children: [
              {
                data: {
                  permalink: `/r/coffee/comments/${sort}1/x/`,
                  author: "someone",
                  title: "Kopi Kenangan price hike",
                  selftext: "now too expensive for what you get",
                  score: 40,
                  num_comments: 12,
                  created_utc: 1_700_000_000,
                },
              },
            ],
          },
        },
      };
    }
    return { status: 404, body: {} };
  });
  const reddit = await c.fetchRealRedditPosts("kopi kenangan");
  check("reddit asks for 25 rows, not 4", calls.every((u) => u.includes("limit=25")), calls[0]?.slice(0, 80));
  check("reddit runs two sort orders", calls.length === 2, `${calls.length} calls`);
  check("reddit rows carry a score", reddit[0]?.engagementScore === 52, String(reddit[0]?.engagementScore));
  check("reddit rows carry no invented coordinate",
    reddit.every((r: any) => r.latitude === undefined && r.longitude === undefined));
  check("reddit sentiment comes from the text", reddit[0]?.sentiment === "negative", reddit[0]?.sentiment);

  // Reddit with a client pair uses OAuth, not the anonymous host.
  process.env.REDDIT_CLIENT_ID = "id";
  process.env.REDDIT_CLIENT_SECRET = "secret";
  stub((url) => {
    if (url.includes("/api/v1/access_token")) return { body: { access_token: "tok", expires_in: 3600 } };
    if (url.includes("oauth.reddit.com")) return { body: { data: { children: [] } } };
    return { status: 404, body: {} };
  });
  await c.fetchRealRedditPosts("copilot");
  check("a client pair switches Reddit to OAuth", calls.some((u) => u.includes("oauth.reddit.com")));
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  // ------------------------------------------------------------------- X
  process.env.TWITTER_BEARER_TOKEN = "bearer";
  stub(() => ({
    body: {
      data: [
        {
          id: "9",
          text: "kopi kenangan enak banget",
          author_id: "77",
          created_at: "2026-01-01T00:00:00.000Z",
          public_metrics: { retweet_count: 3, like_count: 10, reply_count: 1, quote_count: 0 },
        },
      ],
      includes: { users: [{ id: "77", username: "pelanggan" }] },
    },
  }));
  const tweets = await c.fetchRealTweets("kopi kenangan");
  check("X requests an allowed max_results (10-100)",
    calls.every((u) => /max_results=(1[0-9]|[2-9][0-9]|100)\b/.test(u)), calls[0]?.slice(0, 120));
  check("X asks for the author expansion", calls[0].includes("expansions=author_id"));
  check("X shows a handle instead of an id", tweets[0]?.author === "@pelanggan", tweets[0]?.author);
  check("X sums the real engagement metrics", tweets[0]?.engagementScore === 14, String(tweets[0]?.engagementScore));

  // A rejected query must not look like silence.
  stub(() => ({ status: 400, text: "bad query" }));
  const rejected = await c.fetchRealTweets("x");
  check("a rejected X query returns nothing rather than a guess", rejected.length === 0);
  delete process.env.TWITTER_BEARER_TOKEN;

  // -------------------------------------------------------------- Mastodon
  stub((url) => {
    if (url.includes("/api/v1/timelines/tag/")) {
      return {
        body: [
          {
            url: "https://mastodon.social/@a/1",
            content: "<p>kopi kenangan <b>mahal</b></p>",
            created_at: "2026-01-01T00:00:00.000Z",
            account: { acct: "a" },
            reblogs_count: 2,
            favourites_count: 5,
            replies_count: 1,
          },
        ],
      };
    }
    return { body: { statuses: [] } };
  });
  const toots = await c.fetchMastodonPosts("Kopi Kenangan");
  check("mastodon reads a public hashtag timeline", calls.some((u) => u.includes("/api/v1/timelines/tag/")));
  check("mastodon strips HTML before analysing", !toots[0]?.content.includes("<p>"), toots[0]?.content);
  check("mastodon rows are negative for a complaint", toots[0]?.sentiment === "negative", toots[0]?.sentiment);
  check("hashtag candidates cover the phrase and its first word",
    c.hashtagCandidates("Kopi Kenangan").includes("kopikenangan") &&
      c.hashtagCandidates("Kopi Kenangan").includes("kopi"),
    c.hashtagCandidates("Kopi Kenangan").join(","));

  // --------------------------------------------------------------- YouTube
  const rssEntry = `<entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Review: Kopi Kenangan</title>
    <published>2026-01-02T00:00:00+00:00</published>
    <author><name>Kopi Review</name></author>
    <media:description>rasanya enak tapi mahal</media:description>
  </entry>`;
  stub((url) => {
    if (url.includes("feeds/videos.xml")) return { text: `<feed>${rssEntry}</feed>` };
    return { status: 404, body: {} };
  });
  const videos = await c.fetchRealYouTubeVideos("kopi kenangan");
  check("YouTube discovery works without an API key", videos.length === 1, `${videos.length} rows`);
  check("YouTube RSS rows carry title, author and date",
    videos[0]?.title === "Review: Kopi Kenangan" && videos[0]?.author === "Kopi Review" && Boolean(videos[0]?.date),
    `${videos[0]?.title} / ${videos[0]?.author}`);
  check("no view count is invented without a key", videos[0]?.engagementScore === undefined);

  // With a key, statistics are fetched in one call and attached.
  process.env.YOUTUBE_API_KEY = "key";
  stub((url) => {
    if (url.includes("feeds/videos.xml")) return { text: `<feed>${rssEntry}</feed>` };
    if (url.includes("/youtube/v3/videos")) {
      check("view counts use videos.list, not search.list", !url.includes("/search"), url.slice(0, 70));
      check("the API key is never in the query string", !url.includes("key="), url.slice(-40));
      return { body: { items: [{ id: "abc123", statistics: { viewCount: "1200", likeCount: "30" } }] } };
    }
    return { status: 404, body: {} };
  });
  const withCounts = await c.fetchRealYouTubeVideos("kopi kenangan");
  check("a key attaches real view counts", withCounts[0]?.engagementScore === 1230, String(withCounts[0]?.engagementScore));
  delete process.env.YOUTUBE_API_KEY;

  // ----------------------------------------------------------------- Twitch
  stub((url) => {
    if (url.includes("/oauth2/token")) return { body: { access_token: "t", expires_in: 3600 } };
    if (url.includes("/helix/search/channels")) {
      return {
        body: {
          data: [
            {
              broadcaster_login: "kopifan",
              display_name: "KopiFan",
              title: "Tasting Kopi Kenangan live",
              started_at: "2026-01-03T10:00:00Z",
            },
          ],
        },
      };
    }
    return { status: 404, body: {} };
  });
  check("twitch without a pair collects nothing", (await c.fetchTwitchStreams("kopi"))
    .length === 0 || calls.length === 0);
  process.env.TWITCH_CLIENT_ID = "cid";
  process.env.TWITCH_CLIENT_SECRET = "csecret";
  calls = [];
  const streams = await c.fetchTwitchStreams("kopi kenangan");
  check("twitch uses the Helix search endpoint", calls.some((u) => u.includes("/helix/search/channels")));
  check("twitch rows link to the channel", streams[0]?.url === "https://www.twitch.tv/kopifan", streams[0]?.url);
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;

  // ---------------------------------------------------------------- Medium
  stub(() => ({
    text: `<rss><channel>
      <item>
        <title>Kopi Kenangan and the price problem</title>
        <link>https://medium.com/@a/kopi-1</link>
        <description>&lt;p&gt;too expensive&lt;/p&gt;</description>
        <pubDate>Mon, 05 Jan 2026 00:00:00 GMT</pubDate>
        <dc:creator>Andi</dc:creator>
      </item>
    </channel></rss>`,
  }));
  const posts = await c.fetchMedium("Kopi Kenangan");
  check("medium reads the tag feed", calls[0]?.includes("/feed/tag/kopi-kenangan"), calls[0]);
  check("medium rows carry author and date", posts[0]?.author === "Andi" && Boolean(posts[0]?.date),
    `${posts[0]?.author} / ${posts[0]?.date}`);

  // -------------------------------------------------------------- Telegram
  const tgHtml = `<div class="tgme_widget_message_wrap" data-post="promohemat/12">
      <a class="tgme_widget_message_date" href="https://t.me/promohemat/12">
        <time datetime="2026-01-04T08:00:00+00:00"></time>
      </a>
      <div class="tgme_widget_message_text js-message_text" dir="auto">Promo <b>Kopi Kenangan</b> hari ini</div>
      <span class="tgme_widget_message_views">1.2K</span>
    </div>`;
  stub(() => ({ text: tgHtml }));
  const tg = await c.fetchTelegramChannel("@promohemat");
  check("telegram reads the public widget", calls[0] === "https://t.me/s/promohemat", calls[0]);
  check("telegram parses the post text", tg[0]?.content?.includes("Promo"), tg[0]?.content);
  check("telegram parses the view count", tg[0]?.engagementScore === 1200, String(tg[0]?.engagementScore));
  check("telegram reads a 1 234 style count", c.parseTelegramCount("1 234") === 1234);
  check("telegram reads a K suffix", c.parseTelegramCount("12.5K") === 12500);
  check("telegram returns nothing for a bad count", c.parseTelegramCount("views") === undefined);

  // ------------------------------------------------------- HN / SO / GitHub
  let hnTags: string[] = [];
  stub((url) => {
    const tags = new URL(url).searchParams.get("tags") || "";
    hnTags.push(tags);
    if (tags === "comment") {
      return { body: { hits: [{ objectID: "2", author: "b", comment_text: "<p>this is broken</p>", created_at: "2026-01-01T00:00:00Z" }] } };
    }
    return { body: { hits: [{ objectID: "1", author: "a", title: "Show HN: kopi", points: 10, created_at: "2026-01-01T00:00:00Z" }] } };
  });
  const hn = await c.fetchHackerNews("kopi");
  check("HN reads stories and comments", hnTags.includes("story") && hnTags.includes("comment"), hnTags.join("|"));
  check("HN keeps the comment body, not just the title", hn.some((r: any) => r.content.includes("broken")));

  stub((url) => {
    const sort = new URL(url).searchParams.get("sort");
    void url;
    return { body: { items: [{ link: `https://stackoverflow.com/q/${sort}`, title: "How to kopi", tags: ["js"], score: 4, answer_count: 1, creation_date: 1_700_000_000 }] } };
  });
  const so = await c.fetchStackOverflow("kopi");
  check("Stack Overflow runs newest and voted passes", calls.some((u) => u.includes("sort=creation")) && calls.some((u) => u.includes("sort=votes")));
  check("Stack Overflow de-duplicates across passes", so.length === 2, `${so.length}`);

  stub(() => ({
    body: { items: [{ html_url: "https://github.com/a/b/issues/1", title: "kopi crashes", user: { login: "dev" }, comments: 2, reactions: { total_count: 3 }, created_at: "2026-01-01T00:00:00Z" }] },
  }));
  const gh = await c.fetchGitHubIssues("kopi");
  check("GitHub scopes the search to issues", calls[0].includes("is%3Aissue"), calls[0].slice(0, 90));
  check("GitHub counts comments and reactions", gh[0]?.engagementScore === 5, String(gh[0]?.engagementScore));

  // ------------------------------------------------------ shared mention shape
  const sample = c.toMention({ platform: "reddit", url: "https://x", author: "", title: "", content: "", engagementValue: 3 });
  check("a mention always carries hashtags (possibly empty)", Array.isArray(sample.hashtags) && sample.hashtags.length === 0);
  check("a mention without a count has no score", c.toMention({ platform: "news", url: "https://y", author: "n", title: "t", content: "c" }).engagementScore === undefined);
  check("an authorless mention says so honestly", sample.author === "Public discussion", sample.author);

  globalThis.fetch = realFetch;
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
