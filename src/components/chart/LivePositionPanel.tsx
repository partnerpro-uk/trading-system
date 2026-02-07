"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, X, ChevronDown, ChevronUp, Camera } from "lucide-react";
import { PositionDrawing } from "@/lib/drawings/types";
import {
  useLivePositionPnL,
  formatPnL,
  getPnLColorClass,
} from "@/hooks/useLivePositionPnL";

interface LivePositionPanelProps {
  position: PositionDrawing;
  pair: string;
  currentPrice: number | null;
  onClose?: (positionId: string) => void;
  onSnapshot?: (positionId: string) => void;
  onCollapse?: () => void;
  isCollapsed?: boolean;
}

/**
 * Format price with appropriate decimals
 */
function formatPrice(price: number, pair: string): string {
  const isJPY = pair.includes("JPY");
  return price.toFixed(isJPY ? 3 : 5);
}

/**
 * Floating panel showing live trade information
 */
export function LivePositionPanel({
  position,
  pair,
  currentPrice,
  onClose,
  onSnapshot,
  onCollapse,
  isCollapsed = false,
}: LivePositionPanelProps) {
  const [snapshotting, setSnapshotting] = useState(false);
  const pnlData = useLivePositionPnL(position, currentPrice);
  const isLong = position.type === "longPosition";

  if (!pnlData || currentPrice === null) {
    return null;
  }

  const { pnlPoints, pnlPips, pnlPercent, isProfit, distanceToTP, distanceToSL, tpProgress } = pnlData;

  // Calculate pip multiplier
  const pipMultiplier = position.entry.price < 10 ? 10000 : 100;

  // Distance in pips
  const distanceToTPPips = distanceToTP * pipMultiplier;
  const distanceToSLPips = distanceToSL * pipMultiplier;

  if (isCollapsed) {
    return (
      <div
        className="bg-gray-900/95 border border-gray-700 rounded-lg shadow-2xl overflow-hidden cursor-pointer hover:border-gray-600 transition-colors"
        onClick={onCollapse}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className={`w-2 h-2 rounded-full ${isProfit ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
          <span className="text-xs text-gray-400">{pair.replace("_", "/")}</span>
          <span className={`text-sm font-mono font-bold ${getPnLColorClass(isProfit)}`}>
            {formatPnL(pnlPips)} pips
          </span>
          <ChevronUp className="w-4 h-4 text-gray-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/95 border border-gray-700 rounded-lg shadow-2xl overflow-hidden min-w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isProfit ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
          <span className="text-xs font-bold text-amber-400">LIVE TRADE</span>
        </div>
        <div className="flex items-center gap-1">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Trade Info */}
      <div className="p-3 space-y-3">
        {/* Direction and pair */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isLong ? (
              <TrendingUp className="w-5 h-5 text-green-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
            <span className="font-medium text-white">
              {pair.replace("_", "/")} {isLong ? "LONG" : "SHORT"}
            </span>
          </div>
          <span className="text-xs text-gray-400">
            @ {formatPrice(position.entry.price, pair)}
          </span>
        </div>

        {/* Current price and P&L */}
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Current Price</span>
            <span className="font-mono text-white">{formatPrice(currentPrice, pair)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">P&L</span>
            <div className="text-right">
              <span className={`font-mono font-bold ${getPnLColorClass(isProfit)}`}>
                {formatPnL(pnlPips)} pips
              </span>
              <span className={`text-xs ml-2 ${getPnLColorClass(isProfit)}`}>
                ({formatPnL(pnlPercent, 2)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-red-400">SL</span>
            <span className="text-gray-400">Entry</span>
            <span className="text-green-400">TP</span>
          </div>
          <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
            {/* SL zone (red) */}
            <div className="absolute left-0 h-full bg-red-500/30" style={{ width: "50%" }} />
            {/* TP zone (green) */}
            <div className="absolute right-0 h-full bg-green-500/30" style={{ width: "50%" }} />
            {/* Current position marker */}
            <div
              className={`absolute top-0 h-full w-1 ${isProfit ? "bg-green-500" : "bg-red-500"} transition-all`}
              style={{
                left: `${50 + (tpProgress / 2)}%`,
                transform: "translateX(-50%)",
              }}
            />
            {/* Entry marker */}
            <div className="absolute top-0 h-full w-0.5 bg-blue-500" style={{ left: "50%" }} />
          </div>
        </div>

        {/* TP and SL distances */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-green-500/10 border border-green-500/20 rounded px-2 py-1">
            <div className="text-green-400 font-medium">TP @ {formatPrice(position.takeProfit, pair)}</div>
            <div className="text-gray-400">
              {distanceToTPPips > 0 ? `${distanceToTPPips.toFixed(1)} pips to go` : "Target reached!"}
            </div>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <div className="text-red-400 font-medium">SL @ {formatPrice(position.stopLoss, pair)}</div>
            <div className="text-gray-400">
              {distanceToSLPips > 0 ? `${distanceToSLPips.toFixed(1)} pips buffer` : "Stop triggered!"}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {onSnapshot && (
            <button
              onClick={async () => {
                setSnapshotting(true);
                onSnapshot(position.id);
                setTimeout(() => setSnapshotting(false), 1500);
              }}
              disabled={snapshotting}
              className="flex-1 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              {snapshotting ? "Saved" : "Snapshot"}
            </button>
          )}
          {onClose && (
            <button
              onClick={() => onClose(position.id)}
              className="flex-1 py-2 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Close Trade
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Container for multiple live positions
 */
interface LivePositionsContainerProps {
  positions: PositionDrawing[];
  pair: string;
  currentPrice: number | null;
  onClose?: (positionId: string) => void;
  onSnapshot?: (positionId: string) => void;
  className?: string;
}

export function LivePositionsContainer({
  positions,
  pair,
  currentPrice,
  onClose,
  onSnapshot,
  className,
}: LivePositionsContainerProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Filter to only live positions (open or pending)
  const livePositions = positions.filter(
    (p) => p.status === "open" || p.status === "pending"
  );

  if (livePositions.length === 0) {
    return null;
  }

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className={className ?? "absolute top-4 right-4 z-30 space-y-2"}>
      {livePositions.map((position) => (
        <LivePositionPanel
          key={position.id}
          position={position}
          pair={pair}
          currentPrice={currentPrice}
          onClose={onClose}
          onSnapshot={onSnapshot}
          onCollapse={() => toggleCollapse(position.id)}
          isCollapsed={collapsedIds.has(position.id)}
        />
      ))}
    </div>
  );
}
