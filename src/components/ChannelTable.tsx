import React from "react";
import { cn, channelLabel, velocityMark, signed, fmt, NoDataTag } from "../lib/ui";

export interface ChannelRow {
  platform: string;
  buzzVolume: number;
  sentimentScore: number;
  velocity: number;
  signalStrength: number;
  activeUsersCount: number;
  isSimulated?: boolean;
}

/**
 * The eight channels as a table, not eight identical cards. A table is how you
 * actually compare volume, sentiment and velocity across channels.
 */
export function ChannelTable({ rows }: { rows: ChannelRow[] }) {
  const maxVolume = Math.max(1, ...rows.map((r) => r.buzzVolume));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-[13px]">
        <caption className="sr-only">
          Volume, sentiment, velocity and signal strength for each social channel
        </caption>
        <thead>
          <tr className="border-b border-hair text-left">
            <th scope="col" className="label py-2 pr-4 font-medium">Channel</th>
            <th scope="col" className="label py-2 pr-4 font-medium">Volume</th>
            <th scope="col" className="label py-2 pr-4 text-right font-medium">Sentiment</th>
            <th scope="col" className="label py-2 pr-4 text-right font-medium">Velocity</th>
            <th scope="col" className="label py-2 pr-1 text-right font-medium">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = Math.round((r.buzzVolume / maxVolume) * 100);
            const empty = r.buzzVolume === 0;
            const tone =
              r.sentimentScore > 0.05
                ? "text-jade"
                : r.sentimentScore < -0.05
                  ? "text-brick"
                  : "text-ink-3";
            return (
              <tr
                key={r.platform}
                className="settle border-b border-hair/70 last:border-0"
                style={{ animationDelay: `${60 + i * 40}ms` }}
              >
                <th scope="row" className="py-2.5 pr-4 text-left font-medium text-ink">
                  <span className="flex items-center gap-1.5">
                    {channelLabel(r.platform)}
                  </span>
                </th>

                <td className="py-2.5 pr-4">
                  <span className="flex items-center gap-2">
                    <span className="relative h-[3px] w-24 overflow-hidden rounded-full bg-paper-2">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full",
                          "bg-teal"
                        )}
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </span>
                    <span className="tnum text-ink-2">{empty ? "—" : fmt(r.buzzVolume)}</span>
                  </span>
                </td>

                <td className={cn("tnum py-2.5 pr-4 text-right font-medium", tone)}>
                  {empty ? "—" : signed(r.sentimentScore)}
                </td>

                <td className="tnum py-2.5 pr-4 text-right text-ink-2">
                  {empty ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden="true" className="text-ink-3">
                        {velocityMark(r.velocity)}
                      </span>
                      <span>{r.velocity.toFixed(1)}%</span>
                    </span>
                  )}
                </td>

                <td className="py-2.5 pl-1 pr-0 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    <span className="relative h-[6px] w-14 overflow-hidden rounded-[1px] bg-paper-2">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0",
                          r.signalStrength >= 70
                            ? "bg-amber"
                            : r.signalStrength >= 40
                              ? "bg-teal"
                              : "bg-ink-3/45"
                        )}
                        style={{ width: `${Math.max(2, r.signalStrength)}%` }}
                      />
                    </span>
                    <span className="tnum w-7 text-ink-2">
                      {empty ? "—" : Math.round(r.signalStrength)}
                    </span>
                  </span>
                  <NoDataTag show={empty} className="ml-2 align-middle" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
