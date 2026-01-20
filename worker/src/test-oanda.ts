/**
 * Test OANDA API candle fetch
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

async function testFetch() {
  console.log("Testing OANDA API...");
  console.log("URL:", OANDA_API_URL);

  const url = `${OANDA_API_URL}/v3/instruments/GBP_USD/candles?granularity=M15&count=10&price=M`;
  console.log("Fetching:", url);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${OANDA_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log("Status:", response.status);

    if (!response.ok) {
      const text = await response.text();
      console.log("Error:", text);
      return;
    }

    const data = await response.json();
    console.log("Instrument:", data.instrument);
    console.log("Granularity:", data.granularity);
    console.log("Candles:", data.candles.length);

    // Show all candles
    for (const c of data.candles) {
      console.log(
        `  ${c.time} O:${c.mid.o} H:${c.mid.h} L:${c.mid.l} C:${c.mid.c} complete:${c.complete}`
      );
    }
  } catch (error) {
    console.error("Fetch error:", error);
  }
}

testFetch().catch(console.error);
