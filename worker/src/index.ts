/**
 * OANDA Candle Sync Worker + JBlanked News Updater
 *
 * Fetches candles directly from OANDA's REST API for all pairs and timeframes.
 * Stores them in TimescaleDB for chart display.
 *
 * Also:
 * - Maintains a live price stream for real-time updates
 * - Fetches economic calendar from JBlanked API (hourly)
 * - Exposes authenticated SSE endpoint for live price streaming
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { createHash } from "crypto";
import { forwardFill } from "./jblanked-news";
import { runCaretaker } from "./gap-caretaker";
import { processEventReactions } from "./event-reaction-processor";
import { fetchLatestCOT } from "./cot-data";
import { runFVGFillTracker } from "./fvg-fill-tracker";
import { runMacroRangeUpdater } from "./macro-range-updater";
import { runHTFStructurePrecompute } from "./htf-structure-precompute";
import { runIncrementalBackfill } from "./structure-backfill";
import { runStructureArchival } from "./structure-archiver";
import { runStructureAlerts } from "./structure-alerts";
import { runNewsAlerts } from "./news-alerts";
import { runPriceAlerts } from "./price-alerts";

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
  "XAG_USD",
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

// ═══════════════════════════════════════════════════════════════════════════════
// SSE STREAMING - Live price streaming to authenticated clients
// ═══════════════════════════════════════════════════════════════════════════════

const SSE_PORT = parseInt(process.env.PORT || "3001");

// Store latest prices in memory
interface LivePrice {
  pair: string;
  bid: number;
  ask: number;
  mid: number;
  time: string;
}
export const latestPrices: Map<string, LivePrice> = new Map();

// Connected SSE clients
interface SSEClient {
  res: ServerResponse;
  pairs: string[] | null; // null = all pairs
  keyId: string;
}
const sseClients: Set<SSEClient> = new Set();

// API key cache (avoid DB hit on every validation)
const apiKeyCache: Map<string, { valid: boolean; keyId: string; expiresAt: number }> = new Map();
const KEY_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Hash an API key for lookup
 */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate API key against TimescaleDB
 */
async function validateApiKey(key: string): Promise<{ valid: boolean; keyId: string }> {
  if (!key || !key.startsWith("trd_")) {
    return { valid: false, keyId: "" };
  }

  const hash = hashApiKey(key);

  // Check cache
  const cached = apiKeyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return { valid: cached.valid, keyId: cached.keyId };
  }

  // Query database
  try {
    const result = await pool.query(
      `SELECT id, is_active, expires_at FROM api_keys WHERE key_hash = $1`,
      [hash]
    );

    if (result.rows.length === 0) {
      apiKeyCache.set(hash, { valid: false, keyId: "", expiresAt: Date.now() + KEY_CACHE_TTL });
      return { valid: false, keyId: "" };
    }

    const row = result.rows[0];
    const isValid = row.is_active && (!row.expires_at || new Date(row.expires_at) > new Date());

    apiKeyCache.set(hash, { valid: isValid, keyId: row.id, expiresAt: Date.now() + KEY_CACHE_TTL });
    return { valid: isValid, keyId: row.id };
  } catch (err) {
    console.error("[SSE] Error validating API key:", err);
    return { valid: false, keyId: "" };
  }
}

/**
 * Broadcast price update to all connected SSE clients
 */
function broadcastPrice(price: LivePrice): void {
  const data = `data: ${JSON.stringify(price)}\n\n`;

  for (const client of sseClients) {
    // Filter by pairs if specified
    if (client.pairs === null || client.pairs.includes(price.pair)) {
      try {
        client.res.write(data);
      } catch {
        // Client disconnected, will be cleaned up
        sseClients.delete(client);
      }
    }
  }
}

/**
 * Handle SSE connection request
 */
async function handleSSERequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Parse API key from query or header
  const apiKey = url.searchParams.get("api_key") || req.headers["x-api-key"] as string;

  if (!apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing API key" }));
    return;
  }

  const validation = await validateApiKey(apiKey);
  if (!validation.valid) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid API key" }));
    return;
  }

  // Parse pairs filter (optional)
  const pairsParam = url.searchParams.get("pairs");
  const pairs = pairsParam ? pairsParam.split(",").map(p => p.trim().toUpperCase()) : null;

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial prices
  res.write(`event: connected\ndata: ${JSON.stringify({ message: "Connected to price stream", pairs: pairs || "all" })}\n\n`);

  // Send current prices
  for (const [, price] of latestPrices) {
    if (pairs === null || pairs.includes(price.pair)) {
      res.write(`data: ${JSON.stringify(price)}\n\n`);
    }
  }

  // Register client
  const client: SSEClient = { res, pairs, keyId: validation.keyId };
  sseClients.add(client);
  console.log(`[SSE] Client connected (total: ${sseClients.size})`);

  // Handle disconnect
  req.on("close", () => {
    sseClients.delete(client);
    console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
  });
}

