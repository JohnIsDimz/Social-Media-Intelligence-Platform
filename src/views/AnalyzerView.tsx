import React, { useState } from "react";
import { CHANNELS, Button, cn, fmt } from "../lib/ui";
import { AnalyzedRow } from "../components/MentionRow";
import type { AnalyzedPost } from "../types";

interface AnalyzerViewProps {
  posts: AnalyzedPost[];
  isAnalyzing: boolean;
  onSubmit: (payload: { url?: string; text?: string; platform: string }) => Promise<boolean>;
  onExport: () => void;
}

const PLATFORM_OPTIONS = [...CHANNELS, { key: "other", label: "Other channel" }] as const;

export function AnalyzerView({
  posts,
  isAnalyzing,
  onSubmit,
  onExport,
}: AnalyzerViewProps) {
  const [mode, setMode] = useState<"link" | "text">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("tiktok");

  const canSubmit =
    !isAnalyzing && (mode === "link" ? url.trim().length > 0 : text.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onSubmit({
      url: mode === "link" ? url.trim() : undefined,
      text: mode === "text" ? text.trim() : undefined,
      platform,
    });
    // Only clear the input when the analysis actually happened. A failed fetch
    // used to wipe the text the user had pasted, so the error toast arrived with
    // nothing left to retry.
    if (!ok) return;
    if (mode === "link") setUrl("");
    else setText("");
  };

  return (
    <div className="flex flex-col">
      <header className="settle pb-6">
        <p className="text-[13px] text-ink-3">analyse a single post</p>
        <h1 className="mt-1.5 max-w-[26ch] font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-ink sm:text-[32px]">
          Read the tone of a post before you join the conversation.
        </h1>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
          Paste a link or raw text. The model rates sentiment and emotion, then saves the
          result to the history below. Engagement is only shown when the platform
          publishes a count.
        </p>
      </header>

      <section
        aria-labelledby="input-title"
        className="card p-5 sm:p-6"
      >
        <h2 id="input-title" className="sr-only">
          Input to analyse
        </h2>

        {/* Mode switch: two plain options, the active one underlined */}
        <div
          className="inline-flex items-center gap-1 rounded-full border border-hair bg-surface-2 p-1"
          role="tablist"
          aria-label="Input type"
        >
          {(
            [
              { key: "text", label: "Direct text" },
              { key: "link", label: "Post link" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              role="tab"
              id={`tab-${m.key}`}
              aria-controls="analyzer-panel"
              aria-selected={mode === m.key}
              tabIndex={mode === m.key ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                setMode(mode === "text" ? "link" : "text");
              }}
              onClick={() => setMode(m.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
                mode === m.key
                  ? "bg-surface text-ink shadow-[var(--shadow-card)]"
                  : "text-ink-3 hover:text-ink-2"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form
          id="analyzer-panel"
          role="tabpanel"
          aria-labelledby={`tab-${mode}`}
          onSubmit={handleSubmit}
          className="mt-4 flex flex-col gap-4"
        >
          {mode === "text" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_11rem]">
              <div>
                <label htmlFor="raw-text" className="label mb-1.5 block">
                  Post text or comment
                </label>
                <textarea
                  id="raw-text"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. the service is fast but prices keep climbing"
                  className="w-full resize-y rounded-[var(--radius-control)] border border-hair bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="platform" className="label mb-1.5 block">
                  Source channel
                </label>
                <select
                  id="platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-hair bg-surface px-3 py-2.5 text-[14px] text-ink focus:border-teal focus:outline-none"
                >
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="post-url" className="label mb-1.5 block">
                Public post link
              </label>
              <input
                id="post-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/…"
                className="w-full rounded-[var(--radius-control)] border border-hair bg-surface px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                Only HTTPS links from TikTok, Instagram, Facebook, WhatsApp, X, YouTube,
                LinkedIn or Reddit can be fetched.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isAnalyzing ? "analysing…" : "Analyse post"}
            </Button>
            <span className="text-[12px] text-ink-3">
              {isAnalyzing
                ? "The model is reading context and nuance."
                : "Results are saved to the history automatically."}
            </span>
          </div>
        </form>
      </section>

      <section aria-labelledby="history-title" className="card mt-6 p-5 sm:p-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="history-title" className="font-display text-[19px] font-semibold text-ink">
              Analysis history
            </h2>
            <span className="tnum text-[12px] text-ink-3">{fmt(posts.length)} posts</span>
          </div>
          {posts.length > 0 && (
            <button
              onClick={onExport}
              className="text-[12px] font-medium text-teal hover:underline underline-offset-2"
            >
              export CSV
            </button>
          )}
        </div>

        {posts.length > 0 ? (
          <div>
            {posts.map((p) => (
              <AnalyzedRow key={p.id} item={p} />
            ))}
          </div>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-dashed border-hair bg-surface-2 px-4 py-5">
            <p className="text-[14px] text-ink-2">Nothing analysed yet.</p>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
              Start with the comment that best represents this week's complaints; one
              post is enough to see how the model reads tone.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
