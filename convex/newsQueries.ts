import { query } from "./_generated/server";
import { v } from "convex/values";
import {
  classifyOutcome,
  INLINE_THRESHOLD_PCT,
  LOWER_IS_BETTER_EVENTS,
  type OutcomeType,
} from "./newsStatistics";

// Debug query to sample events
export const sampleEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("economicEvents")
      .order("desc")
      .take(args.limit || 20);
    return events.map(e => ({ name: e.name, impact: e.impact, currency: e.currency, eventId: e.eventId }));
  },
});

// Count events by impact level
export const countByImpact = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("economicEvents").collect();
    const counts = { high: 0, medium: 0, low: 0, other: 0, total: events.length };
    for (const e of events) {
      if (e.impact === "high") counts.high++;
      else if (e.impact === "medium") counts.medium++;
      else if (e.impact === "low") counts.low++;
      else counts.other++;
    }
    return counts;
  },
});

// Count events by year (for analysis)
export const countByYear = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("economicEvents").collect();
    const counts: Record<number, number> = {};
    for (const e of events) {
      const year = new Date(e.timestamp).getUTCFullYear();
      counts[year] = (counts[year] || 0) + 1;
    }
    return counts;
  },
});

// Get all unique event names (for migration filtering)
export const getUniqueEventNames = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("economicEvents").collect();
    const names = new Set<string>();
    for (const e of events) {
      names.add(e.name.toLowerCase());
    }
    return Array.from(names);
  },
});

// Get all eventIds (for migration by ID matching)
export const getAllEventIds = query({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("economicEvents").collect();
    return events.map((e) => e.eventId);
  },
});

