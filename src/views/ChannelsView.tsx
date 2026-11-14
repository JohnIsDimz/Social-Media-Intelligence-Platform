import React from "react";
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
  const simulated = results.filter((r) => r.isSimulated).length;
  const real = results.length - simulated;

  return (
    <div className="flex flex-col">
      <header className="settle flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">pemantauan brand</p>
          <h1 className="mt-1.5 truncate font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-ink sm:text-[32px]">
            {tracker ? tracker.query : "Belum ada pemantauan dipilih"}
          </h1>
          <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">
            {tracker
              ? `Membaca ${results.length > 0 ? fmt(results.length) : "belum ada"} penyebutan di ${tracker.platforms.length} kanal.${
                  simulated > 0
                    ? ` ${simulated} di antaranya berasal dari model simulasi.`
                    : real > 0
                      ? " Semua berasal dari data yang dikumpulkan."
                      : ""
                }`
              : "Tambahkan brand, produk, atau tagar yang ingin dipantau."}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {tracker ? (
            <>
              {results.length > 0 && (
                <Button variant="quiet" onClick={onExport}>
                  Ekspor
                </Button>
              )}
              <Button variant="primary" onClick={onScan} disabled={isScanning}>
                {isScanning ? "memindai…" : "Pindai ulang"}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onAddTracker}>
              Tambah pemantauan
            </Button>
          )}
        </div>
      </header>

      {tracker && tracker.platforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-hair py-2.5 text-[12px] text-ink-3">
          <span>kanal</span>
          {tracker.platforms.map((p) => (
            <span key={p} className="text-ink-2">
              {channelLabel(p)}
            </span>
          ))}
        </div>
      )}

      <section aria-labelledby="mentions-title" className="pt-6">
        <h2 id="mentions-title" className="sr-only">
          Penyebutan terbaru
        </h2>

        {results.length > 0 ? (
          <div className="border-t border-hair">
            {results.slice(0, 60).map((r) => (
              <MentionRow key={r.id} item={r} />
            ))}
          </div>
        ) : (
          <div className="border-t border-hair pt-6">
            <p className="text-[14px] text-ink-2">
              {tracker
                ? "Belum ada penyebutan yang terkumpul untuk pemantauan ini."
                : "Pilih salah satu pemantauan di kiri, atau tambahkan yang baru."}
            </p>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
              {tracker
                ? "Jalankan pemindaian untuk menarik diskusi publik terbaru dari kanal yang dipilih."
                : "Sebutkan nama brand, produk, atau tagar yang paling sering muncul di kolom komentar."}
            </p>
            {tracker && (
              <Button variant="quiet" className="mt-4" onClick={onScan} disabled={isScanning}>
                {isScanning ? "memindai…" : "Jalankan pemindaian"}
              </Button>
            )}
          </div>
        )}

        {results.length > 60 && (
          <p className={cn("pt-3 text-[12px] text-ink-3")}>
            Menampilkan 60 penyebutan terbaru dari {fmt(results.length)}.
          </p>
        )}
      </section>
    </div>
  );
}
