import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  candles: defineTable({
    pair: v.string(), // "EUR_USD"
    timeframe: v.string(), // "M5", "M15", "H1", "H4", "D" (M5 is floor - no M1)
    timestamp: v.number(), // Unix timestamp (ms)
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    volume: v.number(),
    complete: v.boolean(), // Is candle closed?
  })
    .index("by_pair_tf", ["pair", "timeframe"])
    .index("by_pair_tf_time", ["pair", "timeframe", "timestamp"]),

  // Session highs/lows for each trading day
  sessions: defineTable({
    pair: v.string(), // "EUR_USD"
    date: v.string(), // "2024-01-17" (trading day in NY time)
    session: v.string(), // "ASIA" | "LONDON" | "NY"
    high: v.number(),
    low: v.number(),
    highTime: v.number(), // Unix ms when high was made
    lowTime: v.number(), // Unix ms when low was made
    startTime: v.number(), // Session start (Unix ms)
    endTime: v.number(), // Session end (Unix ms)
    complete: v.boolean(), // Has session ended?
  })
    .index("by_pair_date", ["pair", "date"])
    .index("by_pair_session", ["pair", "session"])
    .index("by_pair_date_session", ["pair", "date", "session"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // NEWS EVENT IMPACT SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  // Economic event metadata (one per event occurrence)
  economicEvents: defineTable({
    // Identity
    eventId: v.string(), // "{name}_{currency}_{YYYY-MM-DD}_{HH:MM}" e.g. "CPI_m_m_USD_2024-01-15_14:30"
    eventType: v.string(), // "FOMC", "NFP", "CPI" (derived/categorized)
    name: v.string(), // "CPI m/m" (original event name)

    // Location/Currency
    country: v.string(), // "US" (derived from currency)
    currency: v.string(), // "USD"

    // Timing
    timestamp: v.number(), // Unix ms (UTC)
    scrapedAt: v.optional(v.number()), // When data was scraped (for upsert tracking)

    // Status & Session (from scraper)
    status: v.string(), // "scheduled" | "released"
    dayOfWeek: v.optional(v.string()), // "Mon", "Tue", etc.
    tradingSession: v.optional(v.string()), // "asian" | "london" | "new_york" | "london_ny_overlap" | "off_hours"

    // Impact level
    impact: v.string(), // "high" | "medium" | "low" | "non_economic"

    // Values (strings for display: "4.50%", "256K")
    actual: v.optional(v.string()),
    forecast: v.optional(v.string()),
    previous: v.optional(v.string()),

    // Parsed numeric values
    actualValue: v.optional(v.number()),
    forecastValue: v.optional(v.number()),
    previousValue: v.optional(v.number()),

    // Pre-computed from scraper (actual - forecast)
    deviation: v.optional(v.number()),
    deviationPct: v.optional(v.number()),
    outcome: v.optional(v.string()), // "beat" | "miss" | "met" | null (for scheduled)

    // Z-score normalized: (actual - forecast) / historicalStdDev (calculated post-import)
    surpriseZScore: v.optional(v.number()),

    // Event relationships (FOMC decision → press conference)
    relatedEventId: v.optional(v.string()),
    isFollowUp: v.boolean(), // true = this is a follow-up event

    // Context
    description: v.optional(v.string()),

    // Processing status
    reactionsCalculated: v.boolean(), // Has price reaction been computed?
    windowsComplete: v.optional(v.boolean()), // All 7 pair windows fetched?
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_type", ["eventType"])
    .index("by_currency", ["currency"])
    .index("by_currency_timestamp", ["currency", "timestamp"])
    .index("by_event_id", ["eventId"])
    .index("by_related", ["relatedEventId"])
    .index("by_type_timestamp", ["eventType", "timestamp"])
    .index("by_status", ["status"])
    .index("by_impact", ["impact"]),

  // Price reaction per event per pair
  eventPriceReactions: defineTable({
    eventId: v.string(), // Links to economicEvents
    pair: v.string(), // "EUR_USD"
    eventTimestamp: v.number(), // Denormalized for queries

    // Pre-event prices
    priceAtMinus15m: v.number(),
    priceAtMinus5m: v.number(),
    priceAtMinus1m: v.number(),
    priceAtEvent: v.number(),

    // Spike data (first 5 minutes)
    spikeHigh: v.number(),
    spikeLow: v.number(),
    spikeDirection: v.string(), // "UP" | "DOWN"
    spikeMagnitudePips: v.number(),
    timeToSpikeSec: v.optional(v.number()),

    // Settlement prices
    priceAtPlus5m: v.number(),
    priceAtPlus15m: v.number(),
    priceAtPlus30m: v.number(),
    priceAtPlus1hr: v.number(),
    priceAtPlus3hr: v.optional(v.number()),

    // Pattern classification
    patternType: v.string(), // "spike_reversal", "continuation", "fade", "range"
    didReverse: v.boolean(),
    reversalMagnitudePips: v.optional(v.number()),
    finalDirectionMatchesSpike: v.boolean(),
  })
    .index("by_event", ["eventId"])
    .index("by_pair", ["pair"])
    .index("by_pair_event", ["pair", "eventId"])
    .index("by_pair_timestamp", ["pair", "eventTimestamp"])
    .index("by_pattern", ["patternType"]),

  // 1-minute candle windows around events (stored separately from main candles)
  eventCandleWindows: defineTable({
    eventId: v.string(),
    pair: v.string(),
    eventTimestamp: v.number(), // Denormalized for sorting
    windowStart: v.number(), // T-15min timestamp
    windowEnd: v.number(), // T+60min timestamp

    // Array of 1-minute candles (75 candles per window)
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
    .index("by_event", ["eventId"])
    .index("by_pair_event", ["pair", "eventId"])
    .index("by_pair_timestamp", ["pair", "eventTimestamp"]),

  // Aggregated statistics per event type per pair
  eventTypeStatistics: defineTable({
    eventType: v.string(), // "FOMC"
    pair: v.string(), // "EUR_USD"

    // Sample info
    sampleSize: v.number(),
    dateRangeStart: v.number(),
    dateRangeEnd: v.number(),
    lastUpdated: v.number(),

    // For z-score calculation
    historicalStdDev: v.number(), // StdDev of (actual-forecast) for this event type

    // Spike stats
    avgSpikePips: v.number(),
    medianSpikePips: v.number(),
    maxSpikePips: v.number(),
    minSpikePips: v.number(),
    stdDevSpikePips: v.number(),

    // Direction stats
    spikeUpCount: v.number(),
    spikeDownCount: v.number(),
    spikeUpPct: v.number(),

    // Reversal stats
    reversalWithin30minCount: v.number(),
    reversalWithin1hrCount: v.number(),
    reversalWithin30minPct: v.number(),
    reversalWithin1hrPct: v.number(),
    finalMatchesSpikeCount: v.number(),

    // Pattern distribution
    patternCounts: v.object({
      spike_reversal: v.number(),
      continuation: v.number(),
      fade: v.number(),
      range: v.number(),
    }),

    // === CONDITIONAL STATS (Beat/Miss/Inline) ===
    // Whether this event type has forecast data
    hasForecastData: v.optional(v.boolean()),

    // Stats when actual beats forecast
    beatStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),

    // Stats when actual misses forecast
    missStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),

    // Stats when actual is inline with forecast (within threshold)
    inlineStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
  })
    .index("by_type_pair", ["eventType", "pair"])
    .index("by_type", ["eventType"]),
});
