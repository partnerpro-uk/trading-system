# Market Structure Detection — Architecture & Concept Document

> Last Updated: 2026-02-06 (v1.1)
> Status: Design Phase — Pre-Implementation

---

## Table of Contents

1. [Intent & Philosophy](#intent--philosophy)
2. [Core Concepts](#core-concepts)
3. [Swing Point Detection](#swing-point-detection)
4. [Structure Labeling](#structure-labeling)
5. [Break of Structure (BOS)](#break-of-structure-bos)
6. [Sweeps vs Breaks — The Critical Distinction](#sweeps-vs-breaks--the-critical-distinction)
7. [Key Level Grid](#key-level-grid)
8. [Multi-Timeframe Direction Scoring](#multi-timeframe-direction-scoring)
9. [Enriched BOS Events](#enriched-bos-events)
10. [Counter-Trend Framework](#counter-trend-framework)
11. [Rendering & Visualization](#rendering--visualization)
12. [Architecture & Computation](#architecture--computation)
13. [Interconnection Philosophy](#interconnection-philosophy)
14. [Historical Pattern Discovery — ClickHouse](#historical-pattern-discovery--clickhouse)
15. [ADR Summary](#adr-summary)

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

  // The break
  brokenLevel: number;         // The swing price that was broken
  brokenSwingTimestamp: number; // When that swing formed
  confirmingClose: number;     // The close price that confirmed the break
  magnitudePips: number;       // How far beyond the level price closed

  // Significance (enriched — see Enriched BOS Events section)
  significance: number;        // 0-100 composite score
  keyLevelsBroken: string[];   // ["PDL", "Weekly Low"] etc.
  cotAlignment: boolean;       // Does COT positioning agree?
  mtfScore: number;            // Multi-timeframe direction score at time of break
  nearbyNews: string[];        // News events within ±2 hours
}
```

### History Tracking

We don't just track the latest structure — we maintain a **history of all BOS events**. This is critical for:

1. **Counter-trend analysis**: "Price broke structure bearish at 14:30, but the previous 3 BOS events were all bullish — this might be a pullback, not a reversal"
2. **Pattern recognition**: "Every time there's a bearish BOS during London session on this pair, it reverses within 4 hours"
3. **Claude analysis**: Claude can reference specific BOS events by timestamp and reason about structural evolution over time

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

## Key Level Grid

### What Are Key Levels?

Key levels are price points that the entire market watches. They act as support/resistance and give BOS events their significance. A BOS that also breaks a key level is far more meaningful than one breaking an arbitrary swing.

### The Levels We Track

| Level | Abbreviation | Source | Significance |
|-------|-------------|--------|-------------|
| Previous Day High | PDH | Daily candle data | Intraday S/R, session targets |
| Previous Day Low | PDL | Daily candle data | Intraday S/R, session targets |
| Previous Week High | PWH | Weekly candle data | Swing trade reference |
| Previous Week Low | PWL | Weekly candle data | Swing trade reference |
| Previous Month High | PMH | Monthly candle data | Major structural level |
| Previous Month Low | PML | Monthly candle data | Major structural level |
| Yearly High | YH | Yearly candle data | Macro-level cap |
| Yearly Low | YL | Yearly candle data | Macro-level floor |
| Session High | SH | Current session (Syd/Tky/Ldn/NYC) | Intraday micro-structure |
| Session Low | SL | Current session | Intraday micro-structure |

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

## Interconnection Philosophy

### Everything Connects to Everything

This is the core design principle. Here's how each data source connects:

```
Market Structure ←→ COT Positioning
  "Bearish BOS on Daily + Lev Money net short = high conviction"
  "Bullish BOS but COT flipping bearish = caution, possible trap"

Market Structure ←→ News Events
  "BOS 30 minutes before NFP = likely noise/positioning"
  "BOS 5 minutes after NFP = news-driven, likely sustained"

Market Structure ←→ Key Levels
  "BOS that breaks PDL = intraday significance"
  "BOS that breaks PWL = swing significance"
  "BOS that breaks PML = macro significance"

Market Structure ←→ Session Context
  "London session BOS = high conviction (peak liquidity)"
  "Sydney session BOS = lower conviction (thin markets)"

Market Structure ←→ Trade Journal (Plan vs Reality)
  "Last 5 trades entered after bullish BOS: 4/5 winners"
  "Trades entered during Sydney BOS: 1/4 winners — avoid"

Market Structure ←→ Claude Analysis
  "4H broke below Daily Low. COT bearish. NFP in 2 hours.
   MTF score -62. Significance: 82/100. This is a high-conviction
   bearish setup — but be aware of news volatility."
```

### No Isolated Data

Every module we build must expose its data in a way that other modules can consume:
- Structure engine outputs BOS events with timestamps → Claude can reference them
- Key levels are available to the structure engine → BOS significance scoring
- COT data is available server-side → BOS enrichment
- Session detection already exists → BOS session context
- Trade journal tracks close reasons → Pattern analysis by structure type

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

---

## Version History

| Version | Date | Changes |
| ------- | ---- | ------- |
| 1.0 | 2026-02-06 | Initial design document. Swing detection, structure labeling, BOS confirmation rules, sweep vs break distinction, key level grid, MTF scoring, enrichment pipeline, counter-trend framework, rendering spec, architecture decisions. |
| 1.1 | 2026-02-06 | Refined EQH/EQL tolerance: swing-relative with ATR ceiling (not pure ATR). Added Historical Pattern Discovery section (ClickHouse seasonality, BOS pattern mining, key level reaction history, regime detection). Updated ADR-003 and added ADR-008. |

---

## Notes

- This document captures the design discussion phase. No code has been written yet.
- Implementation will follow the architecture laid out here, starting with swing detection → structure labeling → BOS detection → key levels → MTF scoring → enrichment → rendering.
- The structure engine should be the foundation that everything else builds on — position sizing, entry timing, risk management, and Claude's analysis all depend on accurate structure detection.
- Priority: **accuracy over speed**. A wrong BOS signal is worse than a late one.
