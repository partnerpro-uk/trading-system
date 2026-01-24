# News Event Impact System

## Vision Document

---

## The Core Idea

Build a comprehensive news event database that goes beyond simple calendar data. Track not just *what* happened (actual vs forecast), but *how the market reacted* — the spike, the reversal, the settlement pattern — across **every** event historically.

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
- How did OTHER pairs react to this event?
- Did the reaction continue for hours or fade quickly?

### The Opportunity

Build a system where **every** news event has:
- Full price reaction profile (spike, pullback, reversal, extended trend)
- Cross-pair correlation (how USD events affect EUR/USD, GBP/USD, USD/JPY, etc.)
- Extended timeframe analysis (immediate spike through T+24 hours)
- Historical statistics across hundreds of occurrences
- Pattern classification (spike-reversal, continuation, fade, trap, delayed)
- Queryable data Claude can reason about

---

## Scope: ALL Events, Not Just High Impact

### Why Track Everything?

Traditional approaches focus only on "red folder" (high impact) events. We track **all 13,000+ events** because:

**1. Low Impact Can Become High Impact**
- A "low impact" speech can move markets 100 pips if the speaker says something unexpected
- Market context matters: during uncertainty, even medium events can trigger large moves
- Better to have the data and not need it than miss a significant reaction

**2. Pattern Discovery**
- Aggregate 100 instances of a "medium" event type reveals hidden patterns
- Some "low impact" events consistently cause 15-20 pip moves — worth knowing
- Cross-event patterns: "When PMI is bad AND retail sales misses, the next event amplifies"

**3. Context Building**
- Every event adds context for Claude's reasoning
- "Three negative data points today before FOMC" changes the reaction profile
- Full history = better pattern recognition

**4. Future-Proofing**
- Historical data cannot be recovered once lost
- Storage is cheap; hindsight is expensive
- 13K events × 9 pairs × 100 candles = ~12M rows (manageable)

### Current Data
- **13,470 events** in ClickHouse (2023-2026)
- Only 42 have impact classification (2024+ has impact data)
- Events from 2022-2023 default to "None" impact — still valuable for price reactions

---

## Multi-Pair Analysis

### The Insight

When NFP releases, it doesn't just affect EUR/USD — it affects:
- **EUR/USD** — Dollar strength/weakness
- **GBP/USD** — Same USD denominator
- **USD/JPY** — Direct USD exposure
- **USD/CHF** — Safe haven correlation
- **AUD/USD** — Risk-on/off proxy
- **USD/CAD** — Commodity correlation
- **NZD/USD** — Risk sentiment
- **EUR/JPY** — Cross effects
- **GBP/JPY** — Cross effects

### Why This Matters

**Cross-Pair Confirmation:**
> "NFP beat expectations. EUR/USD spiked down 40 pips, but GBP/USD only moved 15 pips. Historical pattern shows when GBP lags, EUR catches up — expect EUR reversal."

**Trade Selection:**
> "CPI coming up. Historical data shows USD/JPY has 20% larger moves than EUR/USD on CPI surprises. If betting on dollar strength, USD/JPY offers better R:R."

**Correlation Breakdown Detection:**
> "Normally EUR/USD and GBP/USD correlate 0.85 around Fed events. Last 3 events show correlation dropping to 0.6 — something fundamental is diverging."

### Implementation

For each event, track reactions on **9 major pairs**:
- 7 USD pairs: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD
- 2 major crosses: EUR/JPY, GBP/JPY

**Backfill estimate:** 13K events × 9 pairs = **117K OANDA API calls**

---

## Multi-Timeframe Strategy

### The Three Phases of News Reactions

News events don't resolve in 5 minutes. They unfold in phases:

**Phase 1: Spike (T-15min to T+5min)**
- Initial algorithmic reaction
- Retail stop hunts
- Maximum volatility
- **Captured with:** 1-minute candles

**Phase 2: Settlement (T+5min to T+90min)**
- Initial reversal or continuation
- Institutional positioning
- Pattern classification possible
- **Captured with:** 1-minute candles

**Phase 3: Extended Aftermath (T+90min to T+24hr)**
- Longer-term trend establishment
- "Did the spike direction hold?"
- Next-session reaction (Asian, European opens)
- **Captured with:** H1 candles (or H4 for T+24hr)

