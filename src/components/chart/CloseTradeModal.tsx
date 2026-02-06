"use client";

import { useState, useEffect, useRef } from "react";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import { PositionDrawing } from "@/lib/drawings/types";
import {
  useLivePositionPnL,
  formatPnL,
  getPnLColorClass,
} from "@/hooks/useLivePositionPnL";

type CloseReason =
  | "manual_profit"
  | "manual_loss"
  | "breakeven"
  | "emotional"
  | "news"
  | "thesis_broken"
  | "timeout"
  | "other";

export interface CloseTradeResult {
  exitPrice: number;
  closeReason: CloseReason;
  closeReasonNote?: string;
}

interface CloseTradeModalProps {
  position: PositionDrawing;
  pair: string;
  currentPrice: number | null;
  onConfirm: (result: CloseTradeResult) => void;
  onClose: () => void;
}

const CLOSE_REASONS: { value: CloseReason; label: string; row: 1 | 2 }[] = [
  { value: "manual_profit", label: "Take Profit", row: 1 },
  { value: "manual_loss", label: "Cut Loss", row: 1 },
  { value: "breakeven", label: "Break Even", row: 1 },
  { value: "thesis_broken", label: "Thesis Broken", row: 2 },
  { value: "news", label: "News Coming", row: 2 },
  { value: "emotional", label: "Emotional", row: 2 },
  { value: "timeout", label: "Timeout", row: 2 },
  { value: "other", label: "Other", row: 2 },
];

function formatPrice(price: number, pair: string): string {
  const isJPY = pair.includes("JPY");
  return price.toFixed(isJPY ? 3 : 5);
}

export function CloseTradeModal({
  position,
  pair,
  currentPrice,
  onConfirm,
  onClose,
}: CloseTradeModalProps) {
  const [exitPriceStr, setExitPriceStr] = useState(
    currentPrice ? formatPrice(currentPrice, pair) : ""
  );
  const [closeReason, setCloseReason] = useState<CloseReason | null>(null);
  const [note, setNote] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  const isLong = position.type === "longPosition";
  const entryPrice = position.entry.price;
  const exitPrice = parseFloat(exitPriceStr) || 0;

  // Calculate P&L based on entered exit price
  const pipMultiplier = pair.includes("JPY") ? 100 : 10000;
  const pnlPips = isLong
    ? (exitPrice - entryPrice) * pipMultiplier
    : (entryPrice - exitPrice) * pipMultiplier;
  const isProfit = pnlPips >= 0;

  // Live P&L for display
  const pnlData = useLivePositionPnL(position, currentPrice);

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

  // Auto-suggest close reason based on P&L
  useEffect(() => {
    if (closeReason) return; // Don't override user selection
    if (!exitPrice) return;
    const tolerance = pair.includes("JPY") ? 0.01 : 0.0001;
    if (Math.abs(exitPrice - position.takeProfit) < tolerance) {
      setCloseReason("manual_profit");
    } else if (Math.abs(exitPrice - position.stopLoss) < tolerance) {
      setCloseReason("manual_loss");
    }
  }, [exitPrice, position.takeProfit, position.stopLoss, pair, closeReason]);

  const handleConfirm = () => {
    if (!exitPrice || !closeReason) return;
    onConfirm({
      exitPrice,
      closeReason,
      closeReasonNote: note.trim() || undefined,
    });
  };

  const row1 = CLOSE_REASONS.filter((r) => r.row === 1);
  const row2 = CLOSE_REASONS.filter((r) => r.row === 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-modal>
      <div
        ref={modalRef}
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-[420px] overflow-hidden"
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
            <span className="text-white font-medium">Close Position</span>
            <span className="text-gray-400 text-sm">
              {pair.replace("_", "/")} {isLong ? "LONG" : "SHORT"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Current P&L */}
          {pnlData && (
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 mb-1">Current P&L</div>
              <div className={`text-2xl font-mono font-bold ${getPnLColorClass(pnlData.isProfit)}`}>
                {formatPnL(pnlData.pnlPips)} pips
              </div>
              <div className={`text-sm ${getPnLColorClass(pnlData.isProfit)}`}>
                ({formatPnL(pnlData.pnlPercent, 2)}%)
              </div>
            </div>
          )}

          {/* Exit Price */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Exit Price</label>
            <input
              type="text"
              value={exitPriceStr}
              onChange={(e) => setExitPriceStr(e.target.value)}
              placeholder={currentPrice ? formatPrice(currentPrice, pair) : "Enter exit price"}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white font-mono placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
            {exitPrice > 0 && (
              <div className={`text-xs font-mono ${isProfit ? "text-green-400" : "text-red-400"}`}>
                P&L at this price: {isProfit ? "+" : ""}{pnlPips.toFixed(1)} pips
              </div>
            )}
          </div>

          {/* Close Reason */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Why are you closing?</label>
            <div className="grid grid-cols-3 gap-2">
              {row1.map((reason) => (
                <button
                  key={reason.value}
                  onClick={() => setCloseReason(reason.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    closeReason === reason.value
                      ? reason.value === "manual_profit"
                        ? "bg-green-600 text-white"
                        : reason.value === "manual_loss"
                          ? "bg-red-600 text-white"
                          : "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {reason.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {row2.map((reason) => (
                <button
                  key={reason.value}
                  onClick={() => setCloseReason(reason.value)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                    closeReason === reason.value
                      ? reason.value === "emotional"
                        ? "bg-amber-600 text-white"
                        : "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Notes (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why are you closing? Wrong BOS, reversal signal, etc."
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-gray-700 bg-gray-800/30">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!exitPrice || !closeReason}
            className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isProfit
                ? "bg-green-600 hover:bg-green-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            Close Position
          </button>
        </div>
      </div>
    </div>
  );
}
