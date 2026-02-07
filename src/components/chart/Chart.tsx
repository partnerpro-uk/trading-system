"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  createChart,
  IChartApi,
  CandlestickData,
  Time,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
// Convex imports removed - data now lives in TimescaleDB/ClickHouse
import type { LivePrice } from "@/hooks/useOandaStream";
import { useCandles } from "@/hooks/useCandles";
import { SessionLabelsPrimitive, SessionData } from "./SessionLabelsPrimitive";
import { NewsMarkersPrimitive, NewsEventData, HistoricalEventHistory } from "./NewsMarkersPrimitive";
import { LivePricePrimitive } from "./LivePricePrimitive";
import { SwingLabelsPrimitive } from "./SwingLabelsPrimitive";
import type { SwingLabelData } from "./SwingLabelsPrimitive";
import { BOSLinesPrimitive } from "./BOSLinesPrimitive";
import type { BOSLineData } from "./BOSLinesPrimitive";
import { FVGZonesPrimitive } from "./FVGZonesPrimitive";
import type { FVGZoneData } from "./FVGZonesPrimitive";
import { PremiumDiscountPrimitive } from "./PremiumDiscountPrimitive";
import type { PDZoneData } from "./PremiumDiscountPrimitive";
import type { StructureResponse } from "@/lib/structure/types";
import type { IndicatorSeries, IndicatorConfig } from "@/lib/indicators";
import type { ChartMarker, ChartZone } from "@/hooks/useStrategyVisuals";
import type { Drawing, DrawingType, DrawingAnchor, PositionDrawing } from "@/lib/drawings/types";
import {
  isFibonacciDrawing,
  isTrendlineDrawing,
  isHorizontalLineDrawing,
  isHorizontalRayDrawing,
  isRectangleDrawing,
  isCircleDrawing,
  isPositionDrawing,
  isMarkerDrawing,
  MarkerDrawing,
  isLongPositionDrawing,
  isDrawingLocked,
  DEFAULT_FIB_LEVELS,
  DEFAULT_DRAWING_COLORS,
} from "@/lib/drawings/types";
import { ContextualToolbar } from "./ContextualToolbar";
import { DrawingSettings } from "./DrawingSettings";

// Session colors - Asia keeps yellow bg for contrast, London/NY are neutral
const SESSION_COLORS = {
  ASIA: { high: "#fbbf24", low: "#fbbf24", bg: "rgba(255, 220, 0, 0.06)" }, // Yellow
  LONDON: { high: "#ef4444", low: "#ef4444", bg: "rgba(255, 255, 255, 0.02)" }, // Red lines
  NY: { high: "#3b82f6", low: "#3b82f6", bg: "rgba(255, 255, 255, 0.02)" }, // Blue lines
} as const;

// Session time windows (UTC hours)
const SESSION_TIMES = {
  ASIA: { start: 0, end: 9 },    // 00:00 - 09:00 UTC
  LONDON: { start: 8, end: 16 }, // 08:00 - 16:00 UTC
  NY: { start: 13, end: 21 },    // 13:00 - 21:00 UTC
} as const;

// Generate live sessions from candle data (no DB dependency)
interface LiveSession {
  session: "ASIA" | "LONDON" | "NY";
  date: string;
  startTime: number;
  endTime: number;
}

function generateSessionWindowsFromCandles(
  candles: Array<{ timestamp: number }>
): LiveSession[] {
  if (!candles || candles.length === 0) return [];

  // Get unique dates from candles
  const dates = new Set<string>();
  for (const c of candles) {
    const d = new Date(c.timestamp);
    dates.add(d.toISOString().split("T")[0]);
  }

  const liveSessions: LiveSession[] = [];

  for (const dateStr of dates) {
    const baseDate = new Date(dateStr + "T00:00:00Z");

    for (const [sessionName, times] of Object.entries(SESSION_TIMES)) {
      const startTime = baseDate.getTime() + times.start * 60 * 60 * 1000;
      const endTime = baseDate.getTime() + times.end * 60 * 60 * 1000;

      liveSessions.push({
        session: sessionName as "ASIA" | "LONDON" | "NY",
        date: dateStr,
        startTime,
        endTime,
      });
    }
  }

  return liveSessions;
}

// Candle data interface (matches useCandleCache)
interface CandleData {
  time: string;
  timestamp: number;
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartProps {
  pair: string;
  timeframe: string;
  magnetMode: boolean;
  showSessionBgs: boolean;
  showSessionLines: boolean;
  showSessionLabels: boolean;
  showNews: boolean;
  livePrice?: LivePrice | null; // Passed from parent to avoid duplicate streams
  onResetViewReady?: (resetFn: () => void) => void; // Expose reset function to parent
  onScrollToTimestampReady?: (scrollFn: (timestamp: number) => void) => void; // Expose scroll-to-timestamp function
  onEventSelect?: (event: NewsEventData | null, allEventsAtTimestamp?: NewsEventData[]) => void; // Callback when event is clicked
  // External candle data management (from useCandleCache)
  candles?: CandleData[] | null;
  candlesLoading?: boolean;
  isLoadingMore?: boolean;
  hasMoreHistory?: boolean;
  loadMoreHistory?: () => Promise<void>;
  // Strategy indicators
  indicatorSeries?: IndicatorSeries[];
  indicatorConfigs?: IndicatorConfig[];
  // Strategy markers and zones
  strategyMarkers?: ChartMarker[];
  strategyZones?: ChartZone[];
  // Drawing tools
  activeDrawingTool?: DrawingType | null;
  drawings?: Drawing[];
  selectedDrawingId?: string | null;
  onDrawingCreate?: (type: DrawingType, anchors: { anchor1: DrawingAnchor; anchor2?: DrawingAnchor }, options?: Record<string, unknown>) => void;
  onDrawingSelect?: (id: string | null) => void;
  onDrawingUpdate?: (id: string, updates: Partial<Drawing>) => void;
  onDrawingDelete?: (id: string) => void;
  // Trades data for position drawings (source of truth for exits)
  tradesMap?: Map<string, {
    _id: string;
    status: string;
    outcome?: string;
    exitPrice?: number;
    exitTime?: number;
    pnlPips?: number;
  }>;
  // Visible range change callback (timestamps in ms) for snapshot capture
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  // Market structure overlays
  structureData?: StructureResponse | null;
  showSwingLabels?: boolean;
  showBOSLines?: boolean;
  showKeyLevels?: boolean;
  showSweeps?: boolean;
  // Phase 2: FVGs + Premium/Discount
  showFVGs?: boolean;
  fvgTierFilter?: 1 | 2 | 3;
  showPremiumDiscount?: boolean;
}

// Drag/hover part types
type DragType = "move" | "anchor1" | "anchor2" | "price" | "entry" | "tp" | "sl" | "rightEdge";

// Drag state for manipulating drawings
interface DragState {
  type: DragType;
  drawingId: string;
  startX: number;
  startY: number;
  originalDrawing: Drawing;
}

// Get candle duration in milliseconds based on timeframe (M5 is floor - no M1)
function getTimeframeDuration(timeframe: string): number {
  const durations: Record<string, number> = {
    M5: 5 * 60 * 1000,
    M15: 15 * 60 * 1000,
    M30: 30 * 60 * 1000,
    H1: 60 * 60 * 1000,
    H4: 4 * 60 * 60 * 1000,
    D: 24 * 60 * 60 * 1000,
    W: 7 * 24 * 60 * 60 * 1000,
    MN: 30 * 24 * 60 * 60 * 1000, // Approximate month
  };
  return durations[timeframe] || 15 * 60 * 1000;
}

export function Chart({
  pair,
  timeframe,
  magnetMode,
  showSessionBgs,
  showSessionLines,
  showSessionLabels,
  showNews,
  livePrice,
  onResetViewReady,
  onScrollToTimestampReady,
  onEventSelect,
  // External candle management (optional - falls back to internal useCandles)
  candles: externalCandles,
  candlesLoading: externalLoading,
  isLoadingMore: externalLoadingMore,
  hasMoreHistory: externalHasMore,
  loadMoreHistory: externalLoadMore,
  // Strategy indicators
  indicatorSeries,
  indicatorConfigs,
  // Strategy markers and zones
  strategyMarkers,
  strategyZones,
  // Drawing tools
  activeDrawingTool,
  drawings,
  selectedDrawingId,
  onDrawingCreate,
  onDrawingSelect,
  onDrawingUpdate,
  onDrawingDelete,
  tradesMap,
  onVisibleRangeChange,
  // Market structure overlays
  structureData,
  showSwingLabels,
  showBOSLines,
  showKeyLevels,
  showSweeps,
  showFVGs,
  fvgTierFilter = 3,
  showPremiumDiscount,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const futureSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionLineSeriesRef = useRef<Map<string, any>>(new Map());
  const sessionBgCanvasRef = useRef<HTMLCanvasElement>(null);
  const zoneBgCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);
  const candleDataRef = useRef<Map<number, CandlestickData<Time>>>(new Map());
  const sessionLabelsPrimitiveRef = useRef<SessionLabelsPrimitive | null>(null);
  const newsMarkersPrimitiveRef = useRef<NewsMarkersPrimitive | null>(null);
  const livePricePrimitiveRef = useRef<LivePricePrimitive | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indicatorLineSeriesRef = useRef<Map<string, any>>(new Map());
  // Market structure refs
  const swingLabelsPrimitiveRef = useRef<SwingLabelsPrimitive | null>(null);
  const bosLinesPrimitiveRef = useRef<BOSLinesPrimitive | null>(null);
  const fvgZonesPrimitiveRef = useRef<FVGZonesPrimitive | null>(null);
  const pdPrimitiveRef = useRef<PremiumDiscountPrimitive | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyLevelLineSeriesRef = useRef<Map<string, any>>(new Map());

  // Drawing canvas and state
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingAnchor1Ref = useRef<DrawingAnchor | null>(null);
  const isDrawingRef = useRef(false);
  const pendingDrawingRef = useRef<{ type: DrawingType; anchor1: DrawingAnchor; currentPos?: { x: number; y: number } } | null>(null);

  // Hover and drag state for drawing manipulation
  type HoverPart = "anchor1" | "anchor2" | "body" | "price" | "entry" | "tp" | "sl" | "rightEdge";
  const hoveredDrawingIdRef = useRef<string | null>(null);
  const hoveredAnchorRef = useRef<HoverPart | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  // Selected drawing position for contextual toolbar
  const [selectedDrawingPosition, setSelectedDrawingPosition] = useState<{ x: number; y: number } | null>(null);

  // Drawing settings modal state
  const [settingsDrawingId, setSettingsDrawingId] = useState<string | null>(null);

  // Scroll-back loading ref (prevents duplicate load calls)
  const scrollLoadingRef = useRef(false);

  // Track previous candle count for scroll position preservation
  const prevCandleCountRef = useRef(0);
  const prevOldestTimestampRef = useRef<number | null>(null);

  // OHLC display state
  const [hoveredCandle, setHoveredCandle] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    time: Date;
  } | null>(null);

  // Countdown timer for current candle
  const [candleCountdown, setCandleCountdown] = useState<string>("");


  // Cache for historical event data (fetched on hover)
  const [historicalCache, setHistoricalCache] = useState<Map<string, HistoricalEventHistory>>(
    () => new Map()
  );

  // Fetch historical events for tooltip (called on hover)
  // TODO: Migrate to TimescaleDB API endpoint
  const fetchHistoricalEvents = useCallback(
    async (event: NewsEventData) => {
      // Skip if already cached
      if (historicalCache.has(event.eventId)) return;

      // Historical events now in TimescaleDB - API endpoint to be implemented
      // For now, return empty history
      setHistoricalCache((prev) => {
        const next = new Map(prev);
        next.set(event.eventId, { hasForecastData: false, beatHistory: [], missHistory: [], rawHistory: [] });
        return next;
      });
    },
    [pair, historicalCache]
  );

  // Fetch candles from dual-database (Timescale + ClickHouse) via API route
  // Use external candles if provided (from useCandleCache), otherwise use internal hook
  const internalCandles = useCandles({ pair, timeframe });

  // Resolve to external or internal data
  const candles = externalCandles !== undefined ? externalCandles : internalCandles.candles;
  const candlesLoading = externalLoading !== undefined ? externalLoading : internalCandles.isLoading;
  const isLoadingMore = externalLoadingMore !== undefined ? externalLoadingMore : internalCandles.isLoadingMore;
  const hasMoreHistory = externalHasMore !== undefined ? externalHasMore : internalCandles.hasMoreHistory;
  const loadMoreHistory = externalLoadMore !== undefined ? externalLoadMore : internalCandles.loadMoreHistory;

