# Signal capture recommendations

A concrete plan for collecting more, better signal from every channel that is
already wired up — ordered by signal gained per unit of work, and written so each
step can be shipped and verified on its own.

Every recommendation here obeys the project's standing rules:

- **no new spend** — only free tiers, self-hosted services, or endpoints that need
  no key at all;
- **no fabrication** — a metric that was not measured is omitted, never estimated;
- **honest labels** — if a channel cannot be collected, the UI says so instead of
  implying coverage;
- **secrets live in `.env` only** — every new credential below is added to
  `SECRET_ENV_VARS`, never to a settings screen.

Audit references: `AUDIT.md` sections 14–16, `src/channels.ts` (the catalogue),
`src/server/collectors.ts` (the fetchers), `src/server/search.ts` (the search leg).

---

## 0. Where the loss actually happens

The dashboard's numbers are downstream of five separate places where signal is
dropped. Fixing "we see too little" means fixing these, not adding more channels.

| # | Leak | Where | Effect |
| --- | --- | --- | --- |
| L1 | A manual scan **replaces** what that tracker already had | `replaceTrackerMentions` in `src/server/routes/analysis.ts:166` | one weak cycle erases a good one; history never accumulates |
| L2 | Each API collector returns 3–5 rows | `limit=4`, `maxResults=3`, `max_results=4`, `limit=5` in `collectors.ts` | the ceiling per platform is tiny even when the platform has thousands |
| L3 | Search channels are queried **one after another**, 8 results each, 4 mentions kept | `for (const platform of searchTargets)` in `collectors.ts:782` | a 13-channel tracker takes ~2 minutes and burns 13 model calls serially |
| L4 | Only `queryForChannel()` filters the search; the language is fixed to `en` | `search.ts` `queryForChannel` + `SEARCH_LANGUAGE` default | Indonesian brands miss Indonesian conversation |
| L5 | `sentimentScore` is computed but stored as `engagement` (a grade), never as a number | `toMention()` → `monitor_results.engagement` | velocity and signal strength are computed from a coarse string, and the raw count is discarded |

Fix L1–L5 before adding any new source. They are cheap, and they lift every
channel at once.

---

## 1. Correctness first: four things that quietly cost (or lie about) signal

These are not "more signal", they are "the signal you think you have". All four
are small, and two of them are outright bugs.

### 1.1 Reddit: a 4-row cap and a hard-coded US coordinate

