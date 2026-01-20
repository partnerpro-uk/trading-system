# News Event Impact System

## Vision Document

---

## The Core Idea

Build a comprehensive news event database that goes beyond simple calendar data. Track not just *what* happened (actual vs forecast), but *how the market reacted* — the spike, the reversal, the settlement pattern — across every high-impact event historically.

This isn't about predicting news outcomes. It's about understanding **how markets behave around news** so that when you're in a trade or considering one, you have full context:

> "FOMC in 2 hours. Historically, EUR/USD spikes 38 pips on average, reverses 64% of the time within 30 minutes. Your current position is 25 pips in profit — consider taking partials before the event."

This system works alongside technical analysis, not instead of it. News context is one layer of the full picture.

---

## Why This Matters

### The Problem with Current News Tools

**Standard economic calendars** give you:
- Event name, time, impact level
- Actual, forecast, previous values
- Maybe a brief description

**What they don't tell you:**
- How did price actually react last time?
- Does this event typically spike then reverse?
- How big are the moves historically?
- Should you hold through this or close before?

### The Opportunity

Build a system where every red-folder news event has:
- Full price reaction profile (spike, reversal, settlement)
- Historical statistics across dozens of occurrences
- Pattern classification (spike-reversal, continuation, fade, etc.)
- Queryable data Claude can reason about

---

## What We're Building

### Layer 1: Event Metadata

Standard calendar data — the foundation.

```
Event: FOMC Rate Decision
Country: US
Currency: USD
Impact: High (red folder)
Timestamp: 2025-01-15 19:00:00 UTC
Actual: 4.50%
Forecast: 4.50%
Previous: 4.75%
Surprise Factor: 0 (met expectations)
```

**Plus contextual understanding:**
- What is FOMC? (Federal Open Market Committee sets US interest rates)
- Why does it matter? (Rate changes affect currency strength, borrowing costs)
- What pairs does it impact? (All USD pairs, but especially EUR/USD, USD/JPY)

### Layer 2: Price Reaction Profiles

For each high-impact event, capture the market's actual response.

```
Event: FOMC Rate Decision (Jan 15, 2025)
Pair: EUR/USD

── Pre-Event ──
Price T-15min:        1.08500
Price T-5min:         1.08520
Price at event:       1.08515

── Immediate Reaction (0-5 min) ──
Spike high:           1.08540  (+2.5 pips)
Spike low:            1.08180  (-33.5 pips)
Spike direction:      DOWN
Spike magnitude:      33.5 pips
Time to spike:        1m 42s

── Settlement Phase ──
Price T+15min:        1.08350
Price T+30min:        1.08480
Price T+1hr:          1.08650
Price T+3hr:          1.08890

── Pattern Classification ──
Pattern type:         "spike_down_full_reversal"
Did reverse:          true
Reversal magnitude:   71 pips (from spike low)
Final direction:      UP (opposite to spike)
```

### Layer 3: 1-Minute Candle Windows

Store granular candle data around each event for precise analysis and replay.

```
Event Window: FOMC Jan 15, 2025
Pair: EUR/USD
Window: T-15min to T+60min (75 one-minute candles)

Candles: [
  { time: "18:45", o: 1.08495, h: 1.08502, l: 1.08490, c: 1.08500 },
  { time: "18:46", o: 1.08500, h: 1.08510, l: 1.08498, c: 1.08505 },
  ...
  { time: "19:00", o: 1.08515, h: 1.08540, l: 1.08180, c: 1.08220 }, // The event candle
  { time: "19:01", o: 1.08220, h: 1.08280, l: 1.08200, c: 1.08265 },
  ...
]
```

**Why store separately from main candles:**
- Main candle storage is 5m/15m/1H/4H/Daily — optimized for charting
- News windows are 1-minute, used for different purposes (event analysis)
- Keeps queries fast — don't need to scan through millions of 1m candles
- Clear separation of concerns: charting data vs event reaction data

### Tiered Candle Window Strategy

Not all events need the same window length. Press conferences have extended Q&A where market-moving comments can come 30-40 minutes in. Data releases are digested within minutes.

#### Window Configuration by Event Type

