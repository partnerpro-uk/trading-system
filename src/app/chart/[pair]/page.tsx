"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Chart } from "@/components/chart/Chart";
import { ChartSidebar } from "@/components/chart/ChartSidebar";
import { NewsEventPanel } from "@/components/chart/NewsEventPanel";
import { DrawingToolbar } from "@/components/chart/DrawingToolbar";
import { NewsEventData } from "@/components/chart/NewsMarkersPrimitive";
import { useOandaStream } from "@/hooks/useOandaStream";
import { useCandleCache } from "@/hooks/useCandleCache";
import { useStrategies } from "@/hooks/useStrategies";
import { useStrategyVisuals } from "@/hooks/useStrategyVisuals";
import { useDrawings, useDrawingKeyboardShortcuts } from "@/hooks/useDrawings";
import { usePositionSync } from "@/hooks/usePositionSync";
import { useTradesForChart } from "@/hooks/useTrades";
import { useCaptureSnapshot } from "@/hooks/useSnapshots";
import { hydrateDrawingStore, useDrawingStore } from "@/lib/drawings/store";
import { PositionDrawing, HorizontalRayDrawing, isPositionDrawing } from "@/lib/drawings/types";
import { LivePositionsContainer } from "@/components/chart/LivePositionPanel";
import { CloseTradeModal, CloseTradeResult } from "@/components/chart/CloseTradeModal";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { UserButton, SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/nextjs";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useChatStore } from "@/lib/chat/store";
import { useChat } from "@/hooks/useChat";
import { useStructure } from "@/hooks/useStructure";
import { useStructurePrefs } from "@/hooks/useStructurePrefs";
import { useAlerts } from "@/hooks/useAlerts";
import { ToastContainer } from "@/components/alerts/ToastContainer";
import { AlertBell } from "@/components/alerts/AlertBell";
import { AlertPreferencesModal } from "@/components/alerts/AlertPreferencesModal";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "M"] as const;

