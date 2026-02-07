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

    // Structure context at entry (auto-populated from structure engine)
    mtfScoreAtEntry: v.optional(v.number()),          // Composite MTF score (-100 to +100)
    zoneAtEntry: v.optional(v.string()),              // "premium" | "discount" | "equilibrium"
    structureLinkCount: v.optional(v.number()),       // Denormalized count of linked structure entities

    // Plan vs Reality — Entry
    actualEntryPrice: v.optional(v.number()),    // What trader actually got filled at
    actualEntryTime: v.optional(v.number()),     // When entry actually filled (Unix ms)
    entrySlippagePips: v.optional(v.number()),   // Signed: positive = worse fill
    entryReason: v.optional(v.union(
      v.literal("limit"),        // Filled at planned price (limit order)
      v.literal("market"),       // Market order — may differ from planned
      v.literal("late"),         // Entered late (missed the planned level)
      v.literal("partial"),      // Partial fill
      v.literal("spread"),       // Slippage due to spread
      v.literal("other")         // Other reason
    )),

    // Plan vs Reality — Exit (exitPrice/exitTime already exist above)
    exitSlippagePips: v.optional(v.number()),    // Deviation from planned TP/SL
    closeReason: v.optional(v.union(
      v.literal("tp_hit"),           // TP hit automatically
      v.literal("sl_hit"),           // SL hit automatically
      v.literal("manual_profit"),    // Closed manually in profit
      v.literal("manual_loss"),      // Closed manually at a loss
      v.literal("breakeven"),        // Closed at breakeven
      v.literal("emotional"),        // Emotional decision
      v.literal("news"),             // News event incoming
      v.literal("thesis_broken"),    // Original trade thesis invalidated
      v.literal("timeout"),          // Time-based exit
      v.literal("other")            // Other reason
    )),
    closeReasonNote: v.optional(v.string()),     // Free-text elaboration

    // Trading session (auto-detected from entry time)
    session: v.optional(v.union(
      v.literal("Sydney"),
      v.literal("Tokyo"),
      v.literal("London"),
      v.literal("New York"),
      v.literal("Overlap")
    )),

    // Screenshots (URLs to stored images)
    entryScreenshot: v.optional(v.string()),  // Screenshot URL at entry
    exitScreenshot: v.optional(v.string()),   // Screenshot URL at exit

    // Creator — who initiated this trade
    createdBy: v.optional(v.union(
      v.literal("user"),       // Manual user trade
      v.literal("claude"),     // Claude AI trade idea
      v.literal("strategy")    // Strategy signal
    )),

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
  // TRADE SNAPSHOTS
  // Data-rich chart state captures at key moments in a trade's lifecycle
  // ═══════════════════════════════════════════════════════════════════════════
  snapshots: defineTable({
    userId: v.string(),
    tradeId: v.id("trades"),

    // Moment identification
    momentLabel: v.union(
      v.literal("setup"),     // Before entry (manual)
      v.literal("entry"),     // At trade entry (auto)
      v.literal("during"),    // Mid-trade checkpoint (manual)
      v.literal("exit")       // At trade close (auto)
    ),

    // Chart context
    pair: v.string(),
    timeframe: v.string(),
    timestamp: v.number(),    // When snapshot was taken (Unix ms)

    // Viewport
    visibleRange: v.object({
      from: v.number(),       // Earliest visible candle timestamp
      to: v.number(),         // Latest visible candle timestamp
    }),

    // Drawings snapshot (JSON string — immutable copy at capture time)
    drawings: v.string(),

    // Trade context at the moment of capture (JSON string)
    tradeContext: v.string(),

    // Optional metadata
    strategy: v.optional(v.string()),
    analysisNotes: v.optional(v.string()),
    aiDescription: v.optional(v.string()),

    // Structure context at capture time (JSON string)
    structureContext: v.optional(v.string()),

    // Auto vs manual
    createdBy: v.union(v.literal("auto"), v.literal("manual")),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_trade", ["tradeId"])
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURE LINKS
  // Links trades to structure entities (BOS, FVG, key levels, sweeps)
  // ═══════════════════════════════════════════════════════════════════════════
  structureLinks: defineTable({
    userId: v.string(),
    tradeId: v.id("trades"),
    entityType: v.union(
      v.literal("bos"),
      v.literal("fvg"),
      v.literal("key_level"),
      v.literal("sweep")
    ),
    entityId: v.string(),           // TimescaleDB entity ID: "${pair}-${timeframe}-${timestamp}"
    role: v.union(
      v.literal("entry_reason"),
      v.literal("exit_target"),
      v.literal("invalidation"),
      v.literal("confluence")
    ),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_trade", ["tradeId"])
    .index("by_entity", ["entityId"])
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURE PREFERENCES
  // Per-user chart structure overlay preferences
  // ═══════════════════════════════════════════════════════════════════════════
  structurePrefs: defineTable({
    userId: v.string(),
    overlayToggles: v.object({
      swings: v.boolean(),
      bos: v.boolean(),
      fvgs: v.boolean(),
      levels: v.boolean(),
      premiumDiscount: v.boolean(),
      sweeps: v.boolean(),
      hud: v.optional(v.boolean()),
    }),
    fvgMinTier: v.number(),         // 1, 2, or 3
    showRecentOnly: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]),

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

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT CONVERSATIONS
  // Claude AI chat sessions linked to chart context
  // ═══════════════════════════════════════════════════════════════════════════
  conversations: defineTable({
    userId: v.string(),              // Clerk user ID
    pair: v.string(),                // Chart pair at conversation start
    timeframe: v.string(),           // Chart timeframe at start
    title: v.optional(v.string()),   // Auto-generated from first message
    model: v.string(),               // "haiku" | "sonnet" | "opus"
    messageCount: v.number(),
    tokenUsage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheReadTokens: v.number(),
    }),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    // Context management
    summary: v.optional(v.string()),                        // Compacted older messages
    summaryUpToMessage: v.optional(v.id("chatMessages")),   // Last message included in summary
    summaryTokenEstimate: v.optional(v.number()),           // Token count of the summary text
    status: v.optional(v.string()),                          // "active" | "completed"
    parentConversationId: v.optional(v.id("conversations")), // Link to previous conversation (splitting)
  })
    .index("by_user", ["userId", "lastMessageAt"])
    .index("by_pair", ["pair", "lastMessageAt"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVED BACKTESTING QUERIES
  // User-saved query configurations for the backtesting page
  // ═══════════════════════════════════════════════════════════════════════════
  savedQueries: defineTable({
    userId: v.string(),
    name: v.string(),
    config: v.string(),     // JSON: { pairs, timeframes, dateRange, entityType, filters }
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT MESSAGES
  // Individual messages within conversations
  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTS
  // Real-time notifications: structure events, price crossings, news, trades
  // ═══════════════════════════════════════════════════════════════════════════
  alerts: defineTable({
    userId: v.string(),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    pair: v.optional(v.string()),
    timeframe: v.optional(v.string()),
    severity: v.string(),
    read: v.boolean(),
    metadata: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_unread", ["userId", "read", "createdAt"])
    .index("by_user_created", ["userId", "createdAt"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERT PREFERENCES
  // Per-user alert type toggles
  // ═══════════════════════════════════════════════════════════════════════════
  alertPreferences: defineTable({
    userId: v.string(),
    structureAlerts: v.boolean(),
    priceAlerts: v.boolean(),
    newsAlerts: v.boolean(),
    tradeAlerts: v.boolean(),
    browserNotifications: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAT MESSAGES
  // Individual messages within conversations
  // ═══════════════════════════════════════════════════════════════════════════
  chatMessages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    toolCalls: v.optional(v.string()),       // JSON: tool calls made
    toolResults: v.optional(v.string()),     // JSON: tool results
    drawingActions: v.optional(v.string()),  // JSON: drawings created/modified
    tokenUsage: v.optional(v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
    })),
    model: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "createdAt"]),
});
