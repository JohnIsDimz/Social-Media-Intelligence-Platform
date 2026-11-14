import React from "react";
import {
  cn,
  fmt,
  signed,
  sentimentText,
  Metric,
  Rule,
  Button,
  SimulatedTag,
  channelLabel,
} from "../lib/ui";
import type { DashboardStats, AIPredictionReport } from "../types";
import { ChannelTable, type ChannelRow } from "../components/ChannelTable";
import { TrendForecast } from "../components/TrendForecast";
import { ShareOfVoice, EmotionBars } from "../components/ShareOfVoice";

interface OverviewViewProps {
  stats: DashboardStats | null;
  channels: ChannelRow[];
  predictions: AIPredictionReport;
  predictionsAreFallback: boolean;
  isLoadingPredictions: boolean;
  onRefreshPredictions: () => void;
  onExport: () => void;
  activeQuery: string;
  simulatedPlatforms: number;
  platformCount: number;
  ip: string;
  clock: string;
}

export function OverviewView({
  stats,
  channels,
  predictions,
  predictionsAreFallback,
  isLoadingPredictions,
  onRefreshPredictions,
  onExport,
  activeQuery,
  simulatedPlatforms,
  platformCount,
  ip,
  clock,
}: OverviewViewProps) {
  const overall = stats?.overallSentiment ?? "neutral";
  const score = stats?.averageScore ?? 0;
  const topEmotion = stats?.emotionDistribution?.[0];
  const days = stats?.sentimentTrend
    ?.filter((_, i, a) => i >= a.length - 14)
    .map((p) => p.positive - p.negative) ?? [];
  const trendRising =
    days.length > 1 ? days[days.length - 1] >= days[0] : true;

  const headline =
    overall === "positive"
      ? "Percakapan publik sedang berpihak."
      : overall === "negative"
        ? "Percakapan publik sedang menekan."
        : "Percakapan publik sedang tenang.";

  return (
    <div className="flex flex-col">
      {/* ---- Opening statement: the most characteristic thing in this world ---- */}
      <section className="settle pb-6">
        <p className="text-[13px] text-ink-3">
          {activeQuery ? (
            <>
              membaca <span className="text-ink">{activeQuery}</span> di {platformCount} kanal
            </>
          ) : (
            <>belum ada pemantauan yang dipilih</>
          )}
        </p>

        <h1 className="mt-1.5 max-w-[24ch] font-display text-[30px] leading-[1.12] font-semibold tracking-tight text-ink sm:text-[34px]">
          {headline}
        </h1>

        <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
          {stats && stats.totalAnalyzed > 0
            ? `${fmt(stats.totalAnalyzed)} kiriman telah dibaca pada rentang ini; ${
                overall === "positive"
                  ? "nada positif"
                  : overall === "negative"
                    ? "nada negatif"
                    : "nada netral"
              } masih dominan.`
            : "Belum ada kiriman yang dibaca pada rentang ini."}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button variant="primary" onClick={onExport}>
            Ekspor laporan
          </Button>
          <Button variant="quiet" onClick={onRefreshPredictions} disabled={isLoadingPredictions}>
            {isLoadingPredictions ? "menyegarkan…" : "Segarkan data"}
          </Button>
          <span className="tnum text-[12px] text-ink-3">
            {clock || "—"} · {ip}
          </span>
        </div>
      </section>

      {/* ---- Metric strip: hairline-ruled, not four identical cards ---- */}
      <section aria-label="Ringkasan angka" className="border-y border-hair">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          <div className="border-b border-hair pr-4 sm:border-b-0 sm:border-r sm:pr-6">
            <Metric
              label="Kiriman dibaca"
              value={fmt(stats?.totalAnalyzed ?? 0)}
              hint="pada rentang terpilih"
            />
          </div>
          <div className="border-b border-hair pl-4 sm:border-b-0 sm:border-r sm:px-6">
            <Metric
              label="Sentimen dominan"
              value={sentimentText(overall)}
              tone={overall === "positive" ? "jade" : overall === "negative" ? "brick" : "muted"}
              hint={<span className="tnum">rata-rata {signed(score)}</span>}
            />
          </div>
          <div className="border-b border-hair pr-4 sm:border-b-0 sm:border-r sm:border-t-0 sm:pr-6">
            <Metric
              label="Emosi utama"
              value={topEmotion ? topEmotion.name : "—"}
              hint={
                topEmotion && stats && stats.totalAnalyzed > 0
                  ? `${Math.round((topEmotion.value / stats.totalAnalyzed) * 100)}% dari kiriman`
                  : "belum ada"
              }
            />
          </div>
          <div className="pl-4 sm:pl-6">
            <Metric
              label="Kanal dipantau"
              value={String(platformCount)}
              hint={
                simulatedPlatforms > 0
                  ? `${simulatedPlatforms} tanpa data nyata`
                  : "semua berisi data nyata"
              }
            />
          </div>
        </div>
      </section>

      {/* ---- Channel table ---- */}
      <section aria-labelledby="channels-title" className="pt-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="channels-title" className="font-display text-[19px] font-semibold text-ink">
            Kanal
          </h2>
          <span className="text-[12px] text-ink-3">
            {channels.length} kanal · volume, sentimen, laju
          </span>
        </div>
        <ChannelTable rows={channels} />
        {simulatedPlatforms > 0 && (
          <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-3">
            <SimulatedTag show />
            <span>
              {simulatedPlatforms} dari {platformCount} kanal belum punya data nyata; angkanya
              berasal dari model simulasi lokal dan tidak mewakili percakapan sebenarnya.
            </span>
          </p>
        )}
      </section>

      <Rule className="mt-8" />

      {/* ---- Forecast ---- */}
      <div className="pt-7">
        <TrendForecast
          predictions={predictions}
          isFallback={predictionsAreFallback}
          loading={isLoadingPredictions}
          onRefresh={onRefreshPredictions}
        />
      </div>

      <Rule className="mt-8" />

      {/* ---- Two-up: share of voice + emotion ---- */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 pt-7 lg:grid-cols-2">
        <ShareOfVoice stats={stats} />
        <EmotionBars stats={stats} />
      </div>

      {/* ---- Alerts, written as direction not mood ---- */}
      <Rule className="mt-8" />
      <section aria-labelledby="alerts-title" className="pt-7">
        <h2 id="alerts-title" className="mb-3 font-display text-[19px] font-semibold text-ink">
          Perlu perhatian
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
                    ? "lonjakan negatif"
                    : a.type === "new_trend"
                      ? "tren baru"
                      : "penyebutan brand"}
                </span>
                <span className="text-[13px] font-medium text-ink">{a.title}</span>
                <span className="text-[13px] leading-relaxed text-ink-2 sm:flex-1">
                  {a.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-hair pt-3">
            <p className="text-[13px] text-ink-2">Tidak ada peringatan aktif.</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Peringatan muncul ketika sebuah kanal bergerak lebih cepat dari biasanya.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
