import { useEffect, useMemo, useState } from "react";
import { cn, channelLabel, fmt } from "../lib/ui";
import { Menu, Radio } from "lucide-react";
import { PlatformMark } from "./PlatformMark";

export interface StripSignal {
  platform: string;
  buzzVolume: number;
  sentimentScore: number;
  velocity: number;
}

interface CommandStripProps {
  trackers: { id: string; query: string; type: string }[];
  totalSignals: number;
  signals: StripSignal[];
  activeChannels: number;
  onOpenMenu: () => void;
}


export function CommandStrip({
  trackers,
  totalSignals,
  signals,
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

  return (
    <section
      aria-label="Monitoring status"
      className="relative overflow-hidden bg-petrol text-white"
    >
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

        {/* collection state */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <span className="hidden items-center gap-2 text-white/55 md:inline-flex">
            <span className="tnum text-white/85">{fmt(totalSignals)}</span>
            <span>mentions collected</span>
          </span>

          <ul className="hidden items-center gap-1.5 lg:flex" aria-label="Channels reporting">
            {signals.map((s) => {
              const hasData = s.buzzVolume > 0;
              return (
                <li key={s.platform}>
                  <span
                    title={
                      hasData
                        ? `${channelLabel(s.platform)}: ${fmt(s.buzzVolume)} mentions`
                        : `${channelLabel(s.platform)}: nothing collected yet`
                    }
                    className={cn(
                      "block rounded-[4px]",
                      hasData ? "opacity-100" : "opacity-35"
                    )}
                  >
                    <PlatformMark platform={s.platform} size={20} tone="solid" />
                  </span>
                </li>
              );
            })}
          </ul>

          <span className="hidden items-center gap-1.5 text-white/55 sm:inline-flex">
            <Radio size={12} aria-hidden="true" />
            <span className="tnum">
              {activeChannels}/{signals.length}
            </span>
            <span>channels reporting</span>
          </span>

        </div>
      </div>
    </section>
  );
}
