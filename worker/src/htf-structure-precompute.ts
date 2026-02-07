#!/usr/bin/env npx tsx
/**
 * HTF Structure Pre-computation — Worker Job
 *
 * Pre-computes CurrentStructure for D/W/M timeframes per pair.
 * Stores results in TimescaleDB for fast MTF scoring lookups.
 *
 * Schedule: Every 4 hours (startup + 4h interval)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

// We can't import from @/lib/structure here (worker uses tsx, not Next.js).
// Instead, we import the structure functions from the lib path directly.
// The worker tsconfig resolves these as relative paths at runtime.

// ─── Configuration ──────────────────────────────────────────────────────────

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
  "XAG_USD", "SPX500_USD",
];

const HTF_TIMEFRAMES = [
  { tf: "D", candleCount: 200 },
  { tf: "W", candleCount: 104 },
  { tf: "M", candleCount: 60 },
];

// ─── Database ───────────────────────────────────────────────────────────────

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    pool = new Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

// ─── Candle Fetching ────────────────────────────────────────────────────────

interface Candle {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchCandles(pair: string, timeframe: string, limit: number): Promise<Candle[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT time, open::float, high::float, low::float, close::float, volume::int
     FROM candles
     WHERE pair = $1 AND timeframe = $2
     ORDER BY time DESC
     LIMIT $3`,
    [pair, timeframe, limit]
  );

  return result.rows.reverse().map((row) => ({
    timestamp: new Date(row.time).getTime(),
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume || 0,
  }));
}

// ─── Swing Detection (simplified inline — mirrors lib/structure/swings.ts) ──

type SwingType = "high" | "low";
type StructureLabel = "HH" | "HL" | "LH" | "LL" | "EQH" | "EQL";

interface SwingPoint {
  timestamp: number;
  price: number;
  type: SwingType;
  label: StructureLabel | null;
  candleIndex: number;
  lookbackUsed: number;
  trueRange: number;
}

const LOOKBACK: Record<string, number> = {
  D: 8,
  W: 5,
  M: 3,
};

function detectSwings(candles: Candle[], timeframe: string): SwingPoint[] {
  const N = LOOKBACK[timeframe] || 5;
  const swings: SwingPoint[] = [];

  for (let i = N; i < candles.length - N; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= N; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
      if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
    }

    if (isHigh) {
      swings.push({
        timestamp: c.timestamp,
        price: c.high,
        type: "high",
        label: null,
        candleIndex: i,
        lookbackUsed: N,
        trueRange: c.high - c.low,
      });
    }

    if (isLow) {
      swings.push({
        timestamp: c.timestamp,
        price: c.low,
        type: "low",
        label: null,
        candleIndex: i,
        lookbackUsed: N,
        trueRange: c.high - c.low,
      });
    }
  }

  return swings.sort((a, b) => a.timestamp - b.timestamp);
}

function labelSwings(swings: SwingPoint[]): SwingPoint[] {
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  const eqTolerance = 0.0001; // 1 pip for most pairs

  for (const s of swings) {
    if (s.type === "high") {
      if (lastHigh === null) {
        s.label = "HH";
      } else if (s.price > lastHigh + eqTolerance) {
        s.label = "HH";
      } else if (s.price < lastHigh - eqTolerance) {
        s.label = "LH";
      } else {
        s.label = "EQH";
      }
      lastHigh = s.price;
    } else {
      if (lastLow === null) {
        s.label = "HL";
      } else if (s.price > lastLow + eqTolerance) {
        s.label = "HL";
      } else if (s.price < lastLow - eqTolerance) {
        s.label = "LL";
      } else {
        s.label = "EQL";
      }
      lastLow = s.price;
    }
  }

  return swings;
}

// ─── BOS Detection (simplified) ─────────────────────────────────────────────

type BOSDirection = "bullish" | "bearish";

interface BOSEvent {
  timestamp: number;
  direction: BOSDirection;
  status: "active" | "reclaimed";
  brokenLevel: number;
  brokenSwingTimestamp: number;
  confirmingClose: number;
  magnitudePips: number;
  isDisplacement: boolean;
  isCounterTrend: boolean;
}

function getPipMultiplier(pair: string): number {
  if (pair.includes("JPY")) return 100;
  if (pair.includes("XAU")) return 10;
  if (pair.includes("XAG")) return 100;
  if (pair.includes("SPX")) return 1;
  return 10000;
}

function detectBOS(candles: Candle[], swings: SwingPoint[], pair: string): BOSEvent[] {
  const events: BOSEvent[] = [];
  const pipMult = getPipMultiplier(pair);

  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows = swings.filter((s) => s.type === "low");

  // Check bearish BOS (close below swing low)
  for (const sl of swingLows) {
    for (const c of candles) {
      if (c.timestamp <= sl.timestamp) continue;
      if (c.close < sl.price) {
        events.push({
          timestamp: c.timestamp,
          direction: "bearish",
          status: "active",
          brokenLevel: sl.price,
          brokenSwingTimestamp: sl.timestamp,
          confirmingClose: c.close,
          magnitudePips: (sl.price - c.close) * pipMult,
          isDisplacement: false,
          isCounterTrend: false,
        });
        break;
      }
    }
  }

  // Check bullish BOS (close above swing high)
  for (const sh of swingHighs) {
    for (const c of candles) {
      if (c.timestamp <= sh.timestamp) continue;
      if (c.close > sh.price) {
        events.push({
          timestamp: c.timestamp,
          direction: "bullish",
          status: "active",
          brokenLevel: sh.price,
          brokenSwingTimestamp: sh.timestamp,
          confirmingClose: c.close,
          magnitudePips: (c.close - sh.price) * pipMult,
          isDisplacement: false,
          isCounterTrend: false,
        });
        break;
      }
    }
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Current Structure Derivation ───────────────────────────────────────────

type TrendDirection = "bullish" | "bearish" | "ranging";

interface CurrentStructure {
  direction: TrendDirection;
  lastBOS: BOSEvent | null;
  swingSequence: StructureLabel[];
}

function deriveCurrentStructure(swings: SwingPoint[], bosEvents: BOSEvent[]): CurrentStructure {
  const activeBOS = bosEvents.filter((e) => e.status === "active");
  const lastBOS = activeBOS.length > 0 ? activeBOS[activeBOS.length - 1] : null;

  const swingSequence: StructureLabel[] = swings
    .filter((s) => s.label !== null)
    .slice(-8)
    .map((s) => s.label!);

  let direction: TrendDirection = "ranging";
  if (lastBOS) {
    direction = lastBOS.direction;
  } else if (swingSequence.length >= 4) {
    const recent = swingSequence.slice(-4);
    const bullish = recent.filter((l) => l === "HH" || l === "HL").length;
    const bearish = recent.filter((l) => l === "LH" || l === "LL").length;
    if (bullish >= 3) direction = "bullish";
    else if (bearish >= 3) direction = "bearish";
  }

  return { direction, lastBOS, swingSequence };
}

// ─── Upsert to DB ──────────────────────────────────────────────────────────

async function upsertHTFStructure(
  pair: string,
  timeframe: string,
  structure: CurrentStructure
): Promise<void> {
  const db = getPool();

  await db.query(
    `INSERT INTO htf_current_structure (pair, timeframe, direction, last_bos_direction, last_bos_timestamp, last_bos_level, swing_sequence, computed_at)
     VALUES ($1, $2, $3, $4, ${structure.lastBOS ? "to_timestamp($5::double precision / 1000)" : "NULL"}, $6, $7, NOW())
     ON CONFLICT (pair, timeframe)
     DO UPDATE SET direction = EXCLUDED.direction,
       last_bos_direction = EXCLUDED.last_bos_direction,
       last_bos_timestamp = EXCLUDED.last_bos_timestamp,
       last_bos_level = EXCLUDED.last_bos_level,
       swing_sequence = EXCLUDED.swing_sequence,
       computed_at = NOW()`,
    [
      pair,
      timeframe,
      structure.direction,
      structure.lastBOS?.direction ?? null,
      structure.lastBOS?.timestamp ?? null,
      structure.lastBOS?.brokenLevel ?? null,
      structure.swingSequence,
    ]
  );
}

// ─── Main Entry ─────────────────────────────────────────────────────────────

export async function runHTFStructurePrecompute(): Promise<void> {
  let computed = 0;

  for (const pair of PAIRS) {
    for (const { tf, candleCount } of HTF_TIMEFRAMES) {
      try {
        const candles = await fetchCandles(pair, tf, candleCount);
        if (candles.length < 20) continue;

        const swings = labelSwings(detectSwings(candles, tf));
        const bos = detectBOS(candles, swings, pair);
        const structure = deriveCurrentStructure(swings, bos);

        await upsertHTFStructure(pair, tf, structure);
        computed++;
      } catch (err) {
        console.error(`[HTFStructure] Error for ${pair}/${tf}:`, err);
      }
    }
  }

  console.log(`[HTFStructure] Pre-computed ${computed} structures for ${PAIRS.length} pairs × ${HTF_TIMEFRAMES.length} TFs`);
}

// CLI entry
async function main() {
  console.log("[HTFStructure] Running manually...");
  await runHTFStructurePrecompute();
  console.log("[HTFStructure] Done");
  await pool?.end();
}

if (process.argv[1]?.endsWith("htf-structure-precompute.ts")) {
  main().catch(console.error);
}
