/**
 * API Route: Trades
 *
 * REST API for trade journal operations.
 * This API wraps Convex functions for use in server contexts.
 * For client-side use, interact directly with Convex via useQuery/useMutation.
 */

import { NextRequest, NextResponse } from "next/server";

// Note: Trade data is stored in Convex.
// For client-side React components, use the Convex hooks directly:
//   import { useQuery, useMutation } from "convex/react";
//   import { api } from "@/convex/_generated/api";
//
//   const trades = useQuery(api.trades.getTrades, { limit: 50 });
//   const createTrade = useMutation(api.trades.createTrade);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const strategyId = searchParams.get("strategyId");
  const pair = searchParams.get("pair");
  const status = searchParams.get("status");
  const limit = searchParams.get("limit");

  // Return info about using Convex directly
  return NextResponse.json({
    note: "Use Convex directly for trade operations.",
    usage: {
      client: "Use useQuery(api.trades.getTrades, { ... }) in React components",
      mutations: [
        "api.trades.createTrade",
        "api.trades.closeTrade",
        "api.trades.updateTrade",
        "api.trades.cancelTrade",
        "api.trades.deleteTrade",
      ],
      queries: [
        "api.trades.getTrades",
        "api.trades.getTradesByStrategy",
        "api.trades.getTradesByPair",
        "api.trades.getOpenTrades",
        "api.trades.getTrade",
        "api.trades.getTradeStats",
      ],
    },
    params: {
      strategyId,
      pair,
      status,
      limit: limit ? parseInt(limit) : 100,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const required = [
      "strategyId",
      "pair",
      "timeframe",
      "direction",
      "entryTime",
      "entryPrice",
      "stopLoss",
      "takeProfit",
    ];

    const missing = required.filter((field) => !(field in body));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // For server-side trade creation, use Convex HTTP client or internal action
    // For now, return info about using Convex directly
    return NextResponse.json({
      note: "For trade creation, use Convex mutation: api.trades.createTrade",
      received: body,
    });
  } catch (error) {
    console.error("Failed to process trade:", error);
    return NextResponse.json(
      { error: "Failed to process trade" },
      { status: 500 }
    );
  }
}
