# FVGs, Key Levels & Premium/Discount Zones

> Market structure components that identify *where* price is likely to react.
> FVGs show imbalance, key levels show consensus, and premium/discount zones
> show whether price is cheap or expensive relative to the dealing range.

---

## 1. Fair Value Gaps (FVGs)

### What Is an FVG?

A Fair Value Gap is the price range where one-sided order flow left an imbalance
-- the gap between candle wicks in a 3-candle pattern. Price returns to these
zones because unfilled institutional orders remain there and opportunity-seeking
flow gravitates toward the inefficiency.

### Detection

```
Bullish FVG: candle[0].low > candle[2].high AND candle[1].close > candle[2].high
  -> Gap between candle[2].high (bottom) and candle[0].low (top)

Bearish FVG: candle[0].high < candle[2].low AND candle[1].close < candle[2].low
  -> Gap between candle[0].high (bottom) and candle[2].low (top)
```

- `candle[1]` is the displacement candle (the large-bodied move that created the gap)
- `candle[0]` is the newest candle, `candle[2]` is the oldest

### Minimum Width Filter (Displacement-Relative, NOT ATR)

```
gapSize >= displacementBody * 0.10
```

Where `displacementBody = abs(candle[1].close - candle[1].open)`.

This is self-referencing: "is this gap meaningful relative to the move that created it?"
No external indicator dependency (ATR), no lookback period tuning.

Examples:
- 80-pip move + 12-pip gap = 15% -- **passes**
- 80-pip move + 3-pip gap = 3.75% -- **fails**
- 20-pip move + 3-pip gap = 15% -- **passes** (small move, but gap is proportional)

### The 50% Midline

```
midline = (topPrice + bottomPrice) / 2
```

The midline is where institutional orders cluster most densely. It is the single
most common reaction level within an FVG. Midline respect is tracked explicitly:
price enters the 10%-of-gap zone around the midline, then reverses within 3
candles.

### FVG Lifecycle

```
FRESH --> PARTIAL --> FILLED
FRESH --> PARTIAL --> INVERTED
```

- **Fresh**: No price interaction since creation
- **Partial**: Fill percent > 0% but below the threshold
- **Filled**: Fill percent >= timeframe-scaled threshold
- **Inverted**: Price closes entirely through the gap, flipping polarity

Fill tracking is continuous (0-100%), not binary. Timeframe-scaled "effectively
filled" thresholds:

| Timeframe | Threshold |
|-----------|-----------|
| M15, M30  | 85%       |
| H1, H4   | 90%       |
| D1+       | 95%       |

Higher timeframes require more complete fills because institutional positioning
at those levels is deeper and more committed.

### Volume Grading (Tiers)

| Tier | Criteria             | Interpretation                  |
|------|----------------------|---------------------------------|
| 1    | relativeVolume >= 1.5 | Institutional, high quality     |
| 2    | relativeVolume >= 1.0 | Standard                        |
| 3    | relativeVolume < 1.0  | Weak, may not hold              |

`relativeVolume = displacement candle volume / 20-period volume SMA`

Tier 1 FVGs are the highest probability reaction zones. Tier 3 gaps are noise
candidates that can be safely deprioritized.

### FVG Inversion

When price breaks entirely through an FVG (close beyond the far edge), the zone
flips polarity:

- Bullish FVG inverts when `close < bottomPrice` -- becomes bearish resistance
- Bearish FVG inverts when `close > topPrice` -- becomes bullish support

Inverted FVGs are never discarded (ADR-012). They retain full lifecycle data for
backtesting and pattern research.

### Multi-TF Nesting

Higher TF FVGs that contain lower TF FVGs create nested confluence -- the
highest probability entries. The system computes two relationships:

- **Contained**: current TF FVG entirely within a higher TF FVG
- **Confluent**: overlapping (but not fully contained), same direction

Example nesting cascade:
```
Weekly FVG   1.0800 - 1.0900
  Daily FVG    1.0830 - 1.0870
    H4 FVG       1.0845 - 1.0860
      H1 FVG       1.0850 - 1.0855   <-- highest precision entry zone
```

### Full FVGEvent Interface

