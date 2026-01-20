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
  // NEWS EVENT TABLES REMOVED - Data now lives in TimescaleDB + ClickHouse
  // See: docs/trading-system-database-migration.md
  // Removed tables: economicEvents, eventPriceReactions, eventCandleWindows, eventTypeStatistics
  // ═══════════════════════════════════════════════════════════════════════════
});
