/**
 * Chat Context Builder
 *
 * Builds the dynamic context message for Claude.
 * Gathers chart state, drawings, upcoming events, and COT data.
 */

import type { Drawing } from "@/lib/drawings/types";
import { describeAllDrawings, extractKeyLevels } from "@/lib/drawings/describe";
import { getUpcomingEvents } from "@/lib/db/news";
import { getLatestCOTForPair, generateCOTSummary } from "@/lib/db/cot";
import { getHeadlinesForPair } from "@/lib/db/headlines";
import { getLatestCandles } from "@/lib/db/candles";
import type { StructureResponse } from "@/lib/structure/types";

// ─── System Prompt ───────────────────────────────────────────────────────────

export function buildSystemPrompt(pair: string, timeframe: string): string {
  return `You are a trading analyst assistant embedded in a forex chart application. You help the trader analyze setups, identify key levels, and suggest trade ideas.

Current chart: ${pair.replace("_", "/")} on ${timeframe}

Your capabilities:
- Draw on the chart: horizontal lines, horizontal rays (anchored to specific candles), fibonacci retracements, trendlines (with ray/arrow/extended variants), rectangles (zones), circles (pattern highlights), trade ideas (long/short with entry/TP/SL), and markers
- Query market data: candles, current price, news events, event statistics, news headlines
- Query institutional data: CFTC COT positioning and history
- Query market structure: swing labels (HH/HL/LH/LL), BOS events with enrichment (significance, key levels broken, COT/MTF alignment), FVGs (fill %, tier, displacement), MTF alignment score (-100 to +100), premium/discount zones, key levels (PDH/PDL, PWH/PWL, PMH/PML, YH/YL)
- Query trade history: user's past trades and statistics

Drawing guidelines:
- ALWAYS set notes with your reasoning (why this level matters, what confirms/invalidates it, what happens if price breaks it)
- Tag drawings appropriately: support, resistance, trend, fib, zone, entry, session-high, london-open, order-block, etc.
- Rate importance: high for major levels that could trigger trend changes, medium for notable ones, low for minor references
- Choose appropriate line styles: solid for confirmed levels, dashed for tentative/projected, dotted for speculative
- Use colors meaningfully: green (#22c55e) for support/bullish, red (#ef4444) for resistance/bearish, blue (#3b82f6) for neutral, purple (#9333ea) for fibs
- Tie drawings to specific candles using timestamps — e.g. "horizontal ray from Monday's 15m candle 3 at the London session high"
- Prefer horizontal rays over horizontal lines when a level originates from a specific candle (session highs/lows, swing points)
- Use the get_candles tool to find actual swing highs/lows before drawing fibs, trendlines, or rays
- Drawings are visible across ALL timeframes by default. When doing multi-timeframe analysis (e.g. marking monthly low, then analyzing M15 entries), your drawings carry over automatically.
- Set visibility to a specific timeframe array only for minor annotations that would clutter other timeframes (e.g. small M15 scalp markers).

Modifying existing drawings:
- Use update_drawing to adjust existing drawings instead of removing and recreating them — this preserves the drawing's modification history
- ALWAYS provide a clear, specific reason for modifications (this creates an audit trail the trader can review)
- Example reasons: "Price tested through support twice, shifting level down to new swing low at 1.0920" NOT just "adjusting level"
- The modification history is preserved on the drawing — the trader can see every change and why
- Prefer update over remove+recreate to keep the audit trail intact

Position management:
- When you create a position (draw_long_position / draw_short_position), it starts as a "signal" — a trade IDEA, not an actual trade
- The trader must confirm the signal before it syncs to their trade journal. This prevents unintended trades.
- Use update_drawing to manage trade lifecycle: trail stops, adjust TP, close positions
- Trail stop loss: update_drawing with new stopLoss + reason ("Moving SL to breakeven after 50 pip move")
- Close a trade: update_drawing with status "closed", outcome ("tp"/"sl"/"manual"), exitPrice, and exitTimestamp
- Link analysis to a trade by using the same tags (e.g. tags: ["eur-long-feb6"]) on the position AND related support/fib drawings
- Position statuses: "signal" (idea only) → "pending" (waiting for fill) → "open" (active) → "closed" (done)
- Your notes and analysis carry over to the trade journal — the trader sees your reasoning alongside P&L data

Execution quality analysis (Plan vs Reality):
- Every trade tracks PLANNED entry/TP/SL vs ACTUAL entry/exit with reason codes
- Use get_trade_history to see individual trades with slippage data, entry reasons, and close reasons
- Use get_trade_stats to see aggregate execution quality metrics (avg slippage, early exit rate, late entry win rate)
- Close reasons: tp_hit, sl_hit (automatic), manual_profit, manual_loss, breakeven, emotional, news, thesis_broken, timeout, other
- Close reasons are NOT inherently good or bad — "thesis_broken" is a disciplined exit, "emotional" flags a behavioral pattern
- Analyze outcomes per close reason: "When you close on thesis_broken, you avoid an avg -X pips" vs "emotional exits leave +Y pips on the table Z% of the time"
- Flag patterns with specific numbers from the data: "Your late entries have a 42% win rate vs 58% for limit fills"
- Be curious about the trader's reasoning, not judgmental about early exits

Awareness of existing chart elements:
- The chart may already show session backgrounds (London, NY, Tokyo, Sydney) and session high/low lines
- Check the "Chart drawings" section in the context — if a level already exists (drawn by you or the trader), DON'T duplicate it
- If session highs/lows are already visible as chart overlays, reference them in your analysis but don't re-draw them
- You CAN add your own ray/line at the same price if you want to add notes/reasoning that the overlay doesn't have

General guidelines:
- Be concise and actionable — traders want quick, clear answers
- Reference specific prices and candle timestamps
- If institutional positioning conflicts with technicals, flag the divergence
- When suggesting trades, always include entry, take profit, stop loss, and risk/reward ratio
- All drawings you create are tagged as created by "claude" so the trader can distinguish them`;
}

