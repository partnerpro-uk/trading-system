"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Check,
  X,
  Eye,
  AlertCircle,
} from "lucide-react";
import { useDrawingStore } from "@/lib/drawings/store";
import { PositionDrawing, isPositionDrawing } from "@/lib/drawings/types";
import { useStrategies } from "@/hooks/useStrategies";
import { TakeTradeModal, TakeTradeOptions } from "@/components/chart/TakeTradeModal";

interface StrategySignalsTabProps {
  onSignalTaken?: (signal: PositionDrawing) => void;
}

/**
 * Format date for table
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format price with appropriate decimals
 */
function formatPrice(price: number, pair: string): string {
  const isJPY = pair.includes("JPY");
  return price.toFixed(isJPY ? 3 : 5);
}

/**
 * Signal status badge
 */
function SignalStatusBadge({ status }: { status?: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    signal: { bg: "bg-purple-900/50", text: "text-purple-400", label: "Signal" },
    pending: { bg: "bg-yellow-900/50", text: "text-yellow-400", label: "Pending" },
    skipped: { bg: "bg-gray-900/50", text: "text-gray-400", label: "Skipped" },
  };

  const { bg, text, label } = config[status || "signal"] || config.signal;
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${bg} ${text}`}>
      {label}
    </span>
  );
}

/**
 * Signal row component
 */
function SignalRow({
  signal,
  chartKey,
  strategyMap,
  onTakeTrade,
  onDismiss,
  onViewChart,
}: {
  signal: PositionDrawing;
  chartKey: string;
  strategyMap: Record<string, string>;
  onTakeTrade: () => void;
  onDismiss: () => void;
  onViewChart: () => void;
}) {
  const [pair] = chartKey.split(":");
  const isLong = signal.type === "longPosition";

  // Calculate R:R
  const slDistance = Math.abs(signal.entry.price - signal.stopLoss);
  const tpDistance = Math.abs(signal.takeProfit - signal.entry.price);
  const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

  // Calculate pips
  const pipMultiplier = signal.entry.price < 10 ? 10000 : 100;
  const slPips = slDistance * pipMultiplier;
  const tpPips = tpDistance * pipMultiplier;

  return (
    <tr className="hover:bg-gray-800/30 transition-colors">
      <td className="px-3 py-2 text-gray-300 text-xs whitespace-nowrap">
        {formatDate(signal.entry.timestamp)}
      </td>
      <td className="px-3 py-2 font-medium text-gray-100 text-xs">
        {pair.replace("_", "/")}
      </td>
      <td className="px-2 py-2 text-center">
        {isLong ? (
          <TrendingUp className="w-4 h-4 text-green-400 inline" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-400 inline" />
        )}
      </td>
      <td className="px-2 py-2 text-gray-400 text-xs">
        {signal.strategyId ? strategyMap[signal.strategyId] || signal.strategyId : "Manual"}
      </td>
      <td className="px-2 py-2 font-mono text-gray-300 text-xs">
        {formatPrice(signal.entry.price, pair)}
      </td>
      <td className="px-2 py-2 font-mono text-red-400 text-xs">
        {formatPrice(signal.stopLoss, pair)}
        <span className="text-gray-500 ml-1">({slPips.toFixed(1)}p)</span>
      </td>
      <td className="px-2 py-2 font-mono text-green-400 text-xs">
        {formatPrice(signal.takeProfit, pair)}
        <span className="text-gray-500 ml-1">({tpPips.toFixed(1)}p)</span>
      </td>
      <td className="px-2 py-2 text-gray-300 text-xs font-medium">
        <span className={rrRatio >= 2 ? "text-green-400" : rrRatio >= 1 ? "text-yellow-400" : "text-red-400"}>
          1:{rrRatio.toFixed(1)}
        </span>
      </td>
      <td className="px-2 py-2">
        <SignalStatusBadge status={signal.status} />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onTakeTrade}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
            title="I Took This Trade"
          >
            <Check className="w-3 h-3" />
            Take
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
            title="Dismiss Signal"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={onViewChart}
            className="p-1.5 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-800 transition-colors"
            title="View on Chart"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function StrategySignalsTab({ onSignalTaken }: StrategySignalsTabProps) {
  const router = useRouter();
  const { strategies } = useStrategies();
  const drawings = useDrawingStore((state) => state.drawings);
  const updateDrawing = useDrawingStore((state) => state.updateDrawing);

  const [selectedSignal, setSelectedSignal] = useState<{ signal: PositionDrawing; chartKey: string } | null>(null);

  // Strategy lookup map
  const strategyMap = useMemo(() => {
    const map: Record<string, string> = { manual: "Manual" };
    strategies.forEach((s) => {
      map[s.id] = s.name;
    });
    return map;
  }, [strategies]);

  // Get all signal positions from all charts
  const signalPositions = useMemo(() => {
    const signals: { signal: PositionDrawing; chartKey: string }[] = [];

    for (const [chartKey, chartDrawings] of Object.entries(drawings)) {
      for (const drawing of chartDrawings) {
        if (isPositionDrawing(drawing) && drawing.status === "signal") {
          signals.push({ signal: drawing, chartKey });
        }
      }
    }

    // Sort by timestamp descending (newest first)
    return signals.sort((a, b) => b.signal.entry.timestamp - a.signal.entry.timestamp);
  }, [drawings]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = signalPositions.length;
    const longs = signalPositions.filter((s) => s.signal.type === "longPosition").length;
    const shorts = signalPositions.filter((s) => s.signal.type === "shortPosition").length;

    // Get unique strategies
    const uniqueStrategies = new Set(signalPositions.map((s) => s.signal.strategyId || "manual"));

    return { total, longs, shorts, strategies: uniqueStrategies.size };
  }, [signalPositions]);

  // Handle "Take Trade" action
  const handleTakeTrade = (options: TakeTradeOptions) => {
    if (!selectedSignal) return;

    const { signal, chartKey } = selectedSignal;
    const [pair, timeframe] = chartKey.split(":");

    // Update the position status to "open" or "pending"
    updateDrawing(pair, timeframe, signal.id, {
      status: options.entryType === "market" ? "open" : "pending",
      confirmedAt: Date.now(),
      quantity: options.positionSize,
    });

    setSelectedSignal(null);
    onSignalTaken?.(signal);
  };

  // Handle dismiss signal
  const handleDismiss = (signal: PositionDrawing, chartKey: string) => {
    const [pair, timeframe] = chartKey.split(":");

    // Remove the signal drawing
    useDrawingStore.getState().removeDrawing(pair, timeframe, signal.id);
  };

  // Handle view on chart
  const handleViewChart = (signal: PositionDrawing, chartKey: string) => {
    const [pair, timeframe] = chartKey.split(":");
    router.push(`/chart/${pair}?tf=${timeframe}&t=${signal.entry.timestamp}`);
  };

  return (
    <div>
      {/* Stats summary */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Total Signals</div>
          <div className="text-xl font-bold text-purple-400 mt-1">{stats.total}</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Long Signals</div>
          <div className="text-xl font-bold text-green-400 mt-1">{stats.longs}</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Short Signals</div>
          <div className="text-xl font-bold text-red-400 mt-1">{stats.shorts}</div>
        </div>
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
          <div className="text-gray-500 text-xs uppercase tracking-wide">Strategies</div>
          <div className="text-xl font-bold text-blue-400 mt-1">{stats.strategies}</div>
        </div>
      </div>

      {/* Signals table */}
      {signalPositions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <AlertCircle className="w-12 h-12 mb-3 text-gray-600" />
          <div className="text-lg font-medium">No Strategy Signals</div>
          <div className="text-sm mt-1">
            Signals will appear here when strategies detect entry opportunities
          </div>
        </div>
      ) : (
        <div className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left text-xs">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-2 py-2 font-medium text-center">Dir</th>
                  <th className="px-2 py-2 font-medium">Strategy</th>
                  <th className="px-2 py-2 font-medium">Entry</th>
                  <th className="px-2 py-2 font-medium">SL</th>
                  <th className="px-2 py-2 font-medium">TP</th>
                  <th className="px-2 py-2 font-medium">R:R</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {signalPositions.map(({ signal, chartKey }) => (
                  <SignalRow
                    key={signal.id}
                    signal={signal}
                    chartKey={chartKey}
                    strategyMap={strategyMap}
                    onTakeTrade={() => setSelectedSignal({ signal, chartKey })}
                    onDismiss={() => handleDismiss(signal, chartKey)}
                    onViewChart={() => handleViewChart(signal, chartKey)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Take Trade Modal */}
      {selectedSignal && (
        <TakeTradeModal
          position={selectedSignal.signal}
          onConfirm={handleTakeTrade}
          onDismiss={() => {
            handleDismiss(selectedSignal.signal, selectedSignal.chartKey);
            setSelectedSignal(null);
          }}
          onClose={() => setSelectedSignal(null)}
        />
      )}
    </div>
  );
}
