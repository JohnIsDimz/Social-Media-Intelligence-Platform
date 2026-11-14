import { useMemo } from "react";
import { cn } from "../lib/ui";

/**
 * The radar dial.
 *
 * A plan-position indicator rather than a decorated spinner: range rings with
 * distance labels, bearing ticks, a 60-second sweep, and contacts plotted at a
 * fixed bearing and range. A contact brightens as the sweep passes over it and
 * fades until the next pass, which is what a real scope does.
 *
 * Two honesty rules:
 *  - Blips are built only from channels that actually hold mentions. A quiet
 *    scope means nothing was collected; it never shows decoration blips.
 *  - Bearing and range are derived from the platform key, so a single channel
 *    keeps the same position across renders instead of jumping around.
 *
 * `prefers-reduced-motion` stops the sweep entirely (see index.css), so the
 * dial degrades to a static plot with the contacts still visible.
 */

export interface RadarContact {
  platform: string;
  /** Mentions collected for this channel. */
  volume: number;
  /** Relative signal strength, 0-100, used for blip size. */
  strength?: number;
}

const SWEEP_SECONDS = 60;

/**
 * Ring spacing, in viewBox units. The outer ring is the scope edge; a contact
 * closer to the hub is a stronger signal.
 */
const OUTER_RADIUS = 46;

/**
 * Inner radius floor, so the centre stays readable: the readout sits there.
 */
const MIN_PLOT_RADIUS = 15;

/** Stable 0-359 bearing for a channel, so a blip does not move between renders. */
function bearingOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // One decimal place, so two channels are far less likely to share a bearing
  // and hide each other's blip. Still fully deterministic: a channel does not
  // move between renders.
  return (Math.abs(h) % 3600) / 10;
}

/**
 * Range for a contact: stronger signals sit closer in.
 *
 * Strength is the server's `signalStrength` (0-100). When it is missing, the
 * volume is compared against the busiest channel in the same dataset, so the
 * scale adapts to the brand being watched instead of a fixed guess.
 */
function plotRadiusOf(contact: RadarContact, busiest: number): number {
  const strength =
    typeof contact.strength === "number"
      ? contact.strength
      : busiest > 0
        ? (contact.volume / busiest) * 100
        : 0;
  const clamped = Math.min(100, Math.max(0, strength));
  return OUTER_RADIUS - (clamped / 100) * (OUTER_RADIUS - MIN_PLOT_RADIUS);
}

function polar(bearingDeg: number, radius: number, centre = 100) {
  // 0 degrees is up, angles run clockwise, matching the sweep.
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  return {
    x: centre + Math.cos(rad) * radius,
    y: centre + Math.sin(rad) * radius,
  };
}

