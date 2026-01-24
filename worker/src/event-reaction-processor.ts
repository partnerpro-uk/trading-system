/**
 * Real-Time Event Reaction Processor
 *
 * Processes news events in real-time to capture price reactions:
 * 1. Monitors events that have recently occurred
 * 2. Waits for settlement period (90 minutes for short-term)
 * 3. Fetches M1/M5 candles from OANDA
 * 4. Calculates spike, settlement prices, and pattern classifications
 * 5. Stores results in ClickHouse event_price_reactions table
 * 6. Updates extended aftermath (T+2hr to T+24hr) from H1 candles
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";

// Configuration
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";
const OANDA_API_KEY = process.env.OANDA_API_KEY!;

// Pairs we track reactions for
const TRACKED_PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "XAU_USD",
  "SPX500_USD",
] as const;

// Currency to pair mapping (which pairs are affected by which currency events)
const CURRENCY_TO_PAIRS: Record<string, string[]> = {
  USD: ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD", "SPX500_USD"],
  EUR: ["EUR_USD"],
  GBP: ["GBP_USD"],
  JPY: ["USD_JPY"],
  CHF: ["USD_CHF"],
  AUD: ["AUD_USD"],
  CAD: ["USD_CAD"],
  NZD: ["NZD_USD"],
};

// Pip values for each pair
const PIP_VALUES: Record<string, number> = {
  EUR_USD: 0.0001,
  GBP_USD: 0.0001,
  USD_JPY: 0.01,
  USD_CHF: 0.0001,
  AUD_USD: 0.0001,
  USD_CAD: 0.0001,
  NZD_USD: 0.0001,
  XAU_USD: 0.1,
  SPX500_USD: 0.1,
};

interface NewsEvent {
  event_id: string;
  name: string;
  currency: string;
  timestamp: string;
  impact: string;
}

interface OandaCandle {
  time: string;
  mid: { o: string; h: string; l: string; c: string };
  volume: number;
  complete: boolean;
}

interface CandleData {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceReaction {
  event_id: string;
  pair: string;
  price_at_minus_15m: number;
  price_at_minus_5m: number | null;
  price_at_event: number;
  spike_high: number;
  spike_low: number;
  spike_direction: "UP" | "DOWN";
  spike_magnitude_pips: number;
  time_to_spike_seconds: number;
  price_at_plus_5m: number | null;
  price_at_plus_15m: number | null;
  price_at_plus_30m: number | null;
  price_at_plus_60m: number | null;
  price_at_plus_90m: number | null;
  pattern_type: string;
  did_reverse: boolean;
  reversal_magnitude_pips: number | null;
  final_matches_spike: boolean;
}

/**
 * Fetch candles from OANDA API
 */
async function fetchOandaCandles(
  pair: string,
  granularity: "M1" | "M5" | "H1",
  from: Date,
  to: Date
): Promise<CandleData[]> {
  const fromStr = from.toISOString();
  const toStr = to.toISOString();

  const url = `${OANDA_API_URL}/v3/instruments/${pair}/candles?granularity=${granularity}&from=${fromStr}&to=${toStr}&price=M`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`OANDA API error: ${response.status}`);
  }

  const data = await response.json();
  const candles: OandaCandle[] = data.candles || [];

  return candles
    .filter((c) => c.complete)
    .map((c) => ({
      time: new Date(c.time),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
    }));
}

/**
 * Find candle closest to target time
 */
function findCandleAtTime(candles: CandleData[], targetTime: Date): CandleData | null {
  if (candles.length === 0) return null;

  // Find first candle at or after target time
  for (const candle of candles) {
    if (candle.time.getTime() >= targetTime.getTime()) {
      return candle;
    }
  }

  // If none found, return last candle
  return candles[candles.length - 1];
}

/**
 * Classify the price reaction pattern
 */