| Tier | Event Types | Window | Candles | Rationale |
|------|-------------|--------|---------|-----------|
| **Extended (T+90)** | FOMC Press Conference, ECB Press Conference | T-15 to T+90 | 105 | 45-60 min Q&A, Powell/Lagarde can move markets at T+30, T+40 |
| **High (T+60)** | All other high-impact events | T-15 to T+60 | 75 | Captures spike + full reversal window |
| **Medium (T+15)** | Medium-impact events | T-15 to T+15 | 30 | Spike window only, use M5 for settlement |
| **Low (T+15)** | Low-impact events | T-15 to T+15 | 30 | Minimal reaction expected |
| **Non-economic** | Bank holidays, etc. | Skip | 0 | No price reaction to measure |

#### Why FOMC/ECB Get Extended Windows

**FOMC Press Conference:**
- Opening statement: ~10-15 mins (scripted, fewer surprises)
- Q&A session: ~30-45 mins (where the action is)
- Powell has moved markets significantly at T+20, T+35, even T+50
- Only ~8 events/year — negligible storage overhead

**ECB Press Conference:**
- Similar structure to FOMC
- Lagarde Q&A regularly moves EUR/USD 30-50 pips mid-presser
- ~8 events/year

**Why NOT extend other events:**
- **FOMC Minutes**: Text dump, digested in 15-30 mins, no Q&A
- **NFP/CPI/GDP**: Instant data release, reaction in first 5-15 mins
- **RBA/RBNZ/BOC**: Statement-only, no extended presser

#### Storage Calculation

```
Current event counts:
- High:         20,090 events
- Medium:       24,555 events
- Low:          48,342 events
- Non-economic:  2,780 events

Estimated storage (× 7 pairs):
- FOMC/ECB (~160 events):    160 × 7 × 105 = 118K candles
- Other High (~19,930):   19,930 × 7 × 75  = 10.5M candles
- Medium:                 24,555 × 7 × 30  = 5.2M candles
- Low:                    48,342 × 7 × 30  = 10.2M candles
- Non-economic:                            = 0 candles

Total: ~26M candle records
```

Compare to flat T+60 for all: ~49M records (47% reduction with tiered approach)

#### Settlement Prices Beyond T+15

For medium/low events where we only store T-15 to T+15 candles, settlement prices (T+30m, T+1hr, T+3hr) are pulled from the main M5 candle table. The 1-minute granularity is only needed for spike detection — settlement is adequately captured at 5-minute resolution.

### Layer 4: Aggregated Statistics

After collecting 50+ instances of each event type, compute statistics.

```
Event: FOMC Rate Decision
Historical Instances: 67 (2017-2025)
Pair: EUR/USD

── Spike Statistics ──
Average spike:              42.3 pips
Median spike:               38.0 pips
Largest spike:              127 pips (Mar 2020)
Smallest spike:             12 pips (no change, expected)

── Direction Statistics ──
Initial spike UP:           31 (46%)
Initial spike DOWN:         36 (54%)

── Reversal Statistics ──
Reversal within 30min:      43/67 (64%)
Reversal within 1hr:        48/67 (72%)
Final direction matches spike: 26/67 (39%)

── Surprise Factor Correlation ──
When actual = forecast:     Avg spike 28 pips
When actual ≠ forecast:     Avg spike 67 pips
Bigger surprise → bigger spike: r=0.73

── Best Trading Approach (Historical) ──
"Fade the spike after 15-20 min consolidation"
Win rate on reversal trade: 64%
Average R on reversal:      1.8R
```

---

## Data Architecture

### Database Schema

