"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  Play,
  Clock,
  BarChart3,
  Calendar,
  DollarSign,
  Settings2,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Zap,
} from "lucide-react";

const PAIRS = [
  { id: "DXY", name: "DXY", category: "indices" },
  { id: "SPX500_USD", name: "S&P 500", category: "indices" },
  { id: "EUR_USD", name: "EUR/USD", category: "forex" },
  { id: "GBP_USD", name: "GBP/USD", category: "forex" },
  { id: "USD_JPY", name: "USD/JPY", category: "forex" },
  { id: "USD_CHF", name: "USD/CHF", category: "forex" },
  { id: "AUD_USD", name: "AUD/USD", category: "forex" },
  { id: "USD_CAD", name: "USD/CAD", category: "forex" },
  { id: "NZD_USD", name: "NZD/USD", category: "forex" },
  { id: "XAU_USD", name: "Gold", category: "commodities" },
  { id: "BTC_USD", name: "Bitcoin", category: "crypto" },
];

const TIMEFRAMES = [
  { id: "M5", name: "5 Min", description: "Short-term scalping" },
  { id: "M15", name: "15 Min", description: "Intraday trading" },
  { id: "M30", name: "30 Min", description: "Intraday swing" },
  { id: "H1", name: "1 Hour", description: "Day trading" },
  { id: "H4", name: "4 Hour", description: "Swing trading" },
  { id: "D", name: "Daily", description: "Position trading" },
];

const MODELS = [
  {
    id: "Momentum",
    name: "Momentum",
    description: "Trend-following with pullback entries",
    color: "bg-blue-500",
  },
  {
    id: "Mean Reversion",
    name: "Mean Reversion",
    description: "Counter-trend at extremes",
    color: "bg-green-500",
  },
  {
    id: "Fibonacci",
    name: "Fibonacci",
    description: "Retracement level analysis",
    color: "bg-yellow-500",
  },
  {
    id: "Support / Resistance",
    name: "S/R Levels",
    description: "Key level breakouts/bounces",
    color: "bg-orange-500",
  },
  {
    id: "Seasons",
    name: "Seasonality",
    description: "Time-of-year patterns",
    color: "bg-pink-500",
  },
  {
    id: "Time of Day",
    name: "Time of Day",
    description: "Intraday session patterns",
    color: "bg-cyan-500",
  },
];

// Model state: 0=disabled, 1=entry only, 2=full (entry+exit)
type ModelState = 0 | 1 | 2;

interface ModelStates {
  [key: string]: ModelState;
}

const MODEL_STATE_LABELS: Record<ModelState, string> = {
  0: "Off",
  1: "Entry",
  2: "Full",
};

const MODEL_STATE_COLORS: Record<ModelState, string> = {
  0: "bg-gray-700 text-gray-500",
  1: "bg-amber-600/20 text-amber-400 border-amber-600/50",
  2: "bg-purple-600/20 text-purple-400 border-purple-600/50",
};

