# Trade Journal & Position Sync — Architecture

> Last Updated: 2026-02-06 (v2.0)

## Overview

The trade journal lives in Convex and automatically syncs with position drawings on the chart. When a trader (or Claude) creates a long/short position drawing, it flows through a sync pipeline that creates a trade record, monitors for TP/SL hits, tracks max drawdown, and auto-captures chart snapshots — all in real-time.

**Plan vs Reality** tracks the gap between what a trader PLANNED (entry price, TP, SL) vs what ACTUALLY happened (actual fill, actual exit, why they closed). This enables Claude to analyze execution patterns.

## Key Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Trades table definition (incl. Plan vs Reality fields) |
| `convex/trades.ts` | Trade CRUD mutations + queries + execution quality stats |
| `src/hooks/usePositionSync.ts` | Drawing → Convex sync hook (auto-detect TP/SL, snapshots) |
| `lib/drawings/types.ts` | Position drawing types (incl. actual entry fields) |
| `src/components/chart/TakeTradeModal.tsx` | Signal → trade confirmation (entry type, slippage preview) |
| `src/components/chart/CloseTradeModal.tsx` | Trade close with reason codes + notes |
| `src/components/chart/LivePositionPanel.tsx` | Open position overlay → close button |
| `src/app/chart/[pair]/page.tsx` | Chart page wiring (modals, sync, snapshots) |
| `src/app/trades/page.tsx` | Trade journal UI page |

## Convex Trades Schema

```typescript
trades: defineTable({
  // Identity
  userId: v.optional(v.string()),
  strategyId: v.string(),
  pair: v.string(),
  timeframe: v.string(),
  direction: v.union(v.literal("LONG"), v.literal("SHORT")),
  createdBy: v.optional(v.union(
    v.literal("user"), v.literal("claude"), v.literal("strategy")
  )),

  // Planned Entry
  entryTime: v.number(),         // Planned entry timestamp (ms)
  entryPrice: v.number(),        // Planned entry price
  stopLoss: v.number(),
  takeProfit: v.number(),
  quantity: v.optional(v.number()),
  notes: v.optional(v.string()),

  // Plan vs Reality — Entry
  actualEntryPrice: v.optional(v.number()),    // Actual fill price
  actualEntryTime: v.optional(v.number()),     // Actual fill timestamp
  entrySlippagePips: v.optional(v.number()),   // Signed: positive = worse fill
  entryReason: v.optional(v.union(
    v.literal("limit"),      // Filled at planned price
    v.literal("market"),     // Market order (may differ)
    v.literal("late"),       // Entered late
    v.literal("partial"),    // Partial fill
    v.literal("spread"),     // Spread slippage
    v.literal("other")
  )),

  // Exit (filled on close)
  exitTime: v.optional(v.number()),
  exitPrice: v.optional(v.number()),
  outcome: v.optional(v.union(
    v.literal("TP"),  v.literal("SL"),
    v.literal("MW"),  v.literal("ML"),  v.literal("BE")
  )),
  pnlPips: v.optional(v.number()),
  barsHeld: v.optional(v.number()),

  // Plan vs Reality — Exit
  exitSlippagePips: v.optional(v.number()),    // Deviation from planned TP/SL
  closeReason: v.optional(v.union(
    v.literal("tp_hit"),          // TP hit automatically
    v.literal("sl_hit"),          // SL hit automatically
    v.literal("manual_profit"),   // Closed manually in profit
    v.literal("manual_loss"),     // Closed manually at a loss
    v.literal("breakeven"),       // Closed at breakeven
    v.literal("emotional"),       // Emotional decision
    v.literal("news"),            // News event incoming
    v.literal("thesis_broken"),   // Trade thesis invalidated
    v.literal("timeout"),         // Time-based exit
    v.literal("other")
  )),
  closeReasonNote: v.optional(v.string()),     // Free-text elaboration

  // Risk metrics
  maxDrawdownPips: v.optional(v.number()),

  // Status
  status: v.union(
    v.literal("pending"), v.literal("open"),
    v.literal("closed"),  v.literal("cancelled")
  ),
})
```

Indexed by: `pair`, `strategyId`, `status`, `entryTime`, `userId`.

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
│       │ Trader confirms (TakeTradeModal)                         │
│       │ Records: entry type (limit/market), actual entry price   │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │  "open"   │  Active trade. Auto-monitors TP/SL.              │
│  │           │  Entry snapshot auto-captured.                     │
│  └────┬─────┘                                                    │
│       │ TP hit / SL hit / Manual close (CloseTradeModal)         │
│       │ Records: close reason, exit price, notes                 │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │ "closed"  │  Final. P&L + slippage calculated.                │
│  │           │  Exit snapshot auto-captured.                      │
│  └──────────┘                                                    │
│                                                                  │
│  User creates position directly:                                 │
│  ┌──────────┐  ──► Direct to "open" (immediate sync)             │
│  │  "open"   │      actualEntryPrice = entryPrice (zero slippage)│
│  └──────────┘                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Plan vs Reality — How It Works

