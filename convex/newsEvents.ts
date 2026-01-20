import {
  action,
  mutation,
  internalMutation,
  query,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Pairs to fetch windows for
export const NEWS_PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
] as const;

// Event type definitions for linking related events
const EVENT_RELATIONSHIPS: Record<
  string,
  { relatedTo: string; typicalDelayMinutes: number }
> = {
  FOMC_PRESSER: { relatedTo: "FOMC", typicalDelayMinutes: 30 },
  ECB_PRESSER: { relatedTo: "ECB", typicalDelayMinutes: 45 },
  BOE_PRESSER: { relatedTo: "BOE", typicalDelayMinutes: 30 },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map currency code to country code
 */
function currencyToCountry(currency: string): string {
  const map: Record<string, string> = {
    USD: "US",
    EUR: "EU",
    GBP: "GB",
    JPY: "JP",
    AUD: "AU",
    NZD: "NZ",
    CAD: "CA",
    CHF: "CH",
    CNY: "CN",
    HKD: "HK",
    SGD: "SG",
    SEK: "SE",
    NOK: "NO",
    MXN: "MX",
    ZAR: "ZA",
    INR: "IN",
    BRL: "BR",
    KRW: "KR",
  };
  return map[currency] || currency;
}

/**
 * Parse event value strings like "4.50%", "256K", "-0.3%", "1.2M"
 */
function parseEventValue(value: string | undefined): number | undefined {
  if (!value || value === "-" || value === "") return undefined;

  // Remove % and commas
  let cleaned = value.replace(/[%,]/g, "").trim();

  // Handle multipliers
  let multiplier = 1;
  if (cleaned.endsWith("K") || cleaned.endsWith("k")) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith("M") || cleaned.endsWith("m")) {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith("B") || cleaned.endsWith("b")) {
    multiplier = 1000000000;
    cleaned = cleaned.slice(0, -1);
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num * multiplier;
}

/**
 * Normalize event type from full name to canonical type
 */
function normalizeEventType(name: string): string {
  const mapping: Record<string, string> = {
    "FOMC Statement": "FOMC",
    "Federal Funds Rate": "FOMC",
    "Fed Interest Rate Decision": "FOMC",
    "FOMC Press Conference": "FOMC_PRESSER",
    "Non-Farm Employment Change": "NFP",
    "Nonfarm Payrolls": "NFP",
    "Unemployment Rate": "UNEMPLOYMENT",
    "CPI m/m": "CPI_MOM",
    "CPI y/y": "CPI_YOY",
    "Core CPI m/m": "CORE_CPI_MOM",
    "Core CPI y/y": "CORE_CPI_YOY",
    "Consumer Price Index": "CPI",
    "Advance GDP q/q": "GDP",
    "Prelim GDP q/q": "GDP",
    "Final GDP q/q": "GDP",
    "GDP Growth Rate": "GDP",
    "Retail Sales m/m": "RETAIL_SALES",
    "Core Retail Sales m/m": "CORE_RETAIL_SALES",
    "PPI m/m": "PPI_MOM",
    "PPI y/y": "PPI_YOY",
    "Core PPI m/m": "CORE_PPI",
    "Fed Chair Powell Speaks": "FED_SPEAKS",
    "Main Refinancing Rate": "ECB",
    "ECB Interest Rate Decision": "ECB",
    "ECB Press Conference": "ECB_PRESSER",
    "German CPI m/m": "GERMAN_CPI",
    "CPI Flash Estimate y/y": "EU_CPI_FLASH",
    "Official Bank Rate": "BOE",
    "BoE Interest Rate Decision": "BOE",
    "BOE Monetary Policy Summary": "BOE",
    "MPC Official Bank Rate Votes": "BOE",
    "UK CPI y/y": "UK_CPI",
    "UK GDP m/m": "UK_GDP",
    "BOJ Policy Rate": "BOJ",
    "BoJ Interest Rate Decision": "BOJ",
    "RBA Rate Statement": "RBA",
    "Cash Rate": "RBA",
    "RBNZ Rate Statement": "RBNZ",
    "Official Cash Rate": "RBNZ",
    "SNB Policy Rate": "SNB",
    "SNB Interest Rate Decision": "SNB",
    "Overnight Rate": "BOC",
    "BoC Interest Rate Decision": "BOC",
  };

  return mapping[name] || name.toUpperCase().replace(/\s+/g, "_");
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert a single economic event
 * Supports smart upsert: only updates if scrapedAt is newer
 */
export const upsertEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    name: v.string(),
    country: v.string(),
    currency: v.string(),
    timestamp: v.number(),
    scrapedAt: v.optional(v.number()),
    status: v.string(),
    dayOfWeek: v.optional(v.string()),
    tradingSession: v.optional(v.string()),
    impact: v.string(),
    actual: v.optional(v.string()),
    forecast: v.optional(v.string()),
    previous: v.optional(v.string()),
    actualValue: v.optional(v.number()),
    forecastValue: v.optional(v.number()),
    previousValue: v.optional(v.number()),
    deviation: v.optional(v.number()),
    deviationPct: v.optional(v.number()),
    outcome: v.optional(v.string()),
    surpriseZScore: v.optional(v.number()),
    relatedEventId: v.optional(v.string()),
    isFollowUp: v.boolean(),
    description: v.optional(v.string()),
    reactionsCalculated: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (existing) {
      // Smart upsert: only update if new data is more recent
      if (args.scrapedAt && existing.scrapedAt && args.scrapedAt <= existing.scrapedAt) {
        return existing._id; // Skip - existing data is newer or same
      }
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("economicEvents", args);
  },
});

