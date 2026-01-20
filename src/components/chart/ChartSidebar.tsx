"use client";

import Link from "next/link";

const PAIRS = [
  { id: "DXY", name: "DXY" },
  { id: "EUR_USD", name: "EUR/USD" },
  { id: "GBP_USD", name: "GBP/USD" },
  { id: "USD_JPY", name: "USD/JPY" },
  { id: "USD_CHF", name: "USD/CHF" },
  { id: "AUD_USD", name: "AUD/USD" },
  { id: "USD_CAD", name: "USD/CAD" },
  { id: "NZD_USD", name: "NZD/USD" },
];

const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D", "W", "MN"] as const;

interface ChartSidebarProps {
  currentPair: string;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  magnetMode: boolean;
  onMagnetModeChange: (value: boolean) => void;
  showSessions: boolean;
  onShowSessionsChange: (value: boolean) => void;
  showNews: boolean;
  onShowNewsChange: (value: boolean) => void;
  onResetView?: () => void;
}

export function ChartSidebar({
  currentPair,
  timeframe,
  onTimeframeChange,
  magnetMode,
  onMagnetModeChange,
  showSessions,
  onShowSessionsChange,
  showNews,
  onShowNewsChange,
  onResetView,
}: ChartSidebarProps) {
  return (
    <div className="h-full bg-gray-900 border-l border-gray-800 flex flex-col">
      {/* Pairs Section */}
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Pairs
        </h3>
        <div className="space-y-1">
          {PAIRS.map((pair) => (
            <Link
              key={pair.id}
              href={`/chart/${pair.id}`}
              className={`block px-3 py-1.5 text-sm rounded transition-colors ${
                currentPair === pair.id
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {pair.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Timeframe Section */}
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Timeframe
        </h3>
        <div className="grid grid-cols-4 gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-2 py-1.5 text-xs rounded transition-colors ${
                timeframe === tf
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Controls Section */}
      <div className="p-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Controls
        </h3>
        <div className="space-y-2">
          <button
            onClick={() => onShowNewsChange(!showNews)}
            className={`w-full px-3 py-2 text-sm rounded transition-colors text-left ${
              showNews
                ? "bg-red-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {showNews ? "News ON" : "News OFF"}
          </button>
          <button
            onClick={() => onShowSessionsChange(!showSessions)}
            className={`w-full px-3 py-2 text-sm rounded transition-colors text-left ${
              showSessions
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {showSessions ? "Sessions ON" : "Sessions OFF"}
          </button>
          <button
            onClick={() => onMagnetModeChange(!magnetMode)}
            className={`w-full px-3 py-2 text-sm rounded transition-colors text-left ${
              magnetMode
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {magnetMode ? "Magnet ON" : "Magnet OFF"}
          </button>
          {onResetView && (
            <button
              onClick={onResetView}
              className="w-full px-3 py-2 text-sm rounded transition-colors text-left bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              Reset View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
