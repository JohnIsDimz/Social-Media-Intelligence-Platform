import React, { useEffect, useMemo, useState } from "react";
import { cn, channelLabel, fmt } from "../lib/ui";
import { Menu, Radio } from "lucide-react";

export interface StripSignal {
  platform: string;
  buzzVolume: number;
  sentimentScore: number;
  velocity: number;
  isSimulated?: boolean;
}

interface CommandStripProps {
  trackers: { id: string; query: string; type: string }[];
  totalSignals: number;
  signals: StripSignal[];
  connection: "connected" | "connecting" | "disconnected" | "polling";
  clock: string;
  activeChannels: number;
  onOpenMenu: () => void;
}

/** Eight small bars: the room's pulse, one per channel. */
function Beats({ value }: { value: number }) {
  // Height is derived from the channel's collected volume, so the pulse is a
  // real reading rather than a decorative animation.
  const peak = Math.max(1, value);
  const bars = [0.35, 0.6, 0.45, 0.9, 0.55, 0.75, 0.4, 0.65].map((m) =>
    Math.max(2, Math.round(peak * m))
  );
  const max = Math.max(...bars);
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden="true" title={`${value} mentions`}>
      {bars.map((b, i) => (
        <span
          key={i}
          className={cn("w-[2px] rounded-[1px]", value > 0 ? "bg-amber/80" : "bg-white/20")}
          style={{ height: `${Math.max(18, (b / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

export function CommandStrip({
  trackers,
  totalSignals,
  signals,
  connection,
  clock,
  activeChannels,
  onOpenMenu,
}: CommandStripProps) {
  const [headlineIndex, setHeadlineIndex] = useState(0);

  const headlines = useMemo(() => {
    const list = trackers.map((t) => t.query);
    return list.length > 0 ? list : ["no active tracker"];
  }, [trackers]);

  useEffect(() => {
    if (headlines.length < 2) return;
    const id = setInterval(
      () => setHeadlineIndex((i) => (i + 1) % headlines.length),
      5200
    );
    return () => clearInterval(id);
  }, [headlines.length]);

  const connectionLabel =
    connection === "connected"
      ? "live feed"
      : connection === "polling"
        ? "periodic sync"
        : connection === "connecting"
          ? "connecting"
          : "disconnected";

  const isLive = connection === "connected" || connection === "polling";

  return (
    <section
      aria-label="Monitoring status"
      className="relative overflow-hidden bg-petrol text-white"
    >
      {isLive && <div className="sweep-line pointer-events-none absolute inset-0" aria-hidden="true" />}

      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8">
        {/* identity */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onOpenMenu}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[5px] border border-white/20 text-white/80 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu size={16} aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[19px] leading-none font-semibold tracking-tight">
                S.M.I.P
              </span>
              <span className="hidden text-[12px] text-white/45 sm:inline">signal room</span>
            </div>
            <p
              key={headlineIndex}
              className="settle mt-1 truncate text-[12px] text-amber/90"
              title={headlines[headlineIndex]}
            >
              watching {headlines[headlineIndex]}
            </p>
          </div>
        </div>

        {/* live state + pulse + clock */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isLive ? "bg-amber live-dot" : "bg-white/30"
              )}
              aria-hidden="true"
            />
            <span className={cn("font-medium", isLive ? "text-amber" : "text-white/50")}>
              {connectionLabel}
            </span>
          </span>

          <span className="hidden items-center gap-2 text-white/55 md:inline-flex">
            <span className="tnum text-white/85">{fmt(totalSignals)}</span>
            <span>mentions collected</span>
          </span>

          <span className="hidden items-center gap-1.5 lg:inline-flex" aria-label="Volume per channel">
            {signals.slice(0, 8).map((s) => (
              <span key={s.platform} className="flex items-center gap-1" title={`${channelLabel(s.platform)}: ${s.buzzVolume}`}>
                <Beats value={s.buzzVolume} />
              </span>
            ))}
          </span>

          <span className="hidden items-center gap-1.5 text-white/55 sm:inline-flex">
            <Radio size={12} aria-hidden="true" />
            <span className="tnum">
              {activeChannels}/{signals.length || 8}
            </span>
            <span>channels reporting</span>
          </span>

          <span className="tnum hidden text-white/55 sm:inline">{clock}</span>
        </div>
      </div>
    </section>
  );
}
