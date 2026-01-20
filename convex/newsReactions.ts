import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { NEWS_PAIRS } from "./newsEvents";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Pip values for each pair
const PIP_VALUES: Record<string, number> = {
  EUR_USD: 0.0001,
  GBP_USD: 0.0001,
  USD_JPY: 0.01,
  USD_CHF: 0.0001,
  AUD_USD: 0.0001,
  USD_CAD: 0.0001,
  NZD_USD: 0.0001,
};

// Pattern types
type PatternType = "spike_reversal" | "continuation" | "fade" | "range";

// Type for events with windows
interface EventWithTimestamp {
  eventId: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES

/**
 * Get candle windows that don't have reactions calculated yet
 */
export const getWindowsNeedingReactions = query({
  args: { limit: v.optional(v.number()), offset: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    const offset = args.offset || 0;

    // Get windows ordered newest first
    const windows = await ctx.db
      .query("eventCandleWindows")
      .order("desc")
      .take(offset + limit * 3);

    const toCheck = windows.slice(offset);

    // Check which don't have reactions
    const needsReaction = [];
    for (const window of toCheck) {
      if (needsReaction.length >= limit) break;

      const existingReaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_event", (q) => q.eq("eventId", window.eventId))
        .filter((q) => q.eq(q.field("pair"), window.pair))
        .first();

      if (!existingReaction) {
        needsReaction.push({
          eventId: window.eventId,
          pair: window.pair,
          eventTimestamp: window.eventTimestamp,
        });
      }
    }

    return needsReaction;
  },
});
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get candle window for reaction calculation (internal use)
 */
export const getCandleWindow = internalQuery({
  args: {
    eventId: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();
  },
});

/**
 * Get reaction for an event and pair
 */
export const getReaction = query({
  args: {
    eventId: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eventPriceReactions")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();
  },
});

/**
 * Get all reactions for an event type and pair (for statistics)
 */
export const getReactionsForType = query({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    // First get all events of this type
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_type", (q) => q.eq("eventType", args.eventType))
      .collect();

    // Then get reactions for each event
    const reactions = [];
    for (const event of events) {
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      if (reaction) {
        reactions.push(reaction);
      }
    }

    return reactions;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store a calculated price reaction
 */
export const storeReaction = internalMutation({
  args: {
    eventId: v.string(),
    pair: v.string(),
    eventTimestamp: v.number(),
    priceAtMinus15m: v.number(),
    priceAtMinus5m: v.number(),
    priceAtMinus1m: v.number(),
    priceAtEvent: v.number(),
    spikeHigh: v.number(),
    spikeLow: v.number(),
    spikeDirection: v.string(),
    spikeMagnitudePips: v.number(),
    timeToSpikeSec: v.optional(v.number()),
    priceAtPlus5m: v.number(),
    priceAtPlus15m: v.number(),
    priceAtPlus30m: v.number(),
    priceAtPlus1hr: v.number(),
    priceAtPlus3hr: v.optional(v.number()),
    patternType: v.string(),
    didReverse: v.boolean(),
    reversalMagnitudePips: v.optional(v.number()),
    finalDirectionMatchesSpike: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check for existing reaction
    const existing = await ctx.db
      .query("eventPriceReactions")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("eventPriceReactions", args);
  },
});

/**
 * Public mutation for uploading locally-calculated reactions
 * Used by scripts/calculate-reactions-local.ts for bulk uploads
 */
export const uploadReaction = mutation({
  args: {
    eventId: v.string(),
    pair: v.string(),
    eventTimestamp: v.number(),
    priceAtMinus15m: v.number(),
    priceAtMinus5m: v.number(),
    priceAtMinus1m: v.number(),
    priceAtEvent: v.number(),
    spikeHigh: v.number(),
    spikeLow: v.number(),
    spikeDirection: v.string(),
    spikeMagnitudePips: v.number(),
    timeToSpikeSec: v.optional(v.number()),
    priceAtPlus5m: v.number(),
    priceAtPlus15m: v.number(),
    priceAtPlus30m: v.number(),
    priceAtPlus1hr: v.number(),
    priceAtPlus3hr: v.optional(v.number()),
    patternType: v.string(),
    didReverse: v.boolean(),
    reversalMagnitudePips: v.optional(v.number()),
    finalDirectionMatchesSpike: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check for existing reaction
    const existing = await ctx.db
      .query("eventPriceReactions")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("eventPriceReactions", args);
    return { updated: false, id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate price reaction for a single event + pair
 */
export const calculateReaction = internalAction({
  args: {
    eventId: v.string(),
    pair: v.string(),
    eventTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Get the candle window
    const window = await ctx.runQuery(internal.newsReactions.getCandleWindow, {
      eventId: args.eventId,
      pair: args.pair,
    });

    if (!window || window.candles.length < 10) {
      return { success: false, error: "Insufficient candle data (need 10+)" };
    }

    const candles = window.candles as CandleData[];
    const pipValue = PIP_VALUES[args.pair] || 0.0001;
    const eventTime = args.eventTimestamp;

    // Helper to find candle at specific offset (within 3 minutes tolerance)
    const candleAt = (offsetMinutes: number): CandleData | undefined => {
      const targetTime = eventTime + offsetMinutes * 60 * 1000;
      return candles.find((c) => Math.abs(c.timestamp - targetTime) < 180000);
    };

    // Helper to find closest candle to a target time
    const closestCandleTo = (targetTime: number): CandleData | undefined => {
      let closest: CandleData | undefined;
      let closestDiff = Infinity;
      for (const c of candles) {
        const diff = Math.abs(c.timestamp - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closest = c;
        }
      }
      // Only return if within 5 minutes
      return closestDiff < 300000 ? closest : undefined;
    };

    // Get key candles
    const preMinus15 = candleAt(-15);
    const preMinus5 = candleAt(-5);
    const preMinus1 = candleAt(-1);
    let atEvent = candleAt(0);
    const plus5 = candleAt(5);
    const plus15 = candleAt(15);
    const plus30 = candleAt(30);
    const plus60 = candleAt(60);

    // Fallback: use closest candle to event time if exact match not found
    if (!atEvent) {
      atEvent = closestCandleTo(eventTime);
    }

    if (!atEvent) {
      return { success: false, error: "Missing event candle" };
    }

    // Use fallbacks if pre-event candles are missing
    const effectiveMinus5 = preMinus5 || preMinus15 || atEvent;
    const effectiveMinus15 = preMinus15 || preMinus5 || atEvent;

    // Calculate spike (first 5 candles around event)
    // Allow 2-minute buffer before event to handle candle timestamp offsets
    const spikeCandles = candles.filter(
      (c) =>
        c.timestamp >= eventTime - 2 * 60 * 1000 && c.timestamp <= eventTime + 5 * 60 * 1000
    );

    if (spikeCandles.length === 0) {
      return { success: false, error: "No spike candles found" };
    }

    const spikeHigh = Math.max(...spikeCandles.map((c) => c.high));
    const spikeLow = Math.min(...spikeCandles.map((c) => c.low));

    const upMove = (spikeHigh - atEvent.open) / pipValue;
    const downMove = (atEvent.open - spikeLow) / pipValue;

    const spikeDirection = upMove > downMove ? "UP" : "DOWN";
    const spikeMagnitudePips = Math.round(Math.max(upMove, downMove) * 10) / 10;

    // Find time to spike peak
    let timeToSpikeSec: number | undefined;
    const spikeTarget = spikeDirection === "UP" ? spikeHigh : spikeLow;
    for (const candle of spikeCandles) {
      if (spikeDirection === "UP" && candle.high === spikeHigh) {
        timeToSpikeSec = Math.round((candle.timestamp - eventTime) / 1000);
        break;
      }
      if (spikeDirection === "DOWN" && candle.low === spikeLow) {
        timeToSpikeSec = Math.round((candle.timestamp - eventTime) / 1000);
        break;
      }
    }

    // Settlement prices
    const priceAtPlus5m = plus5?.close || atEvent.close;
    const priceAtPlus15m = plus15?.close || priceAtPlus5m;
    const priceAtPlus30m = plus30?.close || priceAtPlus15m;
    const priceAtPlus1hr = plus60?.close || priceAtPlus30m;

    // Determine reversal
    // A reversal occurs when price moves back past event open by at least 50% of spike
    const reversalThreshold = spikeMagnitudePips * 0.5;
    let didReverse = false;
    let reversalMagnitudePips: number | undefined;

    if (spikeDirection === "UP") {
      // For up spike, check if price pulled back from high
      const pullback = (spikeHigh - priceAtPlus30m) / pipValue;
      didReverse = pullback > reversalThreshold;
      if (didReverse) {
        reversalMagnitudePips = Math.round(pullback * 10) / 10;
      }
    } else {
      // For down spike, check if price recovered from low
      const pullback = (priceAtPlus30m - spikeLow) / pipValue;
      didReverse = pullback > reversalThreshold;
      if (didReverse) {
        reversalMagnitudePips = Math.round(pullback * 10) / 10;
      }
    }

    // Final direction matches spike?
    const finalMove = (priceAtPlus1hr - atEvent.open) / pipValue;
    const finalDirectionMatchesSpike =
      (spikeDirection === "UP" && finalMove > 0) ||
      (spikeDirection === "DOWN" && finalMove < 0);

    // Pattern classification
    let patternType: PatternType;
    const finalMoveAbs = Math.abs(finalMove);

    if (!didReverse && finalMoveAbs > spikeMagnitudePips * 0.5) {
      // No reversal, price continued in spike direction
      patternType = "continuation";
    } else if (didReverse && !finalDirectionMatchesSpike) {
      // Reversed and ended opposite to spike
      patternType = "spike_reversal";
    } else if (didReverse && finalDirectionMatchesSpike) {
      // Reversed but ultimately went with spike direction
      patternType = "fade";
    } else {
      // Small moves, no clear direction
      patternType = "range";
    }

    // Fetch +3hr settlement price from main H1 candles table
    const plus3hrTime = eventTime + (3 * 60 * 60 * 1000);
    const priceAtPlus3hr = await ctx.runQuery(
      internal.newsReactions.getH1CandleAtTime,
      { pair: args.pair, timestamp: plus3hrTime }
    );

    // Store the reaction
    await ctx.runMutation(internal.newsReactions.storeReaction, {
      eventId: args.eventId,
      pair: args.pair,
      eventTimestamp: args.eventTimestamp,
      priceAtMinus15m: effectiveMinus15.close,
      priceAtMinus5m: effectiveMinus5.close,
      priceAtMinus1m: preMinus1?.close || effectiveMinus5.close,
      priceAtEvent: atEvent.open,
      spikeHigh,
      spikeLow,
      spikeDirection,
      spikeMagnitudePips,
      timeToSpikeSec,
      priceAtPlus5m,
      priceAtPlus15m,
      priceAtPlus30m,
      priceAtPlus1hr,
      priceAtPlus3hr: priceAtPlus3hr ?? undefined, // From H1 candles table
      patternType,
      didReverse,
      reversalMagnitudePips,
      finalDirectionMatchesSpike,
    });

    return {
      success: true,
      pattern: patternType,
      spikePips: spikeMagnitudePips,
      spikeDirection,
      didReverse,
    };
  },
});

/**
 * Calculate reactions for all pairs for an event (internal use)
 */
export const calculateAllReactionsForEvent = internalAction({
  args: {
    eventId: v.string(),
    eventTimestamp: v.number(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const results: Record<string, unknown> = {};

    for (const pair of NEWS_PAIRS) {
      results[pair] = await ctx.runAction(
        internal.newsReactions.calculateReaction,
        {
          eventId: args.eventId,
          pair,
          eventTimestamp: args.eventTimestamp,
        }
      );
    }

    // Mark event as processed
    await ctx.runMutation(internal.newsEvents.markEventProcessed, {
      eventId: args.eventId,
    });

    return results;
  },
});

/**
 * Batch calculate reactions for multiple events
 */
export const batchCalculateReactions = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ processed: number; results: Record<string, unknown> }> => {
    const limit = args.limit || 10;

    // Get events with windows but no reactions calculated
    const events = (await ctx.runQuery(
      internal.newsReactions.getEventsWithWindows,
      { limit }
    )) as EventWithTimestamp[];

    const results: Record<string, unknown> = {};

    for (const event of events) {
      results[event.eventId] = await ctx.runAction(
        internal.newsReactions.calculateAllReactionsForEvent,
        {
          eventId: event.eventId,
          eventTimestamp: event.timestamp,
        }
      );
    }

    return { processed: events.length, results };
  },
});

/**
 * Batch calculate reactions for windows missing them (doesn't rely on reactionsCalculated flag)
 */
export const batchFillMissingReactions = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ processed: number; success: number; errors: number }> => {
    const limit = args.limit || 50;

    // Get windows that don't have reactions
    const windows = (await ctx.runQuery(
      internal.newsReactions.getWindowsNeedingReactionsInternal,
      { limit }
    )) as Array<{ eventId: string; pair: string; eventTimestamp: number }>;

    let success = 0;
    let errors = 0;

    for (const window of windows) {
      try {
        await ctx.runAction(internal.newsReactions.calculateReaction, {
          eventId: window.eventId,
          pair: window.pair,
          eventTimestamp: window.eventTimestamp,
        });
        success++;
      } catch {
        errors++;
      }
    }

    return { processed: windows.length, success, errors };
  },
});

/**
 * Internal query to get windows needing reactions - samples random subset
 */
export const getWindowsNeedingReactionsInternal = internalQuery({
  args: { limit: v.number(), offset: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const offset = args.offset || 0;

    // Skip already-checked windows by taking more and slicing
    const windows = await ctx.db
      .query("eventCandleWindows")
      .order("desc") // Order by creation time descending to get newer windows
      .take(offset + args.limit * 3);

    // Skip the offset amount
    const toCheck = windows.slice(offset);

    const needsReaction = [];
    for (const window of toCheck) {
      if (needsReaction.length >= args.limit) break;

      const existingReaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_event", (q) => q.eq("eventId", window.eventId))
        .filter((q) => q.eq(q.field("pair"), window.pair))
        .first();

      if (!existingReaction) {
        needsReaction.push({
          eventId: window.eventId,
          pair: window.pair,
          eventTimestamp: window.eventTimestamp,
        });
      }
    }

    return needsReaction;
  },
});

/**
 * Get events that have windows but haven't had reactions calculated (internal use)
 */
export const getEventsWithWindows = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    // Get events not yet processed
    const events = await ctx.db
      .query("economicEvents")
      .filter((q) => q.eq(q.field("reactionsCalculated"), false))
      .take(args.limit * 2); // Get extra in case some don't have windows

    // Filter to those that have at least one window
    const eventsWithWindows = [];
    for (const event of events) {
      const window = await ctx.db
        .query("eventCandleWindows")
        .withIndex("by_event", (q) => q.eq("eventId", event.eventId))
        .first();

      if (window) {
        eventsWithWindows.push(event);
        if (eventsWithWindows.length >= args.limit) break;
      }
    }

    return eventsWithWindows;
  },
});

