"use client";

import { useState, useEffect, useRef } from "react";
import { X, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { PositionDrawing } from "@/lib/drawings/types";

interface TakeTradeModalProps {
  position: PositionDrawing;
  currentPrice?: number;
  onConfirm: (options: TakeTradeOptions) => void;
  onDismiss: () => void;
  onClose: () => void;
}

export interface TakeTradeOptions {
  entryType: "market" | "limit";
  positionSize?: number;
  customEntry?: number;
  actualEntryPrice?: number;
  entryReason?: "limit" | "market";
}

/**
 * Modal for confirming a strategy signal as an actual trade
 */
export function TakeTradeModal({
  position,
  currentPrice,
  onConfirm,
  onDismiss,
  onClose,
}: TakeTradeModalProps) {
  const [entryType, setEntryType] = useState<"market" | "limit">("limit");
  const [positionSize, setPositionSize] = useState<string>("");
  const modalRef = useRef<HTMLDivElement>(null);

  const isLong = position.type === "longPosition";
  const entryPrice = position.entry.price;
  const stopLoss = position.stopLoss;
  const takeProfit = position.takeProfit;

  // Calculate risk/reward
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - entryPrice);
  const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

  // Calculate pip values (assuming 5-digit pricing for forex)
  const pipMultiplier = entryPrice < 10 ? 10000 : 100;
  const slPips = slDistance * pipMultiplier;
  const tpPips = tpDistance * pipMultiplier;

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Slippage preview for market entry
  const slippagePips = entryType === "market" && currentPrice
    ? Math.abs(currentPrice - entryPrice) * pipMultiplier
    : 0;

  const handleConfirm = () => {
    const actualPrice = entryType === "market" && currentPrice ? currentPrice : entryPrice;
    onConfirm({
      entryType,
      positionSize: positionSize ? parseFloat(positionSize) : undefined,
      customEntry: entryType === "market" && currentPrice ? currentPrice : undefined,
      actualEntryPrice: actualPrice,
      entryReason: entryType === "market" ? "market" : "limit",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-modal>
      <div
        ref={modalRef}
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-[400px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-2">
            {isLong ? (
              <TrendingUp className="w-5 h-5 text-green-500" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-500" />
            )}
            <span className="text-white font-medium">Confirm Trade Entry</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Trade Details */}
        <div className="p-4 space-y-4">
          {/* Direction Badge */}
          <div className="flex items-center justify-center">
            <span
              className={`px-4 py-2 rounded-lg text-lg font-bold ${
                isLong
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
              }`}
            >
              {isLong ? "LONG" : "SHORT"}
            </span>
          </div>

          {/* Price Levels */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Entry</div>
              <div className="text-white font-mono">{entryPrice.toFixed(5)}</div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
              <div className="text-xs text-green-400 mb-1">Take Profit</div>
              <div className="text-green-400 font-mono">{takeProfit.toFixed(5)}</div>
              <div className="text-xs text-green-400/70">+{tpPips.toFixed(1)} pips</div>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="text-xs text-red-400 mb-1">Stop Loss</div>
              <div className="text-red-400 font-mono">{stopLoss.toFixed(5)}</div>
              <div className="text-xs text-red-400/70">-{slPips.toFixed(1)} pips</div>
            </div>
          </div>

          {/* Risk/Reward */}
          <div className="flex items-center justify-center gap-2 py-2">
            <span className="text-gray-400">Risk/Reward:</span>
            <span className={`font-bold ${rrRatio >= 2 ? "text-green-400" : rrRatio >= 1 ? "text-yellow-400" : "text-red-400"}`}>
              1:{rrRatio.toFixed(2)}
            </span>
          </div>

          {/* Entry Type Selection */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Entry Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEntryType("limit")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  entryType === "limit"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                Limit @ Signal Price
              </button>
              <button
                onClick={() => setEntryType("market")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  entryType === "market"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                Market (Now)
              </button>
            </div>
            {entryType === "market" && currentPrice && (
              <div className="text-xs text-amber-400 flex items-center gap-1 mt-1">
                <AlertTriangle className="w-3 h-3" />
                Market price: {currentPrice.toFixed(5)}
                {slippagePips > 0.1 && (
                  <span className="text-amber-400/70 ml-1">
                    ({slippagePips.toFixed(1)} pips from signal)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Position Size */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Position Size (optional)</label>
            <input
              type="number"
              value={positionSize}
              onChange={(e) => setPositionSize(e.target.value)}
              placeholder="e.g., 0.01 lots"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-gray-700 bg-gray-800/30">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Dismiss Signal
          </button>
          <button
            onClick={handleConfirm}
            className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              isLong
                ? "bg-green-600 hover:bg-green-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            Confirm Entry
          </button>
        </div>
      </div>
    </div>
  );
}
