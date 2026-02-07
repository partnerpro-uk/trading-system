# Scoring, Enrichment & Interconnection

How structure entities gain meaning through multi-timeframe context, enrichment pipelines, counter-trend logic, and cross-entity linking.

---

## 1. Multi-Timeframe Direction Scoring

### The Problem

A single timeframe tells you very little. M15 bearish BOS while H4/D/W are all bullish is probably just a pullback. Trading that M15 BOS short without checking the bigger picture is how you fade strong trends and bleed slowly.

The MTF score collapses all timeframes into a single number that answers: **"Is the market aligned or conflicted right now?"**

### Weighted Timeframe Hierarchy

| Timeframe | Weight | Reasoning                                      |
| --------- | ------ | ---------------------------------------------- |
| Monthly   | 4      | Macro regime — takes months to shift           |
| Weekly    | 3      | Swing context — institutional timeframe        |
| Daily     | 2      | Session bias — most traders' anchor            |
| H4        | 1      | Intraday structure — execution-level detail    |
| H1        | 0.5    | Noise boundary — useful but low conviction     |

Higher timeframes carry more weight because they require more volume, time, and participation to shift. A Monthly BOS is a regime change. An H1 BOS might just be a stop hunt.

### Direction Per Timeframe

Each timeframe gets a direction score based on its most recent structural state:

| Score | Meaning       | Criteria                                  |
| ----- | ------------- | ----------------------------------------- |
| +1.0  | Strong bull   | Recent bullish BOS confirmed + HH/HL     |
| +0.5  | Weak bull     | HH/HL pattern but no recent BOS          |
|  0.0  | Ranging       | No clear directional bias                |
| -0.5  | Weak bear     | LL/LH pattern but no recent BOS          |
| -1.0  | Strong bear   | Recent bearish BOS confirmed + LL/LH     |

"Recent" is defined per timeframe — a Daily BOS from 5 days ago is recent; an H1 BOS from 5 days ago is ancient.

### Composite Score Calculation

```
Score = sum(tf_direction * tf_weight)
Normalized to -100 to +100
Max raw = 4 + 3 + 2 + 1 + 0.5 = 10.5
```

Example: Monthly bullish (+1.0 * 4), Weekly bullish (+1.0 * 3), Daily bearish (-1.0 * 2), H4 bearish (-1.0 * 1), H1 bearish (-1.0 * 0.5)

Raw = 4 + 3 - 2 - 1 - 0.5 = 3.5
Normalized = (3.5 / 10.5) * 100 = **+33**

Interpretation: higher timeframes still bullish, lower timeframes pulling back. Possible buying opportunity if structure holds.

### Interpretation Ranges

| Range         | Label               | Implication                                    |
| ------------- | ------------------- | ---------------------------------------------- |
| +70 to +100   | Strong bullish      | Full alignment — trend following long           |
| +40 to +69    | Moderate bullish    | Higher TFs agree, lower TFs may diverge         |
| +20 to +39    | Weak bullish        | Mixed signals, proceed with caution             |
| -19 to +19    | Neutral / Ranging   | No clear directional edge                       |
| -39 to -20    | Weak bearish        | Mixed signals, proceed with caution             |
| -69 to -40    | Moderate bearish    | Higher TFs agree, lower TFs may diverge         |
| -100 to -70   | Strong bearish      | Full alignment — trend following short           |

### Implementation

Code: `lib/structure/mtf-scoring.ts`

- `computeTFDirection(swings, bosEvents)` — derives direction for a single timeframe
- `computeMTFScore(allTimeframeData)` — aggregates across timeframes, returns normalized score
- Called by the structure orchestrator as Step 9 of the 12-step pipeline

---

## 2. Enriched BOS Events

### Core Idea

A raw BOS is a structural fact: "price closed below a level." That alone is not actionable. An enriched BOS adds context from every available data source, turning a structural event into a trading signal with a confidence rating.

Raw BOS:
> Bearish BOS at 1.0850 on H4

Enriched BOS:
> Bearish BOS broke PDL on H4, COT net short and increasing, NFP in 6 hours, MTF score -62, London session, significance 82/100

### Enrichment Pipeline

Each BOS event passes through six enrichment stages:

#### Stage 1 — Key Level Check

Does this BOS break a key level? The significance varies by level type:

| Level Broken | Implication                              |
| ------------ | ---------------------------------------- |
| PDH/PDL      | Intraday significance                    |
| PWH/PWL      | Swing significance                       |
| PMH/PML      | Macro significance                       |
| YH/YL        | Regime event — rare and high-impact      |

A BOS that breaks no key levels is just internal structure. A BOS through a weekly low is a different animal entirely.

#### Stage 2 — COT Alignment

Does institutional positioning (from CFTC Commitments of Traders data) agree with the BOS direction?

