# Market Structure Engine — Technical Architecture

> The blueprint for the structure computation system. Covers the architectural
> evolution from on-demand computation to pre-computed stored structure, database
> design, data immutability model, computation flows, and integration points.

---

## 1. Architectural Evolution

### The Old Model (v1 — Current Implementation)

Structure is computed **on-demand** via `/api/structure/[pair]?timeframe=H4`.

How it works today:

1. API receives request for a pair + timeframe
2. Fetches a **fixed depth** of candles (500 for M15, 300 for H4, 200 for D, etc.)
3. Runs `computeStructure()` — swings, BOS, FVGs, sweeps, key levels, all fresh
4. Caches the result with a short TTL (M15=1min, H4=5min, D=15min)
5. Returns the full structure payload

**Problems with this model:**

- **Depth mismatch**: The chart renders more candles than the API computes on.
  On M15, 500 candles covers ~5 days. Scroll back further and structure labels
  simply stop — the user sees naked candles with no swing labels or BOS lines.
- **Wasted computation**: Structure is deterministic. The same candles always
  produce the same swings, the same BOS events, the same FVGs. Recomputing
  identical results on every request is pure waste.
- **No persistence**: Nothing is stored. Close the tab, open it again, and the
  server does the exact same work. No accumulation of knowledge over time.
- **Backtesting impossible**: You cannot query "all BOS events from Q3 2023"
  because that structure was never computed and stored. The API only looks at
  the most recent N candles.
- **Claude is blind to history**: Claude's data tools hit the same API, so
  Claude can only see ~5 days of M15 structure. Asking "show me all MSS events
  in the last 3 months" returns nothing useful.

### The New Model (v2 — Target Architecture)

Structure is **pre-computed** by the worker as new candles arrive, **stored** in
TimescaleDB and ClickHouse, and **queried** by time range.

How it will work:

1. Worker detects a new candle close (per pair, per timeframe)
2. Runs `computeStructure()` on the recent window (enough for swing confirmation)
3. **Upserts** new/changed structure entities into TimescaleDB
4. **Archives** confirmed (immutable) structure to ClickHouse
5. Chart/Claude queries stored structure by visible time range — no depth limit

**Why this is better:**

- **Unlimited scroll-back**: Structure goes as far back as the database has data.
  Scroll to 2019 on H4? The swings, BOS events, and FVGs are all there.
- **Zero wasted computation**: Each candle's contribution to structure is computed
  once, stored, and never recomputed.
- **Full history for Claude**: "Show me all MSS events in the last 3 months" hits
  TimescaleDB and returns real data.
- **Backtesting**: ClickHouse stores years of structure. Query FVG respect rates
  across 5 years of EUR/USD in seconds.
- **Like TradingView PineScript**: The indicator runs on all candles and the
  results are just *there*. Scroll back? Data is there. Zoom in? Data is there.
  That is the mental model.

### Why Pre-Computed?

Structure is **deterministic**. Given the same sequence of candles, you always get
the same swing points, BOS events, and FVGs. There is no randomness, no external
input, no user preference that changes the output. This makes it a perfect
candidate for pre-computation.

The only "live" part is the trailing edge — the last N candles where swings have
not yet been confirmed because they need right-side candles. This small window is
computed on-the-fly by the API and merged with stored results.

---

## 2. Data Immutability Model

Understanding what changes and what does not is critical for the storage strategy.

### Immutable (Write-Once, Never Changes)

| Entity | Why immutable |
|--------|---------------|
| **Swing points** | Once confirmed (N candles formed after the swing), the swing is locked. A swing high at 1.0950 on 2024-01-15 at 14:00 is a historical fact. |
| **BOS event creation** | The fact that price broke a swing level is permanent. The BOS *happened*. |
| **Sweep events** | Once a wick pierces a level and rejects, the sweep is recorded permanently. |
| **FVG creation** | The three-candle gap existed. The gap boundaries (high, low, midline) are fixed. |

### Mutable (Can Change Over Time)

| Entity | What changes | Allowed transitions |
|--------|-------------|---------------------|
| **BOS status** | `active` to `reclaimed` | One-way only. Price reclaims the broken level. |
| **FVG status** | Lifecycle progression | `fresh` to `partial` to `filled` or `inverted` |
| **FVG fill %** | Continuously updated | Increases as candles fill into the gap |