function classifyPattern(
  spikeDirection: "UP" | "DOWN",
  spikePips: number,
  priceAtEvent: number,
  priceAt30m: number | null,
  priceAt60m: number | null,
  pipValue: number
): string {
  const settlement = priceAt60m ?? priceAt30m;
  if (!settlement) return "trap";

  const settlementChange = (settlement - priceAtEvent) / pipValue;

  // Range: small spike and small settlement change
  if (spikePips < 10 && Math.abs(settlementChange) < 15) {
    return "range";
  }

  // Delayed reaction: small spike but big T+30m move
  if (spikePips < 15 && priceAt30m) {
    const t30mChange = Math.abs((priceAt30m - priceAtEvent) / pipValue);
    if (t30mChange > 30) return "delayed_reaction";
  }

  // Continuation: settlement still moving in spike direction
  if (spikeDirection === "UP" && settlementChange > spikePips * 0.8) return "continuation";
  if (spikeDirection === "DOWN" && settlementChange < -spikePips * 0.8) return "continuation";

  // Spike reversal: opposite direction at settlement
  if (spikeDirection === "UP" && settlementChange < -spikePips * 0.8) return "spike_reversal";
  if (spikeDirection === "DOWN" && settlementChange > spikePips * 0.8) return "spike_reversal";

  // Fade: partial reversal (30-70%)
  if (spikeDirection === "UP" && settlementChange < -spikePips * 0.3) return "fade";
  if (spikeDirection === "DOWN" && settlementChange > spikePips * 0.3) return "fade";

  return "trap";
}

/**
 * Process a single event to extract price reactions
 */
