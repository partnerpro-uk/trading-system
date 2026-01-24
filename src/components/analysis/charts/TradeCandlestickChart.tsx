"use client";

import React from "react";
import type { Trade, Candle } from "../../../lib/analysis/types";
import { parseIntervalToMinutes } from "../../../lib/analysis/formatting";

// ============================================
// Shared Props Interface
// ============================================
export interface TradeCandlestickChartProps {
  trade: Trade;
  candles: Candle[];
  interval?: string;
  parseMode?: "utc" | "local" | string;
  tpDist?: number | null;
  slDist?: number | null;
  heightPx?: number;
}

// ============================================
// Helper Functions
// ============================================
function num(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : v != null && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function fmt2(v: unknown): string {
  const n = num(v);
  return n == null ? "—" : n.toFixed(2);
}

// ============================================
// TradeCandlestickChartSVG - SVG Fallback
// ============================================
function TradeCandlestickChartSVG({
  trade,
  candles,
  tpDist,
  slDist,
  heightPx = 420,
}: TradeCandlestickChartProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const baseData = Array.isArray(candles) ? candles : [];
  const N = baseData.length;

  // Trade direction (best-effort)
  const dirRaw =
    trade?.dir ??
    trade?.direction ??
    trade?.sideNum ??
    trade?.side ??
    trade?.dirText ??
    trade?.directionText;
  const dirNum = num(dirRaw);
  const dirStr = typeof dirRaw === "string" ? dirRaw.toLowerCase() : "";
  const isLong =
    dirNum != null
      ? dirNum > 0
      : dirStr.includes("long") || dirStr.includes("buy");
  const entrySide = isLong ? "Buy" : "Sell";
  const exitSide = isLong ? "Sell" : "Buy";

  // Index resolution
  const resolveIdx = (obj: Trade, keys: string[]) => {
    for (const k of keys) {
      const v = num((obj as Record<string, unknown>)?.[k]);
      if (v != null) return Math.max(0, Math.min(N - 1, Math.round(v)));
    }
    return null;
  };

  const entryIdxDirect =
    resolveIdx(trade, [
      "entryIndex",
      "entryIdx",
      "entryBarIndex",
      "entryBar",
      "entryCandleIndex",
      "entry_i",
    ]) ?? null;
  const exitIdxDirect =
    resolveIdx(trade, [
      "exitIndex",
      "exitIdx",
      "exitBarIndex",
      "exitBar",
      "exitCandleIndex",
      "exit_i",
    ]) ?? null;

  // Time-based fallback
  const parseTime = (t: unknown) => {
    if (t == null) return null;
    if (typeof t === "number") return t;
    const s = String(t);
    const d = new Date(s);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const entryT = parseTime(
    trade?.entryTime ?? trade?.entryTs ?? (trade as Trade & { openTime?: number | string })?.openTime
  );
  const exitT = parseTime(
    trade?.exitTime ?? trade?.exitTs ?? (trade as Trade & { closeTime?: number | string })?.closeTime
  );

  const candleTimeMs = (c: Candle) =>
    parseTime(c?.time ?? c?.timestamp);

  const findNearestIdxByTime = (target: number | null) => {
    if (target == null || N === 0) return null;
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const tm = candleTimeMs(baseData[i]);
      if (tm == null) continue;
      const d = Math.abs(tm - target);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return Number.isFinite(bestD) ? bestI : null;
  };

  const entryIdx = entryIdxDirect ?? findNearestIdxByTime(entryT) ?? 0;
  const exitIdx =
    exitIdxDirect ?? (exitT != null ? findNearestIdxByTime(exitT) : null);

  // Prices
  const entryPrice = num(
    trade?.entryPrice ?? trade?.entry ?? (trade as Trade & { openPrice?: number })?.openPrice
  );
  const exitPrice =
    num(
      trade?.exitPrice ?? trade?.exit ?? (trade as Trade & { closePrice?: number })?.closePrice
    ) ??
    (exitIdx != null
      ? num(baseData[exitIdx]?.close)
      : null);

  // TP/SL levels
  const tp =
    num(trade?.tp ?? trade?.tpPrice) ??
    (entryPrice != null && tpDist != null
      ? entryPrice + (isLong ? tpDist : -tpDist)
      : null);
  const sl =
    num(trade?.sl ?? trade?.slPrice) ??
    (entryPrice != null && slDist != null
      ? entryPrice - (isLong ? slDist : -slDist)
      : null);

  // Initial window
  const tradeLenRaw =
    num(trade?.bars ?? trade?.barsHeld ?? trade?.barsInTrade) ??
    (exitIdx != null ? Math.max(1, exitIdx - entryIdx + 1) : 30);
  const initialWin = Math.max(30, Math.ceil(tradeLenRaw * 3));

  const initialStart = Math.max(0, entryIdx - Math.floor(initialWin * 0.35));
  const initialEnd = Math.min(N - 1, initialStart + initialWin - 1);

  const [viewStart, setViewStart] = React.useState<number>(initialStart);
  const [viewEnd, setViewEnd] = React.useState<number>(
    Math.max(initialStart, initialEnd)
  );

  // Hover / interaction state
  const [hoverI, setHoverI] = React.useState<number | null>(null);
  const [mouseXY, setMouseXY] = React.useState<{ x: number; y: number } | null>(
    null
  );
  const dragRef = React.useRef<{
    dragging: boolean;
    startX: number;
    startStart: number;
    startEnd: number;
  }>({ dragging: false, startX: 0, startStart: 0, startEnd: 0 });

  // Dimensions
  const pad = 16;
  const W = 1040;
  const H = Math.max(320, Math.min(560, heightPx));
  const plot = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 - 22 };

  const viewData = React.useMemo(() => {
    const a = Math.max(0, Math.min(N - 1, viewStart));
    const b = Math.max(0, Math.min(N - 1, viewEnd));
    const s = Math.min(a, b);
    const e = Math.max(a, b);
    return baseData.slice(s, e + 1).map((c, i) => ({ c, i: s + i }));
  }, [baseData, N, viewStart, viewEnd]);

  // OHLC extraction
  const ohlc = (c: Candle) => {
    const o = num(c?.open);
    const h = num(c?.high);
    const l = num(c?.low);
    const cl = num(c?.close);
    return { o, h, l, c: cl };
  };

  const yDomain = React.useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const { c } of viewData) {
      const { h, l } = ohlc(c);
      if (h != null) hi = Math.max(hi, h);
      if (l != null) lo = Math.min(lo, l);
    }
    for (const v of [entryPrice, exitPrice, tp, sl]) {
      if (v != null) {
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      lo = (entryPrice ?? 0) - 1;
      hi = (entryPrice ?? 0) + 1;
    }
    const range = hi - lo;
    const padY = Math.max(range * 0.18, 0.5);
    return { lo: lo - padY, hi: hi + padY };
  }, [viewData, entryPrice, exitPrice, tp, sl]);

  const xForIndex = (idx: number) => {
    const s = viewData.length <= 1 ? 0 : viewData[0].i;
    const e = viewData.length <= 1 ? 1 : viewData[viewData.length - 1].i;
    const t = e === s ? 0 : (idx - s) / (e - s);
    return plot.x + t * plot.w;
  };

  const yForPrice = (p: number) => {
    const { lo, hi } = yDomain;
    const t = (p - lo) / (hi - lo);
    return plot.y + (1 - t) * plot.h;
  };

  const idxFromMouseX = (mx: number) => {
    const s = viewData.length <= 1 ? 0 : viewData[0].i;
    const e = viewData.length <= 1 ? 1 : viewData[viewData.length - 1].i;
    const t = Math.max(0, Math.min(1, (mx - plot.x) / plot.w));
    return Math.round(s + t * (e - s));
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    setMouseXY({ x, y });

    if (dragRef.current.dragging) {
      const dx = x - dragRef.current.startX;
      const barsPerPx = (viewEnd - viewStart + 1) / plot.w;
      const shift = Math.round(-dx * barsPerPx);
      const win = dragRef.current.startEnd - dragRef.current.startStart;
      let ns = dragRef.current.startStart + shift;
      let ne = dragRef.current.startEnd + shift;
      if (ns < 0) {
        ne -= ns;
        ns = 0;
      }
      if (ne > N - 1) {
        const over = ne - (N - 1);
        ns -= over;
        ne = N - 1;
        if (ns < 0) ns = 0;
      }
      if (ne - ns !== win) ne = Math.min(N - 1, ns + win);
      setViewStart(ns);
      setViewEnd(ne);
      return;
    }

    const i = idxFromMouseX(x);
    setHoverI(i);
  };

  const onMouseLeave = () => {
    setMouseXY(null);
    setHoverI(null);
    dragRef.current.dragging = false;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    dragRef.current = {
      dragging: true,
      startX: x,
      startStart: viewStart,
      startEnd: viewEnd,
    };
  };

  const onMouseUp = () => {
    dragRef.current.dragging = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (N < 5) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;

    const centerIdx = idxFromMouseX(x);
    const curWin = Math.max(5, viewEnd - viewStart + 1);
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? 0.85 : 1.18;
    let newWin = Math.round(curWin * factor);
    newWin = Math.max(10, Math.min(N, newWin));

    let ns =
      centerIdx - Math.round(newWin * ((centerIdx - viewStart) / curWin));
    let ne = ns + newWin - 1;

    if (ns < 0) {
      ne -= ns;
      ns = 0;
    }
    if (ne > N - 1) {
      const over = ne - (N - 1);
      ns -= over;
      ne = N - 1;
      if (ns < 0) ns = 0;
    }
    setViewStart(ns);
    setViewEnd(ne);
  };

  const onDoubleClick = () => {
    setViewStart(initialStart);
    setViewEnd(Math.max(initialStart, initialEnd));
  };

  const candleWidth = React.useMemo(() => {
    const n = Math.max(1, viewData.length);
    const px = plot.w / n;
    return Math.max(2, Math.min(18, px * 0.7));
  }, [viewData.length, plot.w]);

  const clampVal = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  const arrow = (
    x: number,
    tipY: number,
    dir: "up" | "down",
    color: string
  ) => {
    const head = 5;
    const stem = 7;
    const headPath =
      dir === "up"
        ? `M ${x} ${tipY} L ${x - head} ${tipY + head} L ${x + head} ${
            tipY + head
          } Z`
        : `M ${x} ${tipY} L ${x - head} ${tipY - head} L ${x + head} ${
            tipY - head
          } Z`;
    const stemY1 = dir === "up" ? tipY + head : tipY - head;
    const stemY2 = dir === "up" ? tipY + head + stem : tipY - head - stem;

    return (
      <g>
        <path
          d={headPath}
          fill={color}
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={1.2}
          opacity={0.98}
        />
        <line
          x1={x}
          y1={stemY1}
          x2={x}
          y2={stemY2}
          stroke={color}
          strokeWidth={1.7}
          strokeLinecap="round"
          opacity={0.98}
        />
      </g>
    );
  };

  const markerAt = (
    idx: number,
    label: string,
    place: "above" | "below",
    dir: "up" | "down",
    color: string
  ) => {
    if (idx < 0 || idx >= N) return null;
    const cx = xForIndex(idx);
    const { h, l } = ohlc(baseData[idx]);
    if (h == null || l == null) return null;

    const yHi = yForPrice(h);
    const yLo = yForPrice(l);

    const tipY =
      place === "below"
        ? clampVal(yLo + 4, plot.y + 6, plot.y + plot.h - 6)
        : clampVal(yHi - 4, plot.y + 6, plot.y + plot.h - 6);

    const textY = place === "below" ? tipY + 18 : tipY - 12;

    return (
      <g>
        {arrow(cx, tipY, dir, color)}
        <text
          x={cx}
          y={textY}
          fill={color}
          fontSize={8}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui"
          fontWeight={650}
          style={{
            paintOrder: "stroke",
            stroke: "rgba(0,0,0,0.75)",
            strokeWidth: 3,
          }}
        >
          {label}
        </text>
      </g>
    );
  };

  const hovered = React.useMemo(() => {
    if (hoverI == null || hoverI < 0 || hoverI >= N) return null;
    const c = baseData[hoverI];
    if (!c) return null;
    const { o, h, l, c: cl } = ohlc(c);
    const tm = candleTimeMs(c);
    return { idx: hoverI, o, h, l, c: cl, tm };
  }, [hoverI, baseData, N]);

  const timeLabel = (ms: number | null) => {
    if (ms == null) return "";
    const d = new Date(ms);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  // Styling
  const bg = "rgba(0,0,0,0.92)";
  const grid = "rgba(255,255,255,0.10)";
  const txt = "rgba(255,255,255,0.86)";
  const buyCol = "rgba(52,211,153,0.95)";
  const sellCol = "rgba(248,113,113,0.95)";
  const candleUp = "rgba(52,211,153,0.92)";
  const candleDn = "rgba(248,113,113,0.92)";

  if (N === 0) {
    return (
      <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/50">
        <div className="text-gray-400 text-sm">
          No candles available for this trade.
        </div>
      </div>
    );
  }

  const entryInView =
    entryIdx != null &&
    viewData.length > 0 &&
    entryIdx >= viewData[0].i &&
    entryIdx <= viewData[viewData.length - 1].i;
  const exitInView =
    exitIdx != null &&
    viewData.length > 0 &&
    exitIdx >= viewData[0].i &&
    exitIdx <= viewData[viewData.length - 1].i;

  const entryX = entryInView ? xForIndex(entryIdx!) : null;
  const exitX = exitInView ? xForIndex(exitIdx!) : null;

  return (
    <div
      ref={wrapRef}
      className="w-full rounded-xl border border-gray-800 bg-gray-900/50 p-3"
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-white font-bold text-sm">
          Trade Candlesticks
          <span className="ml-3 font-medium text-xs text-gray-500">
            drag to pan • scroll to zoom • double-click to reset
          </span>
        </div>
        <div className="text-gray-500 text-xs">
          Showing {viewData.length} / {N} candles
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full block rounded-xl"
        style={{ height: H, background: bg }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <rect x={0} y={0} width={W} height={H} fill={bg} />

        {/* Grid */}
        {Array.from({ length: 6 }).map((_, k) => {
          const y = plot.y + (plot.h * k) / 5;
          return (
            <line
              key={`gy-${k}`}
              x1={plot.x}
              y1={y}
              x2={plot.x + plot.w}
              y2={y}
              stroke={grid}
              strokeDasharray="4 6"
            />
          );
        })}
        {Array.from({ length: 8 }).map((_, k) => {
          const x = plot.x + (plot.w * k) / 7;
          return (
            <line
              key={`gx-${k}`}
              x1={x}
              y1={plot.y}
              x2={x}
              y2={plot.y + plot.h}
              stroke={grid}
              strokeDasharray="4 6"
            />
          );
        })}

        {/* TP / SL */}
        {tp != null ? (
          <g>
            <line
              x1={plot.x}
              y1={yForPrice(tp)}
              x2={plot.x + plot.w}
              y2={yForPrice(tp)}
              stroke={buyCol}
              strokeDasharray="6 6"
              opacity={0.9}
            />
            <text
              x={plot.x + 8}
              y={yForPrice(tp) - 6}
              fill={buyCol}
              fontSize={12}
              fontFamily="ui-sans-serif, system-ui"
            >
              TP {fmt2(tp)}
            </text>
          </g>
        ) : null}
        {sl != null ? (
          <g>
            <line
              x1={plot.x}
              y1={yForPrice(sl)}
              x2={plot.x + plot.w}
              y2={yForPrice(sl)}
              stroke={sellCol}
              strokeDasharray="6 6"
              opacity={0.9}
            />
            <text
              x={plot.x + 8}
              y={yForPrice(sl) - 6}
              fill={sellCol}
              fontSize={12}
              fontFamily="ui-sans-serif, system-ui"
            >
              SL {fmt2(sl)}
            </text>
          </g>
        ) : null}

        {/* Candles */}
        {viewData.map(({ c, i }) => {
          const { o, h, l, c: cl } = ohlc(c);
          if (o == null || h == null || l == null || cl == null) return null;
          const up = cl >= o;
          const col = up ? candleUp : candleDn;

          const cx = xForIndex(i);
          const yO = yForPrice(o);
          const yC = yForPrice(cl);
          const yH = yForPrice(h);
          const yL = yForPrice(l);

          const bodyY = Math.min(yO, yC);
          const bodyH = Math.max(2, Math.abs(yC - yO));
          const wickX = cx;
          const bodyX = cx - candleWidth / 2;

          const isHovered = hoverI === i;

          return (
            <g key={`c-${i}`}>
              <line
                x1={wickX}
                y1={yH}
                x2={wickX}
                y2={yL}
                stroke={col}
                strokeWidth={2}
                opacity={0.95}
              />
              <rect
                x={bodyX}
                y={bodyY}
                width={candleWidth}
                height={bodyH}
                fill={col}
                opacity={0.92}
                rx={1.5}
              />
              {isHovered ? (
                <rect
                  x={bodyX - 2}
                  y={bodyY - 2}
                  width={candleWidth + 4}
                  height={bodyH + 4}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={1}
                  rx={2}
                />
              ) : null}
            </g>
          );
        })}

        {/* Entry / Exit markers */}
        {entryInView
          ? markerAt(
              entryIdx!,
              `Entry ${entrySide}`,
              isLong ? "below" : "above",
              isLong ? "up" : "down",
              isLong ? buyCol : sellCol
            )
          : null}
        {exitInView && exitIdx != null
          ? markerAt(
              exitIdx,
              `Exit ${exitSide}`,
              isLong ? "above" : "below",
              isLong ? "down" : "up",
              isLong ? sellCol : buyCol
            )
          : null}

        {/* Crosshair */}
        {mouseXY &&
        mouseXY.x >= plot.x &&
        mouseXY.x <= plot.x + plot.w &&
        mouseXY.y >= plot.y &&
        mouseXY.y <= plot.y + plot.h ? (
          <g>
            <line
              x1={mouseXY.x}
              y1={plot.y}
              x2={mouseXY.x}
              y2={plot.y + plot.h}
              stroke="rgba(255,255,255,0.22)"
              strokeDasharray="4 6"
            />
            <line
              x1={plot.x}
              y1={mouseXY.y}
              x2={plot.x + plot.w}
              y2={mouseXY.y}
              stroke="rgba(255,255,255,0.22)"
              strokeDasharray="4 6"
            />
          </g>
        ) : null}

        {/* Tooltip */}
        {hovered && mouseXY
          ? (() => {
              const boxW = 260;
              const boxH = 90;
              let bx = mouseXY.x + 12;
              let by = mouseXY.y + 12;
              if (bx + boxW > W - 10) bx = mouseXY.x - boxW - 12;
              if (by + boxH > H - 10) by = mouseXY.y - boxH - 12;

              return (
                <g>
                  <rect
                    x={bx}
                    y={by}
                    width={boxW}
                    height={boxH}
                    rx={10}
                    fill="rgba(15,15,15,0.92)"
                    stroke="rgba(255,255,255,0.12)"
                  />
                  <text
                    x={bx + 12}
                    y={by + 22}
                    fill={txt}
                    fontSize={12}
                    fontFamily="ui-sans-serif, system-ui"
                    opacity={0.9}
                  >
                    {timeLabel(hovered.tm)}
                  </text>
                  <text
                    x={bx + 12}
                    y={by + 44}
                    fill={txt}
                    fontSize={12}
                    fontFamily="ui-sans-serif, system-ui"
                    opacity={0.92}
                  >
                    O {fmt2(hovered.o)} H {fmt2(hovered.h)}
                  </text>
                  <text
                    x={bx + 12}
                    y={by + 64}
                    fill={txt}
                    fontSize={12}
                    fontFamily="ui-sans-serif, system-ui"
                    opacity={0.92}
                  >
                    L {fmt2(hovered.l)} C {fmt2(hovered.c)}
                  </text>
                  <text
                    x={bx + 12}
                    y={by + 84}
                    fill="rgba(255,255,255,0.55)"
                    fontSize={11}
                    fontFamily="ui-sans-serif, system-ui"
                  >
                    idx {hovered.idx}
                  </text>
                </g>
              );
            })()
          : null}
      </svg>
    </div>
  );
}

// ============================================
// TradeCandlestickChartLightweight - TradingView
// ============================================
interface LightweightChartProps extends TradeCandlestickChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lw: any;
}

