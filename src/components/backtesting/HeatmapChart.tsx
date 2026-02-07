"use client";

import type { HeatmapCell, EntityType } from "@/hooks/useBacktesting";

interface HeatmapChartProps {
  data: HeatmapCell[];
  entityType: EntityType;
}

const RATE_LABELS: Record<EntityType, string> = {
  bos: "Continuation Rate",
  fvg: "Fill Rate",
  sweep: "BOS Follow Rate",
  swing: "Event Count",
};

function getColor(value: number, entityType: EntityType): string {
  if (entityType === "swing") {
    // For swings, use count-based coloring
    if (value === 0) return "bg-gray-800";
    if (value < 50) return "bg-blue-900/60";
    if (value < 200) return "bg-blue-700/60";
    return "bg-blue-500/60";
  }

  // For rate-based metrics (0-100%)
  if (value === 0) return "bg-gray-800";
  if (value < 30) return "bg-red-900/60";
  if (value < 45) return "bg-orange-900/60";
  if (value < 55) return "bg-yellow-900/60";
  if (value < 70) return "bg-green-900/60";
  return "bg-green-700/60";
}

function getTextColor(value: number, entityType: EntityType): string {
  if (entityType === "swing") {
    return value > 0 ? "text-blue-300" : "text-gray-600";
  }
  if (value === 0) return "text-gray-600";
  if (value < 30) return "text-red-400";
  if (value < 45) return "text-orange-400";
  if (value < 55) return "text-yellow-400";
  return "text-green-400";
}

export function HeatmapChart({ data, entityType }: HeatmapChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">
          Pair x Timeframe — {RATE_LABELS[entityType]}
        </h3>
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          No data available
        </div>
      </div>
    );
  }

  // Build grid axes
  const pairs = [...new Set(data.map((d) => d.pair))];
  const timeframes = [...new Set(data.map((d) => d.timeframe))];

  // Build lookup
  const lookup: Record<string, HeatmapCell> = {};
  for (const cell of data) {
    lookup[`${cell.pair}:${cell.timeframe}`] = cell;
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">
        Pair x Timeframe — {RATE_LABELS[entityType]}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium px-2 py-1.5" />
              {timeframes.map((tf) => (
                <th key={tf} className="text-center text-gray-500 font-medium px-2 py-1.5">
                  {tf}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={pair}>
                <td className="text-gray-400 font-medium px-2 py-1 whitespace-nowrap">
                  {pair.replace("_", "/")}
                </td>
                {timeframes.map((tf) => {
                  const cell = lookup[`${pair}:${tf}`];
                  const value = cell?.value || 0;
                  const count = cell?.count || 0;
                  return (
                    <td key={tf} className="px-1 py-1">
                      <div
                        className={`rounded px-2 py-2 text-center ${getColor(value, entityType)}`}
                        title={`${pair} ${tf}: ${entityType === "swing" ? count : value.toFixed(1) + "%"} (${count} events)`}
                      >
                        <div className={`font-mono font-medium ${getTextColor(value, entityType)}`}>
                          {entityType === "swing" ? count : `${value.toFixed(0)}%`}
                        </div>
                        <div className="text-gray-600 text-[10px]">{count}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
