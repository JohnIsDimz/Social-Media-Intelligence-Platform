import React, { useEffect, useState, useMemo } from "react";
import { MonitorResult } from "../types";

interface RadarScannerProps {
  monitorResults: MonitorResult[];
  lastIngestedTime?: number; // timestamp of last WebSocket ingestion
}

interface RadarBlip {
  id: string;
  name: string;
  angle: number; // degrees
  radius: number; // percentage of maximum radius (0 to 1)
  color: string;
  strength: number;
  activityPulse: boolean;
}

export const RadarScanner: React.FC<RadarScannerProps> = ({
  monitorResults,
  lastIngestedTime = 0
}) => {
  const [internalPulse, setInternalPulse] = useState(false);

  // Deep track updates to trigger a radar ping wave
  useEffect(() => {
    if (monitorResults.length > 0) {
      setInternalPulse(true);
      const timer = setTimeout(() => setInternalPulse(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [monitorResults.length, lastIngestedTime]);

  // Calculate coordinates for the 8 platform blips on a 200x200 canvas (center is 100, 100)
  const blips: RadarBlip[] = useMemo(() => {
    // Map platform to a fixed angle (to keep them in stable directions)
    const platformAngles: Record<string, number> = {
      tiktok: 45,
      instagram: 90,
      facebook: 135,
      whatsapp: 180,
      twitter: 225,
      youtube: 270,
      linkedin: 315,
      reddit: 0
    };

    const platformColors: Record<string, string> = {
      tiktok: "#000000",
      instagram: "#ec4899", // pink-500
      facebook: "#2563eb",  // blue-600
      whatsapp: "#22c55e",  // green-500
      twitter: "#3b82f6",   // sky-500
      youtube: "#ef4444",   // red-500
      linkedin: "#1d4ed8",  // blue-700
      reddit: "#f97316"     // orange-500
    };

    // Calculate aggregated stats from recent results
    return Object.keys(platformAngles).map((platform) => {
      const resultsForPlatform = monitorResults.filter(
        (r) => r.platform.toLowerCase() === platform
      );

      // Dynamically calculate average score/strength or default to a stable range
      const baseStrength = resultsForPlatform.length > 0
        ? Math.min(95, Math.max(30, resultsForPlatform.length * 15))
        : 45 + (platform.charCodeAt(0) % 3) * 15;

      // Distance from center represents signal strength (radius percent)
      const radiusPercent = 0.3 + (baseStrength / 100) * 0.55;

      return {
        id: platform,
        name: platform.toUpperCase(),
        angle: platformAngles[platform],
        radius: radiusPercent,
        color: platformColors[platform] || "#6366f1",
        strength: baseStrength,
        activityPulse: resultsForPlatform.length > 0
      };
    });
  }, [monitorResults]);

  const centerX = 100;
  const centerY = 100;
  const maxRadius = 80;

  return (
    <div className="relative w-48 h-48 md:w-56 md:h-56 bg-slate-950 rounded-full border border-slate-800 flex items-center justify-center p-1 overflow-hidden" id="radar-scanner-widget">
      {/* Absolute overlay concentric rings */}
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08)_0%,rgba(15,23,42,0)_70%)] pointer-events-none" />

      {/* WebSocket Signal Flash Background */}
      {internalPulse && (
        <div className="absolute inset-0 bg-indigo-500/10 animate-pulse-glow rounded-full pointer-events-none transition-all duration-300" />
      )}

      {/* SVG Radar Face */}
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full text-indigo-500/30"
      >
        {/* Graticule Grid Rings */}
        <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" strokeWidth="0.75" />
        <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 2" />
        <circle cx="100" cy="100" r="20" fill="none" stroke="currentColor" strokeWidth="0.5" />

        {/* Crosshair Lines */}
        <line x1="100" y1="10" x2="100" y2="190" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />
        <line x1="10" y1="100" x2="190" y2="100" stroke="currentColor" strokeWidth="0.5" strokeDasharray="4 4" />

        {/* Dynamic Sweep Line Layer (Rotating scanning sector beam) */}
        <g transform="translate(100, 100)" className="animate-radar-sweep origin-center">
          {/* Subtle gradient wedge representing the radar trail */}
          <path
            d="M 0 0 L 0 -80 A 80 80 0 0 1 40 -69 Z"
            fill="url(#radarGradient)"
            opacity="0.6"
          />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="-80"
            stroke="#818cf8"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="filter drop-shadow-[0_0_4px_rgba(129,140,248,0.8)]"
          />
        </g>

        {/* Gradient Definition */}
        <defs>
          <linearGradient id="radarGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(99, 102, 241, 0)" />
            <stop offset="100%" stopColor="rgba(99, 102, 241, 0.45)" />
          </linearGradient>
        </defs>

        {/* Live Concentric Active WebSocket Ping Ripples */}
        {internalPulse && (
          <>
            <circle
              cx="100"
              cy="100"
              r="10"
              className="fill-none stroke-indigo-400 animate-ping"
              style={{ transformOrigin: "100px 100px" }}
            />
            <circle
              cx="100"
              cy="100"
              r="30"
              className="fill-none stroke-indigo-400/60 opacity-75"
              style={{
                transformOrigin: "100px 100px",
                animation: "ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite"
              }}
            />
          </>
        )}

        {/* Radar Blips (Social Signals Platforms) */}
        {blips.map((blip) => {
          // Calculate exact X and Y coordinates based on angle and radius
          const angleRad = (blip.angle * Math.PI) / 180;
          const r = blip.radius * maxRadius;
          const x = centerX + r * Math.sin(angleRad);
          const y = centerY - r * Math.cos(angleRad);

          return (
            <g key={blip.id} className="group/blip">
              {/* Outer Dynamic Pulse ring for active sources */}
              <circle
                cx={x}
                cy={y}
                r="7"
                fill="none"
                stroke={blip.color}
                strokeWidth="1"
                className="opacity-40 animate-ping"
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  animationDuration: `${2 + (blip.strength % 3) * 0.5}s`
                }}
              />

              {/* Core solid blip dot */}
              <circle
                cx={x}
                cy={y}
                r={internalPulse ? "4" : "3"}
                fill={blip.color}
                className={`transition-all duration-300 filter drop-shadow-[0_0_3px_currentColor] ${
                  internalPulse ? "scale-125 animate-pulse" : ""
                }`}
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  color: blip.color
                }}
              />

              {/* Tiny Platform Tag Label on Hover */}
              <text
                x={x}
                y={y - 8}
                fontSize="6.5"
                textAnchor="middle"
                className="fill-slate-300 font-mono font-bold tracking-wider opacity-0 group-hover/blip:opacity-100 transition-opacity bg-slate-900 duration-200"
              >
                {blip.name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tiny active status label */}
      <div className="absolute bottom-2.5 px-2 py-0.5 rounded-full bg-slate-900/90 border border-slate-800 text-[8px] font-mono font-bold text-indigo-400 flex items-center gap-1">
        <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />
        SWEEP: ACTIVE
      </div>
    </div>
  );
};