async function processEventReaction(
  event: NewsEvent,
  pair: string
): Promise<PriceReaction | null> {
  const eventTime = new Date(event.timestamp);
  const pipValue = PIP_VALUES[pair] || 0.0001;

  // Fetch M1 candles from T-15m to T+15m for spike detection
  const spikeStart = new Date(eventTime.getTime() - 15 * 60 * 1000);
  const spikeEnd = new Date(eventTime.getTime() + 20 * 60 * 1000);

  let m1Candles: CandleData[];
  try {
    m1Candles = await fetchOandaCandles(pair, "M1", spikeStart, spikeEnd);
  } catch (err) {
    console.error(`    Failed to fetch M1 candles for ${pair}:`, err);
    return null;
  }

  if (m1Candles.length < 16) {
    console.log(`    Insufficient M1 candles for ${pair}: ${m1Candles.length}`);
    return null;
  }

  // Fetch M5 candles for settlement prices (T+30m, T+60m, T+90m)
  const settlementStart = new Date(eventTime.getTime() + 25 * 60 * 1000);
  const settlementEnd = new Date(eventTime.getTime() + 95 * 60 * 1000);

  let m5Candles: CandleData[];
  try {
    m5Candles = await fetchOandaCandles(pair, "M5", settlementStart, settlementEnd);
  } catch (err) {
    console.error(`    Failed to fetch M5 candles for ${pair}:`, err);
    m5Candles = [];
  }

  // Extract key prices from M1 candles
  const tMinus15 = findCandleAtTime(m1Candles, spikeStart);
  const tMinus5 = findCandleAtTime(m1Candles, new Date(eventTime.getTime() - 5 * 60 * 1000));
  const tEvent = findCandleAtTime(m1Candles, eventTime);
  const tPlus5 = findCandleAtTime(m1Candles, new Date(eventTime.getTime() + 5 * 60 * 1000));
  const tPlus15 = findCandleAtTime(m1Candles, new Date(eventTime.getTime() + 15 * 60 * 1000));

  if (!tMinus15 || !tEvent) {
    console.log(`    Missing baseline or event candle for ${pair}`);
    return null;
  }

  // Calculate spike from candles T-5 to T+5 (10 minute window around event)
  const spikeWindowStart = new Date(eventTime.getTime() - 5 * 60 * 1000);
  const spikeWindowEnd = new Date(eventTime.getTime() + 5 * 60 * 1000);
  const spikeCandles = m1Candles.filter(
    (c) => c.time >= spikeWindowStart && c.time <= spikeWindowEnd
  );

  const spikeHigh = Math.max(...spikeCandles.map((c) => c.high));
  const spikeLow = Math.min(...spikeCandles.map((c) => c.low));
  const baseline = tMinus15.close;

  const upMove = spikeHigh - baseline;
  const downMove = baseline - spikeLow;
  const spikeDirection: "UP" | "DOWN" = upMove > downMove ? "UP" : "DOWN";
  const spikeMagnitude = Math.max(upMove, downMove);
  const spikePips = Math.round((spikeMagnitude / pipValue) * 100) / 100;

  // Extract settlement prices from M5 candles
  const tPlus30 = findCandleAtTime(m5Candles, new Date(eventTime.getTime() + 30 * 60 * 1000));
  const tPlus60 = findCandleAtTime(m5Candles, new Date(eventTime.getTime() + 60 * 60 * 1000));
  const tPlus90 = findCandleAtTime(m5Candles, new Date(eventTime.getTime() + 90 * 60 * 1000));

  // Calculate pattern and reversal metrics
  const pattern = classifyPattern(
    spikeDirection,
    spikePips,
    tEvent.close,
    tPlus30?.close ?? null,
    tPlus60?.close ?? null,
    pipValue
  );

  const didReverse =
    tPlus15 !== null &&
    ((spikeDirection === "UP" && tPlus15.close < tEvent.close) ||
      (spikeDirection === "DOWN" && tPlus15.close > tEvent.close));

  const reversalPips = didReverse && tPlus15
    ? Math.round((Math.abs(tPlus15.close - tEvent.close) / pipValue) * 100) / 100
    : null;

  const finalMatchesSpike =
    tPlus15 !== null &&
    ((spikeDirection === "UP" && tPlus15.close > baseline) ||
      (spikeDirection === "DOWN" && tPlus15.close < baseline));

  return {
    event_id: event.event_id,
    pair,
    price_at_minus_15m: tMinus15.close,
    price_at_minus_5m: tMinus5?.close ?? null,
    price_at_event: tEvent.close,
    spike_high: spikeHigh,
    spike_low: spikeLow,
    spike_direction: spikeDirection,
    spike_magnitude_pips: spikePips,
    time_to_spike_seconds: 300, // Simplified
    price_at_plus_5m: tPlus5?.close ?? null,
    price_at_plus_15m: tPlus15?.close ?? null,
    price_at_plus_30m: tPlus30?.close ?? null,
    price_at_plus_60m: tPlus60?.close ?? null,
    price_at_plus_90m: tPlus90?.close ?? null,
    pattern_type: pattern,
    did_reverse: didReverse,
    reversal_magnitude_pips: reversalPips,
    final_matches_spike: finalMatchesSpike,
  };
}

/**
 * Save reaction to ClickHouse
 */
async function saveReaction(client: ClickHouseClient, reaction: PriceReaction): Promise<void> {
  await client.insert({
    table: "event_price_reactions",
    values: [
      {
        event_id: reaction.event_id,
        pair: reaction.pair,
        price_at_minus_15m: reaction.price_at_minus_15m,
        price_at_minus_5m: reaction.price_at_minus_5m,
        price_at_event: reaction.price_at_event,
        spike_high: reaction.spike_high,
        spike_low: reaction.spike_low,
        spike_direction: reaction.spike_direction,
        spike_magnitude_pips: reaction.spike_magnitude_pips,
        time_to_spike_seconds: reaction.time_to_spike_seconds,
        price_at_plus_5m: reaction.price_at_plus_5m,
        price_at_plus_15m: reaction.price_at_plus_15m,
        price_at_plus_30m: reaction.price_at_plus_30m,
        price_at_plus_60m: reaction.price_at_plus_60m,
        price_at_plus_90m: reaction.price_at_plus_90m,
        pattern_type: reaction.pattern_type,
        did_reverse: reaction.did_reverse ? 1 : 0,
        reversal_magnitude_pips: reaction.reversal_magnitude_pips,
        final_matches_spike: reaction.final_matches_spike ? 1 : 0,
        window_minutes: 30,
        created_at: new Date().toISOString(),
      },
    ],
    format: "JSONEachRow",
  });
}

