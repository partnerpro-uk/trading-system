# Trade Journal & Position Sync — Architecture

> Last Updated: 2026-02-06 (v1.0)

## Overview

The trade journal lives in Convex and automatically syncs with position drawings on the chart. When a trader (or Claude) creates a long/short position drawing, it flows through a sync pipeline that creates a trade record, monitors for TP/SL hits, and tracks max drawdown — all in real-time.

## Key Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Trades table definition |
| `convex/trades.ts` | Trade CRUD mutations + queries |
| `src/hooks/usePositionSync.ts` | Drawing → Convex sync hook |
| `lib/drawings/store.ts` | Position drawing creation (signal defaults) |
| `src/app/trades/page.tsx` | Trade journal UI page |

## Convex Trades Schema

```typescript
trades: defineTable({
  // Identity
  strategyId: v.string(),
  pair: v.string(),
  timeframe: v.string(),
  direction: v.string(),       // "LONG" | "SHORT"
  createdBy: v.optional(v.union(
    v.literal("user"),
    v.literal("claude"),
    v.literal("strategy")
  )),

  // Entry
  entryTime: v.number(),
  entryPrice: v.number(),
  stopLoss: v.number(),
  takeProfit: v.number(),
  quantity: v.optional(v.number()),
  notes: v.optional(v.string()),

  // Exit (filled on close)
  exitTime: v.optional(v.number()),
  exitPrice: v.optional(v.number()),
  outcome: v.optional(v.string()),    // "TP" | "SL" | "manual"
  pnlPips: v.optional(v.number()),
  barsHeld: v.optional(v.number()),

  // Risk metrics
  maxDrawdownPips: v.optional(v.number()),

  // Status
  status: v.string(),                 // "open" | "closed"
})
```

Indexed by: `pair`, `strategyId`, `status`, `entryTime`.

## Position Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      Position Lifecycle                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Claude / Strategy creates position:                             │
│  ┌──────────┐                                                    │
│  │ "signal"  │  Visual indicator only. NOT synced to journal.    │
│  └────┬─────┘                                                    │
│       │ Trader confirms                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │ "pending" │  Waiting for fill. Synced to Convex.              │
│  └────┬─────┘                                                    │
│       │ Fill confirmed                                           │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │  "open"   │  Active trade. Auto-monitors TP/SL.              │
│  └────┬─────┘                                                    │
│       │ TP hit / SL hit / Manual close                           │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │ "closed"  │  Final. P&L calculated. Archived.                 │
│  └──────────┘                                                    │
│                                                                  │
│  User creates position:                                          │
│  ┌──────────┐  ──► Direct to "open" (immediate sync)             │
│  │  "open"   │                                                    │
│  └──────────┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Position Sync Hook (`usePositionSync`)

Runs as a React hook on the chart page. Two effects:

### Effect 1: Create Trades for New Positions

```
Position drawing (status !== "signal", no convexTradeId)
  │
  ├── Skip if already processing (syncingIds ref)
  │
  ├── Call createTrade() mutation with:
  │   pair, timeframe, direction, entryTime, entryPrice,
  │   stopLoss, takeProfit, quantity, notes, createdBy
  │
  └── On success: update drawing with convexTradeId + syncedToConvex flag
```

### Effect 2: Auto-Detect TP/SL Hits

```
For each open trade matching this pair/timeframe:
  │
  ├── Skip if already closed (closedTradeIds ref)
  │
  ├── Filter candles after entry, only process new ones
  │
  ├── For each new candle:
  │   ├── Track max drawdown (max adverse excursion)
  │   ├── Check SL hit (low ≤ SL for longs, high ≥ SL for shorts)
  │   └── Check TP hit (high ≥ TP for longs, low ≤ TP for shorts)
  │
  ├── Update maxDrawdownPips if changed
  │
  └── If TP/SL hit:
      ├── Calculate exit price (exact TP or SL level)
      ├── Calculate P&L in pips (JPY pairs × 100, others × 10000)
      ├── Calculate bars held
      └── Call closeTrade() mutation
```

### Deduplication Guards

| Ref | Purpose |
|-----|---------|
| `processedIds` | Drawings already synced to Convex |
| `syncingIds` | Drawings currently being synced (prevents double-fire) |
| `closedTradeIds` | Trades already closed (prevents duplicate close attempts) |
| `lastProcessedCandle` | Last candle timestamp per trade (process only new candles) |

## Claude → Trade Journal Flow

```
Claude calls draw_long_position()
  │
  ├── Drawing created with:
  │   createdBy: "claude"
  │   status: "signal"          ◄── Does NOT trigger sync
  │
  ├── Trader sees position on chart as a "signal"
  │
  ├── Trader confirms (changes status to "open")
  │   └── usePositionSync detects new open position
  │       └── Creates trade in Convex with createdBy: "claude"
  │
  ├── Claude can update via update_drawing:
  │   ├── Trail stop loss (new stopLoss + reason)
  │   ├── Adjust take profit
  │   ├── Close position (status: "closed", outcome, exitPrice)
  │   └── Each update creates audit trail entry
  │
  └── Auto-detection closes trade if TP/SL hit by candles
```

## Convex Mutations

| Mutation | Args | Purpose |
|----------|------|---------|
| `createTrade` | Full trade fields + createdBy | Insert new open trade |
| `closeTrade` | id, exitTime, exitPrice, outcome, pnlPips, barsHeld | Close with P&L |
| `updateTrade` | id + partial fields | Update drawdown, notes, etc. |
| `deleteTrade` | id | Hard delete |

## Convex Queries

| Query | Filter | Returns |
|-------|--------|---------|
| `getTrades` | pair?, limit | Paginated trade list |
| `getTradesByStrategy` | strategyId | Strategy-specific trades |
| `getTradesByPair` | pair | Pair-specific trades |
| `getOpenTrades` | status === "open" | All active trades |
| `getTradeStats` | pair?, strategyId? | Win rate, P&L, streaks |

## createdBy Tracking

The `createdBy` field flows from drawing to trade:

| Source | Drawing.createdBy | Trade.createdBy | Default Status |
|--------|-------------------|-----------------|----------------|
| User draws on chart | "user" | "user" | "open" |
| Claude via chat | "claude" | "claude" | "signal" |
| Strategy engine | "strategy" | "strategy" | "signal" |

This lets the journal distinguish:
- Human-initiated trades
- AI-recommended trades (confirmed by trader)
- Strategy-generated signals

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-06 | Initial documentation covering sync pipeline, lifecycle, createdBy tracking |
