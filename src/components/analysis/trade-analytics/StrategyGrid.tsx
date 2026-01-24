"use client";

import { useMemo } from "react";
import type { Trade } from "../../../lib/analysis/types";

interface StrategyGridProps {
  trades: Trade[];
  onCellClick?: (model: string, session: string, trades: Trade[]) => void;
}

const MODELS = ["Momentum", "Mean Reversion", "Seasons", "Time of Day", "Fibonacci", "S/R"];
const SESSIONS = ["Tokyo", "London", "New York", "Sydney"];

// Map hour to session (UTC)
function getSession(hour: number): string {
  if (hour >= 0 && hour < 8) return "Tokyo";
  if (hour >= 8 && hour < 15) return "London";
  if (hour >= 15 && hour < 22) return "New York";
  return "Sydney";
}

// Normalize model name
function normalizeModel(model: string | undefined): string {
  if (!model) return "Momentum";
  const lower = model.toLowerCase();
  if (lower.includes("momentum")) return "Momentum";
  if (lower.includes("mean") || lower.includes("reversion")) return "Mean Reversion";
  if (lower.includes("season")) return "Seasons";
  if (lower.includes("time") || lower.includes("day")) return "Time of Day";
  if (lower.includes("fib")) return "Fibonacci";
  if (lower.includes("support") || lower.includes("resistance") || lower === "s/r") return "S/R";
  return "Momentum";
}

export function StrategyGrid({ trades, onCellClick }: StrategyGridProps) {
  // Build grid: Model x Session -> stats
  const gridData = useMemo(() => {
    const grid: Record<string, Record<string, { wins: number; losses: number; pnl: number; trades: Trade[] }>> = {};

    // Initialize
    MODELS.forEach((model) => {
      grid[model] = {};
      SESSIONS.forEach((session) => {
        grid[model][session] = { wins: 0, losses: 0, pnl: 0, trades: [] };
      });
    });

    // Populate
    trades.forEach((trade) => {
      if (trade.isOpen) return;

      const model = normalizeModel((trade.model as string) || (trade.chunkType as string));
      const entryTime = trade.entryTime || "";
      const date = new Date(entryTime as string | number);
      const hour = date.getUTCHours();
      const session = (trade.session as string) || getSession(hour);

      // Find matching session
      const sessionKey = SESSIONS.find((s) => session.toLowerCase().includes(s.toLowerCase())) || "London";

      if (grid[model] && grid[model][sessionKey]) {
        const pnl = trade.pnl || 0;
        grid[model][sessionKey].pnl += pnl;
        grid[model][sessionKey].trades.push(trade);
        if (pnl >= 0) {
          grid[model][sessionKey].wins += 1;
        } else {
          grid[model][sessionKey].losses += 1;
        }
      }
    });

    return grid;
  }, [trades]);

  // Calculate model totals
  const modelTotals = useMemo(() => {
    const totals: Record<string, { wins: number; losses: number; pnl: number }> = {};
    MODELS.forEach((model) => {
      totals[model] = { wins: 0, losses: 0, pnl: 0 };
      SESSIONS.forEach((session) => {
        const cell = gridData[model][session];
        totals[model].wins += cell.wins;
        totals[model].losses += cell.losses;
        totals[model].pnl += cell.pnl;
      });
    });
    return totals;
  }, [gridData]);

  // Color scale
  const getColor = (winRate: number, hasData: boolean) => {
    if (!hasData) return "bg-gray-800";
    if (winRate >= 0.65) return "bg-green-600";
    if (winRate >= 0.55) return "bg-green-800";
    if (winRate >= 0.45) return "bg-gray-700";
    if (winRate >= 0.35) return "bg-red-800";
    return "bg-red-600";
  };

  if (trades.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-500">
        No trades to display. Run an analysis to see results.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="p-3 text-left text-gray-400 font-medium">Model</th>
            {SESSIONS.map((session) => (
              <th key={session} className="p-3 text-center text-gray-400 font-medium">
                {session}
              </th>
            ))}
            <th className="p-3 text-center text-gray-400 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {MODELS.map((model) => {
            const total = modelTotals[model];
            const totalCount = total.wins + total.losses;
            const totalRate = totalCount > 0 ? total.wins / totalCount : 0.5;

            return (
              <tr key={model} className="border-b border-gray-800">
                <td className="p-3 text-gray-300 font-medium">{model}</td>
                {SESSIONS.map((session) => {
                  const cell = gridData[model][session];
                  const count = cell.wins + cell.losses;
                  const winRate = count > 0 ? cell.wins / count : 0.5;
                  const hasData = count > 0;

                  return (
                    <td key={session} className="p-1">
                      <div
                        className={`p-3 rounded ${getColor(winRate, hasData)} text-center transition-all hover:scale-105 cursor-pointer`}
                        title={`W: ${cell.wins} | L: ${cell.losses} | P&L: $${cell.pnl.toFixed(0)}`}
                        onClick={() => hasData && onCellClick?.(model, session, cell.trades)}
                      >
                        {hasData ? (
                          <>
                            <div className="text-white font-semibold">
                              {(winRate * 100).toFixed(0)}%
                            </div>
                            <div className="text-xs text-gray-300">{count} trades</div>
                          </>
                        ) : (
                          <div className="text-gray-600">-</div>
                        )}
                      </div>
                    </td>
                  );
                })}
                <td className="p-1">
                  <div
                    className={`p-3 rounded ${getColor(totalRate, totalCount > 0)} text-center`}
                  >
                    {totalCount > 0 ? (
                      <>
                        <div className="text-white font-semibold">
                          {(totalRate * 100).toFixed(0)}%
                        </div>
                        <div
                          className={`text-xs ${total.pnl >= 0 ? "text-green-300" : "text-red-300"}`}
                        >
                          ${total.pnl.toFixed(0)}
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-600">-</div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-600" />
          <span>&gt;65%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-800" />
          <span>55-65%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-700" />
          <span>45-55%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-800" />
          <span>35-45%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-600" />
          <span>&lt;35%</span>
        </div>
      </div>
    </div>
  );
}