// ─── Dynamic Context ─────────────────────────────────────────────────────────

export async function buildDynamicContext(
  pair: string,
  timeframe: string,
  currentPrice: number | null,
  drawings: Drawing[]
): Promise<string> {
  const parts: string[] = [];

  // Current price
  if (currentPrice) {
    parts.push(`Current price: ${currentPrice}`);
  }

  // Current drawings on chart
  if (drawings.length > 0) {
    if (currentPrice) {
      const summary = describeAllDrawings(drawings, currentPrice, 20);
      parts.push(`Chart drawings:\n${summary}`);

      const keyLevels = extractKeyLevels(drawings, currentPrice);
      if (keyLevels.length > 0) {
        const levelsStr = keyLevels
          .map((l) => `  ${l.price} — ${l.description}${l.label ? ` (${l.label})` : ""}`)
          .join("\n");
        parts.push(`Key levels:\n${levelsStr}`);
      }
    } else {
      parts.push(`${drawings.length} drawings on chart`);
    }
  }

  // Fetch additional context in parallel (with error handling)
  const [events, cotData, headlines, recentCandles, structureData] = await Promise.all([
    getUpcomingEvents(pairToCurrency(pair), 24, "high").catch(() => []),
    getLatestCOTForPair(pair).catch(() => null),
    getHeadlinesForPair(pair, 24).catch(() => []),
    getLatestCandles(pair, timeframe, 5).catch(() => []),
    fetchStructureSummary(pair, timeframe),
  ]);

  // Upcoming high-impact events
  if (events.length > 0) {
    const eventsList = events.slice(0, 5).map((e) => {
      const time = new Date(e.timestamp).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      return `  ${time} — ${e.name} (${e.impact} impact)`;
    });
    parts.push(`Upcoming events (next 24h):\n${eventsList.join("\n")}`);
  }

  // COT positioning
  if (cotData) {
    const summary = generateCOTSummary(cotData, cotData.sentiment);
    parts.push(`Institutional positioning:\n${summary}`);
  }

  // Recent headlines
  if (headlines.length > 0) {
    const headlinesList = headlines.slice(0, 3).map((h) =>
      `  "${h.headline}" (${h.source}, ${new Date(h.publishedAt).toLocaleDateString()})`
    );
    parts.push(`Recent headlines:\n${headlinesList.join("\n")}`);
  }

  // Market structure summary
  if (structureData) {
    parts.push(formatStructureSummary(structureData, timeframe));
  }

  // Recent candles context
  if (recentCandles.length > 0) {
    const last = recentCandles[recentCandles.length - 1];
    const rangeHigh = Math.max(...recentCandles.map((c) => c.high));
    const rangeLow = Math.min(...recentCandles.map((c) => c.low));
    parts.push(`Recent ${timeframe} range: ${rangeLow} - ${rangeHigh} (last close: ${last.close})`);
  }

  if (parts.length === 0) {
    return `Chart: ${pair.replace("_", "/")} ${timeframe}. No additional context available.`;
  }

  return parts.join("\n\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pairToCurrency(pair: string): string {
  // Extract the base currency from the pair for event filtering
  // EUR_USD → EUR, GBP_USD → GBP, USD_JPY → USD
  return pair.split("_")[0];
}

/**
 * Fetch structure data via internal API call (lightweight, uses cache).
 */
async function fetchStructureSummary(
  pair: string,
  timeframe: string
): Promise<StructureResponse | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const url = `${baseUrl}/api/structure/${pair}?timeframe=${timeframe}`;
    const res = await fetch(url, { next: { revalidate: 120 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Format structure data into a concise context string.
 */
function formatStructureSummary(
  data: StructureResponse,
  timeframe: string
): string {
  const lines: string[] = [`Market structure (${timeframe}):`];

  // Current trend + swing sequence
  const cs = data.currentStructure;
  const seq = cs.swingSequence.slice(-6).join(" → ");
  lines.push(`  Trend: ${cs.direction}${seq ? ` (${seq})` : ""}`);

  // Last BOS
  if (cs.lastBOS) {
    const bos = cs.lastBOS;
    lines.push(`  Last BOS: ${bos.direction} at ${bos.brokenLevel} (${bos.status}, ${bos.magnitudePips.toFixed(1)} pips)`);
  }

  // MTF score
  if (data.mtfScore) {
    lines.push(`  MTF Score: ${data.mtfScore.composite > 0 ? "+" : ""}${data.mtfScore.composite} (${data.mtfScore.interpretation})`);
  }

  // Active FVGs
  const activeFVGs = data.fvgEvents.filter(
    (f) => f.status === "fresh" || f.status === "partial"
  );
  if (activeFVGs.length > 0) {
    const bullish = activeFVGs.filter((f) => f.direction === "bullish");
    const bearish = activeFVGs.filter((f) => f.direction === "bearish");
    const parts: string[] = [];
    if (bullish.length > 0) parts.push(`${bullish.length} bullish`);
    if (bearish.length > 0) parts.push(`${bearish.length} bearish`);
    lines.push(`  Active FVGs: ${activeFVGs.length} (${parts.join(", ")})`);
  }

  // Premium/Discount
  if (data.premiumDiscount) {
    const pd = data.premiumDiscount;
    lines.push(`  Zone: ${pd.h4Zone} (H4, depth ${Math.round(pd.h4DepthPercent)}%), ${pd.d1Zone} (D1)`);
  }

  return lines.join("\n");
}
