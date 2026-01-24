"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Calendar,
  BarChart3,
  RefreshCw,
  AlertCircle,
  Activity,
  ChevronDown,
} from "lucide-react";
import { useAnalysisCandles, useComputeWorker } from "@/hooks/analysis";
import { StatCard } from "@/components/analysis/ui";
import { SimpleSettingsPanel } from "@/components/analysis/SimpleSettingsPanel";
import { TradeAnalytics } from "@/components/analysis/trade-analytics";
import { TradeDetailsModal } from "@/components/analysis/TradeDetailsModal";
import { TradeCandlestickChart } from "@/components/analysis/charts";
import { PropFirmSimulation } from "@/components/analysis/PropFirmSimulation";
import type { Trade } from "../../../../lib/analysis/types";
import {
  type SimpleSettings,
  DEFAULT_SIMPLE_SETTINGS,
} from "../../../../lib/analysis/simple-settings-types";
import { mapSimpleToFull } from "../../../../lib/analysis/settings-mapper";

// ============================================
// CONSTANTS
// ============================================

const PAIRS = [
  { id: "DXY", name: "DXY" },
  { id: "SPX500_USD", name: "S&P 500" },
  { id: "EUR_USD", name: "EUR/USD" },
  { id: "GBP_USD", name: "GBP/USD" },
  { id: "USD_JPY", name: "USD/JPY" },
  { id: "USD_CHF", name: "USD/CHF" },
  { id: "AUD_USD", name: "AUD/USD" },
  { id: "USD_CAD", name: "USD/CAD" },
  { id: "NZD_USD", name: "NZD/USD" },
  { id: "XAU_USD", name: "Gold" },
  { id: "BTC_USD", name: "Bitcoin" },
];

const TIMEFRAMES = [
  { id: "M5", name: "5m" },
  { id: "M15", name: "15m" },
  { id: "M30", name: "30m" },
  { id: "H1", name: "1H" },
  { id: "H4", name: "4H" },
  { id: "D", name: "1D" },
];