```typescript
// Event metadata (one per event occurrence)
economicEvents: defineTable({
  // Identity
  eventId: v.string(),              // "{name}_{currency}_{YYYY-MM-DD}_{HH:MM}" e.g. "CPI_m_m_USD_2024-01-15_14:30"
  eventType: v.string(),            // "FOMC", "NFP", "CPI" (derived/categorized)
  name: v.string(),                 // "CPI m/m" (original event name from scraper)

  // Location/Currency
  country: v.string(),              // "US" (derived from currency)
  currency: v.string(),             // "USD"

  // Timing
  timestamp: v.number(),            // Unix ms (UTC)
  scrapedAt: v.optional(v.number()), // When data was scraped (for upsert tracking)

  // Status & Session (from scraper)
  status: v.string(),               // "scheduled" | "released"
  dayOfWeek: v.optional(v.string()), // "Mon", "Tue", etc.
  tradingSession: v.optional(v.string()), // "asian" | "london" | "new_york" | "london_ny_overlap" | "off_hours"

  // Impact level
  impact: v.string(),               // "high" | "medium" | "low" | "non_economic"

  // Values (strings for display: "4.50%", "256K")
  actual: v.optional(v.string()),
  forecast: v.optional(v.string()),
  previous: v.optional(v.string()),

  // Parsed numeric values
  actualValue: v.optional(v.number()),
  forecastValue: v.optional(v.number()),
  previousValue: v.optional(v.number()),

  // Pre-computed from scraper (actual - forecast)
  deviation: v.optional(v.number()),
  deviationPct: v.optional(v.number()),
  outcome: v.optional(v.string()),  // "beat" | "miss" | "met" | null (for scheduled)

  // Z-score normalized: (actual - forecast) / historicalStdDev (calculated post-import)
  surpriseZScore: v.optional(v.number()),

  // Event relationships (FOMC decision → press conference)
  relatedEventId: v.optional(v.string()),
  isFollowUp: v.boolean(),          // true = this is a follow-up event

  // Context
  description: v.optional(v.string()),

  // Processing status
  reactionsCalculated: v.boolean(), // Has price reaction been computed?
})
.index("by_timestamp", ["timestamp"])
.index("by_type", ["eventType"])
.index("by_currency", ["currency"])
.index("by_event_id", ["eventId"])
.index("by_related", ["relatedEventId"])
.index("by_type_timestamp", ["eventType", "timestamp"])
.index("by_status", ["status"])
.index("by_impact", ["impact"])


// Price reaction per event per pair
eventPriceReactions: defineTable({
  eventId: v.string(),              // Links to economicEvents
  pair: v.string(),                 // "EUR_USD"
  eventTimestamp: v.number(),       // Denormalized for queries

  // Pre-event prices
  priceAtMinus15m: v.number(),
  priceAtMinus5m: v.number(),
  priceAtMinus1m: v.number(),
  priceAtEvent: v.number(),

  // Spike data (first 5 minutes)
  spikeHigh: v.number(),
  spikeLow: v.number(),
  spikeDirection: v.string(),       // "UP" | "DOWN"
  spikeMagnitudePips: v.number(),
  timeToSpikeSec: v.optional(v.number()),

  // Settlement prices
  priceAtPlus5m: v.number(),
  priceAtPlus15m: v.number(),
  priceAtPlus30m: v.number(),
  priceAtPlus1hr: v.number(),
  priceAtPlus3hr: v.optional(v.number()),

  // Pattern classification
  patternType: v.string(),          // "spike_reversal", "continuation", "fade", "range"
  didReverse: v.boolean(),
  reversalMagnitudePips: v.optional(v.number()),
  finalDirectionMatchesSpike: v.boolean(),
})
.index("by_event", ["eventId"])
.index("by_pair", ["pair"])
.index("by_pair_event", ["pair", "eventId"])
.index("by_pair_timestamp", ["pair", "eventTimestamp"])
.index("by_pattern", ["patternType"])


// 1-minute candle windows (stored separately from main candles)
eventCandleWindows: defineTable({
  eventId: v.string(),
  pair: v.string(),
  eventTimestamp: v.number(),       // Denormalized for sorting
  windowStart: v.number(),          // T-15min timestamp
  windowEnd: v.number(),            // T+60min timestamp

  // Array of 1-minute candles (75 candles per window)
  candles: v.array(v.object({
    timestamp: v.number(),
    open: v.number(),
    high: v.number(),
    low: v.number(),
    close: v.number(),
    volume: v.optional(v.number()),
  })),
})
.index("by_event", ["eventId"])
.index("by_pair_event", ["pair", "eventId"])
.index("by_pair_timestamp", ["pair", "eventTimestamp"])


// Aggregated statistics per event type per pair
eventTypeStatistics: defineTable({
  eventType: v.string(),            // "FOMC"
  pair: v.string(),                 // "EUR_USD"

  // Sample info
  sampleSize: v.number(),
  dateRangeStart: v.number(),
  dateRangeEnd: v.number(),
  lastUpdated: v.number(),

  // For z-score calculation
  historicalStdDev: v.number(),     // StdDev of (actual-forecast) for this event type

  // Spike stats
  avgSpikePips: v.number(),
  medianSpikePips: v.number(),
  maxSpikePips: v.number(),
  minSpikePips: v.number(),
  stdDevSpikePips: v.number(),

  // Direction stats
  spikeUpCount: v.number(),
  spikeDownCount: v.number(),
  spikeUpPct: v.number(),

  // Reversal stats
  reversalWithin30minCount: v.number(),
  reversalWithin1hrCount: v.number(),
  reversalWithin30minPct: v.number(),
  reversalWithin1hrPct: v.number(),
  finalMatchesSpikeCount: v.number(),

  // Pattern distribution
  patternCounts: v.object({
    spike_reversal: v.number(),
    continuation: v.number(),
    fade: v.number(),
    range: v.number(),
  }),

  // Conditional stats (beat/miss/inline)
  hasForecastData: v.optional(v.boolean()),
  beatStats: v.optional(v.object({ ... })),
  missStats: v.optional(v.object({ ... })),
  inlineStats: v.optional(v.object({ ... })),
})
.index("by_type_pair", ["eventType", "pair"])
.index("by_type", ["eventType"])
```

