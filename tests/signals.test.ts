/**
 * Signal arithmetic.
 *
 * This is the code that turns stored mentions into the numbers on the dashboard,
 * so its failure mode matters: a wrong sign or an invented percentage looks like
 * a measurement. Each case below pins one of those failure modes shut.
 */
import {
  buildPlatformSignals,
  computeSignalStrength,
  computeVelocity,
  countAuthors,
  groupByPlatform,
  meanEngagement,
  meanSentiment,
} from "../src/server/signals.ts";

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

// ---------------------------------------------------------------- grouping
const grouped = groupByPlatform([
  { platform: "x" },
  { platform: "twitter" },
  { platform: "Reddit" },
]);
check("x and twitter land in one bucket", grouped.get("twitter")?.length === 2, String(grouped.get("twitter")?.length));
check("platform keys are normalised to lower case", grouped.has("reddit"));

// ---------------------------------------------------------------- sentiment
check("mean sentiment is clamped", meanSentiment([{ sentimentScore: 1 }, { sentimentScore: 1 }]) === 1);
check("mean sentiment of nothing is zero", meanSentiment([]) === 0);
check("mean sentiment is rounded to two decimals",
  meanSentiment([{ sentimentScore: 0.33 }, { sentimentScore: 0.66 }]) === 0.49,
  String(meanSentiment([{ sentimentScore: 0.33 }, { sentimentScore: 0.66 }])));

// ----------------------------------------------------------------- velocity
check("no earlier half means no percentage", computeVelocity([{ date: hoursAgo(2) }], NOW) === null,
  String(computeVelocity([{ date: hoursAgo(2) }], NOW)));
check("a doubling is +100%", computeVelocity([
  { date: hoursAgo(2) }, { date: hoursAgo(4) }, { date: hoursAgo(18) },
], NOW) === 100, String(computeVelocity([{ date: hoursAgo(2) }, { date: hoursAgo(4) }, { date: hoursAgo(18) }], NOW)));
check("a halving is -50%", computeVelocity([
  { date: hoursAgo(2) }, { date: hoursAgo(18) }, { date: hoursAgo(20) },
], NOW) === -50, String(computeVelocity([{ date: hoursAgo(2) }, { date: hoursAgo(18) }, { date: hoursAgo(20) }], NOW)));
// One mention in each half is flat; the 40h-old row is outside the window and
// must not be counted in either half.
check("rows older than the window are ignored",
  computeVelocity([{ date: hoursAgo(2) }, { date: hoursAgo(18) }, { date: hoursAgo(40) }], NOW) === 0,
  String(computeVelocity([{ date: hoursAgo(2) }, { date: hoursAgo(18) }, { date: hoursAgo(40) }], NOW)));
// The future row is dropped, so only the 18h-old mention remains: one in the
// earlier half, none recent. -100% is the honest reading of that data.
check("a future timestamp is dropped rather than counted as recent",
  computeVelocity([{ date: hoursAgo(-5) }, { date: hoursAgo(18) }], NOW) === -100,
  String(computeVelocity([{ date: hoursAgo(-5) }, { date: hoursAgo(18) }], NOW)));
check("a channel with only future rows has no velocity",
  computeVelocity([{ date: hoursAgo(-5) }], NOW) === null);

// --------------------------------------------------------- signal strength
check("an empty channel is zero", computeSignalStrength({ buzzVolume: 0, recent: 0, sentimentScore: 0 }) === 0);
const quiet = computeSignalStrength({ buzzVolume: 60, recent: 30, sentimentScore: 0 });
const fresh = computeSignalStrength({ buzzVolume: 60, recent: 60, sentimentScore: 0 });
check("a fresher channel scores higher", fresh > quiet, `${quiet} vs ${fresh}`);
const angry = computeSignalStrength({ buzzVolume: 60, recent: 60, sentimentScore: -1 });
const neutral = computeSignalStrength({ buzzVolume: 60, recent: 60, sentimentScore: 0 });
check("strong feeling outranks indifference", angry > neutral, `${angry} vs ${neutral}`);
check("strength never leaves 0-100",
  [0, 1, 5, 500].every((v) => {
    const s = computeSignalStrength({ buzzVolume: v, recent: v, sentimentScore: v % 2 ? 1 : -1 });
    return s >= 0 && s <= 100;
  }));
// The defect this replaced: velocity was folded in as a raw percentage, so a
// collapsing channel lost points. Strength must not depend on direction.
check("strength takes no velocity argument at all", computeSignalStrength.length === 1);

// ------------------------------------------------------------- engagement
check("no published counts means null, not 0", meanEngagement([{}, {}]).avg === null);
check("engagement averages only measured rows",
  meanEngagement([{ engagementScore: 10 }, { engagementScore: 30 }, {}]).avg === 20,
  String(meanEngagement([{ engagementScore: 10 }, { engagementScore: 30 }, {}]).avg));
check("engagement reports how many rows it measured", meanEngagement([{ engagementScore: 1 }, {}]).samples === 1);

// ----------------------------------------------------------------- authors
check("the placeholder author is not a person",
  countAuthors([{ author: "Public discussion" }, { author: "Reddit user" }]) === 0);
check("distinct authors are counted once regardless of case",
  countAuthors([{ author: "Ani" }, { author: "ani" }, { author: "Budi" }]) === 2);

// ------------------------------------------------------------ whole table
const rows = buildPlatformSignals(
  [
    { platform: "reddit", date: hoursAgo(1), sentimentScore: -0.5, author: "a", engagementScore: 30 },
    { platform: "reddit", date: hoursAgo(20), sentimentScore: -0.3, author: "b" },
    { platform: "x", date: hoursAgo(2), sentimentScore: 0.4, author: "c", engagementScore: 10 },
  ],
  ["reddit", "twitter", "tiktok"],
  NOW
);
check("catalogue order is preserved", rows.map((r) => r.platform).join(",") === "reddit,twitter,tiktok", rows.map((r) => r.platform).join(","));
check("x mentions appear under twitter", rows[1].buzzVolume === 1, String(rows[1].buzzVolume));
check("an empty channel is still reported", rows[2].buzzVolume === 0 && rows[2].signalStrength === 0);
// One of the two reddit rows published a count (30); the other published none,
// so the average is 30 over one sample, not 15 over two.
check("engagement averages measured rows only", rows[0].avgEngagement === 30, String(rows[0].avgEngagement));
check("unmeasured rows are excluded from the sample", rows[0].engagementSamples === 1);
check("a channel with no counts at all reports null", meanEngagement([{}, {}]).avg === null);
check("every row carries its own sample size", rows[0].sampleSize === 2 && rows[2].sampleSize === 0);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
