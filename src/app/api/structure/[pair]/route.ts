/**
 * Market Structure API
 *
 * GET /api/structure/[pair]?timeframe=H4&depth=100
 *
 * Computes market structure on-demand: swing points, BOS events,
 * sweep events, key levels, and current trend state.
 * Results are cached in-memory with timeframe-scaled TTL and
 * persisted to TimescaleDB in the background.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestCandles } from "@/lib/db/candles";
import {
  computeStructure,
  detectSwings,
  labelSwings,
  detectBOS,
  deriveCurrentStructure,
  REQUIRED_DEPTH,
} from "@/lib/structure";
import type { CurrentStructure } from "@/lib/structure";
import {
  upsertSwingPoints,
  upsertBOSEvents,
  upsertSweepEvents,
  upsertKeyLevels,
  upsertFVGEvents,
} from "@/lib/db/structure";
import { getMacroRange } from "@/lib/db/clickhouse-structure";
import { getLatestCOTForPair } from "@/lib/db/cot";
import { getUpcomingEvents } from "@/lib/db/news";
import type { Candle } from "@/lib/db/candles";

// In-memory cache with TTL
const cache = new Map<string, { data: unknown; expiresAt: number }>();

const TTL_MAP: Record<string, number> = {
  M15: 60_000,
  M30: 60_000,
  H1: 180_000,
  H4: 300_000,
  D: 900_000,
  D1: 900_000,
  W: 900_000,
  W1: 900_000,
  M: 900_000,
  MN: 900_000,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const searchParams = request.nextUrl.searchParams;
  const timeframe = searchParams.get("timeframe") || "H4";
  const depth = parseInt(searchParams.get("depth") || "0", 10);
  const enrich = searchParams.get("enrich") === "true";

  // Check cache (enrich requests use separate cache key)
  const cacheKey = `${pair}:${timeframe}${enrich ? ":enriched" : ""}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch candles: requested TF + D/W/M for key levels + H4 for P/D (parallel)
    const candleDepth = depth || REQUIRED_DEPTH[timeframe] || 500;
    const needH4 = timeframe !== "H4";

    const [candles, dailyCandles, weeklyCandles, monthlyCandles, h4Candles, macroRange] =
      await Promise.all([
        getLatestCandles(pair, timeframe, candleDepth),
        getLatestCandles(pair, "D", 200),
        getLatestCandles(pair, "W", 104),
        getLatestCandles(pair, "M", 60),
        needH4 ? getLatestCandles(pair, "H4", 500) : Promise.resolve(null),
        getMacroRange(pair).catch(() => null),
      ]);

    if (!candles || candles.length === 0) {
      return NextResponse.json(
        { error: "No candle data available", pair, timeframe },
        { status: 404 }
      );
    }

    // Compute D1/W1 swings for Premium/Discount (sub-ms, pure functions)
    const d1Swings = dailyCandles && dailyCandles.length > 0
      ? labelSwings(detectSwings(dailyCandles as Candle[], "D"), dailyCandles as Candle[])
      : [];
    const w1Swings = weeklyCandles && weeklyCandles.length > 0
      ? labelSwings(detectSwings(weeklyCandles as Candle[], "W"), weeklyCandles as Candle[])
      : [];
    const h4Swings = needH4 && h4Candles && h4Candles.length > 0
      ? labelSwings(detectSwings(h4Candles as Candle[], "H4"), h4Candles as Candle[])
      : undefined; // undefined = use current TF swings if H4

    // Enrichment: compute HTF structures + fetch COT/events (when enrich=true)
    let htfStructures: Record<string, CurrentStructure> | undefined;
    let cotData: { direction: string; percentile: number } | null | undefined;
    let upcomingEvents: { name: string; impact: string; timestamp: number }[] | undefined;

    if (enrich) {
      // Build HTF CurrentStructure for each available TF
      htfStructures = {};

      // Monthly structure
      if (monthlyCandles && monthlyCandles.length > 20) {
        const mSwings = labelSwings(detectSwings(monthlyCandles as Candle[], "M"), monthlyCandles as Candle[]);
        const mBos = detectBOS(monthlyCandles as Candle[], mSwings, pair);
        htfStructures["M"] = deriveCurrentStructure(mSwings, mBos);
      }

      // Weekly structure
      if (weeklyCandles && weeklyCandles.length > 20) {
        const wBos = detectBOS(weeklyCandles as Candle[], w1Swings, pair);
        htfStructures["W"] = deriveCurrentStructure(w1Swings, wBos);
      }

      // Daily structure
      if (dailyCandles && dailyCandles.length > 20) {
        const dBos = detectBOS(dailyCandles as Candle[], d1Swings, pair);
        htfStructures["D"] = deriveCurrentStructure(d1Swings, dBos);
      }

      // H4 structure (if we have H4 candles and current TF is lower)
      if (h4Swings && h4Candles && h4Candles.length > 20) {
        const h4Bos = detectBOS(h4Candles as Candle[], h4Swings, pair);
        htfStructures["H4"] = deriveCurrentStructure(h4Swings, h4Bos);
      }

      // Fetch COT + events in parallel
      const currency = pair.split("_")[0];
      const [cotResult, eventsResult] = await Promise.all([
        getLatestCOTForPair(pair).catch(() => null),
        getUpcomingEvents(currency, 4, "high").catch(() => []),
      ]);

      if (cotResult) {
        cotData = {
          direction: cotResult.sentiment.sentiment === "neutral" ? "neutral" : cotResult.sentiment.sentiment,
          percentile: cotResult.lev_money_percentile,
        };
      }

      if (eventsResult.length > 0) {
        upcomingEvents = eventsResult.map((e) => ({
          name: e.name,
          impact: e.impact || "medium",
          timestamp: e.timestamp,
        }));
      }
    }

    // Compute structure (pure functions, no DB)
    const result = computeStructure(
      pair,
      timeframe,
      candles as Candle[],
      (dailyCandles || []) as Candle[],
      (weeklyCandles || []) as Candle[],
      (monthlyCandles || []) as Candle[],
      {
        h4Swings,
        d1Swings,
        w1Swings,
        macroRange,
        htfStructures,
        cotData,
        upcomingEvents,
        enableEnrichment: enrich,
      }
    );

    // Persist to TimescaleDB (fire-and-forget, non-blocking)
    const today = new Date().toISOString().split("T")[0];
    Promise.all([
      upsertSwingPoints(pair, timeframe, result.swings).catch((err) =>
        console.error("[Structure API] Swing persist error:", err)
      ),
      upsertBOSEvents(pair, timeframe, result.bosEvents).catch((err) =>
        console.error("[Structure API] BOS persist error:", err)
      ),
      upsertSweepEvents(pair, timeframe, result.sweepEvents).catch((err) =>
        console.error("[Structure API] Sweep persist error:", err)
      ),
      upsertKeyLevels(pair, today, result.keyLevels).catch((err) =>
        console.error("[Structure API] Key levels persist error:", err)
      ),
      upsertFVGEvents(pair, timeframe, result.fvgEvents).catch((err) =>
        console.error("[Structure API] FVG persist error:", err)
      ),
    ]).catch(() => {}); // swallow aggregate errors

    // Cache result
    const ttl = TTL_MAP[timeframe] || 300_000;
    cache.set(cacheKey, { data: result, expiresAt: Date.now() + ttl });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Structure API] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute structure", details: String(error) },
      { status: 500 }
    );
  }
}