/**
 * Update extended aftermath (T+2hr to T+24hr) from H1 candles
 */
async function updateExtendedAftermath(
  client: ClickHouseClient,
  eventId: string,
  pair: string,
  eventTime: Date,
  spikeDirection: string,
  priceAtEvent: number,
  priceAtMinus15m: number,
  spikeRange: number
): Promise<void> {
  // Fetch H1 candles from T+2hr to T+25hr
  const h1Start = new Date(eventTime.getTime() + 2 * 60 * 60 * 1000);
  const h1End = new Date(eventTime.getTime() + 25 * 60 * 60 * 1000);

  let h1Candles: CandleData[];
  try {
    h1Candles = await fetchOandaCandles(pair, "H1", h1Start, h1End);
  } catch (err) {
    console.error(`    Failed to fetch H1 candles for extended aftermath:`, err);
    return;
  }

  // Find candles at T+2hr, T+4hr, T+8hr, T+24hr
  const t2hr = findCandleAtTime(h1Candles, new Date(eventTime.getTime() + 2 * 60 * 60 * 1000));
  const t4hr = findCandleAtTime(h1Candles, new Date(eventTime.getTime() + 4 * 60 * 60 * 1000));
  const t8hr = findCandleAtTime(h1Candles, new Date(eventTime.getTime() + 8 * 60 * 60 * 1000));
  const t24hr = findCandleAtTime(h1Candles, new Date(eventTime.getTime() + 24 * 60 * 60 * 1000));

  // Classify extended pattern
  let extendedPattern = "";
  if (t24hr) {
    if (
      (spikeDirection === "UP" && t24hr.close > priceAtEvent) ||
      (spikeDirection === "DOWN" && t24hr.close < priceAtEvent)
    ) {
      extendedPattern = "spike_trend";
    } else if (Math.abs(t24hr.close - priceAtMinus15m) < spikeRange * 0.3) {
      extendedPattern = "mean_reversion";
    } else if (
      t8hr &&
      ((spikeDirection === "UP" && t8hr.close < priceAtEvent && t24hr.close > priceAtEvent) ||
        (spikeDirection === "DOWN" && t8hr.close > priceAtEvent && t24hr.close < priceAtEvent))
    ) {
      extendedPattern = "spike_trap_trend";
    } else if (Math.abs(t24hr.close - priceAtEvent) < spikeRange * 0.5) {
      extendedPattern = "new_range";
    }
  }

  // Update the reaction with extended data
  await client.command({
    query: `
      ALTER TABLE event_price_reactions UPDATE
        price_t_plus_2hr = ${t2hr?.close ?? "NULL"},
        price_t_plus_4hr = ${t4hr?.close ?? "NULL"},
        price_t_plus_8hr = ${t8hr?.close ?? "NULL"},
        price_t_plus_24hr = ${t24hr?.close ?? "NULL"},
        extended_pattern_type = '${extendedPattern}'
      WHERE event_id = '${eventId}' AND pair = '${pair}'
    `,
  });
}

/**
 * Get events that need reaction processing
 * (occurred 90+ minutes ago but don't have reactions yet)
 */
async function getUnprocessedEvents(client: ClickHouseClient): Promise<NewsEvent[]> {
  const cutoffTime = new Date(Date.now() - 90 * 60 * 1000); // 90 minutes ago
  const oldestTime = new Date(Date.now() - 48 * 60 * 60 * 1000); // Don't process events older than 48 hours

  const result = await client.query({
    query: `
      SELECT DISTINCT
        e.event_id,
        e.name,
        e.currency,
        toString(e.timestamp) as timestamp,
        e.impact
      FROM news_events e
      LEFT JOIN event_price_reactions r ON e.event_id = r.event_id
      WHERE e.timestamp >= parseDateTimeBestEffort('${oldestTime.toISOString()}')
        AND e.timestamp <= parseDateTimeBestEffort('${cutoffTime.toISOString()}')
        AND e.impact IN ('High', 'Medium')
        AND r.event_id IS NULL
      ORDER BY e.timestamp DESC
      LIMIT 20
    `,
    format: "JSONEachRow",
  });

  const events = await result.json<NewsEvent>();
  return events;
}

