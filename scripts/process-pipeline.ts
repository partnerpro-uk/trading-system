#!/usr/bin/env npx tsx
/**
 * Combined Pipeline Processor
 *
 * Runs Stage 3 (Reactions) and Stage 4 (Statistics) locally.
 * Run after windows fetch is complete.
 *
 * Usage:
 *   npx tsx scripts/process-pipeline.ts                    # Calculate reactions + stats
 *   npx tsx scripts/process-pipeline.ts --upload           # Calculate and upload to Convex
 *   npx tsx scripts/process-pipeline.ts --stats-only       # Only calculate stats (skip reactions)
 *   npx tsx scripts/process-pipeline.ts --upload-only      # Only upload existing files
 */

import { config } from "dotenv";
import { createReadStream, createWriteStream, existsSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const EVENTS_FILE = "data/events.jsonl";
const WINDOWS_FILE = "data/candle-windows.jsonl";
const REACTIONS_FILE = "data/reactions.jsonl";
const STATISTICS_FILE = "data/statistics.json";

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD"] as const;

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

// Events where lower actual is better (unemployment, inflation when high)
const LOWER_IS_BETTER_EVENTS = [
  "Unemployment_Rate",
  "Claimant_Count_Change",
  "CPI", // Generally lower inflation = good for currency strength
  "Core_CPI",
  "Initial_Jobless_Claims",
  "Continuing_Jobless_Claims",
];

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

interface RawEvent {
  event_id: string;
  timestamp_utc: number;
  event_type: string;
  actual?: number;
  forecast?: number;
  previous?: number;
}

interface ConditionalStats {
  sampleSize: number;
  avgSpikePips: number;
  medianSpikePips: number;
  spikeUpPct: number;
  reversalWithin30minPct: number;
  dominantPattern: string;
}

interface Statistics {
  eventType: string;
  pair: string;
  sampleSize: number;
  dateRangeStart: number;
  dateRangeEnd: number;
  lastUpdated: number;
  historicalStdDev: number;
  avgSpikePips: number;
  medianSpikePips: number;
  maxSpikePips: number;
  minSpikePips: number;
  stdDevSpikePips: number;
  spikeUpCount: number;
  spikeDownCount: number;
  spikeUpPct: number;
  reversalWithin30minCount: number;
  reversalWithin1hrCount: number;
  reversalWithin30minPct: number;
  reversalWithin1hrPct: number;
  finalMatchesSpikeCount: number;
  patternCounts: {
    spike_reversal: number;
    continuation: number;
    fade: number;
    range: number;
  };
  hasForecastData: boolean;
  beatStats?: ConditionalStats;
  missStats?: ConditionalStats;
  inlineStats?: ConditionalStats;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: REACTION CALCULATION
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

async function processReactions(): Promise<number> {
  console.log("━━━ STAGE 3: Calculate Reactions ━━━\n");

  if (!existsSync(WINDOWS_FILE)) {
    console.log("  No windows file found. Run window fetch first.\n");
    return 0;
  }

  // Load already processed
  const processed = new Set<string>();
  if (existsSync(REACTIONS_FILE)) {
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
  }

  console.log(`  Already have ${processed.size} reactions calculated\n`);

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

      if ((calculated + errors) % 5000 === 0) {
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
  console.log(`  Time:       ${totalTime.toFixed(1)}s\n`);

  return calculated + skipped;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 4: STATISTICS CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

function classifyOutcome(actual: number, forecast: number, eventType: string): "beat" | "miss" | "inline" {
  const threshold = Math.abs(forecast) * 0.02; // 2% threshold for "inline"
  const diff = actual - forecast;

  // For "lower is better" events, flip the logic
  const isLowerBetter = LOWER_IS_BETTER_EVENTS.some(e => eventType.includes(e));

  if (Math.abs(diff) <= threshold) {
    return "inline";
  }

  if (isLowerBetter) {
    return diff < 0 ? "beat" : "miss"; // Lower actual = beat
  } else {
    return diff > 0 ? "beat" : "miss"; // Higher actual = beat
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr: number[], mean: number): number {
  if (arr.length === 0) return 0;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function calculateGroupStats(reactions: Reaction[]): ConditionalStats | null {
  if (reactions.length === 0) return null;

  const spikes = reactions.map(r => r.spikeMagnitudePips);
  const avgSpike = spikes.reduce((a, b) => a + b, 0) / spikes.length;

  const patterns = reactions.map(r => r.patternType);
  const patternCounts: Record<string, number> = {};
  for (const p of patterns) {
    patternCounts[p] = (patternCounts[p] || 0) + 1;
  }

  const dominantPattern = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "range";

  return {
    sampleSize: reactions.length,
    avgSpikePips: Math.round(avgSpike * 10) / 10,
    medianSpikePips: Math.round(median(spikes) * 10) / 10,
    spikeUpPct: Math.round((reactions.filter(r => r.spikeDirection === "UP").length / reactions.length) * 1000) / 10,
    reversalWithin30minPct: Math.round((reactions.filter(r => r.didReverse).length / reactions.length) * 1000) / 10,
    dominantPattern,
  };
}

async function processStatistics(): Promise<Statistics[]> {
  console.log("━━━ STAGE 4: Calculate Statistics ━━━\n");

  if (!existsSync(REACTIONS_FILE)) {
    console.log("  No reactions file found. Run reactions first.\n");
    return [];
  }

  // Load events for actual/forecast data
  const eventsMap = new Map<string, RawEvent>();
  if (existsSync(EVENTS_FILE)) {
    const rl = createInterface({
      input: createReadStream(EVENTS_FILE),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const e: RawEvent = JSON.parse(line);
        eventsMap.set(e.event_id, e);
      } catch {}
    }
    console.log(`  Loaded ${eventsMap.size} events for beat/miss classification\n`);
  }

  // Load all reactions
  const reactions: Reaction[] = [];
  const rl = createInterface({
    input: createReadStream(REACTIONS_FILE),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      reactions.push(JSON.parse(line));
    } catch {}
  }

  console.log(`  Loaded ${reactions.length} reactions\n`);

  // Group by eventType + pair
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) {
    // Extract eventType from eventId (format: EventType_CURRENCY_DATE_TIME)
    const event = eventsMap.get(r.eventId);
    const eventType = event?.event_type || r.eventId.split("_").slice(0, -3).join("_");

    const key = `${eventType}:${r.pair}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  console.log(`  Found ${groups.size} unique eventType+pair combinations\n`);

  // Calculate statistics for each group
  const statistics: Statistics[] = [];
  let processed = 0;

  for (const [key, groupReactions] of groups) {
    const [eventType, pair] = key.split(":");

    if (groupReactions.length < 3) continue; // Skip small samples

    // Spike statistics
    const spikes = groupReactions.map(r => r.spikeMagnitudePips);
    const avgSpikePips = Math.round((spikes.reduce((a, b) => a + b, 0) / spikes.length) * 10) / 10;
    const medianSpikePips = Math.round(median(spikes) * 10) / 10;
    const maxSpikePips = Math.max(...spikes);
    const minSpikePips = Math.min(...spikes);
    const stdDevSpikePips = Math.round(stdDev(spikes, avgSpikePips) * 10) / 10;

    // Direction statistics
    const spikeUpCount = groupReactions.filter(r => r.spikeDirection === "UP").length;
    const spikeDownCount = groupReactions.length - spikeUpCount;
    const spikeUpPct = Math.round((spikeUpCount / groupReactions.length) * 1000) / 10;

    // Reversal statistics
    const reversalWithin30minCount = groupReactions.filter(r => r.didReverse).length;
    const reversalWithin1hrCount = reversalWithin30minCount; // Same for now
    const reversalWithin30minPct = Math.round((reversalWithin30minCount / groupReactions.length) * 1000) / 10;
    const reversalWithin1hrPct = reversalWithin30minPct;

    const finalMatchesSpikeCount = groupReactions.filter(r => r.finalDirectionMatchesSpike).length;

    // Pattern counts
    const patternCounts = { spike_reversal: 0, continuation: 0, fade: 0, range: 0 };
    for (const r of groupReactions) {
      const p = r.patternType as keyof typeof patternCounts;
      if (p in patternCounts) patternCounts[p]++;
    }

    // Date range
    const timestamps = groupReactions.map(r => r.eventTimestamp);
    const dateRangeStart = Math.min(...timestamps);
    const dateRangeEnd = Math.max(...timestamps);

    // Historical std dev (for z-score calculation)
    const surprises: number[] = [];
    for (const r of groupReactions) {
      const event = eventsMap.get(r.eventId);
      if (event?.actual !== undefined && event?.forecast !== undefined) {
        surprises.push(event.actual - event.forecast);
      }
    }
    const avgSurprise = surprises.length > 0 ? surprises.reduce((a, b) => a + b, 0) / surprises.length : 0;
    const historicalStdDev = surprises.length > 2 ? Math.round(stdDev(surprises, avgSurprise) * 10000) / 10000 : 1;

    // Conditional stats (beat/miss/inline)
    const beats: Reaction[] = [];
    const misses: Reaction[] = [];
    const inlines: Reaction[] = [];
    let hasForecastData = false;

    for (const r of groupReactions) {
      const event = eventsMap.get(r.eventId);
      if (event?.actual !== undefined && event?.forecast !== undefined) {
        hasForecastData = true;
        const outcome = classifyOutcome(event.actual, event.forecast, eventType);
        if (outcome === "beat") beats.push(r);
        else if (outcome === "miss") misses.push(r);
        else inlines.push(r);
      }
    }

    const stat: Statistics = {
      eventType,
      pair,
      sampleSize: groupReactions.length,
      dateRangeStart,
      dateRangeEnd,
      lastUpdated: Date.now(),
      historicalStdDev,
      avgSpikePips,
      medianSpikePips,
      maxSpikePips,
      minSpikePips,
      stdDevSpikePips,
      spikeUpCount,
      spikeDownCount,
      spikeUpPct,
      reversalWithin30minCount,
      reversalWithin1hrCount,
      reversalWithin30minPct,
      reversalWithin1hrPct,
      finalMatchesSpikeCount,
      patternCounts,
      hasForecastData,
    };

    if (hasForecastData && beats.length >= 5) {
      stat.beatStats = calculateGroupStats(beats) || undefined;
    }
    if (hasForecastData && misses.length >= 5) {
      stat.missStats = calculateGroupStats(misses) || undefined;
    }
    if (hasForecastData && inlines.length >= 5) {
      stat.inlineStats = calculateGroupStats(inlines) || undefined;
    }

    statistics.push(stat);
    processed++;

    if (processed % 100 === 0) {
      process.stdout.write(`\r  Processed ${processed}/${groups.size} groups...`);
    }
  }

  // Save to file
  writeFileSync(STATISTICS_FILE, JSON.stringify(statistics, null, 2));

  console.log(`\n\n  Statistics calculated: ${statistics.length}`);
  console.log(`  Saved to: ${STATISTICS_FILE}\n`);

  // Summary
  const withForecast = statistics.filter(s => s.hasForecastData).length;
  console.log(`  With forecast data: ${withForecast}`);
  console.log(`  Without forecast:   ${statistics.length - withForecast}\n`);

  return statistics;
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD TO CONVEX
// ═══════════════════════════════════════════════════════════════════════════

async function uploadReactions(): Promise<void> {
  console.log("━━━ Uploading Reactions to Convex (Parallel) ━━━\n");

  if (!existsSync(REACTIONS_FILE)) {
    console.log("  No reactions file found.\n");
    return;
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    console.log("  NEXT_PUBLIC_CONVEX_URL not set\n");
    return;
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  const BATCH_SIZE = 50; // Parallel batch size

  // Load all reactions into memory for parallel processing
  const reactions: Reaction[] = [];
  const rl = createInterface({
    input: createReadStream(REACTIONS_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      reactions.push(JSON.parse(line));
    } catch {}
  }

  console.log(`  Loaded ${reactions.length} reactions to upload\n`);

  let uploaded = 0;
  let errors = 0;
  const startTime = Date.now();

  // Process in parallel batches
  for (let i = 0; i < reactions.length; i += BATCH_SIZE) {
    const batch = reactions.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(reaction => client.mutation(api.newsReactions.uploadReaction, reaction))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        uploaded++;
      } else {
        errors++;
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (uploaded + errors) / elapsed;
    const eta = ((reactions.length - (uploaded + errors)) / rate / 60).toFixed(1);
    process.stdout.write(
      `\r  Progress: ${uploaded + errors}/${reactions.length} | ${uploaded} OK, ${errors} ERR | ${rate.toFixed(0)}/s | ETA: ${eta}m   `
    );
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n\n  Uploaded: ${uploaded}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Time:     ${(totalTime / 60).toFixed(1)} minutes\n`);
}

async function uploadStatistics(): Promise<void> {
  console.log("━━━ Uploading Statistics to Convex (Parallel) ━━━\n");

  if (!existsSync(STATISTICS_FILE)) {
    console.log("  No statistics file found.\n");
    return;
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    console.log("  NEXT_PUBLIC_CONVEX_URL not set\n");
    return;
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  const BATCH_SIZE = 25;
  const statistics: Statistics[] = JSON.parse(
    await import("fs").then(fs => fs.promises.readFile(STATISTICS_FILE, "utf-8"))
  );

  let uploaded = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < statistics.length; i += BATCH_SIZE) {
    const batch = statistics.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(stat => client.mutation(api.newsStatistics.uploadStatistics, stat))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        uploaded++;
      } else {
        errors++;
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = (uploaded + errors) / elapsed;
    process.stdout.write(
      `\r  Progress: ${uploaded + errors}/${statistics.length} | ${rate.toFixed(0)}/s   `
    );
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n\n  Uploaded: ${uploaded}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Time:     ${totalTime.toFixed(1)}s\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const uploadOnly = args.includes("--upload-only");
  const statsOnly = args.includes("--stats-only");
  const doUpload = args.includes("--upload") || uploadOnly;

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║           PIPELINE PROCESSOR (Reactions + Statistics)             ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  if (!uploadOnly) {
    // Stage 3: Reactions
    if (!statsOnly) {
      await processReactions();
    }

    // Stage 4: Statistics
    await processStatistics();
  }

  // Upload if requested
  if (doUpload) {
    await uploadReactions();
    await uploadStatistics();
  }

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("                            DONE!");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
