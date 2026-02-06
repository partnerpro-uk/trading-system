"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// =============================================================================
// Types
// =============================================================================

interface SentimentResult {
  sentiment: "bullish" | "bearish" | "neutral";
  strength: "strong" | "moderate" | "weak";
  isExtreme: boolean;
  extremeType?: "overbought" | "oversold";
}

interface COTPositionWithSentiment {
  report_date: string;
  pair: string;
  open_interest: number;
  dealer_net_positions: number;
  asset_mgr_net_positions: number;
  lev_money_net_positions: number;
  weekly_change_lev_money: number;
  weekly_change_asset_mgr: number;
  lev_money_percentile: number;
  asset_mgr_percentile: number;
  sentiment: SentimentResult;
}

interface COTHistoryPoint {
  report_date: string;
  lev_money_net_positions: number;
  asset_mgr_net_positions: number;
}

interface InstitutionalPanelProps {
  currentPair: string;
}

// =============================================================================
// Mini Sparkline Chart
// =============================================================================

function PositioningChart({
  history,
  height = 80,
}: {
  history: COTHistoryPoint[];
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 4, bottom: 4, left: 0, right: 0 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);

    const values = history.map((p) => p.lev_money_net_positions);
    const minVal = Math.min(...values, 0);
    const maxVal = Math.max(...values, 0);
    const range = maxVal - minVal || 1;

    const toX = (i: number) => padding.left + (i / (history.length - 1)) * chartW;
    const toY = (v: number) => padding.top + chartH - ((v - minVal) / range) * chartH;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(107, 114, 128, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(w - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fill area (green above zero, red below)
    for (let i = 0; i < history.length - 1; i++) {
      const x1 = toX(i);
      const x2 = toX(i + 1);
      const y1 = toY(values[i]);
      const y2 = toY(values[i + 1]);

      // Determine if segment is above or below zero
      const aboveZero = values[i] >= 0 && values[i + 1] >= 0;
      const belowZero = values[i] <= 0 && values[i + 1] <= 0;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2, zeroY);
      ctx.lineTo(x1, zeroY);
      ctx.closePath();

      if (aboveZero) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
      } else if (belowZero) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
      } else {
        ctx.fillStyle = "rgba(107, 114, 128, 0.1)";
      }
      ctx.fill();
    }

    // Line
    ctx.strokeStyle = history[history.length - 1].lev_money_net_positions >= 0
      ? "#22c55e"
      : "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((p, i) => {
      const x = toX(i);
      const y = toY(p.lev_money_net_positions);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Current value dot
    const lastX = toX(history.length - 1);
    const lastY = toY(values[values.length - 1]);
    ctx.fillStyle = values[values.length - 1] >= 0 ? "#22c55e" : "#ef4444";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [history]);

  if (history.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-gray-600 text-[10px]"
        style={{ height }}
      >
        Not enough data for chart
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
    />
  );
}

// =============================================================================
// Sentiment Pill
// =============================================================================

