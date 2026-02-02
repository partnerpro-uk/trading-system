import { NextResponse } from "next/server";
import { getLatestPrices } from "@/lib/db/candles";

// All tradeable pairs
const PAIRS = [
  "DXY",
  "SPX500_USD",
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "XAU_USD",
  "XAG_USD",
  "BTC_USD",
];

/**
 * GET /api/prices
 *
 * Returns latest prices for all pairs with change data.
 * Used by the sidebar to display live prices next to pair names.
 *
 * Response format:
 * {
 *   "EUR_USD": { price: 1.17245, change: 0.0012, changePercent: 0.10, timestamp: 1234567890 },
 *   "GBP_USD": { price: 1.34671, change: -0.0005, changePercent: -0.04, timestamp: 1234567890 },
 *   ...
 * }
 */
export async function GET() {
  try {
    const prices = await getLatestPrices(PAIRS);

    return NextResponse.json(prices, {
      headers: {
        // Cache for 5 seconds to reduce DB load
        "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
      },
    });
  } catch (error) {
    console.error("Error fetching prices:", error);
    return NextResponse.json(
      { error: "Failed to fetch prices" },
      { status: 500 }
    );
  }
}