### Why Extended Tracking Matters

**Story of a Trade:**
> EUR/USD spikes down 50 pips on hot CPI. Trader sees "reversal setup," goes long at T+20min.
>
> - At T+1hr: up 20 pips — looks like a winner
> - At T+4hr: back to entry — concerning
> - At T+8hr: down 30 pips — stopped out
> - At T+24hr: down 80 pips — trend continuation
>
> **Historical pattern:** When CPI surprises by >0.3%, the spike direction holds 78% of the time through T+24hr. The "reversal" was a pullback, not a reversal.

**With extended tracking, Claude can warn:**
> "CPI spike down 50 pips. Historical data shows hot CPI rarely reverses — 78% of the time, price is lower at T+24hr. Consider this a pullback opportunity to add shorts, not a reversal."

### Candle Strategy

| Phase | Timeframe | Window | Candles | Storage |
|-------|-----------|--------|---------|---------|
| Spike + Settlement | M1 | T-15 to T+90 | 105 candles | Per event, per pair |
| Extended Aftermath | H1 | T+2hr, T+4hr, T+8hr, T+24hr | 4 snapshots | Derived from main H1 table |

**Why not M1 for T+24hr?**
- 24 hours × 60 min = 1,440 candles per event per pair
- 13K events × 9 pairs × 1,440 = **168 million candles**
- Overkill: minute-level granularity isn't needed 8 hours later
- H1 captures the trend; that's what matters for aftermath

---

## Live Processing Architecture

### The Problem with Batch Processing

Current approach: Run a script daily/hourly to calculate reactions.

**Issues:**
- Real-time events aren't captured until next batch
- Trader needs context NOW, not in 6 hours
- Miss intraday patterns
- Can't power real-time alerts

### Real-Time Event State Machine

Each event progresses through states:

```
PENDING → CAPTURING_PRE → ACTIVE → SETTLING → COMPLETE
```

**State Definitions:**

| State | When | Actions |
|-------|------|---------|
| `PENDING` | T-24hr to T-15min | Event exists, no price capture yet |
| `CAPTURING_PRE` | T-15min | Start recording M1 candles, capture pre-event prices |
| `ACTIVE` | T+0 to T+5min | Event released, spike detection, maximum alertness |
| `SETTLING` | T+5min to T+90min | Pattern forming, reversal detection |
| `COMPLETE` | T+90min+ | Calculate final metrics, update statistics |

### Live Processing Flow

```
1. Event Scheduler
   └── Monitors upcoming events
   └── Triggers state transitions
   └── Spawns capture workers

2. Real-Time Capture (during CAPTURING_PRE through SETTLING)
   └── WebSocket subscription to relevant pairs
   └── Store M1 candles to TimescaleDB
   └── Calculate running metrics (spike high/low, reversal detection)

3. Live Updates to UI
   └── Push via WebSocket to connected clients
   └── "EUR_USD spiked 45 pips on NFP — historical avg was 42"
   └── Update sidebar with live event status

4. Completion (after SETTLING)
   └── Calculate final reaction metrics
   └── Classify pattern
   └── Update aggregate statistics
   └── Archive to ClickHouse
```

### Why Real-Time Matters

**Without real-time:**
- Trader: "What just happened on NFP?"
- System: "Check back tomorrow when we've processed it"

**With real-time:**
- Trader: "What just happened on NFP?"
- System: "NFP beat by 50K jobs. EUR/USD spiked down 52 pips in 90 seconds. Historical pattern shows 68% reversal within 30 min when surprise is moderate. Currently at T+7min, watching for reversal signal."

---

## Pattern Classification System

### Core Patterns

| Pattern | Description | Trading Implication |
|---------|-------------|---------------------|
| `spike_reversal` | Initial spike fully reverses within settlement | Fade the spike after confirmation |
| `continuation` | Spike continues in same direction through T+1hr | Trend trade, don't fade |
| `fade` | Spike partially reverses (30-70%) then ranges | Wait for breakout |
| `range` | No significant directional move | Event was priced in |
| `delayed_reaction` | Minimal initial spike, big move at T+30min+ | Second wave entry opportunity |
| `trap` | Spike reverses aggressively, traps fade traders, then reverses again | Patience — let it settle |

