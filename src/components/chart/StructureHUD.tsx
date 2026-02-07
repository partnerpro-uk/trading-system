"use client";

import { useMemo } from "react";
import type {
  StructureResponse,
  StructureLabel,
} from "@/lib/structure/types";

interface StructureHUDProps {
  structureData: StructureResponse | null;
  currentPrice: number | null;
  pair: string;
  timeframe: string;
}

// --- Helpers (same patterns as StructurePanel.tsx) ---

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function pipsDistance(price: number, level: number, pair: string): number {
  const mult = pair.includes("JPY") ? 100 : 10000;
  return Math.round(Math.abs(price - level) * mult * 10) / 10;
}

function formatPrice(price: number): string {
  if (price < 10) return price.toFixed(5);
  if (price < 1000) return price.toFixed(3);
  return price.toFixed(2);
}

// --- Swing label colors (Tailwind classes) ---

const SWING_COLORS: Record<StructureLabel, string> = {
  HH: "text-green-400 bg-green-900/40",
  HL: "text-green-300 bg-green-900/30",
  LH: "text-red-300 bg-red-900/30",
  LL: "text-red-400 bg-red-900/40",
  EQH: "text-yellow-400 bg-yellow-900/30",
  EQL: "text-yellow-400 bg-yellow-900/30",
};

const DIR_COLORS: Record<string, string> = {
  bullish: "text-green-400",
  bearish: "text-red-400",
  ranging: "text-yellow-400",
};

// --- Row layout helper ---

function HUDRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 min-h-[22px]">
      <span className="text-[10px] text-gray-500 w-10 shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
        {children}
      </div>
    </div>
  );
}

// --- Main Component ---

