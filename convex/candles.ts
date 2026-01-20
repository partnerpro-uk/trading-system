import { mutation, query, internalMutation, internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Get candles for a pair and timeframe (most recent, up to limit)
export const getCandles = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    limit: v.optional(v.number()), // Default 8000, max 8000 (Convex array return limit is 8192)
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 8000, 8000);

    // Get the most recent candles by ordering desc and taking limit
    const candles = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .order("desc")
      .take(limit);

    // Return in chronological order (oldest first)
    return candles.reverse();
  },
});

// Get the latest candle for a pair and timeframe
export const getLatestCandle = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const candle = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .order("desc")
      .first();

    return candle;
  },
});

// Get stats for a pair and timeframe (oldest, newest, count)
export const getCandleStats = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const oldest = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .order("asc")
      .first();

    const newest = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .order("desc")
      .first();

    // Skip count to avoid 32k limit - just return date range
    return {
      pair: args.pair,
      timeframe: args.timeframe,
      oldest: oldest ? { timestamp: oldest.timestamp, date: new Date(oldest.timestamp).toISOString() } : null,
      newest: newest ? { timestamp: newest.timestamp, date: new Date(newest.timestamp).toISOString() } : null,
    };
  },
});

// Internal mutation for upserting candles (called from actions)
export const upsertCandle = internalMutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    timestamp: v.number(),
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    volume: v.number(),
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check if candle already exists
    const existing = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q
          .eq("pair", args.pair)
          .eq("timeframe", args.timeframe)
          .eq("timestamp", args.timestamp)
      )
      .first();

    if (existing) {
      // Update existing candle
      await ctx.db.patch(existing._id, {
        open: args.open,
        high: args.high,
        low: args.low,
        close: args.close,
        volume: args.volume,
        complete: args.complete,
      });
      return existing._id;
    } else {
      // Insert new candle
      const id = await ctx.db.insert("candles", {
        pair: args.pair,
        timeframe: args.timeframe,
        timestamp: args.timestamp,
        open: args.open,
        high: args.high,
        low: args.low,
        close: args.close,
        volume: args.volume,
        complete: args.complete,
      });
      return id;
    }
  },
});

// Batch upsert candles (for efficiency when loading historical data)
export const upsertCandles = internalMutation({
  args: {
    candles: v.array(
      v.object({
        pair: v.string(),
        timeframe: v.string(),
        timestamp: v.number(),
        open: v.number(),
        high: v.number(),
        low: v.number(),
        close: v.number(),
        volume: v.number(),
        complete: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results = [];

    for (const candle of args.candles) {
      const existing = await ctx.db
        .query("candles")
        .withIndex("by_pair_tf_time", (q) =>
          q
            .eq("pair", candle.pair)
            .eq("timeframe", candle.timeframe)
            .eq("timestamp", candle.timestamp)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          complete: candle.complete,
        });
        results.push(existing._id);
      } else {
        const id = await ctx.db.insert("candles", candle);
        results.push(id);
      }
    }

    return results;
  },
});

// Get candle count for a pair/timeframe (returns actual count up to 30000)
export const getCandleCount = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    // Take up to 30001 to check if there are more than 30000
    const candles = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .take(30001);

    return candles.length;
  },
});

// Get the oldest candle timestamp for a pair/timeframe
export const getOldestCandle = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const candle = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .order("asc")
      .first();

    return candle;
  },
});

// Delete candles for a pair in batches (call multiple times until hasMore is false)
export const deleteCandlesByPair = mutation({
  args: {
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete up to 500 candles per call to stay under Convex limits
    const candles = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf", (q) => q.eq("pair", args.pair))
      .take(500);

    for (const candle of candles) {
      await ctx.db.delete(candle._id);
    }

    // Check if there are more
    const remaining = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf", (q) => q.eq("pair", args.pair))
      .first();

    return { deleted: candles.length, pair: args.pair, hasMore: remaining !== null };
  },
});

// Delete candles by pair and timeframe in batches (call multiple times until hasMore is false)
export const deleteCandlesByPairAndTimeframe = mutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete up to 500 candles per call to stay under Convex limits
    const candles = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .take(500);

    for (const candle of candles) {
      await ctx.db.delete(candle._id);
    }

    // Check if there are more for this pair/timeframe
    const remaining = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      )
      .first();

    return {
      deleted: candles.length,
      pair: args.pair,
      timeframe: args.timeframe,
      hasMore: remaining !== null
    };
  },
});

