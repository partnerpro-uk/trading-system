# Market Structure Engine: Core ICT Concepts

> Reference implementation in `lib/structure/`. Every concept here maps to a source file.
> This document covers the detection pipeline: Swings -> Zigzag -> Labels -> BOS/MSS -> Sweeps.

---

## 1. Swing Point Detection

**File:** `lib/structure/swings.ts` -- `detectSwings(candles, timeframe)`

A swing high is a candle whose high exceeds the high of N candles on both sides.
A swing low is a candle whose low is below the low of N candles on both sides.
N is the lookback parameter, scaled by timeframe.

### Timeframe-Scaled Lookback

| Timeframe | Lookback (N) | Rationale |
|-----------|-------------|-----------|
| M15       | 5           | Tighter detection, less noise. Changed from 7 to match Crystal Ball PineScript reference. |
| M30       | 7           | Slightly wider to reduce chop on 30-min noise. |
| H1        | 5           | Standard. Hourly swings are already meaningful. |
| H4        | 5           | Standard. 4H is the workhorse timeframe. |
| D         | 3           | Daily candles are high-signal. Fewer needed. |
| W         | 3           | Weekly swings are major structure. |
| M         | 2           | Monthly swings are macro pivots. Minimal lookback. |

### Required Candle Depth

Each timeframe needs enough history to produce meaningful swings:

| Timeframe | Candles | Approx. Coverage |
|-----------|---------|-----------------|
| M15       | 500     | ~5 trading days  |
| H1        | 500     | ~3 weeks         |
| H4        | 300     | ~2 months        |
| D         | 200     | ~10 months       |
| W         | 104     | ~2 years         |
| M         | 60      | ~5 years         |

### Why Accuracy Matters

Swing detection is the foundation of the entire pipeline. A false swing produces a wrong label (HH/HL/LH/LL), which produces a wrong BOS event, which produces a wrong trade signal. Errors compound downstream. This is why the lookback values were carefully tuned and the zigzag filter (section 2) was added.

---

## 2. Zigzag Filter

**File:** `lib/structure/zigzag.ts` -- `enforceZigzag(swings)`

### Problem

Raw swing detection can produce consecutive same-type swings: two highs in a row, or two lows in a row. This happens when price makes a higher high without a meaningful pullback, or when two adjacent candles both qualify as swing highs. Consecutive same-type swings create noisy, misleading BOS events downstream.

### Algorithm

Iterate through swings sorted by time. If the current swing type matches the previous swing type:
- For consecutive highs: keep the higher one, discard the lower.
- For consecutive lows: keep the lower one, discard the higher.

This enforces a strict alternating high-low-high-low sequence.

### Example

```
Before zigzag: H(1.10) H(1.12) L(0.98) H(1.15) L(0.95) L(0.93)
After zigzag:  H(1.12)         L(0.98) H(1.15)         L(0.93)
```

- `H(1.10)` discarded because `H(1.12)` is higher (more extreme).
- `L(0.95)` discarded because `L(0.93)` is lower (more extreme).

### Usage

All call sites use the convenience wrapper, never raw `detectSwings`:

```typescript
// lib/structure/zigzag.ts
function detectFilteredSwings(candles: Candle[], tf: Timeframe): SwingPoint[] {
  return enforceZigzag(detectSwings(candles, tf));
}
```

This is always applied. There is no code path that consumes unfiltered swings.

### Why Not Filter During Detection?

Keeping detection and filtering as separate steps makes each independently testable and debuggable. You can inspect raw swings to verify the detector, then inspect filtered swings to verify the zigzag logic.

---

## 3. Structure Labeling

**File:** `lib/structure/labeling.ts` -- `labelSwings(swings, candles)`

Each swing point gets a structural label based on its relationship to the previous swing of the same type.

### Label Definitions

| Label | Condition | Meaning |
|-------|-----------|---------|
| HH (Higher High) | Current high > previous high | Bullish continuation |
| HL (Higher Low)   | Current low > previous low   | Bullish continuation |
| LH (Lower High)   | Current high < previous high | Bearish continuation |
| LL (Lower Low)     | Current low < previous low   | Bearish continuation |
| EQH (Equal High)  | Current high within tolerance of previous high | Liquidity pool forming at highs |
| EQL (Equal Low)    | Current low within tolerance of previous low   | Liquidity pool forming at lows |

### EQH/EQL Tolerance

The tolerance for "equal" is swing-relative with an ATR ceiling:

```typescript
const tolerance = Math.min(swingRange * 0.15, atr14 * 0.10);
```

**Why not pure ATR?** ATR varies wildly across pairs and market conditions. A fixed ATR percentage would be too loose on volatile pairs and too tight on calm ones. Swing range (distance between the two swings being compared) gives a proportional baseline. ATR serves only as a ceiling to prevent absurdly wide tolerances during trending moves where swing range is large.

