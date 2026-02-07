# Market Structure Detection — Architecture & Concept Document

> Last Updated: 2026-02-07 (v1.4)
> Status: Design Phase — Pre-Implementation

---

## Table of Contents

1. [Intent & Philosophy](#intent--philosophy)
2. [Core Concepts](#core-concepts)
3. [Swing Point Detection](#swing-point-detection)
4. [Structure Labeling](#structure-labeling)
5. [Break of Structure (BOS)](#break-of-structure-bos)
6. [Sweeps vs Breaks — The Critical Distinction](#sweeps-vs-breaks--the-critical-distinction)
7. [Fair Value Gaps (FVGs)](#fair-value-gaps-fvgs)
8. [Key Level Grid](#key-level-grid)
9. [Premium / Discount Zones](#premium--discount-zones)
10. [Multi-Timeframe Direction Scoring](#multi-timeframe-direction-scoring)
11. [Enriched BOS Events](#enriched-bos-events)
12. [Counter-Trend Framework](#counter-trend-framework)
13. [Rendering & Visualization](#rendering--visualization)
14. [Architecture & Computation](#architecture--computation)
15. [Endgame Architecture — Full System Design](#endgame-architecture--full-system-design)
16. [Interconnection Philosophy](#interconnection-philosophy)
17. [Historical Pattern Discovery — ClickHouse](#historical-pattern-discovery--clickhouse)
18. [Implementation Phases](#implementation-phases)
19. [ADR Summary](#adr-summary)

---

## Intent & Philosophy

The goal is to build a **market structure detection engine** that answers one fundamental question: **What is the market doing right now, and how significant is what it's doing?**

Raw price data is noise without context. A candle closing below a swing low means nothing in isolation — but if that swing low is also the Previous Day's Low, COT positioning is bearish, and the Weekly timeframe confirms a downtrend, that's a high-conviction signal.

**Nothing should exist in isolation.** Every piece of data we collect (candles, news, COT, session times, key levels) should inform and enrich every other piece. The structure engine is the connective tissue that ties it all together.

The system serves two consumers equally:
1. **The human trader** — visual labels on chart, dashed BOS lines, confluence indicators
2. **Claude** — structured data with timestamps, coordinates, and cross-referenced context for analysis

Both see the same computation. Both get the same truth.

---

## Core Concepts

### What is Market Structure?

Market structure is the pattern of swing highs and swing lows that price creates over time. By classifying how each new swing relates to the previous swing, we can determine:

- **Trend direction** — Is price making higher highs and higher lows (bullish) or lower highs and lower lows (bearish)?
- **Trend shifts** — When does a trend break? A BOS (Break of Structure) signals a potential reversal.
- **Strength of moves** — How significant is a structural break? Breaking a minor swing low on M15 is noise; breaking the Previous Weekly Low on H4 is a regime change.

### The Building Blocks

| Concept | What It Is | Why It Matters |
|---------|-----------|----------------|
| **Swing Point** | A local high or low where price reversed | The "joints" of structure — without accurate swings, everything downstream fails |
| **Structure Label** | HH, HL, LH, LL, EQH, EQL classification | Tells us what the trend is doing right now |
| **BOS** | Break of Structure — body close beyond a prior swing | Confirmed shift in market behavior |
| **Sweep** | Wick through a level without body close | Liquidity grab — often a fake-out, NOT a structural break |
| **Key Level** | Daily/Weekly/Monthly/Yearly/Session H/L | Gives BOS events their significance rating |
| **MTF Alignment** | Direction agreement across timeframes | The difference between a pullback and a reversal |

---

## Swing Point Detection

### The Algorithm

A swing high is a candle whose high is higher than the highs of `N` candles on both sides. A swing low is a candle whose low is lower than the lows of `N` candles on both sides.

```
Swing High: candle[i].high > max(candle[i-N..i-1].high) AND candle[i].high > max(candle[i+1..i+N].high)
Swing Low:  candle[i].low  < min(candle[i-N..i-1].low)  AND candle[i].low  < min(candle[i+1..i+N].low)
```

### Timeframe-Scaled Lookback

**Why vary by timeframe?** Lower timeframes have more noise — a 3-candle lookback on M15 catches every tiny wiggle. Higher timeframes are already smoothed — a 7-candle lookback on the Weekly would miss obvious swings.

| Timeframe | Lookback (N) | Reasoning |
|-----------|-------------|-----------|
| M15 | 7 | High noise, need wider filter to avoid false swings |
| H1 | 5 | Moderate noise, standard lookback |
| H4 | 5 | Clean structure, same as H1 |
| D1 | 3 | Already smooth, tighter lookback catches major turns |
| W1 | 3 | Very smooth, every swing matters |
| MN | 2 | Monthly swings are always significant |

**Accuracy is paramount.** A missed swing or a false swing cascades into wrong labels, wrong BOS events, and wrong trade signals. The lookback tuning is the most critical parameter in the entire system.

### Required Candle Depth

To detect swings reliably, we need sufficient history:

| Timeframe | Minimum Candles | Approx. Period |
|-----------|----------------|----------------|
| M15 | 500 | ~5 days |
| H1 | 500 | ~3 weeks |
| H4 | 300 | ~2 months |
| D1 | 200 | ~10 months |
| W1 | 104 | ~2 years |
| MN | 60 | ~5 years |

---

## Structure Labeling

Once swing points are identified, each new swing is classified relative to the previous swing of the same type:

| Label | Condition | What It Means |
|-------|-----------|---------------|
| **HH** (Higher High) | New swing high > previous swing high | Bullish continuation — buyers pushing higher |
| **HL** (Higher Low) | New swing low > previous swing low | Bullish continuation — buyers defending higher levels |
| **LH** (Lower High) | New swing high < previous swing high | Bearish shift — sellers capping rallies lower |
| **LL** (Lower Low) | New swing low < previous swing low | Bearish continuation — sellers pushing lower |
| **EQH** (Equal High) | New swing high ≈ previous swing high (within tolerance) | Liquidity building — double top pattern, likely sweep target |
| **EQL** (Equal Low) | New swing low ≈ previous swing low (within tolerance) | Liquidity building — double bottom pattern, likely sweep target |

### EQH/EQL Tolerance

Fixed pip tolerance doesn't work — 5 pips on EUR/USD is tight, but 5 pips on GBP/JPY is nothing. But pure ATR is also flawed: **averages aren't accurate to the pip**. ATR(14) of 80 pips doesn't mean each candle moves 80 pips — some move 30, some move 150. Using a percentage of an average to judge a specific, real-time swing is imprecise.

**Better approach: Swing-relative tolerance with ATR ceiling.**

The primary measure is the **true range of the candle that formed the swing point**. This grounds the tolerance in what actually happened at that specific moment, not a smoothed average. ATR serves only as a safety cap for edge cases (flash crashes, news spikes where a single candle has an absurd range).

```
swingRange = trueRange of the candle that formed the swing point
tolerance  = min(swingRange × 0.15, ATR(14) × 0.10)
```

**Why this works:**

- A swing high formed by a 60-pip candle → tolerance = 9 pips. Two highs within 9 pips are "equal."
- A swing high formed by a 15-pip candle → tolerance = 2.25 pips. Much tighter — because the market was quiet, so small differences matter more.
- A flash crash candle with 300-pip range → ATR cap kicks in (e.g., 8 pips), preventing absurd 45-pip tolerance.

This is self-referencing (based on what happened at that swing) rather than backward-looking (based on what happened on average over 14 candles).

### Trend State Machine

The sequence of labels determines the trend state:

```
BULLISH: HH → HL → HH → HL → ...
BEARISH: LH → LL → LH → LL → ...
RANGING: Mix of EQH/EQL, no clear HH/HL or LH/LL progression
```

A trend is considered intact until a BOS occurs in the opposite direction.

---

## Break of Structure (BOS)

### Definition

A BOS occurs when price **closes its body** beyond a prior swing point, confirming a structural break.

- **Bullish BOS**: `candle.close > previous_swing_high` — price broke above resistance
- **Bearish BOS**: `candle.close < previous_swing_low` — price broke below support

### Why Body Close Only?

This is the single most important rule in the system. A wick through a level is NOT a break — it's a probe, a liquidity sweep, a stop hunt. The market tests levels with wicks constantly. Only when the **body closes beyond** the level do we consider it a confirmed break.

```
candle.close < swing_low → BOS CONFIRMED (bearish)
candle.low < swing_low BUT candle.close > swing_low → SWEEP (not BOS)
```

This distinction prevents false signals. A wick below the Previous Day's Low that closes back above is a **sweep** — often a bullish signal (institutions grabbed liquidity). Treating it as a BOS would flip your bias incorrectly.

### BOS Event Data

Every BOS event is stored with full context:

```typescript
interface BOSEvent {
  // Core
  timestamp: number;           // When the confirming candle closed
  pair: string;
  timeframe: string;
  direction: "bullish" | "bearish";
  status: "active" | "reclaimed"; // See BOS Invalidation section

  // The break
  brokenLevel: number;         // The swing price that was broken
  brokenSwingTimestamp: number; // When that swing formed
  confirmingClose: number;     // The close price that confirmed the break
  magnitudePips: number;       // How far beyond the level price closed
  isDisplacement: boolean;     // Was the confirming candle a displacement move?
  isCounterTrend: boolean;     // Does this BOS go against the current HTF trend?

  // Significance (enriched — see Enriched BOS Events section)
  significance: number;        // 0-100 composite score
  keyLevelsBroken: string[];   // ["PDL", "Weekly Low"] etc.
  cotAlignment: boolean;       // Does COT positioning agree?
  mtfScore: number;            // Multi-timeframe direction score at time of break
  nearbyNews: string[];        // News events within ±2 hours

  // Invalidation tracking (populated if status becomes "reclaimed")
  reclaimedAt?: number;        // When price closed back beyond the broken level
  reclaimedByClose?: number;   // The close price that reclaimed
  timeTilReclaim?: number;     // Milliseconds between BOS and reclaim
}
```

### Counter-Trend Flag (`isCounterTrend`)

Not all BOS events are equal in meaning. A BOS **with** the current trend is continuation — high confidence. A BOS **against** the current trend is a potential reversal — lower confidence, needs more confirmation.

Instead of introducing a separate "CHoCH" (Change of Character) concept, we flag the distinction directly on the BOS event:

- `isCounterTrend: false` — BOS continues the current HTF trend. "H4 bearish BOS while Daily is also bearish" = continuation, high conviction.
- `isCounterTrend: true` — BOS goes against the current HTF trend. "H4 bearish BOS while Daily is bullish" = potential reversal OR just a pullback. Lower conviction until the HTF confirms.

This is determined by comparing the BOS direction against the MTF score at time of creation. If they disagree, it's counter-trend. The MTF scoring system (see section below) already encodes the HTF bias, so this flag is derived, not manually set.

**Why a flag instead of a separate event type:** A counter-trend BOS is still a BOS — it uses the same detection rules, the same body-close confirmation, the same enrichment pipeline. The only difference is how confident you should be in it. Keeping it as a flag on the same event type means one detection algorithm, one data model, one rendering path — with a confidence modifier.

### Displacement Detection

A BOS confirmed by a **displacement candle** — a strong, impulsive move — carries more weight than one confirmed by a small candle that barely closed beyond the level.

Displacement is detected by comparing the confirming candle's body size against recent candle body sizes:

```text
displacementBody = abs(confirmingCandle.close - confirmingCandle.open)
recentBodies = bodies of the last 20 candles on the same timeframe
medianBody = median(recentBodies)

isDisplacement = displacementBody >= medianBody * 2.0
```

**Why median instead of ATR?** ATR is an average of true ranges (including wicks), and averages get skewed by outliers. The median of recent body sizes is a more honest baseline — it tells you "what does a normal candle body look like right now?" A confirming candle with 2x the normal body size is a genuine displacement.

A displacement BOS also tends to create FVGs (see FVG section) — the speed of the move leaves imbalances. The `isDisplacement` flag connects BOS events to their child FVGs conceptually.

### BOS Invalidation / Level Reclaim

A BOS can be **reclaimed** — price breaks below a level (bearish BOS), then later closes back above that same level. This invalidates the original BOS thesis.

```text
Bullish trend: HH → HL → HH → HL
                                  ↓
  14:30 — Candle closes below last HL at 1.0850 → Bearish BOS confirmed
                                  ↓
  20:00 — Candle closes back above 1.0850       → BOS RECLAIMED
                                  ↓
  Sellers tried to break structure and failed.
  Everyone who sold the BOS is now trapped short.
  This is often one of the strongest reversal signals.
```

**Rules:**

- **BOS events are immutable records** — once confirmed, the event exists forever in history. It happened.
- **Status changes from `active` to `reclaimed`** when price closes its body back beyond the broken level in the opposite direction.
- **The reclaim is logged as metadata on the original event** (`reclaimedAt`, `reclaimedByClose`, `timeTilReclaim`), not as a separate event.
- **Time-to-reclaim matters:**

| Reclaim Speed | Interpretation | Signal |
|--------------|----------------|--------|
| Same session (< 8h) | Trap / liquidity grab | Strong counter-signal — trade the opposite direction |
| Next day (8-24h) | Failed breakdown | Moderate counter-signal — thesis weakening |
| Multi-day (> 24h) | Structure evolved | Not a direct signal — the market simply changed |

**Why not delete reclaimed BOS events?**
- The BOS still happened — it's historical truth needed for pattern mining
- ClickHouse can track reclaim rates: "40% of H4 bearish BOS events on EUR/USD get reclaimed within 8h — this pair is choppy"
- If you took a trade on the BOS and it got reclaimed, the record must exist to explain the `thesis_broken` close reason
- A reclaimed BOS is itself a tradeable signal — knowing it was reclaimed is valuable data

### History Tracking

We don't just track the latest structure — we maintain a **history of all BOS events** (including reclaimed ones). This is critical for:

1. **Counter-trend analysis**: "Price broke structure bearish at 14:30, but the previous 3 BOS events were all bullish — this might be a pullback, not a reversal"
2. **Pattern recognition**: "Every time there's a bearish BOS during London session on this pair, it reverses within 4 hours"
3. **Reclaim patterns**: "This pair reclaims 40% of H4 BOS events — don't trust a single BOS in isolation, wait for confirmation"
4. **Claude analysis**: Claude can reference specific BOS events by timestamp and reason about structural evolution over time

---

## Sweeps vs Breaks — The Critical Distinction

This distinction is not academic — it's the difference between a good trade and a blown account.

### Sweep (Liquidity Grab)

```
Price action:  Wick pierces below swing low, body closes ABOVE
What happened: Institutions triggered stop losses below the low, absorbed the liquidity
Implication:   Often BULLISH — the low was tested and rejected
Trading:       Look for entries in the opposite direction of the sweep
```

### Break of Structure (BOS)

```
Price action:  Body CLOSES below swing low
What happened: Sellers overwhelmed buyers, the level is broken
Implication:   BEARISH — old support is now resistance
Trading:       Look for continuation in the direction of the break
```

### Why This Matters for the System

If we treat every wick through a level as a BOS, we'd flip bias on every liquidity sweep — exactly what institutions want retail traders to do. The body-close confirmation rule means our system only recognizes structural changes when they're actually confirmed.

EQH/EQL levels are particularly important sweep targets. When price forms an equal high, there's a cluster of stop losses just above. Institutions sweep those stops (wick through) before the real move begins. Our system flags these as sweeps, not breaks.

---

## Fair Value Gaps (FVGs)

### What Is an FVG?

A Fair Value Gap (also called an imbalance) is a price range where one-sided order flow dominated so strongly that a gap formed between candle wicks. When large institutional orders execute, the speed of the move creates a zone where there weren't enough opposing orders to fill both sides. This leaves an "imbalance" — a price range the market moved through too fast to establish fair value.

**Why does price return to fill FVGs?** Two reasons:

1. **Unfilled institutional orders** — the institution that caused the gap still has orders sitting in that zone. They want to add to their position when price retraces.
2. **Opportunity-seeking flow** — other institutions that missed the original move see the retrace into the gap as an entry at a better price.

The FVG is essentially an **unfilled order zone** — a price range where the market has unfinished business.

### Detection

FVGs are detected using the standard 3-candle pattern:

```text
Bullish FVG: candle[0].low > candle[2].high AND candle[1].close > candle[2].high
  → Gap between candle[2].high (bottom) and candle[0].low (top)
  → The middle candle (candle[1]) is the displacement candle

Bearish FVG: candle[0].high < candle[2].low AND candle[1].close < candle[2].low
  → Gap between candle[0].high (bottom) and candle[2].low (top)
  → The middle candle (candle[1]) is the displacement candle
```

The `candle[1].close` confirmation ensures the displacement candle committed to the move (body close beyond the gap), not just a wick spike.

### Minimum Width Filter (Displacement-Relative)

Not every 3-candle gap is meaningful. A 1-pip FVG on a quiet day is noise. The filter must answer: "is this gap significant relative to the move that created it?"

**The system does NOT use ATR for FVG filtering.** ATR is an average — it smooths out reality and doesn't reflect what happened at this specific moment. Consistent with how we handle EQH/EQL tolerance (swing-relative, not ATR-based), FVG filtering is grounded in the actual candles that formed the gap.

```text
displacementBody = abs(candle[1].close - candle[1].open)
gapSize = FVG top - FVG bottom

Filter: gapSize >= displacementBody × 0.10
```

**Why this works:**
- 80-pip displacement creates a 12-pip FVG → 15% of body → **passes**. Real imbalance from a real move.
- 80-pip displacement creates a 3-pip FVG → 3.75% of body → **fails**. Tiny gap relative to the move, probably noise.
- 15-pip displacement creates a 4-pip FVG → 26% of body → **passes**. Proportionally significant for a quiet market.
- 15-pip displacement creates a 1-pip FVG → 6.7% of body → **fails**. Micro-gap, not meaningful.

This is **self-referencing** — "how significant is this gap relative to the move that created it?" — not backward-looking like ATR.

### The 50% Midline

The midpoint of an FVG is the equilibrium — where institutional orders cluster for optimal fill. The midline is the most common reaction level within an FVG:

```text
midline = (fvgTop + fvgBottom) / 2
```

Price often retraces to the midline and bounces, rather than filling the entire gap. The midline is always tracked and rendered (dotted line through the center of the FVG zone).

### FVG Lifecycle & Status

Every FVG transitions through a lifecycle. **Every state change is recorded as raw data** — this is critical for backtesting FVG effectiveness across the entire database.

```text
Status lifecycle:  FRESH → PARTIAL → FILLED
                              ↘ INVERTED (if price breaks through entirely)
```

| Status | Definition | Visual | Implication |
|--------|-----------|--------|-------------|
| **FRESH** | No price has entered the FVG zone since creation | Full opacity box | Highest quality — untested imbalance |
| **PARTIAL** | Price has entered but not fully filled the gap | Reduced opacity, fill line shown | Still active — unfilled portion holds orders |
| **FILLED** | Body close has covered the entire gap | Hidden or very faint | Dead zone — imbalance resolved, no longer S/R |
| **INVERTED** | Price broke entirely through the FVG in the opposite direction | Dashed border, flipped color | The zone flips polarity — old support becomes resistance |

### Fill Tracking (Continuous)

Fill percentage is tracked continuously (0-100%), not just as binary states. This enables precise backtesting:

```text
Body-based fill:
  Bullish FVG: fillAmount = fvgTop - min(candle.open, candle.close)
  Bearish FVG: fillAmount = max(candle.open, candle.close) - fvgBottom
  fillPercent = min(100, (fillAmount / gapSize) × 100)

Track maximum fill reached (maxFillPercent) — an FVG that was 70% filled
then bounced tells you more than one that was only 20% filled.
```

**Timeframe-scaled "effectively filled" threshold:**

Not all partial fills mean the same thing. A Daily FVG at 90% filled still has meaningful pips of unfilled orders. An M15 FVG at 90% filled has 1-2 pips left — essentially done.

| Timeframe | Effectively Filled At | Reasoning |
|-----------|----------------------|-----------|
| M15 / M30 | 85% | Small gaps, near-fills count |
| H1 / H4 | 90% | Standard threshold |
| D1 | 95% | Large gaps, even small unfilled portions matter |
| W1 / MN | 95% | Massive gaps, always significant until fully closed |

### FVG Event Data (Backtestable)

Every FVG is stored with full context and lifecycle data. This is designed for ClickHouse to answer questions like "what percentage of H4 bullish FVGs formed by displacement get respected at the 50% midline?"

```typescript
interface FVGEvent {
  // Core identity
  id: string;
  pair: string;
  timeframe: string;
  direction: "bullish" | "bearish";
  status: "fresh" | "partial" | "filled" | "inverted";

  // The gap
  topPrice: number;              // Upper boundary
  bottomPrice: number;           // Lower boundary
  midline: number;               // (top + bottom) / 2
  gapSizePips: number;           // Size of the imbalance

  // Creation context
  createdAt: number;             // Timestamp of candle[2] (start of pattern)
  displacementBody: number;      // Body size of the middle candle
  displacementRange: number;     // True range of the middle candle
  gapToBodyRatio: number;        // gapSize / displacementBody — quality metric
  isDisplacement: boolean;       // Was the middle candle a displacement move?
  relativeVolume: number;        // Volume of middle candle vs 20-candle average

  // Fill tracking (updated on every candle)
  fillPercent: number;           // Current fill percentage (0-100)
  maxFillPercent: number;        // Highest fill percentage ever reached
  bodyFilled: boolean;           // Has a candle body fully covered the gap?
  wickTouched: boolean;          // Has a wick entered the gap?
  firstTouchAt?: number;         // Timestamp of first interaction with the gap
  firstTouchBarsAfter?: number;  // How many candles before first interaction

  // Retest tracking
  retestCount: number;           // Times price entered gap but closed back out
  midlineRespected: boolean;     // Did price bounce at or near the 50% midline?
  midlineTouchCount: number;     // How many times price tested the midline

  // Outcome tracking (for backtesting)
  filledAt?: number;             // Timestamp when fully filled
  barsToFill?: number;           // How many candles from creation to fill
  invertedAt?: number;           // Timestamp if/when inverted
  barsToInversion?: number;      // How many candles from creation to inversion

  // Linkage (see Interconnection Philosophy)
  parentBOS?: string;            // BOS event that created this FVG
  containedBy?: string[];        // Higher-TF FVGs this one is nested inside
  confluenceWith?: string[];     // Key levels that overlap with this FVG
  tradeId?: string;              // Trade that used this FVG as entry zone
}
```

### Volume Grading

FVGs formed during high-volume candles are more likely to be institutional and more likely to hold on retest. Volume grading classifies FVGs into quality tiers:

```text
relativeVolume = displacementCandle.volume / SMA(volume, 20)

High volume:  relativeVolume >= 1.5  → Tier 1 (institutional, high quality)
Normal volume: relativeVolume >= 1.0  → Tier 2 (standard)
Low volume:   relativeVolume < 1.0   → Tier 3 (weak, may not hold)
```

Visual rendering adjusts by tier — Tier 1 FVGs are more opaque with a visible border, Tier 3 are faint. This is a visual filter, not a detection filter — all qualifying FVGs are stored, but low-volume ones are visually de-emphasized.

### FVG Inversion

When price breaks entirely through an FVG (body close beyond the far edge), the zone **flips polarity**:

- A bullish FVG (support) becomes bearish (resistance)
- A bearish FVG (resistance) becomes bullish (support)

```text
Bullish FVG at 1.0800-1.0815:
  Price drops, candle closes below 1.0800
  → FVG status: INVERTED
  → Direction flips: now bearish (resistance zone)
  → If price comes back up to 1.0800-1.0815, expect rejection
```

Inverted FVGs are rendered with dashed borders and flipped colors. They remain visible (limited count) as they represent a zone where the market's opinion changed — old demand became supply, or vice versa.

### Multi-Timeframe FVG Nesting

FVGs exist on all timeframes, but they have a natural hierarchy. A Weekly FVG is far more significant than an M15 FVG. When a lower-TF FVG sits inside a higher-TF FVG, that's **nested confluence** — the highest-probability entry zones.

```text
Weekly FVG:  1.0800 - 1.0900 (100 pip zone)
  └── Daily FVG:  1.0830 - 1.0870 (40 pip zone within Weekly)
      └── H4 FVG:  1.0845 - 1.0860 (15 pip zone within Daily)
          └── H1 FVG: 1.0850 - 1.0855 (5 pip precision entry)
```

**The refinement pattern:** Start with a macro zone (Weekly FVG), refine down through Daily and H4, and use H1 for precision entry. Each layer confirms the one above. An H1 FVG inside an H4 FVG inside a Daily FVG inside a Weekly FVG is the highest confluence entry point possible.

**Detection:** FVGs are detected on all timeframes independently. The `containedBy` field on each FVG records which higher-TF FVGs it sits within (computed by checking price overlap).

**Rendering:** By default, show FVGs for the current chart timeframe. Higher-TF FVGs are available as an overlay toggle (similar to session BGs). Lower-TF FVGs are only visible when you switch to that timeframe — no M15 FVGs cluttering an H4 chart.

**Hierarchy for significance:**

| Timeframe | FVG Significance | Typical Lifespan | Use |
|-----------|-----------------|-----------------|-----|
| W1 / MN | Massive institutional imbalance | Weeks to months | Macro positioning |
| D1 | Major zone | Days to weeks | Swing entry zones |
| H4 | Standard zone | Hours to days | Primary trade entries |
| H1 | Minor zone | Hours | Precision entries within HTF zones |
| M15 / M30 | Micro zone | Minutes to hours | Scalping, intraday timing |

### Backtestable Queries (ClickHouse)

With the full FVG lifecycle stored as raw data, ClickHouse can answer:

```text
FVG Effectiveness:
  "What % of H4 bullish FVGs get respected (bounce at 50% or less fill)?"
  "What % of FVGs created by displacement candles hold vs non-displacement?"
  "Average time-to-fill for Daily FVGs on EUR/USD?"
  "Do high-volume FVGs hold longer than low-volume ones?"

FVG + Context:
  "FVGs created during London session: 72% respected. During Sydney: 45%."
  "FVGs with parent BOS: 68% respected. Standalone FVGs: 51%."
  "FVGs overlapping with PDL/PDH: 75% respected (confluence boost)."
  "FVGs in discount zone: 70% respected. In premium zone: 55%."

FVG + Seasonal / Regime:
  "H4 FVG respect rate in Q1 (bearish season): 74%. In Q4 (bullish season): 58%."
  "FVG fill speed during high-volatility months (Mar, Sep): avg 8 candles."
  "FVG fill speed during low-volatility months (Jul, Dec): avg 22 candles."
  "Bullish FVGs in years tagged 'trending': 71% respected vs 'ranging': 49%."

FVG + Trade Performance:
  "Trades entered at FVG midline: avg +1.4R. Trades at FVG edge: avg +0.8R."
  "Trades at nested FVGs (3+ timeframes): 78% win rate."
  "Trades at Tier 1 (high vol) FVGs: 65% win rate vs Tier 3: 42%."
```

Every field in the `FVGEvent` interface exists to make these queries possible. No data is discarded — even filled/inverted FVGs remain in the database as historical records.

---

## Key Level Grid

### What Are Key Levels?

Key levels are price points that the entire market watches. They act as support/resistance and give BOS events their significance. A BOS that also breaks a key level is far more meaningful than one breaking an arbitrary swing.

### The Levels We Track

#### Acronym Reference

These abbreviations are used throughout the system — in chart labels, Claude analysis, BOS enrichment, and trade journal entries:

- **PDH / PDL** — Previous Day High / Previous Day Low
- **PWH / PWL** — Previous Week High / Previous Week Low
- **PMH / PML** — Previous Month High / Previous Month Low
- **YH / YL** — Yearly High / Yearly Low (current calendar year)
- **SH / SL** — Session High / Session Low (per trading session: Sydney, Tokyo, London, New York)
- **S/R** — Support / Resistance (generic term for levels that price reacts to)

#### Level Grid

| Level | Abbr. | Source | Significance | Typical Use |
|-------|-------|--------|-------------|-------------|
| Previous Day High | PDH | Previous completed daily candle's high | Intraday resistance | Intraday targets, session breakout levels |
| Previous Day Low | PDL | Previous completed daily candle's low | Intraday support | Intraday targets, session breakout levels |
| Previous Week High | PWH | Previous completed weekly candle's high | Swing resistance | Multi-day trade targets, swing invalidation |
| Previous Week Low | PWL | Previous completed weekly candle's low | Swing support | Multi-day trade targets, swing invalidation |
| Previous Month High | PMH | Previous completed monthly candle's high | Major structural resistance | Position trade reference, macro bias |
| Previous Month Low | PML | Previous completed monthly candle's low | Major structural support | Position trade reference, macro bias |
| Yearly High | YH | Highest high in the current calendar year | Macro ceiling | Yearly range context, extreme S/R |
| Yearly Low | YL | Lowest low in the current calendar year | Macro floor | Yearly range context, extreme S/R |
| Session High | SH | Running high of current trading session | Intraday micro-resistance | Session breakout, killzone targets |
| Session Low | SL | Running low of current trading session | Intraday micro-support | Session breakout, killzone targets |

#### Significance Hierarchy

Key levels are not equal. A BOS breaking YL is a macro event; a BOS breaking SL is noise. The hierarchy from most to least significant:

```text
YH/YL > PMH/PML > PWH/PWL > PDH/PDL > SH/SL
```

This hierarchy directly feeds into the BOS significance scoring — breaking a higher-tier level adds more weight to the significance score.

### Why Session Highs/Lows?

Session H/L are natural support/resistance levels that form within each trading session. The London session high, for example, is often tested during New York. These are the most granular key levels and help with intraday timing.

Session detection already exists in our system (`lib/trading/sessions.ts`), so extending it to track per-session H/L is a natural fit.

### Key Level Computation

Key levels are computed from historical candle data:
- **Daily H/L**: From the previous completed daily candle
- **Weekly H/L**: From the previous completed weekly candle
- **Monthly H/L**: From the previous completed monthly candle
- **Yearly H/L**: From the highest high / lowest low in the current year
- **Session H/L**: Running high/low of the current trading session (resets each session)

All stored in TimescaleDB for historical reference, refreshed on each new candle.

---

## Premium / Discount Zones

### The Concept

Every structural swing range has an equilibrium — the 50% level. Price below equilibrium is **discount** (cheap relative to the range — favor longs). Price above equilibrium is **premium** (expensive relative to the range — favor shorts).

```text
Swing High: 1.1000  ┌──────────────┐
                     │   PREMIUM    │  ← Expensive — favor sells
                     │              │
Equilibrium: 1.0900  ├──────────────┤  ← 50% — the dividing line
                     │              │
                     │   DISCOUNT   │  ← Cheap — favor buys
Swing Low:  1.0800  └──────────────┘
```

**The institutional logic:** Large players accumulate positions in discount (buying cheap) and distribute in premium (selling expensive). If you're buying at 1.0980, you're buying in premium — even if the trend is bullish, your entry price is poor relative to the dealing range. Entries in discount have better risk/reward by definition.

### Three Tiers of Premium/Discount

Premium/Discount is not a single measurement — it exists at multiple scales simultaneously. The tiers nest inside each other for refinement.

#### Tier 1: Structural (H4, D1, W1)

The most recent structural swing high and swing low on each higher timeframe defines a dealing range. These are the ranges that matter for active trade decisions.

```text
H4 swing range:    1.0850 - 1.0950  → equilibrium: 1.0900
Daily swing range: 1.0750 - 1.1000  → equilibrium: 1.0875
Weekly swing range: 1.0600 - 1.1100 → equilibrium: 1.0850
```

If price is at 1.0920:

- H4: premium (above 1.0900)
- Daily: premium (above 1.0875)
- Weekly: premium (above 1.0850)

**All three say premium = deep premium.** High conviction for shorts. But if Daily said discount while H4 said premium, that's just an H4 pullback within a larger discount zone — very different.

**The refinement pattern:** H4 premium is inside Daily premium is inside Weekly premium. You can narrow down: "I'm not just in premium — I'm in premium across 3 timeframes. This is the worst place to enter a long."

#### Tier 2: Yearly

The current year's high and low define the annual dealing range:

```text
YH: 1.1100    YL: 1.0600    → Mid-year equilibrium: 1.0850
```

This gives macro context that weekly/daily swings can't. A pair sitting above mid-year for 6 months straight is in yearly premium — expect mean reversion pressure back toward equilibrium.

#### Tier 3: Multi-Year / Macro

The broadest view uses significant multi-year highs and lows to define the macro dealing range:

```text
GBP/USD example:
  2016 high: ~1.50
  2022 low:  ~1.03
  Macro equilibrium: ~1.265

  Price at 1.27 = just above macro equilibrium
  → "At macro mid-range — no strong macro directional bias"
```

This tells you where the pair sits in its **big picture** range. A pair at macro premium (near multi-year highs) has different risk characteristics than one at macro discount. This affects position sizing and how long you expect trends to continue.

**Multi-year range detection:** The system auto-detects the highest high and lowest low across available historical data (ClickHouse). For manually significant levels (like the 2016 GBP/USD high specifically), these can be pinned as user-defined macro levels.

### Premium/Discount Event Data (Backtestable)

Premium/Discount zones are computed per-timeframe and stored with every structure event and trade for backtesting:

```typescript
interface PremiumDiscountContext {
  // Per-timeframe zone (structural tier)
  h4Zone: "premium" | "discount";
  h4Equilibrium: number;
  h4SwingRange: { high: number; low: number };
  h4DepthPercent: number;         // How deep into premium/discount (0-100%)

  d1Zone: "premium" | "discount";
  d1Equilibrium: number;
  d1SwingRange: { high: number; low: number };
  d1DepthPercent: number;

  w1Zone: "premium" | "discount";
  w1Equilibrium: number;
  w1SwingRange: { high: number; low: number };
  w1DepthPercent: number;

  // Yearly tier
  yearlyZone: "premium" | "discount";
  yearlyEquilibrium: number;
  yearlyRange: { high: number; low: number };

  // Macro tier
  macroZone: "premium" | "discount";
  macroEquilibrium: number;
  macroRange: { high: number; low: number };

  // Composite
  alignmentCount: number;         // How many tiers agree (1-5)
  isDeepPremium: boolean;         // 3+ tiers say premium
  isDeepDiscount: boolean;        // 3+ tiers say discount
}
```

The `depthPercent` field is crucial for backtesting. "How deep into premium was the entry?" matters — entering at 55% (just barely premium) is different from entering at 90% (deep premium near the swing high).

### Nested Refinement

The power of multi-tier premium/discount is **refinement** — narrowing down from macro to micro:

```text
Macro:  At 1.27, GBP/USD is at macro equilibrium (neutral)
Yearly: At 1.27, above mid-year (yearly premium — mild sell bias)
Weekly: At 1.27, in weekly discount (below W1 equilibrium at 1.28)
Daily:  At 1.27, in daily premium (above D1 equilibrium at 1.265)
H4:     At 1.27, in H4 discount (below H4 equilibrium at 1.275)

Reading: Macro neutral, yearly premium, but weekly discount. Mixed.
Daily and H4 disagree. Wait for alignment before entering.
```

When all tiers align — especially 3+ tiers saying the same thing — that's a high-conviction zone. Claude can express this: "You're in deep discount across H4, Daily, and Weekly. Any bullish BOS here is high conviction."

### Backtestable Queries — Premium/Discount (ClickHouse)

With premium/discount tagged on every trade, BOS event, and FVG interaction, ClickHouse enables edge discovery across the full data set:

```text
Zone Effectiveness:
  "Longs entered in H4 discount: 64% win rate. In H4 premium: 38%."
  "Shorts entered in deep premium (3+ tiers aligned): 71% win rate."
  "Trades at equilibrium (neutral zone): 48% win rate — avoid."

Zone + Seasonal:
  "H4 discount entries in Q1 (bearish season): 42% win rate for longs."
  "H4 discount entries in Q4 (bullish season): 78% win rate for longs."
  "Deep premium shorts in trending years: 69%. In ranging years: 52%."

Zone + FVG:
  "FVGs in discount: 70% respected. FVGs in premium: 55%."
  "FVG at discount + BOS + COT alignment: 82% respected."
  "FVG respect rate by depth — entries at 80%+ discount: 76% respected."

Zone + Key Levels:
  "PDL tests in discount: 72% bounce. PDL tests in premium: 34% bounce."
  "Macro equilibrium as S/R: 61% of tests produce 50+ pip reaction."

Zone Stability:
  "Average time spent in H4 premium before reversal: 18 candles."
  "How often does deep premium (3+ tiers) persist vs mean-revert?"
  "Pairs that spend >70% of Q1 in premium: which ones reverse in Q2?"
```

This is the full vision — every concept (FVGs, BOS events, key levels, premium/discount) tagged with seasonal context, regime context, and cross-referenced against each other. The raw data model makes it possible to discover edges that no single indicator could reveal in isolation.

---

## Multi-Timeframe Direction Scoring

### The Problem

A single timeframe tells you very little. M15 might show a bearish BOS, but if H4, Daily, and Weekly are all bullish, that M15 break is likely just a pullback. We need a composite view.

### Weighted MTF Score

Each timeframe gets a weight reflecting its structural importance:

| Timeframe | Weight | Reasoning |
|-----------|--------|-----------|
| Monthly | 4 | The macro trend — takes months to change |
| Weekly | 3 | The swing trend — takes weeks to change |
| Daily | 2 | The intermediate trend — takes days to change |
| H4 | 1 | The intraday trend — changes within a day |
| H1 | 0.5 | Noise-heavy, lowest weight |

### Direction Per Timeframe

Each timeframe gets a direction score from -1 to +1:

```
+1.0 = Strong bullish (recent bullish BOS + HH/HL structure)
+0.5 = Weak bullish (HH/HL structure but no recent BOS)
 0.0 = Ranging/neutral (no clear direction)
-0.5 = Weak bearish (LH/LL structure but no recent BOS)
-1.0 = Strong bearish (recent bearish BOS + LH/LL structure)
```

### Composite Calculation

```
Score = Σ (timeframe_direction × timeframe_weight)
Max   = Σ weights = 4 + 3 + 2 + 1 + 0.5 = 10.5
Normalized = (Score / Max) × 100  →  range: -100 to +100
```

### Interpretation

| Score Range | Interpretation | Trading Implication |
|-------------|---------------|---------------------|
| +70 to +100 | Strong bullish alignment | High conviction longs, avoid shorts |
| +30 to +70 | Moderate bullish | Longs preferred, counter-trend shorts risky |
| -30 to +30 | Mixed/ranging | Reduce size, expect chop |
| -70 to -30 | Moderate bearish | Shorts preferred, counter-trend longs risky |
| -100 to -70 | Strong bearish alignment | High conviction shorts, avoid longs |

---

## Enriched BOS Events

### The Core Idea

A BOS event in isolation is just "price closed below a level." An **enriched** BOS event tells you *everything about why that matters*:

```
"At 18:15 UTC, EUR/USD closed below 1.0850 on H4 (bearish BOS).
This level was also the Previous Day's Low.
COT shows leveraged money is net short (73rd percentile bearish).
NFP is in 6 hours.
MTF score is -62 (moderate bearish alignment).
Significance: 82/100."
```

### Enrichment Pipeline

Every BOS event passes through an enrichment pipeline that cross-references all available data:

```
Raw BOS Event
    │
    ├── Key Level Check
    │   └── Does this BOS break any key levels? (PDH/PDL/PWH/PWL/PMH/PML/YH/YL/SH/SL)
    │
    ├── COT Alignment
    │   └── Does institutional positioning agree with the BOS direction?
    │
    ├── News Proximity
    │   └── Any high-impact events within ±2 hours?
    │
    ├── MTF Direction
    │   └── What's the composite MTF score at time of break?
    │
    ├── Session Context
    │   └── Which session? (London BOS > Sydney BOS in significance)
    │
    └── Significance Score
        └── Weighted composite of all factors (0-100)
```

### Significance Multiplier

The significance score determines how "important" a BOS event is:

| Factor | Weight | Logic |
|--------|--------|-------|
| Timeframe | 25% | Monthly BOS = 100, Weekly = 80, Daily = 60, H4 = 40, H1 = 20 |
| Key levels broken | 25% | Each key level adds points (Yearly > Monthly > Weekly > Daily > Session) |
| COT alignment | 20% | Institutional positioning agrees = full points |
| MTF alignment | 20% | Higher MTF score in same direction = more points |
| Session context | 10% | London/NY overlap = 100, London/NY = 80, Tokyo = 40, Sydney = 20 |

A BOS event with significance > 70 is a **high-conviction structural shift**. Below 30 is noise.

---

## Counter-Trend Framework

### When Lower Timeframe Diverges from Higher Timeframe

This is the trickiest scenario. Daily is bullish, but H1 just made a bearish BOS. Is this a pullback entry opportunity (buy the dip) or the start of a reversal?

### The Framework

```
HTF Direction: Bullish (Daily HH/HL, Weekly HH/HL)
LTF Signal:    Bearish BOS on H1

Decision tree:
├── MTF Score > +50 → Likely pullback. Counter-trend short is valid but:
│   ├── Target: HTF key levels (PDL, nearest HL)
│   ├── Size: Reduced (not full conviction)
│   └── Close reason if wrong: "thesis_broken" (ties to Plan vs Reality tracking)
│
├── MTF Score +20 to +50 → Uncertain. Structure is weakening.
│   ├── Wait for confirmation before trading either direction
│   └── Flag as "mixed alignment" for Claude to analyze
│
└── MTF Score < +20 → HTF trend may be changing.
    ├── The H1 bearish BOS might be the leading edge of a reversal
    └── Look for Daily BOS to confirm
```

### Connection to Plan vs Reality

This directly ties into the `thesis_broken` close reason. When a trader enters a counter-trend trade and the HTF trend reasserts itself, the correct action is to close with `thesis_broken` — "my lower-TF bearish thesis was invalidated by the higher-TF bullish structure."

Claude can analyze these patterns: "You've taken 8 counter-trend trades this month. 3 hit TP (avg +0.8R), 5 were closed thesis_broken (avg -0.4R). Net: slightly negative. Consider waiting for MTF score < +20 before counter-trend entries."

---

## Rendering & Visualization

### Chart Annotations

| Element | Style | Purpose |
|---------|-------|---------|
| Swing labels (HH/HL/LH/LL/EQH/EQL) | Text with colored background | Quick visual structure read |
| Bullish BOS | Green dashed horizontal line | Shows where bullish break was confirmed |
| Bearish BOS | Red dashed horizontal line | Shows where bearish break was confirmed |
| Key levels | Thin solid lines with labels | PDH/PDL/PWH/PWL etc. always visible |
| MTF indicator | Small badge or panel | Current composite score |

### Label Colors

| Label | Color | Background |
|-------|-------|------------|
| HH | Green text | Semi-transparent green |
| HL | Green text | Semi-transparent green |
| LH | Red text | Semi-transparent red |
| LL | Red text | Semi-transparent red |
| EQH | Yellow text | Semi-transparent yellow |
| EQL | Yellow text | Semi-transparent yellow |

### BOS Lines

- Extend from the broken swing point to the right edge of the chart
- Dashed style (not solid — distinguishes from key levels)
- Green for bullish BOS, red for bearish BOS
- Include timestamp and price label

### Claude Coordinates

Every rendered element includes precise coordinates so Claude can reference them:

```
"BOS at 1.0850, confirmed by 18:15 UTC candle close at 1.0843 (7 pips below)"
"HH at 1.0920 formed at 2026-02-05 14:00 UTC"
"PDL at 1.0850, PWL at 1.0810"
```

This allows Claude to say things like: "I see you entered short after the bearish BOS at 1.0850 (18:15 UTC). Good entry — this also broke the Previous Day's Low, and COT is bearish. However, the Previous Week's Low at 1.0810 is only 40 pips away. Consider that as your primary target rather than holding for more."

---

## Architecture & Computation

### Why API/Worker, Not Client-Side?

| Approach | Pros | Cons |
|----------|------|------|
| **Client-side** | Real-time, no server roundtrip | Can only see loaded candles, no MTF cross-reference, heavy computation in browser |
| **API route** | Access to all TFs, cross-reference with COT/news/key levels, serves both chart and Claude | Slight latency, needs caching |
| **Worker** | Background processing, can pre-compute | Not real-time, overkill for on-demand queries |

**Decision: API route as primary, with caching.** The structure engine needs access to multiple timeframes simultaneously, cross-referencing with COT data, news events, and key levels. This can only happen server-side where we have direct database access.

### API Endpoint

```
GET /api/structure/[pair]?timeframe=H4&depth=100

Response:
{
  pair: "EUR_USD",
  timeframe: "H4",
  swings: [...],          // Detected swing points with labels
  bosEvents: [...],       // BOS events with enrichment
  currentStructure: {     // Current trend state
    direction: "bearish",
    lastBOS: {...},
    swingSequence: ["HH", "HL", "LH", "LL"]
  },
  keyLevels: {...},       // Current key level grid
  mtfScore: {             // Multi-timeframe composite
    score: -62,
    breakdown: { M: -1, W: -0.5, D: -1, H4: -1, H1: -0.5 }
  }
}
```

### Data Flow

```
┌──────────────┐
│  TimescaleDB  │ ← Candle data (all timeframes)
│  (Hot Data)   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│           /api/structure/[pair]                    │
│                                                    │
│  1. Fetch candles for requested TF + all higher TFs│
│  2. Detect swings (per TF, scaled lookback)        │
│  3. Label structure (HH/HL/LH/LL/EQH/EQL)         │
│  4. Detect BOS events (body close confirmation)     │
│  5. Compute key level grid                          │
│  6. Calculate MTF direction score                   │
│  7. Enrich BOS events (COT, news, key levels)       │
│  8. Calculate significance scores                    │
└──────┬────────────────────┬───────────────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐    ┌──────────────┐
│  Chart UI     │    │  Claude Chat  │
│  (Rendering)  │    │  (Analysis)   │
└──────────────┘    └──────────────┘
```

### Caching Strategy

Structure doesn't change on every tick. Cache with short TTL:
- **M15/H1**: 1-minute cache (fast-moving)
- **H4**: 5-minute cache
- **D1+**: 15-minute cache

Cache invalidated on new candle close for the relevant timeframe.

---

## Endgame Architecture — Full System Design

This section defines the complete, no-shortcuts architecture for the market structure engine across all three databases, computation layers, chart rendering, Claude integration, and backtesting. This is the target state — what the system looks like when fully built.

### Database Storage

#### TimescaleDB (Hot — 30 Days)

TimescaleDB holds the actively-queried structure data. These are the tables the API reads from when a chart loads or Claude needs context:

```text
swing_points
  ├── id, pair, timeframe, timestamp
  ├── price, type (high/low)
  ├── label (HH/HL/LH/LL/EQH/EQL)
  ├── lookbackUsed, trueRange
  └── Hypertable, partitioned by time

bos_events
  ├── id, pair, timeframe, timestamp
  ├── direction, status (active/reclaimed)
  ├── brokenLevel, confirmingClose, magnitudePips
  ├── isDisplacement, isCounterTrend
  ├── significance, keyLevelsBroken[], cotAlignment, mtfScore
  ├── reclaimedAt, reclaimedByClose, timeTilReclaim
  └── Hypertable, partitioned by time

fvg_events
  ├── id, pair, timeframe, timestamp
  ├── direction, status (fresh/partial/filled/inverted)
  ├── topPrice, bottomPrice, midline, gapSizePips
  ├── displacementBody, gapToBodyRatio, isDisplacement, relativeVolume
  ├── fillPercent, maxFillPercent, bodyFilled, wickTouched
  ├── firstTouchAt, retestCount, midlineRespected, midlineTouchCount
  ├── filledAt, barsToFill, invertedAt, barsToInversion
  ├── parentBOS, containedBy[], confluenceWith[], tradeId
  └── Hypertable, partitioned by time

key_levels
  ├── id, pair, date
  ├── pdh, pdl, pwh, pwl, pmh, pml, yh, yl
  ├── sydney_h, sydney_l, tokyo_h, tokyo_l, london_h, london_l, ny_h, ny_l
  └── Refreshed on each session/day/week/month close

sweep_events
  ├── id, pair, timeframe, timestamp
  ├── direction, sweptLevel, wickExtreme
  ├── sweptLevelType (swing/key_level/eqh/eql)
  ├── followedByBOS (boolean — did a BOS confirm after?)
  └── Hypertable, partitioned by time
```

**Why TimescaleDB for hot structure?** The API needs sub-100ms reads for chart rendering and Claude context. TimescaleDB's hypertable indexing on (pair, timeframe, time) gives us exactly that. 30 days of structure data covers all active trading decisions.

#### ClickHouse (Cold — Full History)

ClickHouse mirrors the same structure tables but holds the **complete historical record** — every swing, BOS, FVG, and sweep ever detected. This is the backtesting engine.

```text
structure_archive (MergeTree, partitioned by month)
  ├── Mirrors all TimescaleDB structure tables
  ├── swing_points_archive
  ├── bos_events_archive
  ├── fvg_events_archive
  ├── sweep_events_archive
  └── Populated by worker archival job (daily)

macro_ranges (manually curated + auto-detected)
  ├── pair, range_type (yearly/multi_year/all_time)
  ├── high_price, high_date, low_price, low_date
  ├── equilibrium
  ├── source (auto_detected / user_defined)
  └── Used for Tier 2/3 Premium/Discount computation

materialized_views (pre-computed aggregations)
  ├── fvg_effectiveness_by_pair_tf — respect rates, fill times
  ├── bos_follow_through_by_pair_tf — continuation rates, avg magnitude
  ├── seasonal_bias_by_pair_quarter — quarterly directional tendencies
  ├── key_level_reaction_rates — bounce/break/sweep percentages
  ├── session_performance_by_pair — per-session directional stats
  └── regime_classification_by_year — trending/ranging/crisis tags
```

**Why ClickHouse for cold structure?** Backtesting queries scan millions of rows: "FVG respect rate across 5 years of H4 data for all pairs." ClickHouse's columnar storage and vectorized execution handles this in seconds where TimescaleDB would struggle.

#### Convex (App State — Reactive)

Convex does NOT store structure data. It stores the **linkage** between structure entities and trades, plus user preferences:

```text
structureLinks
  ├── tradeId (reference to trades table)
  ├── entityType ("bos" | "fvg" | "key_level" | "sweep")
  ├── entityId (references TimescaleDB entity)
  ├── role ("entry_reason" | "exit_target" | "invalidation" | "confluence")
  ├── note (optional user annotation)
  └── Indexes: by_trade, by_entity

structurePrefs
  ├── userId
  ├── overlayToggles: { swings, bos, fvgs, levels, premiumDiscount }
  ├── fvgMinTier (1/2/3 — volume tier filter)
  ├── showRecentOnly (boolean — hide old filled FVGs)
  └── Per-user rendering preferences
```

**Why Convex for linkage only?** Convex is reactive — when a trade is opened and linked to a BOS event, the trade detail modal updates in real time. But Convex is not designed for time-series queries or analytical aggregation. Structure computation stays in TimescaleDB/ClickHouse. Convex handles the social layer: "this trade used this structure."

### Computation Flow

#### Worker: Pre-Computes HTF Structure

The worker runs on Railway as a long-running process. It pre-computes structure on higher timeframes where data doesn't change often:

```text
Worker responsibilities (HTF — D1, W1, MN):
  ├── On D1 candle close (00:00 UTC):
  │   ├── Fetch D1 candles from ClickHouse (200+ candles)
  │   ├── Detect swings, label structure, detect BOS
  │   ├── Compute key levels (PDH/PDL refreshed)
  │   ├── Update FVG lifecycle (fill tracking for all active D1 FVGs)
  │   ├── Write results to TimescaleDB (hot) + ClickHouse (archive)
  │   └── Duration: ~2-5 seconds per pair
  │
  ├── On W1 candle close (Sunday 00:00 UTC):
  │   ├── Same as D1 but for weekly structure
  │   ├── PWH/PWL refreshed
  │   └── Weekly FVG lifecycle update
  │
  ├── On MN candle close (1st of month):
  │   ├── Monthly structure detection
  │   ├── PMH/PML refreshed, YH/YL checked
  │   └── Macro range auto-detection (new yearly extremes?)
  │
  └── Daily archival job:
      ├── Copy expired TimescaleDB structure (>30 days) to ClickHouse
      ├── Refresh ClickHouse materialized views
      └── Run regime classification on new data
```

**Why worker for HTF?** Daily/Weekly/Monthly candles close once. There's no reason to recompute D1 structure on every API request — it only changes once per day. The worker computes it once, stores it, and every API request reads the pre-computed result. This also means the worker can use ClickHouse for deep history (200+ D1 candles = 10 months) that TimescaleDB's 30-day window can't provide.

#### API: Computes LTF On-Demand

The API route handles lower timeframes that change frequently:

```text
GET /api/structure/[pair]?timeframe=H4&depth=100

API responsibilities (LTF — M15, H1, H4):
  ├── Fetch candles from TimescaleDB (within 30-day window)
  ├── Detect swings, label structure, detect BOS (real-time computation)
  ├── Detect FVGs, track fill progress on active FVGs
  ├── Read pre-computed HTF structure from TimescaleDB (D1/W1/MN)
  ├── Compute MTF score (using LTF + pre-computed HTF)
  ├── Enrich BOS events (COT, news, key levels, session, MTF score)
  ├── Compute premium/discount context (all tiers)
  ├── Cache result (TTL by timeframe: M15=1min, H1=3min, H4=5min)
  └── Return unified StructureResponse to chart + Claude

Response shape:
{
  pair, timeframe, computedAt,
  swings: SwingPoint[],
  bosEvents: BOSEvent[],
  fvgEvents: FVGEvent[],
  sweeps: SweepEvent[],
  keyLevels: KeyLevelGrid,
  mtfScore: { score, breakdown },
  premiumDiscount: PremiumDiscountContext,
  currentStructure: {
    direction, lastBOS, swingSequence
  }
}
```

**Why API for LTF?** H4 structure changes every 4 hours, H1 every hour, M15 every 15 minutes. These must be computed fresh (or from short-lived cache) against current candle data. The API has direct access to TimescaleDB for candles and to the pre-computed HTF results the worker stored.

### Data Flow Diagram

```text
                    ┌─────────────────────────────────────┐
                    │            ClickHouse                │
                    │  (Full History + Backtesting)        │
                    │                                     │
                    │  candles_archive (years)             │
                    │  structure_archive (all entities)    │
                    │  macro_ranges                        │
                    │  materialized_views (aggregations)   │
                    └───────┬──────────────┬──────────────┘
                            │              │
                    reads for│              │ daily archive
                    HTF calc │              │ writes
                            │              │
                    ┌───────▼──────────────▼──────────────┐
                    │             Worker                   │
                    │  (Railway — long-running process)    │
                    │                                     │
                    │  D1/W1/MN structure computation      │
                    │  Key level refresh                   │
                    │  FVG lifecycle updates               │
                    │  Archive expired hot data            │
                    └───────┬─────────────────────────────┘
                            │
                            │ writes pre-computed
                            │ HTF structure
                            ▼
                    ┌─────────────────────────────────────┐
                    │           TimescaleDB                │
                    │  (Hot 30 Days)                       │
                    │                                     │
                    │  candles (M15 → MN)                  │
                    │  swing_points                        │
                    │  bos_events                          │
                    │  fvg_events                          │
                    │  key_levels                          │
                    │  sweep_events                        │
                    └───────┬─────────────────────────────┘
                            │
                            │ reads candles +
                            │ pre-computed HTF
                            ▼
                    ┌─────────────────────────────────────┐
                    │         API Route                    │
                    │  /api/structure/[pair]               │
                    │                                     │
                    │  Computes LTF structure (M15/H1/H4) │
                    │  Reads pre-computed HTF (D1/W1/MN)  │
                    │  Enriches with COT, news, sessions  │
                    │  Caches by timeframe TTL             │
                    └───────┬──────────────┬──────────────┘
                            │              │
                            ▼              ▼
                    ┌──────────────┐ ┌──────────────┐
                    │  Chart UI    │ │  Claude Chat  │
                    │  (overlays)  │ │  (analysis)   │
                    └──────────────┘ └──────┬───────┘
                                           │
                                    ┌──────▼───────┐
                                    │    Convex     │
                                    │  (linkage)    │
                                    │  trade↔entity │
                                    └──────────────┘

  Backtesting (separate flow):
  ┌──────────────┐         ┌─────────────────────────────┐
  │  /backtesting │────────▶│  ClickHouse (direct query)  │
  │  page (UI)    │◀────────│  structure_archive tables    │
  └──────────────┘         └─────────────────────────────┘
```

### Chart Rendering

Structure elements are **computed overlays**, not Convex drawings. They are rendered using Lightweight Charts v5 primitives and custom plugins:

```text
Rendering approach:
  ├── Swings: Markers (SeriesMarkers) — HH/HL/LH/LL/EQH/EQL text labels
  ├── BOS lines: PriceLine or custom primitive — dashed horizontal, green/red
  ├── FVG zones: Custom box primitive — semi-transparent fill, midline dotted
  ├── Key levels: PriceLine — solid thin lines with text labels
  ├── Premium/Discount: Background shading — green tint (discount) / red tint (premium)
  └── Sweep markers: Small arrow markers at sweep points

Toggle system (per-user, stored in Convex structurePrefs):
  ├── Swings: on/off
  ├── BOS lines: on/off
  ├── FVG zones: on/off (+ tier filter: show Tier 1 only, Tier 1+2, all)
  ├── Key levels: on/off (+ granularity: daily only, weekly+, monthly+)
  ├── Premium/Discount shading: on/off
  └── HTF overlay: show higher-TF FVGs/BOS on current chart
```

**Why not Convex drawings?** Structure elements are ephemeral computed data — they're regenerated from candle data on every computation. Storing them as Convex drawings would create millions of drawing records, conflict with the user's actual drawings (trendlines, annotations), and require constant sync between computed state and stored state. Instead, the chart receives structure data from the API and renders overlays independently of the drawing system.

### Claude Integration

Claude gets new data tools that expose structure entities. These follow the existing hybrid pattern (server-side execution via the data tools executor):

```text
New Claude data tools:
  ├── get_structure
  │   └── Full structure response for a pair/timeframe
  │   └── Swings, BOS events, current trend, MTF score
  │
  ├── get_active_fvgs
  │   └── All fresh/partial FVGs for a pair
  │   └── Filtered by timeframe, optionally by status
  │   └── Includes fill %, midline, volume tier, confluence
  │
  ├── get_bos_history
  │   └── Recent BOS events with enrichment
  │   └── Filtered by timeframe, direction, significance threshold
  │   └── Includes reclaimed events with reclaim metadata
  │
  ├── get_mtf_score
  │   └── Current multi-timeframe composite score
  │   └── Per-TF breakdown with direction reasoning
  │
  ├── get_premium_discount
  │   └── Full PremiumDiscountContext for current price
  │   └── All three tiers, alignment count, depth percentages
  │
  └── get_key_levels
      └── Current key level grid
      └── PDH/PDL/PWH/PWL/PMH/PML/YH/YL + session H/L
      └── Distance from current price to each level
```

These tools let Claude reason about structure with precision: "Looking at your H4 chart, there's a fresh bearish FVG at 1.0860-1.0845 (Tier 1, 1.8x volume) created by the BOS at 14:30. The midline at 1.0852 overlaps with what was PDL. MTF score is -62. If price retests this zone, it's a high-confluence short entry."

### Backtesting — Separate Interface

Backtesting is NOT on the chart page. It's a dedicated `/backtesting` route that queries ClickHouse directly and presents statistical tables, charts, and heatmaps — not price charts.

```text
/backtesting page:
  ├── Query builder
  │   ├── Select pair(s), timeframe(s), date range
  │   ├── Select entity type (BOS, FVG, sweep, key level)
  │   ├── Filter conditions (displacement only, Tier 1+ volume, etc.)
  │   └── Cross-reference selectors (season, regime, premium/discount)
  │
  ├── Result displays
  │   ├── Statistics table: win rate, avg R, follow-through %, fill rate
  │   ├── Distribution chart: histogram of outcomes
  │   ├── Heatmap: pair × timeframe effectiveness grid
  │   ├── Seasonal chart: performance by quarter/month
  │   └── Equity curve: hypothetical P&L of the filtered strategy
  │
  └── Saved queries
      ├── User can save and name query configurations
      ├── "My H4 FVG retest strategy" — saved filters, shareable
      └── Stored in Convex for persistence
```

**Why separate from chart?** Backtesting is analytical, not visual. You're not looking at a price chart — you're looking at statistical distributions across thousands of events. A query like "FVG respect rate by quarter across all pairs for 5 years" returns a table, not a chart. Mixing this into the trading chart UI would clutter both interfaces. The backtesting page reads directly from ClickHouse (no TimescaleDB intermediary) for maximum query speed across large datasets.

---

## Interconnection Philosophy

### Core Principle: Nothing Is Independent

Every structure element — every FVG, BOS event, swing point, key level — is a **first-class entity** that can be referenced by ID, linked to trades, linked to each other, captured in snapshots, and queried historically. No data exists in isolation. This is the single most important architectural decision in the system.

### The Entity Model

Every structure element shares a common shape that enables linkage:

```typescript
interface StructureEntity {
  id: string;                    // Unique, referenceable (e.g. "bos_h4_eurusd_1707321600")
  pair: string;
  timeframe: string;
  timestamp: number;
  type: "swing" | "bos" | "fvg" | "key_level";

  // Cross-entity linkage
  tradeId?: string;              // "This FVG was my entry reason for trade #47"
  parentBOS?: string;            // "This FVG was created by BOS bos_id_123"
  childFVGs?: string[];          // "This BOS created these FVGs"
  confluenceWith?: string[];     // "This FVG overlaps with PDL and Session Low"

  // Context snapshot at creation time
  mtfScoreAtCreation: number;
  cotAlignmentAtCreation: boolean;
  nearbyNews: NewsEvent[];
  premiumDiscountZone: "premium" | "discount";
}
```

The `tradeId` link follows the same pattern already used for drawings → trades. But now it extends to all structure elements.

### How Structure Elements Connect to Each Other

#### FVG ↔ BOS (Born Together)

When a displacement candle creates a BOS, it almost always creates an FVG in the same move. These are naturally linked:

```text
BOS Event (H4 bearish, 14:30 UTC, bos_id_123)
  └── created FVG (bearish, 1.0860-1.0845, fvg_id_456)
```

An FVG without a BOS is just an imbalance. An FVG *created by* a BOS is a **structural entry zone** — price broke structure and left an imbalance to come back to. The link tells you WHY the FVG exists, and that's a qualitatively different signal.

#### FVG ↔ Key Levels (Confluence)

An FVG that overlaps with a key level is more significant than a random FVG:

```text
FVG (bullish, 1.0800-1.0815, fvg_id_789)
  └── overlaps: PDL (1.0805), Session Low (1.0810)
  └── confluenceScore: high
```

Claude can say: "There's a bullish FVG overlapping with PDL — double confluence. This is a high-quality entry zone."

#### BOS ↔ Key Levels (Significance)

Already covered in the enrichment pipeline — a BOS that breaks a key level inherits that level's significance:

```text
BOS that breaks PDL = intraday significance
BOS that breaks PWL = swing significance
BOS that breaks PML = macro significance
BOS that breaks YL  = macro regime event
```

#### BOS ↔ News (Catalyst Tagging)

A BOS 5 minutes after NFP is news-driven. A BOS during quiet London is structure-driven. Different implications for follow-through:

```text
BOS Event (bos_id_123):
  nearbyNews: [{ event: "NFP", minutesBefore: -5 }]
  catalyst: "news-driven"    → likely sustained, expect volatility
  vs.
  catalyst: "structure-driven" → cleaner move, more predictable
```

An FVG created during a news spike may fill faster (volatile conditions) vs one created during slow price action (more likely to hold as entry zone).

### How Structure Connects to Trades

This is the most valuable linkage. Right now trades have entry/exit prices and close reasons. Structure elements give trades a **structured thesis** — not just "I went short" but "I went short because of these specific conditions":

```text
Trade #47 (EUR/USD short)
  entryThesis:
    - primaryBOS: bos_id_123 (H4 bearish BOS at 14:30)
    - entryZone: fvg_id_456 (retest of bearish FVG created by that BOS)
    - zone: premium (on H4 swing range)
    - mtfScore: -62 (moderate bearish alignment)
    - cotAlignment: true (leveraged money net short)
  exitPlan:
    - tp1: key_level_PWL (1.0810)
    - tp2: key_level_PML (1.0750)
    - invalidation: bos_id_123.level (if price reclaims 1.0860 → thesis broken)
  actualExit:
    - reason: tp1_hit
    - closedAt: key_level_PWL
```

When a trade closes with `thesis_broken`, you can point to exactly **what** broke — "BOS level at 1.0860 was reclaimed" references a specific entity, not a vague feeling.

### How Structure Connects to Snapshots

Snapshots already capture drawings at trade entry/exit moments. Structure state should be captured alongside:

```text
Snapshot (trade #47 entry moment):
  candles: [...]
  drawings: [...]
  structureContext:                    // NEW — frozen structure state
    activeFVGs: [fvg_id_456, fvg_id_789]
    recentBOS: [bos_id_123]
    mtfScore: -62
    premiumDiscount: { H4: "premium", D1: "discount" }
    keyLevels: { PDL: 1.0805, PWL: 1.0810, PMH: 1.0920, ... }
    swingSequence: ["HH", "HL", "LH", "LL"]
```

When reviewing the trade months later, you don't just see the chart — you see the full structural context that informed the decision. Claude can analyze: "At entry, MTF was -62, you were in H4 premium, COT agreed. This was a well-structured entry."

### How Structure Connects to Claude

Claude currently has drawing tools and data tools. Structure gives Claude a new analysis layer where every reference is to a specific, traceable entity:

```text
Claude: "Looking at EUR/USD:
- H4 just made a bearish BOS (bos_id_123) breaking PDL
- There's an unfilled bearish FVG at 1.0860-1.0845 from that move (fvg_id_456)
- You're in discount on Daily but premium on H4
- COT: leveraged money net short (73rd percentile)
- MTF score: -62 (moderate bearish)

If price retests the FVG at 1.0850-1.0860, that's a high-confluence
short entry. The FVG was created by the BOS, overlaps with what was
PDL (now resistance), and COT agrees."
```

### How Structure Connects to Historical Pattern Mining (ClickHouse)

Over time, with trades linked to structure elements, ClickHouse can answer statistical questions about YOUR trading:

```text
"Your trades entered at BOS-created FVG retests: 68% win rate, avg +1.2R"
"Your trades entered WITHOUT FVG retest: 41% win rate, avg +0.3R"
"Trades with BOS + FVG + COT alignment + discount zone: 78% win rate"
"Trades taken against MTF score: 29% win rate"
"Counter-trend trades where BOS level was reclaimed within 4h: 85% losers"
```

This closes the plan-vs-reality loop. You're not just tracking P&L — you're tracking **which structural conditions produce your edge** and which ones you should avoid.

### How Structure Connects to COT Positioning

```text
"Bearish BOS on Daily + Leveraged Money net short = high conviction"
"Bullish BOS but COT flipping bearish = caution, possible institutional trap"
"FVG retest in discount + COT bullish = highest quality long setup"
```

### How Structure Connects to Session Context

```text
"London session BOS = high conviction (peak liquidity, institutional flow)"
"Sydney session BOS = lower conviction (thin markets, prone to fakeouts)"
"FVG created during London, retested during New York = classic continuation setup"
```

### The Full Interconnection Web

```text
                    ┌──────────────┐
                    │  Trade #47   │
                    │  (the WHY)   │
                    └──────┬───────┘
                           │ links to
          ┌────────────────┼────────────────┐
          │                │                │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
    │ BOS Event │──▶│    FVG    │   │ Key Level │
    │ (thesis)  │   │ (entry)   │   │ (target)  │
    └─────┬─────┘   └─────┬─────┘   └───────────┘
          │               │
    ┌─────▼─────┐   ┌─────▼─────┐
    │   COT     │   │ Premium/  │
    │(confirms) │   │ Discount  │
    └───────────┘   └───────────┘
          │               │
          └───────┬───────┘
                  │
           ┌──────▼──────┐
           │  Snapshot   │  ← Freezes ALL of this at trade moment
           │  (proof)    │
           └──────┬──────┘
                  │
           ┌──────▼──────┐
           │ ClickHouse  │  ← Archives for pattern mining
           │ (learning)  │
           └─────────────┘
```

### No Isolated Data

Every module exposes its data for other modules to consume. This is enforced architecturally — all structure elements share the `StructureEntity` base with linkage fields. Nothing can be created without the system knowing what it relates to.

---

## Historical Pattern Discovery — ClickHouse

### The Two-Database Split

TimescaleDB holds the hot 30 days — that's what the real-time structure engine queries. But **ClickHouse holds years of data**, and that's where pattern discovery happens. The real-time engine tells you *what's happening now*. ClickHouse tells you *what has historically happened in similar conditions*.

### What ClickHouse Enables

#### Quarterly/Monthly Seasonality

```
"EUR/USD has been bearish in Q1 for 7 of the last 10 years."
"GBP/USD tends to rally in Q4 — 8/10 years show bullish Q4."
```

This isn't random — it reflects institutional flow patterns: fiscal year rebalancing, central bank calendars, corporate hedging cycles. When you can see "Q1-Q3 bearish, Q4 bullish" across multiple years, that's a structural pattern worth trading around.

#### Yearly Regime Detection

Not all years are equal. 2008 was a crash. 2017 was a grind higher. 2022 was a rate-hike regime. By tagging years by behavior (trending, ranging, crisis, recovery), the system can answer: "Are current conditions more similar to 2018 or 2022?"

This matters for position sizing and expectations. In a trending regime, holding winners longer pays off. In a ranging regime, taking profits early is better. The structure engine detects the current state; ClickHouse tells you what that state historically led to.

#### Historical BOS Pattern Mining

Every BOS event we detect in real-time can be compared against years of historical BOS events:

```
"After a Monthly bearish BOS on EUR/USD:
 - Average follow-through: 450 pips over 3 months
 - 65% of the time, the next Monthly candle was also bearish
 - Q4 reversal probability: 40% (higher than other quarters)
 - Similar setups in 2014, 2018, 2022 led to extended moves"
```

This turns a single BOS event into a statistical edge. Not "I think it'll go down" but "historically, this pattern continued 65% of the time."

#### Key Level Reaction History

```
"When EUR/USD reaches the Previous Yearly Low:
 - Bounced within 50 pips: 70% of the time
 - Broke through on first test: 15%
 - Swept and reversed: 15%
 - Average bounce: 180 pips over 2 weeks"
```

This gives every key level on the chart a historical probability. The trader (and Claude) can say "we're approaching the Yearly Low, which has bounced 70% of the time — reduce short size or take profits here."

#### Session Performance Over Time

```
"London session has been more bearish than NYC for the last 6 months on EUR/USD"
"Tokyo session BOS events on GBP/JPY have 80% follow-through rate"
```

Combined with the session detection already in the system, this becomes actionable: "London session is historically bearish on this pair right now — favor short setups during LDN."

### Architecture

```
ClickHouse (cold/historical — years of data)
    │
    ├── /api/historical/seasonality/[pair]
    │   └── Monthly/Quarterly/Yearly directional bias
    │   └── "Q1 bearish 7/10 years, Q4 bullish 8/10 years"
    │
    ├── /api/historical/bos-patterns/[pair]
    │   └── "After [TF] [direction] BOS, what typically happens?"
    │   └── Follow-through %, avg magnitude, avg duration
    │
    ├── /api/historical/key-level-reactions/[pair]
    │   └── Bounce/break/sweep rates at yearly/monthly levels
    │   └── Average bounce magnitude and duration
    │
    └── /api/historical/regime/[pair]
        └── Current conditions vs historical regimes
        └── Similar year identification
```

### Connection to Real-Time Structure

The historical layer enriches every real-time decision:

```text
Real-time structure engine:
  "4H bearish BOS just confirmed, broke PDL"

+ ClickHouse historical context:
  "After H4 bearish BOS that breaks PDL on EUR/USD:
   - 72% continuation rate
   - Average additional downside: 80 pips
   - But we're in Q4, which historically reverses — 40% reversal probability"
   - Current year regime: similar to 2022 (trending)"

= Enriched insight for Claude and trader:
  "High probability continuation, but Q4 seasonality adds caution.
   Suggest: take partial profits at PWL (40 pips away),
   trail stop on remainder."
```

This is what makes the system more than a charting tool — it's a decision engine backed by statistical evidence.

### Data Requirements

| Query Type | ClickHouse Tables | Approx. Data |
| ---------- | ----------------- | ------------ |
| Seasonality | Candles (D1, W1, MN) | 10+ years monthly/weekly |
| BOS patterns | Pre-computed BOS events table | All detected BOS events historically |
| Key level reactions | Candles + computed key levels | 5+ years daily |
| Regime detection | Candles (MN) + volatility metrics | 15+ years monthly |

The BOS events table in ClickHouse would be populated by a worker job that runs the structure detection algorithm against historical data — the same algorithm used in real-time, applied to the past.

---

## Implementation Phases

The structure engine is built incrementally. Each phase is independently useful — you get value from Phase 1 before Phase 2 exists.

### Phase 1: Foundation — Swings, BOS, Key Levels

**What:** Swing detection, structure labeling, BOS detection (with body-close confirmation), sweep detection, key level grid computation.

**Database work:**

- TimescaleDB: Create `swing_points`, `bos_events`, `sweep_events`, `key_levels` tables
- ClickHouse: Create mirror archive tables

**API:**

- `GET /api/structure/[pair]?timeframe=H4` — returns swings, BOS events, sweeps, key levels, current trend state

**Chart:**

- Swing labels (HH/HL/LH/LL/EQH/EQL markers)
- BOS lines (dashed horizontal, green/red)
- Key level lines (PDH/PDL/PWH/PWL/PMH/PML/YH/YL)
- Toggle controls in sidebar

**Value:** You can see the market's structure on the chart. Claude can reference BOS events. This is the minimum viable structure engine.

### Phase 2: FVGs + Premium/Discount

**What:** FVG detection with displacement-relative filtering, lifecycle tracking, fill monitoring, volume grading, multi-TF nesting. Premium/Discount computation across three tiers.

**Database work:**

- TimescaleDB: Create `fvg_events` table
- ClickHouse: Create `fvg_events_archive`, `macro_ranges` tables

**API:**

- Extend `/api/structure/[pair]` response with `fvgEvents` and `premiumDiscount`

**Chart:**

- FVG zones (semi-transparent boxes with midline)
- Premium/Discount background shading
- FVG tier filter (show Tier 1 only, all, etc.)

**Worker:**

- FVG fill tracking job (update fill percentages on each candle close)
- Macro range auto-detection

**Value:** Entry zones become visible. Claude can say "there's a fresh Tier 1 FVG in discount — high-quality entry." Premium/Discount gives every trade a zone context.

### Phase 3: MTF Scoring + Enrichment + Claude Tools

**What:** Multi-timeframe direction scoring, BOS enrichment pipeline (COT, news, session, significance scoring), `isCounterTrend` flag, displacement detection, BOS invalidation tracking. Claude data tools for structure.

**Worker:**

- Pre-compute HTF structure (D1/W1/MN) on candle close
- Store results in TimescaleDB for API consumption

**API:**

- MTF score computation (combining LTF real-time + HTF pre-computed)
- BOS enrichment pipeline (cross-reference COT, news, key levels)
- New Claude tools: `get_structure`, `get_active_fvgs`, `get_bos_history`, `get_mtf_score`, `get_premium_discount`, `get_key_levels`

**Chart:**

- MTF score indicator (badge or small panel)
- BOS significance coloring (brighter = more significant)
- Counter-trend BOS visual distinction

**Value:** Every BOS event is now enriched with full context. Claude can give precise analysis backed by MTF alignment, COT positioning, and key level confluence. The system goes from "what happened" to "what it means."

### Phase 4: ClickHouse Historical + Backtesting Page

**What:** Historical structure backfill (run detection algorithm against years of ClickHouse candle data), materialized views for aggregations, backtesting page UI.

**Worker:**

- Backfill job: run swing/BOS/FVG detection against historical ClickHouse candles
- Populate `structure_archive` tables
- Build materialized views (FVG effectiveness, BOS follow-through, seasonal bias, etc.)
- Daily archival job (move expired TimescaleDB structure to ClickHouse)

**UI:**

- `/backtesting` page with query builder
- Statistics tables, distribution charts, heatmaps
- Seasonal performance breakdowns
- Saved query configurations (stored in Convex)

**API:**

- `/api/backtesting/query` — proxies structured queries to ClickHouse
- `/api/historical/seasonality/[pair]` — pre-computed seasonal data
- `/api/historical/bos-patterns/[pair]` — BOS follow-through statistics

**Value:** The system becomes a statistical edge discovery engine. "H4 FVGs in Q1 discount have a 74% respect rate" — that's an edge you can trade around, backed by years of data.

### Phase 5: Trade Linkage + Full Integration

**What:** Structure-to-trade linking (Convex `structureLinks` table), trade thesis capture, snapshot integration (structure context frozen at trade moments), full closed-loop analysis.

**Convex:**

- Create `structureLinks` table
- Create `structurePrefs` table
- Wire trade entry/exit to structure entity linking

**UI:**

- Trade detail modal shows linked structure entities
- Snapshot replay includes structure overlay at capture moment
- Trade journal shows structured thesis (which BOS, which FVG, which zone)

**Claude:**

- Can reference specific structure entities when analyzing trades
- Can compute "your trades with BOS+FVG+COT alignment: 72% win rate"
- Can suggest trade thesis improvements based on historical patterns

**Value:** The full vision. Every trade has a structured thesis. Every thesis can be backtested. Every pattern that works (or doesn't) is discoverable. The system learns what conditions produce YOUR edge.

---

## ADR Summary

### ADR-001: Body Close for BOS Confirmation

**Decision**: Only body close beyond a level counts as BOS. Wicks are classified as sweeps.
**Reasoning**: Wicks through levels are common (liquidity grabs). Body closes are definitive. This prevents false signals and aligns with institutional market behavior.

### ADR-002: Timeframe-Scaled Lookback

**Decision**: Vary swing detection lookback by timeframe (M15=7, H1=5, H4=5, D=3, W=3, M=2).
**Reasoning**: Lower timeframes have more noise and need wider filters. Higher timeframes are already smooth. Fixed lookback across all TFs would either miss swings on HTF or catch noise on LTF.

### ADR-003: Swing-Relative EQH/EQL Tolerance (ATR as ceiling only)

**Decision**: Use 15% of the swing candle's true range as primary tolerance, capped by 10% of ATR(14). Not pure ATR, not fixed pips.
**Reasoning**: Pure ATR is an average — it smooths out reality. A tolerance based on the actual candle that formed the swing is grounded in what happened at that specific moment. ATR serves only as a safety cap for edge cases (flash crashes, news spikes). Fixed pips don't adapt at all.

### ADR-004: API Route Over Client-Side Computation

**Decision**: Compute structure server-side via API route, not client-side.
**Reasoning**: Structure detection requires multi-timeframe candle data, COT cross-referencing, news proximity checks, and key level computation. This data is only available server-side. Both chart and Claude consume the same API.

### ADR-005: Weighted MTF Scoring (Monthly×4, Weekly×3, Daily×2, H4×1, H1×0.5)

**Decision**: Use weighted composite score normalized to -100 to +100.
**Reasoning**: Higher timeframes are more reliable indicators of true direction. A Monthly bullish trend is far more significant than an H1 bearish swing. The weighting reflects this hierarchy.

### ADR-006: BOS History Tracking

**Decision**: Store full history of BOS events, not just current structure state.
**Reasoning**: Counter-trend analysis requires knowing how structure evolved. Claude needs historical BOS events to identify patterns ("every time there's a bearish BOS at London open on EUR/USD, it reverses by NY"). Also enables backtesting structure-based strategies.

### ADR-007: Sweep Detection as First-Class Concept

**Decision**: Track sweeps as distinct events, not just "failed BOS."
**Reasoning**: Sweeps are often the highest-probability entry signals. A sweep of EQL followed by a bullish BOS is a textbook institutional entry pattern. The system must distinguish sweeps from breaks to enable this analysis.

### ADR-008: ClickHouse for Historical Pattern Discovery

**Decision**: Use ClickHouse (cold storage) for long-term pattern mining — seasonality, BOS pattern history, key level reaction rates, regime detection. TimescaleDB for real-time structure only.
**Reasoning**: Real-time structure detection needs the last 30 days of candle data (TimescaleDB). But statistical insights (Q1 bearish 7/10 years, Monthly BOS follow-through rates) require years of data that only ClickHouse holds. Same algorithm runs against both — real-time via API, historical via worker backfill into ClickHouse.

### ADR-009: BOS Invalidation via Status, Not Deletion

**Decision**: BOS events are immutable records. When price reclaims a BOS level, the event's status changes from `active` to `reclaimed` with metadata (reclaimedAt, timeTilReclaim). The event is never deleted.
**Reasoning**: A reclaimed BOS is historical truth — it happened, and trades may have been taken based on it. The reclaim itself is a tradeable signal (failed breakdown = bullish). ClickHouse needs the full lifecycle to track reclaim rates per pair/timeframe. Deletion would break trade-to-structure linkage and prevent pattern analysis.

### ADR-010: isCounterTrend Flag Instead of CHoCH

**Decision**: Flag BOS events as `isCounterTrend: true/false` based on whether they go against the current HTF trend (derived from MTF score). Do not implement CHoCH (Change of Character) as a separate event type.
**Reasoning**: CHoCH is just "the first BOS against the trend" — it uses the same detection rules, the same enrichment pipeline. Making it a separate event type doubles the data model for no analytical benefit. A flag on the existing BOS event provides the same information with one detection algorithm, one data model, one rendering path.

### ADR-011: Displacement-Relative FVG Filtering (Not ATR)

**Decision**: Filter FVG minimum width using `gapSize >= displacementBody × 0.10` where displacementBody is the body size of the middle candle. Do not use ATR for FVG filtering.
**Reasoning**: Consistent with ADR-003 (swing-relative tolerance for EQH/EQL). ATR is an average that smooths out reality. The displacement candle's body is the actual move that created the gap — filtering relative to it answers "is this gap meaningful relative to the move that created it?" which is the right question.

### ADR-012: FVG Full Lifecycle Storage for Backtesting

**Decision**: Store every FVG with full lifecycle data — creation context, fill tracking (continuous %), retest counts, midline interactions, time-to-fill, inversion events. Never discard filled/inverted FVGs from the database.
**Reasoning**: The entire system's edge comes from backtesting with raw data. Questions like "what % of H4 FVGs get respected in Q1 vs Q4" or "do high-volume FVGs hold better than low-volume ones" require the complete historical record. Every field in FVGEvent exists to enable a specific backtestable query.

### ADR-013: Three-Tier Premium/Discount (Structural + Yearly + Macro)

**Decision**: Compute premium/discount at three tiers: structural (H4/D1/W1 swing ranges), yearly (YH/YL), and macro (multi-year significant highs/lows). Tag every trade, BOS, and FVG with the premium/discount context at all tiers.
**Reasoning**: Standard single-range premium/discount misses the nesting effect. A pair can be in H4 premium but Daily discount — different trade. When 3+ tiers align (deep premium/discount), conviction is highest. Macro ranges (e.g., GBP/USD 2016 high to 2022 low) provide big-picture context that no single timeframe can. Storing all tiers enables ClickHouse to answer "do entries in deep discount outperform entries in shallow discount?" across the full historical data set.

### ADR-014: Worker Pre-Computes HTF, API Computes LTF

**Decision**: The worker pre-computes structure for higher timeframes (D1, W1, MN) on candle close and stores results in TimescaleDB. The API computes lower timeframes (M15, H1, H4) on-demand from TimescaleDB candles, reading pre-computed HTF for MTF scoring and enrichment.
**Reasoning**: HTF structure changes infrequently (once per D1/W1/MN candle close) but requires deep history (200+ D1 candles = ~10 months) that exceeds TimescaleDB's 30-day window. The worker has ClickHouse access for this depth. LTF structure changes every 15 minutes to 4 hours and needs sub-100ms response times for chart rendering — better served by on-demand API computation with short-lived cache. This split avoids recomputing HTF on every request while keeping LTF fresh.

### ADR-015: Structure as Computed Overlays, Not Convex Drawings

**Decision**: Structure elements (swings, BOS lines, FVG zones, key levels, premium/discount shading) are rendered as computed overlays using Lightweight Charts primitives and custom plugins. They are NOT stored as Convex drawings.
**Reasoning**: Structure elements are ephemeral computed data regenerated from candle data on every computation cycle. Storing them as Convex drawings would create millions of records, conflict with the user's actual drawings (trendlines, annotations, trade-linked markups), and require constant sync between computed state and stored state. Overlays are rendered independently, toggled via user preferences (stored in Convex `structurePrefs`), and disappear/reappear based on the computation — no persistence needed.

### ADR-016: Backtesting as Separate Page, Not Chart Interface

**Decision**: Build backtesting as a dedicated `/backtesting` route that queries ClickHouse directly, presenting results as statistical tables, distribution charts, heatmaps, and equity curves. Not integrated into the trading chart page.
**Reasoning**: Backtesting is analytical — you're querying distributions across thousands of events, not looking at a price chart. A query like "FVG respect rate by quarter across all pairs for 5 years" returns a table, not a visual chart overlay. Mixing statistical analysis into the trading chart would clutter both interfaces. The backtesting page reads directly from ClickHouse (bypassing TimescaleDB) for maximum query speed across large historical datasets.

---

## Version History

| Version | Date | Changes |
| ------- | ---- | ------- |
| 1.0 | 2026-02-06 | Initial design document. Swing detection, structure labeling, BOS confirmation rules, sweep vs break distinction, key level grid, MTF scoring, enrichment pipeline, counter-trend framework, rendering spec, architecture decisions. |
| 1.1 | 2026-02-06 | Refined EQH/EQL tolerance: swing-relative with ATR ceiling (not pure ATR). Added Historical Pattern Discovery section (ClickHouse seasonality, BOS pattern mining, key level reaction history, regime detection). Updated ADR-003 and added ADR-008. |
| 1.2 | 2026-02-07 | Expanded key level acronym reference (PDH/PDL/PWH/PWL/PMH/PML/YH/YL/SH/SL) with full explanations and significance hierarchy. Rewrote Interconnection Philosophy section with StructureEntity model, cross-entity linkage (FVG↔BOS, FVG↔Key Levels, Structure↔Trades, Structure↔Snapshots, Structure↔Claude, Structure↔ClickHouse), trade thesis linking, and full interconnection web diagram. |
| 1.3 | 2026-02-07 | Added BOS invalidation/reclaim with status lifecycle (active→reclaimed) and time-to-reclaim analysis. Added `isCounterTrend` flag and displacement detection on BOS events. Added full Fair Value Gap (FVG) section: detection, displacement-relative filtering (not ATR), 50% midline, lifecycle (FRESH→PARTIAL→FILLED→INVERTED), continuous fill tracking, volume grading, inversion, multi-TF nesting, and backtestable query examples with seasonal cross-referencing. Added three-tier Premium/Discount zones: structural (H4/D1/W1), yearly (YH/YL), macro (multi-year ranges), with nested refinement pattern and full backtestable data model. Added ADRs 009-013. |
| 1.4 | 2026-02-07 | Added Endgame Architecture section: full database storage design (TimescaleDB hot tables, ClickHouse archive + materialized views, Convex linkage-only), computation flow (worker pre-computes HTF on candle close, API computes LTF on-demand), data flow diagram, chart rendering as computed overlays (not Convex drawings), Claude data tools (get_structure, get_active_fvgs, get_bos_history, get_mtf_score, get_premium_discount, get_key_levels), and backtesting as separate `/backtesting` page querying ClickHouse directly. Added Implementation Phases section (5 phases from foundation through full integration). Added ADRs 014-016. |

---

## Notes

- This document captures the design discussion phase. No code has been written yet.
- Implementation will follow the architecture laid out here, starting with swing detection → structure labeling → BOS detection → key levels → MTF scoring → enrichment → rendering.
- The structure engine should be the foundation that everything else builds on — position sizing, entry timing, risk management, and Claude's analysis all depend on accurate structure detection.
- Priority: **accuracy over speed**. A wrong BOS signal is worse than a late one.