// Get sample events from a specific year range
export const sampleEventsByYear = query({
  args: {
    year: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTimestamp = new Date(`${args.year}-01-01`).getTime();
    const endTimestamp = new Date(`${args.year + 1}-01-01`).getTime();

    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp")
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), startTimestamp),
          q.lt(q.field("timestamp"), endTimestamp)
        )
      )
      .take(args.limit || 10);

    return events.map((e) => ({
      eventId: e.eventId,
      name: e.name,
      impact: e.impact,
      timestamp: e.timestamp,
      timestampISO: new Date(e.timestamp).toISOString(),
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE-FACING QUERIES
// These are the primary queries that Claude will use for trade context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get upcoming high-impact events
 * Use case: "Any news I should be aware of?"
 */
export const getUpcomingEvents = query({
  args: {
    hoursAhead: v.optional(v.number()),
    currency: v.optional(v.string()),
    impactFilter: v.optional(v.string()), // "high" | "medium" | "all"
  },
  handler: async (ctx, args) => {
    const hoursAhead = args.hoursAhead || 24;
    const now = Date.now();
    const cutoff = now + hoursAhead * 60 * 60 * 1000;

    let events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", now).lte("timestamp", cutoff)
      )
      .take(50);

    // Filter by currency if specified
    if (args.currency) {
      events = events.filter((e) => e.currency === args.currency);
    }

    // Filter by impact if specified
    if (args.impactFilter && args.impactFilter !== "all") {
      events = events.filter((e) => e.impact === args.impactFilter);
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
  },
});

/**
 * Get recent events that occurred
 * Use case: "What news just happened?"
 */
export const getRecentEvents = query({
  args: {
    hoursBack: v.optional(v.number()),
    currency: v.optional(v.string()),
    pair: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack || 4;
    const now = Date.now();
    const cutoff = now - hoursBack * 60 * 60 * 1000;

    let events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", cutoff).lte("timestamp", now)
      )
      .take(20);

    // Filter by currency if specified
    if (args.currency) {
      events = events.filter((e) => e.currency === args.currency);
    }

    // If pair specified, filter to relevant currencies
    if (args.pair) {
      const [base, quote] = args.pair.split("_");
      events = events.filter(
        (e) => e.currency === base || e.currency === quote
      );
    }

    // Get reactions if pair specified
    if (args.pair) {
      const eventsWithReactions = [];
      for (const event of events) {
        const reaction = await ctx.db
          .query("eventPriceReactions")
          .withIndex("by_pair_event", (q) =>
            q.eq("pair", args.pair!).eq("eventId", event.eventId)
          )
          .first();

        eventsWithReactions.push({ event, reaction });
      }
      return eventsWithReactions;
    }

    return events;
  },
});

/**
 * Get statistics for an event type
 * Use case: "How does EUR/USD typically behave around FOMC?"
 */
export const getEventTypeStats = query({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    const stats = await ctx.db
      .query("eventTypeStatistics")
      .withIndex("by_type_pair", (q) =>
        q.eq("eventType", args.eventType).eq("pair", args.pair)
      )
      .first();

    return stats;
  },
});

/**
 * Get historical reactions for pattern analysis
 * Use case: "Show me all FOMC events where the spike fully reversed"
 */
export const getHistoricalReactions = query({
  args: {
    eventType: v.string(),
    pair: v.string(),
    limit: v.optional(v.number()),
    patternFilter: v.optional(v.string()), // "spike_reversal", "continuation", etc.
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    // Get events of this type
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_type_timestamp", (q) => q.eq("eventType", args.eventType))
      .order("desc")
      .take(limit * 2); // Get extra in case some don't have reactions

    // Get reactions for each
    const results = [];
    for (const event of events) {
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      if (reaction) {
        // Apply pattern filter if specified
        if (args.patternFilter && reaction.patternType !== args.patternFilter) {
          continue;
        }

        results.push({ event, reaction });

        if (results.length >= limit) break;
      }
    }

    return results;
  },
});

/**
 * NEWS PROXIMITY HELPER
 * Powers "⚠️ NFP in 3 hours" warnings in setup checklists
 *
 * Use case: Check if there's upcoming or recent news near a timestamp
 */
export const getNewsProximity = query({
  args: {
    timestamp: v.number(),
    pair: v.string(),
    windowMinutes: v.optional(v.number()), // default 240 (4 hours)
  },
  handler: async (ctx, args) => {
    const windowMinutes = args.windowMinutes || 240;
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = args.timestamp - windowMs;
    const windowEnd = args.timestamp + windowMs;

    // Get relevant currencies for this pair
    const [base, quote] = args.pair.split("_");

    // Find events within window (using index bounds for efficiency)
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", windowStart).lte("timestamp", windowEnd)
      )
      .take(20);

    // Filter to relevant currencies and high impact
    const relevantEvents = events.filter(
      (e) =>
        (e.currency === base || e.currency === quote) && e.impact === "high"
    );

    if (relevantEvents.length === 0) {
      return {
        hasNearbyNews: false,
        nearestEvent: null,
        minutesUntil: null,
        minutesSince: null,
        isWithinWindow: false,
        upcomingEvents: [],
        recentEvents: [],
      };
    }

    // Find nearest event
    let nearestEvent = relevantEvents[0];
    let nearestDistance = Math.abs(nearestEvent.timestamp - args.timestamp);

    for (const event of relevantEvents) {
      const distance = Math.abs(event.timestamp - args.timestamp);
      if (distance < nearestDistance) {
        nearestEvent = event;
        nearestDistance = distance;
      }
    }

    const minutesFromNearest = Math.round(
      (nearestEvent.timestamp - args.timestamp) / 60000
    );

    // Split into upcoming and recent
    const upcomingEvents = relevantEvents
      .filter((e) => e.timestamp > args.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    const recentEvents = relevantEvents
      .filter((e) => e.timestamp <= args.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp);

    return {
      hasNearbyNews: true,
      nearestEvent,
      minutesUntil: minutesFromNearest > 0 ? minutesFromNearest : null,
      minutesSince: minutesFromNearest < 0 ? Math.abs(minutesFromNearest) : null,
      isWithinWindow: true,
      upcomingEvents,
      recentEvents,
    };
  },
});

/**
 * FULL NEWS CONTEXT
 * Comprehensive pre-trade context for Claude
 *
 * Use case: "I'm looking at a EUR/USD long setup. Any news concerns?"
 */
export const getNewsContext = query({
  args: {
    pair: v.string(),
    lookAheadHours: v.optional(v.number()),
    lookBackHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookAhead = args.lookAheadHours || 4;
    const lookBack = args.lookBackHours || 2;
    const now = Date.now();

    // Get relevant currencies
    const [base, quote] = args.pair.split("_");

    // Get upcoming events (using index bounds for efficiency)
    const upcomingCutoff = now + lookAhead * 60 * 60 * 1000;
    const upcomingAll = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", now).lte("timestamp", upcomingCutoff)
      )
      .take(20);

    const relevantUpcoming = upcomingAll.filter(
      (e) => e.currency === base || e.currency === quote
    );

    // Get stats for upcoming events
    const upcomingWithStats = [];
    for (const event of relevantUpcoming) {
      const stats = await ctx.db
        .query("eventTypeStatistics")
        .withIndex("by_type_pair", (q) =>
          q.eq("eventType", event.eventType).eq("pair", args.pair)
        )
        .first();

      upcomingWithStats.push({ event, stats });
    }

    // Get recent events (using index bounds for efficiency)
    const recentCutoff = now - lookBack * 60 * 60 * 1000;
    const recentAll = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", recentCutoff).lte("timestamp", now)
      )
      .take(20);

    const relevantRecent = recentAll.filter(
      (e) => e.currency === base || e.currency === quote
    );

    // Get reactions for recent events
    const recentWithReactions = [];
    for (const event of relevantRecent) {
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      recentWithReactions.push({ event, reaction });
    }

    // Find nearest high-impact event
    const allRelevant = [...relevantUpcoming, ...relevantRecent].filter(
      (e) => e.impact === "high"
    );

    let nearestHighImpact = null;
    let nearestDistance = Infinity;

    for (const event of allRelevant) {
      const distance = Math.abs(event.timestamp - now);
      if (distance < nearestDistance) {
        nearestHighImpact = event;
        nearestDistance = distance;
      }
    }

    const minutesToNearest = nearestHighImpact
      ? Math.round((nearestHighImpact.timestamp - now) / 60000)
      : null;

    return {
      pair: args.pair,
      timestamp: now,
      upcoming: upcomingWithStats,
      recent: recentWithReactions,
      nearestHighImpact,
      minutesToNearestHighImpact: minutesToNearest,
      hasUpcomingHighImpact: relevantUpcoming.some((e) => e.impact === "high"),
      hasRecentHighImpact: relevantRecent.some((e) => e.impact === "high"),
    };
  },
});