/**
 * Mark an event as having reactions calculated
 */
export const markEventProcessed = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (event) {
      await ctx.db.patch(event._id, { reactionsCalculated: true });
    }
  },
});

/**
 * Batch update impact levels for existing events
 * Used by fix-event-impacts script to correct the original backfill
 */
export const batchUpdateImpact = mutation({
  args: {
    updates: v.array(
      v.object({
        eventId: v.string(),
        impact: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let updated = 0;
    let skipped = 0;

    for (const update of args.updates) {
      const event = await ctx.db
        .query("economicEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", update.eventId))
        .first();

      if (event) {
        // Only update if impact is different
        if (event.impact !== update.impact) {
          await ctx.db.patch(event._id, { impact: update.impact });
          updated++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    return { updated, skipped };
  },
});

/**
 * Update impact for a single event by name + currency + date
 * Processes one event at a time to avoid read limits
 */
export const updateSingleEventImpact = mutation({
  args: {
    name: v.string(),
    currency: v.string(),
    targetTimestamp: v.number(), // UTC timestamp from CSV
    impact: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string; eventId?: string }> => {
    // MQL5 offset: database timestamps are UTC+2
    const MQL5_OFFSET = 2 * 60 * 60 * 1000;
    // Narrow 3-hour window to reduce reads
    const WINDOW = 3 * 60 * 60 * 1000;

    const dbTimestamp = args.targetTimestamp + MQL5_OFFSET;
    const startTime = dbTimestamp - WINDOW;
    const endTime = dbTimestamp + WINDOW;

    // Query by currency index (more selective than timestamp for specific currency)
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_currency", (q) => q.eq("currency", args.currency))
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), startTime),
          q.lte(q.field("timestamp"), endTime)
        )
      )
      .take(30);

    // Find match by name
    const nameLower = args.name.toLowerCase();
    const match = events.find((e) => e.name.toLowerCase() === nameLower);

    if (match) {
      if (match.impact !== args.impact) {
        await ctx.db.patch(match._id, { impact: args.impact });
        return { status: "updated", eventId: match.eventId };
      }
      return { status: "skipped", eventId: match.eventId };
    }
    return { status: "notFound" };
  },
});

/**
 * Update event impact by exact eventId match
 * More reliable than timestamp-based matching
 */
export const updateEventImpactById = mutation({
  args: {
    eventId: v.string(),
    impact: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const event = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (!event) {
      return { status: "notFound" };
    }

    if (event.impact === args.impact) {
      return { status: "skipped" };
    }

    await ctx.db.patch(event._id, { impact: args.impact });
    return { status: "updated" };
  },
});

/**
 * Mark an event's windows as complete (even if 0 windows for weekend events)
 */
export const markEventWindowsComplete = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (event && !event.windowsComplete) {
      await ctx.db.patch(event._id, { windowsComplete: true });
    }
  },
});

