/**
 * Aggregation routes: social signals, dashboard statistics, and the forecast.
 *
 * These compute figures from stored rows only. A channel with nothing collected
 * reports zero; nothing here estimates, interpolates, or invents.
 */
import type { Express } from "express";
import { CHANNEL_KEYS } from "../../channels.ts";
import { aiConfig, aiSummary, chatJson, AiError } from "../../lib/aiProvider.ts";
import { describeAiFailure, isAiAvailable } from "../ai.ts";
import { logger } from "../logger.ts";
import { getDB } from "../data.ts";

export function registerAggregationRoutes(app: Express) {
app.get("/api/social-signals", async (req, res) => {
  const db = await getDB();
  const { trackerId } = req.query;

  const allAnalyzed = db.analyzedPosts || [];
  const allMonitored = db.monitorResults || [];
  
  // Filter items specifically for active tracker if available
  const filteredAnalyzed = trackerId
    ? allAnalyzed.filter((item: any) => item.trackerId === trackerId)
    : allAnalyzed;
  const filteredMonitored = trackerId
    ? allMonitored.filter((item: any) => item.trackerId === trackerId)
    : allMonitored;

  const combined = [...filteredAnalyzed, ...filteredMonitored];
  // Every channel in the catalogue is reported, including ones with nothing in
  // them: an empty row is information, a missing row is a lie of omission.
  const platformsList = CHANNEL_KEYS;
  
  // Metrics come from stored mentions only. A channel with no collected items
  // reports zero rather than a plausible-looking number.
  const platformSignals = platformsList.map((platform) => {
    const platformItems = combined.filter(
      (item) => item.platform === platform || (platform === "twitter" && item.platform === "x")
    );

    let buzzVolume = platformItems.length;
    let sentimentScore = 0;
    let activeUsersCount = 0;

    if (platformItems.length > 0) {
      const sum = platformItems.reduce(
        (acc: number, curr: any) => acc + (curr.sentimentScore || 0),
        0
      );
      sentimentScore = sum / platformItems.length;
      activeUsersCount = new Set(platformItems.map((item: any) => item.author || "user")).size;
    }

    sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

    // Velocity compares this half of the window against the previous half, so it
    // is derived from timestamps instead of an invented growth figure.
    const now = Date.now();
    const halfWindow = (24 * 60 * 60 * 1000) / 2;
    const recent = platformItems.filter((i: any) => now - new Date(i.date || 0).getTime() <= halfWindow).length;
    const earlier = platformItems.length - recent;
    const velocity =
      earlier > 0
        ? Number((((recent - earlier) / earlier) * 100).toFixed(1))
        : recent > 0
          ? 100
          : 0;

    const normalizedVolume = Math.min(100, (buzzVolume / 60) * 100);
    const sentimentBonus = (Math.abs(sentimentScore) + 1.0) * 25;
    const rawStrength = normalizedVolume * 0.35 + velocity * 0.35 + sentimentBonus;
    const signalStrength = Math.round(
      buzzVolume > 0 ? Math.min(100, Math.max(0, rawStrength)) : 0
    );

    return {
      platform,
      buzzVolume,
      sentimentScore: Number(sentimentScore.toFixed(2)),
      velocity,
      signalStrength,
      activeUsersCount,
      sampleSize: platformItems.length,
    };
  });

  // Totals only. An earlier version also returned a "global buzz index" (a
  // hard-coded division by 350), a "cross-platform coherence" score and a
  // dominant platform. Nothing read them, and the first two were made-up
  // normalisations rather than measurements, so they are gone.
  const totalSignalsDetected = platformSignals.reduce((acc, curr) => acc + curr.buzzVolume, 0);

  res.json({
    platformSignals,
    totalSignalsDetected,
    platformCount: platformSignals.length,
    activePlatformCount: platformSignals.filter((p) => p.buzzVolume > 0).length,
    lastAggregatedAt: new Date().toISOString()
  });
});

// 7. Get Aggregated Analytics & Stats for Dashboard Charts
app.get("/api/dashboard-stats", async (req, res) => {
  const db = await getDB();
  const allAnalyzed = db.analyzedPosts || [];
  const allMonitored = db.monitorResults || [];
  
  // Get time range parameter (default to 7 days)
  const parsedRange = parseInt(req.query.range as string, 10);
  const range = Number.isFinite(parsedRange) ? Math.min(365, Math.max(1, parsedRange)) : 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - range);

  // Filter items by range
  const filteredAnalyzed = allAnalyzed.filter((item: any) => {
    const dateStr = item.analyzedAt || item.date;
    if (!dateStr) return true;
    return new Date(dateStr) >= cutoffDate;
  });

  const filteredMonitored = allMonitored.filter((item: any) => {
    const dateStr = item.analyzedAt || item.date;
    if (!dateStr) return true;
    return new Date(dateStr) >= cutoffDate;
  });

  // Combine filtered items for statistics
  const totalAnalyzed = filteredAnalyzed.length;
  const totalMonitored = filteredMonitored.length;
  const combined = [...filteredAnalyzed, ...filteredMonitored];
  const totalCount = combined.length || 1;

  // 1. Overall Sentiment
  let posCount = 0;
  let neuCount = 0;
  let negCount = 0;
  let totalScore = 0;

  combined.forEach((item: any) => {
    if (item.sentiment === "positive") posCount++;
    else if (item.sentiment === "negative") negCount++;
    else neuCount++;
    totalScore += (item.sentimentScore ?? 0);
  });

  const averageScore = Number((totalScore / totalCount).toFixed(2));
  let overallSentiment: 'positive' | 'neutral' | 'negative' = "neutral";
  if (posCount > negCount && posCount > neuCount) overallSentiment = "positive";
  if (negCount > posCount && negCount > neuCount) overallSentiment = "negative";

  // 2. Sentiment Trend
  // Group combined by analyzedAt/date simplified to YYYY-MM-DD
  const dateGroups: Record<string, { pos: number; neu: number; neg: number }> = {};
  
  // Populate N days defaults
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split("T")[0];
    dateGroups[dayStr] = { pos: 0, neu: 0, neg: 0 };
  }

  combined.forEach((item: any) => {
    const dateStr = (item.analyzedAt || item.date || new Date().toISOString()).split("T")[0];
    if (dateGroups[dateStr]) {
      if (item.sentiment === "positive") dateGroups[dateStr].pos++;
      else if (item.sentiment === "negative") dateGroups[dateStr].neg++;
      else dateGroups[dateStr].neu++;
    } else {
      // Allow dynamic creation if it's within range
      const itemDate = new Date(dateStr);
      if (itemDate >= cutoffDate) {
        dateGroups[dateStr] = {
          pos: item.sentiment === "positive" ? 1 : 0,
          neu: item.sentiment === "neutral" ? 1 : 0,
          neg: item.sentiment === "negative" ? 1 : 0
        };
      }
    }
  });

  const sentimentTrend = Object.entries(dateGroups)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({
      date: new Date(date).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
      positive: counts.pos,
      neutral: counts.neu,
      negative: counts.neg
    }));

  // 3. Platform Distribution
  const platformCounts: Record<string, number> = { tiktok: 0, instagram: 0, facebook: 0, whatsapp: 0, other: 0 };
  combined.forEach((item: any) => {
    const platform = item.platform || "other";
    if (platformCounts[platform] !== undefined) {
      platformCounts[platform]++;
    } else {
      platformCounts.other = (platformCounts.other || 0) + 1;
    }
  });

  const colors: Record<string, string> = {
    tiktok: "#000000",
    instagram: "#E1306C",
    facebook: "#1877F2",
    whatsapp: "#25D366",
    other: "#64748B"
  };

  const platformDistribution = Object.entries(platformCounts).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    value,
    color: colors[key] || "#64748B"
  })).filter(p => p.value > 0);

  // 4. Emotion Distribution
  const emotionCounts: Record<string, number> = {};
  combined.forEach((item: any) => {
    const emotion = item.emotion || "Neutral";
    emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
  });

  const emotionDistribution = Object.entries(emotionCounts).map(([name, value]) => ({
    name,
    value
  })).sort((a, b) => b.value - a.value);

  // 5. Top Hashtags Extraction
  const hashtagCounts: Record<string, number> = {};
  filteredAnalyzed.forEach((post: any) => {
    if (Array.isArray(post.hashtags)) {
      post.hashtags.forEach((tag: string) => {
        const cleanTag = tag.replace("#", "").trim();
        if (cleanTag) {
          hashtagCounts[cleanTag] = (hashtagCounts[cleanTag] || 0) + 1;
        }
      });
    }
  });

  const topHashtags = Object.entries(hashtagCounts)
    .map(([text, value]) => ({ text, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // 6. Recent alerts, derived from the counts above.
  const recentAlerts = [];
  if (negCount > (posCount + neuCount) * 0.4) {
    recentAlerts.push({
      id: "alert-1",
      title: "Negative sentiment spike",
      type: "negative_spikes",
      message: `Negative mentions are outrunning the rest: ${negCount} negative against ${posCount} positive and ${neuCount} neutral.`,
      timestamp: new Date().toISOString()
    });
  }
  if (topHashtags.length > 0) {
    recentAlerts.push({
      id: "alert-2",
      title: "Rising hashtag",
      type: "new_trend",
      message: `#${topHashtags[0]?.text} is the most used hashtag in what has been collected so far (${topHashtags[0]?.value} mentions).`,
      timestamp: new Date().toISOString()
    });
  }
  
  recentAlerts.push({
    id: "alert-3",
    title: "Monitoring active",
    type: "brand_mention",
    message:
      "Collectors are running. Channels without a public read API stay empty until an AI key is configured.",
    timestamp: new Date().toISOString(),
  });

  res.json({
    totalAnalyzed: totalAnalyzed + totalMonitored,
    overallSentiment,
    averageScore,
    sentimentTrend,
    platformDistribution,
    emotionDistribution,
    topHashtags,
    recentAlerts
  });
});

// 8. Generate the three-day sentiment forecast through the AI gateway
/**
 * Three-day forecast.
 *
 * The statistics in the prompt come from stored mentions; the model is only
 * asked to interpret them. Two honesty rules:
 *   - no collected mentions  -> 422, because there is nothing to forecast from
 *   - no AI key / model fail -> 503 with an explanation, never a canned forecast
 *     dressed up as a prediction
 */
app.get("/api/predict-trends", async (_req, res) => {
  const db = await getDB();
  const combined = [...(db.analyzedPosts || []), ...(db.monitorResults || [])];

  if (combined.length === 0) {
    return res.status(422).json({
      error: "Nothing has been collected yet, so there is nothing to forecast.",
      reason: "no-data",
    });
  }

  if (!isAiAvailable()) {
    return res.status(503).json({
      error: aiConfig().enabled
        ? "The AI provider is in a cooldown after a rate-limit response."
        : "No AI key is configured (AI_API_KEY).",
      reason: aiConfig().enabled ? "cooldown" : "not-configured",
    });
  }

  try {
    const totalCount = combined.length;
    const posCount = combined.filter((item: any) => item.sentiment === "positive").length;
    const neuCount = combined.filter((item: any) => item.sentiment === "neutral").length;
    const negCount = combined.filter((item: any) => item.sentiment === "negative").length;

    const pct = (n: number) => Math.round((n / totalCount) * 100);
    const channels = [...new Set(combined.map((item: any) => item.platform))];

    const samplePosts = combined.slice(0, 15).map((p: any) => ({
      title: p.title,
      content: (p.content || p.description || "").slice(0, 240),
      platform: p.platform,
      sentiment: p.sentiment,
      emotion: p.emotion,
    }));

    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const prompt = `Based on the collected public mentions below, forecast the conversation for the next three days.

Collection window ends: ${today}
Mentions collected: ${totalCount}
Sentiment split: positive ${pct(posCount)}%, neutral ${pct(neuCount)}%, negative ${pct(negCount)}%
Channels with data: ${channels.join(", ") || "none"}

Sample mentions (JSON):
${JSON.stringify(samplePosts, null, 2)}

Return an object with:
- summary: two or three sentences on where this conversation is heading and why, grounded in the numbers above
- predictions: exactly three entries, one per day, each with
    day: "Day 1 (tomorrow)" | "Day 2" | "Day 3"
    dateLabel: short date for that day
    predictedSentiment: "positive" | "neutral" | "negative"
    confidenceScore: 0.0-1.0, lower when the sample is small
    expectedPosPct / expectedNeuPct / expectedNegPct: integers summing to exactly 100
    primaryDriver: the specific factor behind that day's shift
- actionableInsights: three concrete actions a communications team could take

Do not invent data that is not implied by the mentions above. If the sample is thin, say so in the summary and use a low confidenceScore.`;

    const parsed = await chatJson<{
      summary: string;
      predictions: any[];
      actionableInsights: string[];
    }>({
      system:
        "You are a forecasting analyst for public social conversation. You extrapolate carefully from " +
        "observed data and state uncertainty plainly.",
      prompt,
      expectation: "with keys summary, predictions, actionableInsights",
      temperature: 0.3,
      maxTokens: 1600,
    });

    // Normalise: three rows, percentages that add up, clamped confidence.
    const predictions = (Array.isArray(parsed.predictions) ? parsed.predictions : [])
      .slice(0, 3)
      .map((p: any, i: number) => {
        let pos = Math.max(0, Math.round(Number(p.expectedPosPct) || 0));
        let neu = Math.max(0, Math.round(Number(p.expectedNeuPct) || 0));
        let neg = Math.max(0, Math.round(Number(p.expectedNegPct) || 0));
        const sum = pos + neu + neg;
        if (sum !== 100) {
          if (sum === 0) {
            pos = 33;
            neu = 34;
            neg = 33;
          } else {
            neu = Math.max(0, 100 - pos - neg);
            if (pos + neu + neg !== 100) neg = Math.max(0, 100 - pos - neu);
          }
        }
        return {
          day: typeof p.day === "string" ? p.day : `Day ${i + 1}`,
          dateLabel:
            typeof p.dateLabel === "string"
              ? p.dateLabel
              : new Date(Date.now() + (i + 1) * 86400000).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                }),
          predictedSentiment: ["positive", "neutral", "negative"].includes(p.predictedSentiment)
            ? p.predictedSentiment
            : "neutral",
          confidenceScore: Math.min(1, Math.max(0, Number(p.confidenceScore) || 0)),
          expectedPosPct: pos,
          expectedNeuPct: neu,
          expectedNegPct: neg,
          primaryDriver: typeof p.primaryDriver === "string" ? p.primaryDriver : "",
        };
      });

    if (predictions.length === 0) {
      return res.status(502).json({
        error: "The model did not return a usable forecast.",
        reason: "bad-model-response",
      });
    }

    res.json({
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      predictions,
      actionableInsights: Array.isArray(parsed.actionableInsights)
        ? parsed.actionableInsights.filter((x: any) => typeof x === "string").slice(0, 4)
        : [],
      generatedAt: new Date().toISOString(),
      model: aiSummary().model,
      basedOn: totalCount,
    });
  } catch (err: any) {
    logger.warn("[AI] Trend prediction failed:", describeAiFailure(err));
    res.status(502).json({
      error: "The forecast could not be generated. The model host did not return a usable answer.",
      reason: err instanceof AiError ? err.kind : "unknown",
    });
  }
});
}
