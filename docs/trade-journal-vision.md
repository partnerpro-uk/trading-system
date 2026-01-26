# Trade Journal System - Vision Document

## Overview

Build a **rich trade journaling system** where every position on the chart becomes a queryable trade record with full context - not just entry/exit prices, but the human reasoning, technical analysis, execution quality, and market conditions that Claude can understand and learn from.

This is the data layer that makes Claude a genuine trading co-pilot with perfect memory of YOUR trading history.

---

## Why This Matters

### The Problem with Traditional Trade Journals

Most traders either:
- Don't journal at all (too tedious)
- Use spreadsheets that capture numbers but not context
- Forget why they took trades within days
- Can't answer questions like "What's my win rate when I enter late?"

### What We're Building

A system where:
- Every trade is automatically captured with full context
- Plan vs Reality is tracked (what you intended vs what happened)
- Related analysis (drawings, zones, fibs) is linked to trades
- Claude can query across your entire trading history
- Patterns emerge from data, not gut feel

---

## User Stories

### Story 1: The Late Entry
> "I saw a perfect setup at 1.35225, but by the time I clicked, spread had widened and I got filled at 1.35245. I want to track this so Claude can tell me how much slippage costs me over time."

**Solution:** Planned entry vs actual entry fields, with reason and auto-calculated slippage.

### Story 2: The Early Exit
> "News was coming in 2 hours. My analysis said hold to TP, but I closed early at +0.8R because I was nervous. Was that the right call?"

**Solution:** Track `outcome: "manual"` with `actualExitReason`, so Claude can analyze early exit performance.

### Story 3: Linking Analysis to Trades
> "I drew a fib, a supply zone, and a horizontal ray for this trade. Months later, I want to know: which of my fib setups actually work?"

**Solution:** Drawing groups - drag related drawings into trades to link them by ID.

### Story 4: Session Analysis
> "I feel like I do better during London. Is that actually true?"

**Solution:** Auto-detect entry/exit sessions from timestamps. Claude queries session performance.

### Story 5: The Trade Log Review
> "Show me all my losing trades this month where I noted 'entered late' - I want to see the pattern."

**Solution:** Structured notes, tags, and full-text search across all trade context.

---

## Core Concepts

### Trade ≠ Position Drawing

A **Position Drawing** is a visual on the chart (entry, TP, SL zones).

A **Trade** is a richer entity:
```
Trade Record
├── The Position (entry, TP, SL, outcome)
├── Plan vs Reality (planned vs actual entry/exit)
├── Linked Analysis (fibs, trendlines, zones)
├── Context (session, indicators, news proximity)
├── Human Layer (notes, reasoning, feelings)
└── Computed Metrics (slippage, R achieved, duration)
```

When you create a position drawing, a Trade record is auto-created. The drawing is the visual; the Trade is the data.

### Plan vs Reality Tracking

**The insight:** Don't move the drawing when you enter late. Instead, capture both:

| Field | Description |
|-------|-------------|
| `entry` | Where analysis said to enter (the drawing) |
| `actualEntry` | Where you actually got filled |
| `actualEntryReason` | "spread", "entered late", "partial fill" |
| `entrySlippage` | Auto-calculated difference in pips |

Same for exits:
| Field | Description |
|-------|-------------|
| `takeProfit` / `stopLoss` | Planned exit levels |
| `actualExit` | Where you actually closed |
| `actualExitReason` | "closed early", "moved SL", "news coming" |
| `exitSlippage` | Difference from planned exit |

**Visual rendering:**
```
┌─────────────────────────────────────────┐
│  TP @ 1.35400                           │  ← Planned (solid)
│                                         │
│  ═════════════════════════════════════  │  ← Actual Entry 1.35245 (dashed)
│  ─────────────────────────────────────  │  ← Planned Entry 1.35225 (solid)
│                                         │
│  SL @ 1.35100                           │
└─────────────────────────────────────────┘
```

### Drawing Groups (Linking Analysis to Trades)

**The problem:** User has old drawings on chart. How do you know which belong to which trade?

**The solution:** Explicit drag-and-drop linking.

