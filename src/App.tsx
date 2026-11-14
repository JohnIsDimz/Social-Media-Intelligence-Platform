import React, { useState, useEffect } from "react";
import { Tracker, AnalyzedPost, MonitorResult, DashboardStats, AIPredictionReport } from "./types";
import { api } from "./apiService";
import { CommandStrip } from "./components/CommandStrip";
import { SideRail, type View } from "./components/SideRail";
import {
  AddTrackerDialog,
  DataSourcesDialog,
  RailDrawer,
  Toasts,
  type DataSources,
  type Toast,
} from "./components/Overlays";
import type { ChannelRow } from "./components/ChannelTable";
import { OverviewView } from "./views/OverviewView";
import { AnalyzerView } from "./views/AnalyzerView";
import { ChannelsView } from "./views/ChannelsView";

/** Explicit provenance badge. A fabricated metric must never look like a real one. */
/**
 * Shown only until a real model run succeeds. The UI labels it as a sample, so
 * it is never mistaken for a live prediction. This is presentational copy, not
 * an invented data reading — it disappears the moment /api/predict-trends works.
 */
const samplePredictions: AIPredictionReport = {
  summary:
    "No live forecast has run yet. The figures below are a layout sample: add GEMINI_API_KEY and press recompute to generate a forecast from the mentions you have collected.",
  predictions: [
    {
      day: "Day 1 (tomorrow)",
      dateLabel: new Date(Date.now() + 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
      predictedSentiment: "neutral",
      confidenceScore: 0,
      expectedPosPct: 33,
      expectedNeuPct: 34,
      expectedNegPct: 33,
      primaryDriver: "Sample row — not a prediction.",
    },
    {
      day: "Day 2",
      dateLabel: new Date(Date.now() + 172800000).toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
      predictedSentiment: "neutral",
      confidenceScore: 0,
      expectedPosPct: 33,
      expectedNeuPct: 34,
      expectedNegPct: 33,
      primaryDriver: "Sample row — not a prediction.",
    },
    {
      day: "Day 3",
      dateLabel: new Date(Date.now() + 259200000).toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
      predictedSentiment: "neutral",
      confidenceScore: 0,
      expectedPosPct: 33,
      expectedNeuPct: 34,
      expectedNegPct: 33,
      primaryDriver: "Sample row — not a prediction.",
    },
  ],
  actionableInsights: [],
};

const platformStyles: Record<string, { bg: string, text: string, border: string, color: string, badge: string }> = {
  instagram: {
    bg: "from-pink-50 to-rose-50/30",
    text: "text-rose-700",
    border: "border-pink-200",
    color: "#E1306C",
    badge: "bg-rose-100 text-rose-800"
  },
  tiktok: {
    bg: "from-slate-50 to-slate-100/30",
    text: "text-slate-900",
    border: "border-slate-300",
    color: "#0f172a",
    badge: "bg-slate-200 text-slate-800"
  },
  facebook: {
    bg: "from-blue-50 to-blue-50/20",
    text: "text-blue-700",
    border: "border-blue-200",
    color: "#1877F2",
    badge: "bg-blue-100 text-blue-800"
  },
  whatsapp: {
    bg: "from-emerald-50 to-emerald-50/20",
    text: "text-emerald-700",
    border: "border-emerald-200",
    color: "#25D366",
    badge: "bg-emerald-100 text-emerald-800"
  },
  twitter: {
    bg: "from-sky-50 to-sky-100/30",
    text: "text-sky-700",
    border: "border-sky-200",
    color: "#1DA1F2",
    badge: "bg-sky-100 text-sky-800"
  },
  youtube: {
    bg: "from-red-50 to-red-100/30",
    text: "text-red-700",
    border: "border-red-200",
    color: "#FF0000",
    badge: "bg-red-100 text-red-800"
  },
  linkedin: {
    bg: "from-indigo-50 to-indigo-100/30",
    text: "text-indigo-700",
    border: "border-indigo-200",
    color: "#0A66C2",
    badge: "bg-indigo-100 text-indigo-800"
  },
  reddit: {
    bg: "from-orange-50 to-orange-100/30",
    text: "text-orange-700",
    border: "border-orange-200",
    color: "#FF4500",
    badge: "bg-orange-100 text-orange-800"
  }
};

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [sources, setSources] = useState<DataSources | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [checkingSources, setCheckingSources] = useState(false);

  const loadSources = async () => {
    setCheckingSources(true);
    try {
      setSources(await api.get<DataSources>("/api/data-sources"));
    } catch {
      setSources(null);
    } finally {
      setCheckingSources(false);
    }
  };
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<'7' | '30' | '90'>('7');
  
  // Data State
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [analyzedPosts, setAnalyzedPosts] = useState<AnalyzedPost[]>([]);
  const [monitorResults, setMonitorResults] = useState<MonitorResult[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  
  // Interaction State
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [manualPlatform, setManualPlatform] = useState<'tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit' | 'other'>('tiktok');
  const [selectedTrackerId, setSelectedTrackerId] = useState<string>("");
  
  // New Tracker Form State
  const [newTrackerQuery, setNewTrackerQuery] = useState("");
  const [newTrackerType, setNewTrackerType] = useState<'brand' | 'hashtag'>('brand');
  const [newTrackerPlatforms, setNewTrackerPlatforms] = useState<('tiktok' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube' | 'linkedin' | 'reddit')[]>(["tiktok", "instagram"]);
  const [showAddTrackerModal, setShowAddTrackerModal] = useState(false);
  
  // Loading & Error States
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // AI Prediction State
  const [predictions, setPredictions] = useState<AIPredictionReport | null>(null);
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(false);

  // Universal Social Signal Aggregator State
  const [socialSignals, setSocialSignals] = useState<{
    platformSignals: {
      platform: string;
      buzzVolume: number;
      sentimentScore: number;
      velocity: number;
      signalStrength: number;
      isSimulated?: boolean;
      sampleSize?: number;
      activeUsersCount: number;
    }[];
    aggregateIndex: {
      globalBuzzIndex: number;
      globalSentimentIndex: number;
      crossPlatformCoherence: number;
      dominantPlatform: string;
      totalSignalsDetected: number;
      lastAggregatedAt: string;
    };
  } | null>(null);

  // Real-Time WebSocket and Live Telemetry State
  const [webSocketStatus, setWebSocketStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'polling'>('connecting');
  const [notificationPermission, setNotificationPermission] = useState<string>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );

  // User IP and Asia/Jakarta Clock States
  const [userIp, setUserIp] = useState<string>("Mendeteksi...");
  const [jakartaTime, setJakartaTime] = useState<string>("");

  useEffect(() => {
    // 1. Fetch user IP
    const fetchUserIp = async () => {
      try {
        const response = await fetch("https://api.ipify.org?format=json");
        if (response.ok) {
          const data = await response.json();
          setUserIp(data.ip || "127.0.0.1");
        } else {
          setUserIp("127.0.0.1");
        }
      } catch (err) {
        setUserIp("127.0.0.1");
      }
    };
    fetchUserIp();

    // 2. Clock Interval (Asia/Jakarta)
    const updateTime = () => {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const dateFormatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const now = new Date();
      setJakartaTime(`${dateFormatter.format(now)} · ${formatter.format(now)} GMT+7`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      showNotification("This browser does not support desktop notifications.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        showNotification("Desktop notifications enabled.");
        new Notification("S.M.I.P Active Engine", {
          body: "You will be alerted when a channel moves sharply.",
          icon: "/favicon.png"
        });
      } else if (permission === "denied") {
        showNotification("Notification permission was denied.");
      }
    } catch (err) {
      console.error("Gagal meminta izin notifikasi:", err);
    }
  };

  const sendBrowserNotification = (title: string, body: string, options?: NotificationOptions) => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, {
          body,
          icon: "/favicon.png",
          ...options
        });
      } catch (err) {
        console.error("Error sending notification:", err);
      }
    }
  };

  // Initial Fetch
  useEffect(() => {
    fetchInitialData();
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep selectedTrackerId fresh for WebSocket handler without reconnecting
  const selectedTrackerIdRef = React.useRef(selectedTrackerId);
  useEffect(() => {
    selectedTrackerIdRef.current = selectedTrackerId;
  }, [selectedTrackerId]);

  // Silent Background Refetch Utilities
  const fetchStatsSilent = async () => {
    try {
      const statsData = await api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`);
      setStats(statsData);
    } catch (err) {
      console.error("Gagal memperbarui stats secara latar belakang:", err);
    }
  };

  const fetchInitialDataSilent = async () => {
    try {
      const signalsUrl = selectedTrackerIdRef.current
        ? `/api/social-signals?trackerId=${selectedTrackerIdRef.current}`
        : "/api/social-signals";
      const [trackersData, analyzedData, statsData, allMonitoredData, signalsData] = await Promise.all([
        api.get<Tracker[]>("/api/trackers"),
        api.get<AnalyzedPost[]>("/api/analyzed-posts"),
        api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`),
        api.get<MonitorResult[]>("/api/monitor-results"),
        api.get<any>(signalsUrl).catch(() => null)
      ]);

      setTrackers(trackersData);
      setAnalyzedPosts(analyzedData);
      setStats(statsData);
      if (signalsData) {
        setSocialSignals(signalsData);
      }

      if (selectedTrackerIdRef.current) {
        try {
          const data = await api.get<MonitorResult[]>(`/api/monitor-results?trackerId=${selectedTrackerIdRef.current}`);
          setMonitorResults(data);
        } catch (innerErr) {
          console.error("Background monitor refresh failed:", innerErr);
        }
      }
    } catch (err) {
      console.error("Gagal melakukan sinkronisasi latar belakang:", err);
    }
  };

  // WebSocket Integration for Real-time Synchronization with Fail-Safe Auto-Polling Fallback
  const retryCountRef = React.useRef(0);
  const MAX_WS_RETRIES = 5;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isMounted = true;

    const connectWebSocket = () => {
      // If we've already exceeded retries, don't attempt to initialize WebSocket again to avoid console errors
      if (retryCountRef.current > MAX_WS_RETRIES) {
        if (isMounted) setWebSocketStatus('polling');
        return;
      }

      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socketUrl = `${protocol}//${window.location.host}`;
        console.log("[WebSocket] Connecting to:", socketUrl);
        
        ws = new WebSocket(socketUrl);

        ws.onopen = () => {
          if (isMounted) {
            setWebSocketStatus('connected');
            retryCountRef.current = 0; // Reset counter on success
            console.log("[WebSocket] Connection established");
          }
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const message = JSON.parse(event.data);
            console.log("[WebSocket] Received event:", message);

            if (message.type === "SYSTEM_CONNECTED") {
              setWebSocketStatus('connected');
              retryCountRef.current = 0;
            } else if (message.type === "SYNC") {
              console.log("[WebSocket] Sync event triggered:", message.data?.event);
              fetchInitialDataSilent();
            } else if (message.type === "LIVE_POST_INGESTED") {
              const { post, tracker } = message.data;
              
              // 1. Add to active monitorResults list if matches current selected tracker ID
              if (post.trackerId === selectedTrackerIdRef.current) {
                setMonitorResults((prev) => {
                  // Protect against duplicates
                  if (prev.some((item) => item.id === post.id)) return prev;
                  return [post, ...prev].slice(0, 100);
                });
              }

              // 2. Desktop notification for genuinely new posts
              // Trigger Browser Notification
              if (post.sentiment === "negative") {
                sendBrowserNotification(
                  `Negative spike on ${post.platform.toUpperCase()}`,
                  post.content,
                  { tag: post.id }
                );
              } else {
                sendBrowserNotification(
                  `New mention on ${post.platform.toUpperCase()}`,
                  post.content,
                  { tag: post.id }
                );
              }

              // 3. Silently fetch updated stats in background to seamlessly update chart views!
              fetchStatsSilent();
            }
          } catch (err) {
            console.error("[WebSocket] Failed to parse message:", err);
          }
        };

        // `onclose` is the single source of truth for connection failures.
        // Previously `onerror` also incremented the retry counter, so one real
        // failure counted as two and the "retry in 4 seconds" path was dead code.
        ws.onclose = () => {
          if (!isMounted) return;
          retryCountRef.current += 1;
          if (retryCountRef.current > MAX_WS_RETRIES) {
            console.log("[WebSocket] Max retries reached. Switching to polling fallback mode.");
            setWebSocketStatus('polling');
          } else {
            setWebSocketStatus('disconnected');
            console.log(`[WebSocket] Connection closed. Retrying in 4 seconds (attempt ${retryCountRef.current}/${MAX_WS_RETRIES})...`);
            reconnectTimeout = setTimeout(connectWebSocket, 4000);
          }
        };

        ws.onerror = () => {
          // Just log; closing here would double-count the failure.
          console.warn("[WebSocket] Connection error — falling back to polling if it keeps failing.");
        };
      } catch (e) {
        console.warn("[WebSocket] Direct initialization error, falling back:", e);
        if (isMounted) {
          retryCountRef.current += 1;
          if (retryCountRef.current >= 2) {
            setWebSocketStatus('polling');
          }
        }
      }
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, []);

  // Graceful Auto-Polling Fallback Mode to guarantee real-time updates without errors
  useEffect(() => {
    let pollingInterval: any = null;
    
    // Periodically fetch if in polling mode or if websocket fails to establish
    if (webSocketStatus === 'polling' || webSocketStatus === 'disconnected') {
      console.log("[Real-time Fallback] Auto-polling activated every 8 seconds");
      
      // Initial silent sync
      fetchInitialDataSilent();

      pollingInterval = setInterval(() => {
        fetchInitialDataSilent();
        
        // NOTE: previously this block fabricated a random post and fired an
        // OS-level "negative sentiment spike" notification every 8 seconds.
        // Fake crisis alerts destroy trust in the product, so this simulation
        // was removed. Alerts now only come from real server-side WebSocket
        // events (LIVE_POST_INGESTED / SYNC).
      }, 8000);
    }

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [webSocketStatus, trackers]);

  const fetchPredictions = async () => {
    setIsLoadingPredictions(true);
    try {
      const data = await api.get<AIPredictionReport>("/api/predict-trends");
      setPredictions(data);
    } catch (err) {
      console.error("Gagal memuat prediksi tren AI:", err);
    } finally {
      setIsLoadingPredictions(false);
    }
  };

  // Update stats whenever timeRange changes
  useEffect(() => {
    if (!isLoading) {
      const fetchStatsForRange = async () => {
        try {
          const data = await api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`);
          setStats(data);
        } catch (err) {
          console.error("Gagal mengambil data statistik filter:", err);
        }
      };
      fetchStatsForRange();
    }
  }, [timeRange]);


  const fetchInitialData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const signalsUrl = selectedTrackerId
        ? `/api/social-signals?trackerId=${selectedTrackerId}`
        : "/api/social-signals";
      const [trackersData, analyzedData, statsData, allMonitoredData, signalsData] = await Promise.all([
        api.get<Tracker[]>("/api/trackers"),
        api.get<AnalyzedPost[]>("/api/analyzed-posts"),
        api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`),
        api.get<MonitorResult[]>("/api/monitor-results"),
        api.get<any>(signalsUrl).catch(() => null)
      ]);

      setTrackers(trackersData);
      setAnalyzedPosts(analyzedData);
      setStats(statsData);
      // Keep the channels view populated without an extra round-trip.
      setMonitorResults((prev) => (prev.length > 0 ? prev : allMonitoredData));
      if (signalsData) {
        setSocialSignals(signalsData);
      }

      if (trackersData.length > 0) {
        setSelectedTrackerId(trackersData[0].id);
        fetchMonitorResults(trackersData[0].id);
      }
      
      // Load AI predictions in the background
      fetchPredictions();
    } catch (err: any) {
      setError(err.message || "Lost connection to the server.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMonitorResults = async (trackerId: string) => {
    if (!trackerId) return;
    try {
      const data = await api.get<MonitorResult[]>(`/api/monitor-results?trackerId=${trackerId}`);
      setMonitorResults(data);
      
      // Also update general stats and social signals
      const [statsData, signalsData] = await Promise.all([
        api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`),
        api.get<any>(`/api/social-signals?trackerId=${trackerId}`).catch(() => null)
      ]);
      setStats(statsData);
      if (signalsData) {
        setSocialSignals(signalsData);
      }
    } catch (err) {
      console.error("Could not load monitoring results:", err);
    }
  };

  // Refresh / Scrape Live Social Media Search Grounding
  const triggerLiveMonitoring = async (trackerId: string) => {
    setIsMonitoring(true);
    setError(null);
    try {
      const data = await api.post<MonitorResult[]>("/api/trigger-monitor", { trackerId });
      setMonitorResults(data);

      // Update stats, alert message, and social signals
      const [statsData, signalsData] = await Promise.all([
        api.get<DashboardStats>(`/api/dashboard-stats?range=${timeRange}`),
        api.get<any>(`/api/social-signals?trackerId=${trackerId}`).catch(() => null)
      ]);
      setStats(statsData);
      if (signalsData) {
        setSocialSignals(signalsData);
      }

      showNotification(
        data.length > 0
          ? `Collected ${data.length} mentions from live sources.`
          : "Scan finished. No new mentions were returned by the configured sources."
      );
    } catch (err: any) {
      setError(err.message || "The scan could not be completed.");
    } finally {
      setIsMonitoring(false);
    }
  };

  // Create New Tracker Campaign
  const createTrackerDirect = async (
    type: "brand" | "hashtag",
    query: string,
    platforms: string[]
  ) => {
    setError(null);
    try {
      const newTracker = await api.post<Tracker>("/api/trackers", {
        type,
        query: type === "hashtag" && !query.startsWith("#") ? `#${query}` : query,
        platforms,
      });

      setTrackers((prev) => [...prev, newTracker]);
      setSelectedTrackerId(newTracker.id);
      setShowAddTrackerModal(false);
      setNewTrackerQuery("");
      setView("channels");

      showNotification(`Tracker "${newTracker.query}" added.`);

      // Auto-trigger live scanning
      triggerLiveMonitoring(newTracker.id);
    } catch (err: any) {
      setError(err.message || "Could not save the new tracker.");
    }
  };

  // Delete Tracker
  const handleDeleteTracker = async (id: string) => {
    if (!confirm("Delete this tracker and all of its collected mentions?")) return;

    try {
      await api.delete(`/api/trackers/${id}`);
      setTrackers(prev => prev.filter(t => t.id !== id));
      if (selectedTrackerId === id) {
        setSelectedTrackerId("");
      }
      
      // Refresh Stats
      const statsData = await api.get<DashboardStats>("/api/dashboard-stats");
      setStats(statsData);

      showNotification("Tracker deleted.");
    } catch (err: any) {
      setError(err.message || "Could not delete the tracker.");
    }
  };

  // Run Custom Post Analyzer
  const handleAnalyzePost = async (
    e?: React.FormEvent,
    payload?: { url?: string; text?: string; platform?: string }
  ) => {
    e?.preventDefault();
    const urlValue = (payload?.url ?? urlInput).trim();
    const textValue = (payload?.text ?? textInput).trim();
    const platformValue = payload?.platform ?? manualPlatform;

    if (!urlValue && !textValue) {
      setError("Add a URL or paste the post text to analyse.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await api.post<AnalyzedPost>("/api/analyze-url", {
        url: urlValue || undefined,
        rawText: textValue || undefined,
        manualPlatform: textValue ? platformValue : undefined
      });

      setAnalyzedPosts(prev => [result, ...prev]);
      setUrlInput("");
      setTextInput("");
      
      // Refresh general dashboard stats
      const statsData = await api.get<DashboardStats>("/api/dashboard-stats");
      setStats(statsData);

      showNotification("Analysis complete.");
    } catch (err: any) {
      setError(err.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const showNotification = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => {
      setSuccessMessage(null);
    }, 4500);
  };

  // CSV Exporter Helper Function with UTF-8 BOM
  const downloadCSV = (filename: string, headers: string[], rows: string[][]) => {
    const escapeCSV = (val: string) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map(row => row.map(escapeCSV).join(","))
    ].join("\n");

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. Export Sentiment Analyzer History
  const exportAnalyzedPostsCSV = () => {
    if (analyzedPosts.length === 0) {
      setError("There is no analysis history to export yet.");
      return;
    }
    const headers = [
      "ID", "Title", "Description", "Platform", "Sentiment", "Sentiment Score",
      "Dominant Emotion", "Engagement", "Source URL", "Analysed At", "Hashtags"
    ];
    const rows = analyzedPosts.map(post => [
      post.id,
      post.title,
      post.description || "",
      post.platform,
      post.sentiment,
      String(post.sentimentScore),
      post.emotion,
      post.engagement,
      post.url || "",
      post.analyzedAt,
      (post.hashtags || []).join("; ")
    ]);
    downloadCSV("smip_analysis_history.csv", headers, rows);
    showNotification("Analysis history downloaded.");
  };

  // 2. Export Brand Monitoring Results
  const exportMonitorResultsCSV = () => {
    if (monitorResults.length === 0) {
      setError("There are no mentions to export yet.");
      return;
    }
    const activeTracker = trackers.find(t => t.id === selectedTrackerId);
    const trackerName = activeTracker ? activeTracker.query : "all-trackers";
    const headers = [
      "Mention ID", "Author", "Platform", "Title", "Content", "Sentiment",
      "Sentiment Score", "Emotion", "Engagement", "Source URL", "Collected At"
    ];
    const rows = monitorResults.map(res => [
      res.id,
      res.author,
      res.platform,
      res.title,
      res.content,
      res.sentiment,
      String(res.sentimentScore || 0),
      res.emotion,
      res.engagement,
      res.url || "",
      res.date || ""
    ]);
    
    // Replace spaces and special chars in filename
    const safeName = trackerName.replace(/[^a-zA-Z0-9]/g, "_");
    downloadCSV(`smip_mentions_${safeName}.csv`, headers, rows);
    showNotification(`Mentions for ${trackerName} downloaded.`);
  };

  // 3. Export Comprehensive Dashboard Overview
  const exportDashboardReport = () => {
    if (!stats) {
      setError("Dashboard data is not available yet.");
      return;
    }
    
    const headers = ["Metric", "Value", "Note"];
    const rows = [
      ["Product", "Social Media Intelligence Platform (S.M.I.P)", "Collected data only"],
      ["Exported at", new Date().toLocaleString("en-GB"), "Server local time"],
      ["Mentions analysed", String(stats.totalAnalyzed), "Total records in the database"],
      ["Mean sentiment score", String(stats.averageScore), "Range -1.0 to +1.0"],
      ["Overall sentiment", stats.overallSentiment === "positive" ? "Positive" : stats.overallSentiment === "negative" ? "Negative" : "Neutral", "Majority direction"],
      ["", "", ""],
      ["SEBARAN EMOSI PUBLIK", "Frekuensi / Nilai", "Persentase Relatif"],
      ...(stats.emotionDistribution || []).map(emo => [
        `Emosi: ${emo.name}`,
        String(emo.value),
        "Derived from collected public conversation"
      ]),
      ["", "", ""],
      ["CHANNEL DISTRIBUTION", "Mentions", "Volume"],
      ...(stats.platformDistribution || []).map(p => [
        `Platform: ${p.name.toUpperCase()}`,
        String(p.value),
        p.color
      ]),
      ["", "", ""],
      ["TOP HASHTAGS", "Occurrences", "Status"],
      ...(stats.topHashtags || []).map(tag => [
        `#${tag.text}`,
        String(tag.value),
        "Tracked"
      ])
    ];
    
    downloadCSV("smip_dashboard_report.csv", headers, rows);
    showNotification("Dashboard report downloaded.");
  };

  // Platform Colors for UI Badges



  /* ---------------------------------------------------------------------------
   * Derived view data
   * ------------------------------------------------------------------------- */

  const activeTracker = trackers.find((t) => t.id === selectedTrackerId);

  const channelRows: ChannelRow[] =
    socialSignals?.platformSignals?.map((s) => ({
      platform: s.platform,
      buzzVolume: s.buzzVolume,
      sentimentScore: s.sentimentScore,
      velocity: s.velocity,
      signalStrength: s.signalStrength,
      activeUsersCount: s.activeUsersCount,
      isSimulated: s.isSimulated,
    })) ?? [];

  const activeChannelCount = channelRows.filter((r) => r.buzzVolume > 0).length;
  const totalSignals =
    socialSignals?.aggregateIndex?.totalSignalsDetected ??
    (stats?.totalAnalyzed ?? 0);

  const toastKind: Toast["kind"] = error ? "fail" : "ok";
  const toastMessage = error ?? successMessage;

  const toasts: Toast[] = toastMessage
    ? [{ id: 1, kind: toastKind, message: toastMessage }]
    : [];

  const dismissToast = () => {
    setError(null);
    setSuccessMessage(null);
  };

  const connectionForStrip = webSocketStatus;

  const railProps = {
    trackers,
    activeTrackerId: selectedTrackerId,
    onSelectTracker: (id: string) => {
      setSelectedTrackerId(id);
      setView("channels");
      setIsDrawerOpen(false);
      fetchMonitorResults(id);
    },
    onAddTracker: () => {
      setShowAddTrackerModal(true);
      setIsDrawerOpen(false);
    },
    onDeleteTracker: handleDeleteTracker,
    connection: webSocketStatus,
    notificationsOn: notificationPermission === "granted",
    onToggleNotifications: requestNotificationPermission,
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink" id="app-root">
      <CommandStrip
        trackers={trackers}
        totalSignals={totalSignals}
        signals={channelRows}
        connection={connectionForStrip}
        clock={jakartaTime}
        activeChannels={activeChannelCount}
        onOpenMenu={() => setIsDrawerOpen(true)}
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col lg:flex-row">
        {/* Rail — desktop only; the drawer carries the same content on small screens. */}
        <aside className="hidden w-[240px] shrink-0 border-r border-hair lg:block xl:w-[264px]">
          <div className="sticky top-0">
            <SideRail
              view={view}
              onChangeView={setView}
              {...railProps}
            />
          </div>
        </aside>

        <RailDrawer open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)}>
          <SideRail
            view={view}
            onChangeView={(v) => {
              setView(v);
              setIsDrawerOpen(false);
            }}
            {...railProps}
          />
        </RailDrawer>

        <main className="min-w-0 flex-1 px-5 pb-16 pt-6 sm:px-8 sm:pt-7">
          {isLoading && !stats ? (
            <div className="flex flex-col gap-3 py-16" aria-busy="true" aria-live="polite">
              <p className="text-[13px] text-ink-3">memuat data pemantauan…</p>
              <div className="h-px w-full bg-hair" />
              <div className="settle h-8 w-2/3 bg-paper-2" />
              <div className="settle h-4 w-1/2 bg-paper-2" />
            </div>
          ) : view === "overview" ? (
            <OverviewView
              stats={stats}
              channels={channelRows}
              predictions={predictions ?? samplePredictions}
              predictionsLive={Boolean(predictions)}
              isLoadingPredictions={isLoadingPredictions}
              onRefreshPredictions={fetchPredictions}
              onExport={exportDashboardReport}
              activeQuery={activeTracker?.query ?? ""}
              activePlatforms={activeChannelCount}
              platformCount={channelRows.length || 8}
              clock={jakartaTime}
              onOpenSources={() => setShowSources(true)}
            />
          ) : view === "analyzer" ? (
            <AnalyzerView
              posts={analyzedPosts}
              isAnalyzing={isAnalyzing}
              onSubmit={({ url, text, platform }) =>
                handleAnalyzePost(undefined, { url, text, platform })
              }
              onExport={exportAnalyzedPostsCSV}
            />
          ) : (
            <ChannelsView
              tracker={activeTracker}
              results={monitorResults}
              isScanning={isMonitoring}
              onScan={() => triggerLiveMonitoring(selectedTrackerId)}
              onExport={exportMonitorResultsCSV}
              onAddTracker={() => setShowAddTrackerModal(true)}
            />
          )}
        </main>
      </div>

      <footer className="border-t border-hair">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-1 px-5 py-5 text-[12px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>S.M.I.P — public conversation monitoring</span>
          <span className="tnum">
            {jakartaTime || "—"} · {userIp}
          </span>
        </div>
      </footer>

      <AddTrackerDialog
        open={showAddTrackerModal}
        onClose={() => setShowAddTrackerModal(false)}
        onCreate={async ({ type, query, platforms }) => {
          setNewTrackerType(type);
          setNewTrackerQuery(query);
          setNewTrackerPlatforms(platforms as any);
          await createTrackerDirect(type, query, platforms);
        }}
      />

      <DataSourcesDialog
        open={showSources}
        onClose={() => setShowSources(false)}
        sources={sources}
        onRecheck={loadSources}
        checking={checkingSources}
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