export default function AnalysisViewPage() {
  const params = useParams();
  const router = useRouter();

  // Get initial pair/timeframe from URL
  const urlPair = params.pair as string;
  const urlTimeframe = params.timeframe as string;

  // ============================================
  // Pair/Timeframe State
  // ============================================
  const [selectedPair, setSelectedPair] = useState(urlPair || "EUR_USD");
  const [selectedTimeframe, setSelectedTimeframe] = useState(urlTimeframe || "H1");

  const formattedPair = selectedPair.replace("_", "/");

  const handlePairChange = useCallback(
    (newPair: string) => {
      setSelectedPair(newPair);
      router.push(`/analysis/${newPair}/${selectedTimeframe}`);
    },
    [selectedTimeframe, router]
  );

  const handleTimeframeChange = useCallback(
    (newTf: string) => {
      setSelectedTimeframe(newTf);
      router.push(`/analysis/${selectedPair}/${newTf}`);
    },
    [selectedPair, router]
  );

  // ============================================
  // Simple Settings State (12 params instead of 85+)
  // ============================================
  const [settings, setSettings] = useState<SimpleSettings>({ ...DEFAULT_SIMPLE_SETTINGS });

  // Selected trade for modal
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  // Date preset helper
  const setDatePreset = useCallback((months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setSettings((prev) => ({
      ...prev,
      dateStart: start.toISOString().split("T")[0],
      dateEnd: end.toISOString().split("T")[0],
    }));
  }, []);

  // Load candle data
  const {
    candles,
    isLoading: isLoadingCandles,
    error: candleError,
    progress: loadProgress,
    refetch,
  } = useAnalysisCandles({
    pair: selectedPair,
    timeframe: selectedTimeframe,
    targetCount: 50000,
    enabled: true,
    dateStart: settings.dateStart,
    dateEnd: settings.dateEnd,
  });

  // Compute worker
  const {
    isComputing,
    progress: computeProgress,
    result: computeResult,
    error: computeError,
    compute,
    cancel,
  } = useComputeWorker();

  // Filter candles by date range
  const analysisCandles = useMemo(() => {
    if (!candles || candles.length === 0) return candles;

    return candles.filter((candle) => {
      const candleMs = candle.timestamp;

      if (settings.dateStart) {
        const startMs = new Date(settings.dateStart).getTime();
        if (candleMs < startMs) return false;
      }
      if (settings.dateEnd) {
        const endMs = new Date(settings.dateEnd + "T23:59:59").getTime();
        if (candleMs > endMs) return false;
      }

      return true;
    });
  }, [candles, settings.dateStart, settings.dateEnd]);

  // Map simple settings to full settings for worker (pass pair for correct dollarsPerMove)
  const fullSettings = useMemo(() => mapSimpleToFull(settings, selectedPair), [settings, selectedPair]);

  // Convert to compute format
  const computeSettings = useMemo(() => {
    return {
      pair: selectedPair,
      timeframe: selectedTimeframe,
      parseMode: "utc" as const,
      model:
        Object.entries(fullSettings.modelStates).find(([, state]) => state === 2)?.[0] ||
        "Momentum",
      tpDist: fullSettings.tpDollars / fullSettings.dollarsPerMove,
      slDist: fullSettings.slDollars / fullSettings.dollarsPerMove,
      chunkBars: fullSettings.chunkBars,
      dollarsPerMove: fullSettings.dollarsPerMove,
      aiMethod: fullSettings.aiMethod,
      useAI: fullSettings.useAI,
      checkEveryBar: fullSettings.checkEveryBar,
      featureLevels: fullSettings.featureLevels,
      featureModes: fullSettings.featureModes,
      modelStates: fullSettings.modelStates,
      aiModalities: fullSettings.aiLibrariesActive.reduce(
        (acc, id) => {
          acc[id] = true;
          return acc;
        },
        {} as Record<string, boolean>
      ),
      librarySettings: fullSettings.aiLibrariesSettings,
      activeLibraries: fullSettings.aiLibrariesActive.reduce(
        (acc, id) => {
          acc[id] = true;
          return acc;
        },
        {} as Record<string, boolean>
      ),
      aiLibrariesActive: fullSettings.aiLibrariesActive,
      aiLibrariesSettings: fullSettings.aiLibrariesSettings,
      kEntry: fullSettings.kEntry,
      kExit: fullSettings.kExit,
      knnVoteMode: fullSettings.knnVoteMode,
      hdbMinClusterSize: fullSettings.hdbMinClusterSize,
      hdbMinSamples: fullSettings.hdbMinSamples,
      hdbEpsQuantile: fullSettings.hdbEpsQuantile,
      hdbSampleCap: fullSettings.hdbSampleCap,
      hdbModalityDistinction: fullSettings.hdbModalityDistinction,
      confidenceThreshold: fullSettings.confidenceThreshold,
      aiExitStrict: fullSettings.aiExitStrict,
      aiExitLossTol: fullSettings.aiExitLossTol,
      aiExitWinTol: fullSettings.aiExitWinTol,
      useMimExit: fullSettings.useMimExit,
      stopMode: fullSettings.stopMode,
      stopTriggerPct: fullSettings.stopTriggerPct,
      breakEvenTriggerPct: fullSettings.breakEvenTriggerPct,
      trailingStartPct: fullSettings.trailingStartPct,
      trailingDistPct: fullSettings.trailingDistPct,
      maxTradesPerDay: fullSettings.maxTradesPerDay,
      cooldownBars: fullSettings.cooldownBars,
      maxConcurrentTrades: fullSettings.maxConcurrentTrades,
      maxBarsInTrade: fullSettings.maxBarsInTrade,
      complexity: fullSettings.complexity,
      dimStyle: fullSettings.dimStyle,
      dimManualAmount: fullSettings.dimManualAmount,
      compressionMethod: fullSettings.compressionMethod,
      distanceMetric: fullSettings.distanceMetric,
      dimWeightMode: fullSettings.dimWeightMode,
      dimWeightsBump: fullSettings.dimWeightsBump,
      calibrationMode: fullSettings.calibrationMode,
      volatilityPercentile: fullSettings.volatilityPercentile,
      modalities: fullSettings.modalities,
      remapOppositeOutcomes: fullSettings.remapOppositeOutcomes,
      validationMode: fullSettings.validationMode,
      antiCheatEnabled: fullSettings.antiCheatEnabled,
      preventAiLeak: fullSettings.preventAiLeak,
      realismLevel: fullSettings.realismLevel,
      staticLibrariesClusters: fullSettings.staticLibrariesClusters,
      sessions: fullSettings.enabledSessions,
      months: Object.fromEntries(
        Object.entries(fullSettings.enabledMonths).map(([k, v]) => [Number(k), v])
      ),
      dows: Object.fromEntries(
        Object.entries(fullSettings.enabledDows).map(([k, v]) => [Number(k), v])
      ),
      hours: Object.fromEntries(
        Object.entries(fullSettings.enabledHours).map(([k, v]) => [Number(k), v])
      ),
      years: Object.fromEntries(
        Object.entries(fullSettings.enabledYears).map(([k, v]) => [Number(k), v])
      ),
    };
  }, [fullSettings, selectedPair, selectedTimeframe]);

  // Run analysis
  const runAnalysis = useCallback(async () => {
    if (analysisCandles.length < 100) return;
    try {
      await compute(analysisCandles, computeSettings);
    } catch (err) {
      console.error("Analysis failed:", err);
    }
  }, [analysisCandles, compute, computeSettings]);

  // Auto-run analysis when settings change (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSettingsRef = useRef<string>("");

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (analysisCandles.length < 100 || isLoadingCandles) {
      return;
    }

    const settingsFingerprint = JSON.stringify(computeSettings);

    if (settingsFingerprint === prevSettingsRef.current) {
      return;
    }

    debounceRef.current = setTimeout(() => {
      prevSettingsRef.current = settingsFingerprint;
      runAnalysis();
    }, 400);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computeSettings, analysisCandles.length, isLoadingCandles]);

  // Calculate basic candle statistics
  const candleStats = useMemo(() => {
    if (!analysisCandles || analysisCandles.length === 0) return null;

    const closes = analysisCandles.map((c) => c.close);
    const highs = analysisCandles.map((c) => c.high);
    const lows = analysisCandles.map((c) => c.low);

    const currentPrice = closes[closes.length - 1];
    const firstPrice = closes[0];
    const priceChange = currentPrice - firstPrice;
    const priceChangePercent = (priceChange / firstPrice) * 100;

    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);

    let atrSum = 0;
    for (let i = 1; i < analysisCandles.length; i++) {
      const tr = Math.max(
        analysisCandles[i].high - analysisCandles[i].low,
        Math.abs(analysisCandles[i].high - analysisCandles[i - 1].close),
        Math.abs(analysisCandles[i].low - analysisCandles[i - 1].close)
      );
      atrSum += tr;
    }
    const avgTrueRange = atrSum / (analysisCandles.length - 1);

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * 100;

    const n = closes.length;
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY = closes.reduce((a, b) => a + b, 0);
    const sumXY = closes.reduce((sum, y, i) => sum + i * y, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    const fromDate = new Date(analysisCandles[0].timestamp);
    const toDate = new Date(analysisCandles[analysisCandles.length - 1].timestamp);

    return {
      currentPrice,
      priceChange,
      priceChangePercent,
      highestHigh,
      lowestLow,
      avgTrueRange,
      volatility,
      trend: slope > 0 ? "bullish" : "bearish",
      fromDate,
      toDate,
    };
  }, [analysisCandles]);

  const formatDateRange = () => {
    if (!candleStats) return "";
    const from = candleStats.fromDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const to = candleStats.toDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${from} - ${to}`;
  };

  const formatPrice = (price: number) => {
    if (!price) return "—";
    if (selectedPair.includes("JPY")) return price.toFixed(3);
    if (selectedPair.includes("BTC"))
      return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (selectedPair.includes("XAU")) return price.toFixed(2);
    if (selectedPair.includes("SPX") || selectedPair.includes("DXY")) return price.toFixed(2);
    return price.toFixed(5);
  };

  const formatDuration = (mins: number) => {
    if (!mins || mins === 0) return "—";
    if (mins < 60) return `${Math.round(mins)}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 1440)}d`;
  };

  const error = candleError || computeError;
  const isLoading = isLoadingCandles;
  const stats = computeResult?.stats;
  const filteredTrades = computeResult?.trades || [];

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Simple Settings Panel */}
      <SimpleSettingsPanel
        settings={settings}
        onChange={setSettings}
        onRun={runAnalysis}
        isComputing={isComputing}
        onCancel={cancel}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Header */}
        <header className="border-b border-gray-800 bg-gray-900">
          <div className="px-4 py-3">
            {/* Row 1: Pair/Timeframe + Actions */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Left: Pair & Timeframe selectors */}
              <div className="flex items-center gap-3">
                {/* Pair Selector */}
                <div className="relative">
                  <select
                    value={selectedPair}
                    onChange={(e) => handlePairChange(e.target.value)}
                    className="appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pr-8 text-sm font-medium text-gray-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {PAIRS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                {/* Timeframe Buttons */}
                <div className="flex rounded-lg overflow-hidden border border-gray-700">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.id}
                      onClick={() => handleTimeframeChange(tf.id)}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectedTimeframe === tf.id
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                      }`}
                    >
                      {tf.name}
                    </button>
                  ))}
                </div>
                {/* Current Price */}
                {candleStats && (
                  <span
                    className={`flex items-center gap-1 text-sm ${
                      candleStats.trend === "bullish" ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {candleStats.trend === "bullish" ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    {formatPrice(candleStats.currentPrice)}
                  </span>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={refetch}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Row 2: Date Range */}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-800">
              <Calendar className="w-4 h-4 text-gray-500" />
              <div className="flex gap-1">
                <button
                  onClick={() => setDatePreset(1)}
                  className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 transition-colors"
                >
                  1M
                </button>
                <button
                  onClick={() => setDatePreset(3)}
                  className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 transition-colors"
                >
                  3M
                </button>
                <button
                  onClick={() => setDatePreset(6)}
                  className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 transition-colors"
                >
                  6M
                </button>
                <button
                  onClick={() => setDatePreset(12)}
                  className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 transition-colors"
                >
                  1Y
                </button>
                <button
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, dateStart: null, dateEnd: null }))
                  }
                  className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded hover:bg-gray-700 transition-colors"
                >
                  All
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={settings.dateStart || ""}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, dateStart: e.target.value || null }))
                  }
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                />
                <span className="text-gray-500 text-xs">to</span>
                <input
                  type="date"
                  value={settings.dateEnd || ""}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, dateEnd: e.target.value || null }))
                  }
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                />
              </div>
              {(settings.dateStart || settings.dateEnd) && (
                <span className="text-xs text-purple-400">
                  {settings.dateStart || "..."} → {settings.dateEnd || "now"}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                <BarChart3 className="w-3 h-3" />
                <span>{candles.length.toLocaleString()} candles</span>
                {analysisCandles.length !== candles.length && (
                  <span className="text-gray-600">
                    ({analysisCandles.length.toLocaleString()} filtered)
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6">
          {/* Error State */}
          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-800/50 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-300 font-medium">Error</p>
                <p className="text-red-400/70 text-sm">{error}</p>
              </div>
              <button
                onClick={refetch}
                className="ml-auto px-3 py-1.5 bg-red-800/50 hover:bg-red-800 rounded-lg text-sm text-red-200 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <span className="text-gray-300">Loading historical candle data...</span>
                <span className="text-gray-500 text-sm">{loadProgress}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Computing State */}
          {isComputing && (
            <div className="mb-6 p-4 bg-purple-900/20 border border-purple-800/50 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <span className="text-purple-300">
                  {computeProgress.phase}: {computeProgress.pct}%
                </span>
              </div>
              <div className="h-2 bg-purple-900/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${computeProgress.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Data Stats */}
          {!isLoading && analysisCandles.length > 0 && (
            <>
              {/* Data Summary Bar */}
              <div className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-gray-400">
                    <BarChart3 className="w-4 h-4" />
                    <span className="text-gray-300 font-medium">
                      {analysisCandles.length.toLocaleString()}
                    </span>
                    <span>candles</span>
                    {analysisCandles.length !== candles.length && (
                      <span className="text-gray-500 text-sm">
                        (of {candles.length.toLocaleString()} total)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDateRange()}</span>
                  </div>
                  {stats && (
                    <div className="flex items-center gap-2 text-gray-400">
                      <Activity className="w-4 h-4 text-purple-400" />
                      <span className="text-purple-300">{stats.trades} trades simulated</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {stats ? (
                    <>
                      <Activity className="w-4 h-4 text-green-400" />
                      <span className="text-green-400 text-sm">Analysis Complete</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4 text-yellow-400" />
                      <span className="text-yellow-400 text-sm">Ready</span>
                    </>
                  )}
                </div>
              </div>

              {/* Price Statistics Grid */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Price Statistics
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <StatCard
                    label="Current Price"
                    value={formatPrice(candleStats?.currentPrice || 0)}
                    color="neutral"
                  />
                  <StatCard
                    label="Price Change"
                    value={`${(candleStats?.priceChange ?? 0) > 0 ? "+" : ""}${formatPrice(
                      candleStats?.priceChange ?? 0
                    )} (${(candleStats?.priceChangePercent ?? 0).toFixed(2)}%)`}
                    color={(candleStats?.priceChange ?? 0) >= 0 ? "positive" : "negative"}
                  />
                  <StatCard
                    label="Highest High"
                    value={formatPrice(candleStats?.highestHigh || 0)}
                    color="positive"
                  />
                  <StatCard
                    label="Lowest Low"
                    value={formatPrice(candleStats?.lowestLow || 0)}
                    color="negative"
                  />
                  <StatCard
                    label="Avg True Range"
                    value={formatPrice(candleStats?.avgTrueRange || 0)}
                    color="neutral"
                  />
                  <StatCard
                    label="Volatility"
                    value={`${(candleStats?.volatility ?? 0).toFixed(2)}%`}
                    color="purple"
                  />
                </div>
              </div>

              {/* Simulation Results */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Simulation Results
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Trades"
                    value={stats ? stats.trades.toString() : "—"}
                    color="neutral"
                  />
                  <StatCard
                    label="Win Rate"
                    value={stats ? `${(stats.winRate * 100).toFixed(1)}%` : "—%"}
                    color={stats && stats.winRate >= 0.5 ? "positive" : "negative"}
                  />
                  <StatCard
                    label="Profit Factor"
                    value={
                      stats
                        ? stats.profitFactor === Infinity
                          ? "∞"
                          : stats.profitFactor.toFixed(2)
                        : "—"
                    }
                    color={stats && stats.profitFactor > 1 ? "positive" : "negative"}
                  />
                  <StatCard
                    label="Total P&L"
                    value={stats ? `$${stats.totalPnl.toFixed(2)}` : "$—"}
                    color={stats && stats.totalPnl >= 0 ? "positive" : "negative"}
                  />
                </div>
              </div>

              {/* Extended Stats */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Extended Statistics
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <StatCard
                    label="Wins"
                    value={stats ? stats.wins.toString() : "—"}
                    color="positive"
                  />
                  <StatCard
                    label="Losses"
                    value={stats ? stats.losses.toString() : "—"}
                    color="negative"
                  />
                  <StatCard
                    label="Avg Win"
                    value={stats ? `$${stats.avgWin.toFixed(2)}` : "$—"}
                    color="positive"
                  />
                  <StatCard
                    label="Avg Loss"
                    value={stats ? `$${Math.abs(stats.avgLoss).toFixed(2)}` : "$—"}
                    color="negative"
                  />
                  <StatCard
                    label="Risk/Reward"
                    value={stats ? stats.rr.toFixed(2) : "—"}
                    color={stats && stats.rr > 1 ? "positive" : "neutral"}
                  />
                  <StatCard
                    label="Sharpe Ratio"
                    value={stats ? stats.sharpe.toFixed(2) : "—"}
                    color={stats && stats.sharpe > 0 ? "positive" : "neutral"}
                  />
                  <StatCard
                    label="Sortino Ratio"
                    value={stats ? stats.sortino.toFixed(2) : "—"}
                    color={stats && stats.sortino > 0 ? "positive" : "neutral"}
                  />
                  <StatCard
                    label="Avg P&L"
                    value={stats ? `$${stats.avgPnl.toFixed(2)}` : "$—"}
                    color={stats && stats.avgPnl >= 0 ? "positive" : "negative"}
                  />
                  <StatCard
                    label="Avg Win Duration"
                    value={stats ? formatDuration(stats.avgWinDurationMin) : "—"}
                    color="neutral"
                  />
                  <StatCard
                    label="Avg Loss Duration"
                    value={stats ? formatDuration(stats.avgLossDurationMin) : "—"}
                    color="neutral"
                  />
                  <StatCard
                    label="Best Trade"
                    value={
                      filteredTrades.length > 0
                        ? `$${Math.max(...filteredTrades.map((t) => t.pnl || 0)).toFixed(2)}`
                        : "$—"
                    }
                    color="positive"
                  />
                  <StatCard
                    label="Worst Trade"
                    value={
                      filteredTrades.length > 0
                        ? `$${Math.min(...filteredTrades.map((t) => t.pnl || 0)).toFixed(2)}`
                        : "$—"
                    }
                    color="negative"
                  />
                </div>
              </div>

              {/* Trade Analytics (replaces ClusterMap) */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Trade Analytics
                </h2>
                <TradeAnalytics trades={filteredTrades} onTradeClick={setSelectedTrade} />
              </div>

              {/* Trade List Preview */}
              {filteredTrades.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                    Recent Trades ({filteredTrades.length})
                  </h2>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-800/50">
                            <th className="px-4 py-3 text-left text-gray-400 font-medium">Entry</th>
                            <th className="px-4 py-3 text-left text-gray-400 font-medium">
                              Direction
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400 font-medium">
                              Entry Price
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400 font-medium">
                              Exit Price
                            </th>
                            <th className="px-4 py-3 text-right text-gray-400 font-medium">P&L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTrades
                            .slice(-10)
                            .reverse()
                            .map((trade, i) => (
                              <tr
                                key={trade.uid || i}
                                className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                                onClick={() => setSelectedTrade(trade)}
                              >
                                <td className="px-4 py-3 text-gray-300">{trade.entryTime}</td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                                      (trade.dir ?? 0) > 0
                                        ? "bg-green-900/50 text-green-400"
                                        : "bg-red-900/50 text-red-400"
                                    }`}
                                  >
                                    {(trade.dir ?? 0) > 0 ? "BUY" : "SELL"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                  {formatPrice(trade.entryPrice ?? 0)}
                                </td>
                                <td className="px-4 py-3 text-right text-gray-300">
                                  {formatPrice(trade.exitPrice ?? 0)}
                                </td>
                                <td
                                  className={`px-4 py-3 text-right font-medium ${
                                    (trade.pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                                  }`}
                                >
                                  ${(trade.pnl || 0).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Prop Firm Simulation */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                  Prop Firm Simulation
                </h2>
                <PropFirmSimulation trades={filteredTrades} parseMode="utc" />
              </div>
            </>
          )}

          {/* No Data State */}
          {!isLoading && !error && candles.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
              <div className="p-4 bg-gray-900 rounded-full mb-6">
                <AlertCircle className="w-12 h-12 text-yellow-500" />
              </div>
              <h2 className="text-xl font-semibold text-gray-200 mb-2">No Candle Data Available</h2>
              <p className="text-gray-500 max-w-md mb-6">
                No historical candle data was found for {formattedPair} on the {selectedTimeframe}{" "}
                timeframe. This could mean the data hasn&apos;t been ingested yet.
              </p>
              <button
                onClick={refetch}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Trade Details Modal */}
      {selectedTrade && (
        <TradeDetailsModal
          trade={selectedTrade}
          candles={candles}
          dollarsPerMove={fullSettings.dollarsPerMove}
          interval={selectedTimeframe}
          parseMode="utc"
          tpDist={Math.round(fullSettings.tpDollars / fullSettings.dollarsPerMove)}
          slDist={Math.round(fullSettings.slDollars / fullSettings.dollarsPerMove)}
          onClose={() => setSelectedTrade(null)}
          renderChart={(props) => (
            <div className="px-4 pb-4">
              <TradeCandlestickChart
                trade={props.trade}
                candles={props.candles}
                interval={props.interval}
                parseMode={props.parseMode}
                tpDist={props.tpDist}
                slDist={props.slDist}
                heightPx={props.heightPx}
              />
            </div>
          )}
        />
      )}
    </div>
  );
}
