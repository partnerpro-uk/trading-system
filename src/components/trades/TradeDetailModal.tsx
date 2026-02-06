"use client";

import { useState } from "react";
import {
  X,
  TrendingUp,
  TrendingDown,
  Camera,
  Clock,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { Trade } from "@/hooks/useTrades";
import { useSnapshots } from "@/hooks/useSnapshots";
import { SnapshotReplayViewer } from "@/components/snapshots/SnapshotReplayViewer";
import { Id } from "../../../convex/_generated/dataModel";
import {
  detectSession,
  getSessionColor,
  formatDuration,
  calculateRMultiple,
} from "@/lib/trading/sessions";

interface TradeDetailModalProps {
  trade: Trade;
  strategyName?: string;
  onClose: () => void;
}

/**
 * Modal showing full trade details with snapshot timeline and replay viewer.
 */
export function TradeDetailModal({
  trade,
  strategyName,
  onClose,
}: TradeDetailModalProps) {
  const { snapshots, isLoading } = useSnapshots(trade._id as Id<"trades">);
  const [selectedSnapshotIndex, setSelectedSnapshotIndex] = useState(0);
  const [showAiDescription, setShowAiDescription] = useState(false);

  const isLong = trade.direction === "LONG";
  const isProfit = (trade.pnlPips ?? 0) >= 0;
  const isJPY = trade.pair.includes("JPY");
  const precision = isJPY ? 3 : 5;

  const session = detectSession(trade.entryTime);
  const sessionColor = getSessionColor(session);
  const rMultiple = calculateRMultiple(
    trade.entryPrice,
    trade.exitPrice || trade.entryPrice,
    trade.stopLoss,
    trade.direction
  );

  const duration =
    trade.exitTime && trade.entryTime
      ? formatDuration(trade.entryTime, trade.exitTime)
      : "—";

  const selectedSnapshot = snapshots?.[selectedSnapshotIndex] || null;

  // Moment label styles
  const momentStyles: Record<string, string> = {
    setup: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    entry: "bg-green-500/20 text-green-400 border-green-500/30",
    during: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    exit: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };

  const outcomeStyles: Record<string, string> = {
    TP: "bg-green-500/20 text-green-400",
    SL: "bg-red-500/20 text-red-400",
    MW: "bg-green-500/20 text-green-400",
    ML: "bg-red-500/20 text-red-400",
    BE: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[90vw] max-w-[1100px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center gap-3">
            {isLong ? (
              <TrendingUp className="w-5 h-5 text-green-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
            <span className="font-bold text-white text-lg">
              {trade.pair.replace("_", "/")}
            </span>
            <span className="text-sm text-gray-400">{trade.timeframe}</span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                sessionColor
              }`}
            >
              {session}
            </span>
            {trade.outcome && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded ${
                  outcomeStyles[trade.outcome] || ""
                }`}
              >
                {trade.outcome}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Trade summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Entry" value={trade.entryPrice.toFixed(precision)} />
            <StatCard
              label="Exit"
              value={
                trade.exitPrice
                  ? trade.exitPrice.toFixed(precision)
                  : "Open"
              }
            />
            <StatCard
              label="SL"
              value={trade.stopLoss.toFixed(precision)}
              color="text-red-400"
            />
            <StatCard
              label="TP"
              value={trade.takeProfit.toFixed(precision)}
              color="text-green-400"
            />
            <StatCard
              label="P&L"
              value={`${isProfit ? "+" : ""}${(trade.pnlPips ?? 0).toFixed(1)} pips`}
              color={isProfit ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="R"
              value={`${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R`}
              color={rMultiple >= 0 ? "text-green-400" : "text-red-400"}
            />
            <StatCard label="Duration" value={duration} icon={<Clock className="w-3 h-3" />} />
          </div>

          {/* Strategy */}
          {strategyName && (
            <div className="text-xs text-gray-500">
              Strategy: <span className="text-gray-400">{strategyName}</span>
            </div>
          )}

          {/* Snapshot timeline */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Camera className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-300">
                Snapshots
              </span>
              {isLoading && (
                <span className="text-xs text-gray-500">Loading...</span>
              )}
              {snapshots && (
                <span className="text-xs text-gray-500">
                  {snapshots.length} captured
                </span>
              )}
            </div>

            {snapshots && snapshots.length > 0 ? (
              <>
                {/* Timeline cards */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {snapshots.map((snap: any, idx: number) => (
                    <button
                      key={snap._id}
                      onClick={() => setSelectedSnapshotIndex(idx)}
                      className={`flex-shrink-0 px-3 py-2 rounded-lg border transition-colors ${
                        idx === selectedSnapshotIndex
                          ? "bg-gray-700 border-blue-500"
                          : "bg-gray-800/50 border-gray-700 hover:border-gray-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                            momentStyles[snap.momentLabel] || ""
                          }`}
                        >
                          {snap.momentLabel.toUpperCase()}
                        </span>
                        {idx < snapshots.length - 1 && (
                          <ChevronRight className="w-3 h-3 text-gray-600" />
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1">
                        {new Date(snap.timestamp).toLocaleTimeString()}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Replay viewer */}
                {selectedSnapshot && (
                  <div className="rounded-lg overflow-hidden border border-gray-700">
                    <SnapshotReplayViewer
                      snapshot={selectedSnapshot}
                      height={350}
                    />
                  </div>
                )}

                {/* AI Description toggle */}
                {selectedSnapshot?.aiDescription && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowAiDescription(!showAiDescription)}
                      className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {showAiDescription ? "Hide" : "Show"} AI Analysis
                    </button>
                    {showAiDescription && (
                      <pre className="mt-2 p-3 bg-gray-800 rounded-lg text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto border border-gray-700">
                        {selectedSnapshot.aiDescription}
                      </pre>
                    )}
                  </div>
                )}
              </>
            ) : (
              !isLoading && (
                <div className="text-center py-8 text-sm text-gray-500 bg-gray-800/30 rounded-lg border border-gray-700/50">
                  No snapshots captured for this trade.
                  <br />
                  <span className="text-xs text-gray-600">
                    Snapshots are auto-captured on trade entry and exit.
                  </span>
                </div>
              )
            )}
          </div>

          {/* Notes */}
          {trade.notes && (
            <div>
              <span className="text-xs text-gray-500">Notes</span>
              <p className="text-sm text-gray-300 mt-1">{trade.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-white",
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2 border border-gray-700/50">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-sm font-mono font-medium ${color} flex items-center gap-1 mt-0.5`}>
        {icon}
        {value}
      </div>
    </div>
  );
}
