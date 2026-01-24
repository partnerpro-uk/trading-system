"use client";

import { useMemo, useState } from "react";
import type { Trade } from "../../../lib/analysis/types";

interface TimelineViewProps {
  trades: Trade[];
  onTradeClick?: (trade: Trade) => void;
}

export function TimelineView({ trades, onTradeClick }: TimelineViewProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Filter and prepare chart data
  const chartData = useMemo(() => {
    return trades
      .filter((t) => !t.isOpen && t.pnl !== undefined)
      .map((trade, i) => {
        const entryTime = trade.entryTime || "";
        const date = new Date(entryTime);
        return {
          x: date.getTime(),
          y: trade.pnl || 0,
          trade,
          index: i,
          dateStr: date.toLocaleDateString(),
        };
      })
      .sort((a, b) => a.x - b.x);
  }, [trades]);

  // Compute cumulative P&L
  const cumulativeData = useMemo(() => {
    let cumulative = 0;
    return chartData.map((point) => ({
      ...point,
      cumulative: (cumulative += point.y),
    }));
  }, [chartData]);

  // Stats
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const wins = chartData.filter((d) => d.y > 0);
    const losses = chartData.filter((d) => d.y < 0);
    const totalPnl = chartData.reduce((sum, d) => sum + d.y, 0);
    const avgPnl = totalPnl / chartData.length;
    const winRate = wins.length / chartData.length;
    const bestTrade = Math.max(...chartData.map((d) => d.y), 0);
    const worstTrade = Math.min(...chartData.map((d) => d.y), 0);
    const maxDrawdown = cumulativeData.reduce((dd, d, i) => {
      const peak = Math.max(...cumulativeData.slice(0, i + 1).map((p) => p.cumulative));
      return Math.min(dd, d.cumulative - peak);
    }, 0);

    return {
      total: chartData.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      avgPnl,
      bestTrade,
      worstTrade,
      maxDrawdown,
      finalEquity: cumulativeData[cumulativeData.length - 1]?.cumulative || 0,
    };
  }, [chartData, cumulativeData]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-500">
        No trades to display. Run an analysis to see results.
      </div>
    );
  }

  // SVG dimensions
  const width = 800;
  const height = 350;
  const padding = { top: 30, right: 30, bottom: 50, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Scales
  const xMin = Math.min(...chartData.map((d) => d.x));
  const xMax = Math.max(...chartData.map((d) => d.x));
  const xRange = xMax - xMin || 1;
  const scaleX = (v: number) => ((v - xMin) / xRange) * plotWidth;

  const allY = [...chartData.map((d) => d.y), ...cumulativeData.map((d) => d.cumulative)];
  const yMin = Math.min(...allY, 0);
  const yMax = Math.max(...allY, 0);
  const yRange = yMax - yMin || 1;
  const scaleY = (v: number) => plotHeight - ((v - yMin) / yRange) * plotHeight;

  // Cumulative line path
  const linePath = cumulativeData
    .map((p, i) => `${i === 0 ? "M" : "L"} ${padding.left + scaleX(p.x)} ${padding.top + scaleY(p.cumulative)}`)
    .join(" ");

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="bg-gray-800/50 rounded-lg p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
          {/* Zero line */}
          <line
            x1={padding.left}
            y1={padding.top + scaleY(0)}
            x2={width - padding.right}
            y2={padding.top + scaleY(0)}
            stroke="#374151"
            strokeDasharray="4,4"
          />

          {/* Cumulative equity line */}
          <path
            d={linePath}
            fill="none"
            stroke="#a855f7"
            strokeWidth={2}
            opacity={0.8}
          />

          {/* Trade dots */}
          {chartData.map((point, i) => (
            <g key={i}>
              <circle
                cx={padding.left + scaleX(point.x)}
                cy={padding.top + scaleY(point.y)}
                r={hoveredIndex === i ? 6 : 4}
                fill={point.y >= 0 ? "#22c55e" : "#ef4444"}
                opacity={hoveredIndex === i ? 1 : 0.7}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onTradeClick?.(point.trade)}
              />
              {hoveredIndex === i && (
                <text
                  x={padding.left + scaleX(point.x)}
                  y={padding.top + scaleY(point.y) - 10}
                  textAnchor="middle"
                  fill="#e5e7eb"
                  fontSize={11}
                >
                  ${point.y.toFixed(2)}
                </text>
              )}
            </g>
          ))}

          {/* Y-axis label */}
          <text
            x={15}
            y={height / 2}
            textAnchor="middle"
            fill="#6b7280"
            fontSize={11}
            transform={`rotate(-90, 15, ${height / 2})`}
          >
            P&L ($)
          </text>

          {/* X-axis label */}
          <text
            x={width / 2}
            y={height - 10}
            textAnchor="middle"
            fill="#6b7280"
            fontSize={11}
          >
            Time
          </text>
        </svg>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 text-sm">
          <div className="bg-gray-800/50 p-3 rounded-lg">
            <div className="text-gray-500 text-xs">Total Trades</div>
            <div className="text-lg font-semibold text-gray-100">{stats.total}</div>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg">
            <div className="text-gray-500 text-xs">Win Rate</div>
            <div className={`text-lg font-semibold ${stats.winRate >= 0.5 ? "text-green-400" : "text-red-400"}`}>
              {(stats.winRate * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg">
            <div className="text-gray-500 text-xs">Total P&L</div>
            <div className={`text-lg font-semibold ${stats.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${stats.totalPnl.toFixed(0)}
            </div>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg">
            <div className="text-gray-500 text-xs">Best Trade</div>
            <div className="text-lg font-semibold text-green-400">${stats.bestTrade.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg">
            <div className="text-gray-500 text-xs">Max Drawdown</div>
            <div className="text-lg font-semibold text-red-400">${stats.maxDrawdown.toFixed(0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
