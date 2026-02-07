"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Play, Save } from "lucide-react";
import { PAIRS } from "@/lib/pairs";
import type { BacktestingQuery, EntityType } from "@/hooks/useBacktesting";

const TIMEFRAMES = [
  { value: "M15", label: "M15" },
  { value: "H1", label: "H1" },
  { value: "H4", label: "H4" },
  { value: "D", label: "Daily" },
  { value: "W", label: "Weekly" },
];

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "bos", label: "Break of Structure" },
  { value: "fvg", label: "Fair Value Gap" },
  { value: "sweep", label: "Liquidity Sweep" },
  { value: "swing", label: "Swing Point" },
];

interface QueryBuilderProps {
  query: BacktestingQuery;
  onChange: (query: BacktestingQuery) => void;
  onRun: () => void;
  onSave: () => void;
  isLoading: boolean;
}

export function QueryBuilder({ query, onChange, onRun, onSave, isLoading }: QueryBuilderProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const togglePair = (pairId: string) => {
    const pairs = query.pairs.includes(pairId)
      ? query.pairs.filter((p) => p !== pairId)
      : [...query.pairs, pairId];
    if (pairs.length > 0) onChange({ ...query, pairs });
  };

  const toggleTimeframe = (tf: string) => {
    const tfs = query.timeframes.includes(tf)
      ? query.timeframes.filter((t) => t !== tf)
      : [...query.timeframes, tf];
    if (tfs.length > 0) onChange({ ...query, timeframes: tfs });
  };

  const updateFilter = (key: string, value: unknown) => {
    onChange({ ...query, filters: { ...query.filters, [key]: value || undefined } });
  };

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-gray-200">Query Builder</span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-800 pt-4">
          {/* Row 1: Pairs + Timeframes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Pairs */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                Pairs
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PAIRS.map((pair) => (
                  <button
                    key={pair.id}
                    onClick={() => togglePair(pair.id)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      query.pairs.includes(pair.id)
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                    }`}
                  >
                    {pair.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeframes */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                Timeframes
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => toggleTimeframe(tf.value)}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      query.timeframes.includes(tf.value)
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Date Range + Entity Type */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                Start Date
              </label>
              <input
                type="date"
                value={query.startDate}
                onChange={(e) => onChange({ ...query, startDate: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                End Date
              </label>
              <input
                type="date"
                value={query.endDate}
                onChange={(e) => onChange({ ...query, endDate: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                Entity Type
              </label>
              <select
                value={query.entityType}
                onChange={(e) =>
                  onChange({ ...query, entityType: e.target.value as EntityType, filters: {} })
                }
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {ENTITY_TYPES.map((et) => (
                  <option key={et.value} value={et.value}>
                    {et.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Dynamic Filters per entity type */}
          <div className="flex flex-wrap gap-3">
            {/* Common: Direction */}
            {(query.entityType === "bos" ||
              query.entityType === "fvg" ||
              query.entityType === "sweep") && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                  Direction
                </label>
                <select
                  value={query.filters.direction || ""}
                  onChange={(e) => updateFilter("direction", e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="">All</option>
                  <option value="bullish">Bullish</option>
                  <option value="bearish">Bearish</option>
                </select>
              </div>
            )}

            {/* BOS-specific */}
            {query.entityType === "bos" && (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-300 self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={query.filters.displacement || false}
                    onChange={(e) => updateFilter("displacement", e.target.checked || undefined)}
                    className="rounded bg-gray-800 border-gray-600"
                  />
                  Displacement only
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={query.filters.counterTrend || false}
                    onChange={(e) => updateFilter("counterTrend", e.target.checked || undefined)}
                    className="rounded bg-gray-800 border-gray-600"
                  />
                  Counter-trend only
                </label>
              </>
            )}

            {/* FVG-specific */}
            {query.entityType === "fvg" && (
              <>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                    Max Tier
                  </label>
                  <select
                    value={query.filters.tier || ""}
                    onChange={(e) => updateFilter("tier", e.target.value ? parseInt(e.target.value) : undefined)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">All Tiers</option>
                    <option value="1">Tier 1</option>
                    <option value="2">Tier 1-2</option>
                    <option value="3">Tier 1-3</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                    Min Gap (pips)
                  </label>
                  <input
                    type="number"
                    value={query.filters.minGapPips || ""}
                    onChange={(e) =>
                      updateFilter("minGapPips", e.target.value ? parseFloat(e.target.value) : undefined)
                    }
                    placeholder="0"
                    className="w-20 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                    Status
                  </label>
                  <select
                    value={query.filters.status || ""}
                    onChange={(e) => updateFilter("status", e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">All</option>
                    <option value="fresh">Fresh</option>
                    <option value="partial">Partial</option>
                    <option value="filled">Filled</option>
                    <option value="inverted">Inverted</option>
                  </select>
                </div>
              </>
            )}

            {/* Sweep-specific */}
            {query.entityType === "sweep" && (
              <>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                    Swept Level
                  </label>
                  <select
                    value={query.filters.sweptLevelType || ""}
                    onChange={(e) => updateFilter("sweptLevelType", e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">All</option>
                    <option value="PDH">PDH</option>
                    <option value="PDL">PDL</option>
                    <option value="PWH">PWH</option>
                    <option value="PWL">PWL</option>
                    <option value="swing">Swing</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 self-end pb-1.5">
                  <input
                    type="checkbox"
                    checked={query.filters.followedByBOS || false}
                    onChange={(e) => updateFilter("followedByBOS", e.target.checked || undefined)}
                    className="rounded bg-gray-800 border-gray-600"
                  />
                  Followed by BOS
                </label>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onRun}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {isLoading ? "Running..." : "Run Query"}
            </button>
            <button
              onClick={onSave}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save Query
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
