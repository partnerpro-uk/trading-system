"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Massive.com API integration for external market data
// Uses Polygon.io backend - can fetch indices, stocks, crypto, and forex

const MASSIVE_API_BASE = "https://api.massive.com/v2";

interface MassiveCandle {
  t: number; // Timestamp (ms)
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
}

interface MassiveResponse {
  results?: MassiveCandle[];
  resultsCount?: number;
  status?: string;
  next_url?: string;
}

// Timeframe mapping for Massive API
const TIMEFRAME_MAP: Record<string, { multiplier: number; timespan: string }> = {
  M1: { multiplier: 1, timespan: "minute" },
  M5: { multiplier: 5, timespan: "minute" },
  M15: { multiplier: 15, timespan: "minute" },
  M30: { multiplier: 30, timespan: "minute" },
  H1: { multiplier: 1, timespan: "hour" },
  H2: { multiplier: 2, timespan: "hour" },
  H4: { multiplier: 4, timespan: "hour" },
  D: { multiplier: 1, timespan: "day" },
  W: { multiplier: 1, timespan: "week" },
  M: { multiplier: 1, timespan: "month" },
};

// Fetch candles from Massive.com API
export const fetchMassiveCandles = action({
  args: {
    ticker: v.string(), // e.g., "I:DXY" for Dollar Index, "C:EURUSD" for forex
    timeframe: v.string(), // M1, M5, M15, H1, H4, D, etc.
    from: v.optional(v.string()), // YYYY-MM-DD
    to: v.optional(v.string()), // YYYY-MM-DD
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) {
      throw new Error("MASSIVE_API_KEY not configured");
    }

    const tf = TIMEFRAME_MAP[args.timeframe];
    if (!tf) {
      throw new Error(`Unsupported timeframe: ${args.timeframe}`);
    }

    // Build URL
    const to = args.to || new Date().toISOString().split("T")[0];
    const from = args.from || "2002-01-01";
    const limit = args.limit || 5000;

    const url = `${MASSIVE_API_BASE}/aggs/ticker/${args.ticker}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}&apiKey=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Massive API error: ${response.status} - ${text}`);
    }

    const data: MassiveResponse = await response.json();

    if (!data.results || data.results.length === 0) {
      return { success: true, count: 0, message: "No data returned" };
    }

    // Transform and store candles
    const candles = data.results.map((c) => ({
      pair: args.ticker, // Store as-is (e.g., "I:DXY")
      timeframe: args.timeframe,
      timestamp: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v || 0,
      complete: true,
    }));

    // Store in batches of 500
    for (let i = 0; i < candles.length; i += 500) {
      const batch = candles.slice(i, i + 500);
      await ctx.runMutation(internal.candles.upsertCandles, { candles: batch });
    }

    return {
      success: true,
      count: candles.length,
      ticker: args.ticker,
      timeframe: args.timeframe,
      hasMore: !!data.next_url,
    };
  },
});

// Test API connection and available data
export const testMassiveConnection = action({
  args: {
    ticker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) {
      return { error: "MASSIVE_API_KEY not configured" };
    }

    // Test with a simple request
    const ticker = args.ticker || "C:EURUSD";
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    const url = `${MASSIVE_API_BASE}/aggs/ticker/${ticker}/range/1/day/${yesterday}/${today}?adjusted=true&limit=1&apiKey=${apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      return {
        status: response.status,
        ticker,
        available: response.ok && data.results?.length > 0,
        message: response.ok ? "Connection successful" : data.message || "Unknown error",
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
