"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2.5">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color || "text-gray-200"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function TodayPerformance() {
  const { userId } = useAuth();
  const stats = useQuery(api.trades.getTodayStats, userId ? {} : "skip");

  if (!stats) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Today&apos;s Performance</h3>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-gray-800/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const pnlColor = stats.totalPnlPips > 0 ? "text-green-400" : stats.totalPnlPips < 0 ? "text-red-400" : "text-gray-400";

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Today&apos;s Performance</h3>
        {stats.openCount > 0 && (
          <span className="text-[10px] text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
            {stats.openCount} open
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Trades"
          value={String(stats.total)}
          sub={`${stats.wins}W / ${stats.losses}L`}
        />
        <StatCard
          label="Win Rate"
          value={stats.total > 0 ? `${stats.winRate}%` : "-"}
          color={stats.winRate >= 50 ? "text-green-400" : stats.winRate > 0 ? "text-red-400" : undefined}
        />
        <StatCard
          label="P&L"
          value={`${stats.totalPnlPips > 0 ? "+" : ""}${stats.totalPnlPips}p`}
          color={pnlColor}
        />
        <StatCard
          label="Best / Worst"
          value={stats.total > 0 ? `+${stats.bestTrade}p` : "-"}
          sub={stats.total > 0 ? `/ ${stats.worstTrade}p` : undefined}
        />
      </div>
    </div>
  );
}