```
Sidebar
├── Trades
│   ├── Long #1 (EUR/USD) ✅ TP
│   │   ├── Position Drawing
│   │   ├── Fib "0.618 level"        ← linked
│   │   └── Horizontal Ray "Support" ← linked
│   │
│   └── Short #2 (EUR/USD) ❌ SL
│       ├── Position Drawing
│       └── Rectangle "Supply Zone"  ← linked
│
├── Unlinked Drawings
│   ├── Trendline (old analysis)
│   └── Horizontal Line
```

**Why explicit linking:**
- User knows what analysis they actually used
- Old drawings don't accidentally get included
- Clean, intentional grouping
- Claude knows exactly what informed each trade

---

## Data Architecture

### Database Choice: Convex

All live trade data in Convex because:
- Real-time sync across devices
- User-specific data
- Relatively low volume (hundreds of trades, not millions)
- Rich querying for Claude

### Schema

```typescript
// Convex trades table
trades: defineTable({
  userId: v.string(),
  pair: v.string(),
  timeframe: v.string(),

  // Strategy link
  strategyId: v.optional(v.string()),

  // Core trade data
  direction: v.union(v.literal("LONG"), v.literal("SHORT")),

  // Planned (from drawing)
  entry: v.object({ timestamp: v.number(), price: v.number() }),
  takeProfit: v.number(),
  stopLoss: v.number(),

  // Actual (from execution)
  actualEntry: v.optional(v.object({
    timestamp: v.number(),
    price: v.number()
  })),
  actualEntryReason: v.optional(v.string()),

  actualExit: v.optional(v.object({
    timestamp: v.number(),
    price: v.number()
  })),
  actualExitReason: v.optional(v.string()),

  // Outcome
  outcome: v.optional(v.union(
    v.literal("TP"),      // Hit take profit
    v.literal("SL"),      // Hit stop loss
    v.literal("MANUAL"),  // Closed manually
    v.literal("PENDING")  // Still open
  )),

  // Linking
  positionDrawingId: v.string(),
  linkedDrawingIds: v.array(v.string()),

  // Human layer
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),

  // Auto-computed context
  entrySession: v.optional(v.string()),  // "London", "NY", "Tokyo", "Sydney"
  exitSession: v.optional(v.string()),
  entrySlippage: v.optional(v.number()), // pips
  exitSlippage: v.optional(v.number()),

  // Indicator snapshot at entry
  indicatorSnapshot: v.optional(v.string()), // JSON

  // News context
  newsWithinHours: v.optional(v.number()),   // Hours to nearest news event

  // Computed metrics
  plannedRR: v.number(),      // Risk:Reward ratio planned
  actualRR: v.optional(v.number()), // What was actually achieved
  durationCandles: v.optional(v.number()),
  durationMinutes: v.optional(v.number()),
  pnlPips: v.optional(v.number()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
```

### Position Drawing Fields (Extended)

```typescript
interface BasePositionDrawing extends BaseDrawing {
  // ... existing fields ...

  // Planned (from drawing)
  entry: DrawingAnchor;
  takeProfit: number;
  stopLoss: number;

  // Actual (for rendering both lines)
  actualEntry?: DrawingAnchor;
  actualEntryReason?: string;

  actualExit?: {
    timestamp: number;
    price: number;
  };
  actualExitReason?: string;

  // Auto-calculated
  entrySlippage?: number;  // pips difference
  exitSlippage?: number;

  // Link to Trade record
  tradeId?: string;  // Convex ID
}
```

---

## Rich Data Layer for Claude

### What Claude Can Query

**Execution quality:**
> "What's my average slippage on EUR/USD during London?"
> "Do trades where I entered late perform worse?"
> "Show me trades where actual entry was more than 3 pips from planned"

**Emotional patterns:**
> "What's my win rate when I note 'hesitant' or 'nervous'?"
> "Show me all trades where I closed early - did I make the right call?"

**Technical analysis validation:**
> "Which of my fib setups actually hit the 0.618 level?"
> "Do trades with supply zone confluence outperform?"

**Session analysis:**
> "What's my win rate by session?"
> "Do I perform differently when entering in London but exiting in NY?"