- Bearish BOS + net short COT + increasing shorts = **aligned**
- Bearish BOS + net long COT = **divergent** (caution)
- No recent COT data = **neutral** (no penalty, no bonus)

#### Stage 3 — News Proximity

Are there high-impact economic events within a +/- 2 hour window?

- BOS 5 minutes after NFP = news-driven, high significance
- BOS during quiet Asian session = structure-driven, lower noise risk
- BOS 30 minutes before FOMC = dangerous, may reverse

#### Stage 4 — MTF Direction

The composite MTF score at the time of the break:

- BOS aligned with MTF score > +50 = high conviction
- BOS against MTF score = counter-trend, lower conviction

#### Stage 5 — Session Context

Which trading session was active? Ordered by significance:

1. **London / New York overlap** — highest volume, most reliable breaks
2. **London / New York solo** — strong volume
3. **Tokyo** — moderate, relevant for JPY/AUD pairs
4. **Sydney** — lowest volume, highest false break rate

#### Stage 6 — Significance Score

All factors combine into a weighted significance score from 0 to 100:

| Factor         | Weight | Reasoning                                  |
| -------------- | ------ | ------------------------------------------ |
| Timeframe      | 25%    | Higher TF BOS = more significant           |
| Key Levels     | 25%    | Breaking structure = meaningful            |
| COT Alignment  | 20%    | Institutional confirmation                 |
| MTF Direction  | 20%    | Trend alignment                            |
| Session        | 10%    | Volume/reliability context                 |

### Significance Thresholds

| Score   | Rating          | Action                                       |
| ------- | --------------- | -------------------------------------------- |
| 70-100  | High conviction | Strong structural shift, tradeable           |
| 40-69   | Moderate        | Valid signal, standard position sizing        |
| 0-39    | Low / Noise     | Likely noise, skip or reduce size heavily     |

### Implementation

Code: `lib/structure/bos-enrichment.ts`

- `enrichBOSEvents(bosEvents, context)` — runs all 6 stages, attaches enrichment data to each BOS
- Context includes: key levels, COT data, news events, MTF score, current session
- Called by the structure orchestrator as Step 10 of the 12-step pipeline

---

## 3. Counter-Trend Framework

### When Lower Timeframe Diverges from Higher Timeframe

Daily is bullish. H1 prints a bearish BOS. Is this a pullback into a buying opportunity, or the start of a reversal?

This is the most common ambiguity in structural analysis, and the counter-trend framework provides a decision tree for handling it.

### Decision Tree

```
IF MTF Score > +50 (or < -50 for bearish):
  → Likely pullback
  → Counter-trend trades valid but:
    - Reduced position size
    - Target HTF structure levels (not LTF targets)
    - Expect the LTF break to fail

IF MTF Score between +20 and +50:
  → Uncertain
  → Wait for confirmation before trading either direction
  → Look for price reaction at HTF key levels

IF MTF Score < +20 (or > -20 for bearish):
  → HTF may be changing direction
  → Look for Daily BOS to confirm the shift
  → Do not fade this move
```

### Counter-Trend Flag

Every BOS event gets an `isCounterTrend` boolean:

- `true` = this BOS direction opposes the composite MTF direction
- `false` = this BOS aligns with MTF direction

The flag is informational. It does not prevent trading — it provides context for position sizing and target selection.

### Connection to Trading & Journaling

The counter-trend framework directly ties to the `thesis_broken` close reason in the trade journal. Claude can analyze patterns:

> "8 counter-trend trades this month: 3 hit TP (avg +0.8R), 5 closed thesis_broken (avg -0.4R). Net: -0.4R. Consider waiting for MTF < +20 before taking counter-trend setups."

This feedback loop — structure analysis to trade to journal to review — is where the system compounds edge over time.

### Implementation

Code: `lib/structure/counter-trend.ts`

- `markCounterTrend(bosEvents, mtfScore)` — sets `isCounterTrend` on each BOS
- Called by the structure orchestrator as Step 11 of the 12-step pipeline

---

## 4. Interconnection Philosophy

### Core Principle

Nothing is independent. Every FVG, BOS, swing, key level, and sweep is a first-class entity that can be:

- **Referenced by ID** — unique identifiers for every structural entity
- **Linked to trades** — trade #47 references specific BOS, FVG, key level entities
- **Linked to each other** — FVGs born from BOS displacement, sweeps triggering BOS
- **Captured in snapshots** — frozen structural state at trade entry/exit
- **Queried historically** — full BOS history in ClickHouse, not just current state

This is not a charting overlay. It is a relational graph of market structure.

### Cross-Entity Links

#### FVG <-> BOS

Displacement BOS creates an FVG in the same move. When an FVG has a parent BOS, it becomes a **structural entry zone** — not just a gap, but an imbalance born from a confirmed shift.

- FVG without parent BOS = weak, likely just a fast candle
- FVG with parent BOS = strong, represents unfilled institutional flow

