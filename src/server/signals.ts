/**
 * Signal aggregation maths.
 *
 * These functions used to live inline in the route, where they could not be
 * tested — and they had two problems that mattered more than style:
 *
 *  1. `signalStrength` added `velocity * 0.35`, so a channel whose velocity was
 *     -80% scored 28 points *lower* than a quiet one, and the result could go
 *     negative and was then clamped to 0. Direction (up/down) is not strength.
 *  2. Velocity divided by the earlier half of the window, so a channel that
 *     received its first mention today reported "100%" — a number invented by a
 *     division guard, not a measurement.
 *
 * Nothing here invents a figure: when the data cannot support a number, the
 * value is null and the UI shows a dash.
 */

export interface MentionLike {
  platform?: string;
  date?: string;
  sentimentScore?: number;
  author?: string;
  engagementScore?: number;
}

export interface PlatformSignal {
  platform: string;
  buzzVolume: number;
  sentimentScore: number;
  /** Percent change against the previous half-window, or null when there is no
   *  earlier half to compare against. */
  velocity: number | null;
  signalStrength: number;
  activeUsersCount: number;
  sampleSize: number;
  /** Mean of real engagement counts, or null when no row published one. */
  avgEngagement: number | null;
  engagementSamples: number;
}

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const HALF_WINDOW_MS = WINDOW_MS / 2;

/** Volume at which the volume component of signal strength is full. */
const VOLUME_SATURATION = 60;

/** Groups mentions by channel, treating "x" as "twitter" so they never split. */
export function groupByPlatform(mentions: MentionLike[]): Map<string, MentionLike[]> {
  const groups = new Map<string, MentionLike[]>();
  for (const item of mentions) {
    const raw = String(item.platform || "unknown").toLowerCase();
    const key = raw === "x" ? "twitter" : raw;
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

/**
 * Signal strength, 0–100.
 *
 * Three measured components, each already 0–100:
 *  - volume: how many mentions, saturating at VOLUME_SATURATION;
 *  - recency: how much of the channel's traffic happened in the last 12 hours;
 *  - sentiment: how strong the feeling is, regardless of direction (an angry
 *    channel is a strong signal, which is the point of a monitoring tool).
 *
 * Velocity is deliberately NOT a component. A collapsing channel is not a weak
 * signal, and a negative percentage used to subtract from the score.
 */
export function computeSignalStrength(args: {
  buzzVolume: number;
  recent: number;
  sentimentScore: number;
}): number {
  if (args.buzzVolume === 0) return 0;
  const volume = Math.min(100, (args.buzzVolume / VOLUME_SATURATION) * 100);
  const recency = Math.min(100, (args.recent / args.buzzVolume) * 100);
  const sentiment = (Math.abs(args.sentimentScore) + 1) * 50;
  const score = volume * 0.4 + recency * 0.3 + sentiment * 0.3;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Mean sentiment, clamped to [-1, 1] and rounded to two decimals. */
export function meanSentiment(items: MentionLike[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, item) => acc + (Number(item.sentimentScore) || 0), 0);
  const mean = sum / items.length;
  return Number(Math.max(-1, Math.min(1, mean)).toFixed(2));
}

/**
 * Change in mention count between the two halves of the window.
 *
 * Null when the earlier half is empty: "went from 0 to 4" has no honest
 * percentage, and returning 100 there was a division guard wearing a number's
 * clothes.
 */
export function computeVelocity(items: MentionLike[], now = Date.now()): number | null {
  let recent = 0;
  let earlier = 0;
  for (const item of items) {
    const at = new Date(item.date || 0).getTime();
    if (!Number.isFinite(at)) continue;
    const age = now - at;
    if (age < 0) continue; // a future timestamp is a data error, not a trend
    if (age <= HALF_WINDOW_MS) recent++;
    else if (age <= WINDOW_MS) earlier++;
  }
  if (earlier === 0) return null;
  return Number((((recent - earlier) / earlier) * 100).toFixed(1));
}

/** Counts mentions inside the last 12 hours. */
export function countRecent(items: MentionLike[], now = Date.now()): number {
  return items.filter((item) => {
    const at = new Date(item.date || 0).getTime();
    return Number.isFinite(at) && now - at >= 0 && now - at <= HALF_WINDOW_MS;
  }).length;
}

/** Distinct authors, ignoring the placeholder used when a source names nobody. */
export function countAuthors(items: MentionLike[]): number {
  const authors = new Set(
    items
      .map((item) => String(item.author || "").trim().toLowerCase())
      .filter((name) => name && name !== "public discussion" && name !== "reddit user")
  );
  return authors.size;
}

/** Mean of the engagement counts a source actually published. */
export function meanEngagement(items: MentionLike[]): { avg: number | null; samples: number } {
  const values = items
    .map((item) => item.engagementScore)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return { avg: null, samples: 0 };
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { avg, samples: values.length };
}

/** Builds one row per channel, in catalogue order, including empty channels. */
export function buildPlatformSignals(
  mentions: MentionLike[],
  platforms: string[],
  now = Date.now()
): PlatformSignal[] {
  const groups = groupByPlatform(mentions);
  return platforms.map((platform) => {
    const key = platform.toLowerCase() === "x" ? "twitter" : platform.toLowerCase();
    const items = groups.get(key) || [];
    const sentimentScore = meanSentiment(items);
    const velocity = computeVelocity(items, now);
    const engagement = meanEngagement(items);
    return {
      platform,
      buzzVolume: items.length,
      sentimentScore,
      velocity,
      signalStrength: computeSignalStrength({
        buzzVolume: items.length,
        recent: countRecent(items, now),
        sentimentScore,
      }),
      activeUsersCount: countAuthors(items),
      sampleSize: items.length,
      avgEngagement: engagement.avg,
      engagementSamples: engagement.samples,
    };
  });
}
