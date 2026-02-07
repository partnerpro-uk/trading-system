# Market Structure Engine

> The connective tissue of the trading system. Detects market structure from raw candles and makes it available to chart, Claude, and backtesting.

## What This System Does

Answers one question: **What is the market doing right now, and how significant is what it's doing?**

Raw price data is noise without context. A candle closing below a swing low means nothing in isolation — but if that swing low is also the Previous Day's Low, COT positioning is bearish, and the Weekly timeframe confirms a downtrend, that's a high-conviction signal.

## Building Blocks

| Concept | What It Is | Why It Matters |
|---------|-----------|----------------|
| **Swing Point** | A local high or low where price reversed | The "joints" of structure — without accurate swings, everything downstream fails |
| **Zigzag Filter** | Enforces alternating H-L-H-L swing sequence | Eliminates noise (consecutive same-type swings) for clean structure |
| **Structure Label** | HH, HL, LH, LL, EQH, EQL classification | Tells us what the trend is doing right now |
| **BOS** | Break of Structure — body close beyond a prior swing | Confirmed shift in market behavior (continuation) |
| **MSS** | Market Structure Shift — BOS in opposite direction to previous | Confirmed reversal/change of character |
| **Sweep** | Wick through a level without body close | Liquidity grab — often a fake-out, NOT a structural break |
| **FVG** | Fair Value Gap — 3-candle imbalance zone | Institutional entry zones where price has unfinished business |
| **Key Level** | Daily/Weekly/Monthly/Yearly H/L | Gives BOS events their significance rating |
| **Premium/Discount** | Position relative to swing range equilibrium | Determines whether price is cheap or expensive |
| **MTF Score** | Multi-timeframe direction composite (-100 to +100) | The difference between a pullback and a reversal |

## Two Consumers, Same Truth

1. **The human trader** — visual labels on chart, dashed BOS/MSS lines, FVG zones, confluence indicators
2. **Claude** — structured data with timestamps, coordinates, and cross-referenced context for analysis

Both see the same computation. Both get the same data.

## Documentation Map

| Document | What It Covers | Read When |
|----------|---------------|-----------|
| [concepts.md](concepts.md) | Swings, zigzag, labeling, BOS/MSS, sweeps, displacement, reclaim | Working on detection algorithms |
| [fvg-levels.md](fvg-levels.md) | FVGs, key levels, premium/discount zones | Working on price-level features |
| [scoring.md](scoring.md) | MTF scoring, BOS enrichment, counter-trend, interconnection | Working on significance/confluence |
| [architecture.md](architecture.md) | Pre-computed model, DB design, worker, API, hot/cold lifecycle, rendering | Building infrastructure or data flow |
| [stories.md](stories.md) | User stories, Claude stories, backtesting use cases | Understanding why we build what we build |

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Swings, BOS/MSS, sweeps, key levels, zigzag filter | **Built** |
| Phase 2 | FVGs, premium/discount, chart primitives | **Built** |
| Phase 3 | MTF scoring, BOS enrichment, counter-trend, Claude tools | **Built** |
| Phase 4 | Pre-computed structure (worker for all TFs), historical backfill | **Next** |
| Phase 5 | Trade linkage, snapshot integration, full ClickHouse backtesting | Planned |

## Code Map

| Location | Purpose |
|----------|---------|
| `lib/structure/` | Pure computation library (types, swings, zigzag, labeling, bos, sweeps, key-levels, fvg, premium-discount, mtf-scoring, counter-trend, bos-enrichment) |
| `lib/structure/index.ts` | Orchestrator — `computeStructure()` (12 steps), `deriveCurrentStructure()`, `detectFilteredSwings()` |
| `lib/db/structure.ts` | TimescaleDB upsert/query (swings, BOS, sweeps, key levels, FVGs, HTF structure) |
| `lib/db/clickhouse-structure.ts` | ClickHouse archive queries |
| `src/app/api/structure/[pair]/route.ts` | Structure API endpoint |
| `src/components/chart/BOSLinesPrimitive.ts` | BOS/MSS line renderer (LW Charts primitive) |
| `src/components/chart/FVGZonesPrimitive.ts` | FVG zone renderer |
| `src/components/chart/PremiumDiscountPrimitive.ts` | Premium/discount background shading |
| `src/components/chart/SwingLabelsPrimitive.ts` | Swing label renderer |
| `worker/src/htf-structure-precompute.ts` | Worker: HTF structure every 4h |
| `worker/src/fvg-fill-tracker.ts` | Worker: FVG fill updates every 5min |
| `worker/src/macro-range-updater.ts` | Worker: macro ranges every 24h |

## Core Principle

**Nothing exists in isolation.** Every piece of data we collect (candles, news, COT, session times, key levels) informs and enriches every other piece. The structure engine is the connective tissue.