**Why not fixed pips?** Fixed pip thresholds don't scale across instruments. 5 pips on EURUSD is meaningless on GBPJPY.

### Trend State Machine

The sequence of labels determines the current trend:

- **BULLISH:** HH -> HL -> HH -> HL (higher highs and higher lows)
- **BEARISH:** LH -> LL -> LH -> LL (lower highs and lower lows)
- **RANGING:** Mixed labels, no clear sequence

The trend state persists until broken by a BOS/MSS event.

---

## 4. Break of Structure (BOS) & Market Structure Shift (MSS)

**File:** `lib/structure/bos.ts` -- `detectBOS(candles, swings, pair)`

### Definition

A BOS occurs when a candle's **body** closes beyond a prior swing point.

**CRITICAL RULE: Only body close counts.** A wick through a level is a sweep (section 5), not a break. This single distinction prevents the majority of false signals from stop hunts and liquidity grabs.

### BOS vs MSS Classification

| Type | Condition | Meaning |
|------|-----------|---------|
| `bos` | Same direction as previous break (or first break ever) | Continuation of current structure |
| `mss` | Opposite direction to previous break | Reversal -- structure has shifted |

Classification uses `prevBreakDirection` tracking:

```typescript
type BOSType = "bos" | "mss";

// If no previous break or same direction -> "bos"
// If opposite direction -> "mss"
// First BOS ever defaults to "bos"
```

This replaces the need for a separate "CHoCH" (Change of Character) concept. An MSS is a CHoCH. One type system, not two.

### Displacement Detection

A BOS candle with displacement is a stronger signal:

```typescript
const bodySize = Math.abs(candle.close - candle.open);
const medianBody = median(last20Bodies); // last 20 candle bodies
const isDisplacement = bodySize >= 2 * medianBody;
```

**Why median, not ATR?** ATR includes wicks, which get skewed by outlier candles (news spikes, flash crashes). The median of body sizes is the honest baseline for "normal" candle effort. A body 2x the median represents genuine institutional commitment, not just a wick spike.

### Rendering

BOS lines are drawn as dashed horizontal lines from the broken swing to the confirming candle (not extended to the right edge). Color: green for bullish, red for bearish. The label ("BOS" or "MSS") is centered on the line.

### BOS Reclaim / Invalidation

A BOS can be reclaimed when price closes its body back beyond the broken level. The BOS status changes from `"active"` to `"reclaimed"` with metadata:

```typescript
interface BOSReclaim {
  reclaimedAt: number;        // timestamp
  reclaimedByClose: number;   // the reclaiming candle's close
  timeTilReclaim: number;     // milliseconds from BOS to reclaim
}
```

**BOS events are never deleted.** They are historical truth. A reclaimed BOS still happened; its reclaim is additional information layered on top.

#### Reclaim Speed Interpretation

| Speed | Timeframe | Interpretation | Signal Strength |
|-------|-----------|---------------|----------------|
| Same session | < 8 hours | Trap / liquidity grab | Strong counter-signal |
| Next day | 8-24 hours | Failed breakdown | Moderate counter-signal |
| Multi-day | > 24 hours | Structure evolved naturally | Weak / contextual |

A fast reclaim (same session) is itself a tradeable signal. It indicates the initial break was a liquidity sweep disguised as a structural break.

### Counter-Trend Flag

Each BOS event carries an independent `isCounterTrend: boolean` flag:

```typescript
interface BOSEvent {
  type: "bos" | "mss";
  direction: "bullish" | "bearish";
  isCounterTrend: boolean;
  // ... other fields
}
```

**`isCounterTrend`** = this BOS goes against the current higher-timeframe direction (derived from MTF score).

**`type: "mss"`** = this BOS reverses the same-timeframe structure (derived from `prevBreakDirection`).

These are orthogonal. A BOS can be:
- `bos` + `isCounterTrend: false` -- continuation aligned with HTF (high confidence)
- `bos` + `isCounterTrend: true` -- continuation on this TF, but against HTF (caution)
- `mss` + `isCounterTrend: false` -- reversal on this TF, but now aligning with HTF (high confidence)
- `mss` + `isCounterTrend: true` -- reversal against HTF (low confidence, likely trap)

---

## 5. Sweeps vs Breaks

**File:** `lib/structure/sweeps.ts` -- `detectSweeps(candles, swings, bosEvents, pair)`

### The Critical Distinction

| Event | Candle Action | Meaning |
|-------|--------------|---------|
| Sweep | Wick through level, body closes back | Liquidity grab. Often signals the opposite direction. |
| Break (BOS) | Body closes beyond level | Confirmed structural change. Trade with it. |

This is the single most important distinction in ICT methodology. Without it, every stop hunt looks like a breakout.

### Why Sweeps Happen

Institutional orders cluster at swing highs and lows (stop losses). Price wicks through these levels to fill institutional orders, then reverses. The wick is the grab; the body close back is the tell.

### EQH/EQL as Sweep Targets

