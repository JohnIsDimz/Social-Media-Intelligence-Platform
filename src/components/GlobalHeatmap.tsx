import React, { useState, useMemo } from "react";
import { MonitorResult } from "../types";
import { Globe, RefreshCw, Layers, ZoomIn, ZoomOut, Compass } from "lucide-react";

interface GlobalHeatmapProps {
  monitorResults: MonitorResult[];
  trackerQuery?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

const Landmasses = [
  // North America
  {
    name: "North America",
    points: [
      [-168, 65], [-150, 70], [-120, 72], [-100, 75], [-80, 75], [-60, 65], 
      [-50, 50], [-60, 45], [-80, 25], [-100, 15], [-120, 35], [-125, 48], 
      [-165, 54], [-168, 65]
    ]
  },
  // South America
  {
    name: "South America",
    points: [
      [-80, 12], [-70, 10], [-50, -5], [-35, -5], [-40, -20], [-60, -45], 
      [-72, -55], [-74, -40], [-81, -15], [-80, 12]
    ]
  },
  // Europe
  {
    name: "Europe",
    points: [
      [-10, 62], [10, 65], [30, 65], [40, 60], [35, 45], [20, 36], 
      [-5, 36], [-10, 50], [-10, 62]
    ]
  },
  // Africa
  {
    name: "Africa",
    points: [
      [-17, 32], [10, 32], [32, 31], [50, 12], [40, -15], [30, -34], 
      [18, -34], [10, -10], [-10, 5], [-17, 15], [-17, 32]
    ]
  },
  // Asia
  {
    name: "Asia",
    points: [
      [35, 60], [60, 70], [90, 75], [120, 75], [150, 70], [170, 60], 
      [140, 35], [120, 10], [100, 1], [80, 10], [60, 15], [35, 35], [35, 60]
    ]
  },
  // Australia
  {
    name: "Australia",
    points: [
      [113, -22], [125, -15], [143, -15], [152, -22], [151, -33], 
      [140, -38], [115, -34], [113, -22]
    ]
  }
];

export const GlobalHeatmap: React.FC<GlobalHeatmapProps> = ({
  monitorResults,
  trackerQuery = "Global Intel",
  onRefresh,
  isLoading = false
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<MonitorResult | null>(null);
  const [filterSentiment, setFilterSentiment] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [mapScale, setMapScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Map canvas settings
  const width = 800;
  const height = 400;

  // Projection helper: Mercator projection conversion formulas
  const projectX = (lng: number) => {
    // map lng from [-180, 180] to [0, width]
    return ((lng + 180) / 360) * width;
  };

  const projectY = (lat: number) => {
    // map lat from [-90, 90] to [height, 0] (approximate flat mercator projection)
    return ((90 - lat) / 180) * height;
  };

  // Process monitor results into points on the map
  const activePoints = useMemo(() => {
    const pointsWithLoc = monitorResults.filter(
      (mr) => mr.latitude !== undefined && mr.latitude !== null && mr.longitude !== undefined && mr.longitude !== null
    );

    if (filterSentiment === "all") return pointsWithLoc;
    return pointsWithLoc.filter((mr) => mr.sentiment === filterSentiment);
  }, [monitorResults, filterSentiment]);

  // Landmass path generator
  const landmassPaths = useMemo(() => {
    return Landmasses.map((lm) => {
      const pathPoints = lm.points.map(([lng, lat]) => {
        const px = projectX(lng);
        const py = projectY(lat);
        return `${px},${py}`;
      });
      return {
        name: lm.name,
        pointsString: pathPoints.join(" ")
      };
    });
  }, []);

  // Latitude and Longitude Grid Lines (Graticules)
  const gridLines = useMemo(() => {
    const lines: { path: string; label?: string; type: "lat" | "lng" }[] = [];
    
    // Latitudes (-60, -30, 0, 30, 60)
    [-60, -30, 0, 30, 60].forEach((lat) => {
      const py = projectY(lat);
      lines.push({
        path: `M 0,${py} L ${width},${py}`,
        label: lat === 0 ? "EQUATOR" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`,
        type: "lat"
      });
    });

    // Longitudes (-120, -60, 0, 60, 120)
    [-120, -60, 0, 60, 120].forEach((lng) => {
      const px = projectX(lng);
      lines.push({
        path: `M ${px},0 L ${px},${height}`,
        label: lng === 0 ? "MERIDIAN" : `${Math.abs(lng)}°${lng > 0 ? "E" : "W"}`,
        type: "lng"
      });
    });

    return lines;
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetMap = () => {
    setMapScale(1);
    setPanOffset({ x: 0, y: 0 });
    setFilterSentiment("all");
  };

  const zoom = (factor: number) => {
    setMapScale((prev) => Math.max(0.8, Math.min(4, prev * factor)));
  };

  // Platform styling helpers
  const getPlatformIconColor = (platform: string) => {
    switch (platform) {
      case "tiktok": return "text-black";
      case "instagram": return "text-pink-500";
      case "twitter": return "text-sky-500";
      case "facebook": return "text-blue-600";
      case "reddit": return "text-orange-500";
      case "linkedin": return "text-blue-700";
      case "youtube": return "text-red-600";
      default: return "text-indigo-600";
    }
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col" id="global-heatmap-container">
      {/* Header Panel */}
      <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/60">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <Globe className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-base flex items-center gap-2">
              Peta Panas Global Sinyal Media
              <span className="text-xs font-mono font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                Real-Time
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sebaran geografis opini dunia terkait kata kunci: <strong className="text-indigo-600 font-semibold">"{trackerQuery}"</strong>
            </p>
          </div>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sentiment Filter Toggle */}
          <div className="bg-slate-100 p-0.5 rounded-lg flex text-xs font-medium">
            <button
              onClick={() => setFilterSentiment("all")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterSentiment === "all" ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
            >
              Semua ({monitorResults.length})
            </button>
            <button
              onClick={() => setFilterSentiment("positive")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterSentiment === "positive" ? "bg-emerald-500 text-white shadow-xs" : "text-emerald-600 hover:bg-emerald-50/50"}`}
            >
              Positif
            </button>
            <button
              onClick={() => setFilterSentiment("neutral")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterSentiment === "neutral" ? "bg-slate-500 text-white shadow-xs" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Netral
            </button>
            <button
              onClick={() => setFilterSentiment("negative")}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${filterSentiment === "negative" ? "bg-rose-500 text-white shadow-xs" : "text-rose-600 hover:bg-rose-50"}`}
            >
              Negatif
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center border-l border-slate-200 pl-2 gap-1.5">
            <button
              onClick={() => zoom(1.2)}
              title="Perbesar Peta"
              className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 cursor-pointer active:scale-95 transition-all"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => zoom(0.8)}
              title="Perkecil Peta"
              className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 cursor-pointer active:scale-95 transition-all"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={resetMap}
              title="Reset Zoom & Drag"
              className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200 cursor-pointer active:scale-95 transition-all flex items-center justify-center"
            >
              <Compass className="h-4 w-4" />
            </button>
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoading}
                title="Pindai Sinyal Baru"
                className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg cursor-pointer active:scale-95 transition-all"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Map Stage */}
      <div 
        className="relative flex-1 bg-slate-900/5 min-h-[360px] md:min-h-[420px] overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* SVG Canvas Map */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${mapScale})`,
            transformOrigin: "center center"
          }}
        >
          {/* Map Grid / Graticules */}
          {gridLines.map((line, idx) => (
            <g key={`grid-${idx}`}>
              <path
                d={line.path}
                fill="none"
                stroke="currentColor"
                className="text-slate-200/60"
                strokeWidth={line.type === "lat" && line.label === "EQUATOR" ? 1.5 : 0.5}
                strokeDasharray="4 4"
              />
              {line.label && (
                <text
                  x={line.type === "lat" ? 10 : projectX(parseFloat(line.label) || 0) + 5}
                  y={line.type === "lat" ? projectY(parseFloat(line.label) || 0) - 4 : height - 10}
                  fontSize="8"
                  className="fill-slate-400 font-mono tracking-widest font-medium"
                >
                  {line.label}
                </text>
              )}
            </g>
          ))}

          {/* Continent Polygons */}
          {landmassPaths.map((lm, idx) => (
            <polygon
              key={`land-${idx}`}
              points={lm.pointsString}
              className="fill-slate-100/90 hover:fill-slate-200/60 transition-colors duration-200 stroke-slate-200/50"
              strokeWidth="1"
            />
          ))}

          {/* Draw Interactive Social Signal Pulsers */}
          {activePoints.map((pt) => {
            const cx = projectX(pt.longitude!);
            const cy = projectY(pt.latitude!);
            const isHovered = hoveredPoint?.id === pt.id;

            // Determine core colors
            let colorClass = "fill-slate-400 text-slate-400";
            let glowClass = "bg-slate-400/30";
            if (pt.sentiment === "positive") {
              colorClass = "fill-emerald-500 text-emerald-500";
              glowClass = "bg-emerald-500/30";
            } else if (pt.sentiment === "negative") {
              colorClass = "fill-rose-500 text-rose-500";
              glowClass = "bg-rose-500/30";
            } else {
              colorClass = "fill-indigo-500 text-indigo-500";
              glowClass = "bg-indigo-500/30";
            }

            return (
              <g
                key={pt.id}
                transform={`translate(${cx}, ${cy})`}
                className="cursor-pointer group"
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                {/* Ping Animation Ring */}
                <circle
                  r={isHovered ? 24 : 12}
                  className={`animate-ping opacity-60 transition-all duration-300 ${
                    pt.sentiment === "positive" ? "fill-emerald-400/40" : (pt.sentiment === "negative" ? "fill-rose-400/40" : "fill-indigo-400/40")
                  }`}
                />
                
                {/* Secondary Ripple Layer */}
                <circle
                  r={isHovered ? 14 : 7}
                  className={`opacity-25 transition-all duration-300 ${colorClass}`}
                />

                {/* Core Point Pin */}
                <circle
                  r={isHovered ? 7 : 4.5}
                  className={`transition-all duration-300 stroke-white ${colorClass}`}
                  strokeWidth={isHovered ? 1.5 : 1}
                />
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay Panel */}
        {hoveredPoint && (
          <div
            className="absolute z-50 bg-white/95 backdrop-blur-md rounded-xl p-4 border border-slate-200/90 shadow-lg max-w-[280px] pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95"
            style={{
              // Approximate position near cursor
              left: `${Math.max(15, Math.min(width - 300, projectX(hoveredPoint.longitude!) * mapScale + panOffset.x - 140))}px`,
              top: `${Math.max(15, projectY(hoveredPoint.latitude!) * mapScale + panOffset.y + 15)}px`
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                {hoveredPoint.country}
              </span>
              <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full capitalize ${
                hoveredPoint.platform === "tiktok" ? "bg-black text-white" :
                hoveredPoint.platform === "instagram" ? "bg-pink-50 text-pink-700" :
                hoveredPoint.platform === "twitter" ? "bg-sky-50 text-sky-700" :
                hoveredPoint.platform === "reddit" ? "bg-orange-50 text-orange-700" :
                hoveredPoint.platform === "linkedin" ? "bg-blue-50 text-blue-700" :
                "bg-indigo-50 text-indigo-700"
              }`}>
                {hoveredPoint.platform}
              </span>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-slate-400 font-mono">
                Dikirim oleh: <span className="text-slate-600 font-medium">{hoveredPoint.author}</span>
              </p>
              <h4 className="text-xs font-semibold text-slate-800 line-clamp-1">
                {hoveredPoint.title}
              </h4>
              <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed bg-slate-50 p-1.5 rounded-md border border-slate-100">
                "{hoveredPoint.content}"
              </p>
            </div>

            {/* Bottom Metrics */}
            <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="text-slate-400">Sentimen:</span>
                <span className={`font-semibold ${
                  hoveredPoint.sentiment === "positive" ? "text-emerald-600" :
                  hoveredPoint.sentiment === "negative" ? "text-rose-600" :
                  "text-slate-600"
                }`}>
                  {hoveredPoint.sentimentScore > 0 ? `+${hoveredPoint.sentimentScore}` : hoveredPoint.sentimentScore}
                </span>
              </span>
              <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-medium">
                {hoveredPoint.emotion}
              </span>
            </div>
          </div>
        )}

        {/* Empty State / Loading State */}
        {activePoints.length === 0 && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex flex-col items-center justify-center text-center p-6">
            <Globe className="h-10 w-10 text-slate-300 animate-spin" />
            <p className="text-sm font-medium text-slate-600 mt-3">Tidak ada sinyal media yang terekam.</p>
            <p className="text-xs text-slate-400 mt-1">Harap klik tombol "Trigger Real-Time Scanner" untuk memproses signal global!</p>
          </div>
        )}
      </div>

      {/* Interactive Legend Footer */}
      <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-medium text-slate-600">Legend:</span>
          <span className="flex items-center gap-1.5 text-slate-500 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
            Positif
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"></span>
            Netral
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
            Negatif
          </span>
        </div>
        <div className="text-slate-400 text-[10px] font-mono">
          Ditampilkan: {activePoints.length} Sinyal Geografis Aktif
        </div>
      </div>
    </div>
  );
};
