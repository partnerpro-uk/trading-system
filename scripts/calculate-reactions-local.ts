#!/usr/bin/env npx tsx
/**
 * Local Reactions Calculator
 *
 * Reads candle windows from JSONL and calculates price reactions locally.
 * Can run in parallel with window fetching.
 *
 * Usage:
 *   npx tsx scripts/calculate-reactions-local.ts                  # Calculate all
 *   npx tsx scripts/calculate-reactions-local.ts --upload-only    # Upload existing
 *   npx tsx scripts/calculate-reactions-local.ts --watch          # Watch mode (tail file)
 */

import { config } from "dotenv";
import { createReadStream, createWriteStream, existsSync, statSync } from "fs";
import { createInterface } from "readline";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const WINDOWS_FILE = "data/candle-windows.jsonl";
const REACTIONS_FILE = "data/reactions.jsonl";

// Pip values for each pair
const PIP_VALUES: Record<string, number> = {
  EUR_USD: 0.0001,
  GBP_USD: 0.0001,
  USD_JPY: 0.01,
  USD_CHF: 0.0001,
  AUD_USD: 0.0001,
  USD_CAD: 0.0001,
  NZD_USD: 0.0001,
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface WindowRecord {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  windowStart: number;
  windowEnd: number;
  candles: Candle[];
}

interface Reaction {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  priceAtMinus15m: number;
  priceAtMinus5m: number;
  priceAtMinus1m: number;
  priceAtEvent: number;
  spikeHigh: number;
  spikeLow: number;
  spikeDirection: "UP" | "DOWN";
  spikeMagnitudePips: number;
  timeToSpikeSec?: number;
  priceAtPlus5m: number;
  priceAtPlus15m: number;
  priceAtPlus30m: number;
  priceAtPlus1hr: number;
  patternType: string;
  didReverse: boolean;
  reversalMagnitudePips?: number;
  finalDirectionMatchesSpike: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// REACTION CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

function calculateReaction(window: WindowRecord): Reaction | null {
  const { candles, eventTimestamp, eventId, pair } = window;

  if (candles.length < 10) return null;

  const pipValue = PIP_VALUES[pair] || 0.0001;

  // Helper to find candle at specific offset (within 3 min tolerance)
  const candleAt = (offsetMinutes: number): Candle | undefined => {
    const targetTime = eventTimestamp + offsetMinutes * 60 * 1000;
    return candles.find((c) => Math.abs(c.timestamp - targetTime) < 180000);
  };

  // Helper to find closest candle
  const closestCandleTo = (targetTime: number): Candle | undefined => {
    let closest: Candle | undefined;
    let closestDiff = Infinity;
    for (const c of candles) {
      const diff = Math.abs(c.timestamp - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = c;
      }
    }
    return closestDiff < 300000 ? closest : undefined;
  };

  // Get key candles
  const preMinus15 = candleAt(-15);
  const preMinus5 = candleAt(-5);
  const preMinus1 = candleAt(-1);
  let atEvent = candleAt(0);
  const plus5 = candleAt(5);
  const plus15 = candleAt(15);
  const plus30 = candleAt(30);
  const plus60 = candleAt(60);

  if (!atEvent) {
    atEvent = closestCandleTo(eventTimestamp);
  }

  if (!atEvent) return null;

  const effectiveMinus5 = preMinus5 || preMinus15 || atEvent;
  const effectiveMinus15 = preMinus15 || preMinus5 || atEvent;

  // Calculate spike (candles around event ±5 minutes)
  const spikeCandles = candles.filter(
    (c) => c.timestamp >= eventTimestamp - 2 * 60 * 1000 &&
           c.timestamp <= eventTimestamp + 5 * 60 * 1000
  );

  if (spikeCandles.length === 0) return null;

  const spikeHigh = Math.max(...spikeCandles.map((c) => c.high));
  const spikeLow = Math.min(...spikeCandles.map((c) => c.low));

  const upMove = (spikeHigh - atEvent.open) / pipValue;
  const downMove = (atEvent.open - spikeLow) / pipValue;

  const spikeDirection: "UP" | "DOWN" = upMove > downMove ? "UP" : "DOWN";
  const spikeMagnitudePips = Math.round(Math.max(upMove, downMove) * 10) / 10;

  // Time to spike peak
  let timeToSpikeSec: number | undefined;
  for (const candle of spikeCandles) {
    if (spikeDirection === "UP" && candle.high === spikeHigh) {
      timeToSpikeSec = Math.round((candle.timestamp - eventTimestamp) / 1000);
      break;
    }
    if (spikeDirection === "DOWN" && candle.low === spikeLow) {
      timeToSpikeSec = Math.round((candle.timestamp - eventTimestamp) / 1000);
      break;
    }
  }

  // Settlement prices
  const priceAtPlus5m = plus5?.close || atEvent.close;
  const priceAtPlus15m = plus15?.close || priceAtPlus5m;
  const priceAtPlus30m = plus30?.close || priceAtPlus15m;
  const priceAtPlus1hr = plus60?.close || priceAtPlus30m;

  // Determine reversal
  const reversalThreshold = spikeMagnitudePips * 0.5;
  let didReverse = false;
  let reversalMagnitudePips: number | undefined;

  if (spikeDirection === "UP") {
    const pullback = (spikeHigh - priceAtPlus30m) / pipValue;
    didReverse = pullback > reversalThreshold;
    if (didReverse) reversalMagnitudePips = Math.round(pullback * 10) / 10;
  } else {
    const pullback = (priceAtPlus30m - spikeLow) / pipValue;
    didReverse = pullback > reversalThreshold;
    if (didReverse) reversalMagnitudePips = Math.round(pullback * 10) / 10;
  }

  // Final direction
  const finalMove = (priceAtPlus1hr - atEvent.open) / pipValue;
  const finalDirectionMatchesSpike =
    (spikeDirection === "UP" && finalMove > 0) ||
    (spikeDirection === "DOWN" && finalMove < 0);

  // Pattern classification
  let patternType: string;
  const finalMoveAbs = Math.abs(finalMove);

  if (!didReverse && finalMoveAbs > spikeMagnitudePips * 0.5) {
    patternType = "continuation";
  } else if (didReverse && !finalDirectionMatchesSpike) {
    patternType = "spike_reversal";
  } else if (didReverse && finalDirectionMatchesSpike) {
    patternType = "fade";
  } else {
    patternType = "range";
  }

  return {
    eventId,
    pair,
    eventTimestamp,
    priceAtMinus15m: effectiveMinus15.close,
    priceAtMinus5m: effectiveMinus5.close,
    priceAtMinus1m: preMinus1?.close || effectiveMinus5.close,
    priceAtEvent: atEvent.open,
    spikeHigh,
    spikeLow,
    spikeDirection,
    spikeMagnitudePips,
    timeToSpikeSec,
    priceAtPlus5m,
    priceAtPlus15m,
    priceAtPlus30m,
    priceAtPlus1hr,
    patternType,
    didReverse,
    reversalMagnitudePips,
    finalDirectionMatchesSpike,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function loadProcessedReactions(): Promise<Set<string>> {
  const processed = new Set<string>();
  if (!existsSync(REACTIONS_FILE)) return processed;

  const rl = createInterface({
    input: createReadStream(REACTIONS_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const r: Reaction = JSON.parse(line);
      processed.add(`${r.eventId}:${r.pair}`);
    } catch {}
  }

  return processed;
}

async function main() {
  const args = process.argv.slice(2);
  const uploadOnly = args.includes("--upload-only");
  const watchMode = args.includes("--watch");

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║           LOCAL REACTIONS CALCULATOR                              ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE REACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  if (!uploadOnly) {
    console.log("━━━ Calculating reactions from candle windows ━━━\n");

    if (!existsSync(WINDOWS_FILE)) {
      console.log("No windows file found. Run window fetch first.");
      return;
    }

    const processed = await loadProcessedReactions();
    console.log(`Already have ${processed.size} reactions calculated\n`);

    const outStream = createWriteStream(REACTIONS_FILE, { flags: "a" });
    let calculated = 0;
    let skipped = 0;
    let errors = 0;
    const startTime = Date.now();

    const rl = createInterface({
      input: createReadStream(WINDOWS_FILE),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const window: WindowRecord = JSON.parse(line);
        const key = `${window.eventId}:${window.pair}`;

        if (processed.has(key)) {
          skipped++;
          continue;
        }

        const reaction = calculateReaction(window);

        if (reaction) {
          outStream.write(JSON.stringify(reaction) + "\n");
          calculated++;
          processed.add(key);
        } else {
          errors++;
        }

        if ((calculated + errors) % 1000 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = (calculated + errors) / elapsed;
          process.stdout.write(
            `\r  Progress: ${calculated} calculated, ${skipped} skipped, ${errors} errors | ${rate.toFixed(0)}/s   `
          );
        }
      } catch {
        errors++;
      }
    }

    outStream.end();

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n\n  Calculated: ${calculated}`);
    console.log(`  Skipped:    ${skipped}`);
    console.log(`  Errors:     ${errors}`);
    console.log(`  Time:       ${totalTime.toFixed(1)}s`);
    console.log(`  Rate:       ${((calculated + errors) / totalTime).toFixed(0)} reactions/s\n`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPLOAD TO CONVEX
  // ─────────────────────────────────────────────────────────────────────────

  if (uploadOnly || args.includes("--upload")) {
    console.log("━━━ Uploading reactions to Convex ━━━\n");

    if (!existsSync(REACTIONS_FILE)) {
      console.log("No reactions file found.");
      return;
    }

    const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!CONVEX_URL) {
      console.log("NEXT_PUBLIC_CONVEX_URL not set");
      return;
    }

    const client = new ConvexHttpClient(CONVEX_URL);

    const rl = createInterface({
      input: createReadStream(REACTIONS_FILE),
      crlfDelay: Infinity,
    });

    let uploaded = 0;
    let errors = 0;
    const startTime = Date.now();

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const reaction: Reaction = JSON.parse(line);

        await client.mutation(api.newsReactions.uploadReaction, reaction);
        uploaded++;
      } catch {
        errors++;
      }

      if ((uploaded + errors) % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (uploaded + errors) / elapsed;
        process.stdout.write(
          `\r  Progress: ${uploaded} uploaded, ${errors} errors | ${rate.toFixed(1)}/s   `
        );
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n\n  Uploaded: ${uploaded}`);
    console.log(`  Errors:   ${errors}`);
    console.log(`  Time:     ${(totalTime / 60).toFixed(1)} minutes\n`);
  }

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("                            DONE!");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