/**
 * Store a candle window for an event
 */
export const storeEventCandleWindow = internalMutation({
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

    let windowId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        candles: args.candles,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
      });
      windowId = existing._id;
    } else {
      windowId = await ctx.db.insert("eventCandleWindows", args);
    }

    // Check if this completes all 7 windows and mark event as complete
    const windowCount = await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(7);

    if (windowCount.length >= 7) {
      const event = await ctx.db
        .query("economicEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
        .first();
      if (event && !event.windowsComplete) {
        await ctx.db.patch(event._id, { windowsComplete: true });
      }
    }

    return windowId;
  },
});

/**
 * Public mutation for bulk uploading candle windows from local script
 */
export const uploadEventCandleWindow = mutation({
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

    let windowId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        candles: args.candles,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
      });
      windowId = existing._id;
    } else {
      windowId = await ctx.db.insert("eventCandleWindows", args);
    }

    // Check if this completes all 7 windows and mark event as complete
    const windowCount = await ctx.db
      .query("eventCandleWindows")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .take(7);

    if (windowCount.length >= 7) {
      const event = await ctx.db
        .query("economicEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
        .first();
      if (event && !event.windowsComplete) {
        await ctx.db.patch(event._id, { windowsComplete: true });
      }
    }

    return windowId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get events that need candle windows fetched
 * Filters by year range and excludes events that already have windows
 */
export const getEventsNeedingWindows = query({
  args: {
    limit: v.optional(v.number()),
    fromYear: v.optional(v.number()),
    toYear: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    // Default: 2015-01-01 to 2026-01-01
    const fromTimestamp = args.fromYear
      ? new Date(`${args.fromYear}-01-01`).getTime()
      : 1420070400000;
    const toTimestamp = args.toYear
      ? new Date(`${args.toYear}-01-01`).getTime()
      : new Date("2026-01-01").getTime();

    // Get events in year range that haven't been processed
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp")
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), fromTimestamp),
          q.lt(q.field("timestamp"), toTimestamp),
          q.eq(q.field("reactionsCalculated"), false)
        )
      )
      .take(limit * 2); // Get extra to filter out ones with windows

    // Check which events already have windows stored
    const eventsNeedingWindows = [];
    for (const event of events) {
      if (eventsNeedingWindows.length >= limit) break;

      // Check if this event already has at least one window
      const existingWindow = await ctx.db
        .query("eventCandleWindows")
        .withIndex("by_event", (q) => q.eq("eventId", event.eventId))
        .first();

      if (!existingWindow) {
        eventsNeedingWindows.push(event);
      }
    }

    return eventsNeedingWindows;
  },
});

/**
 * Get events by impact level that need candle windows fetched
 * Used for tiered backfill strategy
 *
 * NOTE: Does NOT filter by reactionsCalculated - windows must be fetched
 * regardless of whether reactions have been calculated yet.
 *
 * Uses pagination cursor to handle large datasets without exceeding byte limits.
 * Optimized to minimize bytes read by checking only if 7 windows exist.
 */
export const getEventsNeedingWindowsByImpact = query({
  args: {
    impact: v.string(), // "high" | "medium" | "low"
    limit: v.optional(v.number()),
    fromYear: v.optional(v.number()),
    toYear: v.optional(v.number()),
    cursor: v.optional(v.number()), // Timestamp cursor for pagination
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    const effectiveLimit = Math.min(limit, 20); // Reduced to avoid doc limit as more events marked complete
    const fromTimestamp = args.cursor || (args.fromYear
      ? new Date(`${args.fromYear}-01-01`).getTime()
      : 1420070400000);
    const toTimestamp = args.toYear
      ? new Date(`${args.toYear}-01-01`).getTime()
      : new Date("2027-01-01").getTime();

    // Get events by impact that don't have windowsComplete set
    // Skip Sunday/Saturday events (market closed - no OANDA data)
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_impact", (q) => q.eq("impact", args.impact))
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), fromTimestamp),
          q.lt(q.field("timestamp"), toTimestamp),
          q.neq(q.field("windowsComplete"), true),
          q.neq(q.field("dayOfWeek"), "Sun"),
          q.neq(q.field("dayOfWeek"), "Sat")
        )
      )
      .take(effectiveLimit + 5);

    const eventsNeedingWindows = events.slice(0, effectiveLimit);
    const lastTimestamp = events.length > 0
      ? events[events.length - 1].timestamp
      : fromTimestamp;

    // Return cursor for next page if there might be more
    const hasMore = events.length > effectiveLimit;
    const nextCursor = hasMore ? lastTimestamp + 1 : null;

    return {
      events: eventsNeedingWindows,
      nextCursor,
      hasMore,
    };
  },
});