```typescript
interface FVGEvent {
  // --- Core identity ---
  id: string;                       // `${pair}-${timeframe}-${createdAt}`
  pair: string;
  timeframe: string;
  direction: FVGDirection;          // "bullish" | "bearish"
  status: FVGStatus;                // "fresh" | "partial" | "filled" | "inverted"

  // --- The gap ---
  topPrice: number;
  bottomPrice: number;
  midline: number;                  // (top + bottom) / 2
  gapSizePips: number;

  // --- Creation context ---
  createdAt: number;                // unix ms -- displacement candle
  displacementBody: number;
  displacementRange: number;
  gapToBodyRatio: number;
  isDisplacement: boolean;          // body >= 2x median(last 20)
  relativeVolume: number;
  tier: FVGTier;                    // 1 | 2 | 3

  // --- Fill tracking ---
  fillPercent: number;              // 0-100, continuous
  maxFillPercent: number;           // high-water mark
  bodyFilled: boolean;              // body filled >= 50% of gap
  wickTouched: boolean;             // wick entered the gap
  filledAt?: number;                // timestamp when threshold crossed
  barsToFill?: number;              // candles from creation to fill

  // --- Retest tracking ---
  firstTouchAt?: number;
  firstTouchBarsAfter?: number;
  retestCount: number;              // distinct re-entries
  midlineRespected: boolean;        // touch + reversal within 3 bars
  midlineTouchCount: number;

  // --- Outcome tracking ---
  invertedAt?: number;
  barsToInversion?: number;

  // --- Linkage ---
  parentBOS?: string;               // BOS that created the displacement
  containedBy?: string[];           // higher TF FVG IDs containing this one
  confluenceWith?: string[];        // overlapping same-direction HTF FVG IDs
  tradeId?: string;                 // linked trade (if entry was in this FVG)
  candleIndex: number;              // displacement candle index (runtime only)
}
```

### Code References

- Detection + fill + nesting: `lib/structure/fvg.ts` -- `detectFVGs()`, `trackFVGFills()`, `computeFVGNesting()`
- Chart rendering: `src/components/chart/FVGZonesPrimitive.ts`
- Type definitions: `lib/structure/types.ts` (FVGEvent, FVGDirection, FVGStatus, FVGTier)
- Worker: `worker/src/fvg-fill-tracker.ts` (5-minute fill updates)
- DB persistence: `lib/db/structure.ts`
- Migrations: 014 (TimescaleDB FVG), 015 (ClickHouse FVG)

---

## 2. Key Level Grid

### What Are Key Levels?

Key levels are the price points the entire market watches. They act as
support/resistance and give BOS events their significance. A BOS that breaks
through a Previous Month High carries more weight than one breaking a Previous
Day High.

### Levels We Track

| Level   | Abbr | Source                          | Significance |
|---------|------|---------------------------------|:------------:|
| Yearly  | YH/YL | Max/min of current year dailies | 5            |
| Monthly | PMH/PML | Last completed monthly candle   | 4            |
| Weekly  | PWH/PWL | Last completed weekly candle    | 3            |
| Daily   | PDH/PDL | Last completed daily candle     | 2            |
| Session | SH/SL | Current session high/low        | 1            |

### Significance Hierarchy

```
YH/YL (5) > PMH/PML (4) > PWH/PWL (3) > PDH/PDL (2) > SH/SL (1)
```

This hierarchy feeds directly into BOS enrichment scoring. When a BOS event
breaks through a key level, the level's significance score contributes to the
overall BOS significance (0-100 composite in `BOSEnrichment.keyLevelScore`).

### KeyLevelGrid Interface

```typescript
interface KeyLevelGrid {
  pdh: number | null;   // Previous Day High
  pdl: number | null;   // Previous Day Low
  pwh: number | null;   // Previous Week High
  pwl: number | null;   // Previous Week Low
  pmh: number | null;   // Previous Month High
  pml: number | null;   // Previous Month Low
  yh: number | null;    // Year High
  yl: number | null;    // Year Low
}

interface KeyLevelEntry {
  label: string;        // "PDH", "PDL", etc.
  price: number;
  significance: number; // 1-5
}
```

### Computation

Key levels are computed from historical candle data at daily, weekly, and monthly
granularity. The "previous" levels always come from the **last completed** candle
(not the current in-progress one). Yearly levels scan all daily candles in the
current calendar year for the max high and min low.

`keyLevelGridToEntries()` flattens the grid into a sorted array of
`KeyLevelEntry` objects, filtering out null values, for use in BOS enrichment
and sweep detection.

### Code References

- Computation: `lib/structure/key-levels.ts` -- `computeKeyLevels()`, `keyLevelGridToEntries()`
- Type definitions: `lib/structure/types.ts` (KeyLevelGrid, KeyLevelEntry)

---

## 3. Premium / Discount Zones

### Concept

Every dealing range has an equilibrium (50% of swing high to swing low). Price
above equilibrium is in premium territory (expensive, favor shorts); price below
is in discount (cheap, favor longs).

```
  Swing High -------.
                     |  PREMIUM (above 50%)
  Equilibrium -------.   <- (high + low) / 2
                     |  DISCOUNT (below 50%)
  Swing Low  -------.
```

Depth measures how far into the zone price has traveled:
- 0% = at equilibrium
- 100% = at the swing extreme

Deep premium/discount (depth > 75% on 2+ tiers) signals highest conviction for
reversals.