/**
 * NEWS CONTEXT FOR TRADE LOGGING
 * Get context to embed in trade records
 *
 * Use case: When logging a trade, capture news context automatically
 */
export const getNewsContextForTrade = query({
  args: {
    entryTimestamp: v.number(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    const windowHours = 4;
    const windowMs = windowHours * 60 * 60 * 1000;
    const windowStart = args.entryTimestamp - windowMs;
    const windowEnd = args.entryTimestamp + windowMs;

    // Get relevant currencies
    const [base, quote] = args.pair.split("_");

    // Find events within window (using index bounds for efficiency)
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp", (q) =>
        q.gte("timestamp", windowStart).lte("timestamp", windowEnd)
      )
      .take(20);

    // Filter to relevant currencies and high impact
    const relevantEvents = events.filter(
      (e) =>
        (e.currency === base || e.currency === quote) && e.impact === "high"
    );

    if (relevantEvents.length === 0) {
      return {
        nearestEventId: undefined,
        minutesFromEvent: undefined,
        eventOccurredDuring: false,
        surpriseZScore: undefined,
      };
    }

    // Find nearest event
    let nearestEvent = relevantEvents[0];
    let nearestDistance = Math.abs(nearestEvent.timestamp - args.entryTimestamp);

    for (const event of relevantEvents) {
      const distance = Math.abs(event.timestamp - args.entryTimestamp);
      if (distance < nearestDistance) {
        nearestEvent = event;
        nearestDistance = distance;
      }
    }

    const minutesFromEvent = Math.round(
      (nearestEvent.timestamp - args.entryTimestamp) / 60000
    );

    // Check if any event occurred "during" the trade (within 30 min after entry)
    const eventOccurredDuring = relevantEvents.some(
      (e) =>
        e.timestamp >= args.entryTimestamp &&
        e.timestamp <= args.entryTimestamp + 30 * 60 * 1000
    );

    return {
      nearestEventId: nearestEvent.eventId,
      minutesFromEvent, // negative = before entry, positive = after entry
      eventOccurredDuring,
      surpriseZScore: nearestEvent.surpriseZScore,
    };
  },
});

/**
 * Get event with its follow-ups
 * Use case: "Show me FOMC decision and its press conference"
 */