/**
 * Get an event by ID
 */
export const getEventById = query({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
  },
});

/**
 * Get candle window for an event and pair
 */
export const getCandleWindow = query({
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
 * Get event IDs that have windowsComplete = true (for local backfill script)
 * Returns paginated list of completed event IDs
 */
export const getCompletedEventIds = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 1000;

    // Get events with windowsComplete = true
    const events = await ctx.db
      .query("economicEvents")
      .filter((q) => q.eq(q.field("windowsComplete"), true))
      .take(limit + 1);

    const hasMore = events.length > limit;
    const resultEvents = hasMore ? events.slice(0, limit) : events;

    return {
      eventIds: resultEvents.map((e) => e.eventId),
      hasMore,
      nextCursor: hasMore && resultEvents.length > 0 ? resultEvents[resultEvents.length - 1]._id : null,
    };
  },
});

/**
 * Find potential parent event for linking follow-ups (internal query)
 */
export const findPotentialParentEvent = internalQuery({
  args: {
    eventType: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_type_timestamp", (q) => q.eq("eventType", args.eventType))
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), args.windowStart),
          q.lte(q.field("timestamp"), args.windowEnd)
        )
      )
      .first();

    return events;
  },
});

/**
 * Get recent events that need candle windows (for cron job)
 * Returns events in time range that don't have windowsComplete = true
 */