### Three Tiers

1. **Structural (H4, D1, W1)** -- most recent swing high/low per higher
   timeframe. These shift frequently and represent the active dealing range.

2. **Yearly** -- current year YH/YL from the key level grid. Stable reference
   for medium-term positioning.

3. **Macro** -- multi-year significant highs/lows sourced from ClickHouse.
   Rarely changes. Example: GBP/USD 2016 high to 2022 low defines the macro
   range.

### Nested Refinement

When 3+ tiers agree on the same zone = deep premium/discount = highest
conviction.

When tiers disagree = mixed signal. Example: H4 says discount, but W1 and macro
say premium. In this case, the shorter timeframe may be pulling back within a
larger premium environment -- wait for alignment or trade with the higher
timeframe.

The `alignmentCount` field captures how many of the 5 zone readings (H4, D1, W1,
yearly, macro) agree. `isDeepPremium` and `isDeepDiscount` require depth > 75%
on at least 2 tiers.

### PremiumDiscountContext Interface

```typescript
interface PremiumDiscountContext {
  // --- Per-TF structural zones ---
  h4Zone: ZoneType;                              // "premium" | "discount"
  h4Equilibrium: number;
  h4SwingRange: { high: number; low: number };
  h4DepthPercent: number;                        // 0-100

  d1Zone: ZoneType;
  d1Equilibrium: number;
  d1SwingRange: { high: number; low: number };
  d1DepthPercent: number;

  w1Zone: ZoneType;
  w1Equilibrium: number;
  w1SwingRange: { high: number; low: number };
  w1DepthPercent: number;

  // --- Yearly ---
  yearlyZone: ZoneType;
  yearlyEquilibrium: number;
  yearlyRange: { high: number; low: number };

  // --- Macro ---
  macroZone: ZoneType;
  macroEquilibrium: number;
  macroRange: { high: number; low: number };

  // --- Composite ---
  alignmentCount: number;                        // 1-5 (how many tiers agree)
  isDeepPremium: boolean;                        // depth > 75% on 2+ tiers
  isDeepDiscount: boolean;                       // depth > 75% on 2+ tiers
}
```

### Code References

- Computation: `lib/structure/premium-discount.ts` -- `computePremiumDiscount()`
- Chart rendering: `src/components/chart/PremiumDiscountPrimitive.ts`
- Type definitions: `lib/structure/types.ts` (PremiumDiscountContext, ZoneType)
- Worker: `worker/src/htf-structure-precompute.ts` (D/W/M structure every 4h)
- Worker: `worker/src/macro-range-updater.ts` (24h macro range refresh)
- Migrations: 015 (ClickHouse macro ranges)

---

## Architecture Decision Records

### ADR-011: Displacement-Relative FVG Filtering (Not ATR)

**Decision**: Use `gapSize >= displacementBody * 0.10` instead of ATR-based
minimum width.

**Rationale**: ATR introduces a lookback dependency and cross-pair calibration
issues. The displacement-relative approach is self-contained -- it asks whether
the gap is meaningful relative to the move that created it. This is consistent
with the swing-relative approach used throughout the structure engine (e.g.,
displacement detection uses median body, not ATR).

**Consequence**: No ATR calculation needed anywhere in the FVG module. Filter
adapts automatically to volatility regime changes because it references the
creating candle directly.

### ADR-012: FVG Full Lifecycle Storage for Backtesting

**Decision**: Never discard filled or inverted FVGs. Store complete lifecycle
data including fill timestamps, bars-to-fill, inversion timestamps, retest
counts, and midline behavior.

**Rationale**: Backtesting and pattern research require the full history.
Discarding terminal FVGs would make it impossible to answer questions like "what
percentage of Tier 1 FVGs on H4 get filled within 20 bars?" or "do midline-
respected FVGs produce better trade outcomes?"

**Consequence**: Storage grows linearly with time. Mitigated by the hot/cold
split -- TimescaleDB holds 30 days, ClickHouse holds everything. Old FVGs in
terminal states are rarely queried in real-time.

### ADR-013: Three-Tier Premium/Discount (Structural + Yearly + Macro)

**Decision**: Compute premium/discount across three distinct tiers rather than a
single dealing range.

**Rationale**: A single range misses context. Price can be in discount on H4
(short-term pullback) while in deep premium on the weekly and macro ranges. The
three-tier approach surfaces these conflicts explicitly via `alignmentCount` and
the `isDeepPremium`/`isDeepDiscount` flags, letting the trading logic make
informed decisions rather than receiving a single potentially misleading signal.

**Consequence**: Requires swing data from three timeframes plus key levels plus
macro range from ClickHouse. The orchestrator already computes multi-TF swings,
so the marginal cost is one additional function call per pair per computation
cycle.
