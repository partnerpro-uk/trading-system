"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Play, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, BarChart3 } from "lucide-react";
import type { Trade } from "../../lib/analysis/types";

interface PropFirmConfig {
  initBalance: number;
  dailyMaxLoss: number;
  totalMaxLoss: number;
  profitTarget: number;
}

interface SimulationResult {
  probability: number;
  data: number[];
}

interface SimulationStats {
  avgTradesPass: number;
  avgTradesFail: number;
  avgTimePass: number;
  avgTimeFail: number;
  avgWinRatePass: number;
  avgWinRateFail: number;
  avgWinRateOverall: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  totalSimulations: number;
}

interface PropFirmSimulationProps {
  trades: Trade[];
  parseMode?: "utc" | "local";
}

// Default prop firm configurations for popular firms
const PROP_FIRM_PRESETS: Record<string, PropFirmConfig> = {
  "FTMO 100K": { initBalance: 100000, dailyMaxLoss: 5000, totalMaxLoss: 10000, profitTarget: 10000 },
  "FTMO 200K": { initBalance: 200000, dailyMaxLoss: 10000, totalMaxLoss: 20000, profitTarget: 20000 },
  "MyFundedFX 100K": { initBalance: 100000, dailyMaxLoss: 5000, totalMaxLoss: 8000, profitTarget: 8000 },
  "Funded Next 100K": { initBalance: 100000, dailyMaxLoss: 3000, totalMaxLoss: 6000, profitTarget: 10000 },
  "Custom": { initBalance: 100000, dailyMaxLoss: 5000, totalMaxLoss: 10000, profitTarget: 10000 },
};