### Classification Logic

```typescript
function classifyPattern(reaction: PriceReaction): PatternType {
  const spikeDir = reaction.spikeDirection; // UP or DOWN
  const spikeMag = reaction.spikeMagnitudePips;

  const t30Change = reaction.priceAtPlus30m - reaction.priceAtEvent;
  const t1hrChange = reaction.priceAtPlus1hr - reaction.priceAtEvent;

  // Continuation: still moving in spike direction at T+1hr
  if (Math.sign(t1hrChange) === Math.sign(spikeMag) && Math.abs(t1hrChange) > spikeMag * 0.8) {
    return 'continuation';
  }

  // Spike reversal: opposite direction at T+1hr, magnitude > 80% of spike
  if (Math.sign(t1hrChange) !== Math.sign(spikeMag) && Math.abs(t1hrChange) > spikeMag * 0.8) {
    return 'spike_reversal';
  }

  // Fade: partial reversal (30-70%)
  if (Math.sign(t1hrChange) !== Math.sign(spikeMag) && Math.abs(t1hrChange) > spikeMag * 0.3) {
    return 'fade';
  }

  // Delayed: small spike but big T+30m move
  if (spikeMag < 15 && Math.abs(t30Change) > 30) {
    return 'delayed_reaction';
  }

  // Range: no significant movement
  if (spikeMag < 10 && Math.abs(t1hrChange) < 15) {
    return 'range';
  }

  return 'fade'; // Default
}
```

### Extended Pattern Analysis (T+24hr)

Add H1-based patterns for longer-term behavior:

| Extended Pattern | Description |
|-----------------|-------------|
| `spike_trend` | Spike direction continues through T+24hr |
| `spike_trap_trend` | Spike reverses, then reverses again to original direction |
| `mean_reversion` | Returns to pre-event price by T+24hr |
| `new_range` | Establishes new range at spike level |

---

## Data Architecture

### Dual Database Strategy

| Database | Purpose | Data |
|----------|---------|------|
| **ClickHouse** | Historical storage | All events, all reactions, full M1 windows |
| **TimescaleDB** | Live/recent data | Last 90 days events, live M1 capture |

### Schema: Event Core

```sql
-- ClickHouse: news_events
CREATE TABLE news_events (
  event_id String,
  event_type String,
  name String,
  country String,
  currency String,
  timestamp DateTime,
  impact String,  -- High/Medium/Low/None
  actual Nullable(String),
  forecast Nullable(String),
  previous Nullable(String),
  description Nullable(String),
  trading_session String,
  source_tz String DEFAULT 'EET',
  raw_source String DEFAULT 'jblanked_forex-factory',
  created_at DateTime DEFAULT now(),

  -- Processing state
  processing_state String DEFAULT 'PENDING',  -- PENDING/CAPTURING_PRE/ACTIVE/SETTLING/COMPLETE
  reactions_calculated Bool DEFAULT false
) ENGINE = ReplacingMergeTree()
ORDER BY (timestamp, event_id);
```

### Schema: Price Reactions (Per Event, Per Pair)

```sql
CREATE TABLE event_price_reactions (
  event_id String,
  pair String,
  event_timestamp DateTime,

  -- Pre-event prices
  price_t_minus_15m Float64,
  price_t_minus_5m Float64,
  price_t_minus_1m Float64,
  price_at_event Float64,

  -- Spike data (T+0 to T+5min)
  spike_high Float64,
  spike_low Float64,
  spike_direction String,  -- UP/DOWN
  spike_magnitude_pips Float64,
  time_to_spike_sec UInt32,

  -- Settlement prices (M1 derived)
  price_t_plus_5m Float64,
  price_t_plus_15m Float64,
  price_t_plus_30m Float64,
  price_t_plus_60m Float64,
  price_t_plus_90m Float64,

  -- Extended aftermath (H1 derived)
  price_t_plus_2hr Nullable(Float64),
  price_t_plus_4hr Nullable(Float64),
  price_t_plus_8hr Nullable(Float64),
  price_t_plus_24hr Nullable(Float64),

  -- Pattern classification
  pattern_type String,  -- spike_reversal/continuation/fade/range/delayed_reaction/trap
  extended_pattern_type Nullable(String),  -- spike_trend/spike_trap_trend/mean_reversion/new_range
  did_reverse Bool,
  reversal_magnitude_pips Nullable(Float64),
  final_direction_matches_spike Bool,

  -- Cross-pair correlation
  correlation_with_primary Nullable(Float64),  -- Correlation with EUR/USD during this event

  created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY (event_id, pair);
```