### Entry Tracking

When a trader confirms a signal via TakeTradeModal, they choose:

| Entry Type | What Happens |
|------------|-------------|
| **Limit** (default) | `actualEntryPrice = entryPrice`, zero slippage |
| **Market** | `actualEntryPrice = currentPrice`, slippage auto-calculated |

Slippage formula (signed — positive = worse fill):
```
isLong:  slippage = (actualEntry - plannedEntry) × pipMultiplier
isShort: slippage = (plannedEntry - actualEntry) × pipMultiplier
```

### Exit Tracking

Trades close in three ways, each recording a `closeReason`:

| Close Method | closeReason | Source |
|-------------|-------------|--------|
| TP hit by candle | `tp_hit` | Auto-detected by `usePositionSync` |
| SL hit by candle | `sl_hit` | Auto-detected by `usePositionSync` |
| Manual close via CloseTradeModal | User-selected reason | Chart overlay button |

### Close Reason Taxonomy

Close reasons are **descriptive, not judgmental**. Early exits can be valid (broken structure, news risk).

| Reason | Code | When Used |
|--------|------|-----------|
| TP Hit | `tp_hit` | Auto: take profit level reached |
| SL Hit | `sl_hit` | Auto: stop loss level reached |
| Take Profit | `manual_profit` | Manual close in profit |
| Cut Loss | `manual_loss` | Manual close at a loss |
| Break Even | `breakeven` | Manual close at ~zero P&L |
| Thesis Broken | `thesis_broken` | Original trade thesis invalidated (disciplined exit) |
| News Coming | `news` | Closing ahead of high-impact news |
| Emotional | `emotional` | Emotional decision (fear/greed) |
| Timeout | `timeout` | Time-based exit rule |
| Other | `other` | Anything else (free-text in `closeReasonNote`) |

### Smart Defaults (Zero Friction)

- **No actual entry specified** → `actualEntryPrice = entryPrice` (zero slippage)
- **No entry reason specified** → `"limit"` (assumed limit fill)
- **Auto-close (TP/SL hit)** → `closeReason` auto-set from outcome
- **Manual close derived** → `closeReason` derived from P&L sign if not explicitly set
- **All new fields are `v.optional()`** → existing trades work unchanged

## CloseTradeModal

`src/components/chart/CloseTradeModal.tsx`

Triggered from LivePositionPanel's "Close Trade" button on the chart overlay.

**Layout:**
1. Header with pair + direction badge (LONG/SHORT)
2. Live P&L display (pips, updates in real-time via `useLivePositionPnL`)
3. Exit Price input (pre-filled with current market price)
4. Close Reason button grid:
   - Row 1: Take Profit | Cut Loss | Break Even
   - Row 2: Thesis Broken | News Coming | Emotional | Timeout | Other
5. Notes textarea (optional)
6. Auto-suggests reason based on exit price proximity to TP/SL
7. Action buttons: Cancel | Close Position

**Flow:**
```
LivePositionPanel → "Close" button
  → Chart page sets closingPosition state
  → CloseTradeModal renders
  → User selects reason + confirms
  → handleCloseTradeConfirm:
      1. Call closeTrade() Convex mutation
      2. Update drawing state (status: "closed")
      3. Close modal
      4. Exit snapshot auto-captured by usePositionSync
```

## TakeTradeModal

`src/components/chart/TakeTradeModal.tsx`

Confirms a strategy signal as an actual trade.

**Key additions for Plan vs Reality:**
- Entry Type toggle: Limit (at signal price) vs Market (at current price)
- Market entry shows slippage preview: "X.X pips from signal"
- Passes `actualEntryPrice` and `entryReason` to the drawing/trade

## Position Sync Hook (`usePositionSync`)

Runs as a React hook on the chart page. Two effects + auto-snapshots:

### Effect 1: Create Trades for New Positions

```
Position drawing (status !== "signal", no convexTradeId)
  │
  ├── Skip if already processing (syncingIds ref)
  │
  ├── Call createTrade() mutation with:
  │   pair, timeframe, direction, entryTime, entryPrice,
  │   stopLoss, takeProfit, quantity, notes, createdBy,
  │   actualEntryPrice, actualEntryTime, entryReason    ◄── NEW
  │
  ├── On success: update drawing with convexTradeId + syncedToConvex flag
  │
  └── Auto-capture entry snapshot (fire-and-forget)
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
      ├── Call closeTrade() with closeReason: "tp_hit" | "sl_hit"  ◄── NEW
      └── Auto-capture exit snapshot (fire-and-forget)
```

### Deduplication Guards