export function PropFirmSimulation({ trades, parseMode = "utc" }: PropFirmSimulationProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("FTMO 100K");
  const [config, setConfig] = useState<PropFirmConfig>(PROP_FIRM_PRESETS["FTMO 100K"]);
  const [method, setMethod] = useState<"montecarlo" | "historical">("montecarlo");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [stats, setStats] = useState<SimulationStats | null>(null);

  // Update config when preset changes
  const handlePresetChange = useCallback((preset: string) => {
    setSelectedPreset(preset);
    if (preset !== "Custom") {
      setConfig(PROP_FIRM_PRESETS[preset]);
    }
  }, []);

  // Update individual config value (switches to Custom)
  const updateConfig = useCallback((key: keyof PropFirmConfig, value: number) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSelectedPreset("Custom");
  }, []);

  // Get trade PnLs
  const tradePnls = useMemo(() => {
    return trades
      .filter(t => !t.isOpen)
      .map(t => t.pnl ?? 0);
  }, [trades]);

  // Run Monte Carlo simulation
  const runMonteCarlo = useCallback(() => {
    if (tradePnls.length === 0) {
      setResult(null);
      setStats(null);
      return;
    }

    const { initBalance, dailyMaxLoss, totalMaxLoss, profitTarget } = config;
    const sims = 2000;
    const scalingFactor = 500;

    let passCount = 0;
    let failCount = 0;
    let incompleteCount = 0;
    let sumTradesPass = 0;
    let sumTradesFail = 0;
    let sumWinRatePass = 0;
    let sumWinRateFail = 0;
    let sumWinRateOverall = 0;
    const finals: number[] = [];

    for (let s = 0; s < sims; s++) {
      let balance = initBalance;
      let tradeCount = 0;
      let wins = 0;
      let achievedTarget = false;
      let failed = false;

      // Shuffle trades randomly for each simulation
      for (let i = 0; i < tradePnls.length; i++) {
        tradeCount++;
        const randIndex = Math.floor(Math.random() * tradePnls.length);
        const pnl = tradePnls[randIndex];
        if (pnl > 0) wins++;
        balance += pnl;

        // Check total drawdown
        const drawdown = initBalance - balance;
        if (totalMaxLoss > 0 && drawdown > totalMaxLoss) {
          failed = true;
          break;
        }

        // Check profit target
        if (balance - initBalance >= profitTarget) {
          achievedTarget = true;
          break;
        }
      }

      const winRate = tradeCount > 0 ? wins / tradeCount : 0;
      sumWinRateOverall += winRate;

      if (achievedTarget) {
        passCount++;
        sumTradesPass += tradeCount;
        sumWinRatePass += winRate;
      } else if (failed) {
        failCount++;
        sumTradesFail += tradeCount;
        sumWinRateFail += winRate;
      } else {
        incompleteCount++;
      }

      finals.push(balance - initBalance);
    }

    const considered = passCount + failCount;
    const probability = considered > 0 ? passCount / considered : 0;

    setResult({ probability, data: finals });
    setStats({
      avgTradesPass: passCount > 0 ? sumTradesPass / passCount : 0,
      avgTradesFail: failCount > 0 ? sumTradesFail / failCount : 0,
      avgTimePass: 0,
      avgTimeFail: 0,
      avgWinRatePass: passCount > 0 ? sumWinRatePass / passCount : 0,
      avgWinRateFail: failCount > 0 ? sumWinRateFail / failCount : 0,
      avgWinRateOverall: sims > 0 ? sumWinRateOverall / sims : 0,
      passCount: passCount * scalingFactor,
      failCount: failCount * scalingFactor,
      incompleteCount: incompleteCount * scalingFactor,
      totalSimulations: sims * scalingFactor,
    });
  }, [tradePnls, config]);

  // Run Historical simulation
  const runHistorical = useCallback(() => {
    if (trades.length === 0) {
      setResult(null);
      setStats(null);
      return;
    }

    const { initBalance, dailyMaxLoss, totalMaxLoss, profitTarget } = config;

    // Sort trades by entry time
    const sortedTrades = [...trades].sort((a, b) => {
      const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0;
      const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0;
      return ta - tb;
    });

    // Get unique start dates
    const startDates = new Set<string>();
    for (const t of sortedTrades) {
      if (t.entryTime) {
        const d = new Date(t.entryTime);
        startDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      }
    }

    let passCount = 0;
    let failCount = 0;
    let incompleteCount = 0;
    let sumTradesPass = 0;
    let sumTradesFail = 0;
    let sumTimePass = 0;
    let sumTimeFail = 0;
    let sumWinRatePass = 0;
    let sumWinRateFail = 0;
    let sumWinRateOverall = 0;
    const finals: number[] = [];

    // Run simulation for each possible start date
    const startDateArray = Array.from(startDates);
    for (const startKey of startDateArray) {
      const [year, month, day] = startKey.split("-").map(Number);
      const startDate = new Date(year, month, day);

      let balance = initBalance;
      let dailyPnl = 0;
      let currentDay = startKey;
      let tradeCount = 0;
      let wins = 0;
      let achievedTarget = false;
      let failed = false;
      let startTime: number | null = null;
      let endTime: number | null = null;

      for (const t of sortedTrades) {
        if (!t.entryTime) continue;
        const tradeDate = new Date(t.entryTime);
        if (tradeDate < startDate) continue;

        const tradeDay = `${tradeDate.getFullYear()}-${tradeDate.getMonth()}-${tradeDate.getDate()}`;

        // Reset daily PnL on new day
        if (tradeDay !== currentDay) {
          currentDay = tradeDay;
          dailyPnl = 0;
        }

        const pnl = t.isOpen ? (t.unrealizedPnl ?? 0) : (t.pnl ?? 0);
        tradeCount++;
        if (pnl > 0) wins++;
        dailyPnl += pnl;
        balance += pnl;

        if (!startTime) startTime = tradeDate.getTime();
        endTime = tradeDate.getTime();

        // Check daily loss
        if (dailyMaxLoss > 0 && dailyPnl < -dailyMaxLoss) {
          failed = true;
          break;
        }

        // Check total drawdown
        if (totalMaxLoss > 0 && initBalance - balance > totalMaxLoss) {
          failed = true;
          break;
        }

        // Check profit target
        if (balance - initBalance >= profitTarget) {
          achievedTarget = true;
          break;
        }
      }

      if (tradeCount === 0) continue;

      const timeSpent = startTime && endTime ? (endTime - startTime) / 60000 : 0;
      const winRate = tradeCount > 0 ? wins / tradeCount : 0;
      sumWinRateOverall += winRate;

      if (achievedTarget) {
        passCount++;
        sumTradesPass += tradeCount;
        sumTimePass += timeSpent;
        sumWinRatePass += winRate;
      } else if (failed) {
        failCount++;
        sumTradesFail += tradeCount;
        sumTimeFail += timeSpent;
        sumWinRateFail += winRate;
      } else {
        incompleteCount++;
      }

      finals.push(balance - initBalance);
    }

    const considered = passCount + failCount;
    const probability = considered > 0 ? passCount / considered : 0;

    setResult({ probability, data: finals });
    setStats({
      avgTradesPass: passCount > 0 ? sumTradesPass / passCount : 0,
      avgTradesFail: failCount > 0 ? sumTradesFail / failCount : 0,
      avgTimePass: passCount > 0 ? sumTimePass / passCount : 0,
      avgTimeFail: failCount > 0 ? sumTimeFail / failCount : 0,
      avgWinRatePass: passCount > 0 ? sumWinRatePass / passCount : 0,
      avgWinRateFail: failCount > 0 ? sumWinRateFail / failCount : 0,
      avgWinRateOverall: considered + incompleteCount > 0
        ? sumWinRateOverall / (considered + incompleteCount)
        : 0,
      passCount,
      failCount,
      incompleteCount,
      totalSimulations: considered + incompleteCount,
    });
  }, [trades, config]);

  // Run simulation based on method
  const runSimulation = useCallback(async () => {
    setIsRunning(true);
    // Small delay to show loading state
    await new Promise(resolve => setTimeout(resolve, 50));

    if (method === "montecarlo") {
      runMonteCarlo();
    } else {
      runHistorical();
    }

    setIsRunning(false);
  }, [method, runMonteCarlo, runHistorical]);

  // Histogram data
  const histogram = useMemo(() => {
    if (!result?.data || result.data.length === 0) return [];

    const arr = result.data;
    let min = Math.min(...arr);
    let max = Math.max(...arr);

    if (min === max) {
      return [{ bin: min, count: arr.length, isPositive: min >= 0 }];
    }

    const numBins = 20;
    const binWidth = (max - min) / numBins;
    const bins: { bin: number; count: number; isPositive: boolean }[] = [];

    for (let i = 0; i < numBins; i++) {
      const binStart = min + i * binWidth;
      const binEnd = binStart + binWidth;
      const count = arr.filter(v => v >= binStart && (i === numBins - 1 ? v <= binEnd : v < binEnd)).length;
      bins.push({
        bin: binStart + binWidth / 2,
        count,
        isPositive: binStart + binWidth / 2 >= 0,
      });
    }

    return bins;
  }, [result]);

  const maxCount = useMemo(() => Math.max(...histogram.map(h => h.count), 1), [histogram]);

  // Format duration
  const formatDuration = (mins: number) => {
    if (!mins || mins < 0) return "0m";
    const h = Math.floor(mins / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${Math.round(mins % 60)}m`;
    return `${Math.round(mins)}m`;
  };

  if (!isExpanded) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            <span className="font-medium text-gray-200">Prop Firm Simulation</span>
          </div>
          <span className="text-xs text-gray-500">Click to expand</span>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(false)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors border-b border-gray-800"
      >
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-purple-400" />
          <span className="font-medium text-gray-200">Prop Firm Simulation</span>
        </div>
        <span className="text-xs text-gray-500">Click to collapse</span>
      </button>

      <div className="p-4">
        {trades.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No trades available for simulation</p>
          </div>
        ) : (
          <>
            {/* Preset Selector */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-2">Prop Firm Preset</label>
              <select
                value={selectedPreset}
                onChange={e => handlePresetChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {Object.keys(PROP_FIRM_PRESETS).map(preset => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
              </select>
            </div>

            {/* Configuration Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Initial Balance</label>
                <input
                  type="number"
                  value={config.initBalance}
                  onChange={e => updateConfig("initBalance", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Daily Max Loss</label>
                <input
                  type="number"
                  value={config.dailyMaxLoss}
                  onChange={e => updateConfig("dailyMaxLoss", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Total Max Loss</label>
                <input
                  type="number"
                  value={config.totalMaxLoss}
                  onChange={e => updateConfig("totalMaxLoss", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Profit Target</label>
                <input
                  type="number"
                  value={config.profitTarget}
                  onChange={e => updateConfig("profitTarget", Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Method & Run */}
            <div className="flex items-center gap-3 mb-4">
              <label className="text-xs text-gray-400">Method:</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMethod("montecarlo")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    method === "montecarlo"
                      ? "bg-purple-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  Monte Carlo
                </button>
                <button
                  onClick={() => setMethod("historical")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    method === "historical"
                      ? "bg-purple-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  Historical
                </button>
              </div>
              <button
                onClick={runSimulation}
                disabled={isRunning}
                className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {isRunning ? "Running..." : "Run"}
              </button>
            </div>

            {/* Results */}
            {result && (
              <div className="space-y-4">
                {/* Pass Probability */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-800/50">
                  <div className={`p-3 rounded-full ${result.probability >= 0.5 ? "bg-green-900/50" : "bg-red-900/50"}`}>
                    {result.probability >= 0.5
                      ? <CheckCircle className="w-6 h-6 text-green-400" />
                      : <XCircle className="w-6 h-6 text-red-400" />
                    }
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Probability of Passing</div>
                    <div className={`text-3xl font-bold ${result.probability >= 0.5 ? "text-green-400" : "text-red-400"}`}>
                      {(result.probability * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                {stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Avg Trades to Pass</div>
                      <div className="text-lg font-semibold text-blue-400">
                        {stats.avgTradesPass.toFixed(1)}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Avg Trades to Fail</div>
                      <div className="text-lg font-semibold text-orange-400">
                        {stats.avgTradesFail.toFixed(1)}
                      </div>
                    </div>
                    {method === "historical" && (
                      <>
                        <div className="p-3 rounded-lg bg-gray-800/50">
                          <div className="text-xs text-gray-400">Avg Time to Pass</div>
                          <div className="text-lg font-semibold text-blue-400">
                            {formatDuration(stats.avgTimePass)}
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-800/50">
                          <div className="text-xs text-gray-400">Avg Time to Fail</div>
                          <div className="text-lg font-semibold text-orange-400">
                            {formatDuration(stats.avgTimeFail)}
                          </div>
                        </div>
                      </>
                    )}
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Pass Simulations</div>
                      <div className="text-lg font-semibold text-green-400">
                        {stats.passCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Fail Simulations</div>
                      <div className="text-lg font-semibold text-red-400">
                        {stats.failCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Win Rate (Passes)</div>
                      <div className={`text-lg font-semibold ${stats.avgWinRatePass >= 0.5 ? "text-green-400" : "text-red-400"}`}>
                        {(stats.avgWinRatePass * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-800/50">
                      <div className="text-xs text-gray-400">Win Rate (Fails)</div>
                      <div className={`text-lg font-semibold ${stats.avgWinRateFail >= 0.5 ? "text-green-400" : "text-red-400"}`}>
                        {(stats.avgWinRateFail * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Histogram */}
                {histogram.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-400 mb-2">P&L Distribution</div>
                    <div className="h-32 flex items-end gap-0.5">
                      {histogram.map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 transition-all duration-200"
                          style={{ height: `${(h.count / maxCount) * 100}%` }}
                        >
                          <div
                            className={`w-full h-full rounded-t ${h.isPositive ? "bg-green-500/70" : "bg-red-500/70"}`}
                            title={`$${h.bin.toFixed(0)}: ${h.count} simulations`}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-500">
                      <span>${Math.min(...result.data).toFixed(0)}</span>
                      <span>$0</span>
                      <span>${Math.max(...result.data).toFixed(0)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default PropFirmSimulation;
