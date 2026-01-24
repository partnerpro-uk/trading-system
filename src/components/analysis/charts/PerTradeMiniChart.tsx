"use client";

import React, { useMemo, useId, useState, useEffect, useCallback } from "react";
import { humanizeDurationMinutes } from "../../../lib/analysis/formatting";

export interface ChartDataPoint {
  bar: number;
  price: number;
  high: number;
  low: number;
  up: number | null;
  down: number | null;
  flat: number | null;
  ts?: number;
  candIdx?: number;
  relCand?: number;
}

interface PerTradeMiniChartProps {
  data: ChartDataPoint[];
  yDomain: [number | "auto", number | "auto"];
  entryPrice: number;
  tpPrice: number | null;
  slPrice: number | null;
  side: "BUY" | "SELL";
  usdPerUnit: number;
  isOpen: boolean;
}

export function PerTradeMiniChart({
  data,
  yDomain,
  entryPrice,
  tpPrice,
  slPrice,
  side,
  usdPerUnit,
  isOpen,
}: PerTradeMiniChartProps) {
  const [reveal, setReveal] = useState(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    if (!isOpen) {
      setReveal(1);
      return () => cancelAnimationFrame(raf);
    }
    const D = 1600;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / D);
      setReveal(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  const clipId = useId();
  const glowId = useId();

  const dir = side === "BUY" ? 1 : -1;

  const fmt3 = (x: number) =>
    Number.isFinite(x)
      ? x.toLocaleString(undefined, { maximumFractionDigits: 3 })
      : "–";

  const fmtUSD3 = (x: number) =>
    `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(3)}`;

  const pnl = useCallback(
    (p: number) => (p - entryPrice) * dir * usdPerUnit,
    [entryPrice, dir, usdPerUnit]
  );

  const margin = { top: 10, right: 50, bottom: 24, left: 50 };
  const width = 400;
  const height = 120;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const { xMin, xMax, yMin, yMax, scaleX, scaleY } = useMemo(() => {
    if (!data.length) {
      return {
        xMin: -1,
        xMax: 10,
        yMin: 0,
        yMax: 1,
        scaleX: () => 0,
        scaleY: () => 0,
      };
    }

    const xMinVal = Math.min(...data.map((d) => d.bar));
    const xMaxVal = Math.max(...data.map((d) => d.bar));

    let yMinVal =
      yDomain[0] === "auto"
        ? Math.min(...data.map((d) => d.low).filter(Number.isFinite))
        : (yDomain[0] as number);
    let yMaxVal =
      yDomain[1] === "auto"
        ? Math.max(...data.map((d) => d.high).filter(Number.isFinite))
        : (yDomain[1] as number);

    const xRange = xMaxVal - xMinVal || 1;
    const yRange = yMaxVal - yMinVal || 1;

    return {
      xMin: xMinVal,
      xMax: xMaxVal,
      yMin: yMinVal,
      yMax: yMaxVal,
      scaleX: (x: number) => ((x - xMinVal) / xRange) * innerW,
      scaleY: (y: number) => innerH - ((y - yMinVal) / yRange) * innerH,
    };
  }, [data, yDomain, innerW, innerH]);

  const buildPath = (
    points: Array<{ bar: number; value: number | null }>
  ): string => {
    let path = "";
    let drawing = false;

    for (const pt of points) {
      if (pt.value === null) {
        drawing = false;
        continue;
      }
      const x = scaleX(pt.bar);
      const y = scaleY(pt.value);
      if (!drawing) {
        path += `M ${x} ${y}`;
        drawing = true;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    return path;
  };

  const upPath = buildPath(data.map((d) => ({ bar: d.bar, value: d.up })));
  const downPath = buildPath(data.map((d) => ({ bar: d.bar, value: d.down })));
  const flatPath = buildPath(data.map((d) => ({ bar: d.bar, value: d.flat })));

  const yTicks = useMemo(() => {
    const range = yMax - yMin;
    const step = range / 4;
    return [yMin, yMin + step, yMin + step * 2, yMin + step * 3, yMax];
  }, [yMin, yMax]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left - margin.left;

      if (x < 0 || x > innerW) {
        setHoveredIdx(null);
        setTooltipPos(null);
        return;
      }

      const xVal = xMin + (x / innerW) * (xMax - xMin);
      let closest = 0;
      let minDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const dist = Math.abs(data[i].bar - xVal);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      setHoveredIdx(closest);
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [data, innerW, margin.left, xMin, xMax]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(null);
    setTooltipPos(null);
  }, []);

  const hoveredData = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="h-full bg-neutral-950 rounded-md border border-neutral-800 overflow-hidden relative">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={clipId}>
            <rect
              x={margin.left}
              y={margin.top}
              width={innerW * reveal}
              height={innerH}
            />
          </clipPath>
        </defs>

        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Y-axis ticks */}
          {yTicks.map((tick, i) => (
            <g key={i} transform={`translate(0, ${scaleY(tick)})`}>
              <text
                x={-8}
                y={0}
                fill="#9ca3af"
                fontSize={10}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {fmt3(tick)}
              </text>
            </g>
          ))}

          {/* Reference lines */}
          <line
            x1={0}
            y1={scaleY(entryPrice)}
            x2={innerW}
            y2={scaleY(entryPrice)}
            stroke="#a3a3a3"
            strokeDasharray="4 6"
          />
          {tpPrice !== null && Number.isFinite(tpPrice) && (
            <line
              x1={0}
              y1={scaleY(tpPrice)}
              x2={innerW}
              y2={scaleY(tpPrice)}
              stroke="#34d399"
              strokeDasharray="4 6"
            />
          )}
          {slPrice !== null && Number.isFinite(slPrice) && (
            <line
              x1={0}
              y1={scaleY(slPrice)}
              x2={innerW}
              y2={scaleY(slPrice)}
              stroke="#f87171"
              strokeDasharray="4 6"
            />
          )}
        </g>

        {/* Lines with clip path for reveal animation */}
        <g clipPath={`url(#${clipId})`}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {upPath && (
              <path
                d={upPath}
                fill="none"
                stroke="#34d399"
                strokeWidth={3}
                style={{ filter: `url(#${glowId})` }}
              />
            )}
            {downPath && (
              <path
                d={downPath}
                fill="none"
                stroke="#f87171"
                strokeWidth={3}
                style={{ filter: `url(#${glowId})` }}
              />
            )}
            {flatPath && (
              <path
                d={flatPath}
                fill="none"
                stroke="#ffffff"
                strokeWidth={3}
                style={{ filter: `url(#${glowId})` }}
              />
            )}
          </g>
        </g>

        {/* X-axis label */}
        <text
          x={width - margin.right}
          y={height - 4}
          fill="#9ca3af"
          fontSize={10}
          textAnchor="end"
        >
          Minutes since entry
        </text>

        {/* Hover indicator */}
        {hoveredData && (
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <circle
              cx={scaleX(hoveredData.bar)}
              cy={scaleY(hoveredData.price)}
              r={5}
              fill={
                hoveredData.up !== null
                  ? "#34d399"
                  : hoveredData.down !== null
                  ? "#f87171"
                  : "#ffffff"
              }
              stroke="#000"
              strokeWidth={1}
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hoveredData && tooltipPos && (
        <div
          style={{
            position: "absolute",
            left: tooltipPos.x + 10,
            top: tooltipPos.y - 10,
            background: "#000",
            border: "1px solid #262626",
            borderRadius: 12,
            padding: "8px 10px",
            color: "#e5e7eb",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 10,
            minWidth: 140,
          }}
        >
          {hoveredData.ts && (
            <div style={{ opacity: 0.9, marginBottom: 4, fontWeight: 600 }}>
              {new Date(hoveredData.ts).toLocaleString(undefined, {
                month: "2-digit",
                day: "2-digit",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          )}
          <div style={{ opacity: 0.8, marginBottom: 8 }}>
            {hoveredData.relCand !== undefined && hoveredData.relCand >= 0
              ? `${hoveredData.relCand + 1} Candle${hoveredData.relCand > 0 ? "s" : ""}`
              : ""}{" "}
            | {humanizeDurationMinutes(Math.max(0, hoveredData.bar))} In
          </div>

          <div>
            Close: <b>{fmt3(hoveredData.price)}</b>
          </div>
          <div>
            High: <b>{fmt3(hoveredData.high)}</b>
          </div>
          <div>
            Low: <b>{fmt3(hoveredData.low)}</b>
          </div>
          <hr style={{ borderColor: "#262626", margin: "6px 0" }} />
          <div>
            Close PnL:{" "}
            <b
              style={{
                color:
                  pnl(hoveredData.price) > 0
                    ? "#34d399"
                    : pnl(hoveredData.price) < 0
                    ? "#f87171"
                    : "#e5e7eb",
              }}
            >
              {fmtUSD3(pnl(hoveredData.price))}
            </b>
          </div>
          <div>
            High PnL:{" "}
            <b
              style={{
                color:
                  pnl(hoveredData.high) > 0
                    ? "#34d399"
                    : pnl(hoveredData.high) < 0
                    ? "#f87171"
                    : "#e5e7eb",
              }}
            >
              {fmtUSD3(pnl(hoveredData.high))}
            </b>
          </div>
          <div>
            Low PnL:{" "}
            <b
              style={{
                color:
                  pnl(hoveredData.low) > 0
                    ? "#34d399"
                    : pnl(hoveredData.low) < 0
                    ? "#f87171"
                    : "#e5e7eb",
              }}
            >
              {fmtUSD3(pnl(hoveredData.low))}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}