/**
 * Get events in a time range that need reactions for a given pair
 * Uses economicEvents (lighter docs) instead of eventCandleWindows (heavy with candles)
 */
export const getEventsForPairInTimeRange = internalQuery({
  args: {
    pair: v.string(),
    startTimestamp: v.number(),
    endTimestamp: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    // Query events in the time range - much lighter than windows
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp")
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), args.startTimestamp),
          q.lt(q.field("timestamp"), args.endTimestamp)
        )
      )
      .take(args.limit * 3);

    const needsReaction = [];

    for (const event of events) {
      if (needsReaction.length >= args.limit) break;

      // Check if reaction exists for this pair
      const existingReaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      if (!existingReaction) {
        // Verify window exists for this pair
        const hasWindow = await ctx.db
          .query("eventCandleWindows")
          .withIndex("by_pair_event", (q) =>
            q.eq("pair", args.pair).eq("eventId", event.eventId)
          )
          .first();

        if (hasWindow) {
          needsReaction.push({
            eventId: event.eventId,
            pair: args.pair,
            eventTimestamp: event.timestamp,
          });
        }
      }
    }

    return {
      windows: needsReaction,
      checkedCount: events.length,
    };
  },
});

/**
 * Get windows for a specific pair, returning both those needing reactions and pagination info
 * Uses economicEvents (lightweight) instead of eventCandleWindows (heavy with candles)
 */