---

## Storage Strategy

### Main Candles vs News Candles

| Aspect | Main Candle Storage | News Event Windows |
|--------|--------------------|--------------------|
| Timeframes | 5m, 15m, 1H, 4H, D | 1m only |
| Purpose | Charting, technical analysis | Event reaction analysis |
| Volume | ~7.4M candles | ~1.6M candles (estimated) |
| Query pattern | "Give me EURUSD 4H candles for this week" | "Give me 1m candles around FOMC Jan 2025" |
| Table | `candles` | `eventCandleWindows` |

**Why separate:**
1. Different access patterns — you never need 1m candles for charting
2. Keeps main candle queries fast
3. Event windows are self-contained units (75 candles per event per pair)
4. Easier to backfill independently

### Backfill Requirements

**News Events:**
- Source: Custom Python ForexFactory scraper (outputs JSONL)
- Scope: All impact levels (high, medium, low, non_economic) — filter at query time
- Depth: 10+ years = ~19,000+ events
- Import script: `scripts/import-events-jsonl.ts`

**1-Minute Candles (Event Windows):**
- Source: OANDA historical data (we have access)
- Scope: T-15min to T+60min per event (75 candles)
- Per event, per pair: 75 candles × 6 major pairs = 450 candles
- Backfill script: `scripts/backfill-event-windows.ts`

**Price Reaction Calculations:**
- Derived from 1m candles — computed after windows are fetched
- Spike detection, reversal detection, pattern classification
- Script: `scripts/calculate-all-reactions.ts`

---

## How Claude Uses This Data

### Context Layer (Always Available)

When the user is analyzing any chart, Claude knows:
- Upcoming high-impact events and their typical behavior
- Recent events that may still be influencing price
- Historical patterns for similar market conditions

### Query Examples

**Pre-trade context:**
> "I'm looking at a EUR/USD long setup. Any news concerns?"
>
> **Claude:** "NFP in 4 hours. Historically, NFP causes 45-pip average moves on EUR/USD. 58% of the time the initial spike reverses. If you enter now, consider:
> - Taking profit before NFP
> - Reducing position size
> - Or waiting until 30 minutes post-NFP for the reversal setup"

**Historical analysis:**
> "How does EUR/USD typically behave around ECB rate decisions?"
>
> **Claude:** "Based on 52 ECB decisions (2018-2025):
> - Average spike: 34 pips
> - Spike direction correlates with surprise factor (r=0.81)
> - When rates held as expected: avg move only 18 pips
> - When surprise cut/hike: avg move 67 pips
> - Reversal within 1hr: 61% of the time
> - The 3hr direction matches the fundamental implication 73% of the time"

**Trade review:**
> "I got stopped out during CPI yesterday. What happened?"
>
> **Claude:** "CPI came in hot — 0.4% vs 0.2% forecast. EUR/USD spiked down 52 pips in 90 seconds (your stop was 30 pips). This was the 4th largest CPI reaction in 3 years.
>
> Historical note: When CPI surprises by >0.2%, the spike exceeds 40 pips 78% of the time. Your stop placement didn't account for event volatility."

**Pattern recognition:**
> "Show me all FOMC events where the spike fully reversed"
>
> **Claude:** Returns list of events with full context, allowing you to study what conditions led to reversals.

---

## Integration with Technical Analysis

This news system is **one input** into the broader trading system vision. It provides:

