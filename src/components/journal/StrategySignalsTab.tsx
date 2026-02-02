"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Check,
  X,
  AlertCircle,
  ChevronDown,
  Target,
  Percent,
  BarChart3,
  Filter,
} from "lucide-react";
import { useDrawingStore } from "@/lib/drawings/store";
import { PositionDrawing, isPositionDrawing } from "@/lib/drawings/types";
import { useStrategies } from "@/hooks/useStrategies";
import { TakeTradeModal, TakeTradeOptions } from "@/components/chart/TakeTradeModal";

interface StrategySignalsTabProps {
  onSignalTaken?: (signal: PositionDrawing) => void;
}

// Period filter options
type Period = "today" | "week" | "month" | "all";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

function getPeriodStart(period: Period): number {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    case "week":
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff).getTime();
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case "all":
    default:
      return 0;
  }
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
 * Filter dropdown component
 */
function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm text-gray-200 focus:outline-none focus:border-purple-500 cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </div>
  );
}

/**
 * Stat card component
 */
function StatCard({
  label,
  value,
  subValue,
  trend,
  icon,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900/70 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-400 text-xs uppercase tracking-wide">{label}</span>
        {icon && <span className="text-gray-500">{icon}</span>}
      </div>
      <div
        className={`text-2xl font-bold ${
          trend === "up"
            ? "text-green-400"
            : trend === "down"
              ? "text-red-400"
              : "text-gray-100"
        }`}
      >
        {value}
      </div>
      {subValue && <div className="text-gray-500 text-xs mt-1">{subValue}</div>}
    </div>
  );
}

/**
 * Signal status badge
 */