export const getEventWithFollowUps = query({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (!event) return null;

    const followUps = await ctx.db
      .query("economicEvents")
      .withIndex("by_related", (q) => q.eq("relatedEventId", args.eventId))
      .collect();

    return { event, followUps };
  },
});

/**
 * Search events by name or type
 * Use case: "Find all CPI events"
 */
export const searchEvents = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const searchLower = args.query.toLowerCase();

    // Get all events (we'll filter in memory - for production, consider search index)
    const events = await ctx.db
      .query("economicEvents")
      .order("desc")
      .take(1000);

    const matches = events.filter(
      (e) =>
        e.name.toLowerCase().includes(searchLower) ||
        e.eventType.toLowerCase().includes(searchLower)
    );

    return matches.slice(0, limit);
  },
});

/**
 * Get summary of all events in database
 * Use case: "How many events do we have? What types?"
 */
export const getEventsSummary = query({
  args: {},
  handler: async (ctx) => {
    // Get all events
    const events = await ctx.db.query("economicEvents").collect();

    // Count by type
    const typeCount = new Map<string, number>();
    const yearCount = new Map<number, number>();
    const currencyCount = new Map<string, number>();

    for (const event of events) {
      // Count by type
      typeCount.set(event.eventType, (typeCount.get(event.eventType) || 0) + 1);

      // Count by year
      const year = new Date(event.timestamp).getFullYear();
      yearCount.set(year, (yearCount.get(year) || 0) + 1);

      // Count by currency
      currencyCount.set(
        event.currency,
        (currencyCount.get(event.currency) || 0) + 1
      );
    }

    // Convert to sorted arrays
    const byType = [...typeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    const byYear = [...yearCount.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, count]) => ({ year, count }));

    const byCurrency = [...currencyCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([currency, count]) => ({ currency, count }));

    return {
      totalEvents: events.length,
      uniqueTypes: typeCount.size,
      byType: byType.slice(0, 50), // Top 50 types
      byYear,
      byCurrency,
    };
  },
});

/**
 * Get sample of candle windows in database
 */
export const getWindowsCount = query({
  args: {},
  handler: async (ctx) => {
    // Get recent windows to verify data is flowing
    const recent = await ctx.db
      .query("eventCandleWindows")
      .order("desc")
      .take(10);

    return {
      recentCount: recent.length,
      recentEvents: recent.map((w) => ({
        eventId: w.eventId,
        pair: w.pair,
        candleCount: w.candles.length,
      })),
      status: recent.length > 0 ? "Windows are being stored" : "No windows yet",
    };
  },
});

/**
 * Get counts of all news-related tables
 */
export const getTableCounts = query({
  args: {},
  handler: async (ctx) => {
    // Sample from each table to verify data exists
    const reactions = await ctx.db.query("eventPriceReactions").take(100);
    const stats = await ctx.db.query("eventTypeStatistics").take(100);

    return {
      reactionsCount: reactions.length >= 100 ? "100+" : reactions.length,
      statsCount: stats.length >= 100 ? "100+" : stats.length,
      reactionsSample: reactions.slice(0, 3).map((r) => ({
        eventId: r.eventId,
        pair: r.pair,
        pattern: r.patternType,
        spikePips: r.spikeMagnitudePips,
      })),
      statsSample: stats.slice(0, 3).map((s) => ({
        eventType: s.eventType,
        pair: s.pair,
        sampleSize: s.sampleSize,
        avgSpikePips: s.avgSpikePips,
      })),
    };
  },
});

/**
 * Get counts per pair (reactions only - windows are too large)
 */
export const getReactionsCountPerPair = query({
  args: { pair: v.string() },
  handler: async (ctx, args) => {
    const reactions = await ctx.db
      .query("eventPriceReactions")
      .withIndex("by_pair", (q) => q.eq("pair", args.pair))
      .collect();

    return {
      pair: args.pair,
      reactions: reactions.length,
    };
  },
});

/**
 * Debug: Find sample windows without reactions
 */
