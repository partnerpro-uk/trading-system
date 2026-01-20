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
} from "lightweight-charts";
import { useQuery, useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { LivePrice } from "@/hooks/useOandaStream";
import { SessionLabelsPrimitive, SessionData } from "./SessionLabelsPrimitive";
import { NewsMarkersPrimitive, NewsEventData, HistoricalEventHistory } from "./NewsMarkersPrimitive";
import { LivePricePrimitive } from "./LivePricePrimitive";

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

interface ChartProps {
  pair: string;
  timeframe: string;
  magnetMode: boolean;
  showSessions: boolean;
  showNews: boolean;
  livePrice?: LivePrice | null; // Passed from parent to avoid duplicate streams
  onResetViewReady?: (resetFn: () => void) => void; // Expose reset function to parent
  onEventSelect?: (event: NewsEventData | null) => void; // Callback when event is clicked
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

export function Chart({ pair, timeframe, magnetMode, showSessions, showNews, livePrice, onResetViewReady, onEventSelect }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const futureSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionLineSeriesRef = useRef<Map<string, any>>(new Map());
  const sessionBgCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);
  const candleDataRef = useRef<Map<number, CandlestickData<Time>>>(new Map());
  const sessionLabelsPrimitiveRef = useRef<SessionLabelsPrimitive | null>(null);
  const newsMarkersPrimitiveRef = useRef<NewsMarkersPrimitive | null>(null);
  const livePricePrimitiveRef = useRef<LivePricePrimitive | null>(null);

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


  // Convex client for imperative queries
  const convex = useConvex();

  // Cache for historical event data (fetched on hover)
  const [historicalCache, setHistoricalCache] = useState<Map<string, HistoricalEventHistory>>(
    () => new Map()
  );

  // Fetch historical events for tooltip (called on hover)
  const fetchHistoricalEvents = useCallback(
    async (event: NewsEventData) => {
      // Skip if already cached
      if (historicalCache.has(event.eventId)) return;

      try {
        const result = await convex.query(api.newsQueries.getHistoricalEventsForTooltip, {
          eventType: event.eventType,
          pair,
          beforeTimestamp: event.timestamp,
          limit: 5,
        });

        setHistoricalCache((prev) => {
          const next = new Map(prev);
          next.set(event.eventId, result);
          return next;
        });
      } catch (err) {
        console.error("Failed to fetch historical events:", err);
      }
    },
    [convex, pair, historicalCache]
  );

  // Subscribe to ALL candles from Convex (reactive - updates when DB changes)
  const candles = useQuery(api.candles.getCandles, { pair, timeframe });

  // Current session indicator (for badge display)
  const currentSession = useQuery(api.sessions.getCurrentSession, {});

  // Compute time range for news query - 14 days back + 2 weeks forward
  // (Reduced from 60 days to avoid Convex 32k document read limit)
  const newsTimeRange = candles && candles.length > 0
    ? {
        start: candles[candles.length - 1].timestamp - 14 * 24 * 60 * 60 * 1000, // 14 days back
        end: candles[candles.length - 1].timestamp + 14 * 24 * 60 * 60 * 1000,   // 2 weeks forward
      }
    : null;

  // Subscribe to news events in time range
  const newsEvents = useQuery(
    api.newsQueries.getEventsInTimeRange,
    newsTimeRange && showNews
      ? {
          pair,
          startTime: newsTimeRange.start,
          endTime: newsTimeRange.end,
          impactFilter: "high",
        }
      : "skip"
  );

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

    // Set initial view - show recent candles
    if (chartRef.current) {
      // Show ~100 most recent candles instead of all data
      const visibleBars = Math.min(100, formattedData.length);
      // Calculate bars for ~5 days forward in visible range
      const duration = getTimeframeDuration(timeframe);
      const msPerDay = 24 * 60 * 60 * 1000;
      const visibleFutureBars = Math.ceil((5 * msPerDay) / duration);
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: formattedData.length - visibleBars,
        to: formattedData.length + visibleFutureBars, // Show ~5 days into future initially
      });
    }
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

    if (!showSessions) return;

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
  }, [candles, showSessions]);

  // Draw session background colors (on background canvas)
  // LIVE - generates session windows from candle data, no DB dependency
  useEffect(() => {
    if (!sessionBgCanvasRef.current || !chartRef.current || !containerRef.current || !showSessions || !candles || candles.length === 0) {
      // Clear canvas if sessions disabled or no candles
      if (sessionBgCanvasRef.current) {
        const ctx = sessionBgCanvasRef.current.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, sessionBgCanvasRef.current.width, sessionBgCanvasRef.current.height);
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
      // Update canvas size to match container
      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

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
        ctx.fillRect(startX, 0, endX - startX, canvas.height);
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
  }, [candles, showSessions]);

  // Update session labels primitive with session data
  // LIVE - generates session H/L from candle data, no DB dependency
  useEffect(() => {
    if (!sessionLabelsPrimitiveRef.current) return;

    if (!showSessions || !candles || candles.length === 0) {
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
  }, [candles, showSessions]);

  // Update news markers primitive with news events
  useEffect(() => {
    if (!newsMarkersPrimitiveRef.current) return;

    if (!newsEvents || !showNews) {
      newsMarkersPrimitiveRef.current.updateEvents([]);
      return;
    }

    // Convert to NewsEventData format
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
        const event = newsMarkersPrimitiveRef.current.getEventAtCoordinate(x);
        if (event) {
          // Prevent chart from handling this click
          e.stopPropagation();
          // Call the callback to open the panel instead of toggling tooltip
          if (onEventSelect) {
            onEventSelect(event);
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

    // Check if we're in a new candle period
    if (currentCandleStart > lastDbCandleTime) {
      // Create a new forming candle
      const newCandle: CandlestickData<Time> = {
        time: currentCandleTime,
        open: livePrice.mid,
        high: livePrice.mid,
        low: livePrice.mid,
        close: livePrice.mid,
      };

      if (lastCandleRef.current?.time === currentCandleTime) {
        // Update existing forming candle
        newCandle.open = lastCandleRef.current.open;
        newCandle.high = Math.max(lastCandleRef.current.high, livePrice.mid);
        newCandle.low = Math.min(lastCandleRef.current.low, livePrice.mid);
        newCandle.close = livePrice.mid;
      }

      seriesRef.current.update(newCandle);
      lastCandleRef.current = newCandle;
    } else {
      // Update the last database candle with live close
      const updatedCandle: CandlestickData<Time> = {
        time: (lastDbCandleTime / 1000) as Time,
        open: lastDbCandle.open,
        high: Math.max(lastDbCandle.high, livePrice.mid),
        low: Math.min(lastDbCandle.low, livePrice.mid),
        close: livePrice.mid,
      };
      seriesRef.current.update(updatedCandle);
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

  useEffect(() => {
    lastCandleRef.current = null;
    // Clear candle data ref for new timeframe
    candleDataRef.current.clear();
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
      {currentSession && currentSession.activeSessions.length > 0 && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          {currentSession.activeSessions.map((session) => (
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

      {/* Chart with transparent background */}
      <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 2 }} />

      {/* Live price line + countdown are rendered by LivePricePrimitive directly on the chart canvas */}

      {!candles && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50">
          <div className="text-gray-400">Loading chart data...</div>
        </div>
      )}
      {candles && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50">
          <div className="text-gray-400">No candle data available. Fetch data first.</div>
        </div>
      )}
    </div>
  );
}
