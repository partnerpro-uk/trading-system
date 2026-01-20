import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import fs from "fs";

config({ path: ".env.local" });

async function test() {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const record = JSON.parse(fs.readFileSync("data/candle-windows.jsonl", "utf8").split("\n")[0]);

  console.log("Record keys:", Object.keys(record));
  console.log("Candles count:", record.candles?.length);
  console.log("First candle:", record.candles?.[0]);

  try {
    const result = await client.mutation(api.newsEvents.uploadEventCandleWindow, record);
    console.log("Success!", result);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
