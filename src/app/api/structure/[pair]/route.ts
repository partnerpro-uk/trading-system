/**
 * Market Structure API
 *
 * GET /api/structure/[pair]?timeframe=H4&depth=100
 * GET /api/structure/[pair]?timeframe=H4&from=<unixMs>&to=<unixMs>
 *
 * Two modes:
 * 1. Legacy (no from/to): computes structure on-demand from candles
 * 2. Pre-computed (with from/to): reads from DB + live tail merge
 *
 * Results are cached in-memory with timeframe-scaled TTL and
 * persisted to TimescaleDB in the background (legacy mode only).
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestCandles } from "@/lib/db/candles";
import {
  computeStructure,
  detectFilteredSwings,
  labelSwings,
  detectBOS,
  deriveCurrentStructure,
  computeKeyLevels,
  keyLevelGridToEntries,
  REQUIRED_DEPTH,
} from "@/lib/structure";
import type { CurrentStructure, StructureResponse } from "@/lib/structure";
import {
  upsertSwingPoints,
  upsertBOSEvents,
  upsertSweepEvents,
  upsertKeyLevels,
  upsertFVGEvents,
  getStructureInRange,
  getHTFStructures,
} from "@/lib/db/structure";
import { getMacroRange } from "@/lib/db/clickhouse-structure";
import { getLatestCOTForPair } from "@/lib/db/cot";
import { getUpcomingEvents } from "@/lib/db/news";
import { computeLiveTail, getLiveTailDepth } from "@/lib/structure/live-tail";
import { computePremiumDiscount } from "@/lib/structure/premium-discount";
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

  // --- Pre-computed path: read from DB + live tail ---
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (fromParam && toParam) {
    const from = parseInt(fromParam, 10);
    const to = parseInt(toParam, 10);

    if (isNaN(from) || isNaN(to)) {
      return NextResponse.json(
        { error: "Invalid from/to parameters (expected unix ms)" },
        { status: 400 }
      );
    }

    try {
      // 1. Read confirmed structure from DB
      const dbStructure = await getStructureInRange(pair, timeframe, from, to);

      // 2. Compute live tail: recent candles for unconfirmed leading edge
      const tailDepth = getLiveTailDepth(timeframe);
      const tailCandles = await getLatestCandles(pair, timeframe, tailDepth);
      const tail = tailCandles && tailCandles.length > 0
        ? computeLiveTail(tailCandles as Candle[], timeframe, pair)
        : { swings: [], bosEvents: [], sweepEvents: [], fvgEvents: [] };

      // 3. Merge confirmed + tail (dedupe by timestamp)
      const mergedSwings = dedupeByTimestamp([...dbStructure.swings, ...tail.swings]);
      const mergedBOS = dedupeByTimestamp([...dbStructure.bosEvents, ...tail.bosEvents]);
      const mergedSweeps = dedupeByTimestamp([...dbStructure.sweepEvents, ...tail.sweepEvents]);
      const mergedFVGs = dedupeByCreatedAt([...dbStructure.fvgEvents, ...tail.fvgEvents]);

      // 4. Key levels (always fresh from D/W/M candles)
      const [dailyCandles, weeklyCandles, monthlyCandles] = await Promise.all([
        getLatestCandles(pair, "D", 60),
        getLatestCandles(pair, "W", 20),
        getLatestCandles(pair, "M", 13),
      ]);
      const keyLevels = computeKeyLevels(
        pair,
        (dailyCandles || []) as Candle[],
        (weeklyCandles || []) as Candle[],
        (monthlyCandles || []) as Candle[]
      );
      const keyLevelEntries = keyLevelGridToEntries(keyLevels);

      // 5. Current structure from merged data
      const currentStructure = deriveCurrentStructure(mergedSwings, mergedBOS);

      // 6. Premium/Discount (optional — use stored HTF swings)
      let premiumDiscount = null;
      const currentPrice = tailCandles && tailCandles.length > 0
        ? tailCandles[tailCandles.length - 1].close
        : undefined;

      if (currentPrice) {
        const h4Swings = timeframe === "H4"
          ? mergedSwings
          : await getLatestCandles(pair, "H4", 200).then((c) =>
              c && c.length > 0
                ? labelSwings(detectFilteredSwings(c as Candle[], "H4"), c as Candle[])
                : []
            );
        const d1Swings = dailyCandles && dailyCandles.length > 0
          ? labelSwings(detectFilteredSwings(dailyCandles as Candle[], "D"), dailyCandles as Candle[])
          : [];
        const w1Swings = weeklyCandles && weeklyCandles.length > 0
          ? labelSwings(detectFilteredSwings(weeklyCandles as Candle[], "W"), weeklyCandles as Candle[])
          : [];
        const macroRange = await getMacroRange(pair).catch(() => null);

        if (h4Swings.length > 0) {
          premiumDiscount = computePremiumDiscount(
            currentPrice,
            h4Swings,
            d1Swings,
            w1Swings,
            keyLevels,
            macroRange
          );
        }
      }

      // 7. MTF score (from stored HTF structures)
      const htfStructures = await getHTFStructures(pair).catch(() => ({}));

      const result: StructureResponse = {
        pair,
        timeframe,
        computedAt: Date.now(),
        swings: mergedSwings,
        bosEvents: mergedBOS,
        sweepEvents: mergedSweeps,
        keyLevels,
        keyLevelEntries,
        currentStructure,
        fvgEvents: mergedFVGs,
        premiumDiscount,
        mtfScore: Object.keys(htfStructures).length > 0
          ? undefined // MTF scoring can be added here when needed
          : undefined,
      };

      // Cache the result
      const ttl = TTL_MAP[timeframe] || 300_000;
      cache.set(cacheKey, { data: result, expiresAt: Date.now() + ttl });

      return NextResponse.json(result);
    } catch (error) {
      console.error("[Structure API] DB-read path error:", error);
      return NextResponse.json(
        { error: "Failed to read pre-computed structure", details: String(error) },
        { status: 500 }
      );
    }
  }

  // --- Legacy path: compute on-demand ---
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
      ? labelSwings(detectFilteredSwings(dailyCandles as Candle[], "D"), dailyCandles as Candle[])
      : [];
    const w1Swings = weeklyCandles && weeklyCandles.length > 0
      ? labelSwings(detectFilteredSwings(weeklyCandles as Candle[], "W"), weeklyCandles as Candle[])
      : [];
    const h4Swings = needH4 && h4Candles && h4Candles.length > 0
      ? labelSwings(detectFilteredSwings(h4Candles as Candle[], "H4"), h4Candles as Candle[])
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
        const mSwings = labelSwings(detectFilteredSwings(monthlyCandles as Candle[], "M"), monthlyCandles as Candle[]);
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

// --- Dedup helpers for merging DB + live tail ---

function dedupeByTimestamp<T extends { timestamp: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.timestamp)) {
      seen.add(item.timestamp);
      result.push(item);
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

function dedupeByCreatedAt<T extends { createdAt: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.createdAt)) {
      seen.add(item.createdAt);
      result.push(item);
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}