export const getWindowsForPairNeedingReactions = internalQuery({
  args: {
    pair: v.string(),
    limit: v.number(),
    afterTimestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Query events by timestamp - much lighter than window docs
    let eventsQuery = ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp");

    // If we have a starting timestamp, filter to only events after it
    if (args.afterTimestamp) {
      eventsQuery = eventsQuery.filter((q) =>
        q.gt(q.field("timestamp"), args.afterTimestamp as number)
      );
    }

    // Get a batch of events to check
    const events = await eventsQuery.take(args.limit * 3);

    const needsReaction = [];
    let lastCheckedTimestamp: number | null = null;

    for (const event of events) {
      lastCheckedTimestamp = event.timestamp;

      if (needsReaction.length >= args.limit) continue; // Keep going to update lastCheckedTimestamp

      // Check if reaction already exists
      const existingReaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      if (!existingReaction) {
        // Verify window exists for this pair (just check existence, don't load full doc)
        const hasWindow = await ctx.db
          .query("eventCandleWindows")
          .withIndex("by_pair_event", (q) =>
            q.eq("pair", args.pair).eq("eventId", event.eventId)
          )
          .first();

        if (hasWindow) {
          needsReaction.push({
            eventId: event.eventId,
            pair: args.pair,
            eventTimestamp: event.timestamp,
          });
        }
      }
    }

    return {
      windows: needsReaction,
      lastCheckedTimestamp,
      hasMore: events.length === args.limit * 3,
    };
  },
});

