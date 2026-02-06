"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  IChartApi,
  CandlestickData,
  CandlestickSeries,
  Time,
  CrosshairMode,
  LineWidth,
} from "lightweight-charts";
import {
  Drawing,
  isFibonacciDrawing,
  isHorizontalLineDrawing,
  isHorizontalRayDrawing,
  isRectangleDrawing,
  isPositionDrawing,
  isTrendlineDrawing,
  isLongPositionDrawing,
} from "@/lib/drawings/types";
import { SnapshotTradeContext } from "@/lib/snapshots/describe";

interface SnapshotReplayViewerProps {
  snapshot: {
    pair: string;
    timeframe: string;
    momentLabel: string;
    timestamp: number;
    visibleRange: { from: number; to: number };
    drawings: string;
    tradeContext: string;
    aiDescription?: string;
  };
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Read-only Lightweight Charts instance that reconstructs a chart from snapshot data.
 * Fetches candles from the API and overlays trade markers + saved drawings.
 */
export function SnapshotReplayViewer({
  snapshot,
  width,
  height = 400,
  className = "",
}: SnapshotReplayViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [candles, setCandles] = useState<CandlestickData<Time>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse snapshot data
  const drawings: Drawing[] = (() => {
    try {
      return JSON.parse(snapshot.drawings);
    } catch {
      return [];
    }
  })();

  const tradeContext: SnapshotTradeContext | null = (() => {
    try {
      return JSON.parse(snapshot.tradeContext);
    } catch {
      return null;
    }
  })();

  const isJPY = snapshot.pair.includes("JPY");
  const precision = isJPY ? 3 : 5;
  const minMove = isJPY ? 0.001 : 0.00001;

  // Fetch candles for the snapshot's visible range
  useEffect(() => {
    const fetchCandles = async () => {
      setLoading(true);
      setError(null);

      try {
        // Add 20% padding on each side for visual context
        const range = snapshot.visibleRange.to - snapshot.visibleRange.from;
        const padding = range * 0.2;
        const from = snapshot.visibleRange.from - padding;
        const to = snapshot.visibleRange.to + padding;

        const res = await fetch(
          `/api/candles/range?pair=${snapshot.pair}&timeframe=${snapshot.timeframe}&from=${Math.floor(from)}&to=${Math.floor(to)}`
        );

        if (!res.ok) throw new Error("Failed to fetch candles");

        const data = await res.json();
        const formatted: CandlestickData<Time>[] = data.candles.map(
          (c: { timestamp: number; open: number; high: number; low: number; close: number }) => ({
            time: (c.timestamp / 1000) as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })
        );

        setCandles(formatted);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load candles");
      } finally {
        setLoading(false);
      }
    };

    fetchCandles();
  }, [snapshot.pair, snapshot.timeframe, snapshot.visibleRange.from, snapshot.visibleRange.to]);

  // Create chart and render
  useEffect(() => {
    if (!containerRef.current || !candles || candles.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0f1117" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#6b7280", width: 1, style: 2 },
        horzLine: { color: "#6b7280", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "#374151",
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
      // Read-only: disable user interaction
      handleScroll: false,
      handleScale: false,
      width: width || containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Add candlestick series
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#f23645",
      borderUpColor: "#089981",
      borderDownColor: "#f23645",
      wickUpColor: "#089981",
      wickDownColor: "#f23645",
      priceFormat: { type: "price", precision, minMove },
      lastValueVisible: false,
    });

    series.setData(candles);

    // Add trade context markers (entry, SL, TP lines)
    if (tradeContext) {
      const isLong = tradeContext.direction === "LONG";

      // Entry line (white/blue)
      series.createPriceLine({
        price: tradeContext.entryPrice,
        color: "#3b82f6",
        lineWidth: 2 as LineWidth,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `Entry ${tradeContext.entryPrice.toFixed(precision)}`,
      });

      // TP line (green)
      series.createPriceLine({
        price: tradeContext.takeProfit,
        color: "#22c55e",
        lineWidth: 1 as LineWidth,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `TP ${tradeContext.takeProfit.toFixed(precision)}`,
      });

      // SL line (red)
      series.createPriceLine({
        price: tradeContext.stopLoss,
        color: "#ef4444",
        lineWidth: 1 as LineWidth,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `SL ${tradeContext.stopLoss.toFixed(precision)}`,
      });

      // Current price line at snapshot time
      series.createPriceLine({
        price: tradeContext.currentPrice,
        color: tradeContext.pnlPips >= 0 ? "#22c55e" : "#ef4444",
        lineWidth: 1 as LineWidth,
        lineStyle: 1,
        axisLabelVisible: true,
        title: `Price ${tradeContext.currentPrice.toFixed(precision)}`,
      });
    }

    // Add horizontal line drawings as price lines
    for (const drawing of drawings) {
      if (isHorizontalLineDrawing(drawing)) {
        series.createPriceLine({
          price: drawing.price,
          color: drawing.color || "#787B86",
          lineWidth: (drawing.lineWidth || 1) as LineWidth,
          lineStyle: drawing.lineStyle === "dashed" ? 2 : drawing.lineStyle === "dotted" ? 1 : 0,
          axisLabelVisible: false,
          title: drawing.label || "",
        });
      }
    }

    // Set visible range to match the snapshot
    const fromTime = snapshot.visibleRange.from / 1000;
    const toTime = snapshot.visibleRange.to / 1000;

    // Find bar indices for the visible range
    let fromIdx = 0;
    let toIdx = candles.length - 1;
    for (let i = 0; i < candles.length; i++) {
      if ((candles[i].time as number) >= fromTime) {
        fromIdx = i;
        break;
      }
    }
    for (let i = candles.length - 1; i >= 0; i--) {
      if ((candles[i].time as number) <= toTime) {
        toIdx = i;
        break;
      }
    }

    chart.timeScale().setVisibleLogicalRange({
      from: fromIdx,
      to: toIdx + 10, // small right margin
    });

    // Drawing overlay canvas
    const drawOverlay = () => {
      if (!containerRef.current || !chartRef.current) return;

      // Create/get canvas
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "10";
        containerRef.current.appendChild(canvas);
        canvasRef.current = canvas;
      }

      const rect = containerRef.current.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const timeScale = chart.timeScale();

      // Draw rectangles (zones)
      for (const drawing of drawings) {
        if (isRectangleDrawing(drawing)) {
          const x1 = timeScale.timeToCoordinate(
            (drawing.anchor1.timestamp / 1000) as Time
          );
          const x2 = timeScale.timeToCoordinate(
            (drawing.anchor2.timestamp / 1000) as Time
          );
          const y1 = series.priceToCoordinate(drawing.anchor1.price);
          const y2 = series.priceToCoordinate(drawing.anchor2.price);

          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

          ctx.fillStyle = drawing.fillColor || "rgba(33, 150, 243, 0.1)";
          ctx.fillRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1)
          );

          ctx.strokeStyle = drawing.borderColor || "#2196F3";
          ctx.lineWidth = drawing.borderWidth || 1;
          ctx.strokeRect(
            Math.min(x1, x2),
            Math.min(y1, y2),
            Math.abs(x2 - x1),
            Math.abs(y2 - y1)
          );

          // Label
          if (drawing.label) {
            ctx.fillStyle = "#d1d5db";
            ctx.font = "11px sans-serif";
            ctx.fillText(drawing.label, Math.min(x1, x2) + 4, Math.min(y1, y2) + 14);
          }
        }

        // Draw trendlines
        if (isTrendlineDrawing(drawing)) {
          const x1 = timeScale.timeToCoordinate(
            (drawing.anchor1.timestamp / 1000) as Time
          );
          const x2 = timeScale.timeToCoordinate(
            (drawing.anchor2.timestamp / 1000) as Time
          );
          const y1 = series.priceToCoordinate(drawing.anchor1.price);
          const y2 = series.priceToCoordinate(drawing.anchor2.price);

          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = drawing.color || "#2962FF";
          ctx.lineWidth = drawing.lineWidth || 1;
          if (drawing.lineStyle === "dashed") {
            ctx.setLineDash([6, 3]);
          } else if (drawing.lineStyle === "dotted") {
            ctx.setLineDash([2, 2]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw fibonacci levels
        if (isFibonacciDrawing(drawing)) {
          const x1 = timeScale.timeToCoordinate(
            (drawing.anchor1.timestamp / 1000) as Time
          );
          const x2 = timeScale.timeToCoordinate(
            (drawing.anchor2.timestamp / 1000) as Time
          );

          if (x1 === null || x2 === null) continue;

          const priceRange = drawing.anchor2.price - drawing.anchor1.price;

          for (const level of drawing.levels) {
            const levelPrice = drawing.anchor1.price + priceRange * level;
            const y = series.priceToCoordinate(levelPrice);
            if (y === null) continue;

            const color =
              drawing.levelColors?.[level] || drawing.lineColor || "#787B86";

            ctx.beginPath();
            ctx.moveTo(Math.min(x1, x2), y);
            ctx.lineTo(Math.max(x1, x2), y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Level label
            if (drawing.showLabels !== false) {
              ctx.fillStyle = color;
              ctx.font = "10px sans-serif";
              ctx.fillText(
                `${(level * 100).toFixed(1)}% (${levelPrice.toFixed(precision)})`,
                Math.max(x1, x2) + 4,
                y + 3
              );
            }
          }
        }

        // Draw position entry markers
        if (isPositionDrawing(drawing)) {
          const x = timeScale.timeToCoordinate(
            (drawing.entry.timestamp / 1000) as Time
          );
          const y = series.priceToCoordinate(drawing.entry.price);

          if (x === null || y === null) continue;

          const isLong = isLongPositionDrawing(drawing);

          // Entry arrow
          ctx.beginPath();
          if (isLong) {
            ctx.moveTo(x, y + 8);
            ctx.lineTo(x - 5, y + 15);
            ctx.lineTo(x + 5, y + 15);
          } else {
            ctx.moveTo(x, y - 8);
            ctx.lineTo(x - 5, y - 15);
            ctx.lineTo(x + 5, y - 15);
          }
          ctx.closePath();
          ctx.fillStyle = isLong ? "#22c55e" : "#ef4444";
          ctx.fill();
        }

        // Draw horizontal rays
        if (isHorizontalRayDrawing(drawing)) {
          const x = timeScale.timeToCoordinate(
            (drawing.anchor.timestamp / 1000) as Time
          );
          const y = series.priceToCoordinate(drawing.anchor.price);

          if (x === null || y === null) continue;

          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(rect.width, y); // Extend to right edge
          ctx.strokeStyle = drawing.color || "#787B86";
          ctx.lineWidth = drawing.lineWidth || 1;
          if (drawing.lineStyle === "dashed") {
            ctx.setLineDash([6, 3]);
          } else if (drawing.lineStyle === "dotted") {
            ctx.setLineDash([2, 2]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };

    // Draw after a small delay to let chart settle
    requestAnimationFrame(() => {
      requestAnimationFrame(drawOverlay);
    });

    return () => {
      if (canvasRef.current && containerRef.current) {
        containerRef.current.removeChild(canvasRef.current);
        canvasRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, drawings, tradeContext, snapshot, height, width, precision, minMove]);

  // Moment label colors
  const momentColors: Record<string, string> = {
    setup: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    entry: "bg-green-500/20 text-green-400 border-green-500/30",
    during: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    exit: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };

  const pnlColor = tradeContext && tradeContext.pnlPips >= 0 ? "text-green-400" : "text-red-400";
  const pnlSign = tradeContext && tradeContext.pnlPips >= 0 ? "+" : "";

  return (
    <div className={`relative ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded border ${
              momentColors[snapshot.momentLabel] || "bg-gray-500/20 text-gray-400"
            }`}
          >
            {snapshot.momentLabel.toUpperCase()}
          </span>
          <span className="text-xs text-gray-400">
            {snapshot.pair.replace("_", "/")} {snapshot.timeframe}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(snapshot.timestamp).toLocaleString()}
          </span>
        </div>
        {tradeContext && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">
              {tradeContext.direction}
            </span>
            <span className={`font-mono font-bold ${pnlColor}`}>
              {pnlSign}{tradeContext.pnlPips.toFixed(1)} pips
            </span>
          </div>
        )}
      </div>

      {/* Chart container */}
      <div
        ref={containerRef}
        className="relative bg-[#0f1117]"
        style={{ height: `${height}px` }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-20">
            <div className="text-sm text-gray-400">Loading replay...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-20">
            <div className="text-sm text-red-400">{error}</div>
          </div>
        )}
      </div>

      {/* Drawing count badge */}
      {drawings.length > 0 && (
        <div className="absolute bottom-2 left-2 text-xs text-gray-500 bg-gray-900/80 px-2 py-1 rounded z-20">
          {drawings.length} drawing{drawings.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
