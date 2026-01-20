"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Yahoo Finance API for DXY (US Dollar Index)
// Symbol: DX-Y.NYB (ICE US Dollar Index)

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

// Timeframe mapping to Yahoo Finance intervals
const TIMEFRAME_MAP: Record<string, { interval: string; maxRange: string }> = {
  M1: { interval: "1m", maxRange: "7d" }, // 1-minute only available for 7 days
  M5: { interval: "5m", maxRange: "60d" },
  M15: { interval: "15m", maxRange: "60d" },
  M30: { interval: "30m", maxRange: "60d" },
  H1: { interval: "60m", maxRange: "730d" }, // ~2 years
  H4: { interval: "60m", maxRange: "730d" }, // Will aggregate from H1
  D: { interval: "1d", maxRange: "max" },
  W: { interval: "1wk", maxRange: "max" },
  MN: { interval: "1mo", maxRange: "max" },
};

interface YahooCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YahooResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
        regularMarketPrice: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }>;
    error: { code: string; description: string } | null;
  };
}

// Fetch DXY candles from Yahoo Finance
export const fetchDXY = action({
  args: {
    timeframe: v.string(),
    range: v.optional(v.string()), // e.g., "1mo", "1y", "5y", "max"
  },
  handler: async (ctx, args) => {
    const tf = TIMEFRAME_MAP[args.timeframe];
    if (!tf) {
      return { success: false, count: 0, error: `Unsupported timeframe: ${args.timeframe}` };
    }

    const range = args.range || tf.maxRange;
    const symbol = "DX-Y.NYB";

    const url = `${YAHOO_BASE_URL}/${symbol}?interval=${tf.interval}&range=${range}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        return { success: false, count: 0, error: `Yahoo API error: ${response.status}` };
      }

      const data: YahooResponse = await response.json();

      if (data.chart.error) {
        return { success: false, count: 0, error: data.chart.error.description };
      }

      const result = data.chart.result[0];
      if (!result || !result.timestamp) {
        return { success: false, count: 0, error: "No data returned" };
      }

      const quotes = result.indicators.quote[0];
      const candles: YahooCandle[] = [];

      for (let i = 0; i < result.timestamp.length; i++) {
        // Skip if any OHLC value is null
        if (
          quotes.open[i] == null ||
          quotes.high[i] == null ||
          quotes.low[i] == null ||
          quotes.close[i] == null
        ) {
          continue;
        }

        candles.push({
          timestamp: result.timestamp[i] * 1000, // Convert to ms
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i] || 0,
        });
      }

      // Transform to our candle format
      const candlesToStore = candles.map((c) => ({
        pair: "DXY",
        timeframe: args.timeframe,
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        complete: true,
      }));

      // Store in batches
      for (let i = 0; i < candlesToStore.length; i += 100) {
        const batch = candlesToStore.slice(i, i + 100);
        await ctx.runMutation(internal.candles.upsertCandles, { candles: batch });
      }

      return {
        success: true,
        count: candlesToStore.length,
        timeframe: args.timeframe,
        oldestTimestamp: candlesToStore.length > 0 ? candlesToStore[0].timestamp : undefined,
        newestTimestamp: candlesToStore.length > 0 ? candlesToStore[candlesToStore.length - 1].timestamp : undefined,
      };
    } catch (error) {
      return {
        success: false,
        count: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Backfill DXY for all timeframes
export const backfillDXY = action({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, { success: boolean; count: number; error?: string }> = {};

    // Backfill each timeframe with appropriate range
    const timeframes = [
      { tf: "MN", range: "max" },
      { tf: "W", range: "max" },
      { tf: "D", range: "max" },
      { tf: "H1", range: "2y" },
      { tf: "M15", range: "60d" },
      { tf: "M5", range: "60d" },
      { tf: "M1", range: "7d" },
    ];

    for (const { tf, range } of timeframes) {
      console.log(`Backfilling DXY ${tf}...`);

      const tfConfig = TIMEFRAME_MAP[tf];
      const symbol = "DX-Y.NYB";
      const url = `${YAHOO_BASE_URL}/${symbol}?interval=${tfConfig.interval}&range=${range}`;

      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          results[tf] = { success: false, count: 0, error: `HTTP ${response.status}` };
          continue;
        }

        const data: YahooResponse = await response.json();

        if (data.chart.error) {
          results[tf] = { success: false, count: 0, error: data.chart.error.description };
          continue;
        }

        const result = data.chart.result[0];
        if (!result || !result.timestamp) {
          results[tf] = { success: false, count: 0, error: "No data" };
          continue;
        }

        const quotes = result.indicators.quote[0];
        const candlesToStore = [];

        for (let i = 0; i < result.timestamp.length; i++) {
          if (
            quotes.open[i] == null ||
            quotes.high[i] == null ||
            quotes.low[i] == null ||
            quotes.close[i] == null
          ) {
            continue;
          }

          candlesToStore.push({
            pair: "DXY",
            timeframe: tf,
            timestamp: result.timestamp[i] * 1000,
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i] || 0,
            complete: true,
          });
        }

        // Store in batches
        for (let i = 0; i < candlesToStore.length; i += 100) {
          const batch = candlesToStore.slice(i, i + 100);
          await ctx.runMutation(internal.candles.upsertCandles, { candles: batch });
        }

        results[tf] = { success: true, count: candlesToStore.length };

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        results[tf] = {
          success: false,
          count: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    return results;
  },
});

// Test Yahoo Finance connection
export const testYahoo = action({
  args: {},
  handler: async () => {
    const url = `${YAHOO_BASE_URL}/DX-Y.NYB?interval=1d&range=5d`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data: YahooResponse = await response.json();

      if (data.chart.error) {
        return { success: false, error: data.chart.error.description };
      }

      const result = data.chart.result[0];
      const latestPrice = result?.meta?.regularMarketPrice;

      return {
        success: true,
        symbol: "DX-Y.NYB",
        latestPrice,
        dataPoints: result?.timestamp?.length || 0,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Internal action for cron to fetch latest DXY candles
export const fetchLatestDXY = internalAction({
  args: {
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const tf = TIMEFRAME_MAP[args.timeframe];
    if (!tf) {
      console.error(`Unsupported DXY timeframe: ${args.timeframe}`);
      return { success: false, count: 0 };
    }

    // Fetch recent data only (1 week for D, 1 month for W, 3 months for MN)
    const rangeMap: Record<string, string> = {
      D: "5d",
      W: "1mo",
      MN: "3mo",
    };
    const range = rangeMap[args.timeframe] || "5d";
    const symbol = "DX-Y.NYB";
    const url = `${YAHOO_BASE_URL}/${symbol}?interval=${tf.interval}&range=${range}`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        console.error(`Yahoo API error for DXY: ${response.status}`);
        return { success: false, count: 0 };
      }

      const data: YahooResponse = await response.json();

      if (data.chart.error) {
        console.error(`Yahoo DXY error: ${data.chart.error.description}`);
        return { success: false, count: 0 };
      }

      const result = data.chart.result[0];
      if (!result || !result.timestamp) {
        return { success: false, count: 0 };
      }

      const quotes = result.indicators.quote[0];
      const candlesToStore = [];

      for (let i = 0; i < result.timestamp.length; i++) {
        if (
          quotes.open[i] == null ||
          quotes.high[i] == null ||
          quotes.low[i] == null ||
          quotes.close[i] == null
        ) {
          continue;
        }

        candlesToStore.push({
          pair: "DXY",
          timeframe: args.timeframe,
          timestamp: result.timestamp[i] * 1000,
          open: quotes.open[i],
          high: quotes.high[i],
          low: quotes.low[i],
          close: quotes.close[i],
          volume: quotes.volume[i] || 0,
          complete: true,
        });
      }

      if (candlesToStore.length > 0) {
        await ctx.runMutation(internal.candles.upsertCandles, { candles: candlesToStore });
      }

      console.log(`DXY ${args.timeframe}: fetched ${candlesToStore.length} candles`);
      return { success: true, count: candlesToStore.length };
    } catch (error) {
      console.error(`DXY fetch error: ${error}`);
      return { success: false, count: 0 };
    }
  },
});
