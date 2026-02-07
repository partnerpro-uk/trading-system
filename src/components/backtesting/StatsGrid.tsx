"use client";

import { TrendingUp, Target, Activity, Award } from "lucide-react";
import type { StatsData, EntityType } from "@/hooks/useBacktesting";

interface StatsGridProps {
  stats: StatsData;
  entityType: EntityType;
}

const RATE_LABELS: Record<EntityType, string> = {
  bos: "Continuation Rate",
  fvg: "Fill Rate",
  sweep: "BOS Follow Rate",
  swing: "N/A",
};

const MAGNITUDE_LABELS: Record<EntityType, string> = {
  bos: "Avg Magnitude",
  fvg: "Avg Gap Size",
  sweep: "Avg Wick Size",
  swing: "Avg True Range",
};

export function StatsGrid({ stats, entityType }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        icon={<Activity className="w-4 h-4 text-blue-400" />}
        label="Total Events"
        value={stats.totalEvents.toLocaleString()}
      />
      <StatCard
        icon={<Target className="w-4 h-4 text-green-400" />}
        label={RATE_LABELS[entityType]}
        value={entityType === "swing" ? "-" : `${stats.successRate.toFixed(1)}%`}
        trend={stats.successRate >= 50 ? "up" : stats.successRate > 0 ? "down" : undefined}
      />
      <StatCard
        icon={<TrendingUp className="w-4 h-4 text-yellow-400" />}
        label={MAGNITUDE_LABELS[entityType]}
        value={`${stats.avgMagnitude.toFixed(1)} pips`}
      />
      <StatCard
        icon={<Award className="w-4 h-4 text-purple-400" />}
        label="Best Combo"
        value={stats.bestCombo}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: "up" | "down";
}) {
  return (
    <div className="bg-gray-900/70 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 text-xs uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div
        className={`text-2xl font-bold ${
          trend === "up"
            ? "text-green-400"
            : trend === "down"
              ? "text-red-400"
              : "text-gray-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
