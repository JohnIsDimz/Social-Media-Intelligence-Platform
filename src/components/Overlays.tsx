import React, { useEffect, useState } from "react";
import { CHANNELS, Button, cn, type ChannelKey } from "../lib/ui";
import { X, Check, AlertCircle, RefreshCw } from "lucide-react";
import { PlatformMark } from "./PlatformMark";

/* ---------------------------------- Drawer --------------------------------- */

export function RailDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-petrol-deep/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="settle absolute inset-y-0 left-0 w-[290px] max-w-[85vw] overflow-y-auto bg-paper shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-hair px-5 py-3">
          <span className="text-[13px] font-medium text-ink-2">Navigation</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-[5px] text-ink-3 hover:bg-paper-2 hover:text-ink"
            aria-label="Close menu"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------------------- Add tracker ------------------------------ */

export function AddTrackerDialog({
  open,
  onClose,
  onCreate,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: { type: "brand" | "hashtag"; query: string; platforms: ChannelKey[] }) => void;
  busy?: boolean;
}) {
  const [type, setType] = useState<"brand" | "hashtag">("brand");
  const [query, setQuery] = useState("");
  // Default to channels that can actually collect something without a key.
  const [platforms, setPlatforms] = useState<ChannelKey[]>([
    "reddit",
    "bluesky",
    "hackernews",
    "news",
    "tiktok",
    "instagram",
  ]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setType("brand");
      setPlatforms(["reddit", "bluesky", "hackernews", "news", "tiktok", "instagram"]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (key: ChannelKey) =>
    setPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || platforms.length === 0) return;
    onCreate({ type, query: query.trim(), platforms });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-petrol-deep/45" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        className="settle relative w-full max-w-[480px] rounded-[5px] border border-hair bg-paper shadow-xl"
      >
        <div className="flex items-baseline justify-between border-b border-hair px-5 py-4">
          <h2 id="add-title" className="font-display text-[17px] font-semibold text-ink">
            New tracker
          </h2>
          <button type="button" onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">
            cancel
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <fieldset>
            <legend className="label mb-2">Type</legend>
            <div className="flex gap-2">
              {(
                [
                  { key: "brand", label: "Brand or competitor" },
                  { key: "hashtag", label: "Hashtag or topic" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  aria-pressed={type === t.key}
                  className={cn(
                    "rounded-[5px] border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    type === t.key
                      ? "border-teal bg-teal-soft text-teal"
                      : "border-hair bg-white text-ink-2 hover:border-ink-3"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="tracker-query" className="label mb-1.5 block">
              Keyword
            </label>
            <input
              id="tracker-query"
              required
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={type === "brand" ? "e.g. Kopi Kenangan" : "e.g. #GenerativeAI"}
              className="w-full rounded-[5px] border border-hair bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-ink-3">1–200 characters.</p>
          </div>

          <fieldset>
            <legend className="label mb-2">Channels to scan</legend>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const on = platforms.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggle(c.key)}
                    aria-pressed={on}
                    title={c.collects}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[5px] border py-1 pl-1 pr-2 text-[12px] transition-colors",
                      on
                        ? "border-teal bg-teal-soft text-teal"
                        : "border-hair bg-white text-ink-2 hover:border-ink-3"
                    )}
                  >
                    <PlatformMark platform={c.key} size={14} />
                    {c.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
              <button
                type="button"
                onClick={() => setPlatforms(CHANNELS.map((c) => c.key))}
                className="font-medium text-teal hover:underline underline-offset-2"
              >
                select all
              </button>
              <button
                type="button"
                onClick={() =>
                  setPlatforms(
                    CHANNELS.filter((c) => c.kind === "api").map((c) => c.key)
                  )
                }
                className="font-medium text-teal hover:underline underline-offset-2"
              >
                searchable APIs only
              </button>
              <span className="text-ink-3">
                {platforms.length}/{CHANNELS.length} selected
              </span>
            </div>
            {platforms.length === 0 && (
              <p className="mt-2 text-[11px] text-brick">Select at least one channel.</p>
            )}
          </fieldset>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair px-5 py-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !query.trim() || platforms.length === 0}
          >
            {busy ? "saving…" : "Save and scan"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------- Data sources ------------------------------ */

/** Result of `GET /api/channel-health`, keyed by channel key. */
export interface ChannelHealth {
  status: "configured" | "public" | "grounding" | "needs-key" | "closed" | "down" | "unverified";
  detail: string;
}

export interface DataSources {
  grounding: boolean;
  /** Whether this host can reach the internet at all. */
  egress?: boolean;
  channels: Record<string, ChannelHealth>;
  checkedAt?: string;
  summary?: {
    reachable: number;
    searchOnly?: number;
    needsKey: number;
    closed: number;
    down: number;
    unverified?: number;
    total: number;
  };
}

const STATUS_STYLE: Record<
  ChannelHealth["status"],
  { label: string; className: string }
> = {
  configured: { label: "connected", className: "border-jade/40 bg-jade/10 text-jade" },
  public: { label: "open API", className: "border-jade/40 bg-jade/10 text-jade" },
  grounding: { label: "search only", className: "border-hair bg-paper-2 text-ink-2" },
  "needs-key": { label: "needs key", className: "border-amber/40 bg-amber-soft text-amber" },
  closed: { label: "no access", className: "border-hair bg-paper-2 text-ink-3" },
  down: { label: "network down", className: "border-brick/40 bg-brick/10 text-brick" },
  unverified: { label: "untested", className: "border-hair bg-paper-2 text-ink-2" },
};

/**
 * Where data comes from — one row per network, with its real logo, how it is
 * collected, and whether that path is alive right now. This is the honest
 * answer to "why is this channel empty?".
 */
export function DataSourcesDialog({
  open,
  onClose,
  sources,
  onRecheck,
  checking,
}: {
  open: boolean;
  onClose: () => void;
  sources: DataSources | null;
  onRecheck?: () => void;
  checking?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "live" | "issues">("all");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows = CHANNELS.map((c) => ({
    ...c,
    health: sources?.channels?.[c.key] ?? { status: "closed" as const, detail: "Not checked yet." },
  }));

  const visible = rows.filter((r) => {
    if (filter === "live") return r.health.status === "configured" || r.health.status === "public" || r.health.status === "grounding";
    if (filter === "issues")
      return (
        r.health.status === "down" ||
        r.health.status === "needs-key" ||
        r.health.status === "closed" ||
        r.health.status === "unverified"
      );
    return true;
  });

  const summary = sources?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-petrol-deep/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-title"
        className="settle relative flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-[5px] border border-hair bg-paper shadow-xl"
      >
        <div className="flex items-baseline justify-between gap-3 border-b border-hair px-5 py-4">
          <div>
            <h2 id="sources-title" className="font-display text-[17px] font-semibold text-ink">
              Data sources
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              {summary
                ? [
                    `${summary.total} networks`,
                    `${summary.reachable} reachable`,
                    summary.searchOnly ? `${summary.searchOnly} via search` : null,
                    `${summary.needsKey} need a key`,
                    summary.down ? `${summary.down} unreachable` : null,
                    summary.unverified ? `${summary.unverified} untested` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "checking networks…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={onRecheck}
              disabled={checking}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-teal hover:underline underline-offset-2 disabled:opacity-50"
            >
              <RefreshCw size={12} aria-hidden="true" className={cn(checking && "animate-spin")} />
              {checking ? "testing…" : "test all"}
            </button>
            <button onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">
              close
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 border-b border-hair px-5 py-2" role="tablist" aria-label="Filter by status">
          {(
            [
              { key: "all", label: "All" },
              { key: "live", label: "Collecting" },
              { key: "issues", label: "Not collecting" },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "border-b-2 pb-1 text-[12px] font-medium transition-colors",
                filter === f.key
                  ? "border-teal text-ink"
                  : "border-transparent text-ink-3 hover:text-ink-2"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <ul className="flex flex-col">
            {visible.map((c) => {
              const style = STATUS_STYLE[c.health.status];
              return (
                <li key={c.key} className="flex items-start gap-3 border-b border-hair/70 py-2.5 last:border-0">
                  <PlatformMark platform={c.key} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-medium text-ink">{c.label}</span>
                      <span
                        className={cn(
                          "rounded-[3px] border px-1.5 py-[1px] text-[10px] font-medium",
                          style.className
                        )}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{c.health.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 && (
            <p className="py-6 text-center text-[12px] text-ink-3">Nothing in this category.</p>
          )}
        </div>

        <div className="flex items-start gap-2 border-t border-hair px-5 py-3">
          <AlertCircle size={14} className="mt-[3px] shrink-0 text-amber" aria-hidden="true" />
          <div className="text-[12px] leading-relaxed text-ink-3">
            {sources?.egress === false && (
              <p className="mb-1 font-medium text-brick">
                This server has no outbound internet, so no network can be tested. That is a hosting
                problem, not a dead API.
              </p>
            )}
            <p>
              No data is ever invented. A channel shows zero until a source above actually returns
              something. “search only” means the platform has no public read API and is reachable
              only through Google Search grounding (<code>GEMINI_API_KEY</code>).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Toasts --------------------------------- */

export interface Toast {
  id: number;
  kind: "ok" | "fail";
  message: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-5 sm:items-end sm:pr-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "settle pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-[5px] border bg-white px-3.5 py-2.5 text-[13px] shadow-sm",
            t.kind === "ok" ? "border-jade/30 text-ink" : "border-brick/30 text-ink"
          )}
        >
          {t.kind === "ok" ? (
            <Check size={14} className="mt-[3px] shrink-0 text-jade" aria-hidden="true" />
          ) : (
            <AlertCircle size={14} className="mt-[3px] shrink-0 text-brick" aria-hidden="true" />
          )}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-ink-3 hover:text-ink"
            aria-label="Dismiss notification"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