| Ref | Purpose |
|-----|---------|
| `processedIds` | Drawings already synced to Convex |
| `syncingIds` | Drawings currently being synced (prevents double-fire) |
| `closedTradeIds` | Trades already closed (prevents duplicate close attempts) |
| `lastProcessedCandle` | Last candle timestamp per trade (process only new candles) |
| `snapshotted` | Trades already snapshotted per moment (prevents duplicate captures) |

## Convex Mutations

| Mutation | Key Args | Auto-Calculations |
|----------|----------|-------------------|
| `createTrade` | Full trade fields + `actualEntryPrice`, `entryReason` | `entrySlippagePips` auto-calculated |
| `closeTrade` | id, exitPrice, outcome + `closeReason`, `closeReasonNote` | `closeReason` auto-derived from outcome; `exitSlippagePips` auto-calculated |
| `updateTrade` | id + any Plan vs Reality field | All fields optional |
| `cancelTrade` | id, notes? | Sets status to "cancelled" |
| `deleteTrade` | id | Hard delete |

## Convex Queries

| Query | Filter | Returns |
|-------|--------|---------|
| `getTrades` | status?, limit | Paginated trade list (all Plan vs Reality fields) |
| `getTradesByStrategy` | strategyId | Strategy-specific trades |
| `getTradesByPair` | pair | Pair-specific trades |
| `getOpenTrades` | status === "open" | All active trades |
| `getTrade` | id | Single trade by ID |
| `getTradeStats` | pair?, strategyId? | Win rate, P&L, streaks + **execution quality metrics** |

### Execution Quality Metrics (`getTradeStats`)

```typescript
executionQuality: {
  avgEntrySlippagePips,    // Average slippage on entries
  avgExitSlippagePips,     // Average deviation from planned exit
  earlyExitRate,           // % of trades closed before TP/SL
  earlyExitAvgPips,        // Average P&L of early exits
  lateEntryWinRate,        // Win rate when entryReason="late" or slippage > 2 pips
  lateEntryCount,          // Number of late entries
  closeReasonBreakdown,    // Record<string, number> — count per close reason
}
```

Only trades with slippage data contribute to averages (backward-compatible with existing trades).

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
  ├── Trader confirms via TakeTradeModal:
  │   ├── Chooses Limit (at signal price) or Market (at current price)
  │   ├── actualEntryPrice + entryReason recorded
  │   └── usePositionSync detects new open position
  │       ├── Creates trade in Convex with all Plan vs Reality entry data
  │       └── Auto-captures entry snapshot
  │
  ├── Claude can update via update_drawing:
  │   ├── Trail stop loss (new stopLoss + reason)
  │   ├── Adjust take profit
  │   ├── Close position (status: "closed", outcome, exitPrice)
  │   └── Each update creates audit trail entry
  │
  ├── Auto-detection closes trade if TP/SL hit by candles
  │   └── closeReason auto-set to "tp_hit" or "sl_hit"
  │
  └── Manual close via CloseTradeModal:
      ├── User selects closeReason + optional notes
      └── Exit snapshot auto-captured
```

## Claude Chat → Trade Data

Claude can query trade data via server-side data tools:

| Tool | Purpose |
|------|---------|
| `get_trade_history` | Fetch recent trades with full Plan vs Reality fields |
| `get_trade_stats` | Aggregate stats including execution quality metrics |

**Auth flow:** Client passes Clerk's Convex token via ChatContext → API route → ConvexHttpClient.

Claude uses this data to identify patterns like:
- "When you enter late, your win rate drops to X%"
- "Your thesis_broken exits average +0.3R — that's disciplined"
- "You've had 3 emotional exits this week, all were in profit at close"

## createdBy Tracking

| Source | Drawing.createdBy | Trade.createdBy | Default Status |
|--------|-------------------|-----------------|----------------|
| User draws on chart | "user" | "user" | "open" |
| Claude via chat | "claude" | "claude" | "signal" |
| Strategy engine | "strategy" | "strategy" | "signal" |

## Edge Cases

1. **Existing trades (pre-Plan vs Reality):** All fields optional → display as "—" in UI. Stats skip trades without slippage data.
2. **Auto-detected TP/SL close:** `exitPrice` set to exact TP/SL level. `closeReason` auto-set. Zero exit slippage.
3. **JPY pairs:** Pip multiplier is 100 (not 10000). All slippage calculations handle this.
4. **ConvexHttpClient auth for Claude tools:** If token missing/expired, returns helpful error: "Not authenticated — cannot access trade history."

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-06 | Initial documentation covering sync pipeline, lifecycle, createdBy tracking |
| 2.0 | 2026-02-06 | **Plan vs Reality**: Added execution quality tracking (entry/exit slippage, close reason taxonomy), CloseTradeModal, TakeTradeModal entry type, snapshot auto-capture, execution quality stats, Claude trade data tools |