  // Current session indicator (for badge display)
  // Computed locally from current UTC hour - no DB dependency
  const getActiveSessions = useCallback(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const active: string[] = [];
    for (const [name, times] of Object.entries(SESSION_TIMES)) {
      if (utcHour >= times.start && utcHour < times.end) {
        active.push(name);
      }
    }
    return active;
  }, []);
  const [activeSessions, setActiveSessions] = useState<string[]>(() => getActiveSessions());

  // Update active sessions every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSessions(getActiveSessions());
    }, 60000);
    return () => clearInterval(interval);
  }, [getActiveSessions]);

  // News events state (fetched from TimescaleDB API)
  const [newsEvents, setNewsEvents] = useState<NewsEventData[] | null>(null);

  // Fetch news events from TimescaleDB when candles or showNews changes
  useEffect(() => {
    if (!candles || candles.length === 0 || !showNews) {
      setNewsEvents(null);
      return;
    }

    // Compute time range: from oldest candle to newest candle + buffer for upcoming events
    const oldestCandle = candles[0].timestamp;
    const newestCandle = candles[candles.length - 1].timestamp;
    const startTime = oldestCandle - 24 * 60 * 60 * 1000; // 1 day before oldest
    const endTime = newestCandle + 7 * 24 * 60 * 60 * 1000; // 1 week after newest

    const fetchNewsEvents = async () => {
      try {
        // Fetch all events (no impact filter) - API now returns reactions and stats
        const res = await fetch(
          `/api/news/events?pair=${pair}&startTime=${startTime}&endTime=${endTime}`
        );
        if (!res.ok) throw new Error("Failed to fetch news events");
        const data = await res.json();

        // Map API response to NewsEventData format (now includes reaction, stats, and timezone)
        const events: NewsEventData[] = data.events.map((e: {
          eventId: string;
          eventType: string;
          name: string;
          currency: string;
          timestamp: number;
          impact: string;
          actual: string | null;
          forecast: string | null;
          previous: string | null;
          datetimeUtc: string | null;
          datetimeNewYork: string | null;
          datetimeLondon: string | null;
          tradingSession: string | null;
          reaction: {
            spikeDirection: "UP" | "DOWN" | "NEUTRAL" | null;
            spikeMagnitudePips: number | null;
            patternType: string | null;
            didReverse: boolean | null;
            reversalMagnitudePips: number | null;
            finalMatchesSpike: boolean | null;
            priceAtEvent: number | null;
            spikeHigh: number | null;
            spikeLow: number | null;
          } | null;
          stats: {
            totalOccurrences: number;
            avgSpikePips: number | null;
            upCount: number;
            downCount: number;
            reversalRate: number | null;
          } | null;
        }) => ({
          eventId: e.eventId,
          name: e.name,
          eventType: e.eventType,
          currency: e.currency,
          timestamp: e.timestamp,
          impact: e.impact as "high" | "medium" | "low",
          actual: e.actual ?? undefined,
          forecast: e.forecast ?? undefined,
          previous: e.previous ?? undefined,
          datetimeUtc: e.datetimeUtc ?? undefined,
          datetimeNewYork: e.datetimeNewYork ?? undefined,
          datetimeLondon: e.datetimeLondon ?? undefined,
          tradingSession: e.tradingSession ?? undefined,
          reaction: e.reaction ? {
            spikeDirection: e.reaction.spikeDirection,
            spikeMagnitudePips: e.reaction.spikeMagnitudePips,
            patternType: e.reaction.patternType,
            didReverse: e.reaction.didReverse,
          } : null,
          stats: e.stats ? {
            totalOccurrences: e.stats.totalOccurrences,
            avgSpikePips: e.stats.avgSpikePips,
            upCount: e.stats.upCount,
            downCount: e.stats.downCount,
            reversalRate: e.stats.reversalRate,
          } : null,
        }));

        setNewsEvents(events);
      } catch (error) {
        console.error("Error fetching news events:", error);
        setNewsEvents(null);
      }
    };

    fetchNewsEvents();
  }, [candles, showNews, pair]);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#d1d5db",
      },
      localization: {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
          const day = date.getUTCDate();
          const year = date.getUTCFullYear();
          const hours = date.getUTCHours();
          const minutes = date.getUTCMinutes();
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const hour12 = hours % 12 || 12;
          return `${month} ${day} ${year}, ${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        },
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        mode: CrosshairMode.Normal, // We handle magnet manually for full OHLC support
        vertLine: {
          color: "#6b7280",
          width: 1,
          style: 2,
        },
        horzLine: {
          color: "#6b7280",
          width: 1,
          style: 2,
        },
      },
      rightPriceScale: {
        borderColor: "#374151",
        autoScale: true, // Auto-scale on - user can disable by dragging
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 50, // Show future space like TradingView
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false, // Prevent vertical scroll fighting
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        mouse: true, // Enable momentum scrolling
        touch: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#089981",
      downColor: "#f23645",
      borderUpColor: "#089981",
      borderDownColor: "#f23645",
      wickUpColor: "#089981",
      wickDownColor: "#f23645",
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
      // Disable default price label - we use a custom price line instead
      lastValueVisible: false,
    });

    // Invisible line series to extend time axis into future
    const futureSeries = chart.addSeries(LineSeries, {
      color: "transparent",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    futureSeriesRef.current = futureSeries;

    // Create and attach session labels primitive
    const labelsPrimitive = new SessionLabelsPrimitive();
    series.attachPrimitive(labelsPrimitive);
    sessionLabelsPrimitiveRef.current = labelsPrimitive;

    // Create and attach news markers primitive
    const newsPrimitive = new NewsMarkersPrimitive();
    series.attachPrimitive(newsPrimitive);
    newsMarkersPrimitiveRef.current = newsPrimitive;

    // Create and attach live price primitive (shows price line + countdown)
    const livePricePrimitive = new LivePricePrimitive();
    series.attachPrimitive(livePricePrimitive);
    livePricePrimitiveRef.current = livePricePrimitive;

    // Create and attach market structure primitives
    const swingPrimitive = new SwingLabelsPrimitive();
    series.attachPrimitive(swingPrimitive);
    swingLabelsPrimitiveRef.current = swingPrimitive;

    const bosPrimitive = new BOSLinesPrimitive();
    series.attachPrimitive(bosPrimitive);
    bosLinesPrimitiveRef.current = bosPrimitive;

    const fvgPrimitive = new FVGZonesPrimitive();
    series.attachPrimitive(fvgPrimitive);
    fvgZonesPrimitiveRef.current = fvgPrimitive;

    const pdPrimitive = new PremiumDiscountPrimitive();
    series.attachPrimitive(pdPrimitive);
    pdPrimitiveRef.current = pdPrimitive;

    // Subscribe to crosshair move for OHLC display
    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.size > 0) {
        const data = param.seriesData.get(series) as CandlestickData<Time> | undefined;
        if (data) {
          setHoveredCandle({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            time: new Date((data.time as number) * 1000),
          });
        }
      } else {
        setHoveredCandle(null);
      }
    });

    // Handle resize - use ResizeObserver to detect panel/container size changes
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    // ResizeObserver detects container size changes (e.g., from resizable panels)
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(containerRef.current);

    window.addEventListener("resize", handleResize);
    handleResize();

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      futureSeriesRef.current = null;
      livePricePrimitiveRef.current = null;
      swingLabelsPrimitiveRef.current = null;
      bosLinesPrimitiveRef.current = null;
      fvgZonesPrimitiveRef.current = null;
      pdPrimitiveRef.current = null;
      keyLevelLineSeriesRef.current.clear();
    };
  }, []);

  // Custom OHLC magnet - snaps to nearest O, H, L, or C value
  useEffect(() => {
    if (!containerRef.current || !chartRef.current || !seriesRef.current) return;

    const container = containerRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      if (!magnetMode || !chartRef.current || !seriesRef.current) return;

      const chart = chartRef.current;
      const series = seriesRef.current;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Get the time coordinate from x position
      const timeCoord = chart.timeScale().coordinateToTime(x);
      if (timeCoord === null) return;

      // Get the candle data at this time
      const candleData = candleDataRef.current.get(timeCoord as number);
      if (!candleData) return;

      // Get the price coordinate from y position
      const priceCoord = series.coordinateToPrice(y);
      if (priceCoord === null) return;

      // Find nearest OHLC value
      const ohlcValues = [
        { price: candleData.open, label: "O" },
        { price: candleData.high, label: "H" },
        { price: candleData.low, label: "L" },
        { price: candleData.close, label: "C" },
      ];

      let nearest = ohlcValues[0];
      let minDist = Math.abs(priceCoord - ohlcValues[0].price);

      for (const val of ohlcValues) {
        const dist = Math.abs(priceCoord - val.price);
        if (dist < minDist) {
          minDist = dist;
          nearest = val;
        }
      }

      // Snap crosshair to nearest OHLC value
      chart.setCrosshairPosition(nearest.price, timeCoord, series);
    };

    const handleMouseLeave = () => {
      if (chartRef.current) {
        chartRef.current.clearCrosshairPosition();
      }
    };

    if (magnetMode) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [magnetMode]);

  // Update data when candles change
  useEffect(() => {
    if (!seriesRef.current || !candles || candles.length === 0) return;

    const formattedData: CandlestickData<Time>[] = candles.map((c) => ({
      time: (c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    // Store candle data in ref for quick lookup (used by custom magnet)
    candleDataRef.current.clear();
    for (const candle of formattedData) {
      candleDataRef.current.set(candle.time as number, candle);
    }

    // Detect if older candles were prepended (scroll-back load)
    const currentOldestTimestamp = candles[0].timestamp;
    const prevCount = prevCandleCountRef.current;
    const prevOldestTimestamp = prevOldestTimestampRef.current;
    const isPrepend = prevOldestTimestamp !== null &&
                      currentOldestTimestamp < prevOldestTimestamp &&
                      candles.length > prevCount;

    // Calculate number of candles prepended
    const prependedCount = isPrepend ? (candles.length - prevCount) : 0;

    // Get current visible range BEFORE updating data (for scroll preservation)
    let currentVisibleRange = null;
    if (chartRef.current && isPrepend) {
      currentVisibleRange = chartRef.current.timeScale().getVisibleLogicalRange();
    }

    seriesRef.current.setData(formattedData);
    lastCandleRef.current = formattedData[formattedData.length - 1];

    // Add future time points to show labels on time axis
    if (futureSeriesRef.current && formattedData.length > 0) {
      const lastCandle = formattedData[formattedData.length - 1];
      const lastPrice = lastCandle.close;
      const duration = getTimeframeDuration(timeframe);
      const durationSeconds = duration / 1000;

      // Calculate bars needed to show 1 year into the future (for news events)
      // Cap at 15000 bars to prevent performance issues on lower timeframes
      const DAYS_FORWARD = 365;
      const msPerDay = 24 * 60 * 60 * 1000;
      const futureBarsNeeded = Math.min(15000, Math.ceil((DAYS_FORWARD * msPerDay) / duration));

      // Generate future time points
      const futureData: { time: Time; value: number }[] = [];
      let futureTime = (lastCandle.time as number) + durationSeconds;

      for (let i = 0; i < futureBarsNeeded; i++) {
        futureData.push({
          time: futureTime as Time,
          value: lastPrice,
        });
        futureTime += durationSeconds;
      }

      futureSeriesRef.current.setData(futureData);
    }

    // Handle scroll position
    if (chartRef.current) {
      if (isPrepend && currentVisibleRange) {
        // Preserve scroll position by shifting the range by the number of prepended candles
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: currentVisibleRange.from + prependedCount,
          to: currentVisibleRange.to + prependedCount,
        });
      } else if (prevCount === 0) {
        // Initial load - show recent ~100 candles
        const visibleBars = Math.min(100, formattedData.length);
        const duration = getTimeframeDuration(timeframe);
        const msPerDay = 24 * 60 * 60 * 1000;
        const visibleFutureBars = Math.ceil((5 * msPerDay) / duration);
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: formattedData.length - visibleBars,
          to: formattedData.length + visibleFutureBars,
        });
      }
    }

    // Update refs for next render
    prevCandleCountRef.current = candles.length;
    prevOldestTimestampRef.current = currentOldestTimestamp;
  }, [candles, timeframe]);

  // Session H/L stepping lines (like TradingView linebr style)
  // LIVE - generates session windows from candle data, no DB dependency
  useEffect(() => {
    if (!chartRef.current || !candles || candles.length === 0) return;

    const chart = chartRef.current;

    // Remove existing session line series
    for (const [, series] of sessionLineSeriesRef.current) {
      try {
        chart.removeSeries(series);
      } catch {
        // Series may already be removed
      }
    }
    sessionLineSeriesRef.current.clear();

    if (!showSessionLines) return;

    // Generate session windows from candle timestamps (LIVE)
    const liveSessions = generateSessionWindowsFromCandles(candles);
    if (liveSessions.length === 0) return;

    // For each session, create high and low line series
    for (const session of liveSessions) {
      const sessionType = session.session;
      const colors = SESSION_COLORS[sessionType];
      if (!colors) continue;

      // Filter candles within session time range
      const sessionCandles = candles.filter(
        (c) => c.timestamp >= session.startTime && c.timestamp <= session.endTime
      );

      if (sessionCandles.length === 0) continue;

      // Calculate running high/low as the session progresses
      let runningHigh = sessionCandles[0].high;
      let runningLow = sessionCandles[0].low;

      const highLineData: { time: Time; value: number }[] = [];
      const lowLineData: { time: Time; value: number }[] = [];

      for (const candle of sessionCandles) {
        // Update running H/L
        if (candle.high > runningHigh) {
          runningHigh = candle.high;
        }
        if (candle.low < runningLow) {
          runningLow = candle.low;
        }

        // Add data point
        const time = (candle.timestamp / 1000) as Time;
        highLineData.push({ time, value: runningHigh });
        lowLineData.push({ time, value: runningLow });
      }

      // Create high line series
      const highSeries = chart.addSeries(LineSeries, {
        color: colors.high,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      highSeries.setData(highLineData);
      sessionLineSeriesRef.current.set(`${session.date}-${sessionType}-high`, highSeries);

      // Create low line series
      const lowSeries = chart.addSeries(LineSeries, {
        color: colors.low,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lowSeries.setData(lowLineData);
      sessionLineSeriesRef.current.set(`${session.date}-${sessionType}-low`, lowSeries);
    }

    // Cleanup on unmount
    return () => {
      for (const [, series] of sessionLineSeriesRef.current) {
        try {
          chart.removeSeries(series);
        } catch {
          // Series may already be removed
        }
      }
      sessionLineSeriesRef.current.clear();
    };
  }, [candles, showSessionLines]);

  // Render market structure overlays
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    // --- Swing Labels ---
    if (swingLabelsPrimitiveRef.current) {
      if (showSwingLabels && structureData?.swings) {
        const swingData: SwingLabelData[] = structureData.swings
          .filter((s) => s.label)
          .map((s) => ({
            timestamp: s.timestamp,
            price: s.price,
            label: s.label!,
            type: s.type,
          }));
        swingLabelsPrimitiveRef.current.updateSwings(swingData);
      } else {
        swingLabelsPrimitiveRef.current.updateSwings([]);
      }
    }

    // --- BOS Lines ---
    if (bosLinesPrimitiveRef.current) {
      if (showBOSLines && structureData?.bosEvents) {
        const bosData: BOSLineData[] = structureData.bosEvents.map((e) => ({
          brokenLevel: e.brokenLevel,
          brokenSwingTimestamp: e.brokenSwingTimestamp,
          direction: e.direction,
          status: e.status,
          confirmingTimestamp: e.timestamp,
          magnitudePips: e.magnitudePips,
          reclaimedAt: e.reclaimedAt,
          bosType: e.bosType ?? "bos",
          timeframe,
        }));
        bosLinesPrimitiveRef.current.updateBOSEvents(bosData);
      } else {
        bosLinesPrimitiveRef.current.updateBOSEvents([]);
      }
    }

    // --- Key Level Lines ---
    // Remove existing key level series
    for (const [, s] of keyLevelLineSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // Series may already be removed
      }
    }
    keyLevelLineSeriesRef.current.clear();

    if (showKeyLevels && structureData?.keyLevelEntries && candles && candles.length > 1) {
      const firstTime = (candles[0].timestamp / 1000) as Time;
      const lastTime = (candles[candles.length - 1].timestamp / 1000) as Time;

      const KEY_LEVEL_COLORS: Record<string, string> = {
        PDH: "#6b7280", PDL: "#6b7280",   // gray-500
        PWH: "#f97316", PWL: "#f97316",   // orange-500
        PMH: "#3b82f6", PML: "#3b82f6",   // blue-500
        YH: "#eab308",  YL: "#eab308",    // yellow-500
      };

      for (const entry of structureData.keyLevelEntries) {
        const color = KEY_LEVEL_COLORS[entry.label] || "#6b7280";
        const levelSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: entry.label,
        });
        levelSeries.setData([
          { time: firstTime, value: entry.price },
          { time: lastTime, value: entry.price },
        ]);
        keyLevelLineSeriesRef.current.set(entry.label, levelSeries);
      }
    }

    // --- Sweep Markers ---
    if (showSweeps && structureData?.sweepEvents && seriesRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chartAny = chart as any;
      const sweepMarkers = structureData.sweepEvents.map((s) => ({
        time: (s.timestamp / 1000) as Time,
        position: s.direction === "bullish" ? "belowBar" as const : "aboveBar" as const,
        color: s.direction === "bullish" ? "#22c55e" : "#ef4444",
        shape: s.direction === "bullish" ? "arrowUp" as const : "arrowDown" as const,
        text: s.followedByBOS ? "S+" : "S",
      }));
      sweepMarkers.sort((a, b) => (a.time as number) - (b.time as number));

      // Merge with existing strategy markers if any
      if (chartAny.setMarkers) {
        chartAny.setMarkers(series, sweepMarkers);
      }
    }

    // --- FVG Zones ---
    if (fvgZonesPrimitiveRef.current) {
      fvgZonesPrimitiveRef.current.setTierFilter(fvgTierFilter as 1 | 2 | 3);
      if (showFVGs && structureData?.fvgEvents) {
        const fvgData: FVGZoneData[] = structureData.fvgEvents
          .filter((f) => f.status === "fresh" || f.status === "partial")
          .map((f) => ({
            topPrice: f.topPrice,
            bottomPrice: f.bottomPrice,
            midline: f.midline,
            direction: f.direction,
            status: f.status,
            tier: f.tier,
            createdAt: f.createdAt,
            fillPercent: f.fillPercent,
          }));
        fvgZonesPrimitiveRef.current.updateFVGs(fvgData);
      } else {
        fvgZonesPrimitiveRef.current.updateFVGs([]);
      }
    }

    // --- Premium/Discount ---
    if (pdPrimitiveRef.current) {
      if (showPremiumDiscount && structureData?.premiumDiscount) {
        const pd = structureData.premiumDiscount;
        // Use H4 dealing range by default
        const pdData: PDZoneData = {
          equilibrium: pd.h4Equilibrium,
          swingHigh: pd.h4SwingRange.high,
          swingLow: pd.h4SwingRange.low,
        };
        pdPrimitiveRef.current.updateZone(pdData);
      } else {
        pdPrimitiveRef.current.updateZone(null);
      }
    }

    return () => {
      for (const [, s] of keyLevelLineSeriesRef.current) {
        try {
          chart.removeSeries(s);
        } catch {
          // Series may already be removed
        }
      }
      keyLevelLineSeriesRef.current.clear();
    };
  }, [structureData, showSwingLabels, showBOSLines, showKeyLevels, showSweeps, showFVGs, fvgTierFilter, showPremiumDiscount, candles]);

  // Render strategy indicator line series
  useEffect(() => {
    if (!chartRef.current) return;

    const chart = chartRef.current;

    // Remove existing indicator series
    for (const [, series] of indicatorLineSeriesRef.current) {
      try {
        chart.removeSeries(series);
      } catch {
        // Series may already be removed
      }
    }
    indicatorLineSeriesRef.current.clear();

    // Skip if no indicator series provided
    if (!indicatorSeries || indicatorSeries.length === 0 || !indicatorConfigs) return;

    // Create line series for each visible indicator
    for (const series of indicatorSeries) {
      // Find the config for this series
      const config = indicatorConfigs.find((c) => c.id === series.id);
      if (!config) continue;

      // Skip if not visible
      if (config.style.visible === false) continue;

      // Convert indicator values to line data format
      const lineData = series.values.map((v) => ({
        time: (v.timestamp / 1000) as Time,
        value: v.value,
      }));

      // Create line series with config styling
      const lineSeries = chart.addSeries(LineSeries, {
        color: config.style.color,
        lineWidth: (config.style.lineWidth || 2) as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        lineStyle: config.style.lineStyle === "dashed" ? 1 : config.style.lineStyle === "dotted" ? 2 : 0,
        priceScaleId: config.style.priceScaleId || "right",
      });

      lineSeries.setData(lineData);
      indicatorLineSeriesRef.current.set(series.id, lineSeries);
    }

    // Cleanup on unmount or when indicators change
    return () => {
      for (const [, series] of indicatorLineSeriesRef.current) {
        try {
          chart.removeSeries(series);
        } catch {
          // Series may already be removed
        }
      }
      indicatorLineSeriesRef.current.clear();
    };
  }, [indicatorSeries, indicatorConfigs]);

  // Render strategy markers on candlestick series
  // lightweight-charts v5: markers are set on chart, not series
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;

    if (!chart || !series) return;

    // v5 API: chart.setMarkers(series, markers)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chartAny = chart as any;

    if (!chartAny.setMarkers) {
      return; // API not available
    }

    if (!strategyMarkers || strategyMarkers.length === 0) {
      // Clear markers
      chartAny.setMarkers(series, []);
      return;
    }

    // Convert ChartMarker to lightweight-charts SeriesMarker format
    const markers = strategyMarkers.map((m) => ({
      time: (m.time / 1000) as Time,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text || "",
    }));

    // Sort by time (required by lightweight-charts)
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    chartAny.setMarkers(series, markers);

    // Cleanup
    return () => {
      if (chartAny.setMarkers && series) {
        chartAny.setMarkers(series, []);
      }
    };
  }, [strategyMarkers]);

  // Render strategy zones as background colors
  useEffect(() => {
    if (!zoneBgCanvasRef.current || !chartRef.current || !containerRef.current) {
      return;
    }

    const canvas = zoneBgCanvasRef.current;
    const chart = chartRef.current;
    const container = containerRef.current;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas if no zones
    if (!strategyZones || strategyZones.length === 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const drawZones = () => {
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = container.clientWidth;
      const logicalHeight = container.clientHeight;

      // Setup DPI-aware canvas
      const needsResize = canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr;
      if (needsResize) {
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        canvas.style.width = `${logicalWidth}px`;
        canvas.style.height = `${logicalHeight}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      const timeScale = chart.timeScale();

      for (const zone of strategyZones) {
        // Convert zone times to x coordinates
        const startX = timeScale.timeToCoordinate((zone.startTime / 1000) as Time);
        const endX = timeScale.timeToCoordinate((zone.endTime / 1000) as Time);

        if (startX === null || endX === null) continue;

        // Draw background rectangle (full height)
        ctx.fillStyle = zone.color;
        ctx.fillRect(startX, 0, endX - startX, logicalHeight);
      }
    };

    // Draw initially
    drawZones();

    // Redraw when visible range changes
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(drawZones);

    // Redraw on resize
    const handleResize = () => drawZones();
    window.addEventListener("resize", handleResize);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(drawZones);
      window.removeEventListener("resize", handleResize);
    };
  }, [strategyZones]);

  // Drawing interaction handlers with hover and drag support
  useEffect(() => {
    if (!drawingCanvasRef.current || !chartRef.current || !containerRef.current || !seriesRef.current) {
      return;
    }

    const canvas = drawingCanvasRef.current;
    const chart = chartRef.current;
    const container = containerRef.current;
    const series = seriesRef.current;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ANCHOR_RADIUS = 6;
    const HIT_THRESHOLD = 10;

    // Helper to get time/price from mouse position
    const getCoordinatesFromMouse = (e: MouseEvent, applyMagnet = true): { time: number; price: number; x: number; y: number } | null => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const timeCoord = chart.timeScale().coordinateToTime(x);
      const priceCoord = series.coordinateToPrice(y);

      if (timeCoord === null || priceCoord === null) return null;

      let timestamp = (timeCoord as number) * 1000;
      let price = priceCoord;

      // Apply magnet mode if enabled
      if (applyMagnet && magnetMode) {
        const candleData = candleDataRef.current.get(timeCoord as number);
        if (candleData) {
          const ohlcValues = [candleData.open, candleData.high, candleData.low, candleData.close];
          let nearest = ohlcValues[0];
          let minDist = Math.abs(priceCoord - ohlcValues[0]);
          for (const val of ohlcValues) {
            const dist = Math.abs(priceCoord - val);
            if (dist < minDist) {
              minDist = dist;
              nearest = val;
            }
          }
          price = nearest;
        }
      }

      return { time: timestamp, price, x, y };
    };

    // Get drawing coordinates for hit testing
    const getDrawingCoords = (drawing: Drawing) => {
      const timeScale = chart.timeScale();
      if (isHorizontalLineDrawing(drawing)) {
        const y = series.priceToCoordinate(drawing.price);
        return y !== null ? { type: "horizontal" as const, y, price: drawing.price } : null;
      } else if (isHorizontalRayDrawing(drawing)) {
        const x = timeScale.timeToCoordinate((drawing.anchor.timestamp / 1000) as Time);
        const y = series.priceToCoordinate(drawing.anchor.price);
        return x !== null && y !== null ? { type: "horizontalRay" as const, x, y, anchor: drawing.anchor } : null;
      } else if (isPositionDrawing(drawing)) {
        const entryX = timeScale.timeToCoordinate((drawing.entry.timestamp / 1000) as Time);
        const entryY = series.priceToCoordinate(drawing.entry.price);
        const tpY = series.priceToCoordinate(drawing.takeProfit);
        const slY = series.priceToCoordinate(drawing.stopLoss);
        if (entryX === null || entryY === null || tpY === null || slY === null) return null;

        // Calculate right edge - use fixed default width (250px), not infinite
        const DEFAULT_POSITION_WIDTH = 250;
        let rightEdgeX: number;
        if (drawing.endTimestamp) {
          const endX = timeScale.timeToCoordinate((drawing.endTimestamp / 1000) as Time);
          rightEdgeX = endX !== null ? endX : entryX + DEFAULT_POSITION_WIDTH;
        } else {
          rightEdgeX = entryX + DEFAULT_POSITION_WIDTH;
        }

        return {
          type: "position" as const,
          entryX,
          entryY,
          tpY,
          slY,
          rightEdgeX,
          drawing,
        };
      } else if (isMarkerDrawing(drawing)) {
        const x = timeScale.timeToCoordinate((drawing.anchor.timestamp / 1000) as Time);
        const y = series.priceToCoordinate(drawing.anchor.price);
        return x !== null && y !== null ? { type: "marker" as const, x, y, anchor: drawing.anchor } : null;
      } else if (isTrendlineDrawing(drawing) || isFibonacciDrawing(drawing) || isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
        const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
        const x1 = timeScale.timeToCoordinate((d.anchor1.timestamp / 1000) as Time);
        const y1 = series.priceToCoordinate(d.anchor1.price);
        const x2 = timeScale.timeToCoordinate((d.anchor2.timestamp / 1000) as Time);
        const y2 = series.priceToCoordinate(d.anchor2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
        return { type: "twoPoint" as const, x1, y1, x2, y2, anchor1: d.anchor1, anchor2: d.anchor2 };
      }
      return null;
    };

    // Check what part of a drawing the mouse is over
    const getHoverInfo = (mouseX: number, mouseY: number): { drawingId: string; part: HoverPart } | null => {
      if (!drawings) return null;

      // Check drawings in reverse order (top drawings first)
      for (let i = drawings.length - 1; i >= 0; i--) {
        const drawing = drawings[i];
        const coords = getDrawingCoords(drawing);
        if (!coords) continue;

        if (coords.type === "horizontal") {
          // Check if near the horizontal line
          if (Math.abs(mouseY - coords.y) < HIT_THRESHOLD) {
            return { drawingId: drawing.id, part: "price" };
          }
        } else if (coords.type === "horizontalRay") {
          // Check anchor point first
          if (Math.hypot(mouseX - coords.x, mouseY - coords.y) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "anchor1" };
          }
          // Check if near the ray line (from anchor to right edge)
          if (mouseX >= coords.x && Math.abs(mouseY - coords.y) < HIT_THRESHOLD) {
            return { drawingId: drawing.id, part: "body" };
          }
        } else if (coords.type === "position") {
          // Position drawing - check anchors for entry, TP, SL, and right edge
          // Check entry anchor (left side)
          if (Math.hypot(mouseX - coords.entryX, mouseY - coords.entryY) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "entry" };
          }
          // Check TP anchor (left side of TP line)
          if (Math.hypot(mouseX - coords.entryX, mouseY - coords.tpY) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "tp" };
          }
          // Check SL anchor (left side of SL line)
          if (Math.hypot(mouseX - coords.entryX, mouseY - coords.slY) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "sl" };
          }
          // Check right edge anchor
          if (Math.hypot(mouseX - coords.rightEdgeX, mouseY - coords.entryY) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "rightEdge" };
          }
          // Check if inside the position body
          const minX = coords.entryX;
          const maxX = coords.rightEdgeX;
          const minY = Math.min(coords.tpY, coords.slY);
          const maxY = Math.max(coords.tpY, coords.slY);
          if (mouseX >= minX - HIT_THRESHOLD && mouseX <= maxX + HIT_THRESHOLD &&
              mouseY >= minY - HIT_THRESHOLD && mouseY <= maxY + HIT_THRESHOLD) {
            return { drawingId: drawing.id, part: "body" };
          }
        } else if (coords.type === "marker") {
          // Marker drawing - single point, use larger hit area for easier selection
          const markerSize = 15; // Match visual size
          if (Math.hypot(mouseX - coords.x, mouseY - coords.y) < markerSize + 5) {
            return { drawingId: drawing.id, part: "body" };
          }
        } else if (coords.type === "twoPoint") {
          // Check anchor1 first (higher priority)
          if (Math.hypot(mouseX - coords.x1, mouseY - coords.y1) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "anchor1" };
          }
          // Check anchor2
          if (Math.hypot(mouseX - coords.x2, mouseY - coords.y2) < ANCHOR_RADIUS + 4) {
            return { drawingId: drawing.id, part: "anchor2" };
          }
          // Check body (line or area)
          if (isTrendlineDrawing(drawing)) {
            if (distanceToLineSegment(mouseX, mouseY, coords.x1, coords.y1, coords.x2, coords.y2) < HIT_THRESHOLD) {
              return { drawingId: drawing.id, part: "body" };
            }
          } else {
            // Rectangle or Fibonacci - check bounding box
            const minX = Math.min(coords.x1, coords.x2);
            const maxX = Math.max(coords.x1, coords.x2);
            const minY = Math.min(coords.y1, coords.y2);
            const maxY = Math.max(coords.y1, coords.y2);
            if (mouseX >= minX - HIT_THRESHOLD && mouseX <= maxX + HIT_THRESHOLD &&
                mouseY >= minY - HIT_THRESHOLD && mouseY <= maxY + HIT_THRESHOLD) {
              return { drawingId: drawing.id, part: "body" };
            }
          }
        }
      }
      return null;
    };

    // Update cursor based on hover state
    const updateCursor = (part: HoverPart | null, drawingId?: string | null) => {
      if (activeDrawingTool) {
        canvas.style.cursor = "crosshair";
        return;
      }

      // Check if the hovered drawing is locked
      if (drawingId && drawings) {
        const drawing = drawings.find(d => d.id === drawingId);
        if (drawing && isDrawingLocked(drawing)) {
          // Locked drawings show pointer cursor (can select but not move)
          canvas.style.cursor = part ? "pointer" : "default";
          return;
        }
      }

      if (part === "anchor1" || part === "anchor2" || part === "entry") {
        canvas.style.cursor = "grab";
      } else if (part === "tp" || part === "sl") {
        canvas.style.cursor = "ns-resize"; // Vertical resize for TP/SL
      } else if (part === "rightEdge") {
        canvas.style.cursor = "ew-resize"; // Horizontal resize for width
      } else if (part === "body" || part === "price") {
        canvas.style.cursor = "move";
      } else {
        canvas.style.cursor = "default";
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // If drawing tool is active, start creating new drawing
      if (activeDrawingTool) {
        const coords = getCoordinatesFromMouse(e);
        if (!coords) return;

        const anchor: DrawingAnchor = { timestamp: coords.time, price: coords.price };

        if (activeDrawingTool === "horizontalLine") {
          if (onDrawingCreate) {
            onDrawingCreate("horizontalLine", { anchor1: anchor }, { price: coords.price });
          }
          return;
        }

        if (activeDrawingTool === "horizontalRay") {
          if (onDrawingCreate) {
            onDrawingCreate("horizontalRay", { anchor1: anchor });
          }
          return;
        }

        // Marker drawings are single-click
        if (activeDrawingTool === "markerArrowUp" || activeDrawingTool === "markerArrowDown" ||
            activeDrawingTool === "markerCircle" || activeDrawingTool === "markerSquare") {
          if (onDrawingCreate) {
            onDrawingCreate(activeDrawingTool, { anchor1: anchor });
          }
          return;
        }

        drawingAnchor1Ref.current = anchor;
        isDrawingRef.current = true;
        pendingDrawingRef.current = { type: activeDrawingTool, anchor1: anchor };
        return;
      }

      // Check if clicking on existing drawing for drag
      const hoverInfo = getHoverInfo(mouseX, mouseY);
      if (hoverInfo && drawings) {
        const drawing = drawings.find(d => d.id === hoverInfo.drawingId);
        if (drawing) {
          // Select the drawing
          if (onDrawingSelect) {
            onDrawingSelect(drawing.id);
          }

          // Check if drawing is locked (strategy-generated drawings cannot be moved)
          if (isDrawingLocked(drawing)) {
            // Allow selection but prevent dragging
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          // Determine drag type based on part
          let dragType: "anchor1" | "anchor2" | "price" | "move" | "entry" | "tp" | "sl" | "rightEdge" | null;
          if (hoverInfo.part === "anchor1") dragType = "anchor1";
          else if (hoverInfo.part === "anchor2") dragType = "anchor2";
          else if (hoverInfo.part === "price") dragType = "price";
          else if (hoverInfo.part === "entry") dragType = "entry";
          else if (hoverInfo.part === "tp") dragType = "tp";
          else if (hoverInfo.part === "sl") dragType = "sl";
          else if (hoverInfo.part === "rightEdge") dragType = "rightEdge";
          else if (isPositionDrawing(drawing)) {
            // For position drawings, clicking on body should only select, not drag
            // User must click on specific handles (entry/tp/sl/rightEdge) to drag
            dragType = null;
          }
          else dragType = "move";

          // Only start drag if we have a valid drag type (not just a body click on position)
          if (dragType !== null) {
            dragStateRef.current = {
              type: dragType,
              drawingId: drawing.id,
              startX: mouseX,
              startY: mouseY,
              originalDrawing: { ...drawing } as Drawing,
            };
            canvas.style.cursor = "grabbing";
          }

          // Prevent both default and propagation to stop chart pan
          e.preventDefault();
          e.stopPropagation();
          return; // Exit early to avoid any further processing
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Handle creating new drawing
      if (isDrawingRef.current && pendingDrawingRef.current) {
        pendingDrawingRef.current.currentPos = { x: mouseX, y: mouseY };
        drawAllDrawings();
        return;
      }

      // Handle dragging existing drawing
      if (dragStateRef.current && onDrawingUpdate) {
        const coords = getCoordinatesFromMouse(e, false); // Don't apply magnet during drag
        if (!coords) return;

        const { type, drawingId, originalDrawing, startX, startY } = dragStateRef.current;

        // Dead zone: only process drag if mouse moved more than 3px (prevents accidental drag on click)
        const moveDistance = Math.hypot(mouseX - startX, mouseY - startY);
        if (moveDistance < 3) return;

        // Safely compute time delta - protect against null coordinateToTime
        const startTime = chart.timeScale().coordinateToTime(startX);
        if (startTime === null) return; // Can't compute delta, abort drag
        const timeDelta = coords.time - (startTime as number) * 1000;

        const priceDelta = coords.price - (series.coordinateToPrice(startY) || 0);

        if (isHorizontalLineDrawing(originalDrawing)) {
          // Move horizontal line
          const newPrice = (originalDrawing as { price: number }).price + priceDelta;
          onDrawingUpdate(drawingId, { price: newPrice });
        } else if (isHorizontalRayDrawing(originalDrawing)) {
          // Move horizontal ray - has single anchor
          const orig = originalDrawing as { anchor: DrawingAnchor };
          onDrawingUpdate(drawingId, {
            anchor: {
              timestamp: orig.anchor.timestamp + timeDelta,
              price: orig.anchor.price + priceDelta,
            },
          });
        } else if (isTrendlineDrawing(originalDrawing) || isFibonacciDrawing(originalDrawing) || isRectangleDrawing(originalDrawing) || isCircleDrawing(originalDrawing)) {
          const orig = originalDrawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };

          if (type === "anchor1") {
            // Move only anchor1
            onDrawingUpdate(drawingId, {
              anchor1: {
                timestamp: orig.anchor1.timestamp + timeDelta,
                price: orig.anchor1.price + priceDelta,
              },
            });
          } else if (type === "anchor2") {
            // Move only anchor2
            onDrawingUpdate(drawingId, {
              anchor2: {
                timestamp: orig.anchor2.timestamp + timeDelta,
                price: orig.anchor2.price + priceDelta,
              },
            });
          } else {
            // Move entire drawing
            onDrawingUpdate(drawingId, {
              anchor1: {
                timestamp: orig.anchor1.timestamp + timeDelta,
                price: orig.anchor1.price + priceDelta,
              },
              anchor2: {
                timestamp: orig.anchor2.timestamp + timeDelta,
                price: orig.anchor2.price + priceDelta,
              },
            });
          }
        } else if (isPositionDrawing(originalDrawing)) {
          // Handle position drawing drag
          const orig = originalDrawing as PositionDrawing;

          if (type === "tp") {
            // Drag TP line - only adjust take profit price
            onDrawingUpdate(drawingId, {
              takeProfit: orig.takeProfit + priceDelta,
              riskRewardRatio: Math.abs((orig.takeProfit + priceDelta) - orig.entry.price) / Math.abs(orig.entry.price - orig.stopLoss),
            });
          } else if (type === "sl") {
            // Drag SL line - only adjust stop loss price
            onDrawingUpdate(drawingId, {
              stopLoss: orig.stopLoss + priceDelta,
              riskRewardRatio: Math.abs(orig.takeProfit - orig.entry.price) / Math.abs(orig.entry.price - (orig.stopLoss + priceDelta)),
            });
          } else if (type === "rightEdge") {
            // Drag right edge - adjust width (endTimestamp)
            const newEndTimestamp = (orig.endTimestamp || orig.entry.timestamp + 3600000) + timeDelta;
            // Don't let right edge go before entry
            if (newEndTimestamp > orig.entry.timestamp) {
              onDrawingUpdate(drawingId, {
                endTimestamp: newEndTimestamp,
              });
            }
          } else if (type === "entry") {
            // Drag entry - move entry price only (keep TP/SL distances)
            const tpDist = orig.takeProfit - orig.entry.price;
            const slDist = orig.stopLoss - orig.entry.price;
            onDrawingUpdate(drawingId, {
              entry: {
                timestamp: orig.entry.timestamp + timeDelta,
                price: orig.entry.price + priceDelta,
              },
              takeProfit: orig.entry.price + priceDelta + tpDist,
              stopLoss: orig.entry.price + priceDelta + slDist,
              endTimestamp: orig.endTimestamp ? orig.endTimestamp + timeDelta : undefined,
            });
          } else {
            // Move entire position
            const tpDist = orig.takeProfit - orig.entry.price;
            const slDist = orig.stopLoss - orig.entry.price;
            onDrawingUpdate(drawingId, {
              entry: {
                timestamp: orig.entry.timestamp + timeDelta,
                price: orig.entry.price + priceDelta,
              },
              takeProfit: orig.entry.price + priceDelta + tpDist,
              stopLoss: orig.entry.price + priceDelta + slDist,
              endTimestamp: orig.endTimestamp ? orig.endTimestamp + timeDelta : undefined,
            });
          }
        } else if (isMarkerDrawing(originalDrawing)) {
          // Move marker drawing - has single anchor
          const orig = originalDrawing as MarkerDrawing;
          onDrawingUpdate(drawingId, {
            anchor: {
              timestamp: orig.anchor.timestamp + timeDelta,
              price: orig.anchor.price + priceDelta,
            },
          });
        }

        drawAllDrawings();
        return;
      }

      // Update hover state for cursor
      const hoverInfo = getHoverInfo(mouseX, mouseY);
      const prevHovered = hoveredDrawingIdRef.current;
      hoveredDrawingIdRef.current = hoverInfo?.drawingId || null;
      hoveredAnchorRef.current = hoverInfo?.part || null;

      updateCursor(hoverInfo?.part || null, hoverInfo?.drawingId);

      // Redraw if hover state changed (for hover highlight)
      if (prevHovered !== hoveredDrawingIdRef.current) {
        drawAllDrawings();
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Complete new drawing creation
      if (isDrawingRef.current && pendingDrawingRef.current && drawingAnchor1Ref.current) {
        const coords = getCoordinatesFromMouse(e);
        if (coords && onDrawingCreate) {
          const drawingType = pendingDrawingRef.current.type;

          // Special handling for position drawings
          if (drawingType === "longPosition" || drawingType === "shortPosition") {
            const isLong = drawingType === "longPosition";
            const entryPrice = drawingAnchor1Ref.current.price;
            const dragPrice = coords.price;
            const priceDiff = Math.abs(dragPrice - entryPrice);

            // Don't create if drag is too small
            if (priceDiff < 0.00001) {
              isDrawingRef.current = false;
              pendingDrawingRef.current = null;
              drawingAnchor1Ref.current = null;
              drawAllDrawings();
              return;
            }

            let takeProfit: number, stopLoss: number;
            if (isLong) {
              // For long: dragging UP sets TP, dragging DOWN sets SL
              if (dragPrice > entryPrice) {
                takeProfit = dragPrice;
                stopLoss = entryPrice - priceDiff; // Mirror distance below
              } else {
                stopLoss = dragPrice;
                takeProfit = entryPrice + priceDiff; // Mirror distance above
              }
            } else {
              // For short: dragging DOWN sets TP, dragging UP sets SL
              if (dragPrice < entryPrice) {
                takeProfit = dragPrice;
                stopLoss = entryPrice + priceDiff; // Mirror distance above
              } else {
                stopLoss = dragPrice;
                takeProfit = entryPrice - priceDiff; // Mirror distance below
              }
            }

            // Set initial width based on drag distance (or default to 20 candles worth)
            const entryTime = drawingAnchor1Ref.current.timestamp;
            const dragTime = coords.time;
            // Use the horizontal drag distance, or default to 10 candles (assuming ~5min candles)
            const timeDiff = Math.abs(dragTime - entryTime);
            const defaultWidth = 50 * 60 * 1000; // Default 50 minutes
            const endTimestamp = entryTime + Math.max(timeDiff, defaultWidth);

            onDrawingCreate(drawingType, {
              anchor1: drawingAnchor1Ref.current,
            }, {
              takeProfit,
              stopLoss,
              endTimestamp,
            });
          } else {
            // Standard two-anchor drawings
            const anchor2: DrawingAnchor = { timestamp: coords.time, price: coords.price };
            onDrawingCreate(drawingType, {
              anchor1: drawingAnchor1Ref.current,
              anchor2,
            });
          }
        }

        isDrawingRef.current = false;
        pendingDrawingRef.current = null;
        drawingAnchor1Ref.current = null;
        drawAllDrawings();
        return;
      }

      // Complete drag operation
      if (dragStateRef.current) {
        dragStateRef.current = null;
        updateCursor(hoveredAnchorRef.current);
        drawAllDrawings();
      }
    };

    const handleMouseLeave = () => {
      // Reset hover state when mouse leaves canvas
      if (hoveredDrawingIdRef.current) {
        hoveredDrawingIdRef.current = null;
        hoveredAnchorRef.current = null;
        drawAllDrawings();
      }
      canvas.style.cursor = "default";
    };

    const handleClick = (e: MouseEvent) => {
      // Only handle click for selection if not dragging and no tool active
      if (activeDrawingTool || dragStateRef.current) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const hoverInfo = getHoverInfo(mouseX, mouseY);
      if (onDrawingSelect) {
        onDrawingSelect(hoverInfo?.drawingId || null);
      }
    };

    const handleDoubleClick = (e: MouseEvent) => {
      // Don't open settings if a drawing tool is active
      if (activeDrawingTool) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const hoverInfo = getHoverInfo(mouseX, mouseY);
      if (hoverInfo?.drawingId) {
        // Open settings modal for this drawing
        setSettingsDrawingId(hoverInfo.drawingId);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        isDrawingRef.current = false;
        pendingDrawingRef.current = null;
        drawingAnchor1Ref.current = null;
        dragStateRef.current = null;
        drawAllDrawings();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId && onDrawingDelete && drawings) {
        // Don't allow deleting locked drawings
        const drawingToDelete = drawings.find(d => d.id === selectedDrawingId);
        if (drawingToDelete && !isDrawingLocked(drawingToDelete)) {
          onDrawingDelete(selectedDrawingId);
        }
      }
    };

    // Drawing render function with hover highlight
    const drawAllDrawings = () => {
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = container.clientWidth;
      const logicalHeight = container.clientHeight;

      // Setup DPI-aware canvas for crisp text
      const needsResize = canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr;
      if (needsResize) {
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        canvas.style.width = `${logicalWidth}px`;
        canvas.style.height = `${logicalHeight}px`;
      }

      // Reset transform and clear with DPI-scaled dimensions
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      const timeScale = chart.timeScale();

      // Get chart area dimensions (exclude price axis on right and time axis on bottom)
      const priceScaleWidth = chart.priceScale("right").width();
      const timeScaleHeight = timeScale.height();
      const chartAreaWidth = logicalWidth - priceScaleWidth;
      const chartAreaHeight = logicalHeight - timeScaleHeight;

      // Clip drawing area to exclude price axis and time axis
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, chartAreaWidth, chartAreaHeight);
      ctx.clip();

      // Draw saved drawings
      if (drawings) {
        for (const drawing of drawings) {
          const isSelected = drawing.id === selectedDrawingId;
          const isHovered = drawing.id === hoveredDrawingIdRef.current;
          drawSingleDrawing(ctx, drawing, timeScale, series, isSelected, isHovered, chartAreaWidth);
        }
      }

      // Draw pending drawing
      if (pendingDrawingRef.current && drawingAnchor1Ref.current && pendingDrawingRef.current.currentPos) {
        drawPendingDrawing(ctx, pendingDrawingRef.current, timeScale, series);
      }

      ctx.restore();
    };

    const drawSingleDrawing = (
      ctx: CanvasRenderingContext2D,
      drawing: Drawing,
      timeScale: ReturnType<IChartApi["timeScale"]>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series: any,
      isSelected: boolean,
      isHovered: boolean,
      chartAreaWidth: number
    ) => {
      const highlight = isSelected || isHovered;
      const showAnchors = isSelected || isHovered;

      if (isHorizontalLineDrawing(drawing)) {
        const y = series.priceToCoordinate(drawing.price);
        if (y === null) return;

        const labelColor = drawing.labelColor || drawing.color;
        const labelPosition = drawing.labelPosition || "middle";
        const labelText = drawing.label;

        // Calculate label dimensions if we have a label
        let labelWidth = 0;
        let labelHeight = 0;
        const labelPadding = 8;
        const labelX = chartAreaWidth / 2; // Center of chart

        if (labelText) {
          ctx.font = "12px Inter, sans-serif";
          labelWidth = ctx.measureText(labelText).width + labelPadding * 2;
          labelHeight = 16;
        }

        // Draw hover glow
        if (isHovered && !isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = drawing.lineWidth + 4;
          ctx.moveTo(0, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        }

        // Draw the line (with gap for middle label)
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = drawing.lineWidth + (highlight ? 1 : 0);
        setLineStyle(ctx, drawing.lineStyle);

        if (labelText && labelPosition === "middle") {
          // Draw line with gap in middle for label
          const gapStart = labelX - labelWidth / 2;
          const gapEnd = labelX + labelWidth / 2;

          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(gapStart, y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(gapEnd, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        } else {
          // Draw continuous line
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        }

        // Draw price label on left
        if (drawing.showLabel) {
          ctx.fillStyle = drawing.color;
          ctx.font = "11px sans-serif";
          ctx.fillText(drawing.price.toFixed(5), 5, y - 5);
        }

        // Draw user label (simple text, no background)
        if (labelText) {
          ctx.font = "12px Inter, sans-serif";
          ctx.fillStyle = labelColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          let textY = y;
          if (labelPosition === "above") {
            textY = y - 10;
          } else if (labelPosition === "below") {
            textY = y + 12;
          }
          // "middle" stays at y

          ctx.fillText(labelText, labelX, textY);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }

        // Draw drag handle on left edge when hovered/selected
        if (showAnchors) {
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(20, y, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (isHorizontalRayDrawing(drawing)) {
        // Horizontal Ray - starts at anchor and extends to the right
        const x = timeScale.timeToCoordinate((drawing.anchor.timestamp / 1000) as Time);
        const y = series.priceToCoordinate(drawing.anchor.price);
        if (x === null || y === null) return;

        const labelColor = drawing.labelColor || drawing.color;
        const labelPosition = drawing.labelPosition || "middle";
        const labelText = drawing.label;

        // Calculate label dimensions if we have a label
        let labelWidth = 0;
        const labelPadding = 8;

        if (labelText && labelPosition === "middle") {
          ctx.font = "12px Inter, sans-serif";
          labelWidth = ctx.measureText(labelText).width + labelPadding * 2;
        }

        // Draw hover glow
        if (isHovered && !isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = drawing.lineWidth + 4;
          ctx.moveTo(x, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        }

        // Draw the ray (with gap for middle label)
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = drawing.lineWidth + (highlight ? 1 : 0);
        setLineStyle(ctx, drawing.lineStyle);

        if (labelText && labelPosition === "middle") {
          // Draw ray with gap for label
          const labelX = x + 50; // Label positioned 50px from start
          const gapStart = labelX - labelWidth / 2;
          const gapEnd = labelX + labelWidth / 2;

          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(gapStart, y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(gapEnd, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        } else {
          // Draw continuous ray
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(chartAreaWidth, y);
          ctx.stroke();
        }

        // Draw user label (simple text, no background)
        if (labelText) {
          const labelX = x + 50;
          ctx.font = "12px Inter, sans-serif";
          ctx.fillStyle = labelColor;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          let textY = y;
          if (labelPosition === "above") {
            textY = y - 10;
          } else if (labelPosition === "below") {
            textY = y + 12;
          }

          ctx.fillText(labelText, labelX, textY);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }

        // Draw anchor point at start
        if (showAnchors) {
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (isTrendlineDrawing(drawing)) {
        const x1 = timeScale.timeToCoordinate((drawing.anchor1.timestamp / 1000) as Time);
        const y1 = series.priceToCoordinate(drawing.anchor1.price);
        const x2 = timeScale.timeToCoordinate((drawing.anchor2.timestamp / 1000) as Time);
        const y2 = series.priceToCoordinate(drawing.anchor2.price);

        if (x1 === null || y1 === null || x2 === null || y2 === null) return;

        // Draw hover glow
        if (isHovered && !isSelected) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = drawing.lineWidth + 4;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.strokeStyle = drawing.color;
        ctx.lineWidth = drawing.lineWidth + (highlight ? 1 : 0);
        setLineStyle(ctx, drawing.lineStyle);

        if (drawing.type === "ray" || drawing.type === "extendedLine") {
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = dx / len;
          const ny = dy / len;

          if (drawing.type === "ray") {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2 + nx * 2000, y2 + ny * 2000);
          } else {
            ctx.moveTo(x1 - nx * 2000, y1 - ny * 2000);
            ctx.lineTo(x2 + nx * 2000, y2 + ny * 2000);
          }
        } else {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();

        // Draw anchor points
        if (showAnchors) {
          const hoveredAnchor = hoveredAnchorRef.current;
          // Anchor 1
          ctx.fillStyle = hoveredAnchor === "anchor1" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x1, y1, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
          // Anchor 2
          ctx.fillStyle = hoveredAnchor === "anchor2" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x2, y2, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw user label at midpoint
        if (drawing.label) {
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const labelColor = drawing.labelColor || drawing.color;
          drawLabel(ctx, drawing.label, midX, midY, labelColor, "above");
        }
      } else if (isFibonacciDrawing(drawing)) {
        const x1 = timeScale.timeToCoordinate((drawing.anchor1.timestamp / 1000) as Time);
        const y1 = series.priceToCoordinate(drawing.anchor1.price);
        const x2 = timeScale.timeToCoordinate((drawing.anchor2.timestamp / 1000) as Time);
        const y2 = series.priceToCoordinate(drawing.anchor2.price);

        if (x1 === null || y1 === null || x2 === null || y2 === null) return;

        const priceRange = drawing.anchor2.price - drawing.anchor1.price;

        for (const level of drawing.levels) {
          // TradingView convention: 100% at anchor1 (start), 0% at anchor2 (end)
          const levelPrice = drawing.anchor1.price + priceRange * (1 - level);
          const levelY = series.priceToCoordinate(levelPrice);
          if (levelY === null) continue;

          const levelColor = drawing.levelColors?.[level] ||
            DEFAULT_DRAWING_COLORS.fibonacci.levels[level as keyof typeof DEFAULT_DRAWING_COLORS.fibonacci.levels] ||
            drawing.lineColor;

          ctx.beginPath();
          ctx.strokeStyle = levelColor;
          ctx.lineWidth = 1 + (highlight ? 0.5 : 0);
          ctx.setLineDash([]);

          const startX = drawing.extendLeft ? 0 : Math.min(x1, x2);
          const endX = drawing.extendRight ? canvas.width : Math.max(x1, x2);

          ctx.moveTo(startX, levelY);
          ctx.lineTo(endX, levelY);
          ctx.stroke();

          if (drawing.showLabels) {
            ctx.fillStyle = levelColor;
            ctx.font = "10px sans-serif";
            ctx.fillText(`${(level * 100).toFixed(1)}%`, endX + 5, levelY + 4);
          }
          if (drawing.showPrices) {
            ctx.fillStyle = levelColor;
            ctx.font = "10px sans-serif";
            ctx.fillText(levelPrice.toFixed(5), endX + 45, levelY + 4);
          }
        }

        // Draw anchor points
        if (showAnchors) {
          const hoveredAnchor = hoveredAnchorRef.current;
          ctx.fillStyle = hoveredAnchor === "anchor1" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x1, y1, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = hoveredAnchor === "anchor2" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x2, y2, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw user label at anchor1
        if (drawing.label) {
          const labelColor = drawing.labelColor || drawing.lineColor;
          drawLabel(ctx, drawing.label, x1, y1, labelColor, "left");
        }
      } else if (isRectangleDrawing(drawing)) {
        const x1 = timeScale.timeToCoordinate((drawing.anchor1.timestamp / 1000) as Time);
        const y1 = series.priceToCoordinate(drawing.anchor1.price);
        const x2 = timeScale.timeToCoordinate((drawing.anchor2.timestamp / 1000) as Time);
        const y2 = series.priceToCoordinate(drawing.anchor2.price);

        if (x1 === null || y1 === null || x2 === null || y2 === null) return;

        const rectX = Math.min(x1, x2);
        const rectY = Math.min(y1, y2);
        const rectW = Math.abs(x2 - x1);
        const rectH = Math.abs(y2 - y1);

        ctx.fillStyle = drawing.fillColor;
        ctx.fillRect(rectX, rectY, rectW, rectH);

        ctx.strokeStyle = drawing.borderColor;
        ctx.lineWidth = drawing.borderWidth + (highlight ? 1 : 0);
        ctx.setLineDash([]);
        ctx.strokeRect(rectX, rectY, rectW, rectH);

        // Draw anchor points
        if (showAnchors) {
          const hoveredAnchor = hoveredAnchorRef.current;
          ctx.fillStyle = hoveredAnchor === "anchor1" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x1, y1, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = hoveredAnchor === "anchor2" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x2, y2, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw user label centered in rectangle
        if (drawing.label) {
          const labelColor = drawing.labelColor || drawing.borderColor;
          const centerX = rectX + rectW / 2;
          const centerY = rectY + rectH / 2;
          drawLabel(ctx, drawing.label, centerX, centerY, labelColor, "center", "simple");
        }
      } else if (isCircleDrawing(drawing)) {
        const x1 = timeScale.timeToCoordinate((drawing.anchor1.timestamp / 1000) as Time);
        const y1 = series.priceToCoordinate(drawing.anchor1.price);
        const x2 = timeScale.timeToCoordinate((drawing.anchor2.timestamp / 1000) as Time);
        const y2 = series.priceToCoordinate(drawing.anchor2.price);

        if (x1 === null || y1 === null || x2 === null || y2 === null) return;

        // Calculate circle center and radius (always perfect circle)
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        // Use distance from anchor1 to anchor2 as radius
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;

        // Draw filled circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = drawing.fillColor;
        ctx.fill();

        // Draw border
        ctx.strokeStyle = drawing.borderColor;
        ctx.lineWidth = drawing.borderWidth + (highlight ? 1 : 0);
        ctx.setLineDash([]);
        ctx.stroke();

        // Draw anchor points
        if (showAnchors) {
          const hoveredAnchor = hoveredAnchorRef.current;
          ctx.fillStyle = hoveredAnchor === "anchor1" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x1, y1, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = hoveredAnchor === "anchor2" ? "#fff" : "#ccc";
          ctx.beginPath();
          ctx.arc(x2, y2, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw user label centered in circle
        if (drawing.label) {
          const labelColor = drawing.labelColor || drawing.borderColor;
          drawLabel(ctx, drawing.label, centerX, centerY, labelColor, "center", "simple");
        }
      } else if (isPositionDrawing(drawing)) {
        // Position Drawing - Entry, TP, SL with zones
        const isLong = isLongPositionDrawing(drawing);
        const entryX = timeScale.timeToCoordinate((drawing.entry.timestamp / 1000) as Time);
        const entryY = series.priceToCoordinate(drawing.entry.price);
        const tpY = series.priceToCoordinate(drawing.takeProfit);
        const slY = series.priceToCoordinate(drawing.stopLoss);

        if (entryX === null || entryY === null || tpY === null || slY === null) return;

        // Status-based styling
        const positionStatus = drawing.status || "open"; // Default to "open" for backwards compat
        const isSignal = positionStatus === "signal";
        const isLive = positionStatus === "pending" || positionStatus === "open";
        const isClosed = positionStatus === "closed";

        // Opacity based on status
        const zoneOpacity = isSignal ? 0.1 : isClosed ? 0.15 : 0.2;
        const lineOpacity = isSignal ? 0.5 : isClosed ? 0.6 : 1.0;

        // Line style: dashed for signals, solid for others
        const lineDash = isSignal ? [6, 4] : [];

        // Calculate pip values (assuming 5-digit pricing for forex)
        const pipMultiplier = drawing.entry.price < 10 ? 10000 : 100; // Forex vs indices
        const tpPips = Math.abs(drawing.takeProfit - drawing.entry.price) * pipMultiplier;
        const slPips = Math.abs(drawing.entry.price - drawing.stopLoss) * pipMultiplier;
        const tpPercent = ((drawing.takeProfit - drawing.entry.price) / drawing.entry.price * 100);
        const slPercent = ((drawing.entry.price - drawing.stopLoss) / drawing.entry.price * 100);
        const rrRatio = drawing.riskRewardRatio || (tpPips / slPips);

        // Calculate zone width - use endTimestamp if set, otherwise use fixed width
        // Positions should NOT extend forever - use sensible defaults
        const DEFAULT_POSITION_WIDTH = 250; // Fixed width in pixels for positions without endTimestamp
        let actualZoneWidth: number;
        let endX: number | null = null;
        if (drawing.endTimestamp) {
          endX = timeScale.timeToCoordinate((drawing.endTimestamp / 1000) as Time);
          if (endX !== null) {
            actualZoneWidth = Math.max(endX - entryX, 50); // Minimum 50px width
          } else {
            actualZoneWidth = DEFAULT_POSITION_WIDTH;
          }
        } else {
          // No endTimestamp - use fixed width, NOT chart edge
          actualZoneWidth = DEFAULT_POSITION_WIDTH;
          endX = entryX + actualZoneWidth;
        }

        // Get colors (use custom colors or defaults)
        const tpColor = drawing.tpColor || "#26A69A";
        const slColor = drawing.slColor || "#EF5350";

        // Helper to convert hex to rgba with opacity
        const hexToRgba = (hex: string, alpha: number) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        // Draw TP zone (fill color derived from line color, opacity based on status)
        ctx.fillStyle = hexToRgba(tpColor, zoneOpacity);
        const tpZoneTop = Math.min(entryY, tpY);
        const tpZoneHeight = Math.abs(tpY - entryY);
        ctx.fillRect(entryX, tpZoneTop, actualZoneWidth, tpZoneHeight);

        // For signals, draw dashed border around TP zone
        if (isSignal) {
          ctx.strokeStyle = hexToRgba(tpColor, 0.4);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(entryX, tpZoneTop, actualZoneWidth, tpZoneHeight);
          ctx.setLineDash([]);
        }

        // Draw SL zone (fill color derived from line color, opacity based on status)
        ctx.fillStyle = hexToRgba(slColor, zoneOpacity);
        const slZoneTop = Math.min(entryY, slY);
        const slZoneHeight = Math.abs(slY - entryY);
        ctx.fillRect(entryX, slZoneTop, actualZoneWidth, slZoneHeight);

        // For signals, draw dashed border around SL zone
        if (isSignal) {
          ctx.strokeStyle = hexToRgba(slColor, 0.4);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(entryX, slZoneTop, actualZoneWidth, slZoneHeight);
          ctx.setLineDash([]);
        }

        // Calculate candle penetration into TP/SL zones (TradingView-style highlighting)
        // IMPORTANT: Track penetration only until TP or SL is HIT for the first time
        const entryTimeSec = drawing.entry.timestamp / 1000;
        const endTimeSec = drawing.endTimestamp ? drawing.endTimestamp / 1000 : Date.now() / 1000;

        // Find candles that penetrated TP zone
        let tpPenetrationStart: number | null = null;
        let tpPenetrationEnd: number | null = null;
        let tpMaxPenetration: number = drawing.entry.price; // Track deepest penetration

        // Find candles that penetrated SL zone
        let slPenetrationStart: number | null = null;
        let slPenetrationEnd: number | null = null;
        let slMaxPenetration: number = drawing.entry.price; // Track deepest penetration

        // Track if trade has been "closed" - use Convex trade data as source of truth
        let tradeOutcome: "tp" | "sl" | "manual" | null = null;
        let tradeClosedAt: number | null = null;
        let tradeExitPrice: number | null = null;

        // Check Convex trade data first (source of truth)
        if (drawing.convexTradeId && tradesMap) {
          const trade = tradesMap.get(drawing.convexTradeId);
          if (trade && trade.status === "closed" && trade.exitPrice) {
            tradeExitPrice = trade.exitPrice;
            tradeClosedAt = trade.exitTime ? trade.exitTime / 1000 : null;
            // Map Convex outcome to local outcome type
            if (trade.outcome === "TP") tradeOutcome = "tp";
            else if (trade.outcome === "SL") tradeOutcome = "sl";
            else if (trade.outcome === "MW" || trade.outcome === "ML" || trade.outcome === "BE") tradeOutcome = "manual";
          }
        }

        // Get candles sorted by time (chronologically) for penetration visualization
        const sortedCandles = Array.from(candleDataRef.current.entries())
          .filter(([timeSec]) => timeSec >= entryTimeSec && timeSec <= endTimeSec)
          .sort((a, b) => a[0] - b[0]);

        // Track penetration zones (for visualization only - outcome comes from Convex)
        for (const [timeSec, candle] of sortedCandles) {
          // Stop tracking once we reach the close time (from Convex)
          if (tradeClosedAt !== null && timeSec > tradeClosedAt) break;

          if (isLong) {
            // Track TP zone penetration (above entry)
            if (candle.high > drawing.entry.price) {
              if (tpPenetrationStart === null) tpPenetrationStart = timeSec;
              tpPenetrationEnd = timeSec;
              tpMaxPenetration = Math.max(tpMaxPenetration, Math.min(candle.high, drawing.takeProfit));
            }
            // Track SL zone penetration (below entry)
            if (candle.low < drawing.entry.price) {
              if (slPenetrationStart === null) slPenetrationStart = timeSec;
              slPenetrationEnd = timeSec;
              slMaxPenetration = Math.min(slMaxPenetration, Math.max(candle.low, drawing.stopLoss));
            }
          } else {
            // Short position
            // Track TP zone penetration (below entry)
            if (candle.low < drawing.entry.price) {
              if (tpPenetrationStart === null) tpPenetrationStart = timeSec;
              tpPenetrationEnd = timeSec;
              tpMaxPenetration = Math.min(tpMaxPenetration, Math.max(candle.low, drawing.takeProfit));
            }
            // Track SL zone penetration (above entry)
            if (candle.high > drawing.entry.price) {
              if (slPenetrationStart === null) slPenetrationStart = timeSec;
              slPenetrationEnd = timeSec;
              slMaxPenetration = Math.max(slMaxPenetration, Math.min(candle.high, drawing.stopLoss));
            }
          }
        }

        // Estimate candle width from visible range (for penetration zones)
        const visibleRange = timeScale.getVisibleLogicalRange();
        const barsInView = visibleRange ? Math.abs(visibleRange.to - visibleRange.from) : 50;
        const estimatedCandleWidth = Math.max(chartAreaWidth / barsInView, 4);

        // Draw TP penetration zone (darker fill with dashed border)
        if (tpPenetrationStart !== null && tpPenetrationEnd !== null) {
          const tpPenStartXCoord = timeScale.timeToCoordinate(tpPenetrationStart as Time);
          const tpPenEndXCoord = timeScale.timeToCoordinate(tpPenetrationEnd as Time);
          const tpPenMaxYCoord = series.priceToCoordinate(tpMaxPenetration);

          if (tpPenStartXCoord !== null && tpPenEndXCoord !== null && tpPenMaxYCoord !== null) {
            // Clamp to position boundaries (convert to numbers for math operations)
            const tpPenStartX = Math.max(tpPenStartXCoord as number, entryX);
            const tpPenEndX = Math.min(tpPenEndXCoord as number, entryX + actualZoneWidth);
            const tpPenMaxY = tpPenMaxYCoord as number;

            // Add one candle width to include the last penetrating candle
            const penWidth = Math.min(
              tpPenEndX - tpPenStartX + estimatedCandleWidth,
              entryX + actualZoneWidth - tpPenStartX
            );

            // Only draw if there's actually a visible area
            if (penWidth > 0 && tpPenStartX < entryX + actualZoneWidth) {
              // Darker fill for penetration area
              ctx.fillStyle = hexToRgba(tpColor, 0.35);
              const penTop = Math.min(entryY, tpPenMaxY);
              const penHeight = Math.abs(tpPenMaxY - entryY);
              ctx.fillRect(tpPenStartX, penTop, penWidth, penHeight);

              // Dashed diagonal trend line from entry to max penetration
              ctx.strokeStyle = tpColor;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(entryX, entryY);
              ctx.lineTo(tpPenStartX + penWidth, tpPenMaxY);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }

        // Draw SL penetration zone (darker fill with dashed border)
        if (slPenetrationStart !== null && slPenetrationEnd !== null) {
          const slPenStartXCoord = timeScale.timeToCoordinate(slPenetrationStart as Time);
          const slPenEndXCoord = timeScale.timeToCoordinate(slPenetrationEnd as Time);
          const slPenMaxYCoord = series.priceToCoordinate(slMaxPenetration);

          if (slPenStartXCoord !== null && slPenEndXCoord !== null && slPenMaxYCoord !== null) {
            // Clamp to position boundaries (convert to numbers for math operations)
            const slPenStartX = Math.max(slPenStartXCoord as number, entryX);
            const slPenEndX = Math.min(slPenEndXCoord as number, entryX + actualZoneWidth);
            const slPenMaxY = slPenMaxYCoord as number;

            // Add one candle width to include the last penetrating candle
            const penWidth = Math.min(
              slPenEndX - slPenStartX + estimatedCandleWidth,
              entryX + actualZoneWidth - slPenStartX
            );

            // Only draw if there's actually a visible area
            if (penWidth > 0 && slPenStartX < entryX + actualZoneWidth) {
              // Darker fill for penetration area
              ctx.fillStyle = hexToRgba(slColor, 0.35);
              const penTop = Math.min(entryY, slPenMaxY);
              const penHeight = Math.abs(slPenMaxY - entryY);
              ctx.fillRect(slPenStartX, penTop, penWidth, penHeight);

              // Dashed diagonal trend line from entry to max penetration
              ctx.strokeStyle = slColor;
              ctx.lineWidth = 1;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(entryX, entryY);
              ctx.lineTo(slPenStartX + penWidth, slPenMaxY);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }

        // Draw entry line (dashed for signals)
        ctx.strokeStyle = hexToRgba("#2196F3", lineOpacity);
        ctx.lineWidth = 2 + (highlight ? 1 : 0);
        ctx.setLineDash(lineDash);
        ctx.beginPath();
        ctx.moveTo(entryX, entryY);
        ctx.lineTo(entryX + actualZoneWidth, entryY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw TP line (dashed for signals)
        ctx.strokeStyle = hexToRgba(tpColor, lineOpacity);
        ctx.lineWidth = 1 + (highlight ? 1 : 0);
        ctx.setLineDash(lineDash);
        ctx.beginPath();
        ctx.moveTo(entryX, tpY);
        ctx.lineTo(entryX + actualZoneWidth, tpY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw SL line (dashed for signals)
        ctx.strokeStyle = hexToRgba(slColor, lineOpacity);
        ctx.lineWidth = 1 + (highlight ? 1 : 0);
        ctx.setLineDash(lineDash);
        ctx.beginPath();
        ctx.moveTo(entryX, slY);
        ctx.lineTo(entryX + actualZoneWidth, slY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw vertical lines on left and right edges
        ctx.strokeStyle = "#787B86";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        // Left edge
        ctx.beginPath();
        ctx.moveTo(entryX, Math.min(tpY, slY));
        ctx.lineTo(entryX, Math.max(tpY, slY));
        ctx.stroke();
        // Right edge (if fixed width)
        if (drawing.endTimestamp && endX !== null) {
          ctx.beginPath();
          ctx.moveTo(entryX + actualZoneWidth, Math.min(tpY, slY));
          ctx.lineTo(entryX + actualZoneWidth, Math.max(tpY, slY));
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // Draw TP label (with price) - OUTSIDE zone, centered horizontally
        const tpLabelText = `TP @ ${drawing.takeProfit.toFixed(5)} | ${(tpPercent >= 0 ? "+" : "")}${tpPercent.toFixed(2)}% | ${tpPips.toFixed(1)} pips | ${rrRatio.toFixed(2)}R`;
        ctx.font = "11px Inter, sans-serif";
        const tpTextWidth = ctx.measureText(tpLabelText).width;
        const labelPadding = 6;
        const labelHeight = 18;
        const labelGap = 4;
        const labelMargin = 4; // Margin from chart edge

        // TP label position - centered horizontally, clamped to chart bounds
        const tpLabelWidth = tpTextWidth + labelPadding * 2;
        const tpLabelXRaw = entryX + actualZoneWidth / 2 - tpLabelWidth / 2;
        const tpLabelX = Math.max(labelMargin, Math.min(chartAreaWidth - tpLabelWidth - labelMargin, tpLabelXRaw));
        const tpLabelY = isLong ? tpY - labelHeight - labelGap : tpY + labelGap;

        ctx.fillStyle = tpColor;
        ctx.beginPath();
        ctx.roundRect(tpLabelX, tpLabelY, tpLabelWidth, labelHeight, 3);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(tpLabelText, tpLabelX + labelPadding, tpLabelY + labelHeight / 2);

        // Draw SL label (with price) - OUTSIDE zone, centered horizontally
        const slLabelText = `SL @ ${drawing.stopLoss.toFixed(5)} | -${Math.abs(slPercent).toFixed(2)}% | ${slPips.toFixed(1)} pips`;
        const slTextWidth = ctx.measureText(slLabelText).width;

        // SL label position - centered horizontally, clamped to chart bounds
        const slLabelWidth = slTextWidth + labelPadding * 2;
        const slLabelXRaw = entryX + actualZoneWidth / 2 - slLabelWidth / 2;
        const slLabelX = Math.max(labelMargin, Math.min(chartAreaWidth - slLabelWidth - labelMargin, slLabelXRaw));
        const slLabelY = isLong ? slY + labelGap : slY - labelHeight - labelGap;

        ctx.fillStyle = slColor;
        ctx.beginPath();
        ctx.roundRect(slLabelX, slLabelY, slLabelWidth, labelHeight, 3);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.fillText(slLabelText, slLabelX + labelPadding, slLabelY + labelHeight / 2);

        // Draw entry label - clamped to chart bounds
        const entryLabelText = `${isLong ? "LONG" : "SHORT"} @ ${drawing.entry.price.toFixed(5)}`;
        const entryTextWidth = ctx.measureText(entryLabelText).width;
        const entryLabelWidth = entryTextWidth + labelPadding * 2;
        const entryLabelXRaw = entryX + actualZoneWidth / 2 - entryLabelWidth / 2;
        const entryLabelX = Math.max(labelMargin, Math.min(chartAreaWidth - entryLabelWidth - labelMargin, entryLabelXRaw));
        const entryLabelY = entryY - labelHeight / 2;

        ctx.fillStyle = "#2196F3";
        ctx.beginPath();
        ctx.roundRect(entryLabelX, entryLabelY - labelHeight / 2, entryLabelWidth, labelHeight, 3);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.fillText(entryLabelText, entryLabelX + labelPadding, entryLabelY);

        // Draw candle count if available - clamped to chart bounds
        if (drawing.candleCount && drawing.candleCount > 0) {
          const candleText = `${drawing.candleCount} candles`;
          const candleTextWidth = ctx.measureText(candleText).width;
          const candleLabelWidth = candleTextWidth + labelPadding * 2;
          const candleLabelXRaw = entryX + actualZoneWidth - candleLabelWidth - 10;
          const candleLabelX = Math.max(labelMargin, Math.min(chartAreaWidth - candleLabelWidth - labelMargin, candleLabelXRaw));
          const candleLabelY = entryY - labelHeight / 2;

          ctx.fillStyle = "rgba(120, 123, 134, 0.8)";
          ctx.beginPath();
          ctx.roundRect(candleLabelX, candleLabelY - labelHeight / 2, candleLabelWidth, labelHeight, 3);
          ctx.fill();

          ctx.fillStyle = "#fff";
          ctx.fillText(candleText, candleLabelX + labelPadding, candleLabelY);
        }

        // Draw status badge (Signal, Live, Win/Loss)
        let statusBadgeText = "";
        let statusBadgeColor = "";
        if (isSignal) {
          statusBadgeText = "SIGNAL";
          statusBadgeColor = "#9333EA"; // Purple for signals
        } else if (isLive) {
          statusBadgeText = "LIVE";
          statusBadgeColor = "#F59E0B"; // Amber for live trades
        } else if (isClosed && tradeOutcome) {
          // Show outcome badge for closed trades
          if (tradeOutcome === "tp") {
            statusBadgeText = "WIN";
            statusBadgeColor = "#22C55E"; // Green
          } else if (tradeOutcome === "sl") {
            statusBadgeText = "LOSS";
            statusBadgeColor = "#EF4444"; // Red
          } else {
            statusBadgeText = "CLOSED";
            statusBadgeColor = "#6B7280"; // Gray
          }
        }

        if (statusBadgeText) {
          const badgeTextWidth = ctx.measureText(statusBadgeText).width;
          const badgeWidth = badgeTextWidth + labelPadding * 2;
          const badgeX = entryX + 10;
          const badgeY = tpY + (isLong ? -labelHeight - 30 : 30);

          // Draw badge background
          ctx.fillStyle = statusBadgeColor;
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeWidth, labelHeight, 3);
          ctx.fill();

          // Add pulsing border for live trades (just a thicker border as animation isn't possible in static canvas)
          if (isLive) {
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Draw badge text
          ctx.fillStyle = "#fff";
          ctx.font = "bold 10px Inter, sans-serif";
          ctx.fillText(statusBadgeText, badgeX + labelPadding, badgeY + labelHeight / 2);
          ctx.font = "11px Inter, sans-serif"; // Reset font
        }

        // Draw EXIT line if trade was closed at a different price than TP/SL (manual exit)
        if (tradeExitPrice !== null && tradeOutcome === "manual") {
          const exitY = series.priceToCoordinate(tradeExitPrice);
          if (exitY !== null) {
            // Calculate P&L for the exit
            const exitPnl = isLong
              ? tradeExitPrice - drawing.entry.price
              : drawing.entry.price - tradeExitPrice;
            const exitPips = exitPnl * pipMultiplier;
            const exitColor = exitPnl >= 0 ? "#FF9800" : "#FF5722"; // Orange for win, deep orange for loss

            // Draw exit line (dashed)
            ctx.strokeStyle = exitColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(entryX, exitY);
            ctx.lineTo(entryX + actualZoneWidth, exitY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw exit label
            const exitLabel = `EXIT @ ${tradeExitPrice.toFixed(5)} | ${exitPnl >= 0 ? "+" : ""}${exitPips.toFixed(1)} pips`;
            const exitTextWidth = ctx.measureText(exitLabel).width;
            const exitLabelWidth = exitTextWidth + labelPadding * 2;
            const exitLabelXRaw = entryX + actualZoneWidth / 2 - exitLabelWidth / 2;
            const exitLabelX = Math.max(labelMargin, Math.min(chartAreaWidth - exitLabelWidth - labelMargin, exitLabelXRaw));
            const exitLabelY = exitY + labelGap;

            ctx.fillStyle = exitColor;
            ctx.beginPath();
            ctx.roundRect(exitLabelX, exitLabelY, exitLabelWidth, labelHeight, 3);
            ctx.fill();

            ctx.fillStyle = "#fff";
            ctx.textBaseline = "middle";
            ctx.fillText(exitLabel, exitLabelX + labelPadding, exitLabelY + labelHeight / 2);
          }
        }

        ctx.textBaseline = "alphabetic";

        // Draw anchor points when selected
        if (showAnchors) {
          // Entry anchor (left side, center)
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(entryX, entryY, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#2196F3";
          ctx.lineWidth = 2;
          ctx.stroke();

          // TP anchor (left side of TP line)
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(entryX, tpY, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#26A69A";
          ctx.lineWidth = 2;
          ctx.stroke();

          // SL anchor (left side of SL line)
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(entryX, slY, ANCHOR_RADIUS, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "#EF5350";
          ctx.lineWidth = 2;
          ctx.stroke();

          // Right edge anchor (for width adjustment)
          if (endX !== null) {
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(entryX + actualZoneWidth, entryY, ANCHOR_RADIUS, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = "#787B86";
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      } else if (isMarkerDrawing(drawing)) {
        // Marker Drawing - single-point marker on candle
        const marker = drawing as MarkerDrawing;
        const x = timeScale.timeToCoordinate((marker.anchor.timestamp / 1000) as Time);
        const y = series.priceToCoordinate(marker.anchor.price);

        if (x === null || y === null) return;

        const size = (marker.size || 1) * 12;
        const color = marker.color;

        ctx.fillStyle = color;
        ctx.strokeStyle = isSelected ? "#2962FF" : color;
        ctx.lineWidth = isSelected ? 2 : 1;

        // Adjust y position based on marker position
        let adjustedY = y;
        if (marker.position === "aboveBar") {
          adjustedY = y - size - 5;
        } else if (marker.position === "belowBar") {
          adjustedY = y + size + 5;
        }

        if (marker.shape === "arrowUp") {
          // Draw upward arrow
          ctx.beginPath();
          ctx.moveTo(x, adjustedY - size);
          ctx.lineTo(x - size * 0.6, adjustedY);
          ctx.lineTo(x - size * 0.2, adjustedY);
          ctx.lineTo(x - size * 0.2, adjustedY + size * 0.5);
          ctx.lineTo(x + size * 0.2, adjustedY + size * 0.5);
          ctx.lineTo(x + size * 0.2, adjustedY);
          ctx.lineTo(x + size * 0.6, adjustedY);
          ctx.closePath();
          ctx.fill();
          if (isSelected) ctx.stroke();
        } else if (marker.shape === "arrowDown") {
          // Draw downward arrow
          ctx.beginPath();
          ctx.moveTo(x, adjustedY + size);
          ctx.lineTo(x - size * 0.6, adjustedY);
          ctx.lineTo(x - size * 0.2, adjustedY);
          ctx.lineTo(x - size * 0.2, adjustedY - size * 0.5);
          ctx.lineTo(x + size * 0.2, adjustedY - size * 0.5);
          ctx.lineTo(x + size * 0.2, adjustedY);
          ctx.lineTo(x + size * 0.6, adjustedY);
          ctx.closePath();
          ctx.fill();
          if (isSelected) ctx.stroke();
        } else if (marker.shape === "circle") {
          // Draw circle
          ctx.beginPath();
          ctx.arc(x, adjustedY, size * 0.5, 0, 2 * Math.PI);
          ctx.fill();
          if (isSelected) ctx.stroke();
        } else if (marker.shape === "square") {
          // Draw square
          const halfSize = size * 0.5;
          ctx.fillRect(x - halfSize, adjustedY - halfSize, size, size);
          if (isSelected) {
            ctx.strokeRect(x - halfSize, adjustedY - halfSize, size, size);
          }
        }

        // Draw text label if present
        if (marker.text) {
          ctx.font = "11px Inter, sans-serif";
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          const textY = marker.position === "aboveBar" ? adjustedY - size - 5 : adjustedY + size + 15;
          ctx.fillText(marker.text, x, textY);
          ctx.textAlign = "left";
        }

        // Draw user label
        if (marker.label) {
          const labelColor = marker.labelColor || color;
          const labelY = marker.position === "belowBar" ? adjustedY + size + 25 : adjustedY - size - 15;
          drawLabel(ctx, marker.label, x, labelY, labelColor, "above", "pill");
        }
      }
    };

    const drawPendingDrawing = (
      ctx: CanvasRenderingContext2D,
      pending: { type: DrawingType; anchor1: DrawingAnchor; currentPos?: { x: number; y: number } },
      timeScale: ReturnType<IChartApi["timeScale"]>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series: any
    ) => {
      if (!pending.currentPos) return;

      const x1 = timeScale.timeToCoordinate((pending.anchor1.timestamp / 1000) as Time);
      const y1 = series.priceToCoordinate(pending.anchor1.price);

      if (x1 === null || y1 === null) return;

      const x2 = pending.currentPos.x;
      const y2 = pending.currentPos.y;

      ctx.beginPath();
      ctx.strokeStyle = "#2962FF";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      if (pending.type === "trendline" || pending.type === "ray" || pending.type === "arrow" || pending.type === "extendedLine") {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      } else if (pending.type === "fibonacci") {
        // Get the price at the cursor position
        const price2 = series.coordinateToPrice(y2);
        if (price2 === null) return;

        const price1 = pending.anchor1.price;
        const priceRange = price2 - price1;

        // Calculate line boundaries (between anchor points only)
        const startX = Math.min(x1, x2);
        const endX = Math.max(x1, x2);

        // Draw Fibonacci levels preview (TradingView convention: 100% at start, 0% at end)
        for (const level of DEFAULT_FIB_LEVELS) {
          const levelPrice = price1 + priceRange * (1 - level);
          const levelY = series.priceToCoordinate(levelPrice);
          if (levelY === null) continue;

          const levelColor = DEFAULT_DRAWING_COLORS.fibonacci.levels[level as keyof typeof DEFAULT_DRAWING_COLORS.fibonacci.levels] ||
            "#787B86";

          ctx.beginPath();
          ctx.strokeStyle = levelColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);

          // Draw line only between anchor points
          ctx.moveTo(startX, levelY);
          ctx.lineTo(endX, levelY);
          ctx.stroke();

          // Draw level label at the end of the line
          ctx.fillStyle = levelColor;
          ctx.font = "10px sans-serif";
          ctx.fillText(`${(level * 100).toFixed(1)}%`, endX + 5, levelY + 4);
        }

        // Draw anchor points
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x1, y1, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x2, y2, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        return;
      } else if (pending.type === "rectangle") {
        const rectX = Math.min(x1, x2);
        const rectY = Math.min(y1, y2);
        const rectW = Math.abs(x2 - x1);
        const rectH = Math.abs(y2 - y1);
        ctx.strokeRect(rectX, rectY, rectW, rectH);
      } else if (pending.type === "circle") {
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        // Use distance from anchor1 to anchor2 as radius (perfect circle)
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      } else if (pending.type === "longPosition" || pending.type === "shortPosition") {
        // Position preview - show entry, TP, and SL zones
        const isLong = pending.type === "longPosition";
        const entryPrice = pending.anchor1.price;
        const dragPrice = series.coordinateToPrice(y2);

        if (dragPrice === null) return;

        // Calculate TP and SL from drag
        const priceDiff = Math.abs(dragPrice - entryPrice);
        let tpPrice: number, slPrice: number;

        if (isLong) {
          // Long: dragging UP sets TP directly, SL mirrors below
          if (dragPrice > entryPrice) {
            tpPrice = dragPrice;
            slPrice = entryPrice - priceDiff;
          } else {
            slPrice = dragPrice;
            tpPrice = entryPrice + priceDiff;
          }
        } else {
          // Short: dragging DOWN sets TP directly, SL mirrors above
          if (dragPrice < entryPrice) {
            tpPrice = dragPrice;
            slPrice = entryPrice + priceDiff;
          } else {
            slPrice = dragPrice;
            tpPrice = entryPrice - priceDiff;
          }
        }

        const tpY_pos = series.priceToCoordinate(tpPrice);
        const slY_pos = series.priceToCoordinate(slPrice);

        if (tpY_pos === null || slY_pos === null) return;

        // Calculate zone width based on horizontal drag
        const zoneWidth = Math.max(Math.abs(x2 - x1), 100);

        // Draw TP zone (green)
        ctx.fillStyle = "rgba(38, 166, 154, 0.2)";
        const tpZoneTop = Math.min(y1, tpY_pos);
        const tpZoneHeight = Math.abs(tpY_pos - y1);
        ctx.fillRect(x1, tpZoneTop, zoneWidth, tpZoneHeight);

        // Draw SL zone (red)
        ctx.fillStyle = "rgba(239, 83, 80, 0.2)";
        const slZoneTop = Math.min(y1, slY_pos);
        const slZoneHeight = Math.abs(slY_pos - y1);
        ctx.fillRect(x1, slZoneTop, zoneWidth, slZoneHeight);

        // Draw entry line
        ctx.strokeStyle = "#2196F3";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + zoneWidth, y1);
        ctx.stroke();

        // Draw TP line (dashed)
        ctx.strokeStyle = "#26A69A";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(x1, tpY_pos);
        ctx.lineTo(x1 + zoneWidth, tpY_pos);
        ctx.stroke();

        // Draw SL line (dashed)
        ctx.strokeStyle = "#EF5350";
        ctx.beginPath();
        ctx.moveTo(x1, slY_pos);
        ctx.lineTo(x1 + zoneWidth, slY_pos);
        ctx.stroke();

        ctx.setLineDash([]);
        return;
      }

      ctx.stroke();
      ctx.setLineDash([]);
    };

    const setLineStyle = (ctx: CanvasRenderingContext2D, style: "solid" | "dashed" | "dotted") => {
      switch (style) {
        case "dashed":
          ctx.setLineDash([8, 4]);
          break;
        case "dotted":
          ctx.setLineDash([2, 2]);
          break;
        default:
          ctx.setLineDash([]);
      }
    };

    /**
     * Draw a label with background pill
     */
    const drawLabel = (
      ctx: CanvasRenderingContext2D,
      label: string,
      x: number,
      y: number,
      color: string,
      position: "above" | "below" | "left" | "right" | "center" = "above",
      style: "pill" | "simple" = "pill"
    ) => {
      if (!label) return;

      ctx.font = "12px Inter, sans-serif";
      const metrics = ctx.measureText(label);
      const textWidth = metrics.width;

      // Simple style - just text, no background (for inside rectangles)
      if (style === "simple") {
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        return;
      }

      // Pill style - text with background
      const textHeight = 12;
      const paddingX = 6;
      const paddingY = 3;
      const pillWidth = textWidth + paddingX * 2;
      const pillHeight = textHeight + paddingY * 2;

      // Calculate position based on placement
      let pillX = x;
      let pillY = y;

      switch (position) {
        case "above":
          pillX = x - pillWidth / 2;
          pillY = y - pillHeight - 4;
          break;
        case "below":
          pillX = x - pillWidth / 2;
          pillY = y + 4;
          break;
        case "left":
          pillX = x - pillWidth - 4;
          pillY = y - pillHeight / 2;
          break;
        case "right":
          pillX = x + 4;
          pillY = y - pillHeight / 2;
          break;
      }

      // Draw background pill
      ctx.fillStyle = "rgba(30, 30, 30, 0.9)";
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 4);
      ctx.fill();

      // Draw border
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw text
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(label, pillX + paddingX, pillY + pillHeight / 2);
      ctx.textBaseline = "alphabetic"; // Reset
    };

    const distanceToLineSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const nearestX = x1 + t * dx;
      const nearestY = y1 + t * dy;
      return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
    };

    // Initial draw
    drawAllDrawings();

    // Subscribe to visible range changes for redraw
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(drawAllDrawings);

    // Track chart panning for continuous redraw (needed for vertical pan)
    // The timeScale only notifies on horizontal changes, so we need to
    // continuously redraw during any pan/drag to catch vertical movements
    let isChartDragging = false;
    let animationFrameId: number | null = null;

    const animateDrawings = () => {
      if (isChartDragging) {
        drawAllDrawings();
        animationFrameId = requestAnimationFrame(animateDrawings);
      }
    };

    const handleChartDragStart = (e: MouseEvent) => {
      // Only start animation if not dragging a drawing and no tool is active
      if (!activeDrawingTool && !dragStateRef.current && !isDrawingRef.current) {
        isChartDragging = true;
        animateDrawings();
      }
    };

    const handleChartDragEnd = () => {
      isChartDragging = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      drawAllDrawings(); // Final redraw to ensure accuracy
    };

    // Listen on container for chart pan (separate from drawing interactions)
    container.addEventListener("mousedown", handleChartDragStart);
    window.addEventListener("mouseup", handleChartDragEnd);
    window.addEventListener("mouseleave", handleChartDragEnd);

    // Event listeners:
    // - Canvas: mousedown/move/up for creating new drawings (when tool is active)
    // - Container: for hover/select/drag of existing drawings (always)
    // Use capture phase for mousedown to intercept before chart's internal handlers
    canvas.addEventListener("mousedown", handleMouseDown, true);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("dblclick", handleDoubleClick);

    // Also attach to container for when canvas has pointer-events: none
    // These handle hover/selection/drag of existing drawings
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mousedown", handleMouseDown, true);
    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("click", handleClick);
    container.addEventListener("dblclick", handleDoubleClick);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", drawAllDrawings);
    // Window-level mouseup ensures drag state is cleared even if mouse released outside chart
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      // Stop any ongoing animation
      isChartDragging = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }

      timeScale.unsubscribeVisibleLogicalRangeChange(drawAllDrawings);
      canvas.removeEventListener("mousedown", handleMouseDown, true);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("dblclick", handleDoubleClick);
      container.removeEventListener("mousedown", handleChartDragStart);
      window.removeEventListener("mouseup", handleChartDragEnd);
      window.removeEventListener("mouseleave", handleChartDragEnd);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", drawAllDrawings);
    };
  }, [activeDrawingTool, drawings, selectedDrawingId, magnetMode, onDrawingCreate, onDrawingSelect, onDrawingUpdate, onDrawingDelete]);

  // Compute selected drawing position for contextual toolbar
  // Only run when selectedDrawingId changes (not on drawing updates like color changes)
  useEffect(() => {
    if (!selectedDrawingId || !chartRef.current || !seriesRef.current) {
      setSelectedDrawingPosition(null);
      return;
    }

    // Get the drawing from current drawings ref (not dependency)
    const currentDrawings = drawings;
    if (!currentDrawings) {
      setSelectedDrawingPosition(null);
      return;
    }

    const selectedDrawing = currentDrawings.find((d) => d.id === selectedDrawingId);
    if (!selectedDrawing) {
      setSelectedDrawingPosition(null);
      return;
    }

    const chart = chartRef.current;
    const series = seriesRef.current;
    const timeScale = chart.timeScale();

    // Calculate center position of the drawing
    let x = 0;
    let y = 0;

    if (isFibonacciDrawing(selectedDrawing) || isTrendlineDrawing(selectedDrawing) || isRectangleDrawing(selectedDrawing)) {
      const x1 = timeScale.timeToCoordinate(selectedDrawing.anchor1.timestamp / 1000 as Time);
      const x2 = timeScale.timeToCoordinate(selectedDrawing.anchor2.timestamp / 1000 as Time);
      const y1 = series.priceToCoordinate(selectedDrawing.anchor1.price);
      const y2 = series.priceToCoordinate(selectedDrawing.anchor2.price);

      if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
        x = (x1 + x2) / 2;
        y = Math.min(y1, y2) - 10; // Position above the drawing
      }
    } else if (isHorizontalLineDrawing(selectedDrawing)) {
      const yCoord = series.priceToCoordinate(selectedDrawing.price);
      if (yCoord !== null) {
        x = 100; // Left side of chart
        y = yCoord - 10;
      }
    }

    if (x > 0 && y > 0) {
      setSelectedDrawingPosition({ x, y });
    } else {
      setSelectedDrawingPosition(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDrawingId]); // Only re-run when selection changes, not on drawing updates

  // Draw session background colors (on background canvas)
  // LIVE - generates session windows from candle data, no DB dependency
  useEffect(() => {
    if (!sessionBgCanvasRef.current || !chartRef.current || !containerRef.current || !showSessionBgs || !candles || candles.length === 0) {
      // Clear canvas if sessions disabled or no candles
      if (sessionBgCanvasRef.current) {
        const ctx = sessionBgCanvasRef.current.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, sessionBgCanvasRef.current.width, sessionBgCanvasRef.current.height);
        }
      }
      return;
    }

    const canvas = sessionBgCanvasRef.current;
    const chart = chartRef.current;
    const container = containerRef.current;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Generate session windows from candle timestamps (LIVE)
    const liveSessions = generateSessionWindowsFromCandles(candles);

    const drawBackgrounds = () => {
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = container.clientWidth;
      const logicalHeight = container.clientHeight;

      // Setup DPI-aware canvas
      const needsResize = canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr;
      if (needsResize) {
        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;
        canvas.style.width = `${logicalWidth}px`;
        canvas.style.height = `${logicalHeight}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      const timeScale = chart.timeScale();

      for (const session of liveSessions) {
        const sessionType = session.session;
        const colors = SESSION_COLORS[sessionType];
        if (!colors) continue;

        // Convert session times to x coordinates
        const startX = timeScale.timeToCoordinate((session.startTime / 1000) as Time);
        const endX = timeScale.timeToCoordinate((session.endTime / 1000) as Time);

        if (startX === null || endX === null) continue;

        // Draw background rectangle (full height)
        ctx.fillStyle = colors.bg;
        ctx.fillRect(startX, 0, endX - startX, logicalHeight);
      }
    };

    // Draw initially
    drawBackgrounds();

    // Redraw when visible range changes
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(drawBackgrounds);

    // Redraw on resize
    const handleResize = () => drawBackgrounds();
    window.addEventListener("resize", handleResize);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(drawBackgrounds);
      window.removeEventListener("resize", handleResize);
    };
  }, [candles, showSessionBgs]);

  // Update session labels primitive with session data
  // LIVE - generates session H/L from candle data, no DB dependency
  useEffect(() => {
    if (!sessionLabelsPrimitiveRef.current) return;

    if (!showSessionLabels || !candles || candles.length === 0) {
      sessionLabelsPrimitiveRef.current.updateSessions([]);
      return;
    }

    // Generate session windows from candle timestamps (LIVE)
    const liveSessions = generateSessionWindowsFromCandles(candles);

    // Calculate H/L for each session from candles
    const sessionData: SessionData[] = [];
    for (const s of liveSessions) {
      // Filter candles within this session
      const sessionCandles = candles.filter(
        (c) => c.timestamp >= s.startTime && c.timestamp <= s.endTime
      );

      // Skip sessions with no candles
      if (sessionCandles.length === 0) continue;

      // Calculate high and low from session candles
      let high = 0;
      let low = Infinity;
      for (const c of sessionCandles) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
      }

      sessionData.push({
        session: s.session,
        date: s.date,
        high,
        low,
        endTime: s.endTime,
      });
    }

    sessionLabelsPrimitiveRef.current.updateSessions(sessionData);
  }, [candles, showSessionLabels]);

  // Update news markers primitive with news events
  useEffect(() => {
    if (!newsMarkersPrimitiveRef.current) return;

    if (!newsEvents || !showNews) {
      newsMarkersPrimitiveRef.current.updateEvents([]);
      return;
    }

    // Convert to NewsEventData format (including timezone fields)
    const eventData: NewsEventData[] = newsEvents.map((e) => ({
      eventId: e.eventId,
      name: e.name,
      eventType: e.eventType,
      currency: e.currency,
      timestamp: e.timestamp,
      impact: e.impact as "high" | "medium" | "low",
      actual: e.actual ?? undefined,
      forecast: e.forecast ?? undefined,
      previous: e.previous ?? undefined,
      surpriseZScore: e.surpriseZScore ?? undefined,
      datetimeUtc: e.datetimeUtc ?? undefined,
      datetimeNewYork: e.datetimeNewYork ?? undefined,
      datetimeLondon: e.datetimeLondon ?? undefined,
      tradingSession: e.tradingSession ?? undefined,
      reaction: e.reaction ?? null,
      stats: e.stats ?? null,
    }));

    newsMarkersPrimitiveRef.current.updateEvents(eventData);
  }, [newsEvents, showNews]);

  // News marker hover and click detection
  useEffect(() => {
    if (!containerRef.current || !newsMarkersPrimitiveRef.current || !showNews) return;

    const container = containerRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      if (!newsMarkersPrimitiveRef.current) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Only check for hover in the bottom area where flags are drawn (flags at 18px from bottom)
      const chartHeight = rect.height;
      if (y > chartHeight - 45) {
        const event = newsMarkersPrimitiveRef.current.getEventAtCoordinate(x);
        newsMarkersPrimitiveRef.current.setHoveredEvent(event?.eventId || null);
      } else {
        newsMarkersPrimitiveRef.current.setHoveredEvent(null);
      }
    };

    const handleMouseLeave = () => {
      if (newsMarkersPrimitiveRef.current) {
        newsMarkersPrimitiveRef.current.setHoveredEvent(null);
      }
    };

    const handleClick = (e: MouseEvent) => {
      if (!newsMarkersPrimitiveRef.current) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if click is in the bottom area where flags are drawn (flags at 18px from bottom)
      const chartHeight = rect.height;
      if (y > chartHeight - 50) {
        const allEvents = newsMarkersPrimitiveRef.current.getAllEventsAtCoordinate(x);
        if (allEvents.length > 0) {
          // Prevent chart from handling this click
          e.stopPropagation();
          // Call the callback to open the panel with the first event and all events at timestamp
          if (onEventSelect) {
            onEventSelect(allEvents[0], allEvents);
          }
        }
      } else {
        // Clicked elsewhere on chart - clear selection
        newsMarkersPrimitiveRef.current.clearClickedEvent();
      }
    };

    // Use capture phase to intercept clicks before chart handles them
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    container.addEventListener("click", handleClick, true);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      container.removeEventListener("click", handleClick, true);
    };
  }, [showNews, onEventSelect]);

  // Pass historical cache and fetch callback to news markers primitive
  useEffect(() => {
    if (!newsMarkersPrimitiveRef.current) return;

    newsMarkersPrimitiveRef.current.setHistoricalCache(historicalCache);
    newsMarkersPrimitiveRef.current.setOnHoverFetch(fetchHistoricalEvents);
  }, [historicalCache, fetchHistoricalEvents]);

  // Update current candle and price line with live price
  useEffect(() => {
    if (!seriesRef.current || !livePrice || !candles || candles.length === 0) return;

    const duration = getTimeframeDuration(timeframe);
    const now = Date.now();
    const currentCandleStart = Math.floor(now / duration) * duration;
    const currentCandleTime = (currentCandleStart / 1000) as Time;

    // Get the last candle from database
    const lastDbCandle = candles[candles.length - 1];
    const lastDbCandleTime = lastDbCandle.timestamp;
    const lastDbCandleTimeSeconds = (lastDbCandleTime / 1000) as Time;

    // Determine if DB candle is for the current period or a past period
    const dbCandleIsCurrentPeriod = lastDbCandleTime >= currentCandleStart;

    if (dbCandleIsCurrentPeriod) {
      // DB has the current candle - update it with live high/low/close
      // Preserve the tracked high/low if we have it
      let effectiveHigh = lastDbCandle.high;
      let effectiveLow = lastDbCandle.low;

      // If we were tracking this candle, use the better of tracked vs DB values
      if (lastCandleRef.current?.time === lastDbCandleTimeSeconds) {
        effectiveHigh = Math.max(lastCandleRef.current.high, lastDbCandle.high);
        effectiveLow = Math.min(lastCandleRef.current.low, lastDbCandle.low);
      }

      const updatedCandle: CandlestickData<Time> = {
        time: lastDbCandleTimeSeconds,
        open: lastDbCandle.open,
        high: Math.max(effectiveHigh, livePrice.mid),
        low: Math.min(effectiveLow, livePrice.mid),
        close: livePrice.mid,
      };

      seriesRef.current.update(updatedCandle);
      lastCandleRef.current = updatedCandle;
    } else {
      // DB doesn't have the current candle yet - create/update forming candle
      let newCandle: CandlestickData<Time>;

      if (lastCandleRef.current?.time === currentCandleTime) {
        // Update existing forming candle with new tick
        newCandle = {
          time: currentCandleTime,
          open: lastCandleRef.current.open,
          high: Math.max(lastCandleRef.current.high, livePrice.mid),
          low: Math.min(lastCandleRef.current.low, livePrice.mid),
          close: livePrice.mid,
        };
      } else {
        // First tick of new candle - use last close as open for continuity
        const openPrice = lastCandleRef.current?.close ?? lastDbCandle.close ?? livePrice.mid;
        newCandle = {
          time: currentCandleTime,
          open: openPrice,
          high: Math.max(openPrice, livePrice.mid),
          low: Math.min(openPrice, livePrice.mid),
          close: livePrice.mid,
        };
      }

      seriesRef.current.update(newCandle);
      lastCandleRef.current = newCandle;
    }

    // Update live price primitive (handles price line + countdown display)
    if (livePricePrimitiveRef.current) {
      const isUp = livePrice.mid >= (lastDbCandle?.close || 0);
      livePricePrimitiveRef.current.updateData(livePrice.mid, candleCountdown, isUp);
    }
  }, [livePrice, candles, timeframe, candleCountdown]);

  // Reset chart view - show recent ~100 candles (same as initial view)
  // Uses refs so it doesn't cause re-renders when candles update
  const resetView = useCallback(() => {
    if (!chartRef.current) return;
    const dataLength = candleDataRef.current.size;
    if (dataLength === 0) return;

    const visibleBars = Math.min(100, dataLength);
    const duration = getTimeframeDuration(timeframe);
    const msPerDay = 24 * 60 * 60 * 1000;
    const visibleFutureBars = Math.ceil((5 * msPerDay) / duration);
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: dataLength - visibleBars,
      to: dataLength + visibleFutureBars,
    });
  }, [timeframe]);

  // Expose resetView to parent component
  useEffect(() => {
    if (onResetViewReady) {
      onResetViewReady(resetView);
    }
  }, [onResetViewReady, resetView]);

  // Scroll to a specific timestamp - centers the view on that timestamp
  const scrollToTimestamp = useCallback((timestamp: number) => {
    if (!chartRef.current || !candles || candles.length === 0) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    // Convert timestamp to chart time (seconds)
    const chartTime = timestamp / 1000;

    // Find the bar index for this timestamp
    // candleDataRef is a Map keyed by timestamp in seconds
    let targetIndex = -1;
    let idx = 0;
    for (const [time] of candleDataRef.current) {
      if (time >= chartTime) {
        targetIndex = idx;
        break;
      }
      idx++;
    }

    // If timestamp is before all candles, show the start
    if (targetIndex === -1) {
      targetIndex = 0;
    }

    // Center the view on the target index with ~50 bars on each side
    const visibleBars = 100;
    const halfVisible = visibleBars / 2;
    const dataLength = candleDataRef.current.size;

    const from = Math.max(0, targetIndex - halfVisible);
    const to = Math.min(dataLength + 10, targetIndex + halfVisible);

    timeScale.setVisibleLogicalRange({ from, to });
  }, [candles]);

  // Expose scrollToTimestamp to parent component
  useEffect(() => {
    if (onScrollToTimestampReady) {
      onScrollToTimestampReady(scrollToTimestamp);
    }
  }, [onScrollToTimestampReady, scrollToTimestamp]);

  // Scroll-back detection: load more history when user scrolls to the left edge
  useEffect(() => {
    if (!chartRef.current || !candles || candles.length === 0) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    const handleVisibleRangeChange = () => {
      // Skip if already loading or no more history
      if (scrollLoadingRef.current || isLoadingMore || !hasMoreHistory) return;

      const visibleRange = timeScale.getVisibleLogicalRange();
      if (!visibleRange) return;

      // Trigger load when user is viewing candles near the left edge (within 150 bars)
      // Higher threshold = preload earlier for smoother experience
      const threshold = 150;
      if (visibleRange.from < threshold) {
        scrollLoadingRef.current = true;
        loadMoreHistory().finally(() => {
          scrollLoadingRef.current = false;
        });
      }
    };

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    };
  }, [candles, isLoadingMore, hasMoreHistory, loadMoreHistory]);

  // Broadcast visible range as timestamps for snapshot capture
  useEffect(() => {
    if (!chartRef.current || !onVisibleRangeChange || !candles || candles.length === 0) return;

    const chart = chartRef.current;
    const timeScale = chart.timeScale();

    const handleRangeForSnapshot = () => {
      const logicalRange = timeScale.getVisibleLogicalRange();
      if (!logicalRange) {
        onVisibleRangeChange(null);
        return;
      }

      // Convert logical bar indices to timestamps using candleDataRef
      const times = Array.from(candleDataRef.current.keys());
      if (times.length === 0) {
        onVisibleRangeChange(null);
        return;
      }

      const fromIdx = Math.max(0, Math.floor(logicalRange.from));
      const toIdx = Math.min(times.length - 1, Math.floor(logicalRange.to));

      const fromTimestamp = (times[fromIdx] || times[0]) * 1000; // Convert seconds to ms
      const toTimestamp = (times[toIdx] || times[times.length - 1]) * 1000;

      onVisibleRangeChange({ from: fromTimestamp, to: toTimestamp });
    };

    // Initial call
    handleRangeForSnapshot();

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeForSnapshot);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeForSnapshot);
    };
  }, [candles, onVisibleRangeChange]);

  useEffect(() => {
    lastCandleRef.current = null;
    // Clear candle data ref for new timeframe
    candleDataRef.current.clear();
    // Reset scroll-back tracking refs
    prevCandleCountRef.current = 0;
    prevOldestTimestampRef.current = null;
  }, [pair, timeframe]);

  // Countdown timer - updates every second showing time until candle close
  // Only shows when market is tradeable (OANDA tells us via tradeable field)
  useEffect(() => {
    const duration = getTimeframeDuration(timeframe);

    const updateCountdown = () => {
      // Hide countdown during spread hour / market closed (OANDA tells us)
      if (!livePrice?.tradeable) {
        setCandleCountdown("");
        return;
      }

      const now = Date.now();
      const currentCandleStart = Math.floor(now / duration) * duration;
      const candleEnd = currentCandleStart + duration;
      const remaining = candleEnd - now;

      if (remaining > 0) {
        const totalSeconds = Math.floor(remaining / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let countdown: string;
        // Format based on timeframe duration
        if (duration >= 86400000) {
          // Daily or longer - show hours:minutes:seconds
          countdown = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        } else if (duration >= 3600000) {
          // Hourly - show hours:minutes:seconds
          countdown = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        } else {
          // Minutes - show minutes:seconds
          const totalMinutes = Math.floor(totalSeconds / 60);
          countdown = `${totalMinutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
        }

        setCandleCountdown(countdown);
      }
    };

    // Update immediately
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [timeframe, livePrice?.tradeable]);

  // Determine display values (hovered or live)
  const displayCandle = hoveredCandle || (livePrice && candles?.length ? {
    open: candles[candles.length - 1].open,
    high: candles[candles.length - 1].high,
    low: candles[candles.length - 1].low,
    close: livePrice.mid,
    time: livePrice.time,
  } : null);

  const priceChange = displayCandle ? displayCandle.close - displayCandle.open : 0;
  const priceChangePercent = displayCandle && displayCandle.open ?
    ((priceChange / displayCandle.open) * 100) : 0;

  return (
    <div className="relative w-full h-full min-h-[400px]">
      {/* OHLC Legend */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-4 text-xs font-mono">
        {displayCandle && (
          <>
            <span className="text-gray-400">
              O <span className="text-gray-200">{displayCandle.open.toFixed(5)}</span>
            </span>
            <span className="text-gray-400">
              H <span className="text-gray-200">{displayCandle.high.toFixed(5)}</span>
            </span>
            <span className="text-gray-400">
              L <span className="text-gray-200">{displayCandle.low.toFixed(5)}</span>
            </span>
            <span className="text-gray-400">
              C <span className={priceChange >= 0 ? "text-green-400" : "text-red-400"}>
                {displayCandle.close.toFixed(5)}
              </span>
            </span>
            <span className={priceChange >= 0 ? "text-green-400" : "text-red-400"}>
              {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(5)} ({priceChangePercent.toFixed(2)}%)
            </span>
          </>
        )}
      </div>

      {/* Current Session Indicator */}
      {activeSessions.length > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          {activeSessions.map((session) => (
            <span
              key={session}
              className="px-2 py-0.5 text-xs rounded"
              style={{
                backgroundColor: SESSION_COLORS[session as keyof typeof SESSION_COLORS]?.bg || "rgba(128,128,128,0.2)",
                color: SESSION_COLORS[session as keyof typeof SESSION_COLORS]?.high || "#888",
                border: `1px solid ${SESSION_COLORS[session as keyof typeof SESSION_COLORS]?.high || "#888"}`,
              }}
            >
              {session}
            </span>
          ))}
        </div>
      )}


      {/* Dark background layer */}
      <div className="absolute inset-0 bg-[#0a0a0a]" style={{ zIndex: 0 }} />

      {/* Session background canvas - on top of dark bg, behind chart */}
      <canvas
        ref={sessionBgCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Strategy zone background canvas - on top of session bg, behind chart */}
      <canvas
        ref={zoneBgCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1.5 }}
      />

      {/* Chart with transparent background */}
      <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 2 }} />

      {/* Drawing canvas - renders drawings, captures events when tool active or drawing selected */}
      <canvas
        ref={drawingCanvasRef}
        className="absolute inset-0"
        style={{
          zIndex: 3,
          pointerEvents: activeDrawingTool || selectedDrawingId ? "auto" : "none",
          cursor: activeDrawingTool ? "crosshair" : (selectedDrawingId ? "move" : "default"),
        }}
      />

      {/* Contextual toolbar for selected drawing */}
      {selectedDrawingId && selectedDrawingPosition && drawings && onDrawingUpdate && onDrawingDelete && (() => {
        const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId);
        if (!selectedDrawing) return null;
        return (
          <ContextualToolbar
            drawing={selectedDrawing}
            position={selectedDrawingPosition}
            onUpdate={(updates) => onDrawingUpdate(selectedDrawingId, updates)}
            onDelete={() => onDrawingDelete(selectedDrawingId)}
            containerBounds={containerRef.current?.getBoundingClientRect()}
          />
        );
      })()}

      {/* Drawing settings modal (opens on double-click) */}
      {settingsDrawingId && drawings && onDrawingUpdate && (() => {
        const settingsDrawing = drawings.find((d) => d.id === settingsDrawingId);
        if (!settingsDrawing) return null;
        // Get all position drawings for linking
        const positionDrawings = drawings.filter(
          (d): d is PositionDrawing => d.type === "longPosition" || d.type === "shortPosition"
        );
        return (
          <DrawingSettings
            drawing={settingsDrawing}
            onUpdate={(updates) => onDrawingUpdate(settingsDrawingId, updates)}
            onClose={() => setSettingsDrawingId(null)}
            positions={positionDrawings}
          />
        );
      })()}

      {/* Live price line + countdown are rendered by LivePricePrimitive directly on the chart canvas */}

      {candlesLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50">
          <div className="text-gray-400">Loading chart data...</div>
        </div>
      )}
      {!candlesLoading && candles && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50">
          <div className="text-gray-400">No candle data available for {pair} {timeframe}.</div>
        </div>
      )}

      {/* Loading more history indicator */}
      {isLoadingMore && (
        <div className="absolute top-2 right-2 z-10 px-2 py-1 text-xs bg-gray-800/80 rounded text-gray-300">
          Loading history...
        </div>
      )}
    </div>
  );
}
