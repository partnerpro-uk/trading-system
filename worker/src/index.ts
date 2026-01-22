/**
 * OANDA Candle Sync Worker + JBlanked News Updater
 *
 * Fetches candles directly from OANDA's REST API for all pairs and timeframes.
 * Stores them in TimescaleDB for chart display.
 *
 * Also:
 * - Maintains a live price stream for real-time updates
 * - Fetches economic calendar from JBlanked API (hourly)
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";
import { forwardFill } from "./jblanked-news";

// Load env from parent .env.local
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

// Configuration
const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID!;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";
const OANDA_STREAM_URL = process.env.OANDA_STREAM_URL || "https://stream-fxpractice.oanda.com";
const TIMESCALE_URL = process.env.TIMESCALE_URL!;

// Pairs to sync
const PAIRS = [
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

type Pair = (typeof PAIRS)[number];

// Map our timeframes to OANDA granularities
const TIMEFRAME_MAP: Record<string, { oanda: string; intervalMs: number; count: number }> = {
  M1: { oanda: "M1", intervalMs: 60 * 1000, count: 100 },           // Sync every 1 min, fetch 100 candles
  M5: { oanda: "M5", intervalMs: 5 * 60 * 1000, count: 100 },       // Sync every 5 min
  M15: { oanda: "M15", intervalMs: 5 * 60 * 1000, count: 100 },     // Sync every 5 min (more frequent for live)
  M30: { oanda: "M30", intervalMs: 10 * 60 * 1000, count: 100 },    // Sync every 10 min
  H1: { oanda: "H1", intervalMs: 15 * 60 * 1000, count: 100 },      // Sync every 15 min
  H4: { oanda: "H4", intervalMs: 60 * 60 * 1000, count: 100 },      // Sync every 1 hour
  D: { oanda: "D", intervalMs: 4 * 60 * 60 * 1000, count: 100 },    // Sync every 4 hours
  W: { oanda: "W", intervalMs: 24 * 60 * 60 * 1000, count: 52 },    // Sync daily
  M: { oanda: "M", intervalMs: 24 * 60 * 60 * 1000, count: 24 },    // Sync daily
};

// Timescale connection pool
let pool: Pool;

// Track last sync time for each pair/timeframe
const lastSyncTime: Map<string, Date> = new Map();

interface OandaCandle {
  complete: boolean;
  volume: number;
  time: string;
  mid: {
    o: string;
    h: string;
    l: string;
    c: string;
  };
}

interface OandaCandlesResponse {
  instrument: string;
  granularity: string;
  candles: OandaCandle[];
}

/**
 * Fetch candles from OANDA REST API
 */
