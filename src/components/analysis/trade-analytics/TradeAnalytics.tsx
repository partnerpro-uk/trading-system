"use client";

import { useState } from "react";
import { Clock, Grid3X3, Activity } from "lucide-react";
import { TimelineView } from "./TimelineView";
import { StrategyGrid } from "./StrategyGrid";
import type { Trade } from "../../../lib/analysis/types";

interface TradeAnalyticsProps {
  trades: Trade[];
  onTradeClick?: (trade: Trade) => void;
}

type TabId = "timeline" | "grid";

const TABS: { id: TabId; label: string; icon: typeof Clock }[] = [
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "grid", label: "Strategy Grid", icon: Grid3X3 },
];

export function TradeAnalytics({ trades, onTradeClick }: TradeAnalyticsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("timeline");

  if (trades.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-center h-80">
          <div className="text-center">
            <div className="p-4 bg-gray-800 rounded-full mb-4 inline-block">
              <Activity className="w-8 h-8 text-purple-500" />
            </div>
            <p className="text-gray-400 mb-2">Trade Analytics</p>
            <p className="text-gray-500 text-sm">Run an analysis to visualize results</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-purple-400 border-b-2 border-purple-500 bg-purple-900/20"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto px-4 py-3 text-sm text-gray-500">
          {trades.length} trades
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === "timeline" && (
          <TimelineView trades={trades} onTradeClick={onTradeClick} />
        )}
        {activeTab === "grid" && (
          <StrategyGrid trades={trades} />
        )}
      </div>
    </div>
  );
}
