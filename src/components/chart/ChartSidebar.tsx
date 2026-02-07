"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useDrawingStore } from "@/lib/drawings/store";
import { Drawing, isPositionDrawing, isFibonacciDrawing, isRectangleDrawing, isTrendlineDrawing, isHorizontalLineDrawing, isHorizontalRayDrawing, isVerticalLineDrawing, isCircleDrawing } from "@/lib/drawings/types";
import { PAIRS_BY_CATEGORY, formatPrice } from "@/lib/pairs";
import { InstitutionalPanel } from "./InstitutionalPanel";

// Stable empty array to prevent infinite re-renders with Zustand SSR

interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

interface UpcomingEvent {
  eventId: string;
  name: string;
  currency: string;
  impact: string;
  timestamp: number;
  datetimeLondon: string | null;
}

interface Strategy {
  id: string;
  name: string;
  version: string;
  summary: string;
}

interface IndicatorToggle {
  id: string;
  type: string;
  label: string;
  color: string;
  visible: boolean;
}

type SidebarTab = "pairs" | "drawings" | "institutional";

interface ChartSidebarProps {
  currentPair: string;
  currentTimeframe: string;
  magnetMode: boolean;
  onMagnetModeChange: (value: boolean) => void;
  showSessionBgs: boolean;
  onShowSessionBgsChange: (value: boolean) => void;
  showSessionLines: boolean;
  onShowSessionLinesChange: (value: boolean) => void;
  showSessionLabels: boolean;
  onShowSessionLabelsChange: (value: boolean) => void;
  showNews: boolean;
  onShowNewsChange: (value: boolean) => void;
  strategies?: Strategy[];
  selectedStrategy?: string | null;
  onStrategyChange?: (strategyId: string | null) => void;
  // Indicator toggles
  indicators?: IndicatorToggle[];
  onIndicatorToggle?: (indicatorId: string, visible: boolean) => void;
  // Drawing selection callback
  onDrawingSelect?: (drawingId: string) => void;
  // Scroll chart to timestamp
  onScrollToTimestamp?: (timestamp: number) => void;
}