### Schema: 1-Minute Candle Windows

```sql
CREATE TABLE event_candle_windows (
  event_id String,
  pair String,
  event_timestamp DateTime,
  candle_timestamp DateTime,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64,

  -- Relative position
  minutes_from_event Int16  -- -15 to +90
) ENGINE = ReplacingMergeTree()
ORDER BY (event_id, pair, candle_timestamp);
```

### Schema: Aggregated Statistics

```sql
CREATE TABLE event_type_statistics (
  event_type String,
  pair String,

  -- Sample info
  sample_size UInt32,
  date_range_start DateTime,
  date_range_end DateTime,
  last_updated DateTime,

  -- Spike stats
  avg_spike_pips Float64,
  median_spike_pips Float64,
  max_spike_pips Float64,
  min_spike_pips Float64,
  stddev_spike_pips Float64,

  -- Direction stats
  spike_up_count UInt32,
  spike_down_count UInt32,
  spike_up_pct Float64,

  -- Reversal stats
  reversal_30min_count UInt32,
  reversal_30min_pct Float64,
  reversal_1hr_count UInt32,
  reversal_1hr_pct Float64,

  -- Extended stats
  trend_continues_24hr_count UInt32,
  trend_continues_24hr_pct Float64,

  -- Pattern distribution
  pattern_spike_reversal_count UInt32,
  pattern_continuation_count UInt32,
  pattern_fade_count UInt32,
  pattern_range_count UInt32,
  pattern_delayed_count UInt32,
  pattern_trap_count UInt32,

  -- Cross-pair correlation averages
  avg_correlation_eur_usd Float64,
  avg_correlation_gbp_usd Float64,
  avg_correlation_usd_jpy Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (event_type, pair);
```

---

## Backfill Strategy

### Phase 1: Event Metadata (DONE)

- JBlanked API provides historical events from 2023-01-01
- 13,470 events currently in ClickHouse
- Run: `npx tsx worker/src/jblanked-news.ts backfill 2023-01-01`

### Phase 2: M1 Candle Backfill (NEXT)

**Source:** OANDA Historical API

**Scope:**
- 13K events × 9 pairs = 117K API calls
- Each call fetches 105 candles (T-15 to T+90)
- Rate limit: ~1 request/second
- **Estimated runtime:** 2-3 days (can parallelize by pair)

**Process:**
```bash
# Run per pair to parallelize
npx tsx worker/src/backfill-event-candles.ts --pair=EUR_USD
npx tsx worker/src/backfill-event-candles.ts --pair=GBP_USD
# ... etc
```

**Retry Logic:**
- 3 retries with exponential backoff
- Log failures to `backfill_failures` table
- Resumable from last successful event

### Phase 3: Reaction Calculations

After M1 candles exist, compute reactions:

```bash
npx tsx worker/src/calculate-reactions.ts --all
```

**Process:**
1. For each event with candles but no reactions
2. Calculate spike metrics from M1 candles
3. Fetch H1 candles for extended aftermath
4. Classify pattern
5. Store in `event_price_reactions`

### Phase 4: Statistics Aggregation

After reactions exist, compute aggregates:

```bash
npx tsx worker/src/aggregate-statistics.ts
```

**Process:**
1. Group reactions by event_type + pair
2. Calculate all statistical metrics
3. Store in `event_type_statistics`
4. Schedule for weekly refresh

---

## UI Integration

### Chart News Markers

Current implementation: Flag markers on chart at event timestamps

**Enhanced features:**
- Color by impact (red/orange/yellow/gray)
- Tooltip shows spike/reversal summary
- Click opens detail panel

### Sidebar: Upcoming Events

Real-time list of:
- Next 24 hours of events
- Current event state (PENDING/ACTIVE/SETTLING)
- Live pip movement during ACTIVE state
- Historical avg spike for comparison

