import React, { useState } from "react";
import { CHANNELS, Button, cn, fmt } from "../lib/ui";
import { AnalyzedRow } from "../components/MentionRow";
import type { AnalyzedPost } from "../types";

interface AnalyzerViewProps {
  posts: AnalyzedPost[];
  isAnalyzing: boolean;
  onSubmit: (payload: { url?: string; text?: string; platform: string }) => void;
  onExport: () => void;
}

const PLATFORM_OPTIONS = [...CHANNELS, { key: "other", label: "Saluran lain" }] as const;

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      url: mode === "link" ? url.trim() : undefined,
      text: mode === "text" ? text.trim() : undefined,
      platform,
    });
    if (mode === "link") setUrl("");
    else setText("");
  };

  return (
    <div className="flex flex-col">
      <header className="settle pb-6">
        <p className="text-[13px] text-ink-3">analisis satu kiriman</p>
        <h1 className="mt-1.5 max-w-[26ch] font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-ink sm:text-[32px]">
          Baca nada satu kiriman sebelum ikut membicarakannya.
        </h1>
        <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
          Tempel tautan atau teks mentah. Model menilai sentimen, emosi, dan tingkat
          keterlibatan, lalu menyimpannya ke riwayat di bawah.
        </p>
      </header>

      <section aria-labelledby="input-title" className="border-y border-hair py-6">
        <h2 id="input-title" className="sr-only">
          Masukan untuk dianalisis
        </h2>

        {/* Mode switch: two plain options, the active one underlined */}
        <div className="flex items-center gap-5" role="tablist" aria-label="Jenis masukan">
          {(
            [
              { key: "text", label: "Teks langsung" },
              { key: "link", label: "Tautan kiriman" },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "border-b-2 pb-1 text-[13px] font-medium transition-colors",
                mode === m.key
                  ? "border-teal text-ink"
                  : "border-transparent text-ink-3 hover:border-hair hover:text-ink-2"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          {mode === "text" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_11rem]">
              <div>
                <label htmlFor="raw-text" className="label mb-1.5 block">
                  Teks kiriman atau komentar
                </label>
                <textarea
                  id="raw-text"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Contoh: layanannya cepat tapi harganya naik terus bulan ini"
                  className="w-full resize-y rounded-[5px] border border-hair bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="platform" className="label mb-1.5 block">
                  Kanal asal
                </label>
                <select
                  id="platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full rounded-[5px] border border-hair bg-white px-3 py-2.5 text-[14px] text-ink focus:border-teal focus:outline-none"
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
                Tautan kiriman publik
              </label>
              <input
                id="post-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/…"
                className="w-full rounded-[5px] border border-hair bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                Hanya tautan HTTPS dari TikTok, Instagram, Facebook, WhatsApp, X, YouTube,
                LinkedIn, atau Reddit yang dapat diambil.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isAnalyzing ? "menganalisis…" : "Analisis kiriman"}
            </Button>
            <span className="text-[12px] text-ink-3">
              {isAnalyzing
                ? "Model sedang membaca konteks dan nuansa bahasa."
                : "Hasil tersimpan otomatis ke riwayat."}
            </span>
          </div>
        </form>
      </section>

      <section aria-labelledby="history-title" className="pt-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="history-title" className="font-display text-[19px] font-semibold text-ink">
              Riwayat analisis
            </h2>
            <span className="tnum text-[12px] text-ink-3">{fmt(posts.length)} kiriman</span>
          </div>
          {posts.length > 0 && (
            <button
              onClick={onExport}
              className="text-[12px] font-medium text-teal hover:underline underline-offset-2"
            >
              ekspor CSV
            </button>
          )}
        </div>

        {posts.length > 0 ? (
          <div className="border-t border-hair">
            {posts.map((p) => (
              <AnalyzedRow key={p.id} item={p} />
            ))}
          </div>
        ) : (
          <div className="border-t border-hair pt-5">
            <p className="text-[14px] text-ink-2">Belum ada kiriman yang dianalisis.</p>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
              Mulai dari komentar yang paling mewakili keluhan pelanggan minggu ini; satu
              kiriman sudah cukup untuk melihat bagaimana model membaca nada.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