// Format countdown until event
function formatCountdown(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;

  if (diff <= 0) return "Now";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Format time from London datetime
function formatEventTime(datetimeLondon: string | null, timestamp: number): string {
  if (datetimeLondon) {
    const timePart = datetimeLondon.split(" ")[1];
    if (timePart) {
      return timePart.slice(0, 5) + " UK";
    }
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " UTC";
}

// Get drawing type display info
function getDrawingTypeInfo(drawing: Drawing): { icon: string; label: string; color: string } {
  if (isPositionDrawing(drawing)) {
    const isLong = drawing.type === "longPosition";
    return {
      icon: isLong ? "↑" : "↓",
      label: isLong ? "Long" : "Short",
      color: isLong ? "#26A69A" : "#EF5350",
    };
  }
  if (isFibonacciDrawing(drawing)) {
    return { icon: "◇", label: "Fib", color: "#787B86" };
  }
  if (isRectangleDrawing(drawing)) {
    return { icon: "□", label: "Rectangle", color: drawing.borderColor };
  }
  if (isTrendlineDrawing(drawing)) {
    const typeLabels: Record<string, string> = {
      trendline: "Trendline",
      ray: "Ray",
      arrow: "Arrow",
      extendedLine: "Extended",
    };
    return { icon: "╱", label: typeLabels[drawing.type] || "Line", color: drawing.color };
  }
  if (isHorizontalLineDrawing(drawing)) {
    return { icon: "─", label: "H-Line", color: drawing.color };
  }
  if (isHorizontalRayDrawing(drawing)) {
    return { icon: "→", label: "H-Ray", color: drawing.color };
  }
  if (isVerticalLineDrawing(drawing)) {
    return { icon: "│", label: "V-Line", color: drawing.color };
  }
  if (isCircleDrawing(drawing)) {
    return { icon: "○", label: "Circle", color: drawing.borderColor };
  }
  return { icon: "•", label: drawing.type, color: "#787B86" };
}

// Format drawing price for display
function formatDrawingPrice(price: number): string {
  if (price < 10) return price.toFixed(5);
  if (price < 1000) return price.toFixed(3);
  return price.toFixed(2);
}

export function ChartSidebar({
  currentPair,
  currentTimeframe,
  magnetMode,
  onMagnetModeChange,
  showSessionBgs,
  onShowSessionBgsChange,
  showSessionLines,
  onShowSessionLinesChange,
  showSessionLabels,
  onShowSessionLabelsChange,
  showNews,
  onShowNewsChange,
  strategies = [],
  selectedStrategy,
  onStrategyChange,
  indicators = [],
  onIndicatorToggle,
  onDrawingSelect,
  onScrollToTimestamp,
}: ChartSidebarProps) {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [, setCountdownTick] = useState(0);
  const [activeTab, setActiveTab] = useState<SidebarTab>("pairs");

  // Get drawings from store (cross-timeframe visibility)
  // Use raw state + useMemo to avoid "getSnapshot must be cached" infinite loop
  const allDrawings = useDrawingStore((state) => state.drawings);
  const drawings = useMemo(() => {
    const result: Drawing[] = [];
    const prefix = currentPair + ":";
    for (const key in allDrawings) {
      if (!key.startsWith(prefix)) continue;
      const keyTf = key.slice(prefix.length);
      for (const d of allDrawings[key]) {
        const vis = d.visibility ?? "all";
        if (keyTf === currentTimeframe || vis === "all" || (Array.isArray(vis) && vis.includes(currentTimeframe))) {
          result.push(d);
        }
      }
    }
    return result;
  }, [allDrawings, currentPair, currentTimeframe]);
  const selectedDrawingId = useDrawingStore((state) => state.selectedDrawingId);
  const selectDrawing = useDrawingStore((state) => state.selectDrawing);
  const updateDrawing = useDrawingStore((state) => state.updateDrawing);

  // Drag and drop state for linking drawings to positions
  const [draggedDrawingId, setDraggedDrawingId] = useState<string | null>(null);
  const [dropTargetPositionId, setDropTargetPositionId] = useState<string | null>(null);

  // Group drawings by type, with linked drawings tracked per position
  const groupedDrawings = useMemo(() => {
    const groups: {
      positions: Drawing[];
      linkedByPosition: Record<string, Drawing[]>; // positionId -> linked drawings
      unlinkedFibs: Drawing[];
      unlinkedLines: Drawing[];
      unlinkedShapes: Drawing[];
    } = {
      positions: [],
      linkedByPosition: {},
      unlinkedFibs: [],
      unlinkedLines: [],
      unlinkedShapes: [],
    };

    // First pass: collect positions
    drawings.forEach((d) => {
      if (isPositionDrawing(d)) {
        groups.positions.push(d);
        groups.linkedByPosition[d.id] = [];
      }
    });

    // Second pass: categorize non-positions
    drawings.forEach((d) => {
      if (isPositionDrawing(d)) return; // Already handled

      // Check if linked to a position
      if (d.tradeId && groups.linkedByPosition[d.tradeId]) {
        groups.linkedByPosition[d.tradeId].push(d);
      } else if (isFibonacciDrawing(d)) {
        groups.unlinkedFibs.push(d);
      } else if (isTrendlineDrawing(d) || isHorizontalLineDrawing(d) || isHorizontalRayDrawing(d) || isVerticalLineDrawing(d)) {
        groups.unlinkedLines.push(d);
      } else {
        groups.unlinkedShapes.push(d);
      }
    });

    return groups;
  }, [drawings]);

  // Fetch prices on mount and every 5 seconds
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch("/api/prices");
        if (response.ok) {
          const data = await response.json();
          setPrices(data);
        }
      } catch (error) {
        console.error("Failed to fetch prices:", error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch upcoming events on mount and every minute
  useEffect(() => {
    const fetchUpcoming = async () => {
      try {
        const response = await fetch("/api/news/upcoming?limit=8");
        if (response.ok) {
          const data = await response.json();
          setUpcomingEvents(data.events || []);
        }
      } catch (error) {
        console.error("Failed to fetch upcoming events:", error);
      }
    };

    fetchUpcoming();
    const interval = setInterval(fetchUpcoming, 60000);
    return () => clearInterval(interval);
  }, []);

  // Update countdown every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdownTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Get the primary timestamp from a drawing (where it's located on the chart)
  const getDrawingTimestamp = (drawing: Drawing): number => {
    if (isPositionDrawing(drawing)) {
      return drawing.entry.timestamp;
    }
    if (isHorizontalRayDrawing(drawing)) {
      return drawing.anchor.timestamp;
    }
    if (isVerticalLineDrawing(drawing)) {
      return drawing.timestamp;
    }
    if ("anchor1" in drawing) {
      const d = drawing as { anchor1: { timestamp: number } };
      return d.anchor1.timestamp;
    }
    return drawing.createdAt;
  };

  // Handle drawing click in sidebar - just SELECT (no scroll)
  const handleDrawingClick = (drawing: Drawing) => {
    selectDrawing(drawing.id);
    onDrawingSelect?.(drawing.id);
  };

  // Handle "go to" button - scroll to drawing location
  const handleGoToDrawing = (e: React.MouseEvent, drawing: Drawing) => {
    e.stopPropagation(); // Don't trigger selection
    const timestamp = getDrawingTimestamp(drawing);
    onScrollToTimestamp?.(timestamp);
  };

  // Drag handlers for linking drawings to positions
  const handleDragStart = useCallback((e: React.DragEvent, drawing: Drawing) => {
    if (isPositionDrawing(drawing)) return; // Positions can't be dragged
    setDraggedDrawingId(drawing.id);
    e.dataTransfer.setData("text/plain", drawing.id);
    e.dataTransfer.effectAllowed = "link";
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedDrawingId(null);
    setDropTargetPositionId(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, positionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "link";
    setDropTargetPositionId(positionId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetPositionId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, positionId: string) => {
    e.preventDefault();
    const drawingId = e.dataTransfer.getData("text/plain");
    if (drawingId && drawingId !== positionId) {
      // Link the drawing to this position
      updateDrawing(currentPair, currentTimeframe, drawingId, { tradeId: positionId });
    }
    setDraggedDrawingId(null);
    setDropTargetPositionId(null);
  }, [currentPair, currentTimeframe, updateDrawing]);

  const handleUnlinkDrawing = useCallback((e: React.MouseEvent, drawingId: string) => {
    e.stopPropagation();
    updateDrawing(currentPair, currentTimeframe, drawingId, { tradeId: undefined });
  }, [currentPair, currentTimeframe, updateDrawing]);

  // Format timestamp for display (short date format)
  const formatDrawingDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) {
      return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
    if (isYesterday) {
      return "Yesterday";
    }
    // Show short date for older drawings
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  // Render a single drawing item
  const renderDrawingItem = (drawing: Drawing, indent: boolean = false) => {
    const info = getDrawingTypeInfo(drawing);
    const isSelected = selectedDrawingId === drawing.id;
    const timestamp = getDrawingTimestamp(drawing);
    const isBeingDragged = draggedDrawingId === drawing.id;
    const canDrag = !isPositionDrawing(drawing); // Only non-positions can be dragged

    // Get price info based on drawing type
    let priceInfo = "";
    if (isPositionDrawing(drawing)) {
      priceInfo = formatDrawingPrice(drawing.entry.price);
    } else if (isHorizontalLineDrawing(drawing)) {
      priceInfo = formatDrawingPrice(drawing.price);
    } else if (isHorizontalRayDrawing(drawing)) {
      priceInfo = formatDrawingPrice(drawing.anchor.price);
    } else if ("anchor1" in drawing) {
      const d = drawing as { anchor1: { price: number } };
      priceInfo = formatDrawingPrice(d.anchor1.price);
    }

    return (
      <div
        key={drawing.id}
        className={`flex items-center gap-1 ${indent ? "ml-4" : ""} ${
          isBeingDragged ? "opacity-50" : ""
        }`}
        draggable={canDrag}
        onDragStart={canDrag ? (e) => handleDragStart(e, drawing) : undefined}
        onDragEnd={canDrag ? handleDragEnd : undefined}
      >
        {/* Drag handle for non-positions */}
        {canDrag && (
          <div className="w-4 flex items-center justify-center text-gray-600 cursor-grab active:cursor-grabbing">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
            </svg>
          </div>
        )}
        <button
          onClick={() => handleDrawingClick(drawing)}
          className={`flex-1 flex flex-col gap-0.5 px-2 py-1.5 text-xs rounded transition-colors ${
            isSelected
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-gray-800"
          }`}
          title={canDrag ? `Drag to link to a position\n${new Date(timestamp).toLocaleString()}` : `Click to select\n${new Date(timestamp).toLocaleString()}`}
        >
          <div className="flex items-center gap-2 w-full">
            <span
              className="w-4 text-center font-mono"
              style={{ color: isSelected ? "white" : info.color }}
            >
              {info.icon}
            </span>
            <span className="flex-1 text-left truncate">
              {drawing.label || info.label}
            </span>
            {priceInfo && (
              <span className={`font-mono text-[10px] ${isSelected ? "text-blue-200" : "text-gray-500"}`}>
                {priceInfo}
              </span>
            )}
          </div>
          <div className={`flex items-center gap-2 pl-6 text-[10px] ${isSelected ? "text-blue-200" : "text-gray-500"}`}>
            <span>{formatDrawingDate(timestamp)}</span>
          </div>
        </button>
        {/* Unlink button for linked drawings */}
        {indent && drawing.tradeId && (
          <button
            onClick={(e) => handleUnlinkDrawing(e, drawing.id)}
            className="p-1 rounded text-gray-500 hover:text-orange-400 hover:bg-gray-700 transition-colors"
            title="Unlink from position"
          >
            {/* Broken link icon */}
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16" />
            </svg>
          </button>
        )}
        {/* Go To button */}
        <button
          onClick={(e) => handleGoToDrawing(e, drawing)}
          className={`p-1.5 rounded transition-colors ${
            isSelected
              ? "text-blue-200 hover:text-white hover:bg-blue-500"
              : "text-gray-500 hover:text-gray-300 hover:bg-gray-700"
          }`}
          title="Go to drawing"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      </div>
    );
  };

  // Render drawings group
  const renderDrawingsGroup = (title: string, drawingsList: Drawing[]) => {
    if (drawingsList.length === 0) return null;
    return (
      <div className="mb-3">
        <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2">
          {title}
        </h4>
        <div className="space-y-0.5">
          {drawingsList.map((d) => renderDrawingItem(d))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full bg-gray-900 border-l border-gray-800 flex">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Pairs Tab Content */}
        {activeTab === "pairs" && (
          <>
            {/* Pairs Section */}
            <div className="p-3 border-b border-gray-800 flex-1 overflow-y-auto">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Pairs
              </h3>
              <div className="space-y-3">
                {PAIRS_BY_CATEGORY.map((category) => (
                  <div key={category.key}>
                    <h4 className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-1 px-2">
                      {category.label}
                    </h4>
                    <div className="space-y-0.5">
                      {category.pairs.map((pair) => {
                        const priceData = prices[pair.id];
                        const isActive = currentPair === pair.id;
                        const isPositive = priceData && priceData.changePercent > 0;
                        const isNegative = priceData && priceData.changePercent < 0;

                        return (
                          <Link
                            key={pair.id}
                            href={`/chart/${pair.id}`}
                            className={`flex items-center justify-between px-2 py-1.5 text-sm rounded transition-colors ${
                              isActive
                                ? "bg-blue-600 text-white"
                                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                            }`}
                          >
                            <span className="font-medium">{pair.name}</span>
                            {priceData && (
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className={`font-mono ${isActive ? "text-white" : "text-gray-300"}`}>
                                  {formatPrice(pair.id, priceData.price)}
                                </span>
                                <span
                                  className={`${
                                    isActive
                                      ? isPositive
                                        ? "text-green-300"
                                        : isNegative
                                        ? "text-red-300"
                                        : "text-gray-300"
                                      : isPositive
                                      ? "text-green-500"
                                      : isNegative
                                      ? "text-red-500"
                                      : "text-gray-500"
                                  }`}
                                >
                                  {isPositive ? "▲" : isNegative ? "▼" : "─"}
                                </span>
                              </div>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Events Section */}
            {upcomingEvents.length > 0 && (
              <div className="p-3 border-b border-gray-800">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Upcoming Events
                </h3>
                <div className="space-y-1.5">
                  {upcomingEvents.slice(0, 6).map((event) => {
                    const isImminent = event.timestamp - Date.now() < 60 * 60 * 1000;
                    const isVeryClose = event.timestamp - Date.now() < 15 * 60 * 1000;

                    return (
                      <div
                        key={event.eventId}
                        className={`px-2 py-1.5 rounded text-xs ${
                          isVeryClose
                            ? "bg-red-900/40 border border-red-800/50"
                            : isImminent
                            ? "bg-amber-900/30 border border-amber-800/30"
                            : "bg-gray-800/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                event.impact === "High" ? "bg-red-500" : "bg-amber-500"
                              }`}
                            />
                            <span className="text-gray-300 truncate">{event.name}</span>
                          </div>
                          <span className="text-gray-500 flex-shrink-0">{event.currency}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-gray-500">
                          <span>{formatEventTime(event.datetimeLondon, event.timestamp)}</span>
                          <span
                            className={`font-medium ${
                              isVeryClose
                                ? "text-red-400"
                                : isImminent
                                ? "text-amber-400"
                                : "text-gray-400"
                            }`}
                          >
                            {formatCountdown(event.timestamp)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Controls Section */}
            <div className="p-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Controls
              </h3>
              <div className="space-y-2">
                {/* News & Magnet toggles */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onShowNewsChange(!showNews)}
                    className={`flex-1 px-2 py-2 text-xs rounded transition-colors ${
                      showNews
                        ? "bg-red-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    News
                  </button>
                  <button
                    onClick={() => onMagnetModeChange(!magnetMode)}
                    className={`flex-1 px-2 py-2 text-xs rounded transition-colors ${
                      magnetMode
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Magnet
                  </button>
                </div>

                {/* Sessions toggles - 3 separate controls */}
                <div className="mt-3">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Sessions</span>
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={() => onShowSessionBgsChange(!showSessionBgs)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                        showSessionBgs
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                      title="Session background colors"
                    >
                      BGs
                    </button>
                    <button
                      onClick={() => onShowSessionLinesChange(!showSessionLines)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                        showSessionLines
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                      title="Session H/L lines"
                    >
                      Lines
                    </button>
                    <button
                      onClick={() => onShowSessionLabelsChange(!showSessionLabels)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                        showSessionLabels
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                      title="Session H/L labels"
                    >
                      Labels
                    </button>
                  </div>
                </div>

                {/* Strategy Section */}
                {strategies.length > 0 && onStrategyChange && (
                  <div className="mt-3">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Strategy</span>
                    <select
                      value={selectedStrategy || ""}
                      onChange={(e) => onStrategyChange(e.target.value || null)}
                      className="w-full mt-1 px-2 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value="">None</option>
                      {strategies.map((strategy) => (
                        <option key={strategy.id} value={strategy.id}>
                          {strategy.name}
                        </option>
                      ))}
                    </select>
                    {selectedStrategy && (
                      <div className="mt-1.5 px-2 py-1.5 bg-purple-900/20 border border-purple-800/30 rounded">
                        <div className="text-xs text-purple-300">
                          {strategies.find((s) => s.id === selectedStrategy)?.summary}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Indicators Section */}
                {indicators.length > 0 && onIndicatorToggle && (
                  <div className="mt-3">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Indicators</span>
                    <div className="mt-1.5 space-y-1">
                      {indicators.map((indicator) => (
                        <button
                          key={indicator.id}
                          onClick={() => onIndicatorToggle(indicator.id, !indicator.visible)}
                          className={`w-full flex items-center justify-between px-2 py-1.5 text-xs rounded transition-colors ${
                            indicator.visible
                              ? "bg-gray-700 text-white"
                              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-0.5 rounded-full"
                              style={{ backgroundColor: indicator.color }}
                            />
                            <span>{indicator.label}</span>
                          </div>
                          <span
                            className={`text-[10px] font-medium ${
                              indicator.visible ? "text-green-400" : "text-gray-500"
                            }`}
                          >
                            {indicator.visible ? "ON" : "OFF"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Drawings Tab Content */}
        {activeTab === "drawings" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-800">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Drawings
              </h3>
              <p className="text-[10px] text-gray-600 mt-0.5">
                {drawings.length} on {currentPair} {currentTimeframe}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {drawings.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs">
                  No drawings on this chart
                </div>
              ) : (
                <>
                  {/* Positions with linked drawings */}
                  {groupedDrawings.positions.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 px-2">
                        Positions {draggedDrawingId && <span className="text-purple-400 normal-case">(drop to link)</span>}
                      </h4>
                      <div className="space-y-1">
                        {groupedDrawings.positions.map((position) => {
                          const linkedDrawings = groupedDrawings.linkedByPosition[position.id] || [];
                          const isDropTarget = dropTargetPositionId === position.id;
                          return (
                            <div
                              key={position.id}
                              onDragOver={draggedDrawingId ? (e) => handleDragOver(e, position.id) : undefined}
                              onDragLeave={draggedDrawingId ? handleDragLeave : undefined}
                              onDrop={draggedDrawingId ? (e) => handleDrop(e, position.id) : undefined}
                              className={`rounded transition-all ${
                                isDropTarget
                                  ? "bg-purple-500/20 ring-2 ring-purple-500 ring-inset"
                                  : draggedDrawingId
                                  ? "bg-gray-800/50"
                                  : ""
                              }`}
                            >
                              {renderDrawingItem(position)}
                              {/* Linked drawings (indented) */}
                              {linkedDrawings.length > 0 && (
                                <div className="space-y-0.5 mt-0.5 border-l-2 border-gray-700 ml-4">
                                  {linkedDrawings.map((d) => renderDrawingItem(d, true))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Unlinked drawings */}
                  {renderDrawingsGroup("Fibonacci", groupedDrawings.unlinkedFibs)}
                  {renderDrawingsGroup("Lines", groupedDrawings.unlinkedLines)}
                  {renderDrawingsGroup("Shapes", groupedDrawings.unlinkedShapes)}
                </>
              )}
            </div>
          </div>
        )}

        {/* Institutional Tab Content */}
        {activeTab === "institutional" && (
          <InstitutionalPanel currentPair={currentPair} />
        )}
      </div>

      {/* Icon Column (Right Side) */}
      <div className="w-10 bg-gray-950 border-l border-gray-800 flex flex-col items-center py-2 gap-1">
        {/* Pairs Tab Icon */}
        <button
          onClick={() => setActiveTab("pairs")}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            activeTab === "pairs"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          }`}
          title="Pairs & Controls"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </button>

        {/* Drawings Tab Icon */}
        <button
          onClick={() => setActiveTab("drawings")}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors relative ${
            activeTab === "drawings"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          }`}
          title="Drawings"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          {/* Drawing count badge */}
          {drawings.length > 0 && activeTab !== "drawings" && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-[9px] text-white rounded-full flex items-center justify-center">
              {drawings.length > 9 ? "9+" : drawings.length}
            </span>
          )}
        </button>

        {/* Institutional Tab Icon */}
        <button
          onClick={() => setActiveTab("institutional")}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            activeTab === "institutional"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          }`}
          title="Institutional Positioning (COT)"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