### The "Hot Edge" — Live Structure

The trailing edge of the chart where structure is not yet confirmed:

- **Unconfirmed swings**: The last N candles where a potential swing exists but
  has not been confirmed by subsequent price action. Today's swing might be HH
  now but become HL if a higher high forms later.
- **Active BOS events**: Could still be reclaimed if price reverses.
- **Fresh FVGs**: Fill percentage is still being updated.

The worker recomputes this window frequently:
- M15: every 1 minute
- H1/H4: every 5 minutes
- D/W/M: every 4 hours (existing `htf-structure-precompute.ts`)

### Edge Case: Very Old Active BOS

Some BOS events can stay active for years on higher timeframes.

**Example**: GBP/USD 2022 crash broke below the 1982 all-time low.

- The 1982 swing point does **not** change — it is immutable.
- A **new** BOS event was created in 2022, referencing the 1982 level.
- When GBP recovered, the 2022 BOS was marked `reclaimed` — the 2022 row
  changed, not the 1982 row.

In practice:
- **LTF (M15/H1)**: BOS events settle within days. After a week they are
  effectively immutable.
- **HTF (W/M)**: Active BOS events might stay active for years, but there are
  very few of them (single digits per pair on W/M).

---

## 3. Database Architecture

### TimescaleDB (Hot — 30 Days)

Primary role: fast reads for chart rendering and Claude context.

**Tables:**

| Table | Key columns | Notes |
|-------|-------------|-------|
| `swing_points` | pair, timeframe, timestamp, type (HH/HL/LH/LL/EQH/EQL), price | Immutable after confirmation |
| `bos_events` | pair, timeframe, timestamp, direction, status, bos_type | Status mutable (active/reclaimed) |
| `sweep_events` | pair, timeframe, timestamp, swept_level, direction | Immutable |
| `key_levels` | pair, timeframe, type (PDH/PDL/PWH/PWL etc.), price | Updated on new session open |
| `fvg_events` | pair, timeframe, timestamp, high, low, status, fill_pct | Status and fill_pct mutable |
| `htf_current_structure` | pair, timeframe, json blob | Summary of current structure state |

Performance target: sub-100ms reads for any pair + timeframe + time range query.

Worker upserts new structure as candles arrive. Rolling 30-day window with
automatic retention policy.

### ClickHouse (Cold — Full History)

Primary role: years of data for backtesting and analytical queries.

**Tables** (same structure as TimescaleDB, plus):

| Table | Purpose |
|-------|---------|
| `candles_archive` | Full candle history (2007+ for major pairs) |
| `macro_ranges` | Session/daily/weekly ranges |
| `mv_fvg_effectiveness` | Materialized view: FVG respect/fill rates |
| `mv_bos_follow_through` | Materialized view: BOS continuation statistics |
| `mv_seasonal_bias` | Materialized view: seasonal directional tendencies |
| `mv_key_level_reactions` | Materialized view: price behavior at key levels |
| `mv_session_performance` | Materialized view: per-session stats |
| `mv_regime_classification` | Materialized view: trending/ranging/volatile |

Write pattern: mostly write-once (immutable historical structure). BOS reclaims
and FVG fill updates are the only mutations, and they are infrequent on cold data.

Columnar storage makes analytical queries across millions of rows fast.

### Convex (App State — Reactive)

Convex does **not** store structure data. It stores:

| Table | Purpose |
|-------|---------|
| `structureLinks` | Trade-to-structure entity linkage (e.g., "this trade entry was at this BOS level") |
| `structurePrefs` | Per-user overlay toggle preferences (show/hide FVGs, BOS lines, etc.) |

**Why not Convex for structure?** Structure is time-series data with high write
volume and time-range queries. That is exactly what TimescaleDB and ClickHouse
are designed for. Convex is for reactive app state — conversations, drawings,
trades, user preferences.

### `bos_type` Column (Migration 019)

Added `bos_type VARCHAR(3)` to `bos_events` in both TimescaleDB and ClickHouse.

- Values: `"bos"` (continuation break of structure) or `"mss"` (market structure shift — counter-trend)
- Default: `"bos"` for backward compatibility with existing rows
- The `isCounterTrend` flag from the enrichment engine maps to `mss`

