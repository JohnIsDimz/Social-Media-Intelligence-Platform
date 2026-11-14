import { cn } from "../lib/ui";
import type { AIPredictionReport } from "../types";
import { RefreshCw, Sparkles } from "lucide-react";

interface TrendForecastProps {
  /** Null until a model run succeeds: there is no sample table to fall back on. */
  predictions: AIPredictionReport | null;
  isLive: boolean;
  loading: boolean;
  /** Why the panel is empty, verbatim from the API where possible. */
  unavailableReason: string | null;
  onRefresh: () => void;
}

const TONE = {
  positive: { text: "text-jade", label: "Positive" },
  neutral: { text: "text-ink-3", label: "Neutral" },
  negative: { text: "text-brick", label: "Negative" },
} as const;

export function TrendForecast({
  predictions,
  isLive,
  loading,
  unavailableReason,
  onRefresh,
}: TrendForecastProps) {
  const refresh = (
    <button
      onClick={onRefresh}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal hover:underline underline-offset-2 disabled:opacity-50"
    >
      <RefreshCw size={12} aria-hidden="true" className={cn(loading && "animate-spin")} />
      {loading ? "computing…" : predictions ? "recompute" : "compute forecast"}
    </button>
  );

  if (!predictions) {
    return (
      <section aria-labelledby="forecast-title">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id="forecast-title" className="font-display text-[19px] font-semibold text-ink">
            Three-day forecast
          </h2>
          {refresh}
        </div>
        <div className="border border-hair bg-paper-2 px-4 py-5">
          <p className="max-w-[72ch] text-[14px] leading-relaxed text-ink-2">
            {loading
              ? "Computing a forecast from the mentions collected so far…"
              : "No forecast yet. A forecast is generated from collected mentions only, so it stays empty until something is collected and an AI key is configured."}
          </p>
          {unavailableReason && !loading && (
            <p className="mt-2 max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
              Server said: <span className="text-ink-2">{unavailableReason}</span>
            </p>
          )}
        </div>
      </section>
    );
  }

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

      <ConfidenceTrend
        points={predictions.predictions.map((p, i) => ({
          day: `D+${i + 1}`,
          confidence: Math.round(p.confidenceScore * 100),
        }))}
      />

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

/**
 * Three-day confidence sparkline, drawn as a plain SVG path.
 *
 * This was a recharts `AreaChart`, which pulled ~400 kB of charting code into the
 * client for a 96 px-high line with three points. What it drew is now what the
 * component is, so the bundle is a fraction of the size and there is one less
 * dependency to audit.
 *
 * Decorative only (`aria-hidden`): every value is also printed as text in the
 * table below, so no information depends on seeing the line.
 */
function ConfidenceTrend({ points }: { points: { day: string; confidence: number }[] }) {
  const W = 320;
  const H = 96;
  const PAD = { top: 8, right: 6, bottom: 18, left: 6 };
  if (points.length === 0) return null;

  const values = points.map((p) => Math.max(0, Math.min(100, p.confidence)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;
  const x = (i: number) =>
    PAD.left + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => baseline - (v / 100) * innerH;

  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(2)} ${baseline} L${x(0).toFixed(2)} ${baseline} Z`;

  return (
    <div className="mt-5 w-full" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="presentation">
        <defs>
          <linearGradient id="confFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0F7A75" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0F7A75" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} y1={baseline} x2={W - PAD.right} y2={baseline} stroke="#d9e3ec" strokeWidth="1" />
        <path d={area} fill="url(#confFill)" />
        <path d={line} fill="none" stroke="#0F7A75" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <g key={points[i].day}>
            <circle cx={x(i)} cy={y(v)} r="2.5" fill="#0F7A75" />
            <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#6b839a">
              {points[i].day}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
