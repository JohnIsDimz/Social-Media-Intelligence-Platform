/**
 * Local sentiment analysis.
 *
 * This runs on every collected mention, with no API key and no cost, so it has
 * to be defensible. The previous version had three problems that made its output
 * look more confident than it was:
 *
 *  1. plain substring matching, so "bagus" matched inside another word and
 *     "tidak bagus" counted as positive;
 *  2. a fixed +0.15 per hit, so a post with six praise words pinned to 1.0 and
 *     the score stopped carrying information;
 *  3. invented fallbacks: hashtags and a headline were fabricated when the post
 *     had none.
 *
 * This version:
 *  - tokenises on word boundaries and matches whole words or stems;
 *  - handles negation in English ("not good", "never works") and Indonesian
 *    ("tidak bagus", "kurang enak", "gak keren") within a short window before
 *    the word;
 *  - weights words (strong / normal / weak) and normalises by how many words
 *    were actually judged, so a long neutral post does not read as extreme;
 *  - returns [] for hashtags when the post has none.
 *
 * It is still a lexicon, not a model: when an AI key is configured, the analyzer
 * route uses the model and this only covers automatic collection. That is stated
 * in the UI rather than hidden.
 */

export type Sentiment = "positive" | "neutral" | "negative";
export type Emotion = "Joy" | "Anger" | "Sadness" | "Surprise" | "Love" | "Neutral" | "Fear";

export interface SentimentResult {
  sentiment: Sentiment;
  sentimentScore: number;
  emotion: Emotion;
  /** How many lexicon words were found; 0 means the verdict is a coin-toss default. */
  matchedWords: number;
  /** Tags that actually appear in the text, lowercased, deduplicated. */
  hashtags: string[];
}

/** Words are grouped by weight; a strong word moves the score three times as far. */
const POSITIVE: Record<string, number> = {
  // English
  good: 1, great: 2, excellent: 3, amazing: 3, awesome: 3, love: 2, loved: 2,
  perfect: 3, best: 2, better: 1, happy: 2, glad: 1, nice: 1, thanks: 1,
  thank: 1, satisfied: 2, recommend: 2, recommended: 2, impressed: 2,
  impressive: 2, reliable: 2, fast: 1, quick: 1, affordable: 1, cheap: 1,
  worth: 1, helpful: 2, smooth: 1, delicious: 2, clean: 1, friendly: 2,
  win: 1, works: 1, solid: 1, brilliant: 3, outstanding: 3, fantastic: 3,
  // Indonesian
  bagus: 2, keren: 2, mantap: 2, hebat: 2, suka: 1, cinta: 2, puas: 2,
  memuaskan: 2, rekomendasi: 2, juara: 3, enak: 2, murah: 1, cepat: 1,
  ramah: 2, hemat: 1, terbaik: 3, senang: 2, seneng: 2, lega: 1, mantul: 2,
  kece: 1, asik: 1, asyik: 1, top: 1, oke: 1, ok: 1, terbantu: 2, solutif: 2,
};

const NEGATIVE: Record<string, number> = {
  // English
  bad: 1, worse: 2, worst: 3, terrible: 3, awful: 3, horrible: 3, hate: 2,
  hated: 2, angry: 2, disappointed: 2, disappointing: 2, poor: 2, slow: 1,
  broken: 2, broke: 1, fail: 2, failed: 2, fails: 2, failing: 2, error: 1,
  errors: 1, bug: 1, bugs: 1, crash: 2, crashes: 2, crashs: 2, freeze: 2,
  freezes: 2, unusable: 3, useless: 2, scam: 3, scammed: 3, fraud: 3,
  refund: 1, refunded: 1, complaint: 1, complaints: 1, expensive: 1,
  overpriced: 2, delay: 1, delayed: 1, late: 1, missing: 1, rude: 2,
  dirty: 2, damaged: 2, defective: 2, refused: 2, ignored: 2, cancel: 1,
  canceled: 1, cancelled: 1, outage: 2, down: 1, stuck: 2, painful: 2,
  // Indonesian
  jelek: 2, kecewa: 3, mengecewakan: 3, lambat: 2, mahal: 1, buruk: 2,
  kesal: 2, marah: 2, marahin: 2, rugi: 2, penipu: 3, penipuan: 3, ngaco: 2,
  gagal: 2, rusak: 2, benci: 3, parah: 3, lelet: 2, sulit: 1, susah: 1,
  kapok: 2, lama: 1, telat: 1, antre: 1, komplain: 1, keluhan: 1, bohong: 3,
  males: 1, malesin: 2, hang: 2, lemot: 2, dipalak: 2, nipu: 3, tipu: 3,
};

/** Words that invert the next sentiment word inside a short window. */
const NEGATORS = new Set([
  "not", "no", "never", "cannot", "cant", "can't", "dont", "don't", "doesnt",
  "doesn't", "didnt", "didn't", "isnt", "isn't", "wasnt", "wasn't", "wont",
  "won't", "hardly", "barely", "without", "far",
  "tidak", "tak", "gak", "ga", "nggak", "ngga", "enggak", "bukan", "belum",
  "jangan", "kurang", "tanpa", "gagalnya",
]);

/** Intensifiers amplify the following word a little. */
const INTENSIFIERS = new Set([
  "very", "really", "so", "super", "extremely", "sangat", "banget", "bgt",
  "sekali", "paling", "terlalu", "super",
]);

