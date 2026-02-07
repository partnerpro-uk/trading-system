"use client";

import dynamic from "next/dynamic";
import type { DistributionBin, EntityType } from "@/hooks/useBacktesting";

const BarChart = dynamic(
  () => import("recharts").then((m) => m.BarChart),
  { ssr: false }
);
const Bar = dynamic(
  () => import("recharts").then((m) => m.Bar),
  { ssr: false }
);
const XAxis = dynamic(
  () => import("recharts").then((m) => m.XAxis),
  { ssr: false }
);
const YAxis = dynamic(
  () => import("recharts").then((m) => m.YAxis),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import("recharts").then((m) => m.Tooltip),
  { ssr: false }
);
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false }
);

const MAGNITUDE_LABELS: Record<EntityType, string> = {
  bos: "Magnitude (pips)",
  fvg: "Gap Size (pips)",
  sweep: "Wick Distance",
  swing: "True Range",
};

interface DistributionChartProps {
  data: DistributionBin[];
  entityType: EntityType;
}

export function DistributionChart({ data, entityType }: DistributionChartProps) {
  if (data.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">
          {MAGNITUDE_LABELS[entityType]} Distribution
        </h3>
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          No data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">
        {MAGNITUDE_LABELS[entityType]} Distribution
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={0}>
          <XAxis
            dataKey="range"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: 12,
            }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Bar dataKey="bullish" fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
          <Bar dataKey="bearish" fill="#ef4444" stackId="a" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Bullish
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Bearish
        </span>
      </div>
    </div>
  );
}
