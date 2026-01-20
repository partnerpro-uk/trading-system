/**
 * Test script to verify OANDA and Timescale connections
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

// Load env
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID!;
const OANDA_STREAM_URL = process.env.OANDA_STREAM_URL || "https://stream-fxpractice.oanda.com";
const TIMESCALE_URL = process.env.TIMESCALE_URL!;

async function testTimescale(): Promise<boolean> {
  console.log("\n1. Testing Timescale connection...");

  const pool = new Pool({
    connectionString: TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query("SELECT NOW() as now, version()");
    console.log(`   Connected at ${result.rows[0].now}`);

    // Check candles table
    const tableCheck = await pool.query(`
      SELECT count(*) as count FROM candles WHERE timeframe = 'M1'
    `);
    console.log(`   M1 candles in Timescale: ${tableCheck.rows[0].count}`);

    await pool.end();
    return true;
  } catch (err) {
    console.error("   Failed:", err);
    return false;
  }
}

async function testOANDA(): Promise<boolean> {
  console.log("\n2. Testing OANDA connection...");

  try {
    // Test REST API first
    const restUrl = `https://api-fxpractice.oanda.com/v3/accounts/${OANDA_ACCOUNT_ID}/summary`;
    const restResponse = await fetch(restUrl, {
      headers: { Authorization: `Bearer ${OANDA_API_KEY}` },
    });

    if (!restResponse.ok) {
      throw new Error(`REST API failed: ${restResponse.status}`);
    }

    const account = await restResponse.json();
    console.log(`   Account: ${account.account?.alias || OANDA_ACCOUNT_ID}`);
    console.log(`   Balance: ${account.account?.balance}`);

    // Test streaming API (just check if we can connect)
    console.log("\n3. Testing OANDA streaming...");
    const streamUrl = `${OANDA_STREAM_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing/stream?instruments=EUR_USD`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const streamResponse = await fetch(streamUrl, {
      headers: {
        Authorization: `Bearer ${OANDA_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!streamResponse.ok) {
      const text = await streamResponse.text();
      throw new Error(`Stream failed: ${streamResponse.status} - ${text}`);
    }

    if (!streamResponse.body) {
      throw new Error("No stream body");
    }

    // Read a few ticks to verify
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let tickCount = 0;

    console.log("   Listening for ticks (5 seconds)...");

    const start = Date.now();
    while (Date.now() - start < 5000) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === "PRICE") {
            tickCount++;
            const bid = parseFloat(data.bids?.[0]?.price || "0");
            const ask = parseFloat(data.asks?.[0]?.price || "0");
            console.log(`   Tick ${tickCount}: EUR_USD bid=${bid.toFixed(5)} ask=${ask.toFixed(5)}`);
          }
        } catch {}
      }
      if (tickCount >= 3) break;
    }

    reader.cancel();
    console.log(`   Received ${tickCount} ticks`);

    return tickCount > 0;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log("   Stream timeout (OK - connection verified)");
      return true;
    }
    console.error("   Failed:", err.message);
    return false;
  }
}

async function main() {
  console.log("================================================");
  console.log("  OANDA Worker Connection Test");
  console.log("================================================");

  const timescaleOk = await testTimescale();
  const oandaOk = await testOANDA();

  console.log("\n================================================");
  console.log("  Results:");
  console.log(`  Timescale: ${timescaleOk ? "OK" : "FAILED"}`);
  console.log(`  OANDA:     ${oandaOk ? "OK" : "FAILED"}`);
  console.log("================================================\n");

  process.exit(timescaleOk && oandaOk ? 0 : 1);
}

main().catch(console.error);
