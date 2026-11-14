/**
 * Sentiment lexicon.
 *
 * The local analyser decides the sentiment of every automatically collected
 * mention, so its edges matter more than its averages. These cases are the ones
 * the older substring matcher got wrong: negation, stems, and the fact that a
 * post with no hashtag must report no hashtag.
 */
import { analyzeSentiment, engagementGrade, extractHashtags, tokenize } from "../src/server/lexicon.ts";

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

// 1. Plain verdicts.
const love = analyzeSentiment("", "great service, love it");
check("obvious praise is positive", love.sentiment === "positive", `${love.sentiment} ${love.sentimentScore}`);
const bad = analyzeSentiment("", "mahal dan lambat");
check("obvious complaint is negative", bad.sentiment === "negative", `${bad.sentiment} ${bad.sentimentScore}`);
check("a neutral sentence stays neutral", analyzeSentiment("", "biasa aja").sentiment === "neutral");

// 2. Negation, English and Indonesian.
const notGood = analyzeSentiment("", "not good at all");
check("English negation flips praise", notGood.sentiment === "negative", `${notGood.sentimentScore}`);
const tidakBagus = analyzeSentiment("", "tidak bagus");
check("Indonesian negation flips praise", tidakBagus.sentiment === "negative", `${tidakBagus.sentimentScore}`);
check("gak keren is a complaint", analyzeSentiment("", "gak keren banget").sentiment === "negative");
check("kurang enak is a complaint", analyzeSentiment("", "kurang enak pelayanannya").sentiment === "negative");
check("a negated complaint softens rather than inverts hard",
  analyzeSentiment("", "not bad").sentimentScore > -0.2,
  String(analyzeSentiment("", "not bad").sentimentScore));

// 3. Stems, so "crashing" reaches "crash".
check("inflected verbs are matched", analyzeSentiment("", "the app keeps crashing since the update").sentiment === "negative");

// 4. No invented hashtags, no invented titles.
check("a post without hashtags reports none", analyzeSentiment("", "no tags here").hashtags.length === 0);
const realTags = extractHashtags("suka #KopiKenangan dan #kopikenangan");
check("hashtags are deduplicated and lowercased",
  realTags.length === 1 && realTags[0] === "#kopikenangan", realTags.join(","));
check("hashtag extraction ignores emails and bare words",
  extractHashtags("mail me at a@b.com about this").length === 0);

// 5. The score stays bounded and honest.
const long = analyzeSentiment("", "good good good good good good good good good good good");
check("repetition cannot exceed 1", long.sentimentScore <= 1 && long.sentimentScore > 0.9, String(long.sentimentScore));
check("an unjudged post scores exactly zero", analyzeSentiment("", "the meeting is at three").sentimentScore === 0);
check("matchedWords reports the evidence", love.matchedWords === 2, String(love.matchedWords));

// 6. Tokenisation keeps contractions whole so "don't" can negate.
check("apostrophes survive tokenisation", tokenize("don't like it").includes("don't"));
check("unicode words survive tokenisation", tokenize("café keren").includes("café"));

// 7. Engagement grading never invents a count.
check("an unknown count is null, not Low", engagementGrade(undefined) === null);
check("a real count is graded", engagementGrade(0) === "Low" && engagementGrade(30) === "Medium" && engagementGrade(500) === "High");

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
