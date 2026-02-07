# Market Structure — User Stories, Claude Stories & Backtesting

> Why we build everything. Each story is a concrete scenario that drives architecture decisions.

---

## 1. User Stories (The Human Trader)

### US-1: "I want to see market structure on my chart"

- Trader opens EUR/USD H4 chart
- Sees swing labels (HH, HL, LH, LL, EQH, EQL) on every significant swing point
- Sees dashed BOS/MSS lines showing where structure broke (and whether it's continuation or reversal)
- Can toggle overlays on/off from sidebar
- **Status: BUILT (Phase 1)**

### US-2: "I want structure to persist when I scroll back"

- Trader scrolls back 3 months on H4
- ALL swings, BOS, MSS events visible — not just the last 500 candles
- Like TradingView: structure labels are just THERE on every candle
- Requires pre-computed stored structure (worker computes, DB stores, chart queries by time range)
- **Status: NEXT (Phase 4 — pre-computed architecture)**

### US-3: "I want to see FVG entry zones"

- Trader sees semi-transparent FVG boxes with midlines
- Color indicates direction, opacity indicates fill status
- Tier filter: show only high-volume FVGs for cleaner chart
- Can see which FVGs are nested inside HTF FVGs (confluence)
- **Status: BUILT (Phase 2)**

### US-4: "I want to know if price is cheap or expensive"

- Premium/discount background shading on chart
- Green tint = discount (favor longs), red tint = premium (favor shorts)
- Multiple tiers (H4, D1, W1, Yearly, Macro) — when 3+ align = deep premium/discount
- **Status: BUILT (Phase 2)**

### US-5: "I want to know how significant a BOS is"

- Trader sees a bearish BOS on H4
- Enrichment tells them: it also broke PDL, COT is bearish, MTF score -62, significance 82/100
- This isn't just "price went down" — it's "this is a high-conviction structural shift"
- **Status: BUILT (Phase 3)**

### US-6: "I want my trades linked to structure"

- Open a trade short because of bearish MSS + FVG retest in premium zone
- Trade record links to: the MSS event, the FVG, the premium zone, the MTF score
- When reviewing, see exactly WHY you entered — not just the price
- When thesis_broken (BOS level reclaimed), know exactly WHAT broke
- **Status: PLANNED (Phase 5)**

### US-7: "I want to backtest structure-based strategies"

- Go to /backtesting page
- Query: "H4 FVG retest entries in discount with COT alignment over 5 years"
- See: 68% win rate, avg +1.2R, better in Q1, worse in Q4
- Discover: nested FVGs (3+ TFs) have 78% win rate
- **Status: PLANNED (Phase 4-5)**

### US-8: "I want to see BOS vs MSS clearly"

- BOS = continuation (market keeps going same direction) — labeled "BOS" on chart
- MSS = market structure shift / reversal — labeled "MSS" on chart
- Both are dashed lines from broken swing to confirming candle (not extending to right edge)
- Green for bullish, red for bearish, faded for reclaimed
- **Status: BUILT**

---

## 2. Claude Stories (The AI Analyst)

### CS-1: "Claude gives precise structure analysis"

Claude: "Looking at EUR/USD H4:
- Bearish MSS confirmed at 14:30 — broke 1.0850 (was also PDL)
- Fresh Tier 1 FVG at 1.0860-1.0845 from that move
- MTF score: -62 (moderate bearish alignment)
- You're in H4 premium but Daily discount — mixed signal
- COT: leveraged money net short (73rd percentile)

If price retests the FVG, that's high-confluence short. But Daily discount says this might just be a pullback."

### CS-2: "Claude queries full structure history"

User: "How many MSS events have there been on EUR/USD H4 in the last 3 months?"

Claude uses `get_bos_history` tool, queries stored structure from DB, returns:
"14 MSS events in the last 3 months. 9 were reclaimed within 24h. 5 held and became new trends. The ones that held all had MTF score > 50."

### CS-3: "Claude references specific entities"

Claude: "Your short entry on trade #47 was at the FVG retest (1.0852) created by the bearish MSS at 14:30. Good entry — this FVG is nested inside a Daily bearish FVG AND overlaps with what was PDL. Only risk: PWL at 1.0810 is 42 pips away, consider that as TP1."

### CS-4: "Claude identifies patterns in your trading"

Claude: "Looking at your last 20 trades:
- Trades at BOS-created FVG retests: 68% win rate, avg +1.2R
- Trades WITHOUT FVG retest: 41% win rate, avg +0.3R
- Counter-trend trades with MTF > 50: 29% win rate — consider avoiding these
- Your edge is clearest when: MSS + FVG + COT alignment + discount zone = 78% win rate"

### CS-5: "Claude uses seasonal context"

Claude: "EUR/USD has been bearish in Q1 for 7 of the last 10 years. Current Q1 + MTF bearish + COT bearish = strong confluence for shorts. However, weekly structure shows we're near the Previous Yearly Low at 1.0750 — historically bounces 70% of the time. Suggest tighter stops below YL."

---

## 3. Backtesting Use Cases

### BT-1: FVG Effectiveness

- "What % of H4 bullish FVGs get respected (bounce at 50% or less fill)?"
- "FVGs with parent BOS: 68% respected. Standalone: 51%."
- "FVGs overlapping PDL/PDH: 75% respected (confluence boost)."
- "FVGs in discount zone: 70% respected. Premium: 55%."

### BT-2: BOS Follow-Through

- "After Monthly bearish BOS on EUR/USD: 65% continuation, avg 450 pips over 3 months"
- "Same-session BOS reclaim rate by pair: EUR/USD 40% (choppy), GBP/JPY 25% (trending)"
- "BOS breaking YL: avg 180 pip bounce within 2 weeks, 70% of the time"

### BT-3: Seasonal Patterns

- "EUR/USD bearish Q1: 7/10 years. GBP/USD bullish Q4: 8/10 years."
- "London session BOS follow-through: 72%. Sydney: 45%."
- "FVGs created during London, retested during NY: classic continuation setup — 74% respect rate."

### BT-4: Premium/Discount Effectiveness

- "Longs in H4 discount: 64% win rate. In premium: 38%."
- "Shorts in deep premium (3+ tiers): 71% win rate."
- "Trades at equilibrium: 48% — avoid."
- "Entries at 80%+ discount depth: 76% FVG respect rate."

### BT-5: Your Edge Discovery

- "Your trades with MSS + FVG + COT alignment: 78% win rate"
- "Your trades against MTF score: 29% win rate"
- "Counter-trend trades where BOS reclaimed within 4h: 85% losers"
- "Your best edge: MSS-created FVG retest in deep discount during London session"

---

## 4. The Full Vision

The system goes from:

1. **"I see a bearish candle"** (noise)
2. **"Bearish MSS broke PDL with displacement, MTF -62, COT agrees, price in premium"** (signal)
3. **"Historically this pattern continues 65%, except in Q4 which reverses 40%"** (edge)
4. **"Your personal win rate on this setup: 78%"** (personalized edge)

Every layer adds conviction. Nothing exists in isolation.
