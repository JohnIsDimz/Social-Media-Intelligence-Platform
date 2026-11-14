import { Button, cn, fmt, channelLabel } from "../lib/ui";
import { MentionRow } from "../components/MentionRow";
import type { MonitorResult, Tracker } from "../types";

interface ChannelsViewProps {
  tracker: Tracker | undefined;
  results: MonitorResult[];
  isScanning: boolean;
  onScan: () => void;
  onExport: () => void;
  onAddTracker: () => void;
}

export function ChannelsView({
  tracker,
  results,
  isScanning,
  onScan,
  onExport,
  onAddTracker,
}: ChannelsViewProps) {
  return (
    <div className="flex flex-col">
      <header className="settle flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">brand monitoring</p>
          <h1 className="mt-1.5 truncate font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-ink sm:text-[32px]">
            {tracker ? tracker.query : "No tracker selected"}
          </h1>
          <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
            {tracker
              ? `${results.length > 0 ? fmt(results.length) : "No"} mentions collected across ${tracker.platforms.length} channels.`
              : "Add a brand, product or hashtag you want to watch."}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {tracker ? (
            <>
              {results.length > 0 && (
                <>
                  <Button variant="quiet" onClick={onExport}>
                    Export
                  </Button>
                  <Button variant="primary" onClick={onScan} disabled={isScanning}>
                    {isScanning ? "scanning…" : "Scan again"}
                  </Button>
                </>
              )}
            </>
          ) : (
            <Button variant="primary" onClick={onAddTracker}>
              Add tracker
            </Button>
          )}
        </div>
      </header>

      {tracker && tracker.platforms.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[var(--radius-control)] border border-hair bg-surface/80 px-3.5 py-2.5 text-[12px] text-ink-3 shadow-[var(--shadow-card)]">
          <span className="mr-1 uppercase tracking-[0.08em] text-ink-3/80">channels</span>
          {tracker.platforms.map((p) => (
            <span
              key={p}
              className="rounded-full border border-teal/25 bg-teal-soft/60 px-2.5 py-0.5 font-medium text-teal"
            >
              {channelLabel(p)}
            </span>
          ))}
        </div>
      )}

      <section
        aria-labelledby="mentions-title"
        className="card p-5 sm:p-6"
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2
            id="mentions-title"
            className="font-display text-[19px] font-semibold text-ink"
          >
            Latest mentions
          </h2>
          {results.length > 0 && (
            <span className="tnum text-[12px] text-ink-3">
              {fmt(results.length)} records
            </span>
          )}
        </div>

        {results.length > 0 ? (
          <div>
            {results.slice(0, 60).map((r) => (
              <MentionRow key={r.id} item={r} />
            ))}
          </div>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-dashed border-hair bg-surface-2 px-4 py-5">
            <p className="text-[14px] text-ink-2">
              {tracker
                ? "No mentions collected for this tracker yet."
                : "Pick a tracker on the left, or add a new one."}
            </p>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
              {tracker
                ? "Run a scan to pull recent public discussion from the selected channels."
                : "Name the brand, product or hashtag that appears most often in your comments."}
            </p>
            {tracker && (
              <Button variant="quiet" className="mt-4" onClick={onScan} disabled={isScanning}>
                {isScanning ? "scanning…" : "Run scan"}
              </Button>
            )}
          </div>
        )}

        {results.length > 60 && (
          <p className={cn("mt-4 text-[12px] text-ink-3")}>
            Showing the 60 most recent of {fmt(results.length)} mentions.
          </p>
        )}
      </section>
    </div>
  );
}
