"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  StructureResponse,
  FVGEvent,
  BOSEvent,
  KeyLevelEntry,
  MTFScore,
  StructureLabel,
  PremiumDiscountContext,
  CurrentStructure,
} from "@/lib/structure/types";

interface StructurePanelProps {
  structureData: StructureResponse | null;
  currentPrice: number | null;
  currentPair: string;
  onScrollToTimestamp?: (ts: number) => void;
}

// --- Collapsible Section ---
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// --- Helpers ---
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

// Label color mapping
const LABEL_COLORS: Record<StructureLabel, string> = {
  HH: "bg-green-600 text-white",
  HL: "bg-green-800 text-green-200",
  LH: "bg-red-800 text-red-200",
  LL: "bg-red-600 text-white",
  EQH: "bg-yellow-700 text-yellow-200",
  EQL: "bg-yellow-700 text-yellow-200",
};

// --- MTF Score Meter ---
function MTFMeter({ mtfScore }: { mtfScore?: MTFScore }) {
  if (!mtfScore) {
    return <div className="text-gray-600 text-xs text-center py-2">N/A for this timeframe</div>;
  }

  const { composite, entries, interpretation } = mtfScore;
  const normalized = (composite + 100) / 200; // 0-1
  const barColor = composite > 30 ? "bg-green-500" : composite < -30 ? "bg-red-500" : "bg-yellow-500";
  const textColor = composite > 30 ? "text-green-400" : composite < -30 ? "text-red-400" : "text-yellow-400";

  return (
    <div>
      {/* Large composite number */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-2xl font-bold font-mono ${textColor}`}>
          {composite > 0 ? "+" : ""}{composite}
        </span>
        <span className="text-[10px] text-gray-500">{interpretation}</span>
      </div>

      {/* Composite bar */}
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${Math.max(2, normalized * 100)}%` }}
        />
      </div>

      {/* Per-TF mini bars */}
      <div className="space-y-1">
        {entries.map((e) => {
          const pct = ((e.direction + 1) / 2) * 100;
          const dirColor = e.direction > 0.3 ? "bg-green-500" : e.direction < -0.3 ? "bg-red-500" : "bg-gray-600";
          return (
            <div key={e.timeframe} className="flex items-center gap-2 text-[10px]">
              <span className="w-6 text-gray-500 font-mono">{e.timeframe}</span>
              <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full ${dirColor}`} style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              <span className={`w-8 text-right font-mono ${e.direction > 0 ? "text-green-500" : e.direction < 0 ? "text-red-500" : "text-gray-500"}`}>
                {e.direction > 0 ? "+" : ""}{e.direction.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Current Structure Section ---
function CurrentStructureSection({ cs }: { cs: CurrentStructure }) {
  const dirColor =
    cs.direction === "bullish" ? "bg-green-600 text-white"
    : cs.direction === "bearish" ? "bg-red-600 text-white"
    : "bg-gray-600 text-gray-200";

  return (
    <div>
      {/* Direction badge */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${dirColor}`}>
          {cs.direction}
        </span>
      </div>

      {/* Last BOS */}
      {cs.lastBOS && (
        <div className="mb-2 px-2 py-1.5 bg-gray-800/50 rounded text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Last BOS</span>
            <span className="text-gray-500">{timeAgo(cs.lastBOS.timestamp)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={cs.lastBOS.direction === "bullish" ? "text-green-400" : "text-red-400"}>
              {cs.lastBOS.direction === "bullish" ? "Bullish" : "Bearish"}
            </span>
            {cs.lastBOS.enrichment && (
              <span className={`font-mono text-[10px] ${
                cs.lastBOS.enrichment.significance > 70 ? "text-green-400"
                : cs.lastBOS.enrichment.significance > 30 ? "text-amber-400"
                : "text-gray-500"
              }`}>
                Sig: {cs.lastBOS.enrichment.significance}
              </span>
            )}
            {cs.lastBOS.isDisplacement && (
              <span className="text-[10px] text-purple-400 bg-purple-900/30 px-1 rounded">DISP</span>
            )}
          </div>
        </div>
      )}

      {/* Swing sequence */}
      {cs.swingSequence.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cs.swingSequence.slice(-8).map((label, i) => (
            <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${LABEL_COLORS[label]}`}>
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Active FVGs Section ---
function ActiveFVGs({
  fvgs,
  onScrollToTimestamp,
}: {
  fvgs: FVGEvent[];
  onScrollToTimestamp?: (ts: number) => void;
}) {
  const active = useMemo(
    () => fvgs.filter((f) => f.status === "fresh" || f.status === "partial").slice(0, 10),
    [fvgs]
  );

  const bullish = active.filter((f) => f.direction === "bullish").length;
  const bearish = active.filter((f) => f.direction === "bearish").length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xs">
        <span className="text-green-400">{bullish} Bull</span>
        <span className="text-red-400">{bearish} Bear</span>
        <span className="text-gray-600">{active.length} total</span>
      </div>

      {active.length === 0 ? (
        <div className="text-gray-600 text-xs">No active FVGs</div>
      ) : (
        <div className="space-y-1">
          {active.map((fvg) => {
            const dirDot = fvg.direction === "bullish" ? "bg-green-500" : "bg-red-500";
            const tierBadge =
              fvg.tier === 1 ? "text-green-400 bg-green-900/30"
              : fvg.tier === 2 ? "text-blue-400 bg-blue-900/30"
              : "text-gray-400 bg-gray-800";

            return (
              <button
                key={fvg.id}
                onClick={() => onScrollToTimestamp?.(fvg.createdAt)}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-gray-800/30 rounded text-xs hover:bg-gray-800/60 transition-colors text-left"
              >
                <div className={`w-1.5 h-1.5 rounded-full ${dirDot} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-gray-300 text-[10px]">
                      {formatPrice(fvg.bottomPrice)}-{formatPrice(fvg.topPrice)}
                    </span>
                    <span className={`px-1 rounded text-[9px] font-bold ${tierBadge}`}>T{fvg.tier}</span>
                  </div>
                  {/* Fill bar */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${Math.min(100, fvg.fillPercent)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-gray-500 font-mono w-7 text-right">
                      {fvg.fillPercent.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Recent BOS Section ---
function RecentBOS({ bosEvents }: { bosEvents: BOSEvent[] }) {
  const recent = useMemo(
    () => [...bosEvents].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
    [bosEvents]
  );

  if (recent.length === 0) {
    return <div className="text-gray-600 text-xs">No BOS events</div>;
  }

  return (
    <div className="space-y-1.5">
      {recent.map((bos, i) => {
        const sig = bos.enrichment?.significance;
        const sigColor = sig !== undefined
          ? sig > 70 ? "text-green-400" : sig > 30 ? "text-amber-400" : "text-gray-500"
          : "text-gray-600";
        const dirArrow = bos.direction === "bullish" ? "text-green-400" : "text-red-400";

        return (
          <div key={i} className="flex items-center gap-2 text-xs px-1">
            <span className={`font-bold ${dirArrow}`}>
              {bos.direction === "bullish" ? "^" : "v"}
            </span>
            <span className="text-gray-300 flex-1">
              {bos.direction === "bullish" ? "Bullish" : "Bearish"} BOS
            </span>
            {sig !== undefined && (
              <span className={`font-mono text-[10px] ${sigColor}`}>{sig}</span>
            )}
            {bos.isDisplacement && (
              <span className="text-[9px] text-purple-400">DISP</span>
            )}
            {bos.isCounterTrend && (
              <span className="text-[9px] text-orange-400">CT</span>
            )}
            <span className="text-[10px] text-gray-600">{timeAgo(bos.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Premium/Discount Section ---
function PremiumDiscountSection({ pd }: { pd: PremiumDiscountContext }) {
  const zoneLabel = pd.isDeepPremium
    ? "DEEP PREMIUM"
    : pd.isDeepDiscount
    ? "DEEP DISCOUNT"
    : pd.h4Zone === "premium"
    ? "PREMIUM"
    : pd.h4Zone === "discount"
    ? "DISCOUNT"
    : "EQUILIBRIUM";

  const zoneBg = zoneLabel.includes("PREMIUM")
    ? "bg-red-600 text-white"
    : zoneLabel.includes("DISCOUNT")
    ? "bg-green-600 text-white"
    : "bg-gray-600 text-gray-200";

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${zoneBg}`}>
          {zoneLabel}
        </span>
        <span className="text-gray-500 text-[10px]">
          H4 Depth: {pd.h4DepthPercent.toFixed(0)}%
        </span>
      </div>

      <div className="space-y-1 text-[10px]">
        <div className="flex items-center justify-between text-gray-400">
          <span>Alignment across tiers</span>
          <span className="font-mono text-gray-300">{pd.alignmentCount}/5</span>
        </div>
        {/* Per-tier zones */}
        {[
          { label: "H4", zone: pd.h4Zone },
          { label: "D1", zone: pd.d1Zone },
          { label: "W1", zone: pd.w1Zone },
          { label: "Yearly", zone: pd.yearlyZone },
          { label: "Macro", zone: pd.macroZone },
        ].map(({ label, zone }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-gray-500">{label}</span>
            <span className={zone === "premium" ? "text-red-400" : "text-green-400"}>
              {zone === "premium" ? "Premium" : "Discount"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Key Levels Section ---
function KeyLevelsSection({
  levels,
  currentPrice,
  currentPair,
}: {
  levels: KeyLevelEntry[];
  currentPrice: number | null;
  currentPair: string;
}) {
  const sorted = useMemo(() => {
    if (!currentPrice) return levels;
    return [...levels].sort(
      (a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
    );
  }, [levels, currentPrice]);

  if (sorted.length === 0) {
    return <div className="text-gray-600 text-xs">No key levels</div>;
  }

  return (
    <div className="space-y-0.5">
      {sorted.map((level) => {
        const dist = currentPrice ? pipsDistance(currentPrice, level.price, currentPair) : null;
        const isAbove = currentPrice ? level.price > currentPrice : false;
        const distColor = isAbove ? "text-red-400" : "text-green-400";

        return (
          <div key={level.label} className="flex items-center justify-between text-xs px-1 py-0.5">
            <span className="text-gray-300 font-medium">{level.label}</span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-gray-400 text-[10px]">{formatPrice(level.price)}</span>
              {dist !== null && (
                <span className={`font-mono text-[10px] ${distColor}`}>
                  {dist.toFixed(1)}p {isAbove ? "above" : "below"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Main Panel ---
export function StructurePanel({
  structureData,
  currentPrice,
  currentPair,
  onScrollToTimestamp,
}: StructurePanelProps) {
  if (!structureData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-xs p-4">
        Loading structure data...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Market Structure
        </h3>
        <p className="text-[10px] text-gray-600 mt-0.5">
          {structureData.pair.replace("_", "/")} {structureData.timeframe}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="MTF Score">
          <MTFMeter mtfScore={structureData.mtfScore} />
        </Section>

        <Section title="Current Structure">
          <CurrentStructureSection cs={structureData.currentStructure} />
        </Section>

        <Section title="Active FVGs">
          <ActiveFVGs
            fvgs={structureData.fvgEvents}
            onScrollToTimestamp={onScrollToTimestamp}
          />
        </Section>

        <Section title="Recent BOS">
          <RecentBOS bosEvents={structureData.bosEvents} />
        </Section>

        <Section title="Premium / Discount" defaultOpen={false}>
          {structureData.premiumDiscount ? (
            <PremiumDiscountSection pd={structureData.premiumDiscount} />
          ) : (
            <div className="text-gray-600 text-xs">Not available for this timeframe</div>
          )}
        </Section>

        <Section title="Key Levels" defaultOpen={false}>
          <KeyLevelsSection
            levels={structureData.keyLevelEntries}
            currentPrice={currentPrice}
            currentPair={currentPair}
          />
        </Section>
      </div>
    </div>
  );
}