/**
 * Fill missing reactions for a specific pair
 * Processes windows that have candle data but no reaction calculated
 */
export const fillMissingReactionsForPair = action({
  args: {
    pair: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    processed: number;
    success: number;
    errors: number;
    lastTimestamp: number | null;
    hasMore: boolean;
  }> => {
    const limit = args.limit || 100;
    let lastTimestamp: number | null = null;
    let processed = 0;
    let success = 0;
    let errors = 0;
    let hasMore = true;

    // Keep fetching until no more windows or we hit the limit
    while (processed < limit && hasMore) {
      const batchLimit = Math.min(50, limit - processed);

      const result = (await ctx.runQuery(
        internal.newsReactions.getWindowsForPairNeedingReactions,
        {
          pair: args.pair,
          limit: batchLimit,
          afterTimestamp: lastTimestamp ?? undefined,
        }
      )) as {
        windows: Array<{ eventId: string; pair: string; eventTimestamp: number }>;
        lastCheckedTimestamp: number | null;
        hasMore: boolean;
      };

      // Update pagination cursor even if no windows need reactions
      lastTimestamp = result.lastCheckedTimestamp;
      hasMore = result.hasMore;

      if (result.windows.length === 0) {
        // No windows need reactions in this batch, but there might be more
        if (!hasMore) break;
        continue;
      }

      for (const window of result.windows) {
        try {
          const calcResult = (await ctx.runAction(
            internal.newsReactions.calculateReaction,
            {
              eventId: window.eventId,
              pair: window.pair,
              eventTimestamp: window.eventTimestamp,
            }
          )) as { success: boolean; error?: string };

          if (calcResult.success) {
            success++;
          } else {
            console.log(
              `Skipped ${window.eventId}/${window.pair}: ${calcResult.error}`
            );
            errors++;
          }
        } catch (e) {
          console.error(`Error processing ${window.eventId}/${window.pair}:`, e);
          errors++;
        }
        lastTimestamp = window.eventTimestamp;
        processed++;

        if (processed >= limit) break;
      }
    }

    return { processed, success, errors, lastTimestamp, hasMore };
  },
});

