# AI Trading System - User Stories

> Last Updated: January 2026 (v1.0)

A forex trading platform where Claude acts as an analytical co-pilot for augmented discretionary trading.

**Total Stories: 18** (15 Trader, 3 System)

---

## Table of Contents

1. [Role Definitions](#role-definitions)
2. [Trader User Stories](#trader-user-stories)
3. [System Stories](#system-stories)
4. [Feature Matrix](#feature-matrix)
5. [Current Implementation Status](#current-implementation-status)

---

## Role Definitions

| Role | Platform | Description |
|------|----------|-------------|
| Trader (T-) | Web Dashboard | Primary user - analyzes charts, views news, executes trades |
| System (S-) | Background | Automated processes - data sync, streaming, aggregation |

---

## Trader User Stories

### Chart & Visualization (T-CHART)

| ID | User Story | Acceptance Criteria | Status |
|----|------------|---------------------|--------|
| T-CHART-01 | As a trader, I want to view live forex charts so that I can analyze price action in real-time | Given I'm on the chart page, when price updates, then I see the latest candle update within 1 second | ✅ Done |
| T-CHART-02 | As a trader, I want to switch between currency pairs so that I can analyze multiple markets | Given I'm viewing EUR/USD, when I click GBP/USD in sidebar, then the chart switches to that pair | ✅ Done |
| T-CHART-03 | As a trader, I want to switch timeframes (M1, M5, M15, H1, H4, D1) so that I can analyze different time horizons | Given I'm on M15, when I select H1, then the chart reloads with hourly candles | ✅ Done |
| T-CHART-04 | As a trader, I want to see session backgrounds (London, NY, Asia) so that I can understand market context | Given sessions are enabled, when London session is active, then I see a colored overlay on that time range | ✅ Done |
| T-CHART-05 | As a trader, I want to see session high/low lines so that I can identify key levels | Given session lines are enabled, when a session completes, then I see horizontal lines at the high and low | ✅ Done |

### News Events (T-NEWS)

| ID | User Story | Acceptance Criteria | Status |
|----|------------|---------------------|--------|
| T-NEWS-01 | As a trader, I want to see news event markers on the chart so that I know when high-impact events occur | Given news is enabled, when I view a time with NFP release, then I see a colored marker at that timestamp | ✅ Done |
| T-NEWS-02 | As a trader, I want to click a news marker to see event details so that I can understand what happened | Given I click an event marker, when the panel opens, then I see actual/forecast/previous values | ✅ Done |
| T-NEWS-03 | As a trader, I want to see historical reactions to similar events so that I can anticipate price behavior | Given I click NFP marker, when panel loads, then I see how price reacted to past NFP releases | ✅ Done |
| T-NEWS-04 | As a trader, I want to see beat/miss classification so that I quickly understand if data surprised | Given event has actual and forecast, when I view the panel, then I see BEAT/MISS/INLINE badge | ✅ Done |
| T-NEWS-05 | As a trader, I want to see event statistics (avg spike, reversal rate) so that I can quantify typical reactions | Given I click an event, when statistics load, then I see average pip movement and direction bias | ✅ Done |
| T-NEWS-06 | As a trader, I want to see event definitions and context so that I understand what the data measures | Given I click CPI event, when panel loads, then I see a description of what CPI measures and typical impact | ✅ Done |
| T-NEWS-07 | As a trader, I want to see Fed speaker profiles so that I understand their policy stance | Given I click a Powell speech, when panel loads, then I see his stance (hawkish/dovish) and notable moments | ✅ Done |

### Analysis & Intelligence (T-ANALYSIS)

| ID | User Story | Acceptance Criteria | Status |
|----|------------|---------------------|--------|
| T-ANALYSIS-01 | As a trader, I want to ask Claude about current setups so that I get AI-assisted analysis | Given I'm viewing a chart, when I ask "what do you see?", then Claude analyzes the current price action | 🔜 Planned |
| T-ANALYSIS-02 | As a trader, I want Claude to mark zones on my chart so that I see AI-identified levels | Given Claude finds a supply zone, when it responds, then a zone appears on the chart | 🔜 Planned |
| T-ANALYSIS-03 | As a trader, I want to log trades with full context so that I build a personal trading database | Given I take a trade, when I log it, then the entry/exit, reasoning, and market context are saved | 🔜 Planned |

---

## System Stories

### Data Pipeline (S-DATA)

| ID | User Story | Acceptance Criteria | Status |
|----|------------|---------------------|--------|
| S-DATA-01 | As the system, I need to stream live prices from OANDA so that charts update in real-time | Given the streaming worker is running, when a price tick arrives, then M1 candles are updated within 100ms | ✅ Done |
| S-DATA-02 | As the system, I need to sync historical data to ClickHouse so that analytics queries are fast | Given 30+ day old candles exist, when sync job runs, then data moves to ClickHouse and is deleted from Timescale | ✅ Done |
| S-DATA-03 | As the system, I need to maintain event candle windows so that historical reactions are available | Given a news event occurred, when backfill runs, then M1 candles T-15 to T+90 are stored in ClickHouse | ✅ Done |

---

## Feature Matrix

| Feature | Trader | System |
|---------|--------|--------|
| View Charts | Full access | N/A |
| Switch Pairs/Timeframes | Full access | N/A |
| News Event Markers | Full access | Populates data |
| Historical Reactions | Full access | Computes stats |
| Event Definitions | Full access | Caches data |
| Speaker Profiles | Full access | Caches data |
| Claude Analysis | Planned | N/A |
| Trade Logging | Planned | N/A |
| Zone Drawing | Planned | N/A |

---

## Current Implementation Status

### Completed (v1.0)

**Chart Infrastructure**
- Live streaming charts with OANDA integration
- Multi-pair support (EUR/USD, GBP/USD, USD/JPY, etc.)
- Timeframe switching with candle cache
- Session backgrounds and high/low lines

**News Intelligence**
- Event markers on chart with impact coloring
- Event panel with actual/forecast/previous values
- Beat/miss classification
- Historical reaction display with settlement bars
- Event definitions knowledge base (436 economic + 167 speakers)
- Speaker profiles with stance and notable moments
- Statistics: avg spike, direction bias, reversal rate

**Data Architecture**
- Triple database: Convex (app state), TimescaleDB (live), ClickHouse (analytics)
- 87,783 historical news events
- 717,497 event candle windows
- 633,503 price reactions
- 4,435 event type statistics

### Planned (v2.0)

- Claude chat integration for trade analysis
- AI-drawn zones and levels on chart
- Trade logging and journaling
- Pattern recognition from personal trade history
- Confluence scoring

---

## User Journey Map

### News Event Analysis Flow

```
1. Trader views chart
   └─▶ Sees event marker (red/amber/gray by impact)

2. Clicks marker
   └─▶ Panel opens with:
       ├─ Event name, currency, time
       ├─ Actual / Forecast / Previous
       ├─ BEAT/MISS/INLINE badge
       └─ Short description

3. Reviews statistics
   └─▶ Expands to see:
       ├─ Avg spike (pips)
       ├─ Direction bias (% UP)
       ├─ Reversal rate
       └─ Sample size

4. Explores context (optional)
   └─▶ Expands "What This Means" to see:
       ├─ Beat/miss interpretations
       ├─ Currency impact
       └─ Trading notes

5. Reviews historical reactions
   └─▶ Scrolls to see:
       ├─ Past reactions with same outcome
       ├─ Spike direction and magnitude
       └─ Settlement price timeline
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | **Initial Stories**: Created 18 user stories covering chart, news, and system features. Documented current implementation status and planned features. |

---

## Notes

- This system is designed for **augmented discretionary trading**, not algorithmic trading
- Claude acts as an analytical co-pilot, not a trade signal generator
- All AI analysis should be used to inform human decisions, not replace them
- Historical data helps identify patterns but does not guarantee future results