/**
 * Start HTTP server for SSE endpoint
 */
function startHTTPServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "X-API-Key",
      });
      res.end();
      return;
    }

    // Health check
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: sseClients.size, prices: latestPrices.size }));
      return;
    }

    // SSE stream endpoint
    if (url.pathname === "/stream/prices") {
      await handleSSERequest(req, res);
      return;
    }

    // Latest prices (REST endpoint)
    if (url.pathname === "/prices") {
      const apiKey = url.searchParams.get("api_key") || req.headers["x-api-key"] as string;
      if (!apiKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing API key" }));
        return;
      }
      const validation = await validateApiKey(apiKey);
      if (!validation.valid) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid API key" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(Object.fromEntries(latestPrices)));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(SSE_PORT, "0.0.0.0", () => {
    console.log(`\n[SSE] HTTP server listening on 0.0.0.0:${SSE_PORT}`);
    console.log(`[SSE] Stream endpoint: /stream/prices?api_key=trd_xxx`);
    console.log(`[SSE] Prices endpoint: /prices?api_key=trd_xxx`);
  });
}

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
              const bid = parseFloat(data.bids?.[0]?.price || "0");
              const ask = parseFloat(data.asks?.[0]?.price || "0");
              const mid = (bid + ask) / 2;

              // Store and broadcast price
              const price: LivePrice = {
                pair: data.instrument,
                bid,
                ask,
                mid,
                time: data.time,
              };
              latestPrices.set(data.instrument, price);
              broadcastPrice(price);

              // Log price updates occasionally (every 30 seconds)
              const now = Date.now();
              if (now - lastHeartbeat > 30000) {
                console.log(`[${data.instrument}] ${mid.toFixed(5)} (bid: ${bid.toFixed(5)}, ask: ${ask.toFixed(5)}) [${sseClients.size} clients]`);
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
  // Start HTTP server FIRST - before anything else, so health checks pass
  startHTTPServer();

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

  // Initial sync (runs while health check is available)
  await initialSync();

  // Start periodic sync loops
  startSyncLoops();

  // Start live price stream (runs in background, broadcasts to SSE clients)
  startPriceStream().catch(console.error);

  // Start JBlanked news updater (runs every hour)
  startNewsUpdater();

  // Start gap caretaker (runs every 6 hours)
  startGapCaretaker();

  // Start event reaction processor (runs every 15 minutes)
  startEventReactionProcessor();

  // Start COT data updater (checks every 6 hours, data updates weekly)
  startCOTUpdater();

  // Start FVG fill tracker (runs every 5 minutes)
  startFVGFillTracker();

  // Start macro range updater (runs daily, startup + 24h)
  startMacroRangeUpdater();

  // Start HTF structure pre-computation (runs every 4 hours)
  startHTFStructurePrecompute();

  // Start structure backfill (daily incremental, processes current month)
  startStructureBackfill();

  // Start structure archival (daily, moves >30d data to ClickHouse)
  startStructureArchiver();

  // Start alert jobs (structure, news, price)
  startStructureAlertJob();
  startNewsAlertJob();
  startPriceAlertJob();

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

/**
 * Start gap caretaker on 6-hour schedule
 * Detects and fills missing candle data across all pairs/timeframes
 */
function startGapCaretaker(): void {
  const CARETAKER_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

  // Run after 5 minutes (let other syncs complete first)
  setTimeout(() => {
    console.log("\n[Caretaker] Running initial gap scan...");
    runCaretaker().catch((err) => {
      console.error("[Caretaker] Initial scan failed:", err);
    });
  }, 5 * 60 * 1000);

  // Then run every 6 hours
  setInterval(async () => {
    console.log("\n[Caretaker] Running scheduled gap scan...");
    try {
      await runCaretaker();
      console.log("[Caretaker] Scan complete");
    } catch (err) {
      console.error("[Caretaker] Scan failed:", err);
    }
  }, CARETAKER_INTERVAL);

  console.log(`[Caretaker] Scheduled gap scans (every ${CARETAKER_INTERVAL / (60 * 60 * 1000)} hours, first run in 5 minutes)`);
}

/**
 * Start event reaction processor on 15-minute schedule
 * Processes news events to capture price reactions in real-time
 */
function startEventReactionProcessor(): void {
  const REACTION_INTERVAL = 15 * 60 * 1000; // 15 minutes

  // Run after 2 minutes (let initial sync complete first)
  setTimeout(() => {
    console.log("\n[EventReactions] Running initial reaction processing...");
    processEventReactions().catch((err) => {
      console.error("[EventReactions] Initial processing failed:", err);
    });
  }, 2 * 60 * 1000);

  // Then run every 15 minutes
  setInterval(async () => {
    console.log("\n[EventReactions] Running scheduled reaction processing...");
    try {
      await processEventReactions();
      console.log("[EventReactions] Processing complete");
    } catch (err) {
      console.error("[EventReactions] Processing failed:", err);
    }
  }, REACTION_INTERVAL);

  console.log(`[EventReactions] Scheduled reaction processing (every ${REACTION_INTERVAL / (60 * 1000)} minutes, first run in 2 minutes)`);
}

/**
 * Start COT data updater on 6-hour schedule
 * CFTC releases data weekly on Friday, but we check every 6 hours
 * to ensure we catch it even if one fetch fails
 */
function startCOTUpdater(): void {
  const COT_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

  // Run after 3 minutes (let other syncs complete first)
  setTimeout(() => {
    console.log("\n[COT] Running initial COT data check...");
    fetchLatestCOT().catch((err) => {
      console.error("[COT] Initial fetch failed:", err);
    });
  }, 3 * 60 * 1000);

  // Then check every 6 hours
  setInterval(async () => {
    console.log("\n[COT] Checking for new COT data...");
    try {
      await fetchLatestCOT();
      console.log("[COT] Update complete");
    } catch (err) {
      console.error("[COT] Update failed:", err);
    }
  }, COT_CHECK_INTERVAL);

  console.log(`[COT] Scheduled COT updates (every 6 hours, first run in 3 minutes)`);
}

/**
 * Start FVG fill tracker on 5-minute schedule.
 * Updates fill percentages for active FVGs across all pairs/timeframes.
 */
function startFVGFillTracker(): void {
  const FVG_FILL_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Run after 4 minutes (let candle syncs complete first)
  setTimeout(() => {
    console.log("\n[FVGFillTracker] Running initial FVG fill check...");
    runFVGFillTracker().catch((err) => {
      console.error("[FVGFillTracker] Initial run failed:", err);
    });
  }, 4 * 60 * 1000);

  // Then run every 5 minutes
  setInterval(async () => {
    try {
      await runFVGFillTracker();
    } catch (err) {
      console.error("[FVGFillTracker] Update failed:", err);
    }
  }, FVG_FILL_INTERVAL);

  console.log(`[FVGFillTracker] Scheduled FVG fill tracking (every 5 minutes, first run in 4 minutes)`);
}

/**
 * Start macro range updater on daily schedule.
 * Computes all-time high/low from ClickHouse for Premium/Discount.
 */
function startMacroRangeUpdater(): void {
  const MACRO_RANGE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  // Run after 6 minutes (let other syncs complete first)
  setTimeout(() => {
    console.log("\n[MacroRange] Running initial macro range computation...");
    runMacroRangeUpdater().catch((err) => {
      console.error("[MacroRange] Initial run failed:", err);
    });
  }, 6 * 60 * 1000);

  // Then run daily
  setInterval(async () => {
    console.log("\n[MacroRange] Running daily macro range update...");
    try {
      await runMacroRangeUpdater();
    } catch (err) {
      console.error("[MacroRange] Update failed:", err);
    }
  }, MACRO_RANGE_INTERVAL);

  console.log(`[MacroRange] Scheduled macro range updates (daily, first run in 6 minutes)`);
}

/**
 * Start HTF structure pre-computation on 4-hour schedule.
 * Computes D/W/M CurrentStructure for fast MTF scoring lookups.
 */
function startHTFStructurePrecompute(): void {
  const HTF_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

  // Run after 5 minutes (let candle syncs complete first)
  setTimeout(() => {
    console.log("\n[HTFStructure] Running initial structure pre-computation...");
    runHTFStructurePrecompute().catch((err) => {
      console.error("[HTFStructure] Initial run failed:", err);
    });
  }, 5 * 60 * 1000);

  // Then run every 4 hours
  setInterval(async () => {
    console.log("\n[HTFStructure] Running scheduled structure pre-computation...");
    try {
      await runHTFStructurePrecompute();
    } catch (err) {
      console.error("[HTFStructure] Pre-computation failed:", err);
    }
  }, HTF_INTERVAL);

  console.log(`[HTFStructure] Scheduled structure pre-computation (every 4 hours, first run in 5 minutes)`);
}

/**
 * Start structure backfill on daily schedule.
 * Processes current month's candle data through structure engine.
 */
function startStructureBackfill(): void {
  const BACKFILL_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  // Run after 8 minutes (let candle syncs complete first)
  setTimeout(() => {
    console.log("\n[StructureBackfill] Running initial incremental backfill...");
    runIncrementalBackfill().catch((err) => {
      console.error("[StructureBackfill] Initial run failed:", err);
    });
  }, 8 * 60 * 1000);

  // Then run daily
  setInterval(async () => {
    console.log("\n[StructureBackfill] Running daily incremental backfill...");
    try {
      await runIncrementalBackfill();
    } catch (err) {
      console.error("[StructureBackfill] Daily run failed:", err);
    }
  }, BACKFILL_INTERVAL);

  console.log(`[StructureBackfill] Scheduled incremental backfill (daily, first run in 8 minutes)`);
}

/**
 * Start structure archival on daily schedule.
 * Moves expired TimescaleDB structure data (>30d) to ClickHouse.
 */
function startStructureArchiver(): void {
  const ARCHIVAL_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  // Run after 10 minutes (let other jobs settle first)
  setTimeout(() => {
    console.log("\n[StructureArchiver] Running initial archival...");
    runStructureArchival().catch((err) => {
      console.error("[StructureArchiver] Initial run failed:", err);
    });
  }, 10 * 60 * 1000);

  // Then run daily
  setInterval(async () => {
    console.log("\n[StructureArchiver] Running daily archival...");
    try {
      await runStructureArchival();
    } catch (err) {
      console.error("[StructureArchiver] Daily run failed:", err);
    }
  }, ARCHIVAL_INTERVAL);

  console.log(`[StructureArchiver] Scheduled structure archival (daily, first run in 10 minutes)`);
}

/**
 * Start structure alert job on 60-second schedule.
 * Detects BOS, FVG fill, counter-trend changes → Convex alerts.
 */
function startStructureAlertJob(): void {
  const INTERVAL = 60 * 1000; // 60 seconds

  setTimeout(() => {
    console.log("\n[StructureAlerts] Running initial structure alert check...");
    runStructureAlerts().catch((err) => {
      console.error("[StructureAlerts] Initial run failed:", err);
    });
  }, 2 * 60 * 1000);

  setInterval(async () => {
    try {
      await runStructureAlerts();
    } catch (err) {
      console.error("[StructureAlerts] Check failed:", err);
    }
  }, INTERVAL);

  console.log(`[StructureAlerts] Scheduled structure alerts (every 60s, first run in 2 minutes)`);
}

/**
 * Start news alert job on 60-second schedule.
 * 15-min warnings for high-impact events.
 */
function startNewsAlertJob(): void {
  const INTERVAL = 60 * 1000; // 60 seconds

  setTimeout(() => {
    console.log("\n[NewsAlerts] Running initial news alert check...");
    runNewsAlerts().catch((err) => {
      console.error("[NewsAlerts] Initial run failed:", err);
    });
  }, 3 * 60 * 1000);

  setInterval(async () => {
    try {
      await runNewsAlerts();
    } catch (err) {
      console.error("[NewsAlerts] Check failed:", err);
    }
  }, INTERVAL);

  console.log(`[NewsAlerts] Scheduled news alerts (every 60s, first run in 3 minutes)`);
}

/**
 * Start price alert job on 30-second schedule.
 * Checks price level crossings and TP/SL proximity.
 */
function startPriceAlertJob(): void {
  const INTERVAL = 30 * 1000; // 30 seconds

  setTimeout(() => {
    console.log("\n[PriceAlerts] Running initial price alert check...");
    runPriceAlerts(latestPrices).catch((err) => {
      console.error("[PriceAlerts] Initial run failed:", err);
    });
  }, 1 * 60 * 1000);

  setInterval(async () => {
    try {
      await runPriceAlerts(latestPrices);
    } catch (err) {
      console.error("[PriceAlerts] Check failed:", err);
    }
  }, INTERVAL);

  console.log(`[PriceAlerts] Scheduled price alerts (every 30s, first run in 1 minute)`);
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