export default function ChartPage() {
  const params = useParams();
  const pair = params.pair as string;

  // Clerk auth for Convex token (used by Claude chat to query trades)
  // getToken is unstable (new ref each render) and mints fresh JWTs,
  // so we store it in a ref to avoid an infinite re-render loop.
  const { getToken } = useAuth();
  const [convexToken, setConvexToken] = useState<string | null>(null);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  useEffect(() => {
    let cancelled = false;
    const fetchToken = () => {
      getTokenRef.current({ template: "convex" })
        .then((token) => { if (!cancelled) setConvexToken(token); })
        .catch(() => {});
    };
    fetchToken();
    // Refresh token every 50s (Clerk tokens expire in ~60s)
    const interval = setInterval(fetchToken, 50_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Candle cache with prefetching (adjacent timeframes load immediately, rest after 20s)
  const {
    candles,
    isLoading: candlesLoading,
    isLoadingMore,
    hasMoreHistory,
    loadMoreHistory,
    switchTimeframe,
    currentTimeframe: timeframe,
    prefetchedTimeframes,
  } = useCandleCache({ pair, initialTimeframe: "M15" });

  // Chart control states (lifted from Chart component)
  const [magnetMode, setMagnetMode] = useState<boolean>(false); // Off by default
  const [showSessionBgs, setShowSessionBgs] = useState<boolean>(true);
  const [showSessionLines, setShowSessionLines] = useState<boolean>(false); // Off by default (less clutter)
  const [showSessionLabels, setShowSessionLabels] = useState<boolean>(false); // Off by default (less clutter)
  const [showNews, setShowNews] = useState<boolean>(true);

  // Market structure overlay states
  const [showSwingLabels, setShowSwingLabels] = useState<boolean>(true);
  const [showBOSLines, setShowBOSLines] = useState<boolean>(true);
  const [showKeyLevels, setShowKeyLevels] = useState<boolean>(false);
  const [showSweeps, setShowSweeps] = useState<boolean>(false);
  const [showFVGs, setShowFVGs] = useState<boolean>(false);
  const [fvgTierFilter, setFVGTierFilter] = useState<1 | 2 | 3>(3);
  const [showPremiumDiscount, setShowPremiumDiscount] = useState<boolean>(false);

  // Structure preferences persistence
  const { prefs: structurePrefs, save: saveStructurePrefs } = useStructurePrefs();
  const prefsSeededRef = useRef(false);

  // Seed local state from saved prefs once on first load
  useEffect(() => {
    if (structurePrefs && !prefsSeededRef.current) {
      prefsSeededRef.current = true;
      const t = structurePrefs.overlayToggles;
      setShowSwingLabels(t.swings);
      setShowBOSLines(t.bos);
      setShowFVGs(t.fvgs);
      setShowKeyLevels(t.levels);
      setShowPremiumDiscount(t.premiumDiscount);
      setShowSweeps(t.sweeps);
      setFVGTierFilter(structurePrefs.fvgMinTier as 1 | 2 | 3);
    }
  }, [structurePrefs]);

  // Persist overlay toggles on change (debounced)
  const persistStructurePrefs = useCallback(
    (overrides?: Partial<{
      swings: boolean; bos: boolean; fvgs: boolean;
      levels: boolean; premiumDiscount: boolean; sweeps: boolean;
      fvgMinTier: number;
    }>) => {
      saveStructurePrefs({
        overlayToggles: {
          swings: overrides?.swings ?? showSwingLabels,
          bos: overrides?.bos ?? showBOSLines,
          fvgs: overrides?.fvgs ?? showFVGs,
          levels: overrides?.levels ?? showKeyLevels,
          premiumDiscount: overrides?.premiumDiscount ?? showPremiumDiscount,
          sweeps: overrides?.sweeps ?? showSweeps,
        },
        fvgMinTier: overrides?.fvgMinTier ?? fvgTierFilter,
        showRecentOnly: false,
      });
    },
    [saveStructurePrefs, showSwingLabels, showBOSLines, showFVGs, showKeyLevels, showPremiumDiscount, showSweeps, fvgTierFilter]
  );

  // Wrapped setters that also persist
  const handleSetShowSwingLabels = useCallback((v: boolean) => {
    setShowSwingLabels(v);
    persistStructurePrefs({ swings: v });
  }, [persistStructurePrefs]);

  const handleSetShowBOSLines = useCallback((v: boolean) => {
    setShowBOSLines(v);
    persistStructurePrefs({ bos: v });
  }, [persistStructurePrefs]);

  const handleSetShowFVGs = useCallback((v: boolean) => {
    setShowFVGs(v);
    persistStructurePrefs({ fvgs: v });
  }, [persistStructurePrefs]);

  const handleSetShowKeyLevels = useCallback((v: boolean) => {
    setShowKeyLevels(v);
    persistStructurePrefs({ levels: v });
  }, [persistStructurePrefs]);

  const handleSetShowPremiumDiscount = useCallback((v: boolean) => {
    setShowPremiumDiscount(v);
    persistStructurePrefs({ premiumDiscount: v });
  }, [persistStructurePrefs]);

  const handleSetShowSweeps = useCallback((v: boolean) => {
    setShowSweeps(v);
    persistStructurePrefs({ sweeps: v });
  }, [persistStructurePrefs]);

  const handleSetFVGTierFilter = useCallback((v: 1 | 2 | 3) => {
    setFVGTierFilter(v);
    persistStructurePrefs({ fvgMinTier: v });
  }, [persistStructurePrefs]);

  // Structure: always load data (sidebar structure tab needs it regardless of chart overlays)
  const { structure: structureData } = useStructure({ pair, timeframe, enabled: true });

  // Ref for structure data (used by snapshot capture + position sync without causing re-renders)
  const structureDataRef = useRef(structureData);
  structureDataRef.current = structureData;

  // Alerts
  const { unreadCount, recentAlerts, preferences: alertPrefs, markRead, markAllRead } = useAlerts();
  const [alertPrefsOpen, setAlertPrefsOpen] = useState(false);

  // Chat panel state
  const chatOpen = useChatStore((s) => s.isOpen);
  const toggleChat = useChatStore((s) => s.toggle);
  const closeChat = useChatStore((s) => s.close);

  // Chat keyboard shortcut (Cmd+L / Ctrl+L)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        toggleChat();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleChat]);

  // Chat context for useChat hook (memoized to avoid re-renders)
  // NOTE: filteredDrawings and livePrice are defined later in the component,
  // so chatContext is defined after them (see below where useChat is called)

  // Selected event for sidebar panel
  const [selectedEvent, setSelectedEvent] = useState<NewsEventData | null>(null);
  const [allEventsAtTimestamp, setAllEventsAtTimestamp] = useState<NewsEventData[]>([]);

  // Hydrate drawing store on client side
  useEffect(() => {
    hydrateDrawingStore();
  }, []);

  // Reset view function from Chart component
  const [resetViewFn, setResetViewFn] = useState<(() => void) | null>(null);
  const handleResetViewReady = useCallback((fn: () => void) => {
    setResetViewFn(() => fn);
  }, []);

  // Scroll to timestamp function from Chart component
  const [scrollToTimestampFn, setScrollToTimestampFn] = useState<((timestamp: number) => void) | null>(null);
  const handleScrollToTimestampReady = useCallback((fn: (timestamp: number) => void) => {
    setScrollToTimestampFn(() => fn);
  }, []);

  const handleEventSelect = useCallback((event: NewsEventData | null, allEvents?: NewsEventData[]) => {
    setSelectedEvent(event);
    setAllEventsAtTimestamp(allEvents || (event ? [event] : []));
  }, []);

  const handleCloseEventPanel = useCallback(() => {
    setSelectedEvent(null);
    setAllEventsAtTimestamp([]);
  }, []);

  const handleNavigateEvent = useCallback((event: NewsEventData) => {
    setSelectedEvent(event);
  }, []);

  const { status, currentSession, nextOpen, livePrice } = useOandaStream(pair);

  // Strategies
  const { strategies } = useStrategies();
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  // Strategy visuals (indicators, markers, zones, levels, entry signals)
  const { indicatorSeries, indicatorConfigs, markers, zones, levels, entrySignals } = useStrategyVisuals({
    strategyId: selectedStrategy,
    candles: candles,
  });

  // Indicator visibility state (off by default)
  const [indicatorVisibility, setIndicatorVisibility] = useState<Record<string, boolean>>({});

  // Drawing tools
  const {
    drawings,
    activeDrawingTool,
    selectedDrawingId,
    drawingCount,
    setActiveDrawingTool,
    selectDrawing,
    createDrawing,
    updateDrawing,
    deleteDrawing,
    clearAll: clearAllDrawings,
    undo,
  } = useDrawings({ pair, timeframe });

  // Visible range ref for snapshot capture (updated by Chart component)
  const visibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const handleVisibleRangeChange = useCallback((range: { from: number; to: number } | null) => {
    visibleRangeRef.current = range;
  }, []);

  // Snapshot capture hook (pass structureDataRef for structure context in snapshots)
  const { capture: captureSnapshot } = useCaptureSnapshot(pair, timeframe, visibleRangeRef, structureDataRef);

  // Sync position drawings to Convex trades and auto-detect TP/SL hits
  // Trade log (Convex) is source of truth for exits - manual edits override auto-detection
  usePositionSync(pair, timeframe, candles, captureSnapshot, livePrice, structureDataRef);

  // Fetch trades for this chart to display exit lines on positions
  const { tradesMap } = useTradesForChart(pair, timeframe);

  // Close trade modal state
  const [closingPosition, setClosingPosition] = useState<PositionDrawing | null>(null);
  const closeTradeConvex = useMutation(api.trades.closeTrade);

  // Get open positions for the LivePositionsContainer
  const openPositions = useMemo(() => {
    return drawings.filter(
      (d) => isPositionDrawing(d) && (d.status === "open" || d.status === "pending")
    ) as PositionDrawing[];
  }, [drawings]);

  // Handle close trade from LivePositionPanel
  const handleClosePosition = useCallback((positionId: string) => {
    const position = drawings.find((d) => d.id === positionId);
    if (position && isPositionDrawing(position)) {
      setClosingPosition(position as PositionDrawing);
    }
  }, [drawings]);

  // Handle close trade confirmation from modal
  const handleCloseTradeConfirm = useCallback(async (result: CloseTradeResult) => {
    if (!closingPosition) return;

    const isLong = closingPosition.type === "longPosition";
    const pipMultiplier = pair.includes("JPY") ? 100 : 10000;

    // Calculate P&L
    const pnl = isLong
      ? (result.exitPrice - closingPosition.entry.price) * pipMultiplier
      : (closingPosition.entry.price - result.exitPrice) * pipMultiplier;

    // Determine outcome from close reason
    let outcome: "TP" | "SL" | "MW" | "ML" | "BE";
    if (result.closeReason === "breakeven") {
      outcome = "BE";
    } else if (pnl >= 0) {
      outcome = "MW";
    } else {
      outcome = "ML";
    }

    // Close the Convex trade if synced
    if (closingPosition.convexTradeId) {
      try {
        await closeTradeConvex({
          id: closingPosition.convexTradeId as Id<"trades">,
          exitTime: Date.now(),
          exitPrice: result.exitPrice,
          outcome,
          pnlPips: Math.round(pnl * 100) / 100,
          closeReason: result.closeReason,
          closeReasonNote: result.closeReasonNote,
        });
      } catch (e) {
        console.error("Failed to close trade in Convex:", e);
      }
    }

    // Update the drawing with closed state
    updateDrawing(closingPosition.id, {
      status: "closed",
      exitPrice: result.exitPrice,
      exitTimestamp: Date.now(),
      closedAt: Date.now(),
      closedReason: "manual",
      outcome: pnl >= 0 ? "manual" : "manual",
      closeReasonNote: result.closeReasonNote,
    } as Record<string, unknown>);

    setClosingPosition(null);
  }, [closingPosition, pair, closeTradeConvex, updateDrawing]);

  // Handle snapshot from LivePositionPanel
  const handlePositionSnapshot = useCallback((positionId: string) => {
    const position = drawings.find((d) => d.id === positionId);
    if (position && isPositionDrawing(position)) {
      const pos = position as PositionDrawing;
      const price = livePrice?.mid;
      if (pos.convexTradeId && price) {
        captureSnapshot({
          tradeId: pos.convexTradeId,
          momentLabel: "during",
          currentPrice: price,
          trade: {
            direction: pos.type === "longPosition" ? "LONG" : "SHORT",
            entryPrice: pos.entry.price,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            entryTime: pos.entry.timestamp,
            createdAt: pos.createdAt ?? Date.now(),
          },
        });
      }
    }
  }, [drawings, captureSnapshot, livePrice]);

  // Track which entry signals we've already created drawings for (to avoid duplicates)
  const createdSignalsRef = useRef<Set<string>>(new Set());
  // Track which strategy levels we've created (FCR high/low, FVG lines)
  const createdLevelsRef = useRef<Set<string>>(new Set());
  // Track previous strategy to clear levels when strategy changes
  const prevStrategyRef = useRef<string | null>(null);

  // Create position drawings from strategy entry signals
  useEffect(() => {
    if (!entrySignals || entrySignals.length === 0) return;

    const { createLongPosition, createShortPosition } = useDrawingStore.getState();

    for (const signal of entrySignals) {
      // Create a unique key for this signal
      const signalKey = `${signal.timestamp}-${signal.direction}-${signal.entryPrice}`;

      // Skip if we've already created a drawing for this signal
      if (createdSignalsRef.current.has(signalKey)) continue;

      // Check if a position already exists at this timestamp
      const existingPosition = drawings.find(
        (d) =>
          (d.type === "longPosition" || d.type === "shortPosition") &&
          (d as PositionDrawing).entry.timestamp === signal.timestamp
      );

      if (existingPosition) {
        createdSignalsRef.current.add(signalKey);
        continue;
      }

      // Create the position drawing
      const entry = {
        timestamp: signal.timestamp,
        price: signal.entryPrice,
      };

      if (signal.direction === "long") {
        createLongPosition(pair, timeframe, entry, signal.takeProfit, signal.stopLoss, {
          createdBy: "strategy",
          strategyId: signal.strategyId,
          status: "signal",
          locked: true, // Strategy signals are locked until taken
        });
      } else {
        createShortPosition(pair, timeframe, entry, signal.takeProfit, signal.stopLoss, {
          createdBy: "strategy",
          strategyId: signal.strategyId,
          status: "signal",
          locked: true, // Strategy signals are locked until taken
        });
      }

      createdSignalsRef.current.add(signalKey);
    }
  }, [entrySignals, pair, timeframe, drawings]);

  // Calculate hypothetical outcomes for strategy signals based on candle data
  // Check if price hit TP or SL first after signal entry
  useEffect(() => {
    if (!candles || candles.length === 0) return;

    const signalPositions = drawings.filter((d) => {
      if (d.type !== "longPosition" && d.type !== "shortPosition") return false;
      const position = d as PositionDrawing;
      // Only process signals without an outcome calculated yet
      return position.status === "signal" && !position.outcome;
    }) as PositionDrawing[];

    if (signalPositions.length === 0) return;

    for (const position of signalPositions) {
      const entryTimestamp = position.entry.timestamp;
      const entryPrice = position.entry.price;
      const tp = position.takeProfit;
      const sl = position.stopLoss;

      // Need both TP and SL to calculate outcome
      if (!tp || !sl) continue;

      // Get candles after the entry timestamp
      const subsequentCandles = candles.filter((c) => c.timestamp > entryTimestamp);
      if (subsequentCandles.length === 0) continue;

      let outcome: "tp" | "sl" | null = null;

      // Check each subsequent candle to see if TP or SL was hit
      for (const candle of subsequentCandles) {
        if (position.type === "longPosition") {
          // Long: TP hit if high >= TP, SL hit if low <= SL
          const tpHit = candle.high >= tp;
          const slHit = candle.low <= sl;

          if (tpHit && slHit) {
            // Both hit in same candle - check which price was closer to entry
            // If open is closer to TP side, assume TP hit first; otherwise SL
            const distanceToTp = Math.abs(candle.open - tp);
            const distanceToSl = Math.abs(candle.open - sl);
            outcome = distanceToTp < distanceToSl ? "tp" : "sl";
            break;
          } else if (tpHit) {
            outcome = "tp";
            break;
          } else if (slHit) {
            outcome = "sl";
            break;
          }
        } else {
          // Short: TP hit if low <= TP, SL hit if high >= SL
          const tpHit = candle.low <= tp;
          const slHit = candle.high >= sl;

          if (tpHit && slHit) {
            // Both hit in same candle
            const distanceToTp = Math.abs(candle.open - tp);
            const distanceToSl = Math.abs(candle.open - sl);
            outcome = distanceToTp < distanceToSl ? "tp" : "sl";
            break;
          } else if (tpHit) {
            outcome = "tp";
            break;
          } else if (slHit) {
            outcome = "sl";
            break;
          }
        }
      }

      // Update the drawing with the calculated outcome
      if (outcome) {
        updateDrawing(position.id, { outcome });
      }
    }
  }, [candles, drawings, updateDrawing]);

  // Create horizontal ray drawings from strategy levels (FCR high/low, FVG lines)
  useEffect(() => {
    if (!levels || levels.length === 0) return;

    const { createHorizontalRay } = useDrawingStore.getState();

    // If strategy changed, clear the created levels tracker
    if (prevStrategyRef.current !== selectedStrategy) {
      createdLevelsRef.current.clear();
      prevStrategyRef.current = selectedStrategy;
    }

    for (const level of levels) {
      // Create a unique key for this level
      const levelKey = `${level.label || 'level'}-${level.price}-${level.startTime || 0}`;

      // Skip if we've already created this level
      if (createdLevelsRef.current.has(levelKey)) continue;

      // Check if a horizontal ray already exists at this price/time
      const existingRay = drawings.find((d) => {
        if (d.type !== "horizontalRay" || d.createdBy !== "strategy") return false;
        const ray = d as HorizontalRayDrawing;
        return ray.anchor.price === level.price;
      });

      if (existingRay) {
        createdLevelsRef.current.add(levelKey);
        continue;
      }

      // Create the horizontal ray
      const anchor = {
        timestamp: level.startTime || (candles?.[0]?.timestamp || Date.now()),
        price: level.price,
      };

      createHorizontalRay(pair, timeframe, anchor, {
        color: level.color,
        lineWidth: level.lineWidth,
        lineStyle: level.lineStyle,
        label: level.label,
        createdBy: "strategy",
        strategyId: selectedStrategy || undefined,
        locked: true, // Strategy-generated levels are locked
      });

      createdLevelsRef.current.add(levelKey);
    }
  }, [levels, pair, timeframe, drawings, selectedStrategy, candles]);

  // Drawing keyboard shortcuts (including Ctrl+Z for undo, 1-9 for quick colors, arrows for micro-adjust)
  const deleteSelected = useCallback(() => {
    if (selectedDrawingId) deleteDrawing(selectedDrawingId);
  }, [selectedDrawingId, deleteDrawing]);
  const shortcutOptions = useMemo(() => ({
    drawings,
    updateDrawing,
    pair,
  }), [drawings, updateDrawing, pair]);
  useDrawingKeyboardShortcuts(
    setActiveDrawingTool,
    deleteSelected,
    selectedDrawingId,
    undo,
    shortcutOptions
  );

  // Handle indicator toggle
  const handleIndicatorToggle = useCallback((indicatorId: string, visible: boolean) => {
    setIndicatorVisibility((prev) => ({
      ...prev,
      [indicatorId]: visible,
    }));
  }, []);

  // Transform indicator configs to toggle format for sidebar
  const indicatorToggles = useMemo(() => {
    return indicatorConfigs.map((config) => ({
      id: config.id,
      type: config.type,
      label: `${config.type.toUpperCase()}(${config.params.period || ''})`,
      color: config.style.color,
      visible: indicatorVisibility[config.id] ?? false, // Off by default
    }));
  }, [indicatorConfigs, indicatorVisibility]);

  // Filter indicators based on visibility for chart rendering
  const visibleIndicatorSeries = useMemo(() => {
    return indicatorSeries.filter((series) => indicatorVisibility[series.id] === true);
  }, [indicatorSeries, indicatorVisibility]);

  const visibleIndicatorConfigs = useMemo(() => {
    return indicatorConfigs.filter((config) => indicatorVisibility[config.id] === true);
  }, [indicatorConfigs, indicatorVisibility]);

  // Filter drawings: strategy signals only show when that strategy is selected
  // Taken trades (status !== "signal") persist regardless of strategy selection
  const filteredDrawings = useMemo(() => {
    if (!drawings) return [];

    return drawings.filter((drawing) => {
      // Non-strategy drawings always show
      if (drawing.createdBy !== "strategy") return true;

      // For strategy-created drawings:
      // Check if it's a position with status
      const isPosition = drawing.type === "longPosition" || drawing.type === "shortPosition";
      if (isPosition) {
        const position = drawing as PositionDrawing;
        // Taken trades (not signals) always show
        if (position.status !== "signal") return true;
        // Signals only show if their strategy is selected
        return position.strategyId === selectedStrategy;
      }

      // Horizontal rays (levels) only show when their strategy is selected
      if (drawing.type === "horizontalRay") {
        return drawing.strategyId === selectedStrategy;
      }

      // Other strategy drawings: only show when strategy is selected
      return drawing.strategyId === selectedStrategy;
    });
  }, [drawings, selectedStrategy]);

  // Chat persistence hook — must be after filteredDrawings and livePrice are defined
  const chatContext = useMemo(() => ({
    pair,
    timeframe,
    currentPrice: livePrice?.mid ?? null,
    drawings: filteredDrawings,
    convexToken,
  }), [pair, timeframe, livePrice?.mid, filteredDrawings, convexToken]);

  const {
    sendMessage: chatSendMessage,
    switchConversation,
    deleteConversation: chatDeleteConversation,
    renameConversation,
    newConversation: chatNewConversation,
    conversations,
  } = useChat(chatContext);

  // Format pair for display (EUR_USD -> EUR/USD)
  const displayPair = pair.replace("_", "/");

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>

          {/* Chat toggle */}
          <button
            onClick={toggleChat}
            className={`p-1.5 rounded transition-colors ${
              chatOpen
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
            title="Toggle Claude chat (⌘L)"
          >
            <MessageSquare className="w-4 h-4" />
          </button>

          {/* Alert bell */}
          <AlertBell
            unreadCount={unreadCount}
            recentAlerts={recentAlerts}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onOpenPreferences={() => setAlertPrefsOpen(true)}
          />

          <h1 className="text-xl font-semibold">{displayPair}</h1>
          {livePrice && (
            <span className="text-lg font-mono text-gray-200">
              {livePrice.mid.toFixed(5)}
            </span>
          )}
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              status === "connected" ? "bg-green-500" :
              status === "connecting" ? "bg-yellow-500 animate-pulse" :
              status === "market_closed" ? "bg-gray-500" :
              "bg-red-500"
            }`} />
            <span className="text-gray-400">
              {status === "connected" && "Live"}
              {status === "connecting" && "Connecting..."}
              {status === "disconnected" && "Disconnected"}
              {status === "market_closed" && "Market Closed"}
              {status === "error" && "Error"}
            </span>
            {currentSession !== "closed" && (
              <span className="text-gray-500 capitalize">
                ({currentSession})
              </span>
            )}
            {status === "market_closed" && nextOpen && (
              <span className="text-gray-500">
                · Opens in {nextOpen}
              </span>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Timeframe buttons */}
          <div className="flex items-center gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => switchTimeframe(tf)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  timeframe === tf
                    ? "bg-blue-600 text-white"
                    : prefetchedTimeframes.includes(tf)
                    ? "text-gray-300 hover:text-gray-100 hover:bg-gray-800" // Cached - ready
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
                title={prefetchedTimeframes.includes(tf) ? "Cached" : "Will load on click"}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Go to present button */}
          <button
            onClick={() => resetViewFn?.()}
            className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Go to present"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* User Menu */}
          <div className="ml-4 flex items-center">
            <SignedIn>
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-7 h-7",
                  },
                }}
              />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>
      </header>

      {/* Main content: chat sidebar + resizable chart/sidebar */}
      <main className="flex-1 min-h-0 flex">
        {/* Chat Panel — outside PanelGroup to avoid conditional-panel layout bugs */}
        {chatOpen && (
          <div className="h-full flex-shrink-0 w-[350px] min-w-[280px] max-w-[500px] resize-x overflow-hidden border-r border-gray-700">
            <ChatPanel
              context={chatContext}
              onClose={closeChat}
              conversations={conversations}
              onSwitchConversation={switchConversation}
              onDeleteConversation={chatDeleteConversation}
              onRenameConversation={renameConversation}
              onNewConversation={chatNewConversation}
              onSendMessage={chatSendMessage}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 h-full">
        <PanelGroup orientation="horizontal" className="h-full">
          {/* Chart Panel */}
          <Panel id="chart" defaultSize="80%" minSize="40%">
            <div className="h-full w-full relative flex">
              {/* Drawing Toolbar - Left Sidebar */}
              <DrawingToolbar
                activeDrawingTool={activeDrawingTool}
                onToolSelect={setActiveDrawingTool}
                onClearAll={clearAllDrawings}
                drawingCount={drawingCount}
              />
              {/* Chart with left padding for toolbar */}
              <div className="flex-1 h-full pl-11 relative">
              {/* Live Position Overlay */}
              <LivePositionsContainer
                positions={openPositions}
                pair={pair}
                currentPrice={livePrice?.mid ?? null}
                onClose={handleClosePosition}
                onSnapshot={handlePositionSnapshot}
              />
              <Chart
                pair={pair}
                timeframe={timeframe}
                magnetMode={magnetMode}
                showSessionBgs={showSessionBgs}
                showSessionLines={showSessionLines}
                showSessionLabels={showSessionLabels}
                showNews={showNews}
                livePrice={livePrice}
                onResetViewReady={handleResetViewReady}
                onScrollToTimestampReady={handleScrollToTimestampReady}
                onEventSelect={handleEventSelect}
                // External candle management from cache
                candles={candles}
                candlesLoading={candlesLoading}
                isLoadingMore={isLoadingMore}
                hasMoreHistory={hasMoreHistory}
                loadMoreHistory={loadMoreHistory}
                // Strategy indicators (only visible ones)
                indicatorSeries={visibleIndicatorSeries}
                indicatorConfigs={visibleIndicatorConfigs}
                // Strategy markers and zones
                strategyMarkers={markers}
                strategyZones={zones}
                // Drawing tools
                activeDrawingTool={activeDrawingTool}
                drawings={filteredDrawings}
                selectedDrawingId={selectedDrawingId}
                onDrawingCreate={createDrawing}
                onDrawingSelect={selectDrawing}
                onDrawingUpdate={updateDrawing}
                onDrawingDelete={deleteDrawing}
                // Trades data for position exits (source of truth)
                tradesMap={tradesMap}
                // Visible range for snapshot capture
                onVisibleRangeChange={handleVisibleRangeChange}
                // Market structure overlays
                structureData={structureData}
                showSwingLabels={showSwingLabels}
                showBOSLines={showBOSLines}
                showKeyLevels={showKeyLevels}
                showSweeps={showSweeps}
                showFVGs={showFVGs}
                fvgTierFilter={fvgTierFilter}
                showPremiumDiscount={showPremiumDiscount}
              />
              </div>
            </div>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-2 bg-gray-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

          {/* Sidebar Panel */}
          <Panel id="sidebar" defaultSize="20%" minSize="15%" maxSize="40%">
            <div className="h-full w-full">
              {selectedEvent ? (
                <NewsEventPanel
                  event={selectedEvent}
                  allEventsAtTimestamp={allEventsAtTimestamp}
                  pair={pair}
                  onClose={handleCloseEventPanel}
                  onNavigate={handleNavigateEvent}
                />
              ) : (
                <ChartSidebar
                  currentPair={pair}
                  currentTimeframe={timeframe}
                  magnetMode={magnetMode}
                  onMagnetModeChange={setMagnetMode}
                  showSessionBgs={showSessionBgs}
                  onShowSessionBgsChange={setShowSessionBgs}
                  showSessionLines={showSessionLines}
                  onShowSessionLinesChange={setShowSessionLines}
                  showSessionLabels={showSessionLabels}
                  onShowSessionLabelsChange={setShowSessionLabels}
                  showNews={showNews}
                  onShowNewsChange={setShowNews}
                  strategies={strategies}
                  selectedStrategy={selectedStrategy}
                  onStrategyChange={setSelectedStrategy}
                  indicators={indicatorToggles}
                  onIndicatorToggle={handleIndicatorToggle}
                  onDrawingSelect={selectDrawing}
                  onScrollToTimestamp={scrollToTimestampFn || undefined}
                  // Market structure toggles (wrapped to persist prefs)
                  showSwingLabels={showSwingLabels}
                  onShowSwingLabelsChange={handleSetShowSwingLabels}
                  showBOSLines={showBOSLines}
                  onShowBOSLinesChange={handleSetShowBOSLines}
                  showKeyLevels={showKeyLevels}
                  onShowKeyLevelsChange={handleSetShowKeyLevels}
                  showSweeps={showSweeps}
                  onShowSweepsChange={handleSetShowSweeps}
                  showFVGs={showFVGs}
                  onShowFVGsChange={handleSetShowFVGs}
                  fvgTierFilter={fvgTierFilter}
                  onFVGTierFilterChange={handleSetFVGTierFilter}
                  showPremiumDiscount={showPremiumDiscount}
                  onShowPremiumDiscountChange={handleSetShowPremiumDiscount}
                  structureData={structureData}
                  currentPrice={livePrice?.mid ?? null}
                />
              )}
            </div>
          </Panel>
        </PanelGroup>
        </div>
      </main>

      {/* Close Trade Modal */}
      {closingPosition && (
        <CloseTradeModal
          position={closingPosition}
          pair={pair}
          currentPrice={livePrice?.mid ?? null}
          onConfirm={handleCloseTradeConfirm}
          onClose={() => setClosingPosition(null)}
        />
      )}

      {/* Toast notifications */}
      <ToastContainer />

      {/* Alert preferences modal */}
      <AlertPreferencesModal
        open={alertPrefsOpen}
        onClose={() => setAlertPrefsOpen(false)}
        preferences={alertPrefs ?? null}
      />
    </div>
  );
}