// Get candles with pagination (for lazy loading)
export const getCandlesPaginated = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    before: v.optional(v.number()), // Timestamp to fetch before (for loading older data)
    after: v.optional(v.number()), // Timestamp to fetch after (for loading newer data)
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500;

    let query = ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", args.timeframe)
      );

    // If fetching older data (before a timestamp), order descending to get newest of the old
    if (args.before) {
      const candles = await query
        .order("desc")
        .filter((q) => q.lt(q.field("timestamp"), args.before!))
        .take(limit);
      // Return in ascending order
      return candles.reverse();
    }

    // If fetching newer data (after a timestamp)
    if (args.after) {
      const candles = await query
        .order("asc")
        .filter((q) => q.gt(q.field("timestamp"), args.after!))
        .take(limit);
      return candles;
    }

    // Default: get most recent candles
    const candles = await query.order("desc").take(limit);
    return candles.reverse();
  },
});

// 13-month retention for M5 candles (in milliseconds)
const M5_RETENTION_MS = 13 * 30 * 24 * 60 * 60 * 1000; // ~13 months

// Internal mutation to delete old M5 candles for a single pair
export const deleteOldM5ForPair = internalMutation({
  args: {
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - M5_RETENTION_MS;

    // Get oldest M5 candles first (up to 500) and filter by timestamp
    // Use index range to avoid full scan
    const candidates = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", "M5").lt("timestamp", cutoffTime)
      )
      .order("asc")
      .take(500);

    for (const candle of candidates) {
      await ctx.db.delete(candle._id);
    }

    // Check if there are more old candles using same indexed range
    const remaining = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", "M5").lt("timestamp", cutoffTime)
      )
      .first();

    return {
      pair: args.pair,
      deleted: candidates.length,
      hasMore: remaining !== null,
    };
  },
});

// Supported pairs for cleanup
const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
] as const;

// Internal action to clean up old M5 candles for all pairs (runs in parallel)
export const cleanupOldM5 = internalAction({
  args: {},
  handler: async (ctx): Promise<{ results: Record<string, { deleted: number }> }> => {
    const cleanupPair = async (pair: string): Promise<{ pair: string; deleted: number }> => {
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await ctx.runMutation(internal.candles.deleteOldM5ForPair, { pair });
        totalDeleted += result.deleted;
        hasMore = result.hasMore;
        if (result.deleted === 0) break;
      }

      return { pair, deleted: totalDeleted };
    };

    const resultsArray = await Promise.all(PAIRS.map(pair => cleanupPair(pair)));

    const results: Record<string, { deleted: number }> = {};
    for (const { pair, deleted } of resultsArray) {
      results[pair] = { deleted };
    }

    return { results };
  },
});

// Public action to manually trigger M5 cleanup (all pairs in parallel)
export const runM5Cleanup = action({
  args: {},
  handler: async (ctx): Promise<{ results: Record<string, { deleted: number }> }> => {
    // Run all pairs in parallel
    const cleanupPair = async (pair: string): Promise<{ pair: string; deleted: number }> => {
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await ctx.runMutation(internal.candles.deleteOldM5ForPair, { pair });
        totalDeleted += result.deleted;
        hasMore = result.hasMore;
        if (result.deleted === 0) break;
      }

      return { pair, deleted: totalDeleted };
    };

    const resultsArray = await Promise.all(PAIRS.map(pair => cleanupPair(pair)));

    const results: Record<string, { deleted: number }> = {};
    for (const { pair, deleted } of resultsArray) {
      results[pair] = { deleted };
    }

    return { results };
  },
});

// Public action for uploading candles from external scripts (e.g., Dukascopy backfill)
export const uploadCandles = action({
  args: {
    candles: v.array(
      v.object({
        pair: v.string(),
        timeframe: v.string(),
        timestamp: v.number(),
        open: v.number(),
        high: v.number(),
        low: v.number(),
        close: v.number(),
        volume: v.number(),
        complete: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.candles.upsertCandles, { candles: args.candles });
    return { uploaded: args.candles.length };
  },
});