Equal highs and equal lows are prime sweep targets because they represent concentrated liquidity. Two (or more) swing points at the same price means double the stop losses sitting just beyond that level.

### Sweep Detection Logic

A sweep is detected when:
1. A candle's wick exceeds a swing point (high above swing high, or low below swing low)
2. The candle's body closes back on the original side of the swing
3. The swing has not already been broken by a BOS event

---

## Pipeline Summary

```
Candles
  |
  v
detectSwings(candles, tf)          -- raw swing points
  |
  v
enforceZigzag(swings)             -- alternating H-L-H-L sequence
  |
  v
labelSwings(filteredSwings)        -- HH/HL/LH/LL/EQH/EQL
  |
  v
detectBOS(candles, swings, pair)   -- BOS/MSS events with displacement
  |
  v
detectSweeps(candles, swings, bos) -- liquidity grabs
  |
  v
computeStructure()                 -- orchestrator (lib/structure/index.ts)
```

Each step depends only on the output of previous steps. No circular dependencies. Each step is independently testable.

---

## Architectural Decision Records

### ADR-001: Body Close for BOS Confirmation

**Decision:** Only candle body close beyond a swing level confirms a BOS. Wicks are classified as sweeps.

**Context:** Wicks through structure levels are extremely common in forex, especially during high-impact news events and London/NY session opens. Treating wicks as breaks produces a flood of false BOS events that immediately get "reclaimed."

**Consequence:** Fewer BOS events, but each one is higher conviction. Sweeps become a separate, tradeable signal category.

---

### ADR-002: Timeframe-Scaled Lookback

**Decision:** Lookback N varies by timeframe: M15=5, M30=7, H1=5, H4=5, D=3, W=3, M=2.

**Context:** A fixed lookback across all timeframes either over-filters lower timeframes (missing valid swings) or under-filters higher timeframes (detecting noise as swings). Higher timeframes have higher-signal candles that need less confirmation.

**Consequence:** M15 changed from 7 to 5 after backtesting against Crystal Ball PineScript reference showed tighter detection produced better alignment with institutional swing points.

---

### ADR-003: Swing-Relative EQH/EQL Tolerance

**Decision:** Tolerance = `min(swingRange * 0.15, ATR(14) * 0.10)`. Swing-relative with ATR ceiling.

**Context:** Pure ATR tolerance was too loose during volatile periods and inconsistent across pairs. Fixed pip tolerance doesn't scale across instruments. Swing range provides a proportional, instrument-agnostic baseline.

**Consequence:** EQH/EQL detection is consistent regardless of pair volatility or current ATR regime.

---

### ADR-010: isCounterTrend Flag Instead of CHoCH

**Decision:** Add `isCounterTrend: boolean` to BOSEvent instead of creating a separate CHoCH event type.

**Context:** CHoCH (Change of Character) in ICT literature overlaps with MSS but adds confusion about whether it's a same-TF or cross-TF concept. By separating same-TF reversal (MSS) from HTF alignment (isCounterTrend), each concept is precise and independently queryable.

**Consequence:** No CHoCH type exists in the codebase. MSS handles same-TF reversals. isCounterTrend handles HTF alignment. Both flags coexist on every BOS event.

---

### ADR-017: Zigzag Filter

**Decision:** Apply `enforceZigzag()` to all swing detection output, enforcing strict alternating high-low-high-low sequence.

**Context:** Raw swing detection occasionally produces consecutive same-type swings (two highs or two lows in a row) when price makes extended moves without meaningful pullbacks. These consecutive swings create duplicate or contradictory BOS events downstream, degrading signal quality.

**Algorithm:** When two consecutive swings share a type, keep the more extreme one (higher high or lower low) and discard the other. This preserves the most structurally significant point.

**Consequence:** All call sites use `detectFilteredSwings()`, never raw `detectSwings()`. The zigzag step is mandatory, not optional. BOS detection receives clean alternating input, eliminating an entire class of false signals.

---

### ADR-018: BOS vs MSS Classification via prevBreakDirection

**Decision:** Classify BOS events as `"bos"` (continuation) or `"mss"` (reversal) by tracking `prevBreakDirection`. Same direction = BOS. Opposite direction = MSS. First BOS defaults to `"bos"`.

**Context:** The original design had a single `"bos"` type with no reversal distinction. Identifying market structure shifts required comparing consecutive BOS events after the fact. A separate CHoCH event type was considered but rejected (see ADR-010) because CHoCH conflates same-TF and cross-TF concepts.

**Algorithm:** Maintain `prevBreakDirection` state across the BOS detection loop. Each new break compares its direction to `prevBreakDirection`. If null or matching, type is `"bos"`. If opposite, type is `"mss"`. Then update `prevBreakDirection`.

**Consequence:** Every BOS event is self-describing. Consumers don't need to compare consecutive events to detect reversals. The MSS label is immediately available for chart rendering, alerting, and trade logic.
