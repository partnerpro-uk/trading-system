"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Trash2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useBacktesting, DEFAULT_QUERY, type BacktestingQuery } from "@/hooks/useBacktesting";
import { QueryBuilder } from "@/components/backtesting/QueryBuilder";
import { StatsGrid } from "@/components/backtesting/StatsGrid";
import { DistributionChart } from "@/components/backtesting/DistributionChart";
import { HeatmapChart } from "@/components/backtesting/HeatmapChart";
import { SeasonalChart } from "@/components/backtesting/SeasonalChart";
import { EntityTable } from "@/components/backtesting/EntityTable";

export default function BacktestingPage() {
  const { userId } = useAuth();
  const { query, setQuery, result, runQuery, isLoading, error } = useBacktesting();

  // Saved queries
  const savedQueries = useQuery(
    api.backtesting.getUserQueries,
    userId ? { userId } : "skip"
  );
  const saveQueryMutation = useMutation(api.backtesting.saveQuery);
  const deleteQueryMutation = useMutation(api.backtesting.deleteQuery);

  const [savedDropdownOpen, setSavedDropdownOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const handleSaveQuery = async () => {
    if (!userId || !saveName.trim()) return;
    await saveQueryMutation({
      userId,
      name: saveName.trim(),
      config: JSON.stringify(query),
    });
    setSaveName("");
    setSaveModalOpen(false);
  };

  const handleLoadQuery = (config: string) => {
    try {
      const parsed = JSON.parse(config) as BacktestingQuery;
      setQuery(parsed);
      setSavedDropdownOpen(false);
    } catch {
      console.error("Failed to parse saved query");
    }
  };

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
            <h1 className="text-xl font-semibold">Backtesting</h1>
          </div>

          {/* Saved Queries Dropdown */}
          <div className="relative">
            <button
              onClick={() => setSavedDropdownOpen(!savedDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Saved Queries
              <ChevronDown
                className={`w-4 h-4 transition-transform ${savedDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {savedDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
                {!savedQueries || savedQueries.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">No saved queries</div>
                ) : (
                  savedQueries.map((sq) => (
                    <div
                      key={sq._id}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-800 group"
                    >
                      <button
                        onClick={() => handleLoadQuery(sq.config)}
                        className="text-sm text-gray-300 hover:text-white flex-1 text-left"
                      >
                        {sq.name}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteQueryMutation({ id: sq._id });
                        }}
                        className="p-1 rounded text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
        {/* Query Builder */}
        <QueryBuilder
          query={query}
          onChange={setQuery}
          onRun={() => runQuery()}
          onSave={() => setSaveModalOpen(true)}
          isLoading={isLoading}
        />

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        )}

        {/* Results */}
        {result && !isLoading && (
          <>
            {/* Stats Grid */}
            <StatsGrid stats={result.stats} entityType={query.entityType} />

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DistributionChart data={result.distribution} entityType={query.entityType} />
              <HeatmapChart data={result.heatmap} entityType={query.entityType} />
            </div>

            {/* Seasonal Chart */}
            <SeasonalChart data={result.seasonal} />

            {/* Entity Table */}
            <EntityTable results={result.queryResults} entityType={query.entityType} />
          </>
        )}

        {/* Empty State */}
        {!result && !isLoading && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <p className="text-lg mb-2">Configure your query above and click Run</p>
            <p className="text-sm">
              Analyze historical BOS, FVG, sweep, and swing patterns across pairs and timeframes
            </p>
          </div>
        )}
      </main>

      {/* Save Query Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Save Query</h3>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Query name..."
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 mb-4"
              onKeyDown={(e) => e.key === "Enter" && handleSaveQuery()}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setSaveModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveQuery}
                disabled={!saveName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