export default function AnalysisPage() {
  const router = useRouter();

  // Selection state
  const [selectedPair, setSelectedPair] = useState("EUR_USD");
  const [selectedTimeframe, setSelectedTimeframe] = useState("H1");

  // Model states - all enabled by default (state=2 for full)
  const [modelStates, setModelStates] = useState<ModelStates>(() => {
    const initial: ModelStates = {};
    MODELS.forEach((m) => {
      initial[m.id] = 2; // Full by default
    });
    return initial;
  });

  // Date range
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");

  // Trade settings
  const [tpDollars, setTpDollars] = useState(3000);
  const [slDollars, setSlDollars] = useState(1325);
  const [dollarsPerMove, setDollarsPerMove] = useState(100);
  const [chunkBars, setChunkBars] = useState(16);

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Cycle model state: Off -> Entry -> Full -> Off
  const cycleModelState = useCallback((modelId: string) => {
    setModelStates((prev) => {
      const current = prev[modelId] || 0;
      const next = ((current + 1) % 3) as ModelState;
      return { ...prev, [modelId]: next };
    });
  }, []);

  // Set all models to a specific state
  const setAllModels = useCallback((state: ModelState) => {
    setModelStates((prev) => {
      const next: ModelStates = {};
      Object.keys(prev).forEach((k) => {
        next[k] = state;
      });
      return next;
    });
  }, []);

  // Count enabled models
  const enabledCount = Object.values(modelStates).filter((s) => s > 0).length;

  // Handle start analysis
  const handleStartAnalysis = () => {
    // Store settings in sessionStorage for the analysis page to read
    const analysisConfig = {
      modelStates,
      tpDollars,
      slDollars,
      dollarsPerMove,
      chunkBars,
    };
    sessionStorage.setItem("analysisConfig", JSON.stringify(analysisConfig));

    // Store date filters separately (they're managed outside haji settings)
    const dateConfig = {
      dateStart: dateStart || null,
      dateEnd: dateEnd || null,
    };
    sessionStorage.setItem("analysisConfigDates", JSON.stringify(dateConfig));

    router.push(`/analysis/${selectedPair}/${selectedTimeframe}`);
  };

  // Calculate date presets
  const setDatePreset = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setDateStart(start.toISOString().split("T")[0]);
    setDateEnd(end.toISOString().split("T")[0]);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-8 h-8 text-purple-500" />
            <h1 className="text-2xl font-bold text-gray-100">Cluster Analysis</h1>
          </div>
          <p className="text-gray-500">
            Configure and run multi-model analysis on historical price data.
          </p>
        </div>

        {/* Configuration */}
        <div className="space-y-6">
          {/* Pair Selection */}
          <section className="p-5 bg-gray-900 rounded-xl border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Select Pair
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {PAIRS.map((pair) => (
                <button
                  key={pair.id}
                  onClick={() => setSelectedPair(pair.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedPair === pair.id
                      ? "bg-purple-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                  }`}
                >
                  {pair.name}
                </button>
              ))}
            </div>
          </section>

          {/* Timeframe Selection */}
          <section className="p-5 bg-gray-900 rounded-xl border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              <Clock className="w-4 h-4 inline-block mr-2" />
              Select Timeframe
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.id}
                  onClick={() => setSelectedTimeframe(tf.id)}
                  className={`px-3 py-3 rounded-lg text-center transition-colors ${
                    selectedTimeframe === tf.id
                      ? "bg-purple-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                  }`}
                >
                  <div className="font-semibold">{tf.name}</div>
                  <div className="text-xs opacity-70 mt-0.5">{tf.description}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Model Selection - Multi-select with states */}
          <section className="p-5 bg-gray-900 rounded-xl border border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                <BarChart3 className="w-4 h-4 inline-block mr-2" />
                Models ({enabledCount} enabled)
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setAllModels(2)}
                  className="px-2 py-1 text-xs bg-purple-600/20 text-purple-400 rounded hover:bg-purple-600/30"
                >
                  All Full
                </button>
                <button
                  onClick={() => setAllModels(1)}
                  className="px-2 py-1 text-xs bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/30"
                >
                  All Entry
                </button>
                <button
                  onClick={() => setAllModels(0)}
                  className="px-2 py-1 text-xs bg-gray-700 text-gray-400 rounded hover:bg-gray-600"
                >
                  All Off
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {MODELS.map((model) => {
                const state = modelStates[model.id] || 0;
                return (
                  <button
                    key={model.id}
                    onClick={() => cycleModelState(model.id)}
                    className={`p-4 rounded-lg text-left transition-all border ${
                      state === 0
                        ? "bg-gray-800/50 border-gray-700 opacity-60"
                        : state === 1
                        ? "bg-amber-900/20 border-amber-600/30"
                        : "bg-purple-900/20 border-purple-600/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${model.color}`} />
                        <span
                          className={`font-semibold ${state === 0 ? "text-gray-500" : "text-gray-200"}`}
                        >
                          {model.name}
                        </span>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded border ${MODEL_STATE_COLORS[state]}`}
                      >
                        {MODEL_STATE_LABELS[state]}
                      </span>
                    </div>
                    <div className={`text-xs ${state === 0 ? "text-gray-600" : "text-gray-500"}`}>
                      {model.description}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-gray-600">
              Click to cycle: Off → Entry Only → Full (entry + exit)
            </p>
          </section>

          {/* Date Range */}
          <section className="p-5 bg-gray-900 rounded-xl border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              <Calendar className="w-4 h-4 inline-block mr-2" />
              Date Range
            </h2>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setDatePreset(1)}
                className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700"
              >
                Last Month
              </button>
              <button
                onClick={() => setDatePreset(3)}
                className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700"
              >
                Last 3 Months
              </button>
              <button
                onClick={() => setDatePreset(6)}
                className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700"
              >
                Last 6 Months
              </button>
              <button
                onClick={() => setDatePreset(12)}
                className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700"
              >
                Last Year
              </button>
              <button
                onClick={() => {
                  setDateStart("");
                  setDateEnd("");
                }}
                className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700"
              >
                All Data
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Date</label>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Trade Settings */}
          <section className="p-5 bg-gray-900 rounded-xl border border-gray-800">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                <Settings2 className="w-4 h-4 inline-block mr-2" />
                Trade Settings
              </h2>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">TP ($)</label>
                  <input
                    type="number"
                    value={tpDollars}
                    onChange={(e) => setTpDollars(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">SL ($)</label>
                  <input
                    type="number"
                    value={slDollars}
                    onChange={(e) => setSlDollars(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">$/Point</label>
                  <input
                    type="number"
                    value={dollarsPerMove}
                    onChange={(e) => setDollarsPerMove(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Chunk Bars</label>
                  <input
                    type="number"
                    value={chunkBars}
                    onChange={(e) => setChunkBars(Number(e.target.value))}
                    min={4}
                    max={64}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {!showAdvanced && (
              <p className="mt-2 text-xs text-gray-600">
                TP: ${tpDollars} | SL: ${slDollars} | {chunkBars} bars
              </p>
            )}
          </section>

          {/* Start Button */}
          <button
            onClick={handleStartAnalysis}
            disabled={enabledCount === 0}
            className={`w-full flex items-center justify-center gap-3 px-6 py-4 font-semibold rounded-xl transition-colors ${
              enabledCount === 0
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-500 text-white"
            }`}
          >
            <Play className="w-5 h-5" />
            Start Analysis ({enabledCount} model{enabledCount !== 1 ? "s" : ""})
          </button>

          {enabledCount === 0 && (
            <p className="text-center text-sm text-red-400">
              Enable at least one model to start analysis
            </p>
          )}

          {/* Info */}
          <div className="p-4 bg-gray-900/50 rounded-xl border border-gray-800">
            <p className="text-sm text-gray-500">
              <strong className="text-gray-400">How it works:</strong> The analysis runs all enabled
              models simultaneously, comparing their signals and performance. The ClusterMap
              visualizes trades from each model, color-coded to show patterns and clustering. Models
              in &quot;Entry&quot; mode only generate entry signals; &quot;Full&quot; mode also uses
              model-specific exit rules.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
