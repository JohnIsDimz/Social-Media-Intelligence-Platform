import React, { useEffect, useState } from "react";
import { CHANNELS, Button, cn, type ChannelKey } from "../lib/ui";
import { X, Check, AlertCircle, PlugZap } from "lucide-react";

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
  const [platforms, setPlatforms] = useState<ChannelKey[]>(["tiktok", "instagram"]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setType("brand");
      setPlatforms(["tiktok", "instagram"]);
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
                    className={cn(
                      "rounded-[5px] border px-2.5 py-1 text-[12px] transition-colors",
                      on
                        ? "border-teal bg-teal-soft text-teal"
                        : "border-hair bg-white text-ink-2 hover:border-ink-3"
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
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

export interface DataSources {
  geminiGrounding: boolean;
  reddit: boolean;
  youtube: boolean;
  twitter: boolean;
  tiktok: boolean;
  instagram: boolean;
  facebook: boolean;
  whatsapp: boolean;
  linkedin: boolean;
  notes?: Record<string, string>;
}

const SOURCE_LABELS: { key: keyof DataSources; label: string; note: string }[] = [
  { key: "geminiGrounding", label: "Google Search grounding", note: "Covers closed channels via web search. Needs GEMINI_API_KEY." },
  { key: "reddit", label: "Reddit", note: "Public read-only JSON endpoints. No credentials needed." },
  { key: "youtube", label: "YouTube", note: "Needs YOUTUBE_API_KEY." },
  { key: "twitter", label: "X / Twitter", note: "Needs TWITTER_BEARER_TOKEN." },
];

/**
 * Explains where data comes from — and which channels cannot be collected yet,
 * so an empty view is never mistaken for a broken one.
 */
export function DataSourcesDialog({
  open,
  onClose,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  sources: DataSources | null;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-petrol-deep/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-title"
        className="settle relative flex w-full max-w-[520px] flex-col rounded-[5px] border border-hair bg-paper shadow-xl"
      >
        <div className="flex items-baseline justify-between border-b border-hair px-5 py-4">
          <h2 id="sources-title" className="font-display text-[17px] font-semibold text-ink">
            Data sources
          </h2>
          <button onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">
            close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <p className="mb-4 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
            S.M.I.P only shows collected data. A channel stays empty until a source for it is
            configured and returns something.
          </p>

          <ul className="flex flex-col">
            {SOURCE_LABELS.map(({ key, label, note }) => {
              const on = Boolean(sources?.[key]);
              return (
                <li key={key} className="flex items-start gap-3 border-t border-hair py-3 first:border-t-0">
                  {on ? (
                    <Check size={14} className="mt-[3px] shrink-0 text-jade" aria-hidden="true" />
                  ) : (
                    <PlugZap size={14} className="mt-[3px] shrink-0 text-ink-3" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      {label}{" "}
                      <span className={cn("text-[12px] font-normal", on ? "text-jade" : "text-ink-3")}>
                        {on ? "connected" : "not configured"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{note}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-start gap-2 border-t border-hair pt-3">
            <AlertCircle size={14} className="mt-[3px] shrink-0 text-amber" aria-hidden="true" />
            <p className="text-[12px] leading-relaxed text-ink-3">
              {sources?.notes?.open ??
                "TikTok, Instagram, Facebook, WhatsApp and LinkedIn have no public read API, so they are only covered through search grounding."}
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
