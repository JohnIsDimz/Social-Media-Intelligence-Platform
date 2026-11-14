import React from "react";
import { cn, channelLabel } from "../lib/ui";
import { brandMark } from "../lib/brandMarks";

/**
 * A platform identity mark.
 *
 * Uses the official brand glyph from Simple Icons (CC0) inside a small
 * monochrome tile. Colour is reserved for state, never for identity, so the row
 * stays legible and the palette stays calm — but the mark itself is the real
 * logo, not a dot or a placeholder shape.
 */
export function PlatformMark({
  platform,
  size = 16,
  className,
  tone = "quiet",
}: {
  platform: string;
  size?: number;
  className?: string;
  /** `quiet` = ink on paper, `solid` = white glyph on petrol. */
  tone?: "quiet" | "solid" | "bare";
}) {
  const mark = brandMark(platform);
  const glyph = Math.round(size * 0.62);

  if (!mark) {
    // Unknown platform: a lettered tile is still more useful than a blank dot.
    const letter = (platform || "?").slice(0, 1).toUpperCase();
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-[4px] border text-[9px] font-semibold uppercase",
          tone === "solid"
            ? "border-white/25 bg-white/10 text-white/80"
            : "border-hair bg-paper-2 text-ink-3",
          className
        )}
        style={{ width: size, height: size }}
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      title={mark.title}
      className={cn(
        "grid shrink-0 place-items-center rounded-[4px]",
        tone === "solid" && "border border-white/20 bg-white/10 text-white",
        tone === "quiet" && "border border-hair bg-white text-ink-2",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={glyph}
        height={glyph}
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
      >
        <path d={mark.path} />
      </svg>
    </span>
  );
}

/** Platform name preceded by its real mark, for table cells and record lines. */
export function PlatformTag({
  platform,
  className,
  compact,
}: {
  platform: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <PlatformMark platform={platform} size={16} />
      {!compact && <span className="truncate">{channelLabel(platform)}</span>}
    </span>
  );
}