---

## 4. Computation Flow

### Worker: Pre-Computes ALL Timeframes

```
Worker responsibilities (target — ALL timeframes):

  On each new candle close (per pair, per timeframe):
  ├── Fetch recent candles from TimescaleDB
  │   (enough for swing detection window + overlap with last confirmed swing)
  ├── Run computeStructure() on the window
  ├── Diff against stored structure:
  │   ├── New swings → INSERT into swing_points
  │   ├── New BOS → INSERT into bos_events
  │   ├── New sweeps → INSERT into sweep_events
  │   ├── New FVGs → INSERT into fvg_events
  │   ├── Changed BOS status → UPDATE bos_events SET status = 'reclaimed'
  │   └── Changed FVG fill → UPDATE fvg_events SET fill_pct, status
  ├── Update htf_current_structure summary
  └── Archive confirmed (immutable) entities to ClickHouse

  Existing worker jobs (already built):
  ├── htf-structure-precompute.ts — D/W/M structure every 4 hours
  ├── fvg-fill-tracker.ts — FVG fill percentage updates every 5 minutes
  └── macro-range-updater.ts — macro ranges every 24 hours

  New worker jobs needed:
  ├── LTF structure computation — M15/H1/H4 on each candle close
  │   (triggered by candle ingestion, not on a fixed schedule)
  └── Historical backfill job — one-time: ClickHouse candles → structure
```

### API: Reads from DB + Computes Live Tail

```
GET /api/structure/[pair]?timeframe=H4&start=<timestamp>&end=<timestamp>

New flow:
  1. Parse time range from query params (or derive from chart visible range)
  2. Query TimescaleDB for stored structure within [start, end]
     - SELECT * FROM swing_points WHERE pair = $1 AND timeframe = $2
       AND timestamp BETWEEN $3 AND $4
     - Same for bos_events, sweep_events, fvg_events
  3. For the latest N unconfirmed candles (the "hot edge"):
     - Fetch candles from TimescaleDB
     - Run computeStructure() on this small window
     - This handles swings that are not yet confirmed
  4. Merge stored + live results (deduplicate by timestamp + type)
  5. Return unified structure payload

No more fixed depth limit.
No more TTL cache (data is always fresh from DB).
Structure goes as far back as TimescaleDB has data (30 days).
For older data, a separate endpoint can query ClickHouse.
```

### Historical Backfill (One-Time Job)

For the transition from v1 to v2, a backfill job populates ClickHouse with
historical structure computed from stored candles.

```
For each pair (10 major pairs):
  For each timeframe (M15, H1, H4, D, W, M):
    1. Fetch all candles from ClickHouse (2007-present for majors)
    2. Process in chunks (e.g., 5000 candles per chunk with overlap)
    3. Run computeStructure() on each chunk
    4. Deduplicate against previous chunk's trailing entities
    5. Batch INSERT into ClickHouse structure tables
```

Scale estimate:
- EUR_USD M15 since 2007: ~460K candles
- 10 pairs x 6 timeframes: ~5M candle-rows to process
- `computeStructure()` processes 5000 candles in <500ms
- Total: ~1000 chunks, finishes in minutes per pair
- Full backfill: under an hour for all pairs and timeframes

---

## 5. Data Flow Diagram