#### FVG <-> Key Levels

An FVG that overlaps a key level (PDL, PWH, etc.) creates **double confluence**. Price returning to fill the FVG also tests the key level, concentrating orders and increasing the probability of a reaction.

#### BOS <-> Key Levels

The relationship between BOS and key levels determines significance:

| Key Level Broken | Classification  |
| ---------------- | --------------- |
| PDH / PDL        | Intraday signal |
| PWH / PWL        | Swing signal    |
| PMH / PML        | Macro signal    |
| YH / YL          | Regime event    |

#### BOS <-> News

Temporal proximity to news events classifies the BOS:

- BOS within 5 minutes of NFP = **news-driven** — likely volatile, may reverse
- BOS during quiet London = **structure-driven** — cleaner, more reliable

### Structure -> Trades

A trade record links to specific structural entities:

```
Trade #47:
  primaryBOS:      bos_h4_20260205_143000
  entryZone:       fvg_h4_20260205_143500
  premiumDiscount: discount_zone_3
  mtfScore:        -62
  cotAlignment:    bearish_aligned
  tp1:             key_level_pwl (1.0780)
  invalidation:    bos_h4_level_reclaim (1.0860)
```

When `thesis_broken` triggers, the system can point to exactly what broke: "H4 BOS level at 1.0860 was reclaimed, invalidating the bearish thesis."

### Structure -> Snapshots

Snapshots freeze the full structural context at a specific moment:

- Active (unfilled) FVGs with fill percentages
- Recent BOS events with enrichment data
- Current MTF score and per-timeframe directions
- Premium/Discount zone and tier
- Key levels with proximity to current price
- Swing sequence (last N swings)

This creates a time machine. Reviewing trade #47 six months later, you see exactly what the structure looked like at entry and exit — not a reconstructed approximation, but a frozen snapshot.

### Structure -> Claude

Claude references specific entities by ID when analyzing charts:

> "Bearish BOS `bos_h4_0205` broke PDL, unfilled FVG at 1.0860-1.0845 (`fvg_h4_0205`), COT net short agrees, MTF score -62. High-conviction short setup."

The 6 Claude data tools (`get_structure`, `get_active_fvgs`, `get_bos_history`, `get_mtf_score`, `get_premium_discount`, `get_key_levels`) give the AI the same structural awareness the chart displays.

### The Full Web

```
                         +-----------+
                         |   Trade   |
                         +-----+-----+
                               |
              +----------------+----------------+
              |                |                |
         +----v----+     +----v----+      +----v----+
         |   BOS   |     |   FVG   |      | Key Lvl |
         | (thesis)|     | (entry) |      | (target)|
         +----+----+     +----+----+      +---------+
              |                |
         +----v----+     +----v----+
         |  COT    |     |  P/D    |
         |  align  |     |  zone   |
         +---------+     +---------+
              |                |
              +-------+--------+
                      |
                +-----v------+
                |  Snapshot   |
                | (frozen)    |
                +-----+------+
                      |
                +-----v------+
                | ClickHouse |
                | (archived) |
                +------------+
```

Trade links to BOS (thesis), FVG (entry), Key Level (target). Each entity is enriched by COT alignment and Premium/Discount context. The full state is frozen in a Snapshot at entry and exit. Historical data is archived in ClickHouse for long-term analysis.

---

## Architecture Decision Records

| ADR   | Decision                                        | Rationale                                                            |
| ----- | ----------------------------------------------- | -------------------------------------------------------------------- |
| ADR-005 | Weighted MTF scoring (M*4, W*3, D*2, H4*1, H1*0.5) | Higher TFs require more participation to shift, deserve more weight |
| ADR-006 | Full BOS history tracking, not just current      | Historical BOS data enables pattern analysis and backtesting        |
| ADR-007 | Sweep detection as first-class concept           | Sweeps (liquidity grabs) are distinct from BOS and require tracking |
| ADR-009 | BOS invalidation via status field, not deletion  | Preserves history; invalidated BOS is still analytically valuable   |
| ADR-015 | Structure as computed overlays, not Convex drawings | Structure is derived from price, not user-drawn; different lifecycle |

---

## File Reference

| File                              | Purpose                                    |
| --------------------------------- | ------------------------------------------ |
| `lib/structure/mtf-scoring.ts`    | MTF composite score computation            |
| `lib/structure/bos-enrichment.ts` | BOS enrichment pipeline (6 stages)         |
| `lib/structure/counter-trend.ts`  | Counter-trend detection and flagging       |
| `lib/structure/index.ts`          | Orchestrator — 12-step `computeStructure()` |
| `lib/structure/types.ts`          | All structure entity type definitions      |
| `lib/db/structure.ts`             | DB operations for structure entities       |
| `worker/src/htf-structure-precompute.ts` | HTF pre-computation worker (D/W/M)  |