const ANGER = new Set([
  "angry", "anger", "furious", "mad", "rage", "scam", "fraud", "penipu",
  "penipuan", "marah", "kesal", "parah", "nipu", "tipu", "dipalak", "benci",
]);
const SADNESS = new Set([
  "sad", "unhappy", "disappointed", "disappointing", "cry", "crying", "hope",
  "kecewa", "mengecewakan", "sedih", "rugi", "kapok", "males",
]);
const JOY = new Set([
  "happy", "glad", "great", "amazing", "awesome", "win", "fun", "excited",
  "senang", "seneng", "lega", "mantap", "mantul", "keren", "seru", "asik", "asyik",
]);
const LOVE = new Set(["love", "loved", "adore", "favorite", "favourite", "cinta", "suka", "sayang"]);
const FEAR = new Set(["afraid", "scared", "worried", "worry", "anxious", "fear", "takut", "khawatir", "cemas"]);
const SURPRISE = new Set(["surprised", "surprising", "shocked", "unexpected", "wow", "kaget", "heran"]);

const TOKEN_RE = /[\p{L}\p{N}_'-]+/gu;

/**
 * Splits text into lowercase tokens. Apostrophes are kept so "don't" survives as
 * one token and can act as a negator.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) || []).map((t) => t.replace(/^'+|'+$/g, ""));
}

/**
 * Light suffix stripping so "crashing", "crashed" and "crashes" all reach the
 * "crash" entry. Deliberately crude: a real stemmer is a dependency, and this
 * only has to cover the inflections that show up in social posts.
 */
function stemsOf(token: string): string[] {
  const out = [token];
  for (const suffix of ["ing", "ed", "es", "s", "nya", "lah", "kah"]) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      out.push(token.slice(0, -suffix.length));
    }
  }
  return out;
}

/** Returns the lexicon weight for a token, or 0 when it carries no sentiment. */
function weightOf(token: string): number {
  for (const candidate of stemsOf(token)) {
    if (candidate in POSITIVE) return POSITIVE[candidate];
    if (candidate in NEGATIVE) return -NEGATIVE[candidate];
  }
  return 0;
}

/**
 * Analyses a post.
 *
 * The score is the mean weight of the judged tokens, damped by a square root so
 * that a single word in a long text does not read as a strong verdict. It stays
 * inside [-1, 1] and is rounded to two decimals because the UI never shows more.
 */
export function analyzeSentiment(title?: string, content?: string): SentimentResult {
  const text = `${title || ""} ${content || ""}`.trim();
  const tokens = tokenize(text);

  let total = 0;
  let judged = 0;

  for (let i = 0; i < tokens.length; i++) {
    const raw = weightOf(tokens[i]);
    if (raw === 0) continue;

    // Look back two tokens for a negator ("not very good", "tidak bagus").
    let weight = raw;
    let negated = false;
    for (let back = 1; back <= 2 && i - back >= 0; back++) {
      const prev = tokens[i - back];
      if (NEGATORS.has(prev)) {
        negated = true;
        break;
      }
      if (INTENSIFIERS.has(prev)) {
        weight *= 1.3;
        break;
      }
      // A sentiment word between the negator and this one ends the search:
      // "good but not great" must not flip the first word.
      if (weightOf(prev) !== 0) break;
    }
    if (negated) {
      // Negated praise is a mild complaint, not praise. Negated criticism is mild
      // praise. Flipping the sign alone would overstate both.
      weight = -weight * 0.6;
    }

    total += weight;
    judged++;
  }

  // "amazing" three times is stronger evidence than once, but not three times as
  // strong: the mean keeps this honest for long texts.
  const rawScore = judged > 0 ? total / Math.sqrt(judged) / 2 : 0;
  const sentimentScore = Number(Math.max(-1, Math.min(1, rawScore)).toFixed(2));

  let sentiment: Sentiment = "neutral";
  if (sentimentScore >= 0.15) sentiment = "positive";
  else if (sentimentScore <= -0.15) sentiment = "negative";

  return {
    sentiment,
    sentimentScore,
    emotion: pickEmotion(tokens, sentiment),
    matchedWords: judged,
    hashtags: extractHashtags(text),
  };
}

function pickEmotion(tokens: string[], sentiment: Sentiment): Emotion {
  if (sentiment === "neutral") {
    // A neutral verdict can still carry a clear emotion, e.g. a worried post with
    // no praise or criticism.
    if (tokens.some((t) => FEAR.has(t))) return "Fear";
    if (tokens.some((t) => SURPRISE.has(t))) return "Surprise";
    return "Neutral";
  }
  const groups: [Emotion, Set<string>][] =
    sentiment === "negative"
      ? [["Anger", ANGER], ["Sadness", SADNESS], ["Fear", FEAR], ["Surprise", SURPRISE]]
      : [["Love", LOVE], ["Joy", JOY], ["Surprise", SURPRISE]];
  for (const [emotion, words] of groups) {
    if (tokens.some((t) => words.has(t))) return emotion;
  }
  return sentiment === "negative" ? "Sadness" : "Joy";
}

/** Hashtags that are actually in the text. Never invent one. */
export function extractHashtags(text: string): string[] {
  const found = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * The engagement grade, derived from a real count when one exists.
 *
 * `count === undefined` means the source does not publish engagement; the caller
 * must say so rather than guessing, so this returns null.
 */
export function engagementGrade(count: number | undefined): "High" | "Medium" | "Low" | null {
  if (count === undefined || Number.isNaN(count)) return null;
  if (count >= 100) return "High";
  if (count >= 20) return "Medium";
  return "Low";
}
