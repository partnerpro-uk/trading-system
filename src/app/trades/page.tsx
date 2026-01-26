"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
} from "lucide-react";
import { useTrades, useTradeStats, Trade, TradeOutcome } from "@/hooks/useTrades";
import { useStrategies } from "@/hooks/useStrategies";
import {
  detectSession,
  getSessionColor,
  formatDuration,
  calculateRMultiple,
} from "@/lib/trading/sessions";
import { Id } from "../../../convex/_generated/dataModel";

// Period options
type Period = "today" | "week" | "month" | "all";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

// Get period start timestamp
function getPeriodStart(period: Period): number {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    case "week":
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff).getTime();
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case "all":
    default:
      return 0;
  }
}

// Outcome badge with full labels
function OutcomeBadge({ outcome, status }: { outcome?: TradeOutcome; status: string }) {
  if (status === "open" || !outcome) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-900/50 text-blue-400">
        OPEN
      </span>
    );
  }

  const config: Record<TradeOutcome, { bg: string; text: string; label: string }> = {
    TP: { bg: "bg-green-900/50", text: "text-green-400", label: "TP" },
    SL: { bg: "bg-red-900/50", text: "text-red-400", label: "SL" },
    MW: { bg: "bg-green-900/50", text: "text-green-400", label: "Manual Win" },
    ML: { bg: "bg-red-900/50", text: "text-red-400", label: "Manual Loss" },
    BE: { bg: "bg-yellow-900/50", text: "text-yellow-400", label: "Break Even" },
  };

  const { bg, text, label } = config[outcome];
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${bg} ${text}`}>
      {label}
    </span>
  );
}

// Stats card
function StatCard({
  label,
  value,
  subValue,
  trend,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
      <div className="text-gray-500 text-xs uppercase tracking-wide">{label}</div>
      <div
        className={`text-xl font-bold mt-1 ${
          trend === "up"
            ? "text-green-400"
            : trend === "down"
              ? "text-red-400"
              : "text-gray-100"
        }`}
      >
        {value}
      </div>
      {subValue && <div className="text-gray-500 text-xs mt-0.5">{subValue}</div>}
    </div>
  );
}

// Filter dropdown
function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-gray-800 border border-gray-700 rounded px-3 py-1.5 pr-8 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
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

// Format price with appropriate decimals
function formatPrice(price: number | undefined, pair: string): string {
  if (price === undefined) return "-";
  const isJPY = pair.includes("JPY");
  return price.toFixed(isJPY ? 3 : 5);
}

// Format date for table
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Inline editable cell
function EditableCell({
  value,
  isEditing,
  onChange,
  type = "text",
  className = "",
  placeholder = "",
}: {
  value: string;
  isEditing: boolean;
  onChange: (value: string) => void;
  type?: "text" | "number";
  className?: string;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (!isEditing) {
    return <span className={className}>{value || "-"}</span>;
  }

  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      step={type === "number" ? "0.00001" : undefined}
      className="w-full bg-gray-800 border border-blue-500 rounded px-2 py-0.5 text-sm font-mono focus:outline-none"
    />
  );
}

// Inline editable select
function EditableSelect({
  value,
  isEditing,
  onChange,
  options,
  className = "",
}: {
  value: string;
  isEditing: boolean;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  if (!isEditing) {
    const option = options.find((o) => o.value === value);
    return <span className={className}>{option?.label || value || "-"}</span>;
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 border border-blue-500 rounded px-1 py-0.5 text-sm focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// Trade row with inline editing
function TradeRow({
  trade,
  strategyMap,
  strategies,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onViewChart,
  onDelete,
}: {
  trade: Trade;
  strategyMap: Record<string, string>;
  strategies: { id: string; name: string }[];
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (updates: Record<string, unknown>) => Promise<void>;
  onViewChart: () => void;
  onDelete: () => void;
}) {
  const [editValues, setEditValues] = useState({
    exitPrice: trade.exitPrice?.toFixed(trade.pair.includes("JPY") ? 3 : 5) || "",
    outcome: trade.outcome || "",
    strategyId: trade.strategyId,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit values when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditValues({
        exitPrice: trade.exitPrice?.toFixed(trade.pair.includes("JPY") ? 3 : 5) || "",
        outcome: trade.outcome || "",
        strategyId: trade.strategyId,
      });
    }
  }, [isEditing, trade]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const isJPY = trade.pair.includes("JPY");
      const pipMultiplier = isJPY ? 100 : 10000;
      const tolerance = isJPY ? 0.01 : 0.0001; // 1 pip tolerance for TP/SL detection
      const updates: Record<string, unknown> = {
        id: trade._id,
        strategyId: editValues.strategyId,
      };

      if (editValues.exitPrice) {
        const exitPriceNum = parseFloat(editValues.exitPrice);
        updates.exitPrice = exitPriceNum;
        updates.exitTime = trade.exitTime || Date.now();
        updates.status = "closed";

        // Calculate P&L
        const pnl =
          trade.direction === "LONG"
            ? exitPriceNum - trade.entryPrice
            : trade.entryPrice - exitPriceNum;
        updates.pnlPips = pnl * pipMultiplier;

        // Auto-detect outcome based on exit price
        const tpDistance = Math.abs(exitPriceNum - trade.takeProfit);
        const slDistance = Math.abs(exitPriceNum - trade.stopLoss);

        if (tpDistance < tolerance) {
          updates.outcome = "TP";
        } else if (slDistance < tolerance) {
          updates.outcome = "SL";
        } else {
          // Manual exit - determine win/loss based on P&L
          updates.outcome = pnl >= 0 ? "MW" : "ML";
        }
      } else if (editValues.outcome) {
        // Apply explicit outcome if user selected one (without exit price)
        updates.outcome = editValues.outcome;
      }

      await onSaveEdit(updates);
    } catch (error) {
      console.error("Failed to update trade:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const session = detectSession(trade.entryTime);
  const sessionColor = getSessionColor(session);
  const rMultiple =
    trade.exitPrice && trade.status === "closed"
      ? calculateRMultiple(
          trade.entryPrice,
          trade.exitPrice,
          trade.stopLoss,
          trade.direction
        )
      : null;

  const strategyOptions = [
    { value: "manual", label: "Manual" },
    ...strategies.map((s) => ({ value: s.id, label: s.name })),
  ];

  const outcomeOptions = [
    { value: "", label: "-" },
    { value: "TP", label: "TP" },
    { value: "SL", label: "SL" },
    { value: "MW", label: "MW" },
    { value: "ML", label: "ML" },
    { value: "BE", label: "BE" },
  ];

  return (
    <tr className={`hover:bg-gray-800/30 transition-colors ${isEditing ? "bg-gray-800/50" : ""}`}>
      <td className="px-3 py-2 text-gray-300 text-xs whitespace-nowrap">
        {formatDate(trade.entryTime)}
      </td>
      <td className="px-3 py-2 font-medium text-gray-100 text-xs">
        {trade.pair.replace("_", "/")}
      </td>
      <td className="px-2 py-2 text-center">
        {trade.direction === "LONG" ? (
          <TrendingUp className="w-4 h-4 text-green-400 inline" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-400 inline" />
        )}
      </td>
      <td className="px-2 py-2 text-gray-400 text-xs">
        {isEditing ? (
          <select
            value={editValues.strategyId}
            onChange={(e) => setEditValues((prev) => ({ ...prev, strategyId: e.target.value }))}
            className="bg-gray-800 border border-blue-500 rounded px-1 py-0.5 text-xs focus:outline-none"
          >
            {strategyOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          strategyMap[trade.strategyId] || trade.strategyId
        )}
      </td>
      <td className="px-2 py-2 font-mono text-gray-300 text-xs">
        {formatPrice(trade.entryPrice, trade.pair)}
      </td>
      <td className="px-2 py-2 font-mono text-gray-300 text-xs">
        {isEditing ? (
          <input
            type="number"
            step="0.00001"
            value={editValues.exitPrice}
            onChange={(e) => setEditValues((prev) => ({ ...prev, exitPrice: e.target.value }))}
            placeholder="Exit price..."
            className="w-24 bg-gray-800 border border-blue-500 rounded px-1 py-0.5 text-xs font-mono focus:outline-none"
          />
        ) : (
          formatPrice(trade.exitPrice, trade.pair)
        )}
      </td>
      <td className="px-2 py-2 font-mono text-red-400 text-xs">
        {formatPrice(trade.stopLoss, trade.pair)}
      </td>
      <td className="px-2 py-2 font-mono text-green-400 text-xs">
        {formatPrice(trade.takeProfit, trade.pair)}
      </td>
      <td className="px-2 py-2">
        <span
          className="px-1.5 py-0.5 text-xs rounded"
          style={{
            backgroundColor: `${sessionColor}20`,
            color: sessionColor,
          }}
        >
          {session}
        </span>
      </td>
      <td className="px-2 py-2 font-mono text-xs">
        {trade.pnlPips !== undefined ? (
          <span className={trade.pnlPips >= 0 ? "text-green-400" : "text-red-400"}>
            {trade.pnlPips >= 0 ? "+" : ""}
            {trade.pnlPips.toFixed(1)}
          </span>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
      <td className="px-2 py-2 font-mono text-xs">
        {rMultiple !== null ? (
          <span className={rMultiple >= 0 ? "text-green-400" : "text-red-400"}>
            {rMultiple >= 0 ? "+" : ""}
            {rMultiple.toFixed(2)}R
          </span>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
      <td className="px-2 py-2 font-mono text-xs">
        {trade.maxDrawdownPips !== undefined ? (
          <span className="text-orange-400">-{trade.maxDrawdownPips.toFixed(1)}</span>
        ) : (
          <span className="text-gray-500">-</span>
        )}
      </td>
      <td className="px-2 py-2 text-gray-400 text-xs">
        {trade.exitTime ? formatDuration(trade.entryTime, trade.exitTime) : "-"}
      </td>
      <td className="px-2 py-2">
        {isEditing ? (
          <EditableSelect
            value={editValues.outcome}
            isEditing={isEditing}
            onChange={(v) => setEditValues((prev) => ({ ...prev, outcome: v }))}
            options={outcomeOptions}
          />
        ) : (
          <OutcomeBadge outcome={trade.outcome} status={trade.status} />
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="p-1.5 rounded text-green-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onStartEdit}
                className="p-1.5 rounded text-gray-400 hover:text-yellow-400 hover:bg-gray-800 transition-colors"
                title="Edit Trade"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={onViewChart}
                className="p-1.5 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-800 transition-colors"
                title="View on Chart"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function TradesPage() {
  const router = useRouter();
  const { trades, isLoading, deleteTrade, updateTrade } = useTrades({ limit: 500 });
  const { stats } = useTradeStats({});
  const { strategies } = useStrategies();

  // Filters
  const [period, setPeriod] = useState<Period>("all");
  const [pairFilter, setPairFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Inline edit state - track which trade ID is being edited
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);

  // Get unique pairs
  const uniquePairs = useMemo(() => {
    if (!trades) return [];
    return [...new Set(trades.map((t) => t.pair))].sort();
  }, [trades]);

  // Strategy lookup map
  const strategyMap = useMemo(() => {
    const map: Record<string, string> = { manual: "Manual" };
    strategies.forEach((s) => {
      map[s.id] = s.name;
    });
    return map;
  }, [strategies]);

  // Filter trades
  const filteredTrades = useMemo(() => {
    if (!trades) return [];

    const periodStart = getPeriodStart(period);

    return trades.filter((trade) => {
      if (trade.entryTime < periodStart) return false;
      if (pairFilter && trade.pair !== pairFilter) return false;
      if (strategyFilter && trade.strategyId !== strategyFilter) return false;
      if (statusFilter && trade.status !== statusFilter) return false;
      return true;
    });
  }, [trades, period, pairFilter, strategyFilter, statusFilter]);

  // Calculate period stats
  const periodStats = useMemo(() => {
    const closed = filteredTrades.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => ["TP", "MW", "BE"].includes(t.outcome || ""));
    const losses = closed.filter((t) => ["SL", "ML"].includes(t.outcome || ""));

    const totalPnl = closed.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    return {
      total: filteredTrades.length,
      open: filteredTrades.filter((t) => t.status === "open").length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
    };
  }, [filteredTrades]);

  // Navigate to chart
  const handleViewChart = (trade: Trade) => {
    router.push(`/chart/${trade.pair}?tf=${trade.timeframe}&t=${trade.entryTime}`);
  };

  // Delete trade
  const handleDelete = async (trade: Trade) => {
    if (confirm("Delete this trade?")) {
      await deleteTrade({ id: trade._id });
    }
  };

  // Save trade edits
  const handleSaveEdit = async (updates: Record<string, unknown>) => {
    await updateTrade(updates as { id: Id<"trades"> });
    setEditingTradeId(null);
  };

  const hasFilters = pairFilter || strategyFilter || statusFilter;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold">Trade Journal</h1>
          </div>

          {/* Period tabs */}
          <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  period === opt.value
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-6 py-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          <StatCard label="Total" value={periodStats.total} />
          <StatCard
            label="Open"
            value={periodStats.open}
            trend={periodStats.open > 0 ? "neutral" : undefined}
          />
          <StatCard label="Closed" value={periodStats.closed} />
          <StatCard
            label="Wins"
            value={periodStats.wins}
            trend={periodStats.wins > 0 ? "up" : undefined}
          />
          <StatCard
            label="Losses"
            value={periodStats.losses}
            trend={periodStats.losses > 0 ? "down" : undefined}
          />
          <StatCard
            label="Win Rate"
            value={`${periodStats.winRate.toFixed(0)}%`}
            trend={periodStats.winRate >= 50 ? "up" : "down"}
          />
          <StatCard
            label="P&L"
            value={`${periodStats.totalPnl >= 0 ? "+" : ""}${periodStats.totalPnl.toFixed(1)}`}
            subValue="pips"
            trend={periodStats.totalPnl >= 0 ? "up" : "down"}
          />
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 mb-4">
          <FilterSelect
            value={pairFilter}
            onChange={setPairFilter}
            options={uniquePairs.map((p) => ({ value: p, label: p.replace("_", "/") }))}
            placeholder="All Pairs"
          />
          <FilterSelect
            value={strategyFilter}
            onChange={setStrategyFilter}
            options={strategies.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="All Strategies"
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
            placeholder="All Status"
          />
          {hasFilters && (
            <button
              onClick={() => {
                setPairFilter("");
                setStrategyFilter("");
                setStatusFilter("");
              }}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Clear
            </button>
          )}
          <div className="flex-1" />
          <span className="text-sm text-gray-500">{filteredTrades.length} trades</span>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            No trades found for this period
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
                    <th className="px-2 py-2 font-medium">Exit</th>
                    <th className="px-2 py-2 font-medium">SL</th>
                    <th className="px-2 py-2 font-medium">TP</th>
                    <th className="px-2 py-2 font-medium">Session</th>
                    <th className="px-2 py-2 font-medium">P&L</th>
                    <th className="px-2 py-2 font-medium">R</th>
                    <th className="px-2 py-2 font-medium">DD</th>
                    <th className="px-2 py-2 font-medium">Dur</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {filteredTrades.map((trade) => (
                    <TradeRow
                      key={trade._id}
                      trade={trade}
                      strategyMap={strategyMap}
                      strategies={strategies}
                      isEditing={editingTradeId === trade._id}
                      onStartEdit={() => setEditingTradeId(trade._id)}
                      onCancelEdit={() => setEditingTradeId(null)}
                      onSaveEdit={handleSaveEdit}
                      onViewChart={() => handleViewChart(trade)}
                      onDelete={() => handleDelete(trade)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