function SignalStatusBadge({ status }: { status?: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    signal: { bg: "bg-purple-900/50", text: "text-purple-400", label: "Pending" },
    pending: { bg: "bg-yellow-900/50", text: "text-yellow-400", label: "Entered" },
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
      <td className="px-3 py-2.5 text-gray-300 text-xs whitespace-nowrap">
        {formatDate(signal.entry.timestamp)}
      </td>
      <td className="px-3 py-2.5 font-medium text-gray-100 text-xs">
        {pair.replace("_", "/")}
      </td>
      <td className="px-2 py-2.5 text-center">
        {isLong ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 text-xs">
            <TrendingUp className="w-3 h-3" />
            Long
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 text-xs">
            <TrendingDown className="w-3 h-3" />
            Short
          </span>
        )}
      </td>
      <td className="px-2 py-2.5 text-gray-400 text-xs">
        <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300">
          {signal.strategyId ? strategyMap[signal.strategyId] || signal.strategyId : "Manual"}
        </span>
      </td>
      <td className="px-2 py-2.5 font-mono text-gray-300 text-xs">
        {formatPrice(signal.entry.price, pair)}
      </td>
      <td className="px-2 py-2.5 font-mono text-xs">
        <span className="text-red-400">{formatPrice(signal.stopLoss, pair)}</span>
        <span className="text-gray-600 ml-1">({slPips.toFixed(0)}p)</span>
      </td>
      <td className="px-2 py-2.5 font-mono text-xs">
        <span className="text-green-400">{formatPrice(signal.takeProfit, pair)}</span>
        <span className="text-gray-600 ml-1">({tpPips.toFixed(0)}p)</span>
      </td>
      <td className="px-2 py-2.5 text-xs font-bold">
        <span className={rrRatio >= 2 ? "text-green-400" : rrRatio >= 1.5 ? "text-yellow-400" : "text-orange-400"}>
          1:{rrRatio.toFixed(1)}
        </span>
      </td>
      <td className="px-2 py-2.5">
        <SignalStatusBadge status={signal.status} />
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={onTakeTrade}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors border border-green-600/30"
            title="I Took This Trade"
          >
            <Check className="w-3 h-3" />
            Take
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
            title="Dismiss Signal"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={onViewChart}
            className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-900/20 transition-colors"
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

  // Filters
  const [period, setPeriod] = useState<Period>("all");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [pairFilter, setPairFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"" | "long" | "short">("");

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
  const allSignals = useMemo(() => {
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

  // Get unique pairs and strategies for filters
  const filterOptions = useMemo(() => {
    const pairs = new Set<string>();
    const usedStrategies = new Set<string>();

    for (const { signal, chartKey } of allSignals) {
      const [pair] = chartKey.split(":");
      pairs.add(pair);
      if (signal.strategyId) usedStrategies.add(signal.strategyId);
    }

    return {
      pairs: [...pairs].sort().map(p => ({ value: p, label: p.replace("_", "/") })),
      strategies: [...usedStrategies].map(id => ({ value: id, label: strategyMap[id] || id })),
    };
  }, [allSignals, strategyMap]);

  // Filtered signals
  const filteredSignals = useMemo(() => {
    const periodStart = getPeriodStart(period);

    return allSignals.filter(({ signal, chartKey }) => {
      const [pair] = chartKey.split(":");

      // Period filter
      if (signal.entry.timestamp < periodStart) return false;

      // Strategy filter
      if (strategyFilter && signal.strategyId !== strategyFilter) return false;

      // Pair filter
      if (pairFilter && pair !== pairFilter) return false;

      // Direction filter
      if (directionFilter === "long" && signal.type !== "longPosition") return false;
      if (directionFilter === "short" && signal.type !== "shortPosition") return false;

      return true;
    });
  }, [allSignals, period, strategyFilter, pairFilter, directionFilter]);

  // Calculate comprehensive stats
  const stats = useMemo(() => {
    const total = filteredSignals.length;
    const longs = filteredSignals.filter((s) => s.signal.type === "longPosition").length;
    const shorts = filteredSignals.filter((s) => s.signal.type === "shortPosition").length;

    // Calculate average R:R
    let totalRR = 0;
    let totalPotentialPips = 0;
    let totalRisk = 0;

    for (const { signal } of filteredSignals) {
      const slDistance = Math.abs(signal.entry.price - signal.stopLoss);
      const tpDistance = Math.abs(signal.takeProfit - signal.entry.price);
      const pipMultiplier = signal.entry.price < 10 ? 10000 : 100;

      if (slDistance > 0) {
        totalRR += tpDistance / slDistance;
        totalPotentialPips += tpDistance * pipMultiplier;
        totalRisk += slDistance * pipMultiplier;
      }
    }

    const avgRR = total > 0 ? totalRR / total : 0;
    const avgPotentialPips = total > 0 ? totalPotentialPips / total : 0;
    const avgRiskPips = total > 0 ? totalRisk / total : 0;

    // Get unique strategies in filtered set
    const uniqueStrategies = new Set(filteredSignals.map((s) => s.signal.strategyId || "manual"));

    // Hypothetical stats (assuming 50% win rate as baseline)
    const hypotheticalWinRate = 50;
    const hypotheticalWins = Math.round(total * (hypotheticalWinRate / 100));
    const hypotheticalLosses = total - hypotheticalWins;
    const hypotheticalPnL = (hypotheticalWins * avgPotentialPips) - (hypotheticalLosses * avgRiskPips);

    return {
      total,
      longs,
      shorts,
      strategies: uniqueStrategies.size,
      avgRR,
      avgPotentialPips,
      avgRiskPips,
      totalPotentialPips,
      hypotheticalWinRate,
      hypotheticalPnL,
    };
  }, [filteredSignals]);

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
    useDrawingStore.getState().removeDrawing(pair, timeframe, signal.id);
  };

  // Handle view on chart
  const handleViewChart = (signal: PositionDrawing, chartKey: string) => {
    const [pair, timeframe] = chartKey.split(":");
    router.push(`/chart/${pair}?tf=${timeframe}&t=${signal.entry.timestamp}`);
  };

  const hasFilters = strategyFilter || pairFilter || directionFilter || period !== "all";

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Signals"
          value={stats.total}
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <StatCard
          label="Long"
          value={stats.longs}
          subValue={stats.total > 0 ? `${((stats.longs / stats.total) * 100).toFixed(0)}%` : undefined}
          trend="up"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Short"
          value={stats.shorts}
          subValue={stats.total > 0 ? `${((stats.shorts / stats.total) * 100).toFixed(0)}%` : undefined}
          trend="down"
          icon={<TrendingDown className="w-4 h-4" />}
        />
        <StatCard
          label="Avg R:R"
          value={`1:${stats.avgRR.toFixed(1)}`}
          subValue={stats.avgRR >= 2 ? "Good" : stats.avgRR >= 1.5 ? "Fair" : "Low"}
          trend={stats.avgRR >= 2 ? "up" : stats.avgRR >= 1.5 ? "neutral" : "down"}
          icon={<Target className="w-4 h-4" />}
        />
        <StatCard
          label="Avg TP Distance"
          value={`${stats.avgPotentialPips.toFixed(0)}p`}
          subValue="potential reward"
          icon={<Percent className="w-4 h-4" />}
        />
        <StatCard
          label="Avg Risk"
          value={`${stats.avgRiskPips.toFixed(0)}p`}
          subValue="stop loss"
          trend="down"
          icon={<AlertCircle className="w-4 h-4" />}
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-900/30 rounded-lg border border-gray-800">
        <div className="flex items-center gap-2 text-gray-400">
          <Filter className="w-4 h-4" />
          <span className="text-sm font-medium">Filters:</span>
        </div>

        {/* Period Filter */}
        <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                period === opt.value
                  ? "bg-purple-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Strategy Filter */}
        <FilterSelect
          value={strategyFilter}
          onChange={setStrategyFilter}
          options={filterOptions.strategies}
          placeholder="All Strategies"
        />

        {/* Pair Filter */}
        <FilterSelect
          value={pairFilter}
          onChange={setPairFilter}
          options={filterOptions.pairs}
          placeholder="All Pairs"
        />

        {/* Direction Filter */}
        <FilterSelect
          value={directionFilter}
          onChange={(v) => setDirectionFilter(v as "" | "long" | "short")}
          options={[
            { value: "long", label: "Long Only" },
            { value: "short", label: "Short Only" },
          ]}
          placeholder="All Directions"
        />

        {/* Clear Filters */}
        {hasFilters && (
          <button
            onClick={() => {
              setPeriod("all");
              setStrategyFilter("");
              setPairFilter("");
              setDirectionFilter("");
            }}
            className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
          >
            Clear All
          </button>
        )}

        <div className="flex-1" />

        {/* Count */}
        <span className="text-sm text-gray-500">
          {filteredSignals.length} signal{filteredSignals.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Signals table */}
      {filteredSignals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500 bg-gray-900/20 rounded-lg border border-gray-800">
          <AlertCircle className="w-12 h-12 mb-3 text-gray-600" />
          <div className="text-lg font-medium">No Strategy Signals</div>
          <div className="text-sm mt-1 text-gray-600">
            {hasFilters
              ? "Try adjusting your filters"
              : "Signals will appear here when strategies detect entry opportunities"}
          </div>
        </div>
      ) : (
        <div className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50 text-gray-400 text-left text-xs">
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Pair</th>
                  <th className="px-2 py-3 font-medium text-center">Direction</th>
                  <th className="px-2 py-3 font-medium">Strategy</th>
                  <th className="px-2 py-3 font-medium">Entry</th>
                  <th className="px-2 py-3 font-medium">Stop Loss</th>
                  <th className="px-2 py-3 font-medium">Take Profit</th>
                  <th className="px-2 py-3 font-medium">R:R</th>
                  <th className="px-2 py-3 font-medium">Status</th>
                  <th className="px-2 py-3 font-medium w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filteredSignals.map(({ signal, chartKey }) => (
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
