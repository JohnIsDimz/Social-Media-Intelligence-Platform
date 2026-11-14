import React from "react";
import { cn, fmt, SimulatedTag, Rule } from "../lib/ui";
import type { DashboardStats } from "../types";

interface ShareOfVoiceProps {
  stats: DashboardStats | null;
}

/**
 * Share of voice as one stacked bar plus a ranked list — not a donut. Reading a
 * proportion off a bar is immediate; reading it off a ring is not.
 */
export function ShareOfVoice({ stats }: ShareOfVoiceProps) {
  const distribution = stats?.platformDistribution ?? [];
  const total = distribution.reduce((acc, d) => acc + d.value, 0);
  const ranked = [...distribution].sort((a, b) => b.value - a.value);

  // A restrained ramp within the palette rather than eight unrelated hues.
  const ramp = ["#0E3F4A", "#0F7A75", "#3E8F82", "#6FA79B", "#9CBFB4", "#C0D6CD", "#D7E4DE", "#E5EDE9"];

  return (
    <section aria-labelledby="sov-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="sov-title" className="font-display text-[19px] font-semibold text-ink">
          Porsi suara
        </h2>
        <span className="text-[12px] text-ink-3">
          {total > 0 ? `${fmt(total)} mention` : "belum ada mention"}
        </span>
      </div>

      {total > 0 ? (
        <>
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-[1px] bg-paper-2"
            role="img"
            aria-label={ranked
              .map((d) => `${d.name} ${Math.round((d.value / total) * 100)}%`)
              .join(", ")}
          >
            {ranked.map((d, i) => (
              <span
                key={d.name}
                style={{
                  width: `${(d.value / total) * 100}%`,
                  backgroundColor: ramp[i % ramp.length],
                }}
              />
            ))}
          </div>

          <ul className="mt-3 flex flex-col">
            {ranked.map((d, i) => {
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <li key={d.name}>
                  <div className="flex items-center gap-3 py-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-[1px]"
                      style={{ backgroundColor: ramp[i % ramp.length] }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate text-[13px] capitalize text-ink">
                      {d.name}
                    </span>
                    <span className="tnum text-[12px] text-ink-3">{fmt(d.value)}</span>
                    <span className="tnum w-10 text-right text-[13px] font-medium text-ink-2">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  {i < ranked.length - 1 && <Rule className="opacity-60" />}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="border-t border-hair py-6">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Belum ada mention yang terkumpul.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
            Jalankan pemindaian pada salah satu pemantauan untuk mengisi bagian ini.
          </p>
        </div>
      )}
    </section>
  );
}

/** Emotion distribution as labelled horizontal rules — no chart chrome needed. */
export function EmotionBars({ stats }: { stats: DashboardStats | null }) {
  const emotions = (stats?.emotionDistribution ?? []).slice(0, 6);
  const max = Math.max(1, ...emotions.map((e) => e.value));
  const total = emotions.reduce((a, e) => a + e.value, 0);

  return (
    <section aria-labelledby="emotion-title">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="emotion-title" className="font-display text-[19px] font-semibold text-ink">
          Emosi dominan
        </h2>
        <SimulatedTag show={emotions.length === 0} />
      </div>

      {emotions.length === 0 ? (
        <p className="border-t border-hair py-6 text-[13px] text-ink-3">
          Belum ada sebaran emosi. Analisis satu kiriman untuk melihat polanya.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {emotions.map((e) => (
            <li key={e.name} className="grid grid-cols-[6rem_1fr_2.6rem] items-center gap-3">
              <span className="truncate text-[13px] capitalize text-ink-2">{e.name}</span>
              <span className="relative h-[5px] w-full overflow-hidden rounded-[1px] bg-paper-2">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-[1px] bg-teal")}
                  style={{ width: `${Math.max(3, (e.value / max) * 100)}%` }}
                />
              </span>
              <span className="tnum text-right text-[12px] text-ink-3">
                {total > 0 ? `${Math.round((e.value / total) * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