export function StructureHUD({ structureData, currentPrice, pair, timeframe }: StructureHUDProps) {
  // Row 1: Trend + Swing Sequence (TF-specific)
  const trendInfo = useMemo(() => {
    if (!structureData?.currentStructure) return null;
    const { direction, swingSequence } = structureData.currentStructure;
    return { direction, lastThree: swingSequence.slice(-3) };
  }, [structureData]);

  // Row 2: MTF Score (universal)
  const mtfInfo = useMemo(() => {
    if (!structureData?.mtfScore) return null;
    const { composite, interpretation } = structureData.mtfScore;
    return { composite, interpretation };
  }, [structureData]);

  // Row 3: Premium/Discount Zones (universal)
  const pdInfo = useMemo(() => {
    if (!structureData?.premiumDiscount) return null;
    const pd = structureData.premiumDiscount;
    return { h4: pd.h4Zone, d1: pd.d1Zone, w1: pd.w1Zone };
  }, [structureData]);

  // Row 4: Last BOS (TF-specific)
  const lastBOSInfo = useMemo(() => {
    if (!structureData?.currentStructure?.lastBOS) return null;
    const bos = structureData.currentStructure.lastBOS;
    return {
      direction: bos.direction,
      brokenLevel: bos.brokenLevel,
      timeAgoStr: timeAgo(bos.timestamp),
    };
  }, [structureData]);

  // Rows 5 & 6: Nearest Key Levels (universal)
  const nearestLevels = useMemo(() => {
    if (!structureData?.keyLevelEntries || currentPrice === null) {
      return { above: null, below: null };
    }
    let nearestAbove: { label: string; price: number; distPips: number } | null = null;
    let nearestBelow: { label: string; price: number; distPips: number } | null = null;

    for (const entry of structureData.keyLevelEntries) {
      const dist = pipsDistance(currentPrice, entry.price, pair);
      if (entry.price > currentPrice) {
        if (!nearestAbove || dist < nearestAbove.distPips) {
          nearestAbove = { label: entry.label, price: entry.price, distPips: dist };
        }
      } else if (entry.price < currentPrice) {
        if (!nearestBelow || dist < nearestBelow.distPips) {
          nearestBelow = { label: entry.label, price: entry.price, distPips: dist };
        }
      }
    }
    return { above: nearestAbove, below: nearestBelow };
  }, [structureData, currentPrice, pair]);

  // Row 7: Active FVGs (TF-specific)
  const fvgInfo = useMemo(() => {
    if (!structureData?.fvgEvents) return { bullish: 0, bearish: 0 };
    const active = structureData.fvgEvents.filter(
      (f) => f.status === "fresh" || f.status === "partial"
    );
    return {
      bullish: active.filter((f) => f.direction === "bullish").length,
      bearish: active.filter((f) => f.direction === "bearish").length,
    };
  }, [structureData]);

  if (!structureData) return null;

  // MTF bar: compute fill width and color
  const mtfBarWidth = mtfInfo ? Math.abs(mtfInfo.composite) : 0;
  const mtfBarColor = mtfInfo
    ? mtfInfo.composite > 30 ? "bg-green-500" : mtfInfo.composite < -30 ? "bg-red-500" : "bg-yellow-500"
    : "bg-gray-600";
  const mtfBarAlign = mtfInfo && mtfInfo.composite < 0 ? "justify-end" : "justify-start";

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg w-[220px]">
      {/* Header */}
      <div className="px-2 py-1 border-b border-gray-800/50 flex items-center justify-between">
        <span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
          {pair.replace("_", "/")}
        </span>
        <span className="text-[9px] text-gray-600 font-mono">{timeframe}</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-800/30">
        {/* Row 1: Trend + Swing Sequence */}
        <HUDRow label="Trend">
          {trendInfo ? (
            <>
              <span className={`text-[10px] font-bold ${DIR_COLORS[trendInfo.direction] ?? "text-gray-400"}`}>
                {trendInfo.direction === "bullish" ? "▲" : trendInfo.direction === "bearish" ? "▼" : "◆"}
                {" "}{trendInfo.direction.charAt(0).toUpperCase() + trendInfo.direction.slice(1)}
              </span>
              <div className="flex gap-0.5 ml-1">
                {trendInfo.lastThree.map((label, i) => (
                  <span key={i} className={`text-[8px] font-bold px-0.5 rounded ${SWING_COLORS[label] ?? "text-gray-400"}`}>
                    {label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="text-[10px] text-gray-600">—</span>
          )}
        </HUDRow>

        {/* Row 2: MTF Score */}
        <HUDRow label="MTF">
          {mtfInfo ? (
            <div className="flex items-center gap-1.5 flex-1 justify-end">
              {/* Mini bar */}
              <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden flex items-center">
                <div className={`flex w-full ${mtfBarAlign}`}>
                  <div
                    className={`h-1.5 rounded-full ${mtfBarColor}`}
                    style={{ width: `${mtfBarWidth}%` }}
                  />
                </div>
              </div>
              <span className={`text-[10px] font-mono font-bold ${
                mtfInfo.composite > 30 ? "text-green-400" : mtfInfo.composite < -30 ? "text-red-400" : "text-yellow-400"
              }`}>
                {mtfInfo.composite > 0 ? "+" : ""}{mtfInfo.composite}
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-gray-600">N/A</span>
          )}
        </HUDRow>

        {/* Row 3: Premium/Discount Zones */}
        <HUDRow label="P/D">
          {pdInfo ? (
            <div className="flex gap-1">
              {(["h4", "d1", "w1"] as const).map((tf) => {
                const zone = pdInfo[tf];
                const isPremium = zone === "premium";
                return (
                  <span
                    key={tf}
                    className={`text-[9px] font-mono px-1 rounded ${
                      isPremium ? "text-red-400 bg-red-900/40" : "text-green-400 bg-green-900/40"
                    }`}
                  >
                    {tf.toUpperCase()} {isPremium ? "P" : "D"}
                  </span>
                );
              })}
            </div>
          ) : (
            <span className="text-[10px] text-gray-600">—</span>
          )}
        </HUDRow>

        {/* Row 4: Last BOS */}
        <HUDRow label="BOS">
          {lastBOSInfo ? (
            <>
              <span className={`text-[10px] ${lastBOSInfo.direction === "bullish" ? "text-green-400" : "text-red-400"}`}>
                {lastBOSInfo.direction === "bullish" ? "▲" : "▼"}
              </span>
              <span className="text-[10px] font-mono text-gray-300">
                {formatPrice(lastBOSInfo.brokenLevel)}
              </span>
              <span className="text-[9px] text-gray-500">{lastBOSInfo.timeAgoStr}</span>
            </>
          ) : (
            <span className="text-[10px] text-gray-600">—</span>
          )}
        </HUDRow>

        {/* Row 5: Nearest Key Level Above */}
        <HUDRow label="Above">
          {nearestLevels.above ? (
            <>
              <span className="text-[10px] font-mono text-gray-400">{nearestLevels.above.label}</span>
              <span className="text-[10px] font-mono text-gray-300">{formatPrice(nearestLevels.above.price)}</span>
              <span className="text-[9px] text-gray-500">({nearestLevels.above.distPips}p)</span>
            </>
          ) : (
            <span className="text-[10px] text-gray-600">—</span>
          )}
        </HUDRow>

        {/* Row 6: Nearest Key Level Below */}
        <HUDRow label="Below">
          {nearestLevels.below ? (
            <>
              <span className="text-[10px] font-mono text-gray-400">{nearestLevels.below.label}</span>
              <span className="text-[10px] font-mono text-gray-300">{formatPrice(nearestLevels.below.price)}</span>
              <span className="text-[9px] text-gray-500">({nearestLevels.below.distPips}p)</span>
            </>
          ) : (
            <span className="text-[10px] text-gray-600">—</span>
          )}
        </HUDRow>

        {/* Row 7: Active FVGs */}
        <HUDRow label="FVGs">
          {fvgInfo.bullish + fvgInfo.bearish > 0 ? (
            <>
              <span className="text-[10px] text-green-400">{fvgInfo.bullish}▲</span>
              <span className="text-[10px] text-gray-600">/</span>
              <span className="text-[10px] text-red-400">{fvgInfo.bearish}▼</span>
            </>
          ) : (
            <span className="text-[10px] text-gray-600">none</span>
          )}
        </HUDRow>
      </div>
    </div>
  );
}
