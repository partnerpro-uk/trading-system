import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════════
// CONVEX SCHEMA - Application Layer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Per data architecture:
// - Candles → TimescaleDB (live 30d) + ClickHouse (historical)
// - Sessions → TimescaleDB (session_levels table)
// - News Events → TimescaleDB + ClickHouse
// - Event Reactions/Windows/Stats → TimescaleDB + ClickHouse
//
// CONVEX stores:
// - Drawings (user-created chart drawings)
// - Live Trades (user's trade journal)
// - Strategy Settings (per-user customizations)
// ═══════════════════════════════════════════════════════════════════════════════

export default defineSchema({
  // ═══════════════════════════════════════════════════════════════════════════
  // USERS
  // User profiles synced from Clerk
  // ═══════════════════════════════════════════════════════════════════════════
  users: defineTable({
    clerkId: v.string(),          // Clerk user ID (subject)
    email: v.string(),
    name: v.optional(v.string()),
    isAdmin: v.boolean(),         // Admin flag for viewing all users' stats
    createdAt: v.number(),
    lastLoginAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // USER PREFERENCES
  // Drawing styling preferences (replaces localStorage)
  // ═══════════════════════════════════════════════════════════════════════════
  userPreferences: defineTable({
    userId: v.string(),           // Clerk user ID
    lastLineColor: v.string(),
    lastLineWidth: v.number(),
    lastLineStyle: v.string(),
    lastFillColor: v.string(),
    lastBorderColor: v.string(),
    lastTpColor: v.string(),
    lastSlColor: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // CHART DRAWINGS
  // Fibonacci, trendlines, rectangles, positions, etc.
  // ═══════════════════════════════════════════════════════════════════════════
  drawings: defineTable({
    // User identification (optional for backwards compat with existing data)
    userId: v.optional(v.string()),

    // Chart context
    pair: v.string(),                    // e.g., "EUR_USD"
    timeframe: v.string(),               // e.g., "M15"

    // Optional associations
    strategyId: v.optional(v.string()),  // Associated strategy
    tradeId: v.optional(v.id("trades")), // Associated trade

    // Drawing type
    type: v.union(
      v.literal("fibonacci"),
      v.literal("trendline"),
      v.literal("ray"),
      v.literal("arrow"),
      v.literal("extendedLine"),
      v.literal("horizontalLine"),
      v.literal("verticalLine"),
      v.literal("rectangle"),
      v.literal("parallelChannel"),
      v.literal("position")
    ),

    // Anchor points and configuration stored as JSON for flexibility
    anchors: v.string(),  // JSON: { anchor1: {timestamp, price}, anchor2: {...} }
    config: v.string(),   // JSON: type-specific config (levels, colors, etc.)

    // Metadata
    createdBy: v.union(
      v.literal("user"),
      v.literal("strategy"),
      v.literal("claude")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pair_timeframe", ["pair", "timeframe"])
    .index("by_strategy", ["strategyId"])
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE TRADES
  // User's live trade journal (not backtests)
  // ═══════════════════════════════════════════════════════════════════════════
  trades: defineTable({
    // User identification (optional for backwards compat with existing data)
    userId: v.optional(v.string()),

    // Strategy association
    strategyId: v.string(),

    // Trade data
    pair: v.string(),
    timeframe: v.string(),
    direction: v.union(v.literal("LONG"), v.literal("SHORT")),

    // Entry
    entryTime: v.number(),      // Unix timestamp (ms)
    entryPrice: v.number(),

    // Exit (nullable until closed)
    exitTime: v.optional(v.number()),
    exitPrice: v.optional(v.number()),

    // Risk management
    stopLoss: v.number(),
    takeProfit: v.number(),

    // Position sizing
    quantity: v.optional(v.number()),
    riskPercent: v.optional(v.number()),

    // Outcome
    outcome: v.optional(v.union(
      v.literal("TP"),   // Take profit hit
      v.literal("SL"),   // Stop loss hit
      v.literal("MW"),   // Manual win
      v.literal("ML"),   // Manual loss
      v.literal("BE")    // Break even
    )),
    pnlPips: v.optional(v.number()),
    pnlDollars: v.optional(v.number()),
    barsHeld: v.optional(v.number()),

    // Max Adverse Excursion (drawdown before profit)
    maxDrawdownPips: v.optional(v.number()),  // How far trade went against before recovering

    // Context (for Claude analysis)
    indicatorSnapshot: v.optional(v.string()),  // JSON of all indicator values at entry
    conditionsMet: v.optional(v.array(v.string())),  // Which strategy conditions triggered
    notes: v.optional(v.string()),

    // Screenshots (URLs to stored images)
    entryScreenshot: v.optional(v.string()),  // Screenshot URL at entry
    exitScreenshot: v.optional(v.string()),   // Screenshot URL at exit

    // Status
    status: v.union(
      v.literal("pending"),    // Order placed but not filled
      v.literal("open"),       // Position open
      v.literal("closed"),     // Position closed
      v.literal("cancelled")   // Order cancelled
    ),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_strategy", ["strategyId"])
    .index("by_pair", ["pair"])
    .index("by_status", ["status"])
    .index("by_entry_time", ["entryTime"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // STRATEGY SETTINGS
  // Per-user strategy customizations
  // ═══════════════════════════════════════════════════════════════════════════
  strategySettings: defineTable({
    // User identification (optional for backwards compat with existing data)
    userId: v.optional(v.string()),

    // Strategy identification
    strategyId: v.string(),

    // Override default params
    params: v.optional(v.string()),  // JSON: { take_profit_amount: 2500, ... }

    // Visual preferences
    indicatorColors: v.optional(v.string()),   // JSON: { ema_30: "#blue", ... }
    indicatorVisibility: v.optional(v.string()), // JSON: { ema_30: true, ... }

    // Enabled state
    enabled: v.boolean(),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_strategy", ["userId", "strategyId"]),
});
