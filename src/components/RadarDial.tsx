import React from "react";
import { cn } from "../lib/ui";

/**
 * The radar dial.
 *
 * A clock face rather than a generic "loading spinner": minute marks, the four
 * cardinal numbers, and a 60-second sweep hand that reports what it is doing.
 * The sweep is the only continuous motion in the product, it respects
 * `prefers-reduced-motion`, and it is honest about state — while a scan is
 * running it says so; when idle it says how stale the data is.
 */
export function RadarDial({
  size = 200,
  state = "idle",
  label,
  detail,
  className,
}: {
  size?: number;
  state?: "idle" | "scanning" | "live" | "offline";
  label?: string;
  detail?: string;
  className?: string;
}) {
  const minuteTicks = Array.from({ length: 60 }, (_, i) => i);
  const cardinal = [
    { n: "60", deg: 0 },
    { n: "15", deg: 90 },
    { n: "30", deg: 180 },
    { n: "45", deg: 270 },
  ];

  return (
    <figure
      className={cn(
        "flex flex-col items-center gap-3",
        state === "offline" && "radar-offline",
        state === "idle" && "radar-idle",
        className
      )}
    >
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Radar. ${label || state}${detail ? `. ${detail}` : ""}`}
      >
        {/* Bezel */}
        <div
          className="absolute inset-0 rounded-full border border-hair bg-paper-2/60"
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)" }}
        />

        {/* Minute marks: long at every five, short elsewhere */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {minuteTicks.map((i) => {
            const long = i % 5 === 0;
            const angle = (i / 60) * 360;
            return (
              <line
                key={i}
                x1="50"
                y1={long ? 6 : 7.5}
                x2="50"
                y2={long ? 12 : 10}
                transform={`rotate(${angle} 50 50)`}
                stroke={long ? "var(--color-ink-3)" : "var(--color-hair)"}
                strokeWidth={long ? 0.7 : 0.45}
                strokeLinecap="round"
              />
            );
          })}
          {/* Crosshair rings */}
          <circle cx="50" cy="50" r="30" fill="none" stroke="var(--color-hair)" strokeWidth="0.5" />
          <circle cx="50" cy="50" r="19" fill="none" stroke="var(--color-hair)" strokeWidth="0.5" strokeDasharray="1 3" />
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-hair)" strokeWidth="0.4" strokeDasharray="0.5 3.5" />
        </svg>

        {/* Cardinal numbers, sitting just inside the bezel */}
        {cardinal.map(({ n, deg }) => (
          <span
            key={n}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 font-display text-[10px] font-semibold tabular-nums text-ink-3"
            style={{
              transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-${size / 2 - 17}px) rotate(-${deg}deg)`,
            }}
          >
            {n}
          </span>
        ))}

        {/* Sweep: a conic wash plus the hand */}
        <div className="radar-sweep absolute inset-[7px] rounded-full" aria-hidden="true">
          <div className="radar-wash absolute inset-0 rounded-full" />
          <div className="radar-hand absolute left-1/2 top-1/2 h-[calc(50%-7px)] w-px origin-top" />
        </div>

        {/* Hub */}
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hair bg-paper" />

        {/* Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">
          {label && (
            <span
              className={cn(
                "font-display text-[13px] leading-tight font-semibold",
                state === "offline" ? "text-ink-3" : "text-ink"
              )}
            >
              {label}
            </span>
          )}
          {detail && <span className="text-[11px] leading-tight text-ink-3">{detail}</span>}
        </div>
      </div>
    </figure>
  );
}
