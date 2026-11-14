import {
  cn,
  fmt,
  signed,
  sentimentText,
  Metric,
  Rule,
  Button,
  NoDataTag,
} from "../lib/ui";
import type { DashboardStats, AIPredictionReport } from "../types";
import { ChannelTable, type ChannelRow } from "../components/ChannelTable";
import { TrendForecast } from "../components/TrendForecast";
import { ShareOfVoice, EmotionBars } from "../components/ShareOfVoice";
import { Download, Activity } from "lucide-react";
import { RadarDial } from "../components/RadarDial";

interface OverviewViewProps {
  stats: DashboardStats | null;
  channels: ChannelRow[];
  predictions: AIPredictionReport | null;
  predictionsLive: boolean;
  forecastError: string | null;
  isLoadingPredictions: boolean;
  onRefreshPredictions: () => void;
  onExport: () => void;
  activeQuery: string;
  activePlatforms: number;
  platformCount: number;
  onOpenSources: () => void;
}

export function OverviewView({
  stats,
  channels,
  predictions,
  predictionsLive,
  forecastError,
  isLoadingPredictions,
  onRefreshPredictions,
  onExport,
  activeQuery,
  activePlatforms,
  platformCount,
  onOpenSources,
}: OverviewViewProps) {
  const overall = stats?.overallSentiment ?? "neutral";
  const score = stats?.averageScore ?? 0;
  const topEmotion = stats?.emotionDistribution?.[0];
  const hasData = (stats?.totalAnalyzed ?? 0) > 0;

  const radarState: "idle" | "scanning" | "live" | "offline" = isLoadingPredictions
    ? "scanning"
    : hasData
      ? "live"
      : activePlatforms > 0
        ? "idle"
        : "offline";

  const headline = !hasData
    ? "Nothing has been collected yet."
    : overall === "positive"
      ? "Public conversation is on your side."
      : overall === "negative"
        ? "Public conversation is pushing back."
        : "Public conversation is quiet.";

  return (
    <div className="flex flex-col">
      <section className="settle grid gap-6 pb-6 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
        <div>
          <p className="text-[13px] text-ink-3">
            {activeQuery ? (
              <>
                reading <span className="text-ink">{activeQuery}</span> across {activePlatforms} of{" "}
                {platformCount} channels
              </>
            ) : (
              <>no tracker selected</>
            )}
          </p>

          <h1 className="mt-1.5 max-w-[24ch] font-display text-[30px] leading-[1.12] font-semibold tracking-tight text-ink sm:text-[34px]">
            {headline}
          </h1>

          <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
            {hasData
              ? `${fmt(stats!.totalAnalyzed)} mentions collected in this window; ${
                  overall === "positive"
                    ? "positive tone"
                    : overall === "negative"
                      ? "negative tone"
                      : "neutral tone"
                } still leads.`
              : "Run a scan on a tracker, or connect a data source, to fill this view with collected mentions."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button variant="primary" onClick={onExport}>
              <Download size={14} aria-hidden="true" />
              Export report
            </Button>
            <Button variant="quiet" onClick={onOpenSources}>
              <Activity size={14} aria-hidden="true" />
              Data sources
            </Button>
          </div>
        </div>

        <RadarDial
          className="mx-auto lg:mx-0"
          size={176}
          state={radarState}
          label={
            radarState === "scanning"
              ? "scanning"
              : radarState === "live"
                ? `${fmt(stats?.totalAnalyzed ?? 0)} mentions`
                : radarState === "idle"
                  ? "standing by"
                  : "no source"
          }
          detail={
            radarState === "scanning"
              ? "model reading"
              : radarState === "live"
                ? `${activePlatforms} channel${activePlatforms === 1 ? "" : "s"} reporting`
                : radarState === "idle"
                  ? "nothing collected"
                  : "set AI_API_KEY"
          }
        />
      </section>

      <section aria-label="Key figures" className="border-y border-hair">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <div className="border-b border-hair pr-4 sm:border-b-0 sm:border-r sm:pr-6">
            <Metric label="Mentions collected" value={fmt(stats?.totalAnalyzed ?? 0)} hint="in this window" />
          </div>
          <div className="border-b border-hair pl-4 sm:border-b-0 sm:border-r sm:px-6">
            <Metric
              label="Leading sentiment"
              value={sentimentText(overall)}
              tone={overall === "positive" ? "jade" : overall === "negative" ? "brick" : "muted"}
              hint={<span className="tnum">mean score {signed(score)}</span>}
            />
          </div>
          <div className="border-b border-hair pr-4 sm:border-b-0 sm:border-r sm:pr-6">
            <Metric
              label="Top emotion"
              value={topEmotion ? topEmotion.name : "—"}
              hint={
                topEmotion && stats && stats.totalAnalyzed > 0
                  ? `${Math.round((topEmotion.value / stats.totalAnalyzed) * 100)}% of mentions`
                  : "nothing collected"
              }
            />
          </div>
          <div className="pl-4 sm:pl-6">
            <Metric
              label="Channels with data"
              value={`${activePlatforms}/${platformCount}`}
              hint={activePlatforms === 0 ? "connect a source to begin" : "collected mentions only"}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="channels-title" className="pt-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="channels-title" className="font-display text-[19px] font-semibold text-ink">
            Channels
          </h2>
          <span className="text-[12px] text-ink-3">volume, sentiment and velocity</span>
        </div>
        <ChannelTable rows={channels} />
        {activePlatforms < platformCount && (
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-3">
            <NoDataTag show />
            <span>
              {platformCount - activePlatforms} channel
              {platformCount - activePlatforms === 1 ? " has" : "s have"} no collected mentions yet.
              Nothing is estimated — empty means empty.
            </span>
          </p>
        )}
      </section>

      <Rule className="mt-8" />

      <div className="pt-7">
        <TrendForecast
          predictions={predictions}
          isLive={predictionsLive}
          loading={isLoadingPredictions}
          unavailableReason={forecastError}
          onRefresh={onRefreshPredictions}
        />
      </div>

      <Rule className="mt-8" />

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 pt-7 lg:grid-cols-2">
        <ShareOfVoice stats={stats} />
        <EmotionBars stats={stats} />
      </div>

      <Rule className="mt-8" />
      <section aria-labelledby="alerts-title" className="pt-7">
        <h2 id="alerts-title" className="mb-3 font-display text-[19px] font-semibold text-ink">
          Needs attention
        </h2>
        {stats?.recentAlerts && stats.recentAlerts.length > 0 ? (
          <ul className="flex flex-col">
            {stats.recentAlerts.slice(0, 5).map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-0.5 border-t border-hair py-3 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span
                  className={cn(
                    "shrink-0 text-[12px] font-medium",
                    a.type === "negative_spikes"
                      ? "text-brick"
                      : a.type === "new_trend"
                        ? "text-teal"
                        : "text-jade"
                  )}
                >
                  {a.type === "negative_spikes"
                    ? "negative spike"
                    : a.type === "new_trend"
                      ? "new trend"
                      : "brand mention"}
                </span>
                <span className="text-[13px] font-medium text-ink">{a.title}</span>
                <span className="text-[13px] leading-relaxed text-ink-2 sm:flex-1">{a.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-hair pt-3">
            <p className="text-[13px] text-ink-2">Nothing needs attention.</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Alerts appear when a channel moves faster than its usual pace.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
