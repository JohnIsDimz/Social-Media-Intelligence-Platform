import React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { cn } from "../lib/ui";
import type { AIPredictionReport } from "../types";
import { RefreshCw, Sparkles } from "lucide-react";

interface TrendForecastProps {
  predictions: AIPredictionReport;
  isLive: boolean;
  loading: boolean;
  onRefresh: () => void;
}

const TONE = {
  positive: { text: "text-jade", label: "Positive" },
  neutral: { text: "text-ink-3", label: "Neutral" },
  negative: { text: "text-brick", label: "Negative" },
} as const;

export function TrendForecast({ predictions, isLive, loading, onRefresh }: TrendForecastProps) {
  return (
    <section aria-labelledby="forecast-title">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h2 id="forecast-title" className="font-display text-[19px] font-semibold text-ink">
            Three-day forecast
          </h2>
          {!isLive && (
            <span className="text-[12px] text-ink-3">
              sample forecast until a model run succeeds
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline underline-offset-2 disabled:opacity-50"
        >
          <RefreshCw size={12} aria-hidden="true" className={cn(loading && "animate-spin")} />
          {loading ? "computing…" : "recompute"}
        </button>
      </div>

      <p className="max-w-[72ch] text-[14px] leading-relaxed text-ink-2">{predictions.summary}</p>

      <div className="mt-5 h-24 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={predictions.predictions.map((p, i) => ({
              day: `D+${i + 1}`,
              confidence: Math.round(p.confidenceScore * 100),
            }))}
            margin={{ top: 6, right: 4, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id="confFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0F7A75" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#0F7A75" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#6C8087" }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 5,
                border: "1px solid #D3DAD7",
                fontSize: 12,
                fontFamily: "Instrument Sans, sans-serif",
              }}
              formatter={(v) => [`${v}% confidence`, ""]}
            />
            <Area
              type="monotone"
              dataKey="confidence"
              stroke="#0F7A75"
              strokeWidth={1.5}
              fill="url(#confFill)"
              dot={{ r: 2.5, fill: "#0F7A75", strokeWidth: 0 }}
              isAnimationActive
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <ol className="mt-1 flex flex-col">
        {predictions.predictions.map((p, i) => {
          const tone = TONE[p.predictedSentiment];
          return (
            <li
              key={`${p.day}-${i}`}
              className="settle grid grid-cols-[2.2rem_1fr] gap-x-3 border-t border-hair py-4 first:border-t-0 sm:grid-cols-[2.2rem_9rem_1fr]"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span className="tnum font-display text-[15px] font-semibold text-ink-3">
                D+{i + 1}
              </span>

              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{p.dateLabel}</p>
                <p className={cn("text-[12px]", tone.text)}>
                  {tone.label}{" "}
                  <span className="tnum text-ink-3">
                    · {Math.round(p.confidenceScore * 100)}% confidence
                  </span>
                </p>
              </div>

              <div className="col-span-2 mt-2 sm:col-span-1 sm:mt-0">
                <div
                  className="flex h-[6px] w-full overflow-hidden rounded-[1px] bg-paper-2"
                  role="img"
                  aria-label={`Positive ${p.expectedPosPct}%, neutral ${p.expectedNeuPct}%, negative ${p.expectedNegPct}%`}
                >
                  <span className="bg-jade" style={{ width: `${p.expectedPosPct}%` }} />
                  <span className="bg-ink-3/35" style={{ width: `${p.expectedNeuPct}%` }} />
                  <span className="bg-brick" style={{ width: `${p.expectedNegPct}%` }} />
                </div>
                <div className="mt-1.5 flex gap-4 text-[11px] text-ink-3">
                  <span className="tnum">+{p.expectedPosPct}%</span>
                  <span className="tnum">{p.expectedNeuPct}%</span>
                  <span className="tnum">−{p.expectedNegPct}%</span>
                </div>
                <p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-ink-2">
                  {p.primaryDriver}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {predictions.actionableInsights?.length > 0 && (
        <div className="mt-2 border-t border-hair pt-4">
          <p className="label mb-2 flex items-center gap-1.5">
            <Sparkles size={12} aria-hidden="true" />
            Suggested actions
          </p>
          <ul className="flex flex-col gap-2">
            {predictions.actionableInsights.map((insight, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-teal" aria-hidden="true" />
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