/**
 * Fill missing reactions for a pair within a specific year
 * More efficient for targeted processing
 */
export const fillMissingReactionsForPairYear = action({
  args: {
    pair: v.string(),
    year: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    processed: number;
    success: number;
    errors: number;
    checkedCount: number;
  }> => {
    const limit = args.limit || 100;
    const startTimestamp = new Date(`${args.year}-01-01T00:00:00Z`).getTime();
    const endTimestamp = new Date(`${args.year + 1}-01-01T00:00:00Z`).getTime();

    const result = (await ctx.runQuery(
      internal.newsReactions.getEventsForPairInTimeRange,
      {
        pair: args.pair,
        startTimestamp,
        endTimestamp,
        limit,
      }
    )) as { windows: { eventId: string; pair: string; eventTimestamp: number }[]; checkedCount: number };

    let processed = 0;
    let success = 0;
    let errors = 0;

    for (const window of result.windows) {
      try {
        const calcResult = (await ctx.runAction(
          internal.newsReactions.calculateReaction,
          {
            eventId: window.eventId,
            pair: window.pair,
            eventTimestamp: window.eventTimestamp,
          }
        )) as { success: boolean; error?: string };

        if (calcResult.success) {
          success++;
        } else {
          console.log(`Skipped ${window.eventId}/${window.pair}: ${calcResult.error}`);
          errors++;
        }
      } catch (e) {
        console.error(`Error processing ${window.eventId}/${window.pair}:`, e);
        errors++;
      }
      processed++;
    }

    return { processed, success, errors, checkedCount: result.checkedCount };
  },
});