### Pre-Trade Checklist Item
```
Setup Analysis: EUR/USD Long
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Technical:
  ✅ Break of structure on 15m
  ✅ Liquidity sweep below Asia low
  ✅ Unfilled FVG at entry level
  ✅ DXY at resistance

News Context:
  ⚠️ NFP in 3 hours
  ℹ️ Historical: 45 pip avg move, 58% reversal rate
  💡 Suggestion: Consider reduced size or wait for post-NFP setup
```

### Trade Journal Enhancement
Every logged trade includes:
- Proximity to news events (was there a red-folder within 2hrs?)
- If news occurred during trade: the event details and price reaction
- Post-hoc analysis: "This loss occurred during NFP spike"

### Strategy Backtesting Filter
> "Backtest my sweep strategy, but exclude 2 hours around red-folder events"
>
> Compare results with and without news periods. Maybe your strategy works great in normal conditions but fails around news.

---

## Chart Tooltip: Individual Events Over Aggregates

### The Problem with Percentages

Early tooltip designs showed aggregated statistics:
```
Historical (n=52):
  72% spike UP
  38 pips average
  55% reversal rate
```

**Why this fails:** Percentages are abstract. "55% reversal rate" doesn't tell you *how much* it reversed or *when*. Traders need concrete examples to build intuition.

### The Solution: Show What Actually Happened

Instead of aggregates, show the **last 5 individual events** with real pip movements:

```
┌────────────────────────────────────────────────────┐
│ Jan 10, 2025 13:30                                 │
├────────────────────────────────────────────────────┤
│ ▌ Non-Farm Payrolls                                │
│ ▌ Forecast: 200K   Previous: 227K                  │
├────────────────────────────────────────────────────┤
│ If BEATS (5):                                      │
│   Dec 6    1.08234→1.08276   42↑   -15             │
│   Nov 1    1.08891→1.08929   38↑                   │
│   Oct 4    1.09102→1.09157   55↑   -22             │
│   Sep 6    1.07844→1.07875   31↑                   │
│   Aug 2    1.09234→1.09281   47↑   -18             │
│                                                    │
│ If MISSES (5):                                     │
│   Jul 5    1.08123→1.08094   29↓   -8              │
│   Jun 7    1.07891→1.07850   41↓   -19             │
│   May 3    1.08456→1.08434   22↓                   │
│   Apr 5    1.09012→1.08977   35↓   -12             │
│   Mar 8    1.08678→1.08650   28↓   -7              │
└────────────────────────────────────────────────────┘
```

**Format breakdown:**
- `Dec 6` — Date of event
- `1.08234→1.08276` — Price at event → spike target (educational)
- `42↑` — Pip movement and direction (green/red)
- `-15` — Reversal magnitude in pips (amber, if occurred)

### Context-Aware Display

**Future events** (before release): Show BOTH scenarios
- "If BEATS" — last 5 events where actual > forecast
- "If MISSES" — last 5 events where actual < forecast
- Helps trader prepare for either outcome

**Past events** (after release): Show what happened
- "This was a BEAT" — classify the current event
- Show only relevant history (past beats if this was a beat)
- Compare: "Did this match historical pattern?"

**Speeches** (no forecast data): Show raw history
- "Last 5 events:" — no beat/miss classification
- Still valuable for volatility expectations

### Beat/Miss Classification

Events are classified based on actual vs forecast:
- **Beat**: Actual better than expected
- **Miss**: Actual worse than expected
- **Inline**: Within 5% threshold

**Lower-is-better events** (CPI, Unemployment, Jobless Claims):
- Beat = actual < forecast (lower inflation is better)
- Miss = actual > forecast

This is handled automatically using the `LOWER_IS_BETTER_EVENTS` list.

### Lazy Loading for Performance

Historical data is fetched **on hover**, not preloaded:
1. User hovers over flag marker
2. Query fetches last N events of this type
3. Results cached for session
4. Re-hover uses cache, no re-fetch

This avoids N×5×2 extra DB reads for every event on the chart.

### Implementation

| Component | Role |
|-----------|------|
| `getHistoricalEventsForTooltip` query | Fetches last 5 beats, 5 misses, 5 raw for event type + pair |
| `HistoricalEventReaction` interface | Stores pip/price/reversal data per event |
| `NewsMarkersPrimitive._drawTooltip` | Renders rows with date, price, pips, reversal |
| `Chart.tsx` fetchHistorical callback | Triggers query on hover, manages cache |

---

## Event Types to Track

### Tier 1: Always Track (Red Folder)

