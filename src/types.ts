export interface Tracker {
  id: string;
  type: 'brand' | 'hashtag' | 'url';
  query: string;
  platforms: ('tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit')[];
  /** Handles for channels with no keyword search, e.g. Telegram channels. */
  accounts?: string[];
  createdAt: string;
}

export interface AnalyzedPost {
  id: string;
  url: string;
  platform: 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other';
  title: string;
  description: string;
  imageUrl?: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number; // -1 to 1
  emotion: string; // e.g., Joy, Anger, Sadness, Surprise, Neutral, Love
  /** High/Medium/Low when the platform publishes a count; absent otherwise. */
  engagement?: string;
  /** Raw engagement count, present only when the source publishes one. */
  engagementScore?: number;
  hashtags: string[];
  analyzedAt: string;
}

export interface MonitorResult {
  id: string;
  trackerId: string;
  platform: 'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other';
  url: string;
  author: string;
  title: string;
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
  emotion: string;
  /** High/Medium/Low when the platform publishes a count; absent otherwise. */
  engagement?: string;
  /** Raw count from the source; absent when it publishes none. */
  engagementScore?: number;
  /** Which query framing found this row, for grounding channels. */
  queryVariant?: string;
  date: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface SentimentTrendPoint {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
}

export interface PlatformDistribution {
  name: string;
  value: number;
  color: string;
}

export interface EmotionDistribution {
  name: string;
  value: number;
}

export interface DashboardStats {
  totalAnalyzed: number;
  overallSentiment: 'positive' | 'neutral' | 'negative';
  averageScore: number;
  sentimentTrend: SentimentTrendPoint[];
  platformDistribution: PlatformDistribution[];
  emotionDistribution: EmotionDistribution[];
  topHashtags: { text: string; value: number }[];
  recentAlerts: { id: string; title: string; type: 'negative_spikes' | 'new_trend' | 'brand_mention'; message: string; timestamp: string }[];
}

export interface TrendPrediction {
  day: string;
  dateLabel: string;
  predictedSentiment: 'positive' | 'neutral' | 'negative';
  confidenceScore: number;
  expectedPosPct: number;
  expectedNeuPct: number;
  expectedNegPct: number;
  primaryDriver: string;
}

export interface AIPredictionReport {
  summary: string;
  predictions: TrendPrediction[];
  actionableInsights: string[];
}

