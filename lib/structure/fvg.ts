/**
 * FVG (Fair Value Gap) Detection & Lifecycle Tracking
 *
 * Detects 3-candle gap patterns, tracks fill lifecycle (fresh → partial → filled/inverted),
 * volume-grades gaps into tiers, and computes multi-timeframe nesting.
 *
 * Pure functions only — no database dependencies.
 */

import type {
  Candle,
  BOSEvent,
  FVGEvent,
  FVGDirection,
  FVGTier,
} from "./types";

// Re-import constant value (type import doesn't bring runtime value)
const FILL_THRESHOLDS: Record<string, number> = {
  M15: 85, M30: 85, H1: 90, H4: 90, D: 95, D1: 95, W: 95, W1: 95, M: 95, MN: 95,
};

// --- Helpers ---

function getPipMultiplier(pair: string): number {
  return pair.includes("JPY") ? 100 : 10000;
}

function computeVolumeSMA(
  candles: Candle[],
  endIndex: number,
  period: number
): number {
  const start = Math.max(0, endIndex - period + 1);
  let sum = 0;
  let count = 0;

  for (let i = start; i <= endIndex; i++) {
    if (candles[i].volume != null) {
      sum += candles[i].volume!;
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

// --- FVG Detection ---

/**
 * Detect Fair Value Gaps in candle data.
 *
 * A bullish FVG: candle[i].low > candle[i-2].high (gap up)
 * A bearish FVG: candle[i].high < candle[i-2].low (gap down)
 *
 * Displacement candle is candle[i-1].
 * Min width filter: gap >= 10% of displacement body.
 */
export function detectFVGs(
  candles: Candle[],
  bosEvents: BOSEvent[],
  pair: string,
  timeframe: string
): FVGEvent[] {
  if (candles.length < 3) return [];

  const pipMultiplier = getPipMultiplier(pair);
  const fvgs: FVGEvent[] = [];

  // Build a set of displacement BOS timestamps for parent linking
  const displacementBOSMap = new Map<number, BOSEvent>();
  for (const bos of bosEvents) {
    if (bos.isDisplacement) {
      displacementBOSMap.set(bos.timestamp, bos);
    }
  }

  for (let i = 2; i < candles.length; i++) {
    const oldest = candles[i - 2];
    const displacement = candles[i - 1];
    const newest = candles[i];

    const dispBody = Math.abs(displacement.close - displacement.open);
    const dispRange = displacement.high - displacement.low;

    // Bullish FVG: newest low > oldest high, displacement closes above oldest high
    const isBullish =
      newest.low > oldest.high &&
      displacement.close > oldest.high;

    // Bearish FVG: newest high < oldest low, displacement closes below oldest low
    const isBearish =
      newest.high < oldest.low &&
      displacement.close < oldest.low;

    if (!isBullish && !isBearish) continue;

    let topPrice: number, bottomPrice: number;
    let direction: FVGDirection;

    if (isBullish) {
      topPrice = newest.low;
      bottomPrice = oldest.high;
      direction = "bullish";
    } else {
      topPrice = oldest.low;
      bottomPrice = newest.high;
      direction = "bearish";
    }

    const gapSize = topPrice - bottomPrice;

    // Min width filter: gap >= 10% of displacement body
    if (gapSize < dispBody * 0.10) continue;

    const gapSizePips = gapSize * pipMultiplier;
    const midline = (topPrice + bottomPrice) / 2;

    // Volume grading
    const volSMA = computeVolumeSMA(candles, i - 1, 20);
    const relativeVolume =
      volSMA > 0 && displacement.volume != null
        ? displacement.volume / volSMA
        : 0;

    let tier: FVGTier;
    if (relativeVolume >= 1.5) tier = 1;
    else if (relativeVolume >= 1.0) tier = 2;
    else tier = 3;

    // Displacement check (body >= 2x median body over last 20)
    const isDisplacement = dispBody >= computeMedianBody(candles, i - 1, 20) * 2.0;

    // Parent BOS match: check if displacement candle timestamp matches a BOS
    const parentBOS = displacementBOSMap.get(displacement.timestamp);

    const id = `${pair}-${timeframe}-${displacement.timestamp}`;

    fvgs.push({
      id,
      pair,
      timeframe,
      direction,
      status: "fresh",
      topPrice,
      bottomPrice,
      midline,
      gapSizePips,
      createdAt: displacement.timestamp,
      displacementBody: dispBody,
      displacementRange: dispRange,
      gapToBodyRatio: dispBody > 0 ? gapSize / dispBody : 0,
      isDisplacement,
      relativeVolume,
      tier,
      fillPercent: 0,
      maxFillPercent: 0,
      bodyFilled: false,
      wickTouched: false,
      retestCount: 0,
      midlineRespected: false,
      midlineTouchCount: 0,
      parentBOS: parentBOS ? `${parentBOS.direction}-${parentBOS.timestamp}` : undefined,
      candleIndex: i - 1,
    });
  }

  return fvgs;
}

function computeMedianBody(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const start = Math.max(0, endIndex - lookback + 1);
  const bodies: number[] = [];

  for (let i = start; i <= endIndex; i++) {
    bodies.push(Math.abs(candles[i].close - candles[i].open));
  }

  if (bodies.length === 0) return 0;

  bodies.sort((a, b) => a - b);
  const mid = Math.floor(bodies.length / 2);

  return bodies.length % 2 === 0
    ? (bodies[mid - 1] + bodies[mid]) / 2
    : bodies[mid];
}

// --- FVG Fill Tracking ---

/**
 * Track fill lifecycle for detected FVGs against subsequent candles.
 *
 * Status transitions: fresh → partial (fill > 0) → filled (fillPercent >= threshold)
 * Inversion: bullish inverts when close < bottomPrice, bearish when close > topPrice
 * Midline: price within 10% of midline then reverses within 3 candles → midlineRespected
 */
export function trackFVGFills(
  fvgEvents: FVGEvent[],
  candles: Candle[],
  pair: string,
  timeframe: string
): FVGEvent[] {
  if (fvgEvents.length === 0 || candles.length === 0) return fvgEvents;

  const fillThreshold = FILL_THRESHOLDS[timeframe] ?? 90;
  const gapSize = (fvg: FVGEvent) => fvg.topPrice - fvg.bottomPrice;

  for (const fvg of fvgEvents) {
    // Already terminal — skip
    if (fvg.status === "filled" || fvg.status === "inverted") continue;

    // Find the candle index after this FVG was created
    const startIdx = candles.findIndex((c) => c.timestamp > fvg.createdAt);
    if (startIdx < 0) continue;

    let midlineTouchStart = -1;

    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i];
      const bodyHigh = Math.max(candle.open, candle.close);
      const bodyLow = Math.min(candle.open, candle.close);

      // --- Wick touch detection ---
      const wickTouches =
        fvg.direction === "bullish"
          ? candle.low <= fvg.topPrice
          : candle.high >= fvg.bottomPrice;

      if (wickTouches && !fvg.wickTouched) {
        fvg.wickTouched = true;
        if (!fvg.firstTouchAt) {
          fvg.firstTouchAt = candle.timestamp;
          fvg.firstTouchBarsAfter = i - startIdx + 1;
        }
      }

      // --- Body fill calculation ---
      let fillAmount = 0;
      if (fvg.direction === "bullish") {
        // Bearish candle body entering the bullish FVG from above
        if (bodyLow < fvg.topPrice) {
          fillAmount = fvg.topPrice - Math.max(bodyLow, fvg.bottomPrice);
        }
      } else {
        // Bullish candle body entering the bearish FVG from below
        if (bodyHigh > fvg.bottomPrice) {
          fillAmount = Math.min(bodyHigh, fvg.topPrice) - fvg.bottomPrice;
        }
      }

      const gap = gapSize(fvg);
      if (gap > 0 && fillAmount > 0) {
        const currentFill = (fillAmount / gap) * 100;
        if (currentFill > fvg.maxFillPercent) {
          fvg.maxFillPercent = currentFill;
        }
        if (currentFill > fvg.fillPercent) {
          fvg.fillPercent = currentFill;
        }

        // Body filled = body fully inside the gap
        if (fillAmount >= gap * 0.5) {
          fvg.bodyFilled = true;
        }
      }

      // --- Retest count ---
      const entersFVG =
        fvg.direction === "bullish"
          ? candle.low <= fvg.topPrice && candle.low >= fvg.bottomPrice
          : candle.high >= fvg.bottomPrice && candle.high <= fvg.topPrice;

      // Count distinct entries — only increment if the previous candle was outside
      if (entersFVG && i > startIdx) {
        const prevCandle = candles[i - 1];
        const prevOutside =
          fvg.direction === "bullish"
            ? prevCandle.low > fvg.topPrice
            : prevCandle.high < fvg.bottomPrice;
        if (prevOutside) {
          fvg.retestCount++;
          if (!fvg.firstTouchAt) {
            fvg.firstTouchAt = candle.timestamp;
            fvg.firstTouchBarsAfter = i - startIdx + 1;
          }
        }
      }

      // --- Midline tracking ---
      const midlineZone = gap * 0.10;
      const touchesMidline =
        candle.low <= fvg.midline + midlineZone &&
        candle.high >= fvg.midline - midlineZone;

      if (touchesMidline) {
        fvg.midlineTouchCount++;
        if (midlineTouchStart < 0) {
          midlineTouchStart = i;
        }
      }

      // Midline respected = price touches midline then reverses within 3 candles
      if (midlineTouchStart >= 0 && i - midlineTouchStart <= 3 && i > midlineTouchStart) {
        const reversed =
          fvg.direction === "bullish"
            ? candle.close > fvg.midline
            : candle.close < fvg.midline;
        if (reversed) {
          fvg.midlineRespected = true;
          midlineTouchStart = -1;
        }
      }
      if (midlineTouchStart >= 0 && i - midlineTouchStart > 3) {
        midlineTouchStart = -1;
      }

      // --- Status transitions ---
      if (fvg.fillPercent > 0 && fvg.status === "fresh") {
        fvg.status = "partial";
      }

      if (fvg.fillPercent >= fillThreshold) {
        fvg.status = "filled";
        fvg.filledAt = candle.timestamp;
        fvg.barsToFill = i - (fvg.candleIndex >= 0 ? fvg.candleIndex : startIdx - 1);
        break;
      }

      // --- Inversion check ---
      const inverted =
        fvg.direction === "bullish"
          ? candle.close < fvg.bottomPrice
          : candle.close > fvg.topPrice;

      if (inverted) {
        fvg.status = "inverted";
        fvg.invertedAt = candle.timestamp;
        fvg.barsToInversion = i - (fvg.candleIndex >= 0 ? fvg.candleIndex : startIdx - 1);
        break;
      }
    }
  }

  return fvgEvents;
}

// --- Multi-TF Nesting ---

/**
 * Compute containment relationships between current TF FVGs and higher TF FVGs.
 * Mutates containedBy and confluenceWith on currentTFFVGs in-place.
 */
export function computeFVGNesting(
  currentTFFVGs: FVGEvent[],
  higherTFFVGs: FVGEvent[]
): void {
  if (higherTFFVGs.length === 0) return;

  for (const fvg of currentTFFVGs) {
    const contained: string[] = [];
    const confluent: string[] = [];

    for (const htf of higherTFFVGs) {
      // Contained: current FVG entirely within higher TF FVG
      if (fvg.topPrice <= htf.topPrice && fvg.bottomPrice >= htf.bottomPrice) {
        contained.push(htf.id);
      }
      // Confluent: overlapping but not fully contained, same direction
      else if (
        fvg.direction === htf.direction &&
        fvg.topPrice >= htf.bottomPrice &&
        fvg.bottomPrice <= htf.topPrice
      ) {
        confluent.push(htf.id);
      }
    }

    if (contained.length > 0) fvg.containedBy = contained;
    if (confluent.length > 0) fvg.confluenceWith = confluent;
  }
}
