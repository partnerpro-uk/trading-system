"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// OANDA granularity mapping (M1 removed - M5 is floor)
const TIMEFRAME_MAP: Record<string, string> = {
  M5: "M5",
  M15: "M15",
  M30: "M30",
  H1: "H1",
  H4: "H4",
  D: "D",
  W: "W",
  MN: "M", // Monthly - using MN to avoid confusion with M5, M15
};

// Supported pairs
export const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
] as const;

export type Pair = (typeof PAIRS)[number];

interface OandaCandle {
  time: string;
  mid: {
    o: string;
    h: string;
    l: string;
    c: string;
  };
  volume: number;
  complete: boolean;
}

interface OandaResponse {
  instrument: string;
  granularity: string;
  candles: OandaCandle[];
}

type FetchResult = { success: boolean; count: number; error?: string };

// Helper function to fetch and store candles
async function fetchAndStoreCandles(
  ctx: { runMutation: (ref: typeof internal.candles.upsertCandles, args: { candles: Array<{
    pair: string;
    timeframe: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    complete: boolean;
  }> }) => Promise<unknown> },
  pair: string,
  timeframe: string,
  count: number
): Promise<FetchResult> {
  const apiKey = process.env.OANDA_API_KEY;
  const apiUrl = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

  if (!apiKey) {
    return { success: false, count: 0, error: "OANDA_API_KEY not configured" };
  }

  const granularity = TIMEFRAME_MAP[timeframe];
  if (!granularity) {
    return { success: false, count: 0, error: `Invalid timeframe: ${timeframe}` };
  }

  const params = new URLSearchParams({
    granularity,
    count: String(count),
  });

  try {
    const response = await fetch(
      `${apiUrl}/v3/instruments/${pair}/candles?${params}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        count: 0,
        error: `OANDA API error: ${response.status} - ${errorText}`,
      };
    }

    const data: OandaResponse = await response.json();

    const candles = data.candles.map((c) => ({
      pair,
      timeframe,
      timestamp: new Date(c.time).getTime(),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
      complete: c.complete,
    }));

    if (candles.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < candles.length; i += batchSize) {
        const batch = candles.slice(i, i + batchSize);
        await ctx.runMutation(internal.candles.upsertCandles, { candles: batch });
      }
    }

    return { success: true, count: candles.length };
  } catch (error) {
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Fetch candles from OANDA and store them
export const fetchCandles = action({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FetchResult> => {
    return fetchAndStoreCandles(ctx, args.pair, args.timeframe, args.count || 500);
  },
});

// Fetch candles for all pairs (useful for initial load)
export const fetchAllPairs = action({
  args: {
    timeframe: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Record<string, FetchResult>> => {
    const results: Record<string, FetchResult> = {};

    for (const pair of PAIRS) {
      results[pair] = await fetchAndStoreCandles(
        ctx,
        pair,
        args.timeframe,
        args.count || 500
      );
    }

    return results;
  },
});

// Helper to fetch historical candles before a specific time
async function fetchHistoricalCandles(
  ctx: { runMutation: (ref: typeof internal.candles.upsertCandles, args: { candles: Array<{
    pair: string;
    timeframe: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    complete: boolean;
  }> }) => Promise<unknown> },
  pair: string,
  timeframe: string,
  beforeTimestamp: number,
  count: number
): Promise<FetchResult & { oldestTimestamp?: number }> {
  const apiKey = process.env.OANDA_API_KEY;
  const apiUrl = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

  if (!apiKey) {
    return { success: false, count: 0, error: "OANDA_API_KEY not configured" };
  }

  const granularity = TIMEFRAME_MAP[timeframe];
  if (!granularity) {
    return { success: false, count: 0, error: `Invalid timeframe: ${timeframe}` };
  }

  // Convert timestamp to RFC3339 format for OANDA
  const toTime = new Date(beforeTimestamp).toISOString();

  const params = new URLSearchParams({
    granularity,
    count: String(count),
    to: toTime,
  });

  try {
    const response = await fetch(
      `${apiUrl}/v3/instruments/${pair}/candles?${params}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        count: 0,
        error: `OANDA API error: ${response.status} - ${errorText}`,
      };
    }

    const data: OandaResponse = await response.json();

    const candles = data.candles.map((c) => ({
      pair,
      timeframe,
      timestamp: new Date(c.time).getTime(),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
      complete: c.complete,
    }));

    if (candles.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < candles.length; i += batchSize) {
        const batch = candles.slice(i, i + batchSize);
        await ctx.runMutation(internal.candles.upsertCandles, { candles: batch });
      }
    }

    return {
      success: true,
      count: candles.length,
      oldestTimestamp: candles.length > 0 ? candles[0].timestamp : undefined,
    };
  } catch (error) {
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Fetch older candles (for lazy loading when scrolling left)
export const fetchOlderCandles = action({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    beforeTimestamp: v.number(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FetchResult & { oldestTimestamp?: number }> => {
    return fetchHistoricalCandles(
      ctx,
      args.pair,
      args.timeframe,
      args.beforeTimestamp,
      args.count || 500
    );
  },
});

// Backfill historical data (fetches multiple batches going backwards)
export const backfillCandles = action({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    batches: v.optional(v.number()), // How many batches to fetch (each batch = 5000 candles max)
    candlesPerBatch: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; totalCount: number; batches: number; oldestTimestamp?: number }> => {
    const batches = args.batches || 5;
    const candlesPerBatch = Math.min(args.candlesPerBatch || 5000, 5000); // OANDA max is 5000

    let totalCount = 0;
    let currentToTime = Date.now();
    let batchesFetched = 0;
    let oldestTimestamp: number | undefined;

    for (let i = 0; i < batches; i++) {
      const result = await fetchHistoricalCandles(
        ctx,
        args.pair,
        args.timeframe,
        currentToTime,
        candlesPerBatch
      );

      if (!result.success || result.count === 0) {
        break;
      }

      totalCount += result.count;
      batchesFetched++;
      oldestTimestamp = result.oldestTimestamp;

      // Use the oldest timestamp from this batch as next "to" time
      if (result.oldestTimestamp) {
        currentToTime = result.oldestTimestamp;
      } else {
        break;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      success: totalCount > 0,
      totalCount,
      batches: batchesFetched,
      oldestTimestamp,
    };
  },
});

// Internal action for cron jobs - fetches latest candles for all pairs
export const fetchLatestCandles = internalAction({
  args: {
    timeframe: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; results: Record<string, { success: boolean; count: number }> }> => {
    const results: Record<string, { success: boolean; count: number }> = {};
    const count = args.count || 10;

    for (const pair of PAIRS) {
      const result = await fetchAndStoreCandles(ctx, pair, args.timeframe, count);
      results[pair] = { success: result.success, count: result.count };
    }

    const allSuccess = Object.values(results).every((r) => r.success);
    return { success: allSuccess, results };
  },
});