function TradeCandlestickChartLightweight({
  trade,
  candles,
  interval,
  tpDist,
  slDist,
  heightPx = 420,
  lw,
}: LightweightChartProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const baseData = Array.isArray(candles) ? candles : [];
  const N = baseData.length;

  const toSec = (t: unknown) => {
    if (t == null) return null;
    if (typeof t === "number")
      return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
    const d = new Date(String(t));
    const ms = d.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  };

  const intervalMin = parseIntervalToMinutes(interval ?? "") ?? 15;
  const intervalSec = Math.max(60, Math.round(intervalMin * 60));

  const resolveIdx = (obj: Trade, keys: string[]) => {
    for (const k of keys) {
      const v = num((obj as Record<string, unknown>)?.[k]);
      if (v != null) return Math.max(0, Math.min(N - 1, Math.round(v)));
    }
    return null;
  };

  const entryIdx =
    resolveIdx(trade, [
      "entryIndex",
      "entryIdx",
      "entryBarIndex",
      "entryBar",
      "entryCandleIndex",
      "entry_i",
    ]) ?? 0;
  const exitIdx =
    resolveIdx(trade, [
      "exitIndex",
      "exitIdx",
      "exitBarIndex",
      "exitBar",
      "exitCandleIndex",
      "exit_i",
    ]) ?? null;

  const entryTimeSec = toSec(
    trade?.entryTime ?? trade?.entryTs ?? (trade as Trade & { openTime?: number | string })?.openTime
  );

  const candleTimeSec = (c: Candle) =>
    toSec(c?.time ?? c?.timestamp);

  const hasTimes = React.useMemo(() => {
    for (let i = 0; i < N; i++) {
      if (candleTimeSec(baseData[i]) != null) return true;
    }
    return false;
  }, [baseData, N]);

  const data = React.useMemo(() => {
    const out: Array<{ time: number; open: number; high: number; low: number; close: number; __i: number }> = [];
    if (N === 0) return out;

    const origin =
      entryTimeSec != null
        ? entryTimeSec - entryIdx * intervalSec
        : Math.floor(Date.now() / 1000) - N * intervalSec;

    for (let i = 0; i < N; i++) {
      const c = baseData[i] || {};
      const o = num(c?.open);
      const h = num(c?.high);
      const l = num(c?.low);
      const cl = num(c?.close);
      if (o == null || h == null || l == null || cl == null) continue;
      const t = hasTimes ? candleTimeSec(c) : origin + i * intervalSec;
      if (t == null) continue;
      out.push({ time: t, open: o, high: h, low: l, close: cl, __i: i });
    }
    return out;
  }, [baseData, N, hasTimes, entryTimeSec, entryIdx, intervalSec]);

  const dirRaw =
    trade?.dir ??
    trade?.direction ??
    trade?.sideNum ??
    trade?.side ??
    trade?.dirText ??
    trade?.directionText;
  const dirNum = num(dirRaw);
  const dirStr = typeof dirRaw === "string" ? dirRaw.toLowerCase() : "";
  const isLong =
    dirNum != null
      ? dirNum > 0
      : dirStr.includes("long") || dirStr.includes("buy");

  const entrySide = isLong ? "Buy" : "Sell";
  const exitSide = isLong ? "Sell" : "Buy";

  const entryPrice =
    num(trade?.entryPrice ?? trade?.entry ?? (trade as Trade & { openPrice?: number })?.openPrice) ??
    (data[Math.min(entryIdx, Math.max(0, data.length - 1))]
      ? num(data[Math.min(entryIdx, data.length - 1)].open)
      : null);

  const exitPrice =
    num(trade?.exitPrice ?? trade?.exit ?? (trade as Trade & { closePrice?: number })?.closePrice) ??
    (exitIdx != null && data[Math.min(exitIdx, Math.max(0, data.length - 1))]
      ? num(data[Math.min(exitIdx, data.length - 1)].close)
      : null);

  const tp =
    num(trade?.tp ?? trade?.tpPrice) ??
    (entryPrice != null && tpDist != null
      ? entryPrice + (isLong ? tpDist : -tpDist)
      : null);
  const sl =
    num(trade?.sl ?? trade?.slPrice) ??
    (entryPrice != null && slDist != null
      ? entryPrice - (isLong ? slDist : -slDist)
      : null);

  const tradeLenRaw =
    num(trade?.bars ?? trade?.barsHeld ?? trade?.barsInTrade) ??
    (exitIdx != null ? Math.max(1, exitIdx - entryIdx + 1) : 30);
  const initialWin = Math.max(30, Math.ceil(tradeLenRaw * 3));
  const initialStart = Math.max(0, entryIdx - Math.floor(initialWin * 0.35));
  const initialEnd = Math.min(
    Math.max(0, N - 1),
    initialStart + initialWin - 1
  );

  React.useEffect(() => {
    if (!containerRef.current) return;
    if (!lw?.createChart) return;

    const el = containerRef.current;
    el.innerHTML = "";

    const { createChart, CandlestickSeries } = lw;
    const CrosshairMode = lw?.CrosshairMode;
    const LineStyle = lw?.LineStyle;

    const height = Math.max(320, Math.min(560, heightPx));

    const chart = createChart(el, {
      width: el.clientWidth || 900,
      height,
      layout: {
        background: { type: "solid", color: "#000" },
        textColor: "rgba(255,255,255,0.70)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      crosshair: CrosshairMode
        ? {
            mode: CrosshairMode.Normal,
            vertLine: { color: "rgba(255,255,255,0.25)", width: 1 },
            horzLine: { color: "rgba(255,255,255,0.18)", width: 1 },
          }
        : undefined,
      rightPriceScale: { borderColor: "rgba(255,255,255,0.10)" },
      timeScale: { borderColor: "rgba(255,255,255,0.10)" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    // lightweight-charts v5 uses addSeries with series type
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      borderVisible: false,
    });

    series.setData(data);

    const entryT = data[Math.min(entryIdx, Math.max(0, data.length - 1))]?.time;
    const exitT =
      exitIdx != null
        ? data[Math.min(exitIdx, Math.max(0, data.length - 1))]?.time
        : null;

    const markers: Array<{
      time: number;
      position: string;
      color: string;
      shape: string;
      text: string;
    }> = [];
    if (entryT != null) {
      markers.push({
        time: entryT,
        position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? "#34d399" : "#fb7185",
        shape: isLong ? "arrowUp" : "arrowDown",
        text: `Entry ${entrySide}`,
      });
    }
    if (exitT != null) {
      markers.push({
        time: exitT,
        position: isLong ? "aboveBar" : "belowBar",
        color: isLong ? "#fb7185" : "#34d399",
        shape: isLong ? "arrowDown" : "arrowUp",
        text: `Exit ${exitSide}`,
      });
    }
    if (markers.length) series.setMarkers(markers);

    if (tp != null && series.createPriceLine) {
      series.createPriceLine({
        price: tp,
        color: "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle ? LineStyle.Dashed : 2,
        axisLabelVisible: true,
        title: "TP",
      });
    }
    if (sl != null && series.createPriceLine) {
      series.createPriceLine({
        price: sl,
        color: "#fb7185",
        lineWidth: 1,
        lineStyle: LineStyle ? LineStyle.Dashed : 2,
        axisLabelVisible: true,
        title: "SL",
      });
    }

    const startT =
      data[Math.min(initialStart, Math.max(0, data.length - 1))]?.time;
    const endT = data[Math.min(initialEnd, Math.max(0, data.length - 1))]?.time;

    if (startT != null && endT != null && chart.timeScale().setVisibleRange) {
      chart.timeScale().setVisibleRange({ from: startT, to: endT });
    } else {
      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth || 900, height });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [
    lw,
    data,
    heightPx,
    tp,
    sl,
    entryIdx,
    exitIdx,
    isLong,
    entrySide,
    exitSide,
    initialStart,
    initialEnd,
  ]);

  return (
    <div className="border border-gray-800 bg-black/80 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-baseline justify-between border-b border-gray-800/50">
        <div className="text-sm font-bold text-white">
          Trade Candlesticks
          <span className="ml-3 text-xs font-bold opacity-65">
            drag to pan · scroll to zoom · double-click to reset
          </span>
        </div>
        <div className="text-xs opacity-65">
          Showing {data.length} candles
        </div>
      </div>
      <div
        className="w-full"
        style={{ height: Math.max(320, Math.min(560, heightPx)) }}
        ref={containerRef}
      />
    </div>
  );
}

// ============================================
// TradeCandlestickChart - Main Export (Lazy Loader)
// ============================================
export function TradeCandlestickChart(props: TradeCandlestickChartProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lwMod, setLwMod] = React.useState<any | false | null>(null);

  React.useEffect(() => {
    let alive = true;
    import("lightweight-charts")
      .then((m) => alive && setLwMod(m))
      .catch(() => alive && setLwMod(false));
    return () => {
      alive = false;
    };
  }, []);

  // While loading OR if missing, render SVG (so the UI never goes blank).
  if (!lwMod) return <TradeCandlestickChartSVG {...props} />;

  return <TradeCandlestickChartLightweight {...props} lw={lwMod} />;
}

export default TradeCandlestickChart;