/**
 * Count reactions for a single pair (lightweight)
 */
export const countReactionsForPair = query({
  args: { pair: v.string() },
  handler: async (ctx, args) => {
    let count = 0;
    let cursor: string | null = null;
    const batchSize = 500;

    while (true) {
      let query = ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair", (q) => q.eq("pair", args.pair));

      if (cursor) {
        query = query.filter((q) => q.gt(q.field("_id"), cursor as string));
      }

      const batch = await query.take(batchSize);
      count += batch.length;

      if (batch.length < batchSize) break;
      cursor = batch[batch.length - 1]._id;
    }

    return { pair: args.pair, reactions: count };
  },
});

/**
 * Count windows for a single pair (uses eventId only to avoid loading candles)
 */
export const countWindowsForPair = query({
  args: { pair: v.string() },
  handler: async (ctx, args) => {
    // Use economicEvents + check for windows to avoid loading heavy candle docs
    let count = 0;
    let lastTimestamp: number | null = null;

    while (true) {
      let query = ctx.db
        .query("economicEvents")
        .withIndex("by_timestamp");

      if (lastTimestamp) {
        query = query.filter((q) => q.gt(q.field("timestamp"), lastTimestamp as number));
      }

      const events = await query.take(200);

      for (const event of events) {
        const hasWindow = await ctx.db
          .query("eventCandleWindows")
          .withIndex("by_pair_event", (q) =>
            q.eq("pair", args.pair).eq("eventId", event.eventId)
          )
          .first();

        if (hasWindow) count++;
        lastTimestamp = event.timestamp;
      }

      if (events.length < 200) break;
    }

    return { pair: args.pair, windows: count };
  },
});

/**
 * Debug query to inspect a window's candle data and why it might fail
 */
export const debugWindowCandles = query({
  args: {
    eventId: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    const window = await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();

    if (!window) {
      return { error: "Window not found" };
    }

    const candles = window.candles;
    const eventTime = window.eventTimestamp;

    // Find candle closest to event time
    let closestCandle = null;
    let closestDiff = Infinity;
    for (const c of candles) {
      const diff = Math.abs(c.timestamp - eventTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestCandle = c;
      }
    }

    // Check candles at key offsets
    const candleAt = (offsetMinutes: number) => {
      const targetTime = eventTime + offsetMinutes * 60 * 1000;
      return candles.find((c) => Math.abs(c.timestamp - targetTime) < 90000);
    };

    return {
      eventId: args.eventId,
      pair: args.pair,
      eventTime: eventTime,
      eventTimeISO: new Date(eventTime).toISOString(),
      totalCandles: candles.length,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      closestCandleToEvent: closestCandle
        ? {
            timestamp: closestCandle.timestamp,
            timestampISO: new Date(closestCandle.timestamp).toISOString(),
            offsetMs: closestCandle.timestamp - eventTime,
            offsetMin: (closestCandle.timestamp - eventTime) / 60000,
          }
        : null,
      hasEventCandle: !!candleAt(0),
      hasMinus15: !!candleAt(-15),
      hasMinus5: !!candleAt(-5),
      hasPlus5: !!candleAt(5),
      hasPlus15: !!candleAt(15),
      hasPlus30: !!candleAt(30),
      hasPlus60: !!candleAt(60),
      // Sample candles
      firstCandle: candles[0]
        ? {
            timestamp: candles[0].timestamp,
            timestampISO: new Date(candles[0].timestamp).toISOString(),
          }
        : null,
      lastCandle: candles[candles.length - 1]
        ? {
            timestamp: candles[candles.length - 1].timestamp,
            timestampISO: new Date(
              candles[candles.length - 1].timestamp
            ).toISOString(),
          }
        : null,
    };
  },
});

/**
 * BATCH mutation for uploading multiple reactions at once (much faster)
 * Single HTTP call inserts up to 100 reactions in one transaction
 */