### Sidebar: Cross-Pair Reactions

When an event is ACTIVE:
```
NFP (ACTIVE - T+3min)
━━━━━━━━━━━━━━━━━━━━━
EUR/USD  -42 pips  ↓
GBP/USD  -38 pips  ↓
USD/JPY  +55 pips  ↑
USD/CHF  +28 pips  ↑
AUD/USD  -31 pips  ↓
━━━━━━━━━━━━━━━━━━━━━
Historical avg: 45 pips
Pattern forming: continuation
```

### Event Detail Panel

Accessible via click on marker or sidebar:
- Full event metadata
- All 9 pair reactions
- Pattern classification
- Historical comparison
- M1 chart visualization

---

## Implementation Phases

### Phase 1: Data Infrastructure (Current)
- [x] JBlanked API integration
- [x] Event ingestion to ClickHouse/TimescaleDB
- [x] News markers on chart
- [ ] M1 candle backfill script
- [ ] Reaction calculation script
- [ ] Statistics aggregation script

### Phase 2: Historical Analysis
- [ ] Pattern classification system
- [ ] Cross-pair correlation tracking
- [ ] Extended aftermath (H1 snapshots)
- [ ] Event tooltip with historical data

### Phase 3: Live Processing
- [ ] Event scheduler service
- [ ] Real-time M1 capture
- [ ] Live state machine
- [ ] WebSocket updates to UI

### Phase 4: Intelligence Layer
- [ ] Claude integration for insights
- [ ] Pre-trade news warnings
- [ ] Pattern-based trade suggestions
- [ ] Anomaly detection (unusual reactions)

---

## Benefits Summary

### For The Trader

| Feature | Benefit |
|---------|---------|
| All events tracked | Never miss a reaction pattern |
| Multi-pair analysis | Choose best pair for news trades |
| Extended timeframe | Know if spikes hold or reverse by T+24hr |
| Live processing | Real-time context during events |
| Pattern classification | Statistically-backed trade decisions |
| Historical statistics | "This event typically..." reasoning |

### For The System

| Feature | Benefit |
|---------|---------|
| ClickHouse historical | Fast aggregations over 13K+ events |
| TimescaleDB live | Real-time queries during events |
| M1 + H1 strategy | Optimal storage vs granularity tradeoff |
| Event state machine | Clean processing lifecycle |
| Cross-pair schema | Future correlation analysis |

### For Claude

| Feature | Benefit |
|---------|---------|
| Queryable statistics | "FOMC averages 42 pips, reverses 64%" |
| Pattern history | "Last 5 CPI beats all continued" |
| Real-time state | "NFP is ACTIVE, currently -45 pips" |
| Extended aftermath | "Hot CPI holds direction 78% at T+24hr" |

---

## Backfill Estimates

### Storage Requirements

```
Events: 13,470
Pairs: 9
M1 candles per event: 105

Event metadata: 13K rows × 1KB = 13 MB
M1 candles: 13K × 9 × 105 = 12.7M rows × 100B = 1.3 GB
Reactions: 13K × 9 = 117K rows × 500B = 59 MB
Statistics: ~500 event types × 9 pairs = 4.5K rows × 1KB = 4.5 MB

Total: ~1.4 GB (manageable)
```

### API Call Requirements

```
OANDA M1 backfill:
- 13K events × 9 pairs = 117K requests
- Rate: 1/second = 117K seconds = 32.5 hours
- Parallelized by pair (9x): ~3.5 hours

H1 aftermath (4 snapshots per event):
- Already have H1 candles in main storage
- Just need SQL queries, no API calls
```

---

## Future Enhancements

### Sentiment Analysis
- Store announcement text
- Claude analyzes hawkish/dovish tone
- Correlate sentiment with price reaction

### Cross-Event Patterns
- "When CPI is hot AND FOMC is hawkish, what happens?"
- Multi-event regime detection
- Sequence analysis

### Replay System
- Generate video replays of news events
- "Show me the 10 biggest NFP reactions with candle animation"

### Predictive Modeling
- ML model for spike magnitude prediction
- Based on surprise factor, market context, session
- Confidence intervals for expected moves

---

*Document Version: 3.0 — Comprehensive Vision*
*Last Updated: January 2025*