```ts
// collectors.ts:256, 285-287
const url = `https://www.reddit.com/search.json?q=…&limit=4&sort=new`;
country: "Global", latitude: 37.0902, longitude: -95.7129
```

- `limit=4` is the smallest useful number on an endpoint that happily serves 100.
  Every Reddit mention carries a fixed US centroid, so any geo read is fiction.
- Reddit now 403s many unauthenticated `search.json` calls, especially from cloud
  IP ranges [1](https://www.redditapis.com/blogs/reddit-search-api-tutorial-2026),
  and the fix that operators report working is an OAuth **script** app with a
  descriptive User-Agent [2](https://www.reddit.com/r/redditdev/comments/1ca0lzz/403_only_on_json_endpoints/).

**Do:** raise `limit` to 25, use `sort=new` with `t=week`, drop the fake lat/long,
and add an optional free OAuth path (`REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET`,
client-credentials flow, no user login, no card). Until it is configured, keep
the anonymous call and say "anonymous, may be rate limited" in the channel detail
instead of claiming a healthy public API.

### 1.2 X / Twitter: `max_results=4` is an invalid request

```ts
// collectors.ts:343
max_results=4
```

The recent-search endpoint accepts **10–100** and returns 10 by default
[3](https://twitterapi.io/articles/twitter-api-v2-retrieve-tweets). A value of 4
is rejected, so this collector cannot have been returning anything since the
parameter was written. Anyone who configures `TWITTER_BEARER_TOKEN` today gets
zero signal and no error in the UI.

**Do:** use `max_results=25&expansions=author_id&user.fields=username,name` so
the author column shows `@handle` instead of `id:12345`, and mark the channel
`down` in the health report when the API answers 400/401 instead of silently
returning `[]`.

### 1.3 Mastodon: the search endpoint is auth-gated on the biggest instance

```ts
// collectors.ts:471
https://mastodon.social/api/v2/search?type=statuses
```

On `mastodon.social`, status search returns an empty `statuses` array when logged
out, and the public timeline answers 422 "requires an authenticated user"
[4](https://dev.to/viktorhendelmann/how-to-scrape-mastodon-with-go-profiles-posts-hashtags-across-servers-and-trends-2026-3ca8).
Hashtag timelines, however, stay open.

**Do:** stop relying on full-text search and collect from **hashtag timelines**
(`/api/v1/timelines/tag/:tag`, plus `:tag?any[]=…` for variants) which are public.
For a multi-word keyword, query the hashtag form of the keyword and its first
token. Keep the search call as a secondary path and treat "0 statuses" as
"instance gates search", not "nobody is talking".

### 1.4 Hashtags and titles fall back to invented text

```ts
// collectors.ts:236, 239
hashtags = ["#brandmonitoring", "#analisissentimen", "#sosmed"];
refinedTitle || "Analisis Konten Sosmed"
```

Every collected mention that has no hashtag gets the same three made-up tags, and
`MentionRow` renders up to four of them. This is the exact class of thing the
project bans everywhere else: a figure that looks collected but is not.

**Do:** return `[]` when a post has no hashtags, and drop the Indonesian skeleton
title for an empty string (the UI already falls back to the platform label).
Also move the remaining Indonesian strings in `collectors.ts` to English so the
whole catalogue stays one language.

---

## 2. Depth: get more out of every source already connected

### 2.1 Paginate the free collectors, don't just raise the number

These endpoints accept real pagination at no cost. Concretely:

| Channel | Now | Change | Gain |
| --- | --- | --- | --- |
| Hacker News (Algolia) | `hitsPerPage=5`, stories only | `hitsPerPage=50` + `tags=(story,comment)` + `numericFilters=created_at_i>…` | comments are where the sentiment is; stories alone are headlines |
| Bluesky | `limit=5&sort=latest` | `limit=50` + follow `cursor` for one extra page | 10–20x rows per cycle |
| Lemmy | `limit=5&sort=New` | `limit=50&sort=New` + second call with `sort=TopWeek` | catches discussion that is loud but not brand-new |
| Stack Overflow | `pagesize=5&sort=creation` | `pagesize=50` + a second call with `sort=votes` | duplicates and regressions live in upvoted old questions |
| GitHub issues | `per_page=5&sort=created` | `per_page=50` + `sort=updated` + `is:issue is:open` | a reopened complaint is a fresh signal |
| DEV Community | fetch 60, keep 4 | fetch `/api/articles/latest?per_page=1000` and filter by tag, then keyword | the current code reads `top=30`, which is a popularity ranking, not a search |
| Google News RSS | `hl=en-US&gl=US` | `hl=id&gl=ID&ceid=ID:id` when `SEARCH_LANGUAGE=id`, and keep the 5→20 item slice | Indonesian coverage for Indonesian brands |

Two rules while doing this: keep a per-channel timeout (already 8s), and cap the
**total** rows per cycle (e.g. 400) so a wider net cannot make a scan unbounded.

### 2.2 A second query framing per keyword

One keyword string in, one query out, is why coverage feels thin. Build a small
query set from each tracker and run the collectors against the union:

- `"<keyword>"` — exact phrase;
- `<keyword> review|complaint|problem|scam|refund` — intent-bearing operators
  catch the complaints that plain brand search misses;
- `@<keyword>` and `#<keyword>` for platforms where the handle/hashtag is the
  real entry point;
- the keyword plus each configured competitor, if the tracker names one.

Store `queryVariant` on each mention so the dashboard can show *which* framing
found it. This alone usually doubles recall on `grounding` channels.

### 2.3 Run search channels in parallel, and make the search leg cheaper

```ts
// collectors.ts:782 — sequential, one model call per channel
for (const platform of searchTargets) { … await searchWeb(…); await chatJson(…) }
```

- Run the 13 search-channel lookups with a small concurrency pool (3 at a time).
  Same quota, roughly a third of the wall-clock time, so a scan finishes before
  it is restarted.
- Send **all** search results for a channel in one model call (already the case)
  but raise the result count from 8 to 15 and keep 6–8 mentions instead of 4. The
  grounding guard (URL must appear in the results) still holds.
- Cache search responses for ~10 minutes keyed by `(provider, query)`. The
  background loop scans the stalest tracker every 2 minutes; without a cache the
  same query is re-bought repeatedly from the free quota.
- Ask the provider for **recent** results: SearXNG takes `time_range=week`, and
  Tavily takes `days=7`. Freshness is most of what "live signal" means.

### 2.4 Use SearXNG properly

The instance is already in `docker-compose.yml`. Three settings buy real recall,
all free:

- `categories=general,news,social` — the `social` category is where Mastodon and
  Reddit results come from;
- enable the `reddit` and `mastodon` engines in `deploy/searxng/settings.yml` so
  the social channels do not depend on a general engine's index;
- set `SEARCH_LANGUAGE=id` for Indonesian trackers and pass `language=all` as a
  second pass so English-language posts about an Indonesian brand are not lost.

---

## 3. Breadth: channels that are marked `planned` but are cheap to light up

`twitch` is currently the only `none`, and `medium`/`vimeo` are declared `api`
but have **no fetcher in `collectors.ts`** — searching for them returns nothing,
so their health row claims a capability the code does not have. Fix the claim or
build the collector; do not leave the middle state.

Free, no-card options, in order of value:

1. **Medium** — `https://medium.com/feed/tag/<keyword>` is public RSS. A ~40-line
   parser reusing the existing `decodeXml` gives real articles with real dates.
2. **Telegram** — public channel previews are already rendered at
   `https://t.me/s/<channel>`; parse the existing HTML for post text, time and
   views. No API, no key. This converts a `grounding` guess into a real row.
3. **YouTube without a key** — `youtube.com/feeds/videos.xml?search_query=…` is a
   public RSS search feed; it gives video titles, channels and publish dates for
   free, which removes the `YOUTUBE_API_KEY` dependency for basic discovery. Keep
   the keyed Data API for view counts, and note the quota reality: `search.list`
   costs 100 units of a 10,000/day budget, i.e. ~100 searches/day
   [5](https://outlierkit.com/resources/youtube-search-api/), so it must be
   rate-limited per cycle rather than called on every tick.
4. **Twitch** — the Helix endpoint needs an app client-credentials pair
   (`TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`, both free). Until then, keep it
   `planned`; do not promote it to `grounding` because search cannot see chat.
5. **Discord / WhatsApp / Snapchat** — genuinely not collectible without joining
   a server or a channel. Keep them in the catalogue, keep them labelled
   `grounding` with the honest detail, but stop listing them in the "select all"
   default so the UI does not promise coverage that no code produces.

For each of these, the pattern is the same: write the fetcher, add an assertion to
`tests/` using a local stub, and let `buildChannelHealth` report the real state.

---

## 4. Make density visible, not just volume

More rows only matter if the dashboard can rank them. Today:

- `engagement` is a **string** (`High|Medium|Low`) computed from a raw count, and
  the raw count is discarded. Two posts with 30 and 300 likes are identical.
- `sentimentScore` exists per mention but the channel table only shows a mean.
- `signalStrength` mixes volume, velocity and sentiment with fixed weights.

**Do (one schema change, additive):**

- add `engagement_score integer` (nullable) and `query_variant text` to
  `monitor_results`; backfill nothing, leave old rows null;
- keep `engagement` as the *derived* label so the UI needs no rewrite;
- recompute `signalStrength` from the real counts, and expose the three
  components in the channel tooltip so a number can be argued with.

This is what turns "we collected 400 rows" into "these 12 are the ones that
matter".

---

## 5. Suggested order of work

| Step | Change | Why first |
| --- | --- | --- |
| 1 | Reddit `limit=25`, no fake lat/long, honest health detail | one-line fixes to existing bugs |
| 2 | Twitter `max_results=25` + `expansions=author_id` | currently returns zero, always |
| 3 | Mastodon hashtag timeline | turns an empty collector into a real one |
| 4 | Remove invented hashtags/titles | removes the only fabrication left in the data path |
| 5 | Pagination + "top vs new" second pass on HN/Bluesky/Lemmy/SO/GitHub/DEV | 4–20x rows, zero cost |
| 6 | Manual scan merges instead of replaces (dedupe on `platform|url`) | history stops disappearing |
| 7 | Search channels in parallel + 10-minute cache + `time_range=week` | faster scans, same free quota |
| 8 | Query variants (`review`, `problem`, `#tag`, `@handle`) | biggest recall win per line of code |
| 9 | `SEARCH_LANGUAGE=id` for Indonesian trackers | correctness for the primary user |
| 10 | Medium / Telegram / YouTube RSS collectors | new sources, still free |
| 11 | `engagement_score` + `query_variant` columns | makes growth measurable |

Steps 1–6 need no new configuration at all. Steps 7–9 only touch env values that
already exist.

---

## 6. How to verify each step without a dashboard argument

- Every new fetcher gets a `tests/*.test.ts` case against a **local stub server**,
  the same pattern as `tests/search-collector.test.ts` — no live network in CI.
- The grounding guard (a mention's URL must appear in the search results) must be
  asserted again after step 7, because parallelising the loop is exactly the kind
  of change that can silently widen it.
- After steps 1–5, run one real scan and compare `rows per channel` before and
  after in the log line `[Search] <channel>: kept X/Y grounded mention(s)` and the
  collector's own counts. Numbers from the log, not from memory.
- `npm test` must stay green before any of this is called done; the suite is the
  contract that "more signal" did not become "more invention".

---

## 7. What is explicitly **not** recommended

- **Paying for a tier.** Every option above is free; the paid Brave/Tavily tiers
  buy quota, not coverage that matters here.
- **Scraping logged-in pages** (Instagram/Facebook/LinkedIn feeds). It breaks the
  SSRF allowlist, the terms of those sites, and the credibility of the audit.
- **Raising `MAX_MENTIONS` as a "fix".** Pruning is not the bottleneck; the
  per-call caps are.
- **Marking Discord/WhatsApp/Snapchat as collectible.** They are not, without
  joining a private room. Leave the label honest.
