import React from "react";
import { cn, channelLabel, shortDate } from "../lib/ui";
import type { Tracker } from "../types";
import { BarChart3, ScanLine, Radar, Plus, X, Bell, BellOff, Activity } from "lucide-react";

export type View = "overview" | "analyzer" | "channels";

const NAV: { key: View; label: string; note: string; Icon: typeof BarChart3 }[] = [
  { key: "overview", label: "Analytics", note: "sentiment and forecast", Icon: BarChart3 },
  { key: "analyzer", label: "Analyse", note: "check a single post", Icon: ScanLine },
  { key: "channels", label: "Monitor", note: "tracked brands", Icon: Radar },
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
}: SideRailProps) {
  const connectionLabel =
    connection === "connected"
      ? "live connection"
      : connection === "polling"
        ? "periodic sync"
        : connection === "connecting"
          ? "connecting"
          : "disconnected";

  const isUp = connection === "connected" || connection === "polling";

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col gap-7 px-5 py-6 lg:px-6">
      <div>
        <p className="label mb-3">Workspace</p>
        <ul className="flex flex-col">
          {NAV.map(({ key, label, note, Icon }) => {
            const active = view === key;
            return (
              <li key={key}>
                <button
                  onClick={() => onChangeView(key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex w-full items-start gap-2.5 border-l-2 py-2 pl-3 pr-2 text-left transition-colors",
                    active
                      ? "border-amber text-ink"
                      : "border-transparent text-ink-2 hover:border-hair hover:text-ink"
                  )}
                >
                  <Icon
                    size={14}
                    aria-hidden="true"
                    className={cn("mt-[3px] shrink-0", active ? "text-amber" : "text-ink-3")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn("text-[14px]", active ? "font-semibold" : "font-medium")}>
                      {label}
                    </span>
                    <span className="text-[12px] text-ink-3">{note}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="label">Trackers</p>
          <button
            onClick={onAddTracker}
            className="inline-flex items-center gap-0.5 text-[12px] font-medium text-teal hover:underline underline-offset-2"
          >
            <Plus size={12} aria-hidden="true" />
            add
          </button>
        </div>

        {trackers.length === 0 ? (
          <p className="border-l-2 border-hair py-1 pl-3 text-[12px] leading-relaxed text-ink-3">
            Nothing tracked yet. Add a brand or hashtag to start collecting public conversation.
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
                    <span className="w-full truncate text-[13px] font-medium text-ink">{t.query}</span>
                    <span className="text-[11px] text-ink-3">
                      {t.type === "hashtag" ? "hashtag" : "brand"} · {t.platforms.length} channels
                      {t.platforms.length > 0
                        ? ` · ${t.platforms.slice(0, 3).map(channelLabel).join(", ")}`
                        : ""}
                    </span>
                    <span className="text-[11px] text-ink-3/80">{shortDate(t.createdAt)}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTracker(t.id);
                    }}
                    className="absolute right-1 top-1.5 grid h-6 w-6 place-items-center rounded-[3px] text-ink-3/0 transition-colors hover:bg-brick/10 hover:text-brick group-hover:text-ink-3"
                    aria-label={`Delete tracker ${t.query}`}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-hair pt-4">
        <div className="flex items-center gap-2">
          <Activity
            size={12}
            aria-hidden="true"
            className={cn(isUp ? "text-jade" : connection === "connecting" ? "text-amber" : "text-brick")}
          />
          <span className="text-[12px] text-ink-2">{connectionLabel}</span>
        </div>

        <button
          onClick={onToggleNotifications}
          className="flex items-center gap-2 text-left text-[12px] text-ink-2 hover:text-ink"
          aria-pressed={notificationsOn}
        >
          {notificationsOn ? (
            <Bell size={13} aria-hidden="true" className="text-teal" />
          ) : (
            <BellOff size={13} aria-hidden="true" className="text-ink-3" />
          )}
          <span>Desktop alerts {notificationsOn ? "on" : "off"}</span>
        </button>

        <p className="text-[11px] leading-relaxed text-ink-3">
          Every figure comes from collected data. Channels with nothing to show are left empty.
        </p>
      </div>
    </nav>
  );
}