```
┌──────────────────────────────────────────────────────┐
│                 ClickHouse (Cold)                      │
│   Full history: candles, structure, macro ranges       │
│   Materialized views for backtesting analytics         │
│   2007-present for major pairs                         │
└────────────┬──────────────────────┬───────────────────┘
             │                      │
    reads candles for          backfill writes
    HTF compute + backfill     + daily archive
             │                      │
┌────────────▼──────────────────────▼───────────────────┐
│                  Worker (Railway)                       │
│   Pre-computes structure for ALL pairs x ALL TFs       │
│   Triggered on candle close (LTF) or schedule (HTF)    │
│   Diffs and upserts only changed entities              │
└────────────┬──────────────────────────────────────────┘
             │
             │ writes pre-computed structure
             ▼
┌──────────────────────────────────────────────────────┐
│               TimescaleDB (Hot 30d)                    │
│   candles, swing_points, bos_events, fvg_events,      │
│   sweep_events, key_levels, htf_current_structure      │
│   Sub-100ms reads, rolling 30-day retention            │
└────────────┬──────────────────────────────────────────┘
             │
             │ queries by visible time range
             ▼
┌──────────────────────────────────────────────────────┐
│          API: /api/structure/[pair]                     │
│   Reads stored structure from TimescaleDB              │
│   + computes live tail for unconfirmed candles         │
│   Returns unified payload                              │
└────────────┬─────────────────────┬────────────────────┘
             │                     │
             ▼                     ▼
     ┌──────────────┐     ┌──────────────┐
     │   Chart UI    │     │  Claude Chat  │
     │  (overlays)   │     │  (data tools) │
     └──────────────┘     └──────┬───────┘
                                  │
                          ┌──────▼───────┐
                          │    Convex     │
                          │  (linkage +   │
                          │   prefs)      │
                          └──────────────┘

  Backtesting (separate page):
    /backtesting ──→ ClickHouse (direct analytical queries)
```

---

## 6. Chart Rendering

Structure elements are **computed overlays**, not Convex drawings. They are
rendered using TradingView Lightweight Charts v5 custom primitives.

### Primitives

| Primitive | File | What it renders |
|-----------|------|-----------------|
| Swing labels | `SwingLabelsPrimitive.ts` | HH / HL / LH / LL / EQH / EQL labels at swing points |
| BOS/MSS lines | `BOSLinesPrimitive.ts` | Dashed horizontal lines from broken swing to confirming candle |
| FVG zones | `FVGZonesPrimitive.ts` | Semi-transparent rectangular fills with midline |
| Premium/Discount | `PremiumDiscountPrimitive.ts` | Background shading for premium/discount/equilibrium zones |
| Key levels | LineSeries + labels | PDH/PDL/PWH/PWL/PMH/PML horizontal lines |

### BOS/MSS Line Rendering Details

- Line starts at the **broken swing's timestamp** and ends at the **confirming
  candle's timestamp** (not the chart right edge).
- Label text: `"BOS"` or `"MSS"`, centered on the line midpoint.
- Label has a dark background pill for readability.
- Color: green for bullish break, red for bearish break.
- Active BOS: 0.7 opacity. Reclaimed BOS: 0.25 opacity (faded).
- If timeframe suffix is provided, it appears on a second line below the label.

### Toggle System

Sidebar controls (in `ChartSidebar.tsx`) for each overlay type:
- Swing labels on/off
- BOS lines on/off (with BOS/MSS sub-filter)
- FVG zones on/off (with tier filter: T1/T2/T3)
- Premium/Discount shading on/off
- Key levels on/off

User preferences stored in Convex (`structurePrefs` table) and applied on load.

### Data Flow: DB to Chart

```
Chart visible range changes
  → useStructure hook detects new range
  → Fetches /api/structure/[pair]?timeframe=H4&start=X&end=Y
  → API reads from TimescaleDB + live tail
  → Hook updates primitive data arrays
  → Primitives re-render on the canvas
```

With pre-computed structure, scrolling back simply triggers a new time-range
query. No depth limit. No gap where structure disappears.

---

## 7. Claude Integration

### Data Tools (6 Tools, All Server-Side)

| Tool | Purpose | With pre-computed model |
|------|---------|------------------------|
| `get_structure` | Full structure for pair/TF | Queries DB with time range — full history available |
| `get_active_fvgs` | Fresh/partial FVGs with fill %, tier, confluence | Reads from `fvg_events` WHERE status IN ('fresh','partial') |
| `get_bos_history` | Recent BOS/MSS events with enrichment | Reads from `bos_events` — can go back months |
| `get_mtf_score` | Composite score (-100 to +100) with per-TF breakdown | Computed from stored structure across all TFs |
| `get_premium_discount` | All 3 tiers, alignment count, depth % | Computed from stored swing points |
| `get_key_levels` | Current level grid with distance from price | Reads from `key_levels` table |

### What Changes with Pre-Computed Structure

In v1, Claude's tools call the same API that computes structure on-demand with a
fixed candle depth. Claude can only see ~5 days of M15 structure.

In v2, Claude's tools query TimescaleDB (30 days) or ClickHouse (years). Claude
can answer:

