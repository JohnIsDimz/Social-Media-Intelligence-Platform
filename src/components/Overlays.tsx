import React, { useEffect, useState } from "react";
import { CHANNELS, Button, cn, type ChannelKey } from "../lib/ui";

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
      <div
        className="absolute inset-0 bg-petrol-deep/45"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu navigasi"
        className="settle absolute inset-y-0 left-0 w-[290px] max-w-[85vw] overflow-y-auto bg-paper shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-hair px-5 py-3">
          <span className="text-[13px] font-medium text-ink-2">Navigasi</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-[5px] text-ink-3 hover:bg-paper-2 hover:text-ink"
            aria-label="Tutup menu"
          >
            ✕
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
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );

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
            Pemantauan baru
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-ink-3 hover:text-ink"
          >
            batal
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <fieldset>
            <legend className="label mb-2">Jenis</legend>
            <div className="flex gap-2">
              {(
                [
                  { key: "brand", label: "Brand / kompetitor" },
                  { key: "hashtag", label: "Tagar / topik" },
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
              Kata kunci
            </label>
            <input
              id="tracker-query"
              required
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={type === "brand" ? "mis. Kopi Kenangan" : "mis. #GenerativeAI"}
              className="w-full rounded-[5px] border border-hair bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3/70 focus:border-teal focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-ink-3">1–200 karakter.</p>
          </div>

          <fieldset>
            <legend className="label mb-2">Kanal yang dipindai</legend>
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
              <p className="mt-2 text-[11px] text-brick">Pilih minimal satu kanal.</p>
            )}
          </fieldset>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair px-5 py-4">
          <Button type="button" variant="quiet" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !query.trim() || platforms.length === 0}
          >
            {busy ? "menyimpan…" : "Simpan dan pindai"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------- Toasts --------------------------------- */

export interface Toast {
  id: number;
  kind: "ok" | "fail";
  message: string;
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-5 sm:items-end sm:pr-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "settle pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-[5px] border px-3.5 py-2.5 text-[13px] shadow-sm",
            t.kind === "ok"
              ? "border-jade/30 bg-white text-ink"
              : "border-brick/30 bg-white text-ink"
          )}
        >
          <span
            className={cn(
              "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
              t.kind === "ok" ? "bg-jade" : "bg-brick"
            )}
            aria-hidden="true"
          />
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-[12px] text-ink-3 hover:text-ink"
            aria-label="Tutup pemberitahuan"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