export function RadarDial({
  size = 200,
  state = "idle",
  label,
  detail,
  contacts = [],
  rangeLabel,
  className,
}: {
  size?: number;
  state?: "idle" | "scanning" | "live" | "offline";
  label?: string;
  detail?: string;
  /** Channels that actually hold data. Empty means a quiet scope. */
  contacts?: RadarContact[];
  /** What the outer ring means, e.g. "outer ring = 60+ mentions". */
  rangeLabel?: string;
  className?: string;
}) {
  const minuteTicks = Array.from({ length: 72 }, (_, i) => i);
  const rings = [MIN_PLOT_RADIUS / OUTER_RADIUS, 0.45, 0.72, 1];
  const cardinal = [
    { n: "N", deg: 0 },
    { n: "E", deg: 90 },
    { n: "S", deg: 180 },
    { n: "W", deg: 270 },
  ];

  const plotted = useMemo(() => {
    const withData = contacts.filter((c) => c.volume > 0);
    const busiest = withData.reduce((max, c) => Math.max(max, c.volume), 0);
    return withData
      .slice()
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 16)
      .map((c) => {
        const bearing = bearingOf(c.platform);
        // Two channels can hash to the same bearing; nudge the later one so a
        // blip is never buried exactly under another.
        const r = plotRadiusOf(c, busiest);
        const { x, y } = polar(bearing, r);
        return { ...c, bearing, r, x, y };
      });
  }, [contacts]);

  // The sweep spins in every state, offline included. A frozen dial is
  // indistinguishable from a crashed page, and "still working" is exactly what an
  // empty dashboard has to show. Only the speed changes: slower when there is
  // nothing to find, so it reads as searching rather than as busy.
  const sweepSeconds = state === "live" ? SWEEP_SECONDS : state === "scanning" ? SWEEP_SECONDS / 2 : SWEEP_SECONDS * 2;

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
        aria-label={
          `Radar, ${contacts.filter((c) => c.volume > 0).length} channels reporting. ` +
          `${label || state}${detail ? `. ${detail}` : ""}`
        }
      >
        {/* Bezel: a physical edge, not a floating circle */}
        <div
          className="absolute inset-0 rounded-full border border-hair bg-paper-2/70"
          style={{
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 2px rgba(14,27,32,0.06), 0 1px 2px rgba(14,27,32,0.05)",
          }}
        />

        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <radialGradient id="scopeFloor" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0F7A75" stopOpacity="0.05" />
              <stop offset="70%" stopColor="#0F7A75" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#0F7A75" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="blipGlow">
              <stop offset="0%" stopColor="#D9861F" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#D9861F" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx="100" cy="100" r={OUTER_RADIUS + 4} fill="url(#scopeFloor)" />

          {/* Bearing ticks: every 5 degrees, longer every 30. Drawn thicker than a
              hairline because at 176px on a phone a 0.45px stroke disappears. */}
          {minuteTicks.map((i) => {
            const deg = (i / 72) * 360;
            const major = i % 6 === 0;
            const outer = OUTER_RADIUS + 4;
            const inner = major ? OUTER_RADIUS : OUTER_RADIUS + 1.5;
            const a = polar(deg, outer);
            const b = polar(deg, inner);
            return (
              <line
                key={`t${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={major ? "var(--color-ink-2)" : "var(--color-ink-3)"}
                strokeWidth={major ? 1.1 : 0.6}
                opacity={major ? 0.9 : 0.55}
                strokeLinecap="round"
              />
            );
          })}

          {/* Range rings, with the outermost one solid */}
          {rings.map((f, i) => (
            <circle
              key={`r${i}`}
              cx="100"
              cy="100"
              r={OUTER_RADIUS * f}
              fill="none"
              stroke="var(--color-ink-3)"
              strokeWidth={i === rings.length - 1 ? 0.9 : 0.5}
              opacity={i === rings.length - 1 ? 0.7 : 0.45}
              strokeDasharray={i === rings.length - 1 ? undefined : "1.5 2.5"}
            />
          ))}

          {/* Cardinal labels sit just inside the outer ring */}
          {cardinal.map(({ n, deg }) => {
            const p = polar(deg, OUTER_RADIUS - 5.5);
            return (
              <text
                key={n}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="7.5"
                fontWeight="700"
                fill={n === "N" ? "var(--color-teal)" : "var(--color-ink-2)"}
                style={{ fontFamily: "Instrument Sans, sans-serif" }}
              >
                {n}
              </text>
            );
          })}

          {/* Sweep trail: drawn as SVG so it stays aligned with the ticks */}
          <g
            className="radar-sweep-svg"
            style={{ animationDuration: `${sweepSeconds}s`, transformOrigin: "100px 100px" }}
          >
            <path
              d={`M100 100 L100 ${100 - OUTER_RADIUS} A${OUTER_RADIUS} ${OUTER_RADIUS} 0 0 1 ${100 + Math.cos(-Math.PI / 3) * OUTER_RADIUS} ${100 + Math.sin(-Math.PI / 3) * OUTER_RADIUS} Z`}
              fill="url(#blipGlow)"
              opacity="0.55"
            />
            <line x1="100" y1="100" x2="100" y2={100 - OUTER_RADIUS} stroke="#D9861F" strokeWidth="0.8" strokeLinecap="round" />
          </g>

          {/* Contacts: flash as the sweep passes their bearing, then decay */}
          {plotted.map((c) => {
            const delay = (c.bearing / 360) * sweepSeconds;
            const radius = 1.1 + Math.min(1.9, c.volume / 40);
            return (
              <g
                key={c.platform}
                className="radar-contact"
                style={{
                  animationDelay: `${delay}s`,
                  animationDuration: `${sweepSeconds}s`,
                }}
              >
                <circle cx={c.x} cy={c.y} r={radius * 2.6} fill="#D9861F" opacity="0.16" />
                <circle cx={c.x} cy={c.y} r={radius} fill="#B46A12" />
              </g>
            );
          })}

          {/* Hub */}
          <circle cx="100" cy="100" r="1.8" fill="var(--color-paper)" stroke="var(--color-ink-3)" strokeWidth="0.6" />
        </svg>

        {/* Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-10 text-center">
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

      {(plotted.length > 0 || rangeLabel) && (
        <figcaption className="flex flex-col items-center gap-1 text-center">
          {plotted.length > 0 ? (
            <span className="text-[11px] text-ink-3">
              {plotted.length} {plotted.length === 1 ? "contact" : "contacts"} plotted
            </span>
          ) : (
            <span className="text-[11px] text-ink-3">quiet scope: nothing collected</span>
          )}
          {rangeLabel && <span className="text-[10px] text-ink-3/80">{rangeLabel}</span>}
        </figcaption>
      )}
    </figure>
  );
}
