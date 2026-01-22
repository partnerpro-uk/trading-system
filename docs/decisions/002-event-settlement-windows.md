# ADR 002: Event Settlement Windows

**Date**: January 2026
**Status**: Accepted
**Deciders**: Project team

## Context

News events cause price reactions that unfold over different time horizons. High-impact events like FOMC decisions can move markets for hours, while routine data releases settle quickly. We needed a system to:

1. Capture the full price reaction for each event type
2. Calculate meaningful statistics (spike, reversal, settlement)
3. Store data efficiently without excessive overhead

## Decision Drivers

- **Event impact varies**: NFP moves markets for 60+ minutes; PMI settles in 15 minutes
- **Storage efficiency**: Longer windows = more candles = more storage
- **Statistical accuracy**: Need enough data to measure reversals and final direction
- **T-15 baseline**: Price 15 minutes before event provides stable reference point

## Considered Options

### Option 1: Fixed 30-minute window for all events

**Pros:**
- Simple implementation
- Consistent data structure

**Cons:**
- Misses extended reactions on major events
- Wastes storage on low-impact events

### Option 2: Variable windows based on impact level (Chosen)

**Pros:**
- Captures full reaction for each event type
- Efficient storage allocation
- Better statistical accuracy

**Cons:**
- More complex implementation
- Different array lengths in storage

### Option 3: Always capture 2 hours

**Pros:**
- Never miss any reaction

**Cons:**
- Massive storage overhead
- Most data would be noise

## Decision

We chose **variable windows based on impact level**:

| Window Type | Duration | Time Range | Events |
|-------------|----------|------------|--------|
| Standard | 30 min | T-15 to T+15 | Low/medium impact |
| High Impact | 75 min | T-15 to T+60 | High impact events |
| Extended | 105 min | T-15 to T+90 | FOMC, ECB, major central bank |

### T-15 Baseline

All pip calculations use price at T-15 (15 minutes before event) as baseline because:
- Markets often position before scheduled releases
- T-15 captures pre-event price before final positioning
- Provides stable reference unaffected by event volatility

### Settlement Points

| Point | Index | Purpose |
|-------|-------|---------|
| T-15 | 1 | Baseline for all calculations |
| T-5 | 11 | Pre-event positioning |
| T+0 | 16 | Event release time |
| T+5 | 21 | Initial spike measurement |
| T+15 | 31 | Standard settlement |
| T+30 | 46 | Extended settlement |
| T+60 | 76 | High impact settlement |
| T+90 | 106 | FOMC/ECB settlement |

## Consequences

**Positive:**
- Accurate statistics for each event type
- Efficient storage (30-105 candles vs 120 for all)
- Can measure reversals at appropriate timeframes

**Negative:**
- Array indices vary by window type
- Must handle null values for shorter windows

**Implementation:**
- `event_candle_windows` table stores M1 candles as arrays
- `extract-price-reactions.ts` extracts prices at each settlement point
- Null values for T+60/T+90 on standard events

## Example: NFP vs PMI

**NFP (High Impact - 75 min window):**
```
T-15: 1.0850 (baseline)
T+0:  1.0855 (event release)
T+5:  1.0890 (spike high)
T+15: 1.0870 (partial reversal)
T+60: 1.0885 (final settlement)
Spike: +40 pips, Reversal: partial, Final: +35 pips
```

**PMI (Standard - 30 min window):**
```
T-15: 1.0850 (baseline)
T+0:  1.0852 (event release)
T+5:  1.0860 (spike)
T+15: 1.0858 (settlement)
Spike: +10 pips, Final: +8 pips
```

---

*Recorded: January 2026*
