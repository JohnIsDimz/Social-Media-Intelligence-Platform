import React from "react";
import { cn, channelLabel, shortDate } from "../lib/ui";
import type { Tracker } from "../types";

export type View = "overview" | "analyzer" | "channels";

const NAV: { key: View; label: string; note: string }[] = [
  { key: "overview", label: "Analitik", note: "sentimen & prakiraan" },
  { key: "analyzer", label: "Analisis", note: "periksa satu kiriman" },
  { key: "channels", label: "Monitor", note: "pantauan brand" },
];

interface SideRailProps {
  view: View;
  onChangeView: (v: View) => void;
  trackers: Tracker[];
  activeTrackerId: string;
  onSelectTracker: (id: string) => void;
  onAddTracker: () => void;
  onDeleteTracker: (id: string) => void;
  connection: "connected" | "connecting" | "disconnected" | "polling";
  notificationsOn: boolean;
  onToggleNotifications: () => void;
  simulated: boolean;
}

export function SideRail({
  view,
  onChangeView,
  trackers,
  activeTrackerId,
  onSelectTracker,
  onAddTracker,
  onDeleteTracker,
  connection,
  notificationsOn,
  onToggleNotifications,
  simulated,
}: SideRailProps) {
  const connectionLabel =
    connection === "connected"
      ? "tersambung langsung"
      : connection === "polling"
        ? "sinkron berkala"
        : connection === "connecting"
          ? "menyambung"
          : "terputus";

  return (
    <nav
      aria-label="Navigasi utama"
      className="flex h-full flex-col gap-7 px-5 py-6 lg:px-6"
    >
      <div>
        <p className="label mb-3">Ruang kerja</p>
        <ul className="flex flex-col">
          {NAV.map((item) => {
            const active = view === item.key;
            return (
              <li key={item.key}>
                <button
                  onClick={() => onChangeView(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex w-full flex-col items-start gap-0.5 border-l-2 py-2 pl-3 pr-2 text-left transition-colors",
                    active
                      ? "border-amber text-ink"
                      : "border-transparent text-ink-2 hover:border-hair hover:text-ink"
                  )}
                >
                  <span
                    className={cn(
                      "text-[14px] font-medium",
                      active ? "font-semibold" : ""
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="text-[12px] text-ink-3">{item.note}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="label">Pemantauan</p>
          <button
            onClick={onAddTracker}
            className="text-[12px] font-medium text-teal hover:underline underline-offset-2"
          >
            + tambah
          </button>
        </div>

        {trackers.length === 0 ? (
          <p className="border-l-2 border-hair py-1 pl-3 text-[12px] leading-relaxed text-ink-3">
            Belum ada yang dipantau. Tambahkan brand atau tagar untuk mulai membaca
            percakapan publik.
          </p>
        ) : (
          <ul className="flex max-h-[42vh] flex-col overflow-y-auto pr-1">
            {trackers.map((t) => {
              const active = t.id === activeTrackerId;
              return (
                <li key={t.id} className="group relative">
                  <button
                    onClick={() => onSelectTracker(t.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-l-2 py-2 pl-3 pr-7 text-left transition-colors",
                      active
                        ? "border-teal bg-teal-soft/50"
                        : "border-transparent hover:border-hair hover:bg-paper-2/40"
                    )}
                  >
                    <span className="w-full truncate text-[13px] font-medium text-ink">
                      {t.query}
                    </span>
                    <span className="text-[11px] text-ink-3">
                      {t.type === "hashtag" ? "tagar" : "brand"} · {t.platforms.length} kanal
                      {t.platforms.length > 0 ? ` · ${t.platforms.slice(0, 3).map(channelLabel).join(", ")}` : ""}
                    </span>
                    <span className="text-[11px] text-ink-3/80">{shortDate(t.createdAt)}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTracker(t.id);
                    }}
                    className="absolute right-1 top-1.5 grid h-6 w-6 place-items-center rounded-[3px] text-ink-3/0 transition-colors hover:bg-brick/10 hover:text-brick group-hover:text-ink-3"
                    aria-label={`Hapus pemantauan ${t.query}`}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                      <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-hair pt-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connection === "connected" || connection === "polling"
                ? "bg-jade live-dot"
                : connection === "connecting"
                  ? "bg-amber live-dot"
                  : "bg-brick"
            )}
            aria-hidden="true"
          />
          <span className="text-[12px] text-ink-2">{connectionLabel}</span>
        </div>

        <button
          onClick={onToggleNotifications}
          className="flex items-center gap-2 text-left text-[12px] text-ink-2 hover:text-ink"
        >
          <span
            className={cn(
              "grid h-4 w-4 place-items-center rounded-[3px] border",
              notificationsOn
                ? "border-teal bg-teal text-white"
                : "border-hair bg-white text-transparent"
            )}
            aria-hidden="true"
          >
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5l2.2 2.2L8 1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
          <span>Notifikasi peramban {notificationsOn ? "aktif" : "mati"}</span>
        </button>

        {simulated && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            Sebagian angka berasal dari model simulasi dan ditandai{" "}
            <span className="font-medium text-amber">simulasi</span>.
          </p>
        )}
      </div>
    </nav>
  );
}
