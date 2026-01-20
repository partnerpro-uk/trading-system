"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Pairs to fetch windows for
const NEWS_PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
] as const;

// Tiered window configuration based on event type
// FOMC/ECB Press Conferences get extended windows for Q&A
const EXTENDED_WINDOW_EVENTS = [
  "FOMC_PRESSER",
  "ECB_PRESSER",
];

function getWindowMinutes(eventType: string, impact: string): number {
  // Extended window for press conferences (T+90)
  if (EXTENDED_WINDOW_EVENTS.includes(eventType)) {
    return 90;
  }
  // High impact events get T+60
  if (impact === "high") {
    return 60;
  }
  // Medium and low get T+15
  return 15;
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE.JS ACTIONS (require fetch)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch 1-minute candle window for an event from OANDA
 * Uses tiered window lengths based on event type and impact
 */
export const fetchEventCandleWindow = internalAction({
  args: {
    eventId: v.string(),
    eventTimestamp: v.number(),
    pair: v.string(),
    eventType: v.optional(v.string()),
    impact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OANDA_API_KEY;
    const apiUrl =
      process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

    if (!apiKey) {
      return { success: false, error: "OANDA_API_KEY not configured" };
    }

    // Calculate tiered window length
    const windowMinutes = getWindowMinutes(
      args.eventType || "",
      args.impact || "high"
    );
    const windowStart = args.eventTimestamp - 15 * 60 * 1000; // Always T-15
    const windowEnd = args.eventTimestamp + windowMinutes * 60 * 1000;

    const fromTime = new Date(windowStart).toISOString();
    const toTime = new Date(windowEnd).toISOString();

    const params = new URLSearchParams({
      granularity: "M1",
      from: fromTime,
      to: toTime,
      price: "M", // Mid prices
    });

    try {
      const response = await fetch(
        `${apiUrl}/v3/instruments/${args.pair}/candles?${params}`,
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
          error: `OANDA API error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();

      if (!data.candles || data.candles.length === 0) {
        return { success: false, error: "No candle data returned" };
      }

      const candles = data.candles.map((c: any) => ({
        timestamp: new Date(c.time).getTime(),
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
        volume: c.volume,
      }));

      // Store the window
      await ctx.runMutation(internal.newsEvents.storeEventCandleWindow, {
        eventId: args.eventId,
        pair: args.pair,
        eventTimestamp: args.eventTimestamp,
        windowStart,
        windowEnd,
        candles,
      });

      return { success: true, candleCount: candles.length };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Internal action to fetch windows for recently-released events
 * Called by cron to process events that just happened
 */
export const processRecentEventWindows = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get events from last 2 hours that need windows
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const now = Date.now();

    // Query for recent events needing windows
    const events = await ctx.runQuery(
      internal.newsEvents.getRecentEventsNeedingWindows,
      { fromTimestamp: twoHoursAgo, toTimestamp: now, limit: 10 }
    );

    if (events.length === 0) {
      return { processed: 0, message: "No recent events need windows" };
    }

    let processed = 0;
    const results: Record<string, { success: boolean; pairs: number }> = {};

    for (const event of events) {
      try {
        // Fetch all windows for this event
        const pairResults = await Promise.all(
          NEWS_PAIRS.map((pair) =>
            ctx.runAction(internal.newsEventsActions.fetchEventCandleWindow, {
              eventId: event.eventId,
              eventTimestamp: event.timestamp,
              pair,
              eventType: event.eventType,
              impact: event.impact,
            })
          )
        );

        const successCount = pairResults.filter((r) => r.success).length;
        results[event.eventId] = { success: successCount > 0, pairs: successCount };
        processed++;
      } catch (error) {
        results[event.eventId] = { success: false, pairs: 0 };
      }
    }

    return { processed, results };
  },
});

/**
 * Fetch candle windows for all pairs for a single event
 * Runs all 7 pairs in PARALLEL for maximum speed
 * Supports tiered windows based on event type and impact
 */
export const fetchAllWindowsForEvent = action({
  args: {
    eventId: v.string(),
    eventTimestamp: v.number(),
    eventType: v.optional(v.string()),
    impact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Run all pairs in parallel
    const pairPromises = NEWS_PAIRS.map((pair) =>
      ctx.runAction(internal.newsEventsActions.fetchEventCandleWindow, {
        eventId: args.eventId,
        eventTimestamp: args.eventTimestamp,
        pair,
        eventType: args.eventType,
        impact: args.impact,
      })
    );

    const resultsArray = await Promise.all(pairPromises);

    // Map results back to pair names
    const results: Record<
      string,
      { success: boolean; candleCount?: number; error?: string }
    > = {};
    NEWS_PAIRS.forEach((pair, idx) => {
      results[pair] = resultsArray[idx];
    });

    return results;
  },
});