async function fetchCandlesFromOanda(
  pair: string,
  granularity: string,
  count: number
): Promise<OandaCandle[]> {
  const url = `${OANDA_API_URL}/v3/instruments/${pair}/candles?granularity=${granularity}&count=${count}&price=M`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API error: ${response.status} - ${text}`);
  }

  const data: OandaCandlesResponse = await response.json();
  return data.candles;
}

/**
 * Save multiple candles to TimescaleDB in a single batch
 */
async function saveCandlesBatch(
  candles: Array<{
    time: Date;
    pair: string;
    timeframe: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    complete: boolean;
  }>
): Promise<void> {
  if (candles.length === 0) return;

  // Build a multi-row INSERT
  const values: unknown[] = [];
  const placeholders: string[] = [];

  candles.forEach((c, i) => {
    const offset = i * 9;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
    );
    values.push(c.time, c.pair, c.timeframe, c.open, c.high, c.low, c.close, c.volume, c.complete);
  });

  await pool.query(
    `INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (time, pair, timeframe)
     DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       complete = EXCLUDED.complete`,
    values
  );
}

/**
 * Sync candles for a specific pair and timeframe
 */
async function syncCandles(pair: Pair, timeframe: string): Promise<number> {
  const config = TIMEFRAME_MAP[timeframe];
  if (!config) {
    console.warn(`Unknown timeframe: ${timeframe}`);
    return 0;
  }

  try {
    const candles = await fetchCandlesFromOanda(pair, config.oanda, config.count);

    // Convert to batch format
    const candleBatch = candles.map((candle) => ({
      time: new Date(candle.time),
      pair,
      timeframe,
      open: parseFloat(candle.mid.o),
      high: parseFloat(candle.mid.h),
      low: parseFloat(candle.mid.l),
      close: parseFloat(candle.mid.c),
      volume: candle.volume,
      complete: candle.complete,
    }));

    // Batch insert all candles at once
    await saveCandlesBatch(candleBatch);

    return candles.length;
  } catch (error) {
    console.error(`Error syncing ${pair} ${timeframe}:`, error);
    return 0;
  }
}

/**
 * Sync all pairs for a specific timeframe (parallel)
 */
async function syncTimeframe(timeframe: string): Promise<void> {
  console.log(`\nSyncing ${timeframe}...`);
  const startTime = Date.now();

  // Fetch all pairs in parallel
  const results = await Promise.all(
    PAIRS.map((pair) => syncCandles(pair, timeframe))
  );

  const totalCandles = results.reduce((sum, count) => sum + count, 0);
  const duration = Date.now() - startTime;
  console.log(`[${timeframe}] Synced ${totalCandles} candles for ${PAIRS.length} pairs in ${duration}ms`);
}

/**
 * Initial sync - fetch historical data for all timeframes (parallel)
 */
async function initialSync(): Promise<void> {
  console.log("\n=== Initial Sync (Parallel) ===\n");
  const startTime = Date.now();

  // Sync ALL timeframes in parallel (each timeframe also syncs all pairs in parallel)
  const timeframes = Object.keys(TIMEFRAME_MAP);
  await Promise.all(
    timeframes.map(async (timeframe) => {
      await syncTimeframe(timeframe);
      lastSyncTime.set(timeframe, new Date());
    })
  );

  const duration = Date.now() - startTime;
  console.log(`\n=== Initial Sync Complete in ${(duration / 1000).toFixed(1)}s ===\n`);
}

/**
 * Start periodic sync loops for each timeframe
 */
function startSyncLoops(): void {
  for (const [timeframe, config] of Object.entries(TIMEFRAME_MAP)) {
    // Calculate time until next sync boundary
    const now = Date.now();
    const msUntilNext = config.intervalMs - (now % config.intervalMs);

    // Start at the next boundary, then repeat on interval
    setTimeout(() => {
      // Immediate sync at boundary
      syncTimeframe(timeframe).then(() => {
        lastSyncTime.set(timeframe, new Date());
      });

      // Then repeat on interval
      setInterval(async () => {
        await syncTimeframe(timeframe);
        lastSyncTime.set(timeframe, new Date());
      }, config.intervalMs);
    }, msUntilNext);

    console.log(`[${timeframe}] Sync loop scheduled: every ${config.intervalMs / 1000}s, starting in ${Math.round(msUntilNext / 1000)}s`);
  }
}

/**
 * Live price stream for real-time updates
 * (Keeps the current candle updated between syncs)
 */
async function startPriceStream(): Promise<void> {
  const instruments = PAIRS.join(",");
  const url = `${OANDA_STREAM_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing/stream?instruments=${instruments}`;

  console.log("\nStarting live price stream...");

  while (true) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${OANDA_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Stream failed: ${response.status} - ${text}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      console.log("Price stream connected!");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastHeartbeat = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream ended");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);

            if (data.type === "PRICE") {
              // Log price updates occasionally (every 30 seconds per pair)
              const now = Date.now();
              if (now - lastHeartbeat > 30000) {
                const bid = parseFloat(data.bids?.[0]?.price || "0");
                const ask = parseFloat(data.asks?.[0]?.price || "0");
                const mid = (bid + ask) / 2;
                console.log(`[${data.instrument}] ${mid.toFixed(5)} (bid: ${bid.toFixed(5)}, ask: ${ask.toFixed(5)})`);
                lastHeartbeat = now;
              }
            } else if (data.type === "HEARTBEAT") {
              // Heartbeat - connection is alive
              process.stdout.write(".");
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (error) {
      console.error("Stream error:", error);
    }

    // Wait before reconnecting
    console.log("\nReconnecting stream in 5 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main(): Promise<void> {
  console.log("================================================");
  console.log("  OANDA Candle Sync Worker");
  console.log("================================================\n");

  // Validate config
  if (!OANDA_API_KEY) {
    console.error("Missing OANDA_API_KEY");
    process.exit(1);
  }
  if (!OANDA_ACCOUNT_ID) {
    console.error("Missing OANDA_ACCOUNT_ID");
    process.exit(1);
  }
  if (!TIMESCALE_URL) {
    console.error("Missing TIMESCALE_URL");
    process.exit(1);
  }

  console.log(`API URL: ${OANDA_API_URL}`);
  console.log(`Pairs: ${PAIRS.join(", ")}`);
  console.log(`Timeframes: ${Object.keys(TIMEFRAME_MAP).join(", ")}`);

  // Connect to Timescale (increased pool for parallel ops)
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
    max: 20,
  });

  try {
    const result = await pool.query("SELECT NOW()");
    console.log(`\nConnected to TimescaleDB at ${result.rows[0].now}`);
  } catch (err) {
    console.error("Failed to connect to TimescaleDB:", err);
    process.exit(1);
  }

  // Initial sync
  await initialSync();

  // Start periodic sync loops
  startSyncLoops();

  // Start live price stream (runs in background)
  startPriceStream().catch(console.error);

  // Start JBlanked news updater (runs every hour)
  startNewsUpdater();

  // Keep process alive
  console.log("\nWorker running. Press Ctrl+C to stop.\n");
}

/**
 * Start JBlanked news updater on hourly schedule
 */
function startNewsUpdater(): void {
  const NEWS_UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour

  // Run immediately on startup
  console.log("\n[News] Running initial news update...");
  forwardFill().catch((err) => {
    console.error("[News] Initial update failed:", err);
  });

  // Then run every hour
  setInterval(async () => {
    console.log("\n[News] Running hourly news update...");
    try {
      await forwardFill();
      console.log("[News] Update complete");
    } catch (err) {
      console.error("[News] Update failed:", err);
    }
  }, NEWS_UPDATE_INTERVAL);

  console.log(`[News] Scheduled hourly updates (every ${NEWS_UPDATE_INTERVAL / 60000} minutes)`);
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await pool?.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nTerminating...");
  await pool?.end();
  process.exit(0);
});

main().catch(console.error);