export const debugFindMissingReactions = query({
  args: { pair: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    // Get windows for this pair - sample from different timestamp ranges
    const windows = await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_pair_timestamp", (q) => q.eq("pair", args.pair))
      .take(500);

    const missing = [];
    for (const window of windows) {
      if (missing.length >= limit) break;

      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", window.eventId)
        )
        .first();

      if (!reaction) {
        missing.push({
          eventId: window.eventId,
          eventTimestamp: window.eventTimestamp,
          eventTimeISO: new Date(window.eventTimestamp).toISOString(),
          candleCount: window.candles.length,
        });
      }
    }

    return {
      windowsChecked: Math.min(windows.length, 500),
      missingCount: missing.length,
      samples: missing,
    };
  },
});

/**
 * Get total reactions count
 */
export const getTotalReactionsCount = query({
  args: {},
  handler: async (ctx) => {
    let total = 0;
    const pairs = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD"];

    for (const pair of pairs) {
      const reactions = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair", (q) => q.eq("pair", pair))
        .collect();
      total += reactions.length;
    }

    return { totalReactions: total };
  },
});

/**
 * Debug: Check reaction status for specific window
 */
export const debugCheckWindow = query({
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

    const reaction = await ctx.db
      .query("eventPriceReactions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("pair"), args.pair))
      .first();

    return {
      hasWindow: !!window,
      windowCandles: window?.candles.length || 0,
      hasReaction: !!reaction,
      pattern: reaction?.patternType || null,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CHART UI QUERIES
// These queries power the news event markers on the chart X-axis
// ═══════════════════════════════════════════════════════════════════════════

// MQL5 data source stores all events in UTC+2 (EET timezone) instead of UTC
// This causes a consistent +2 hour offset on ALL events (verified for US, UK, EU data)
// We apply a global -2 hour correction to convert to proper UTC
const MQL5_TIMEZONE_OFFSET_MS = 2 * 60 * 60 * 1000; // 2 hours in ms

/**
 * Get events within a time range for chart display
 * Use case: Display news markers on the chart X-axis
 */
// Maximum lookback for PAST events (12 months in ms)
// Future events have no limit - traders need to see all scheduled news
const MAX_PAST_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

export const getEventsInTimeRange = query({
  args: {
    pair: v.string(),
    startTime: v.number(), // Unix ms
    endTime: v.number(),   // Unix ms
    impactFilter: v.optional(v.string()), // "high" | "medium" | "all"
  },
  handler: async (ctx, args) => {
    // Get relevant currencies for this pair
    const [base, quote] = args.pair.split("_");

    // Limit lookback to 12 months max for past events (from now, not endTime)
    // Future events are unlimited - show all scheduled news
    const now = Date.now();
    const minAllowedStart = now - MAX_PAST_LOOKBACK_MS;
    const effectiveStartTime = Math.max(args.startTime, minAllowedStart);

    // Query events in time range (expand range to account for timezone correction)
    // IMPORTANT: Use compound index by_currency_timestamp for efficient filtering
    const adjustedStart = effectiveStartTime - MQL5_TIMEZONE_OFFSET_MS;
    const adjustedEnd = args.endTime + MQL5_TIMEZONE_OFFSET_MS;

    // Query each currency separately using compound index (much more efficient)
    const [baseEvents, quoteEvents] = await Promise.all([
      ctx.db
        .query("economicEvents")
        .withIndex("by_currency_timestamp", (q) =>
          q.eq("currency", base).gte("timestamp", adjustedStart).lte("timestamp", adjustedEnd)
        )
        .take(250),
      ctx.db
        .query("economicEvents")
        .withIndex("by_currency_timestamp", (q) =>
          q.eq("currency", quote).gte("timestamp", adjustedStart).lte("timestamp", adjustedEnd)
        )
        .take(250),
    ]);

    // Combine and dedupe (in case base === quote, though unlikely for forex)
    const eventMap = new Map<string, typeof baseEvents[0]>();
    for (const e of baseEvents) eventMap.set(e.eventId, e);
    for (const e of quoteEvents) eventMap.set(e.eventId, e);
    let filtered = Array.from(eventMap.values());

    // Filter by impact if specified
    if (args.impactFilter && args.impactFilter !== "all") {
      filtered = filtered.filter((e) => e.impact === args.impactFilter);
    }

    // Conditional stats type
    type ConditionalStatsData = {
      sampleSize: number;
      avgSpikePips: number;
      medianSpikePips: number;
      spikeUpPct: number;
      reversalWithin30minPct: number;
      dominantPattern: string;
    };

    // Cache stats lookups to avoid repeated queries for same event type
    const statsCache = new Map<
      string,
      {
        sampleSize: number;
        avgSpikePips: number;
        medianSpikePips: number;
        spikeUpPct: number;
        reversalWithin30minPct: number;
        hasForecastData: boolean;
        beatStats?: ConditionalStatsData;
        missStats?: ConditionalStatsData;
        inlineStats?: ConditionalStatsData;
      } | null
    >();

    // Get reactions and stats for each event
    const eventsWithReactions = [];
    for (const event of filtered) {
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      // Get statistics for this event type (cached)
      let stats = statsCache.get(event.eventType);
      if (stats === undefined) {
        const statsDoc = await ctx.db
          .query("eventTypeStatistics")
          .withIndex("by_type_pair", (q) =>
            q.eq("eventType", event.eventType).eq("pair", args.pair)
          )
          .first();

        stats = statsDoc
          ? {
              sampleSize: statsDoc.sampleSize,
              avgSpikePips: statsDoc.avgSpikePips,
              medianSpikePips: statsDoc.medianSpikePips,
              spikeUpPct: statsDoc.spikeUpPct,
              reversalWithin30minPct: statsDoc.reversalWithin30minPct,
              hasForecastData: statsDoc.hasForecastData ?? false,
              beatStats: statsDoc.beatStats,
              missStats: statsDoc.missStats,
              inlineStats: statsDoc.inlineStats,
            }
          : null;
        statsCache.set(event.eventType, stats);
      }

      // Apply global timezone correction (MQL5 stores in UTC+2, we need UTC)
      const correctedTimestamp = event.timestamp - MQL5_TIMEZONE_OFFSET_MS;

      eventsWithReactions.push({
        eventId: event.eventId,
        name: event.name,
        eventType: event.eventType,
        currency: event.currency,
        timestamp: correctedTimestamp,
        impact: event.impact,
        actual: event.actual,
        forecast: event.forecast,
        previous: event.previous,
        surpriseZScore: event.surpriseZScore,
        // Reaction summary for this specific event
        reaction: reaction
          ? {
              spikeDirection: reaction.spikeDirection,
              spikeMagnitudePips: reaction.spikeMagnitudePips,
              patternType: reaction.patternType,
              didReverse: reaction.didReverse,
            }
          : null,
        // Historical statistics for this event type on this pair
        stats: stats,
      });
    }

    // Filter again to ensure corrected timestamps are within range
    return eventsWithReactions.filter(
      (e) => e.timestamp >= effectiveStartTime && e.timestamp <= args.endTime
    );
  },
});

/**
 * Debug: Check candle timestamps for a window
 */
export const debugCandleTimestamps = query({
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

    if (!window) return { error: "Window not found" };

    const candles = window.candles;
    const eventTime = window.eventTimestamp;

    // Check for critical candles
    const candleAt = (offsetMinutes: number) => {
      const targetTime = eventTime + offsetMinutes * 60 * 1000;
      return candles.find((c) => Math.abs(c.timestamp - targetTime) < 90000);
    };

    const preMinus15 = candleAt(-15);
    const preMinus5 = candleAt(-5);
    const atEvent = candleAt(0);

    // Get first and last candle times
    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];

    return {
      eventTimestamp: eventTime,
      eventTimeISO: new Date(eventTime).toISOString(),
      candleCount: candles.length,
      firstCandleTime: firstCandle?.timestamp,
      firstCandleISO: firstCandle
        ? new Date(firstCandle.timestamp).toISOString()
        : null,
      lastCandleTime: lastCandle?.timestamp,
      lastCandleISO: lastCandle
        ? new Date(lastCandle.timestamp).toISOString()
        : null,
      hasMinus15: !!preMinus15,
      hasMinus5: !!preMinus5,
      hasAtEvent: !!atEvent,
      minus15Offset: preMinus15
        ? (preMinus15.timestamp - eventTime) / 60000
        : null,
      minus5Offset: preMinus5 ? (preMinus5.timestamp - eventTime) / 60000 : null,
      atEventOffset: atEvent ? (atEvent.timestamp - eventTime) / 60000 : null,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HISTORICAL EVENTS FOR TOOLTIP
// Returns individual past events with their actual pip movements (not aggregates)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get historical events for tooltip display
 * Returns last N events grouped by beat/miss outcome with actual pip movements
 *
 * Use case: Tooltip shows "When CPI beats: Dec 6 +42 pips UP → -15 rev"
 */
export const getHistoricalEventsForTooltip = query({
  args: {
    eventType: v.string(),
    pair: v.string(),
    beforeTimestamp: v.number(), // Exclude events after this (the current event)
    limit: v.optional(v.number()), // Default 5 per category
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    // Extract relevant currencies from pair (e.g., "EUR_USD" -> ["EUR", "USD"])
    const [baseCurrency, quoteCurrency] = args.pair.split("_");

    // Fetch past events of this type (before the current event)
    // Get extra to fill beat + miss + raw categories
    // Use proper index bounds for compound index [eventType, timestamp]
    // Filter to only show events for currencies relevant to this pair
    const allEvents = await ctx.db
      .query("economicEvents")
      .withIndex("by_type_timestamp", (q) =>
        q.eq("eventType", args.eventType).lt("timestamp", args.beforeTimestamp)
      )
      .order("desc")
      .take(limit * 8); // Fetch more to account for currency filtering

    // Filter to relevant currencies for this pair
    const events = allEvents.filter(
      (e) => e.currency === baseCurrency || e.currency === quoteCurrency
    );

    // Type for historical event with reaction data including prices
    type HistoricalEventData = {
      timestamp: number;
      actualValue?: number;
      forecastValue?: number;
      outcome: OutcomeType;
      spikeMagnitudePips: number;
      spikeDirection: string;
      didReverse: boolean;
      reversalMagnitudePips?: number;
      // Price data for educational display
      priceAtEvent: number;
      spikeHigh: number;
      spikeLow: number;
      // Settlement prices for timeline
      priceAtPlus5m: number;
      priceAtPlus15m: number;
      priceAtPlus30m: number;
      priceAtPlus1hr: number;
      priceAtPlus3hr?: number;
    };

    // Arrays to collect classified events
    const beatHistory: HistoricalEventData[] = [];
    const missHistory: HistoricalEventData[] = [];
    const rawHistory: HistoricalEventData[] = [];

    let hasForecastData = false;

    for (const event of events) {
      // Get reaction for this specific pair
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      // Skip if no reaction data for this pair
      if (!reaction) continue;

      const eventData: HistoricalEventData = {
        timestamp: event.timestamp,
        actualValue: event.actualValue,
        forecastValue: event.forecastValue,
        outcome: "inline" as OutcomeType,
        spikeMagnitudePips: reaction.spikeMagnitudePips,
        spikeDirection: reaction.spikeDirection,
        didReverse: reaction.didReverse,
        reversalMagnitudePips: reaction.reversalMagnitudePips,
        // Price data for educational display
        priceAtEvent: reaction.priceAtEvent,
        spikeHigh: reaction.spikeHigh,
        spikeLow: reaction.spikeLow,
        // Settlement prices for timeline
        priceAtPlus5m: reaction.priceAtPlus5m,
        priceAtPlus15m: reaction.priceAtPlus15m,
        priceAtPlus30m: reaction.priceAtPlus30m,
        priceAtPlus1hr: reaction.priceAtPlus1hr,
        priceAtPlus3hr: reaction.priceAtPlus3hr,
      };

      // Classify if both actual and forecast exist
      if (
        event.actualValue !== undefined &&
        event.forecastValue !== undefined
      ) {
        hasForecastData = true;
        const outcome = classifyOutcome(
          event.actualValue,
          event.forecastValue,
          args.eventType
        );
        eventData.outcome = outcome;

        if (outcome === "beat" && beatHistory.length < limit) {
          beatHistory.push({ ...eventData, outcome });
        } else if (outcome === "miss" && missHistory.length < limit) {
          missHistory.push({ ...eventData, outcome });
        }
      }

      // Always add to raw history (for speeches/no-forecast events)
      // Do this AFTER classification so outcome is correctly set
      if (rawHistory.length < limit) {
        rawHistory.push({ ...eventData });
      }

      // Stop early if all categories are full
      if (
        beatHistory.length >= limit &&
        missHistory.length >= limit &&
        rawHistory.length >= limit
      ) {
        break;
      }
    }

    return {
      hasForecastData,
      beatHistory,
      missHistory,
      rawHistory,
    };
  },
});
