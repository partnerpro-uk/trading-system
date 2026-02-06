# AI-Augmented Forex Trading System

## Vision Document

---

## The Core Idea

Build a forex trading platform where Claude acts as an analytical co-pilot — not to "predict" markets, but to identify pattern confluence, assess trade setups against historical performance, and provide reasoned analysis that a human trader can act on.

The system watches candles form in real-time, maintains a comprehensive trade log, and can reference years of backtested data to answer questions like: *"Based on the last 15 winning trades with similar setups, what's the probability profile of this current formation?"*

This isn't algorithmic trading. It's **augmented discretionary trading** — keeping the human in the loop while offloading pattern recognition and historical analysis to AI.

---

## Why This Matters

### The Problem with Current Tools

**TradingView** is powerful but siloed:
- PineScript can't call external APIs
- No way to inject AI analysis into the chart
- Alerts can trigger webhooks out, but nothing can come back in
- Drawing tools are manual — AI can't programmatically mark zones

**Existing "AI trading" tools** are either:
- Black boxes that claim to predict markets (they can't)
- Simple signal generators without reasoning
- Unable to learn from *your* specific trading history

### The Opportunity

Build a system where:
- Every indicator value is data you control and can feed to Claude
- Claude can explain *why* it flagged something, not just *that* it did
- Your historical trades become training context for future analysis
- The AI can literally draw on your chart — marking zones, levels, and signals

---

## Why This Can Actually Build Edge

### The Reality of Trading Edge

Edge isn't about predicting the future. It's about:
- Taking setups where probability favors you (even 55% is enough)
- Managing risk so losses are smaller than wins
- Being consistent enough for the probabilities to play out
- Eliminating emotional/impulsive decisions

This system addresses ALL of these.

### What You'd Have That Most Retail Traders Don't

| Most Traders | This System |
|--------------|-------------|
| Vague memory of past trades | Every trade logged with full context |
| "I think this pattern works" | Statistical proof across 1000s of examples |
| Emotional recall bias | Objective data on what actually wins |
| Manual journaling (nobody does it) | Automatic capture of everything |
| Gut feel on confluence | Quantified confluence scoring |
| Forget losing patterns | System remembers and warns you |

### The Compounding Effect

After 6 months of logging every trade with full context, you can ask:

> "What's my win rate on EUR/USD shorts during London session when RSI is above 70 and there's a 4H bearish engulfing?"

And get an actual answer based on YOUR data, YOUR execution, YOUR style.

**That's not gambling. That's edge.**

### What Claude Brings That's Genuinely New

Most traders fail at journaling because it's tedious. They fail at pattern recognition because human memory is unreliable. They fail at objectivity because emotions cloud judgment.

Claude:
- Never gets tired of logging
- Has perfect recall of 10,000 trades
- Doesn't get excited or scared
- Can spot patterns across massive datasets
- Can challenge your reasoning without ego

The mental model: **"I see this, what do you see?"** — forcing yourself to articulate your thesis and get an objective second opinion with access to your complete history.

---

## Key Capabilities

### 1. Live Chart with AI Overlays

Watch a 15-minute candle form in real-time. As it develops, Claude can:
- Mark supply/demand zones it identifies
- Draw support/resistance levels
- Highlight when your strategy criteria are being met
- Show probability zones based on historical similar setups

These aren't static drawings — they update as new data arrives.

### 2. Conversational Analysis

Ask natural questions:

> "This looks like a head and shoulders on the 4H. How have similar patterns played out in my backtest data?"

> "I'm seeing bullish divergence on RSI while price is at a key level. What's the win rate on this setup historically?"

> "Show me the last 10 trades where I entered on a break of structure after a sweep."

Claude has access to your complete trade history and can reason about it.

### 3. Strategy as Data

Your trading strategy is defined as structured JSON:

```json
{
  "name": "Break of Structure + Liquidity Sweep",
  "timeframe": "15m",
  "conditions": {
    "entry": [
      { "type": "liquidity_sweep", "direction": "below", "lookback": 20 },
      { "type": "break_of_structure", "direction": "bullish" },
      { "type": "indicator", "name": "RSI", "condition": "crosses_above", "value": 30 }
    ],
    "confluence": [
      { "type": "higher_timeframe_trend", "timeframe": "4H", "direction": "bullish" },
      { "type": "key_level_proximity", "tolerance": "10_pips" }
    ]
  },
  "risk": {
    "stop_loss": "below_sweep_low",
    "take_profit": { "type": "risk_multiple", "value": 2 }
  }
}
```

Claude reads this and evaluates setups against it. You can A/B test strategy variations.

### 4. Backtesting with Context

Run a strategy against years of historical data. But unlike traditional backtests that just give you a win rate, this system:
- Logs every simulated trade with full context
- Allows Claude to analyze *why* certain setups worked or failed
- Identifies which market conditions favor your strategy
- Finds patterns in your losing trades

### 5. Trade Journal That Learns

Every trade (live or simulated) is logged with:
- Entry/exit timestamps and prices
- All indicator values at entry
- Screenshot-equivalent data (candle context)
- Your notes and tags
- Outcome and metrics

Over time, this becomes a rich dataset for Claude to reference.

### 6. Live Setup Detection

Three modes of operation:

**Alert Mode** — System continuously scans. When your criteria hit threshold:

> **Setup Alert: EUR/USD**
> - ✅ London swept Asia high (10 mins ago)
> - ✅ Break of structure on 15m
> - ✅ Unfilled FVG at 1.0842
> - ✅ DXY at 4H resistance
> - ⚠️ NFP in 3 hours
> 
> **Historical match:** 34 similar setups, 67% win rate

**Query Mode** — You ask, system answers:

> **You:** "Anything setting up on EUR/USD?"
> 
> **Claude:** "Not a full setup yet. London swept Asia low but no break of structure. Price is approaching an unfilled 1H FVG from yesterday at 1.0856. If we get a BOS on the next 15m candle close, that would match your criteria."

**Ambient Mode** — Overlays on the chart updating in real-time showing partial condition matches.

---

## Trade Snapshots — Data-Rich Chart State Capture

**Implemented.** Every key moment in a trade's lifecycle is captured as a structured data snapshot — not a pixel screenshot, but the raw data behind the chart: viewport, drawings, trade context, and AI description. Enough to reconstruct a read-only chart replay and give Claude structured analysis data.

### What a Snapshot Contains

Each snapshot stores:
- **Visible range** — Exact candle timestamps at viewport edges
- **Filtered drawings** — Only drawings relevant to this trade and viewport (immutable JSON copy)
- **Trade context** — Entry/SL/TP prices, current price, P&L pips, distance to targets
- **AI description** — Pre-computed natural language describing drawings, key levels, and trade state
- **Moment label** — `setup`, `entry`, `during`, or `exit`
- **Metadata** — Pair, timeframe, timestamp, strategy, notes

### How Snapshots Are Captured

**Auto-capture (fire-and-forget):**
- **On trade entry** — When a position drawing creates a Convex trade, an "entry" snapshot fires automatically
- **On trade close** — When TP/SL is hit and the trade closes, an "exit" snapshot fires automatically

**Manual capture:**
- Camera button on the Live Position Panel during an open trade
- Creates a "during" snapshot with current viewport state

### Drawing Filter — What Gets Included

Not every drawing on the chart belongs in a snapshot. Three criteria (union, deduped by ID):

1. **Trade-linked** — Drawings explicitly associated with the trade (`drawing.tradeId`)
2. **Time-correlated** — Drawings created between trade creation and snapshot time
3. **Viewport-intersecting** — Drawings whose anchors overlap the visible time range
   - Horizontal lines always included (infinite span)
   - Extended zones included if they reach into the viewport
   - Position drawings included if entry timestamp is in range

Old off-screen drawings from days ago are excluded. Extended zones that stretch into today's analysis are included.

### Snapshot Replay

Each snapshot can be replayed in a read-only Lightweight Chart:
- Fetches candles for the stored visible range (with padding for context)
- Renders the filtered drawings on a canvas overlay
- Shows trade markers: entry line (white), SL line (red dashed), TP line (green dashed)
- Moment label badge and P&L display
- No interaction — scroll/zoom disabled, purely for review

### AI Description Format

Claude doesn't look at visual screenshots. Instead, each snapshot's `aiDescription` field contains structured text:

```
=== Trade Snapshot: ENTRY ===
GBP/USD LONG | Entry: 1.36699, SL: 1.36476, TP: 1.36923
Current: 1.36850 | P&L: +15.1 pips | TP: 7.3 pips away | SL: 37.4 pips away

Drawings (8):
  - fibonacci retracement (7 levels) from 1.36200 to 1.36900
  - blue rectangle zone "London Kill Zone" from 1.36400 to 1.36600
  ...

Key Levels:
  1.36923 — Take Profit (7.3 pips above)
  1.36900 — Fib 0% (5.0 pips above)
  ...
```

This reuses the existing `describeAllDrawings()` and `extractKeyLevels()` functions from the drawing description system, extended with trade context.

### Trade Detail Modal

Clicking a trade in the journal opens a detail modal with:
- **Trade summary** — 7 stat cards (entry, exit, SL, TP, P&L, R-multiple, duration)
- **Snapshot timeline** — Horizontal scrollable cards showing each captured moment
- **Replay viewer** — Read-only chart rendering the selected snapshot
- **AI analysis** — Toggle to show/hide the pre-computed description

### Dual-Layer Capture

The snapshot system implements both layers of trade capture:

**Human Layer (Visual + Contextual)**
- Drawings, zones, levels as they appeared at capture time
- Notes attached to snapshots
- Manual "during" snapshots capture your in-the-moment view

**Machine Layer (Technical + Queryable)**
- Raw OHLCV data reconstructed from stored visible range
- Drawing coordinates as structured JSON
- Trade context with exact pip calculations
- AI descriptions queryable by Claude for pattern analysis

**Both layers linked by trade ID.** Claude can analyze the machine layer across thousands of trades while you review the visual replay of any specific moment.

---

## Snapshot Replay System

**Implemented.** Instead of recording live sessions, the system captures data-rich snapshots at key moments and reconstructs read-only chart replays from stored data.

### How Replay Works

Each snapshot stores enough metadata to reconstruct the exact chart view:

1. Fetch candles from the database for the snapshot's stored visible range (with 20% padding)
2. Create a read-only Lightweight Chart instance (no scroll/zoom)
3. Render the filtered drawings on a canvas overlay
4. Overlay trade markers (entry, SL, TP price lines)
5. Display moment label, P&L, and timestamp

No recording needed — candles already exist in TimescaleDB/ClickHouse. Snapshots are just bookmarks.

### Trade Detail Modal Experience

From the trades journal:

1. Click a trade row or camera icon to open the detail modal
2. See trade summary: entry, exit, SL, TP, P&L, R-multiple, duration, session
3. Browse the snapshot timeline — horizontal cards for each captured moment (entry, during, exit)
4. Click a snapshot card to load that moment into the replay viewer
5. Toggle AI analysis to see Claude's structured description of what was on the chart

### Future: Training Content

After months of auto-captured snapshots:

- Every trade has entry + exit snapshots automatically
- Manual "during" snapshots capture mid-trade analysis
- Claude can reference snapshot AI descriptions across your trade history
- Pattern analysis: "Show trades where fibonacci retracement was present at entry"

---

## Edge Data Architecture

This is the data that separates this system from what retail traders do manually. Every data point is automatically calculated, stored, and queryable.

### Session Liquidity Levels
- Asia/London/NY highs and lows
- Sweep tracking (did London sweep Asia high?)
- Time of high/low formation
- Range calculations

### Higher Timeframe Levels
- Weekly, monthly, quarterly, yearly OHLC
- Previous period highs/lows
- Confluence detection when price approaches multiple levels

### Candle Velocity & Formation Speed
- Time to high/low within each candle
- Peak velocity (fastest move)
- Body percentage
- Displacement scoring

### Fair Value Gap Tracking
- Auto-detection on formation
- Displacement velocity that created it
- Fill tracking (filled, partially filled, unfilled)
- Outcome when traded from

### Liquidity Sweep Events
- What level was swept
- How far price exceeded it
- Velocity of the sweep
- Whether reversal followed

### Time-Based Patterns
- Day of week statistics
- Session behavior patterns
- Kill zone activity
- When weekly high/low typically forms

### DXY Correlation
- Dollar Index state at trade entry
- Trend alignment across timeframes
- Divergence detection

### News Event Tracking
- Forecast vs actual vs previous
- Initial spike direction and velocity
- Reversal patterns post-news
- Your proximity to news at trade entry

### Trading Behavior
- Time since last trade
- Revenge trade detection
- Daily P&L context at entry
- Trade frequency patterns

### The Power of Combined Queries

> "What's my win rate on EUR/USD shorts during NY session, when London already swept Asia high, DXY is trending up on the 4H, there's no high-impact news within 2 hours, and it's not my first trade after a loss?"

That's not guesswork. That's edge, quantified.

---

## Future Vision: Strategy Lab

*Not MVP — a more complex layer for later.*

### The Concept

Multiple strategies run simultaneously in the background. You trade with your chosen strategy, but the others are shadow-tracking — monitoring what setups they would have caught, calculating their theoretical performance in current market conditions.

At review time, the system surfaces which strategy is actually performing best in the current market regime.

### Why This Matters

Markets have phases:
- **Trending weeks** — breakout strategies shine
- **Ranging/choppy weeks** — mean reversion works better
- **News-heavy weeks** — some strategies avoid entirely, others trade the aftermath
- **Low volatility** — tighter setups, smaller moves

No single strategy is optimal across all regimes. The question is: which of YOUR strategies fits the current environment?

### The Experience

**Weekly review:**

```
Your Active Strategy: "Sweep + FVG"
  Trades Taken: 4
  Result: 2W 2L, +1.2R total
  
Shadow Performance This Week:
  
  🥇 "News Fader" — Would have been: 3W 1L, +4.1R
     ↑ Outperformed in news-heavy environment
     
  🥈 "Conservative HTF" — Would have been: 2W 0L, +3.8R  
     ↑ Fewer trades but higher quality

Claude's Recommendation:
"This was a news-heavy week and your active strategy underperformed. 
Consider switching to 'News Fader' when calendar shows 2+ red folder events."
```

### The Compound Learning

After 6-12 months, you've built a **meta-strategy**: a system that tells you which strategy to use when, based on YOUR data and YOUR execution.

---

## User Experience Vision

### Morning Routine

1. Open the app, see your watchlist pairs
2. Each pair shows: current price, any active setups Claude has flagged, distance to key levels
3. Click into EUR/USD — chart loads with your saved drawings + Claude's new annotations
4. Small badge: "2 potential setups identified overnight"
5. Click to see Claude's analysis of each

### During a Trade Setup

1. You spot something interesting on the chart
2. Click "Analyze" or just ask: "What do you see here?"
3. Claude responds with:
   - Does this match your strategy criteria? (checklist)
   - Historical similar setups and outcomes
   - Key levels above/below
   - Risk/reward at different TP targets
4. You decide to take the trade
5. Click "Log Entry" — system captures all context automatically

### After a Trade Closes

1. Trade auto-logged with outcome
2. Claude adds it to the historical dataset
3. You can add notes: "Took this despite X being missing — worked because Y"
4. These notes become context for future analysis

### Weekly Review

1. "Show me all trades this week"
2. Claude summarizes: 7 trades, 5 wins, key patterns in the losses
3. "Your losses this week all had X in common — consider adding this filter"
4. You update strategy JSON, backtest the change, compare results

---

## What This Is and Isn't

**This IS:**
- ✅ A legitimate edge-building tool
- ✅ A system that compounds your learning over time
- ✅ A way to prove (or disprove) whether your setups actually work
- ✅ An objective second opinion with perfect memory
- ✅ A professional-grade journaling system that actually gets used
- ✅ The kind of infrastructure prop firms build internally

**This is NOT:**
- ❌ An algo that trades for you (human stays in the loop)
- ❌ A system that "predicts" markets (probability ≠ prediction)
- ❌ A replacement for learning to trade
- ❌ Magic (it requires you to actually trade and log consistently)

The difference from scammy "AI trading" tools: this doesn't claim to know the future. It helps you understand your own patterns, validate your edge with data, and stay consistent. That's how serious traders actually make money — slowly, systematically, with evidence.

---

## Claude's Role — Defined Clearly

### What Claude Does

1. **Pattern Recognition** — "This candle structure matches the X pattern you've defined"
2. **Historical Lookup** — "In your backtest, this setup appeared 47 times with 62% win rate"
3. **Confluence Assessment** — "3 of your 5 entry criteria are met, missing X and Y"
4. **Risk Calculation** — "Based on your rules, SL at X gives 1.5R to first TP"
5. **Reasoning** — "I flagged this because... Here's what's different from the losing examples..."

### What Claude Does NOT Do

1. **Predict price direction** — No one can do this reliably
2. **Make trading decisions** — Human always decides
3. **Execute trades automatically** — This is augmented discretion, not algo trading
4. **Guarantee outcomes** — Historical patterns don't guarantee future results

---

## Latency Expectations

For 15/30 minute timeframe trading:

| Operation | Expected Time |
|-----------|---------------|
| Tick updates on chart | ~100-500ms |
| Candle close detection | Real-time |
| Claude analysis request | 3-8 seconds |
| Historical lookup | ~200ms |
| Full backtest (1 year, 1 pair) | ~30-60 seconds |

This is not HFT. Seconds matter, milliseconds don't.

---

*Document Version: 1.1 — Vision*
*Last Updated: February 2026*