export const uploadReactionsBatch = mutation({
  args: {
    reactions: v.array(
      v.object({
        eventId: v.string(),
        pair: v.string(),
        eventTimestamp: v.number(),
        priceAtMinus15m: v.number(),
        priceAtMinus5m: v.number(),
        priceAtMinus1m: v.number(),
        priceAtEvent: v.number(),
        spikeHigh: v.number(),
        spikeLow: v.number(),
        spikeDirection: v.string(),
        spikeMagnitudePips: v.number(),
        timeToSpikeSec: v.optional(v.number()),
        priceAtPlus5m: v.number(),
        priceAtPlus15m: v.number(),
        priceAtPlus30m: v.number(),
        priceAtPlus1hr: v.number(),
        priceAtPlus3hr: v.optional(v.number()),
        patternType: v.string(),
        didReverse: v.boolean(),
        reversalMagnitudePips: v.optional(v.number()),
        finalDirectionMatchesSpike: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;

    for (const reaction of args.reactions) {
      const existing = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", reaction.pair).eq("eventId", reaction.eventId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, reaction);
        updated++;
      } else {
        await ctx.db.insert("eventPriceReactions", reaction);
        inserted++;
      }
    }

    return { inserted, updated };
  },
});

/**
 * Public mutation for uploading candle windows from local files
 * Used by scripts/bulk-upload.ts for bulk uploads
 */
export const uploadWindow = mutation({
  args: {
    eventId: v.string(),
    pair: v.string(),
    eventTimestamp: v.number(),
    windowStart: v.number(),
    windowEnd: v.number(),
    candles: v.array(
      v.object({
        timestamp: v.number(),
        open: v.number(),
        high: v.number(),
        low: v.number(),
        close: v.number(),
        volume: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check for existing window
    const existing = await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_pair_event", (q) =>
        q.eq("pair", args.pair).eq("eventId", args.eventId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        eventTimestamp: args.eventTimestamp,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        candles: args.candles,
      });
      return { updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("eventCandleWindows", {
      eventId: args.eventId,
      pair: args.pair,
      eventTimestamp: args.eventTimestamp,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      candles: args.candles,
    });
    return { updated: false, id };
  },
});

/**
 * BATCH mutation for uploading multiple windows at once (much faster)
 * Single HTTP call inserts up to 20 windows in one transaction
 * (Windows are large, so smaller batch than reactions)
 */
export const uploadWindowsBatch = mutation({
  args: {
    windows: v.array(
      v.object({
        eventId: v.string(),
        pair: v.string(),
        eventTimestamp: v.number(),
        windowStart: v.number(),
        windowEnd: v.number(),
        candles: v.array(
          v.object({
            timestamp: v.number(),
            open: v.number(),
            high: v.number(),
            low: v.number(),
            close: v.number(),
            volume: v.optional(v.number()),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;

    for (const window of args.windows) {
      const existing = await ctx.db
        .query("eventCandleWindows")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", window.pair).eq("eventId", window.eventId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          eventTimestamp: window.eventTimestamp,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          candles: window.candles,
        });
        updated++;
      } else {
        await ctx.db.insert("eventCandleWindows", window);
        inserted++;
      }
    }

    return { inserted, updated };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SETTLEMENT BACKFILL SYSTEM
// Uses main candles table (H1) to populate priceAtPlus3hr for existing reactions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get H1 candle close price at a specific timestamp
 * H1 candles are timestamped at hour boundaries (e.g., 13:00, 14:00)
 */
export const getH1CandleAtTime = internalQuery({
  args: {
    pair: v.string(),
    timestamp: v.number(), // Target time (e.g., event + 3hr)
  },
  handler: async (ctx, args) => {
    // H1 candles are at hour boundaries - floor to nearest hour
    const hourStart = Math.floor(args.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);

    const candle = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q.eq("pair", args.pair).eq("timeframe", "H1").eq("timestamp", hourStart)
      )
      .first();

    return candle?.close ?? null;
  },
});

/**
 * Find reactions that need priceAtPlus3hr filled
 * Returns batch of reactions missing settlement data
 */
export const getReactionsNeedingSettlementBackfill = internalQuery({
  args: {
    pair: v.string(),
    limit: v.number(),
    afterTimestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("eventPriceReactions")
      .withIndex("by_pair_timestamp", (q) => q.eq("pair", args.pair));

    // Filter to only after the cursor timestamp if provided
    if (args.afterTimestamp) {
      query = query.filter((q) =>
        q.gt(q.field("eventTimestamp"), args.afterTimestamp as number)
      );
    }

    // Get more than limit since we'll filter for missing priceAtPlus3hr
    const reactions = await query.take(args.limit * 3);

    // Filter to only those missing priceAtPlus3hr
    return reactions
      .filter((r) => r.priceAtPlus3hr === undefined || r.priceAtPlus3hr === null)
      .slice(0, args.limit)
      .map((r) => ({
        _id: r._id,
        eventId: r.eventId,
        pair: r.pair,
        eventTimestamp: r.eventTimestamp,
        priceAtPlus1hr: r.priceAtPlus1hr,
      }));
  },
});

/**
 * Update settlement prices on an existing reaction
 */
export const updateSettlementPrice = internalMutation({
  args: {
    reactionId: v.id("eventPriceReactions"),
    priceAtPlus3hr: v.optional(v.number()),
    priceAtPlus1hr: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, number> = {};

    if (args.priceAtPlus3hr !== undefined) {
      updates.priceAtPlus3hr = args.priceAtPlus3hr;
    }
    if (args.priceAtPlus1hr !== undefined) {
      updates.priceAtPlus1hr = args.priceAtPlus1hr;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.reactionId, updates);
    }
  },
});

/**
 * Internal backfill action - processes a batch of reactions for a single pair
 */
export const backfillSettlementPricesInternal = internalAction({
  args: {
    pair: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    lastTimestamp: number | null;
    hasMore: boolean;
  }> => {
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let lastTimestamp: number | null = null;

    // Get batch of reactions needing backfill
    const reactions = await ctx.runQuery(
      internal.newsReactions.getReactionsNeedingSettlementBackfill,
      { pair: args.pair, limit: args.limit, afterTimestamp: undefined }
    );

    for (const reaction of reactions) {
      // Calculate target time for +3hr candle
      const plus3hrTime = reaction.eventTimestamp + (3 * 60 * 60 * 1000);

      // Look up H1 candle
      const priceAtPlus3hr = await ctx.runQuery(
        internal.newsReactions.getH1CandleAtTime,
        { pair: args.pair, timestamp: plus3hrTime }
      );

      if (priceAtPlus3hr !== null) {
        // Update the reaction
        await ctx.runMutation(internal.newsReactions.updateSettlementPrice, {
          reactionId: reaction._id,
          priceAtPlus3hr,
        });
        updated++;
      } else {
        skipped++; // No H1 candle available for this time
      }

      lastTimestamp = reaction.eventTimestamp;
      processed++;
    }

    return {
      processed,
      updated,
      skipped,
      lastTimestamp,
      hasMore: reactions.length === args.limit,
    };
  },
});

/**
 * Public action to backfill priceAtPlus3hr for a single pair
 * Callable from Convex dashboard or scripts
 */
export const backfillSettlementPrices = action({
  args: {
    pair: v.string(),
    limit: v.optional(v.number()), // Reactions per run (default 100)
  },
  handler: async (ctx, args): Promise<{
    processed: number;
    updated: number;
    skipped: number;
    lastTimestamp: number | null;
    hasMore: boolean;
  }> => {
    const limit = args.limit || 100;
    return await ctx.runAction(
      internal.newsReactions.backfillSettlementPricesInternal,
      { pair: args.pair, limit }
    );
  },
});

/**
 * Backfill all pairs in sequence - convenience action
 * Runs backfill for all 7 currency pairs
 */
export const backfillAllPairs = action({
  args: {
    limit: v.optional(v.number()), // Per-pair limit
  },
  handler: async (ctx, args): Promise<Record<string, {
    processed: number;
    updated: number;
    skipped: number;
    hasMore: boolean;
  }>> => {
    const limit = args.limit || 100;
    const results: Record<string, {
      processed: number;
      updated: number;
      skipped: number;
      hasMore: boolean;
    }> = {};

    for (const pair of NEWS_PAIRS) {
      const result = await ctx.runAction(
        internal.newsReactions.backfillSettlementPricesInternal,
        { pair, limit }
      );
      results[pair] = {
        processed: result.processed,
        updated: result.updated,
        skipped: result.skipped,
        hasMore: result.hasMore,
      };
    }

    return results;
  },
});
