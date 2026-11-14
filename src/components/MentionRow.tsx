import {
  cn,
  channelLabel,
  sentimentText,
  sentimentColor,
  sentimentMark,
  relativeTime,
} from "../lib/ui";
import type { MonitorResult } from "../types";
import { PlatformMark } from "./PlatformMark";

/**
 * One mention as a record line: channel, sentiment, who, what, when, source.
 * Quotes are set in italic; the source link is the only place we spell out that
 * the text came from somewhere else.
 */
export function MentionRow({ item }: { item: MonitorResult }) {

  return (
    <article className="settle border-t border-hair py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <PlatformMark platform={item.platform} size={15} />
          {channelLabel(item.platform)}
        </span>
        <span className={cn("inline-flex items-center gap-1 font-medium", sentimentColor(item.sentiment))}>
          <span aria-hidden="true">{sentimentMark(item.sentiment)}</span>
          {sentimentText(item.sentiment)}
        </span>
        <span className="text-ink-3">{item.emotion || "Neutral"}</span>
        <span className="ml-auto text-ink-3">{relativeTime(item.date)}</span>
      </div>

      <h3 className="mt-1.5 text-[14px] font-medium leading-snug text-ink">
        {item.title}
      </h3>
      <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
        {item.content}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span>{item.author || "public discussion"}</span>
        {item.country && <span>{item.country}</span>}
        <span>engagement {item.engagement?.toLowerCase() || "—"}</span>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto font-medium text-teal hover:underline underline-offset-2"
          >
            open source
          </a>
        )}
      </div>
    </article>
  );
}

/** Analysed user-submitted posts, shown in the analyzer view. */
export function AnalyzedRow({
  item,
  onOpen,
}: {
  item: {
    id: string;
    title: string;
    description: string;
    platform: string;
    sentiment: string;
    sentimentScore: number;
    emotion: string;
    engagement: string;
    hashtags: string[];
    analyzedAt: string;
    url?: string;
  };
  onOpen?: (url?: string) => void;
}) {
  return (
    <article className="settle border-t border-hair py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <PlatformMark platform={item.platform} size={15} />
          {channelLabel(item.platform)}
        </span>
        <span className={cn("inline-flex items-center gap-1 font-medium", sentimentColor(item.sentiment))}>
          <span aria-hidden="true">{sentimentMark(item.sentiment)}</span>
          {sentimentText(item.sentiment)}
        </span>
        <span className="tnum text-ink-3">{item.sentimentScore.toFixed(2)}</span>
        <span className="text-ink-3">{item.emotion}</span>
        <span className="ml-auto text-ink-3">{relativeTime(item.analyzedAt)}</span>
      </div>

      <h3 className="mt-1.5 text-[14px] font-medium leading-snug text-ink">{item.title}</h3>
      <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-ink-2">
        {item.description}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
        <span>engagement {item.engagement?.toLowerCase() || "—"}</span>
        {item.hashtags?.slice(0, 4).map((t) => (
          <span key={t} className="text-teal">
            #{t.replace(/^#/, "")}
          </span>
        ))}
        {item.url && !item.url.startsWith("manual-text") && (
          <button
            onClick={() => onOpen?.(item.url)}
            className="ml-auto font-medium text-teal hover:underline underline-offset-2"
          >
            open source
          </button>
        )}
      </div>
    </article>
  );
}
