import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import locale from "./locale";

export { locale };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------------------------------------------------------------------
 * Shared visual vocabulary for S.M.I.P.
 *
 * The system is a "signal room": hairline rules instead of cards, one control
 * radius, sober type, and colour reserved for meaning (live / positive /
 * negative / simulated).
 * ------------------------------------------------------------------------- */

export type Sentiment = "positive" | "neutral" | "negative";

/** Channels we monitor. Labels are what people see; keys are what the API uses. */
export const CHANNELS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "twitter", label: "X / Twitter" },
  { key: "youtube", label: "YouTube" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "reddit", label: "Reddit" },
] as const;

export type ChannelKey = (typeof CHANNELS)[number]["key"];

export function channelLabel(key: string): string {
  return CHANNELS.find((c) => c.key === key.toLowerCase())?.label ?? key;
}

/** Sentiment never relies on colour alone: it also carries a sign. */
export function sentimentText(s: string): string {
  if (s === "positive") return "Positive";
  if (s === "negative") return "Negative";
  return "Neutral";
}

export function sentimentColor(s: string): string {
  if (s === "positive") return "text-jade";
  if (s === "negative") return "text-brick";
  return "text-ink-3";
}

export function sentimentMark(s: string): string {
  if (s === "positive") return "+";
  if (s === "negative") return "−";
  return "·";
}

/** Human-readable number: 1,284 — never 1.284k. */
export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function signed(n: number, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}

/** Arrow glyphs keep meaning when colour is unavailable. */
export function velocityMark(v: number): string {
  if (v > 60) return "↗";
  if (v > 20) return "→";
  return "↘";
}

/** Time in Indonesian, short form. */
export function clockTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/* ---------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------- */

export function Rule({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-hair", className)} aria-hidden="true" />;
}

/**
 * Marks a channel that has no collected data yet. Every number in the product
 * comes from a real source, so the only thing worth flagging is emptiness.
 */
export function NoDataTag({
  show,
  className,
}: {
  show?: boolean;
  className?: string;
}) {
  if (!show) return null;
  return (
    <span
      title="No mentions have been collected from this channel yet."
      className={cn(
        "inline-flex items-center gap-1 border border-hair bg-paper-2 px-1.5 py-[1px] text-[10px] font-medium text-ink-3",
        "rounded-[3px] whitespace-nowrap",
        className
      )}
    >
      no data
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "danger" | "link";
};

export function Button({
  variant = "quiet",
  className,
  children,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[5px] text-[13px] font-medium transition-colors duration-150 disabled:opacity-55 disabled:cursor-not-allowed select-none";
  const styles: Record<string, string> = {
    primary:
      "bg-teal text-white px-3.5 py-2 hover:bg-[#0c6662] active:bg-[#0a5a56]",
    quiet:
      "bg-white text-ink border border-hair px-3.5 py-2 hover:border-ink-3 hover:bg-paper-2/60",
    danger:
      "bg-transparent text-brick px-2.5 py-1.5 hover:bg-brick/10",
    link: "bg-transparent text-teal px-0 py-0 hover:underline underline-offset-2",
  };
  return (
    <button className={cn(base, styles[variant], className)} {...rest}>
      {children}
    </button>
  );
}

/** A label + value pair used in the metric strip. No card chrome. */
export function Metric({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "ink" | "jade" | "brick" | "amber" | "muted";
}) {
  const tones: Record<string, string> = {
    ink: "text-ink",
    jade: "text-jade",
    brick: "text-brick",
    amber: "text-amber",
    muted: "text-ink-3",
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 py-4">
      <span className="label">{label}</span>
      <span
        className={cn(
          "tnum font-display text-[26px] leading-none font-semibold tracking-tight",
          tones[tone]
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-[12px] leading-snug text-ink-3">{hint}</span> : null}
    </div>
  );
}