function SentimentPill({ sentiment }: { sentiment: SentimentResult }) {
  const colors = {
    bullish: "bg-green-500/20 text-green-400",
    bearish: "bg-red-500/20 text-red-400",
    neutral: "bg-gray-500/20 text-gray-400",
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[sentiment.sentiment]}`}
    >
      {sentiment.sentiment.charAt(0).toUpperCase() + sentiment.sentiment.slice(1)}
    </span>
  );
}

// =============================================================================
// Format Helpers
// =============================================================================

function formatContracts(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return n.toLocaleString();
}

function formatChange(n: number): { text: string; color: string; arrow: string } {
  if (n > 0) return { text: `+${formatContracts(n)}`, color: "text-green-400", arrow: "▲" };
  if (n < 0) return { text: formatContracts(n), color: "text-red-400", arrow: "▼" };
  return { text: "0", color: "text-gray-500", arrow: "─" };
}

// =============================================================================
// Main Component
// =============================================================================

export function InstitutionalPanel({ currentPair }: InstitutionalPanelProps) {
  const [positions, setPositions] = useState<COTPositionWithSentiment[]>([]);
  const [history, setHistory] = useState<COTHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch latest positions for all pairs
  const fetchPositions = useCallback(async () => {
    try {
      const response = await fetch("/api/cot/latest");
      if (response.ok) {
        const data = await response.json();
        setPositions(data.positions || []);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to fetch COT positions:", err);
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch history for current pair
  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/cot/history?pair=${currentPair}&weeks=52`);
      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch COT history:", err);
    }
  }, [currentPair]);

  // Fetch on mount and refresh every 60 seconds
  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 60000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  // Fetch history when pair changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const currentPosition = positions.find((p) => p.pair === currentPair);
  const otherPositions = positions.filter((p) => p.pair !== currentPair);
  const extremePositions = positions.filter((p) => p.sentiment.isExtreme);

  if (loading) {
    return (
      <div className="h-full bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 text-xs">Loading institutional data...</div>
      </div>
    );
  }

  if (error || positions.length === 0) {
    return (
      <div className="h-full bg-gray-900 flex flex-col items-center justify-center gap-2 px-4">
        <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        <div className="text-gray-500 text-xs text-center">
          {error || "No COT data available yet"}
        </div>
        <div className="text-gray-600 text-[10px] text-center">
          Run the worker to fetch CFTC data
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Institutional Positioning
        </h3>
        <p className="text-[10px] text-gray-600 mt-0.5">
          CFTC Commitments of Traders
        </p>
      </div>

      {/* Current Pair Detail */}
      {currentPosition && (
        <div className="p-3 border-b border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-200">
              {currentPair.replace("_", "/")}
            </span>
            <SentimentPill sentiment={currentPosition.sentiment} />
          </div>

          {/* Mini Chart */}
          <div className="bg-gray-800/50 rounded p-1.5 mb-3">
            <PositioningChart history={history} height={80} />
            <div className="flex justify-between text-[9px] text-gray-600 mt-1 px-0.5">
              <span>52w ago</span>
              <span>Now</span>
            </div>
          </div>

          {/* Position Breakdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Smart Money</span>
              <span className={`font-mono ${currentPosition.lev_money_net_positions >= 0 ? "text-green-400" : "text-red-400"}`}>
                {currentPosition.lev_money_net_positions >= 0 ? "+" : ""}
                {currentPosition.lev_money_net_positions.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Asset Managers</span>
              <span className={`font-mono ${currentPosition.asset_mgr_net_positions >= 0 ? "text-green-400" : "text-red-400"}`}>
                {currentPosition.asset_mgr_net_positions >= 0 ? "+" : ""}
                {currentPosition.asset_mgr_net_positions.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Dealers</span>
              <span className={`font-mono ${currentPosition.dealer_net_positions >= 0 ? "text-green-400" : "text-red-400"}`}>
                {currentPosition.dealer_net_positions >= 0 ? "+" : ""}
                {currentPosition.dealer_net_positions.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Weekly Change + Percentile */}
          <div className="mt-3 flex gap-2">
            <div className="flex-1 bg-gray-800/50 rounded p-2">
              <div className="text-[10px] text-gray-500 mb-0.5">Weekly Change</div>
              {(() => {
                const change = formatChange(currentPosition.weekly_change_lev_money);
                return (
                  <div className={`text-xs font-mono font-medium ${change.color}`}>
                    {change.arrow} {change.text}
                  </div>
                );
              })()}
            </div>
            <div className="flex-1 bg-gray-800/50 rounded p-2">
              <div className="text-[10px] text-gray-500 mb-0.5">Percentile (1yr)</div>
              <div className={`text-xs font-mono font-medium ${
                currentPosition.lev_money_percentile >= 80 ? "text-green-400" :
                currentPosition.lev_money_percentile <= 20 ? "text-red-400" :
                "text-gray-300"
              }`}>
                {currentPosition.lev_money_percentile}th
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extreme Alerts */}
      {extremePositions.length > 0 && (
        <div className="p-3 border-b border-gray-800">
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Extreme Positioning
          </h4>
          <div className="space-y-1">
            {extremePositions.map((pos) => (
              <div
                key={pos.pair}
                className="px-2 py-1.5 rounded text-xs bg-amber-900/30 border border-amber-800/30"
              >
                <div className="flex items-center justify-between">
                  <span className="text-amber-300 font-medium">
                    {pos.pair.replace("_", "/")}
                  </span>
                  <span className="text-amber-400 text-[10px]">
                    {pos.lev_money_percentile}th pctl
                  </span>
                </div>
                <div className="text-[10px] text-amber-400/70 mt-0.5">
                  {pos.sentiment.extremeType === "overbought"
                    ? "Extreme long — potential reversal zone"
                    : "Extreme short — potential reversal zone"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Pairs */}
      <div className="p-3">
        <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          All Pairs
        </h4>
        <div className="space-y-0.5">
          {/* Current pair first */}
          {currentPosition && (
            <PairRow position={currentPosition} isActive={true} />
          )}
          {/* Then all others */}
          {otherPositions.map((pos) => (
            <PairRow key={pos.pair} position={pos} isActive={false} />
          ))}
        </div>

        {/* Report date footer */}
        {positions[0] && (
          <div className="mt-3 pt-2 border-t border-gray-800 text-[10px] text-gray-600">
            <div>Last report: {positions[0].report_date}</div>
            <div>Data as of Tuesday close</div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Pair Row Sub-component
// =============================================================================

function PairRow({
  position,
  isActive,
}: {
  position: COTPositionWithSentiment;
  isActive: boolean;
}) {
  const change = formatChange(position.weekly_change_lev_money);

  return (
    <Link
      href={`/chart/${position.pair}`}
      className={`flex items-center justify-between px-2 py-1.5 text-xs rounded transition-colors ${
        isActive
          ? "bg-blue-600 text-white"
          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            position.sentiment.sentiment === "bullish"
              ? "bg-green-500"
              : position.sentiment.sentiment === "bearish"
              ? "bg-red-500"
              : "bg-gray-500"
          }`}
        />
        <span className="font-medium">{position.pair.replace("_", "/")}</span>
        <SentimentPill sentiment={position.sentiment} />
      </div>
      <div className="flex items-center gap-1">
        <span className={`text-[10px] ${isActive ? "text-blue-200" : change.color}`}>
          {change.arrow}
        </span>
        <span className={`font-mono text-[10px] ${isActive ? "text-blue-200" : change.color}`}>
          {change.text}
        </span>
      </div>
    </Link>
  );
}
