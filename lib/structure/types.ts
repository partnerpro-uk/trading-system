/**
 * Market Structure Detection — Type Definitions
 *
 * All Phase 1 interfaces for swing detection, structure labeling,
 * BOS detection, sweep detection, and key level computation.
 */

import type { Candle } from "../db/candles";

// Re-export for convenience
export type { Candle };

// --- Swing Points ---

export type SwingType = "high" | "low";
export type StructureLabel = "HH" | "HL" | "LH" | "LL" | "EQH" | "EQL";

export interface SwingPoint {
  timestamp: number;
  price: number;
  type: SwingType;
  label: StructureLabel | null; // null until labeled
  candleIndex: number; // index in the input candle array
  lookbackUsed: number; // N value used for detection
  trueRange: number; // high - low of the swing candle
}

// --- BOS Events ---

export type BOSDirection = "bullish" | "bearish";
export type BOSStatus = "active" | "reclaimed";
export type BOSType = "bos" | "mss"; // bos = continuation, mss = market structure shift

export interface BOSEvent {
  timestamp: number; // confirming candle close time
  direction: BOSDirection;
  status: BOSStatus;
  brokenLevel: number; // the swing price that was broken
  brokenSwingTimestamp: number; // when that swing formed
  confirmingClose: number; // the close price that confirmed
  magnitudePips: number; // how far beyond (in pips)
  isDisplacement: boolean; // body >= median(last 20) * 2.0
  isCounterTrend: boolean; // true if opposing HTF direction
  bosType: BOSType; // "bos" = continuation, "mss" = reversal/shift

  // Reclaim tracking (populated if status becomes "reclaimed")
  reclaimedAt?: number;
  reclaimedByClose?: number;
  timeTilReclaim?: number; // milliseconds between BOS and reclaim

  // Phase 3: Enrichment (populated when enableEnrichment is true)
  enrichment?: BOSEnrichment;
}

// --- Sweep Events ---

export type SweptLevelType =
  | "swing_high"
  | "swing_low"
  | "key_level"
  | "eqh"
  | "eql";

export interface SweepEvent {
  timestamp: number;
  direction: "bullish" | "bearish"; // bullish sweep = wick below then close above
  sweptLevel: number;
  wickExtreme: number; // how far the wick went
  sweptLevelType: SweptLevelType;
  followedByBOS: boolean;
}

// --- Key Level Grid ---

export interface KeyLevelGrid {
  pdh: number | null; // Previous Day High
  pdl: number | null; // Previous Day Low
  pwh: number | null; // Previous Week High
  pwl: number | null; // Previous Week Low
  pmh: number | null; // Previous Month High
  pml: number | null; // Previous Month Low
  yh: number | null; // Year High
  yl: number | null; // Year Low
}

export interface KeyLevelEntry {
  label: string; // "PDH", "PDL", etc.
  price: number;
  significance: number; // 1-5 (YH/YL=5, PMH/PML=4, PWH/PWL=3, PDH/PDL=2)
}

// --- FVG Events ---

export type FVGDirection = "bullish" | "bearish";
export type FVGStatus = "fresh" | "partial" | "filled" | "inverted";
export type FVGTier = 1 | 2 | 3;

export const FVG_FILL_THRESHOLDS: Record<string, number> = {
  M15: 85, M30: 85, H1: 90, H4: 90, D: 95, D1: 95, W: 95, W1: 95, M: 95, MN: 95,
};

export interface FVGEvent {
  id: string;                       // `${pair}-${timeframe}-${createdAt}`
  pair: string;
  timeframe: string;
  direction: FVGDirection;
  status: FVGStatus;
  topPrice: number;
  bottomPrice: number;
  midline: number;                  // (top + bottom) / 2
  gapSizePips: number;
  createdAt: number;                // unix ms — displacement candle
  displacementBody: number;
  displacementRange: number;
  gapToBodyRatio: number;
  isDisplacement: boolean;
  relativeVolume: number;
  tier: FVGTier;
  fillPercent: number;
  maxFillPercent: number;
  bodyFilled: boolean;
  wickTouched: boolean;
  firstTouchAt?: number;
  firstTouchBarsAfter?: number;
  retestCount: number;
  midlineRespected: boolean;
  midlineTouchCount: number;
  filledAt?: number;
  barsToFill?: number;
  invertedAt?: number;
  barsToInversion?: number;
  parentBOS?: string;
  containedBy?: string[];
  confluenceWith?: string[];
  tradeId?: string;
  candleIndex: number;              // displacement candle index (not persisted)
}

// --- Premium/Discount ---

export type ZoneType = "premium" | "discount";

export interface PremiumDiscountContext {
  h4Zone: ZoneType;
  h4Equilibrium: number;
  h4SwingRange: { high: number; low: number };
  h4DepthPercent: number;
  d1Zone: ZoneType;
  d1Equilibrium: number;
  d1SwingRange: { high: number; low: number };
  d1DepthPercent: number;
  w1Zone: ZoneType;
  w1Equilibrium: number;
  w1SwingRange: { high: number; low: number };
  w1DepthPercent: number;
  yearlyZone: ZoneType;
  yearlyEquilibrium: number;
  yearlyRange: { high: number; low: number };
  macroZone: ZoneType;
  macroEquilibrium: number;
  macroRange: { high: number; low: number };
  alignmentCount: number;
  isDeepPremium: boolean;
  isDeepDiscount: boolean;
}

// --- BOS Enrichment ---

export interface BOSEnrichment {
  keyLevelsBroken: string[];      // ["PDL", "PWL"] etc.
  keyLevelScore: number;          // 0-100
  cotAlignment: number;           // 0-100 (100 = fully aligned)
  cotDirection: string | null;    // "bullish" | "bearish" | null
  newsProximity: { name: string; impact: string; hoursAway: number }[];
  newsScore: number;              // 0-100
  mtfScore: number;               // composite MTF score at time of break
  mtfAlignment: number;           // 0-100 (how aligned MTF is with BOS direction)
  sessionContext: string;         // "london_ny_overlap", "london", "new_york", "tokyo", "sydney"
  sessionScore: number;           // 0-100
  significance: number;           // 0-100 weighted composite
  isHighConviction: boolean;      // significance > 70
}

// --- MTF Scoring ---

export interface MTFDirectionEntry {
  timeframe: string;
  weight: number;
  direction: number;       // -1.0 to +1.0
  reasoning: string;       // e.g. "Recent bearish BOS + LH/LL structure"
}

export interface MTFScore {
  composite: number;       // -100 to +100 (normalized)
  rawScore: number;        // un-normalized weighted sum
  maxScore: number;        // sum of weights (10.5)
  entries: MTFDirectionEntry[];
  interpretation: string;  // "Strong bullish alignment", "Mixed/ranging", etc.
  computedAt: number;
}

// --- Current Structure State ---

export type TrendDirection = "bullish" | "bearish" | "ranging";

export interface CurrentStructure {
  direction: TrendDirection;
  lastBOS: BOSEvent | null;
  swingSequence: StructureLabel[]; // last N labels in order
}

// --- Full API Response ---

export interface StructureResponse {
  pair: string;
  timeframe: string;
  computedAt: number;
  swings: SwingPoint[];
  bosEvents: BOSEvent[];
  sweepEvents: SweepEvent[];
  keyLevels: KeyLevelGrid;
  keyLevelEntries: KeyLevelEntry[];
  currentStructure: CurrentStructure;
  fvgEvents: FVGEvent[];
  premiumDiscount: PremiumDiscountContext | null;
  mtfScore?: MTFScore;
}