export const getRecentEventsNeedingWindows = internalQuery({
  args: {
    fromTimestamp: v.number(),
    toTimestamp: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    // Get events in time range that need windows
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_timestamp")
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), args.fromTimestamp),
          q.lt(q.field("timestamp"), args.toTimestamp),
          q.neq(q.field("windowsComplete"), true),
          q.neq(q.field("dayOfWeek"), "Sat"),
          q.neq(q.field("dayOfWeek"), "Sun"),
          q.neq(q.field("impact"), "non_economic")
        )
      )
      .take(limit);

    return events.map((e) => ({
      eventId: e.eventId,
      timestamp: e.timestamp,
      eventType: e.eventType,
      impact: e.impact,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS (require Node.js for fetch)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upload events from external scripts (bulk upload)
 * Accepts data directly from the ForexFactory scraper JSONL format
 */
export const uploadEvents = action({
  args: {
    events: v.array(
      v.object({
        // From scraper
        event_id: v.string(),
        status: v.string(),
        timestamp_utc: v.number(),
        scraped_at: v.number(),
        day_of_week: v.string(),
        trading_session: v.string(),
        currency: v.string(),
        impact: v.string(),
        event: v.string(), // event name
        actual: v.optional(v.union(v.string(), v.null())),
        forecast: v.optional(v.union(v.string(), v.null())),
        previous: v.optional(v.union(v.string(), v.null())),
        deviation: v.optional(v.union(v.number(), v.null())),
        deviation_pct: v.optional(v.union(v.number(), v.null())),
        outcome: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    let uploaded = 0;

    for (const event of args.events) {
      // Parse numeric values from strings
      const actualValue = parseEventValue(event.actual ?? undefined);
      const forecastValue = parseEventValue(event.forecast ?? undefined);
      const previousValue = parseEventValue(event.previous ?? undefined);

      // Normalize event type from name
      const normalizedType = normalizeEventType(event.event);

      // Derive country from currency
      const country = currencyToCountry(event.currency);

      // Check for event relationships
      const relationship = EVENT_RELATIONSHIPS[normalizedType];
      let relatedEventId: string | undefined;
      let isFollowUp = false;

      if (relationship) {
        // Look for parent event within typical delay window
        const windowStart =
          event.timestamp_utc - relationship.typicalDelayMinutes * 2 * 60 * 1000;
        const parentEvent = await ctx.runQuery(
          internal.newsEvents.findPotentialParentEvent,
          {
            eventType: relationship.relatedTo,
            windowStart,
            windowEnd: event.timestamp_utc,
          }
        );

        if (parentEvent) {
          relatedEventId = parentEvent.eventId;
          isFollowUp = true;
        }
      }

      await ctx.runMutation(internal.newsEvents.upsertEvent, {
        eventId: event.event_id,
        eventType: normalizedType,
        name: event.event,
        country,
        currency: event.currency,
        timestamp: event.timestamp_utc,
        scrapedAt: event.scraped_at,
        status: event.status,
        dayOfWeek: event.day_of_week,
        tradingSession: event.trading_session,
        impact: event.impact,
        actual: event.actual ?? undefined,
        forecast: event.forecast ?? undefined,
        previous: event.previous ?? undefined,
        actualValue,
        forecastValue,
        previousValue,
        deviation: event.deviation ?? undefined,
        deviationPct: event.deviation_pct ?? undefined,
        outcome: event.outcome ?? undefined,
        surpriseZScore: undefined, // Calculated later with historicalStdDev
        relatedEventId,
        isFollowUp,
        description: undefined,
        reactionsCalculated: false,
      });

      uploaded++;
    }

    return { uploaded };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEAR/DELETE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clear all documents from economicEvents table
 * Run in batches to avoid timeout
 */
export const clearEconomicEvents = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize || 500;
    const docs = await ctx.db.query("economicEvents").take(batchSize);

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: docs.length, hasMore: docs.length === batchSize };
  },
});

/**
 * Clear all documents from eventCandleWindows table
 */
export const clearEventCandleWindows = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize || 200; // Smaller batch - these are big docs
    const docs = await ctx.db.query("eventCandleWindows").take(batchSize);

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: docs.length, hasMore: docs.length === batchSize };
  },
});

/**
 * Backfill windowsComplete field for events that already have 7 windows
 * Uses impact index to avoid full table scan
 */
export const backfillWindowsComplete = mutation({
  args: {
    impact: v.optional(v.string()), // "high" | "medium" | "low"
    batchSize: v.optional(v.number()),
    fromYear: v.optional(v.number()),
    cursor: v.optional(v.number()), // Timestamp cursor
  },
  handler: async (ctx, args) => {
    const impact = args.impact || "high";
    const batchSize = args.batchSize || 50;
    const fromTimestamp = args.cursor || (args.fromYear
      ? new Date(`${args.fromYear}-01-01`).getTime()
      : new Date("2015-01-01").getTime());

    // Use impact index to reduce scan size
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_impact", (q) => q.eq("impact", impact))
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), fromTimestamp),
          q.neq(q.field("windowsComplete"), true)
        )
      )
      .take(batchSize);

    let marked = 0;
    let lastTimestamp = fromTimestamp;

    for (const event of events) {
      lastTimestamp = event.timestamp;

      // Count windows for this event
      const windows = await ctx.db
        .query("eventCandleWindows")
        .withIndex("by_event", (q) => q.eq("eventId", event.eventId))
        .take(7);

      // Mark complete if has all 7 windows
      if (windows.length >= 7) {
        await ctx.db.patch(event._id, { windowsComplete: true });
        marked++;
      }
    }

    const hasMore = events.length === batchSize;
    const nextCursor = hasMore ? lastTimestamp + 1 : null;

    return {
      impact,
      checked: events.length,
      marked,
      hasMore,
      nextCursor,
    };
  },
});

/**
 * Clear all documents from eventPriceReactions table
 */
export const clearEventPriceReactions = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize || 500;
    const docs = await ctx.db.query("eventPriceReactions").take(batchSize);

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: docs.length, hasMore: docs.length === batchSize };
  },
});

/**
 * Clear all documents from eventTypeStatistics table
 */
export const clearEventTypeStatistics = mutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize || 500;
    const docs = await ctx.db.query("eventTypeStatistics").take(batchSize);

    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }

    return { deleted: docs.length, hasMore: docs.length === batchSize };
  },
});