/**
 * Get reactions that need extended aftermath updates
 * (occurred 24+ hours ago but don't have T+24hr data)
 */
interface ExtendedReactionData {
  event_id: string;
  pair: string;
  timestamp: string;
  spike_direction: string;
  price_at_event: number;
  price_at_minus_15m: number;
  spike_high: number;
  spike_low: number;
}

async function getReactionsNeedingExtended(
  client: ClickHouseClient
): Promise<ExtendedReactionData[]> {
  const cutoffTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
  const oldestTime = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72 hours ago

  const result = await client.query({
    query: `
      SELECT
        r.event_id,
        r.pair,
        toString(e.timestamp) as timestamp,
        r.spike_direction,
        toFloat64(r.price_at_event) as price_at_event,
        toFloat64(r.price_at_minus_15m) as price_at_minus_15m,
        toFloat64(r.spike_high) as spike_high,
        toFloat64(r.spike_low) as spike_low
      FROM event_price_reactions r
      INNER JOIN news_events e ON r.event_id = e.event_id
      WHERE e.timestamp >= parseDateTimeBestEffort('${oldestTime.toISOString()}')
        AND e.timestamp <= parseDateTimeBestEffort('${cutoffTime.toISOString()}')
        AND r.price_t_plus_24hr IS NULL
      ORDER BY e.timestamp DESC
      LIMIT 20
    `,
    format: "JSONEachRow",
  });

  const reactions = await result.json<ExtendedReactionData>();
  return reactions;
}

/**
 * Main processing function - runs periodically
 */
export async function processEventReactions(): Promise<void> {
  console.log("\n[EventReactions] Starting reaction processing...");

  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  try {
    // Phase 1: Process new events that need reactions
    const unprocessedEvents = await getUnprocessedEvents(client);
    console.log(`[EventReactions] Found ${unprocessedEvents.length} events needing reactions`);

    for (const event of unprocessedEvents) {
      const pairs = CURRENCY_TO_PAIRS[event.currency] || [];
      console.log(`  Processing ${event.name} (${event.currency}) - ${pairs.length} pairs`);

      for (const pair of pairs) {
        try {
          const reaction = await processEventReaction(event, pair);
          if (reaction) {
            await saveReaction(client, reaction);
            console.log(`    ✓ ${pair}: ${reaction.spike_direction} ${reaction.spike_magnitude_pips} pips (${reaction.pattern_type})`);
          }
        } catch (err) {
          console.error(`    ✗ ${pair}:`, err);
        }

        // Rate limit OANDA requests
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Phase 2: Update extended aftermath for older reactions
    const reactionsNeedingExtended = await getReactionsNeedingExtended(client);
    console.log(`[EventReactions] Found ${reactionsNeedingExtended.length} reactions needing extended aftermath`);

    for (const r of reactionsNeedingExtended) {
      try {
        await updateExtendedAftermath(
          client,
          r.event_id,
          r.pair,
          new Date(r.timestamp),
          r.spike_direction,
          r.price_at_event,
          r.price_at_minus_15m,
          Math.abs(r.spike_high - r.spike_low)
        );
        console.log(`    ✓ Extended aftermath updated: ${r.pair}`);
      } catch (err) {
        console.error(`    ✗ Extended update failed for ${r.pair}:`, err);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("[EventReactions] Processing complete");
  } finally {
    await client.close();
  }
}

/**
 * CLI entry point for testing
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  import("dotenv").then((dotenv) => {
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: "../.env.local" });
    processEventReactions().catch(console.error);
  });
}