**Combined queries (the real edge):**
> "What's my win rate on EUR/USD shorts during NY session, when London already swept Asia high, there's no news within 2 hours, and I didn't note any hesitation?"

### The Compounding Effect

After 6 months, you have:
- 200+ trades with full context
- Notes explaining your reasoning
- Plan vs reality for every trade
- Linked analysis for each setup

Claude becomes a co-pilot that says:
> "You're considering a long here. Looking at your history: similar setups have 58% win rate, but when you enter late (which you're about to do), that drops to 42%. Also, you've noted 'hesitant' in your last 3 losing trades. Are you sure about this one?"

That's not guesswork. That's edge, built from YOUR data.

---

## Trade Log Page

### Layout

```
/trades

┌─────────────────────────────────────────────────────────────────┐
│  Trade Journal                    [All Pairs ▼] [All Strategies ▼] │
│  Jan 2025                         [Export] [Stats]                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Long #12 • EUR/USD • 15m                    ✅ TP    +2.1R  +42 pips│
│  Jan 24, 08:15 → 14:30 (London → NY)                                │
│  Strategy: Sweep + FVG                       Duration: 8 candles    │
│  Entry: 1.35225 (actual: 1.35245, +2 pips slip)                     │
│  ────────────────────────────────────────────────────────────────── │
│  Notes: "Clean setup, waited for BOS confirmation"                  │
│  Tags: #confluence #fib-618 #london-open                            │
│  Linked: Fib "Swing Low", Horizontal Ray "Support"                  │
│  [View on Chart] [Replay] [Edit]                                    │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Short #11 • EUR/USD • 15m                   ❌ SL    -1.0R  -18 pips│
│  Jan 23, 15:00 → 15:45 (NY)                                         │
│  Strategy: None                              Duration: 3 candles    │
│  Entry: 1.35180 (actual: 1.35180, 0 slip)                           │
│  ────────────────────────────────────────────────────────────────── │
│  Notes: "Entered early, should have waited for confirmation"        │
│  Tags: #revenge-trade #no-confluence                                │
│  Linked: Rectangle "Supply Zone"                                    │
│  [View on Chart] [Replay] [Edit]                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

- **Filter by:** Pair, strategy, outcome, date range, tags, session
- **Sort by:** Date, P&L, R multiple, duration
- **"View on Chart":** Navigate to that time with all linked drawings visible
- **"Replay":** (Future) Step through the trade candle by candle
- **Aggregate stats:** Win rate, average R, by strategy, by session, by tag

---

## Implementation Phases

### Phase 1: Trade Info Tab (Current Focus)
- Add "Trade Info" tab to DrawingSettings for positions
- Show auto-calculated metrics (outcome, duration, session)
- Display planned vs actual if different
- Notes and strategy dropdown

### Phase 2: Plan vs Reality Fields
- Add `actualEntry`, `actualExit` fields to position drawing type
- Render actual entry as dashed line when different from planned
- Calculate slippage automatically

### Phase 3: Convex Integration
- Create `trades` table in Convex
- Auto-create Trade record when position drawing created
- Sync updates between drawing and Trade record

### Phase 4: Drawing Linking
- Sidebar section showing trades with linked drawings
- Drag-and-drop to link/unlink drawings
- Update drawing `tradeId` field on link

### Phase 5: Trade Log Page
- `/trades` route with full journal view
- Filtering, sorting, search
- "View on Chart" navigation
- Export functionality

### Phase 6: Claude Context API
- Endpoint for Claude to query trades
- Include notes, tags, linked drawings
- Aggregate statistics on demand

### Phase 7: Replay System (Future)
- Store candle data for trade duration
- Playback component with controls
- Annotation overlay during replay

---

## Summary

This isn't just a trade journal. It's a **queryable knowledge base** where:

1. **Every trade captures Plan vs Reality** - what you intended vs what happened
2. **Analysis is linked to trades** - so you can validate which setups actually work
3. **Human context is preserved** - notes, feelings, reasoning
4. **Claude can query everything** - turning your history into actionable insights

The goal: After 6 months, you don't guess whether your setups work. You *know*, because the data tells you.

---

*Document Version: 1.0*
*Last Updated: January 2025*
*Related: [Trading System Vision](./trading-system-vision.md)*
