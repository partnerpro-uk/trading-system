#!/usr/bin/env npx tsx
/**
 * FVG Fill Tracker — Worker Job
 *
 * Periodically updates fill status for active FVGs (fresh/partial).
 * Fetches recent candles and re-runs fill tracking logic.
 *
 * Schedule: Every 5 minutes for M15/M30/H1/H4
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

// =============================================================================
// Configuration
// =============================================================================

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
  "XAG_USD", "SPX500_USD",
];

const TIMEFRAMES = ["M15", "M30", "H1", "H4"];

const FILL_THRESHOLDS: Record<string, number> = {
  M15: 85, M30: 85, H1: 90, H4: 90,
};

// =============================================================================
// Database
// =============================================================================

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    pool = new Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

// =============================================================================
// FVG Fill Update Logic
// =============================================================================

interface ActiveFVG {
  time: Date;
  pair: string;
  timeframe: string;
  direction: string;
  status: string;
  top_price: number;
  bottom_price: number;
  midline: number;
  fill_percent: number;
  max_fill_percent: number;
}

interface CandleRow {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

async function updateFillsForPairTF(pair: string, timeframe: string): Promise<number> {
  const db = getPool();

  // 1. Get active FVGs
  const fvgResult = await db.query<ActiveFVG>(
    `SELECT time, pair, timeframe, direction, status,
       top_price::float, bottom_price::float, midline::float,
       fill_percent::float, max_fill_percent::float
     FROM fvg_events
     WHERE pair = $1 AND timeframe = $2 AND status IN ('fresh', 'partial')
     ORDER BY time DESC
     LIMIT 100`,
    [pair, timeframe]
  );

  if (fvgResult.rows.length === 0) return 0;

  // 2. Get recent candles (last 200)
  const candleResult = await db.query<CandleRow>(
    `SELECT time, open::float, high::float, low::float, close::float
     FROM candles
     WHERE pair = $1 AND timeframe = $2
     ORDER BY time DESC
     LIMIT 200`,
    [pair, timeframe]
  );

  if (candleResult.rows.length === 0) return 0;

  const candles = candleResult.rows.reverse(); // oldest first
  const fillThreshold = FILL_THRESHOLDS[timeframe] ?? 90;
  let updated = 0;

  for (const fvg of fvgResult.rows) {
    const fvgTime = fvg.time.getTime();
    const gapSize = fvg.top_price - fvg.bottom_price;
    if (gapSize <= 0) continue;

    let newFillPercent = fvg.fill_percent;
    let newMaxFillPercent = fvg.max_fill_percent;
    let newStatus = fvg.status;
    let bodyFilled = false;
    let wickTouched = false;
    let filledAt: Date | null = null;
    let invertedAt: Date | null = null;

    for (const candle of candles) {
      if (candle.time.getTime() <= fvgTime) continue;

      const bodyHigh = Math.max(candle.open, candle.close);
      const bodyLow = Math.min(candle.open, candle.close);

      // Wick touch
      if (fvg.direction === "bullish" && candle.low <= fvg.top_price) {
        wickTouched = true;
      } else if (fvg.direction === "bearish" && candle.high >= fvg.bottom_price) {
        wickTouched = true;
      }

      // Body fill
      let fillAmount = 0;
      if (fvg.direction === "bullish" && bodyLow < fvg.top_price) {
        fillAmount = fvg.top_price - Math.max(bodyLow, fvg.bottom_price);
      } else if (fvg.direction === "bearish" && bodyHigh > fvg.bottom_price) {
        fillAmount = Math.min(bodyHigh, fvg.top_price) - fvg.bottom_price;
      }

      if (fillAmount > 0) {
        const pct = (fillAmount / gapSize) * 100;
        if (pct > newFillPercent) newFillPercent = pct;
        if (pct > newMaxFillPercent) newMaxFillPercent = pct;
        if (fillAmount >= gapSize * 0.5) bodyFilled = true;
      }

      // Status transitions
      if (newFillPercent > 0 && newStatus === "fresh") {
        newStatus = "partial";
      }
      if (newFillPercent >= fillThreshold) {
        newStatus = "filled";
        filledAt = candle.time;
        break;
      }

      // Inversion check
      const inverted =
        (fvg.direction === "bullish" && candle.close < fvg.bottom_price) ||
        (fvg.direction === "bearish" && candle.close > fvg.top_price);
      if (inverted) {
        newStatus = "inverted";
        invertedAt = candle.time;
        break;
      }
    }

    // Only update if something changed
    if (
      newStatus !== fvg.status ||
      newFillPercent !== fvg.fill_percent ||
      newMaxFillPercent !== fvg.max_fill_percent
    ) {
      await db.query(
        `UPDATE fvg_events
         SET status = $1, fill_percent = $2, max_fill_percent = $3,
             body_filled = $4, wick_touched = $5,
             filled_at = $6, inverted_at = $7
         WHERE time = $8 AND pair = $9 AND timeframe = $10 AND direction = $11`,
        [
          newStatus, newFillPercent, newMaxFillPercent,
          bodyFilled, wickTouched,
          filledAt, invertedAt,
          fvg.time, pair, timeframe, fvg.direction,
        ]
      );
      updated++;
    }
  }

  return updated;
}

// =============================================================================
// Main entry
// =============================================================================

export async function runFVGFillTracker(): Promise<void> {
  let totalUpdated = 0;

  for (const pair of PAIRS) {
    for (const tf of TIMEFRAMES) {
      try {
        const count = await updateFillsForPairTF(pair, tf);
        totalUpdated += count;
      } catch (err) {
        console.error(`[FVGFillTracker] Error for ${pair}/${tf}:`, err);
      }
    }
  }

  if (totalUpdated > 0) {
    console.log(`[FVGFillTracker] Updated ${totalUpdated} FVG fill states`);
  }
}

// CLI entry
async function main() {
  console.log("[FVGFillTracker] Running manually...");
  await runFVGFillTracker();
  console.log("[FVGFillTracker] Done");
  await pool?.end();
}

if (process.argv[1]?.endsWith("fvg-fill-tracker.ts")) {
  main().catch(console.error);
}