- "Show me all MSS events in the last 3 months on EUR/USD H4"
- "How many times did price respect the H4 FVG midline in Q3 2024?"
- "What was the BOS follow-through rate during high-COT-divergence weeks?"

The tools executor in `src/app/api/chat/data-tools.ts` will be updated to accept
optional time range parameters and route to the appropriate database.

---

## 8. Backtesting Page (Planned)

### Why a Separate Page

Backtesting is **analytical** — it produces tables, statistics, distribution
charts, heatmaps, and equity curves. It is not a visual price-chart experience.
Cramming backtesting into the chart page would bloat the UI and conflate two
different workflows (ADR-016).

### Architecture

```
/backtesting route
  → Query builder UI (pair(s), TF(s), date range, entity type, filters)
  → API: /api/backtesting/query
  → ClickHouse (direct analytical queries against structure tables)
  → Results rendered as tables, charts (Recharts), heatmaps
```

### Example Queries

- "FVG respect rate by quarter across all pairs for 5 years"
- "BOS follow-through rate when COT net positioning agrees with direction"
- "Average pips to FVG midline touch, grouped by session (London/NY/Asia)"
- "Win rate of MSS entries with >70 MTF score alignment, 2022-2025"
- "Seasonal bias: monthly directional tendencies per pair"

### Data Requirements

All of these queries are only possible because structure is pre-computed and
stored in ClickHouse. The materialized views (`mv_fvg_effectiveness`,
`mv_bos_follow_through`, etc.) pre-aggregate common query patterns for
sub-second response times.

---

## 9. Migration Path (v1 to v2)

### Phase 1: Schema + Backfill

1. Run migration 019 (add `bos_type` column to existing tables)
2. Run historical backfill job: ClickHouse candles → structure in ClickHouse
3. Seed TimescaleDB with last 30 days of structure from ClickHouse

### Phase 2: Worker Writes

1. Add LTF structure computation jobs to the worker (M15/H1/H4 on candle close)
2. Worker starts writing structure to TimescaleDB on each candle close
3. Worker archives confirmed structure to ClickHouse daily
4. Existing HTF jobs (`htf-structure-precompute.ts`) continue as-is

### Phase 3: API Reads from DB

1. Update `/api/structure/[pair]` to accept `start`/`end` query params
2. API reads stored structure from TimescaleDB for the requested range
3. API computes live tail for unconfirmed candles and merges
4. Remove fixed candle depth logic
5. Remove short-TTL cache (no longer needed — DB is the source of truth)

### Phase 4: Claude + Backtesting

1. Update data tools executor to pass time ranges to structure queries
2. Build `/backtesting` route with ClickHouse query builder
3. Build materialized views for common backtesting patterns

---

## 10. ADR Reference

| ADR | Status | Summary |
|-----|--------|---------|
| ADR-004 | **Superseded by ADR-019** | API route as primary computation path |
| ADR-008 | Active | ClickHouse for historical pattern discovery |
| ADR-014 | **Superseded by ADR-019** | Worker pre-computes HTF only, API computes LTF |
| ADR-015 | Active | Structure as computed overlays, not Convex drawings |
| ADR-016 | Active | Backtesting as separate page, not chart interface |
| ADR-019 | **Active (NEW)** | Pre-computed stored structure for ALL timeframes |

### ADR-019: Pre-Computed Stored Structure

**Decision**: Worker computes structure for all timeframes as candles arrive.
Results are stored in TimescaleDB (hot, 30 days) and ClickHouse (cold, full
history). API reads from the database instead of computing on-demand.

**Supersedes**: ADR-004 (API as primary), ADR-014 (HTF-only pre-compute).

**Reasoning**:

1. Structure is deterministic — same candles always produce same results.
   Recomputation on every API request is wasteful.
2. Pre-computed model enables unlimited scroll-back on the chart. Structure
   goes as far back as the database has data.
3. Claude gets full history access — months of structure instead of days.
4. Backtesting becomes possible — query years of stored structure in ClickHouse.
5. Mental model matches TradingView PineScript: structure "just exists" on all
   loaded candles. No computation delay, no depth cutoff.

**Trade-off**: Worker complexity increases (must handle all TFs, diffing, upserts).
But this complexity is bounded and well-understood — candle ingestion pipelines
are a solved pattern.
