/**
 * Analysis and collection routes.
 *
 * Everything that spends an AI call or reaches the network lives here: analysing
 * a submitted URL or text, and the manual scan of one tracker. Both are behind
 * the stricter rate limiter and require a bearer token.
 */
import type { Express } from "express";
import { aiSummary, chatJson } from "../../lib/aiProvider.ts";
import { aiCanSearch, describeAiFailure } from "../ai.ts";
import { logger } from "../logger.ts";
import { broadcast } from "../realtime.ts";
import { getDB, mergeMentionsForTracker, saveAnalyzedPost } from "../data.ts";
import { markScanned } from "../scan-state.ts";
import {
  detectPlatform,
  fetchUnifiedSocialSignals,
  localAnalyzeSentiment,
  scrapeSocialUrl,
  validateScrapeUrl,
} from "../collectors.ts";

export function registerAnalysisRoutes(app: Express) {
app.post("/api/analyze-url", async (req, res) => {
  const { url, rawText, manualPlatform } = req.body;
  
  if (!url && !rawText) {
    return res.status(400).json({ error: "Either URL or text content is required for analysis." });
  }

  // Empty until something real fills them. The old defaults were a fake headline
  // and a stock photo, which then went into the prompt as if they were the post.
  let scrapedTitle = "";
  let scrapedDesc = rawText || "";
  let scrapedImg = "";
  let platform: 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other' = manualPlatform || "other";

  // Reject unsupported / internal URLs up front so the client gets a clear 400
  // instead of a silently fabricated analysis of a URL we never fetched.
  if (url) {
    try {
      validateScrapeUrl(url);
    } catch (validationErr: any) {
      return res.status(400).json({ error: validationErr.message });
    }
  }

  try {
    let fetchNote = "";
    if (url) {
      platform = detectPlatform(url);
      const scraped = await scrapeSocialUrl(url);
      scrapedTitle = scraped.title || "";
      // Text the user pasted wins over anything the page claims about itself.
      scrapedDesc = rawText || scraped.description || "";
      if (scraped.imageUrl) scrapedImg = scraped.imageUrl;
      if (!scraped.success && !rawText) {
        // Analysing an empty string would mean rating the platform's own login
        // page. Say what happened instead.
        return res.status(422).json({
          error:
            "That post could not be read: the page returned no public text (most networks " +
            "serve a login wall to servers). Paste the post text instead and it will be analysed.",
          reason: "source-unreadable",
        });
      }
      if (!scraped.success) {
        fetchNote = "The page itself could not be read; the analysis uses the text you pasted.";
      }
    }

    let modelResult = null;

    if (aiCanSearch()) {
      try {
        // Model call for high-precision sentiment and emotion extraction
        const prompt = `Analyze this social media post for Sentiment and Emotion monitoring.
        
        Post Details:
        URL: ${url || "N/A"}
        Platform: ${platform}
        Scraped Title: ${scrapedTitle}
        Original Description / Content: ${scrapedDesc}
        
        Analyze the text carefully. Provide the response as a valid JSON object matching this schema exactly:
        {
          "sentiment": "positive" | "neutral" | "negative",
          "sentimentScore": number between -1.0 (extremely negative) and 1.0 (extremely positive),
          "emotion": string (use one of: "Joy", "Anger", "Sadness", "Surprise", "Love", "Neutral", "Fear"),
          "engagement": "High" | "Medium" | "Low",
          "hashtags": string[] (array of detected hashtags or relevant keyword tags),
          "refinedTitle": string (a concise, human-friendly summary headline of the post content in English),
          "refinedDescription": string (a concise summary description of the post in English)
        }
        
        Analyze and output Indonesian-focused slang or abbreviations correctly if present (e.g., "ngaco" -> negative, "keren" -> positive).`;

        modelResult = await chatJson<{
          sentiment: string;
          sentimentScore: number;
          emotion: string;
          engagement: string;
          hashtags: string[];
          refinedTitle: string;
          refinedDescription: string;
        }>({
          system:
            "You are a sentiment analyst for public social media conversation. You understand Indonesian " +
            "slang and internet abbreviations as well as English. Judge the post on its actual wording.",
          prompt,
          expectation:
            "with keys sentiment, sentimentScore, emotion, engagement, hashtags, refinedTitle, refinedDescription",
          temperature: 0.2,
          maxTokens: 900,
        });
      } catch (err: any) {
        logger.warn("[AI] Analysis call failed:", describeAiFailure(err));
        logger.info("[AI] Falling back to the local heuristic analyser for this request.");
      }
    } else {
      logger.info(
        `[AI] ${aiSummary().enabled ? "Provider is in cooldown" : "No AI key configured"} — using the local heuristic analyser.`
      );
    }

    if (!modelResult) {
      const localResult = localAnalyzeSentiment(scrapedTitle, scrapedDesc);
      modelResult = {
        refinedTitle: localResult.refinedTitle,
        refinedDescription: localResult.refinedDescription,
        sentiment: localResult.sentiment,
        sentimentScore: localResult.sentimentScore,
        emotion: localResult.emotion,
        engagement: localResult.engagement,
        hashtags: localResult.hashtags
      };
    }

    const newAnalysis = {
      id: `ap-${Date.now()}`,
      url: url || `manual-text-${Date.now()}`,
      platform,
      title: modelResult.refinedTitle || scrapedTitle || (scrapedDesc || "").slice(0, 80),
      description: modelResult.refinedDescription || scrapedDesc || fetchNote,
      imageUrl: scrapedImg,
      sentiment: modelResult.sentiment,
      sentimentScore: modelResult.sentimentScore,
      emotion: modelResult.emotion,
      engagement: modelResult.engagement,
      hashtags: modelResult.hashtags,
      analyzedAt: new Date().toISOString()
    };

    await saveAnalyzedPost(newAnalysis);
    broadcast("SYNC", { event: "post_analyzed", post: newAnalysis });

    res.json(newAnalysis);
  } catch (err: any) {
    logger.error("Critical error in /api/analyze-url:", err);
    logger.error("Failed to perform sentiment analysis:", err);
    res.status(500).json({ error: "Sentiment analysis failed. Please try again." });
  }
});

// 6. Trigger Active Google Search Grounding Monitoring for a Tracker Brand/Hashtag
app.post("/api/trigger-monitor", async (req, res) => {
  const { trackerId } = req.body;
  if (!trackerId) {
    return res.status(400).json({ error: "trackerId is required" });
  }

  const db = await getDB();
  const tracker = db.trackers.find((t: any) => t.id === trackerId);
  if (!tracker) {
    return res.status(404).json({ error: "Tracker not found" });
  }

  try {
    logger.info(`[Social Intelligence Engine] Running unified social signal search for: "${tracker.query}"...`);
    const formattedResults = await fetchUnifiedSocialSignals(tracker);

    // A scan merges into the tracker's history instead of replacing it, so a
    // channel that answered nothing this cycle does not erase what it had.
    const written = await mergeMentionsForTracker(trackerId, formattedResults);
    markScanned(trackerId);
    logger.info(
      `[Scan] "${tracker.query}": ${formattedResults.length} collected, ${written} merged into history.`
    );

    broadcast("SYNC", { event: "monitor_triggered", trackerId, results: formattedResults });
    res.json(formattedResults);
  } catch (err: any) {
    logger.error("Monitoring failed:", err);
    res.status(500).json({
      error: "The live search could not be completed. Check the server logs and configured data sources.",
    });
  }
});

// 6b. Get Cross-Platform Social Signals & Aggregation Index (Universal Intelligence Signal Engine)
}
