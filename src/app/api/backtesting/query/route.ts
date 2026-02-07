/**
 * Backtesting Query API
 *
 * GET /api/backtesting/query?pair=EUR_USD&entityType=bos&startDate=2024-01-01&endDate=2024-12-31
 *
 * Proxies structured queries to ClickHouse for historical structure data.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getSwingPointsFromCH,
  getBOSEventsFromCH,
  getSweepEventsFromCH,
  getFVGEventsFromCH,
  countStructureEvents,
  type StructureQueryFilter,
} from "@/lib/db/clickhouse-structure";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const pair = params.get("pair");
  const entityType = params.get("entityType");

  if (!pair || !entityType) {
    return NextResponse.json(
      { error: "Missing required params: pair, entityType" },
      { status: 400 }
    );
  }

  const validTypes = ["swing", "bos", "sweep", "fvg"];
  if (!validTypes.includes(entityType)) {
    return NextResponse.json(
      { error: `entityType must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const filter: StructureQueryFilter = {
      pair,
      timeframe: params.get("timeframe") || undefined,
      direction: params.get("direction") || undefined,
      limit: Math.min(parseInt(params.get("limit") || "500"), 5000),
      offset: parseInt(params.get("offset") || "0"),
    };

    const startDate = params.get("startDate");
    const endDate = params.get("endDate");
    if (startDate) filter.startTime = new Date(startDate).getTime();
    if (endDate) filter.endTime = new Date(endDate).getTime();

    let data: unknown[];
    let total = 0;

    const tableMap = {
      swing: "swing_points" as const,
      bos: "bos_events" as const,
      sweep: "sweep_events" as const,
      fvg: "fvg_events" as const,
    };

    switch (entityType) {
      case "swing":
        [data, total] = await Promise.all([
          getSwingPointsFromCH(filter),
          countStructureEvents("swing_points", filter),
        ]);
        break;
      case "bos":
        [data, total] = await Promise.all([
          getBOSEventsFromCH({
            ...filter,
            isDisplacement: params.get("displacement") === "true" ? true : undefined,
            isCounterTrend: params.get("counterTrend") === "true" ? true : undefined,
          }),
          countStructureEvents("bos_events", filter),
        ]);
        break;
      case "sweep":
        [data, total] = await Promise.all([
          getSweepEventsFromCH({
            ...filter,
            sweptLevelType: params.get("sweptLevelType") || undefined,
            followedByBOS: params.get("followedByBOS") === "true" ? true : undefined,
          }),
          countStructureEvents("sweep_events", filter),
        ]);
        break;
      case "fvg":
        [data, total] = await Promise.all([
          getFVGEventsFromCH({
            ...filter,
            tier: params.get("tier") ? parseInt(params.get("tier")!) : undefined,
            minGapPips: params.get("minGapPips") ? parseFloat(params.get("minGapPips")!) : undefined,
            status: params.get("status") || undefined,
          }),
          countStructureEvents("fvg_events", filter),
        ]);
        break;
      default:
        data = [];
    }

    return NextResponse.json({
      data,
      total,
      hasMore: (filter.offset || 0) + data.length < total,
      pair,
      entityType,
    });
  } catch (error) {
    console.error("[Backtesting Query] Error:", error);
    return NextResponse.json(
      { error: "Query failed", details: String(error) },
      { status: 500 }
    );
  }
}
