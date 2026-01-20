# Pre-Migration State Audit

**Date:** January 2026
**Purpose:** Document current Convex state before triple-DB migration

---

## Current Database: Convex

### Tables & Estimated Counts

| Table | Count | Notes |
|-------|-------|-------|
| `candles` | ~7.8M+ | All pairs, M5/M15/M30/H1/H4/D/W/MN |
| `economicEvents` | ~18,866 | 2012-2026 news events |
| `eventCandleWindows` | ~303,000 | 52% uploaded (580k total in JSONL) |
| `eventPriceReactions` | ~578,777 | Fully uploaded |
| `eventTypeStatistics` | ~3,843 | Fully uploaded |
| `sessions` | Calculated live | Not persisted (generated from candles) |

### Candle Distribution (Estimated)

| Pair | Timeframes | Years |
|------|------------|-------|
| EUR_USD | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| GBP_USD | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| USD_JPY | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| USD_CHF | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| AUD_USD | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| USD_CAD | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| NZD_USD | M5, M15, M30, H1, H4, D, W, MN | 2007-2026 |
| DXY | M15, M30, H1, H4, D, W, MN | 2015-2026 |

### Bandwidth Usage (Convex)

- Total bandwidth used: ~83GB
- Read bandwidth: ~76GB (mostly candle queries)
- Write bandwidth: ~7GB

---

## Data Files (Local/JSONL)

| File | Size | Status |
|------|------|--------|
| `data/windows.jsonl` | 2.16 GB | 580,193 windows |
| `data/reactions.jsonl` | ~100 MB | 578,777 reactions |
| `data/statistics.jsonl` | ~1 MB | 3,843 statistics |

---

## Migration Target State

### After Migration:

| Database | Tables | Est. Size |
|----------|--------|-----------|
| **Timescale** | candles (30d), news_events, reactions, sessions, fvgs, sweeps | ~500MB |
| **ClickHouse** | candles (historical), event_windows, statistics, backtests | ~4-5GB |
| **Convex** | users, trades, strategies, conversations, alerts | <100MB |

---

## Verification Queries (Run Post-Migration)

```sql
-- Timescale: Count candles by pair/tf
SELECT pair, timeframe, count(*) FROM candles GROUP BY pair, timeframe;

-- Timescale: Count news events
SELECT count(*) FROM news_events;

-- ClickHouse: Count historical candles
SELECT pair, timeframe, count(*) FROM candles GROUP BY pair, timeframe;

-- ClickHouse: Count event windows
SELECT count(*) FROM event_candle_windows;
```

---

## Git Checkpoint

- **Branch:** `feature/triple-db-migration`
- **Commit:** `94a99b2` (Pre-migration snapshot)
- **GitHub:** `https://github.com/partnerpro-uk/trading-system`
