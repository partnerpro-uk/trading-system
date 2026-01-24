"use client";

import React, { useMemo } from "react";
import { parseIntervalToMinutes } from "../../../lib/analysis/formatting";
import type { Trade, Candle } from "../../../lib/analysis/types";
import { PerTradeMiniChart, ChartDataPoint } from "./PerTradeMiniChart";

// Helper to parse numbers safely
function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface TradeMiniChartProps {
  trade: Trade;
  candles: Candle[] | null | undefined;
  dollarsPerMove?: number;
  interval?: string;
  isOpen?: boolean;
  parseMode?: string;
  tpDist?: number | null;
  slDist?: number | null;
  heightPx?: number;
}

export function TradeMiniChart({
  trade,
  candles,
  dollarsPerMove = 1,
  interval = "15min",
  isOpen = false,
  tpDist = null,
  slDist = null,
  heightPx = 120,
}: TradeMiniChartProps) {
  const minutesPerBar = parseIntervalToMinutes(interval);

  // Side normalization for the mini chart
  const side = useMemo(() => {
    const s = trade.side ?? trade.Side ?? trade.dirText ?? trade.directionText;
    if (typeof s === "string") {
      const up = s.toUpperCase();
      if (up.includes("BUY") || up === "LONG") return "BUY" as const;
      if (up.includes("SELL") || up === "SHORT") return "SELL" as const;
    }
    const dirRaw = trade.dir ?? trade.direction ?? trade.sideNum ?? trade.side;
    const d = Number(dirRaw);
    return d === -1 ? ("SELL" as const) : ("BUY" as const);
  }, [trade]);

  const dir = side === "BUY" ? 1 : -1;

  const entryIdx =
    trade.entryIdx ??
    trade.entryIndex ??
    trade.entryBar ??
    trade.iEntry ??
    (trade as Trade & { entry_i?: number }).entry_i;

  const exitIdxRaw =
    trade.exitIdx ??
    trade.exitIndex ??
    trade.exitBar ??
    trade.iExit ??
    (trade as Trade & { exit_i?: number }).exit_i;

  const barsHeld =
    trade.barsHeld ??
    trade.bars ??
    trade.barsInTrade ??
    trade.bars_in_trade;

  const entryIndex = Math.max(0, Number(entryIdx ?? 0) || 0);
  const exitIndex = useMemo(() => {
    const v = Number(exitIdxRaw);
    if (Number.isFinite(v)) return Math.max(0, v);
    const bh = Number(barsHeld);
    if (Number.isFinite(bh) && bh > 0)
      return entryIndex + Math.max(0, Math.round(bh));
    return entryIndex;
  }, [exitIdxRaw, barsHeld, entryIndex]);

  const entryC = candles?.[entryIndex];
  const exitC = candles?.[exitIndex];

  const entryPrice =
    parseNum(trade.entryPrice) ??
    parseNum((trade as Trade & { openPrice?: number }).openPrice) ??
    parseNum(entryC?.open) ??
    parseNum(entryC?.close) ??
    0;

  // If exitPrice isn't provided, derive from candle close (or PnL if available)
  const pnlUsd = parseNum(
    trade.pnl ?? trade.realizedPnl ?? trade.profit ?? trade.netPnl
  );

  const exitPrice = useMemo(() => {
    const fromTrade =
      parseNum(trade.exitPrice) ??
      parseNum((trade as Trade & { closePrice?: number }).closePrice);
    if (fromTrade !== null) return fromTrade;

    const fromCandle = parseNum(exitC?.close);
    if (fromCandle !== null) return fromCandle;

    if (pnlUsd !== null && dollarsPerMove) {
      return entryPrice + (pnlUsd / dollarsPerMove) * dir;
    }

    return entryPrice;
  }, [trade, exitC, pnlUsd, dollarsPerMove, entryPrice, dir]);

  const tpPrice = useMemo(() => {
    const fromTrade =
      parseNum(trade.tpPrice) ??
      parseNum(trade.takeProfit);
    if (fromTrade !== null) return fromTrade;

    if (tpDist !== null && Number.isFinite(Number(tpDist))) {
      return entryPrice + dir * Number(tpDist);
    }

    return null;
  }, [trade, tpDist, entryPrice, dir]);

  const slPrice = useMemo(() => {
    const fromTrade =
      parseNum(trade.slPrice) ??
      parseNum(trade.stopLoss);
    if (fromTrade !== null) return fromTrade;

    if (slDist !== null && Number.isFinite(Number(slDist))) {
      return entryPrice - dir * Number(slDist);
    }

    return null;
  }, [trade, slDist, entryPrice, dir]);

  // Build line-series data (minutes since entry). First point is a pre-bar at bar=-1.
  const data = useMemo(() => {
    const out: ChartDataPoint[] = [];
    if (!candles?.length) return out;
    const start = Math.max(0, entryIndex - 1);
    const end = Math.min(candles.length - 1, Math.max(exitIndex, entryIndex));
    const pre = candles[start];
    const prePrice =
      start < entryIndex ? parseNum(pre?.close) ?? entryPrice : entryPrice;

    out.push({
      bar: -1,
      price: prePrice,
      high: prePrice,
      low: prePrice,
      up: prePrice,
      down: null,
      flat: null,
      relCand: -1,
      ts:
        parseNum(
          (pre as Candle & { timeMs?: number })?.timeMs ??
            (pre as Candle & { t?: number })?.t ??
            pre?.time ??
            (pre as Candle & { ts?: number })?.ts
        ) ?? undefined,
    });

    let prev = prePrice;
    for (let k = entryIndex; k <= end; k++) {
      const c = candles[k];
      const closeVal = parseNum(c?.close) ?? prev;
      const highVal = parseNum(c?.high) ?? closeVal;
      const lowVal = parseNum(c?.low) ?? closeVal;
      const relCand = k - entryIndex;
      const bar = relCand * minutesPerBar;

      const up = closeVal > prev ? closeVal : null;
      const down = closeVal < prev ? closeVal : null;
      const flat = closeVal === prev ? closeVal : null;

      out.push({
        bar,
        price: closeVal,
        high: highVal,
        low: lowVal,
        up,
        down,
        flat,
        relCand,
        candIdx: k,
        ts:
          parseNum(
            (c as Candle & { timeMs?: number })?.timeMs ??
              (c as Candle & { t?: number })?.t ??
              c?.time ??
              (c as Candle & { ts?: number })?.ts
          ) ?? undefined,
      });
      prev = closeVal;
    }

    // Stitch colored segments so the line is continuous at direction changes.
    for (let i = 1; i < out.length; i++) {
      const cur = out[i];
      const prevRow = out[i - 1];
      if (cur.up != null) prevRow.up = prevRow.price;
      if (cur.down != null) prevRow.down = prevRow.price;
      if (cur.flat != null) prevRow.flat = prevRow.price;
    }

    // Ensure last point matches exit price if trade provides it
    if (out.length && Number.isFinite(exitPrice)) {
      const last = out[out.length - 1];
      last.price = exitPrice;
      last.high = Math.max(last.high ?? exitPrice, exitPrice);
      last.low = Math.min(last.low ?? exitPrice, exitPrice);
      if (out.length >= 2) {
        const p2 = out[out.length - 2].price;
        last.up = exitPrice > p2 ? exitPrice : null;
        last.down = exitPrice < p2 ? exitPrice : null;
        last.flat = exitPrice === p2 ? exitPrice : null;
      }
    }

    return out;
  }, [candles, entryIndex, exitIndex, minutesPerBar, entryPrice, exitPrice]);

  const yDomain = useMemo(() => {
    if (!data.length) return ["auto", "auto"] as const;
    const lows = data.map((d) => d.low).filter(Number.isFinite) as number[];
    const highs = data.map((d) => d.high).filter(Number.isFinite) as number[];
    if (!lows.length || !highs.length) return ["auto", "auto"] as const;

    let lo = Math.min(...lows);
    let hi = Math.max(...highs);

    if (tpPrice != null && Number.isFinite(tpPrice)) hi = Math.max(hi, tpPrice);
    if (slPrice != null && Number.isFinite(slPrice)) lo = Math.min(lo, slPrice);

    const span = Math.max(1e-9, hi - lo);
    const pad = Math.max(span * 0.12, Math.abs(Number(entryPrice)) * 0.002, 1);
    return [lo - pad, hi + pad] as const;
  }, [data, entryPrice, tpPrice, slPrice]);

  return (
    <div style={{ height: heightPx }}>
      <PerTradeMiniChart
        data={data}
        yDomain={[...yDomain]}
        entryPrice={Number(entryPrice) || 0}
        tpPrice={tpPrice}
        slPrice={slPrice}
        side={side}
        usdPerUnit={Number(dollarsPerMove) || 1}
        isOpen={!!isOpen}
      />
    </div>
  );
}