**US Events:**
- FOMC Rate Decision
- Non-Farm Payrolls (NFP)
- CPI (Consumer Price Index)
- Core CPI
- GDP
- Retail Sales
- PPI (Producer Price Index)
- Unemployment Rate
- Fed Chair Powell Speaks

**Eurozone:**
- ECB Rate Decision
- ECB Press Conference
- German CPI
- Eurozone CPI

**UK:**
- BoE Rate Decision
- UK CPI
- UK GDP

**Other:**
- BoJ Rate Decision
- RBA Rate Decision
- RBNZ Rate Decision
- SNB Rate Decision
- BoC Rate Decision

### Tier 2: Track if Relevant

- PMI readings (Manufacturing, Services)
- Trade Balance
- Consumer Confidence
- Housing data
- Employment Change (non-US)

---

## Backfill Strategy

### Phase 1: Event Metadata

1. Run custom Python ForexFactory scraper to generate JSONL
2. Import via `npx tsx scripts/import-events-jsonl.ts path/to/events.jsonl`
3. Smart upsert: only updates if `scrapedAt` is newer than existing
4. Includes: impact, status, trading session, outcome, deviation

### Phase 2: 1-Minute Windows

1. For each event, fetch 1m candles from OANDA
2. Window: T-15min to T+60min (75 candles)
3. Store in `eventCandleWindows` table
4. Cover major pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD
5. Run: `npx tsx scripts/backfill-event-windows.ts`

### Phase 3: Calculate Reactions

1. Process each event window
2. Detect spike (high/low in first 5 candles)
3. Calculate all price points (T-1m, T+5m, T+15m, T+30m, T+1hr, T+3hr)
4. Classify pattern: spike_reversal, continuation, fade, range
5. Store in `eventPriceReactions` table
6. Run: `npx tsx scripts/calculate-all-reactions.ts`

### Phase 4: Aggregate Statistics

1. Group by event type + pair
2. Calculate averages, medians, percentages, pattern distribution
3. Calculate conditional stats (beat/miss/inline behavior)
4. Store in `eventTypeStatistics` table
5. Run: `npx tsx scripts/regenerate-statistics.ts`

---

## Future Enhancements

### Sentiment Analysis
- Store the actual announcement text
- Have Claude analyze hawkish/dovish tone
- Correlate sentiment with price reaction

### Cross-Event Patterns
- "When CPI is hot AND FOMC is hawkish, what happens?"
- Multi-event regime detection

### Live Event Processing
- Real-time ingestion when new events occur
- Automatic reaction calculation
- Update statistics incrementally

### Replay System Integration
- Generate video replays of news events
- "Show me the 10 biggest NFP reactions with candle animation"

---

## What This Enables

After 6-12 months of data collection:

1. **Informed position management** — Know whether to hold through news or close before
2. **Volatility expectations** — Size positions appropriately for upcoming events
3. **Pattern trading** — Trade the reversal after spike with statistical backing
4. **Avoidance rules** — "My strategy loses money around news, so I close 30min before"
5. **Context for every trade** — Never get surprised by "what just happened?"

This is **preparation and informed prediction** — knowing how markets have historically behaved so you can make probabilistic decisions with statistical backing, not gut feel.

---

## Scraper Output Format

The custom Python ForexFactory scraper outputs JSONL with the following fields:

```json
{
  "event_id": "CPI_m_m_USD_2024-01-15_14:30",
  "status": "released",
  "timestamp_utc": 1705329000000,
  "scraped_at": 1705400000000,
  "datetime_utc": "2024-01-15T14:30:00Z",
  "day_of_week": "Mon",
  "trading_session": "new_york",
  "currency": "USD",
  "impact": "high",
  "event": "CPI m/m",
  "actual": "0.3%",
  "forecast": "0.2%",
  "previous": "0.1%",
  "deviation": 0.1,
  "deviation_pct": 50.0,
  "outcome": "beat"
}
```

**Key fields:**
- `event_id`: Unique identifier format `{name}_{currency}_{date}_{time}`
- `status`: "scheduled" (upcoming) or "released" (data available)
- `trading_session`: asian | london | new_york | london_ny_overlap | off_hours
- `outcome`: beat | miss | met | null (pre-computed by scraper)
- `deviation`: actual - forecast (numeric)
- `scraped_at`: Used for smart upsert (only update if newer)

---

*Document Version: 2.0 — Implementation*
*Last Updated: January 2025*
