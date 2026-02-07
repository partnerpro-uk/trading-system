/**
 * Structure Labeling
 *
 * Labels swing points as HH/HL/LH/LL/EQH/EQL by comparing
 * each swing to the previous swing of the same type (high vs high, low vs low).
 *
 * EQH/EQL tolerance uses swing-relative measurement with ATR ceiling,
 * not pure ATR (consistent with the anti-ATR philosophy).
 */

import type { Candle, SwingPoint, StructureLabel } from "./types";

/**
 * Compute ATR(period) ending at a specific candle index.
 * True range = max(high - low, |high - prevClose|, |low - prevClose|)
 */
function computeATR(candles: Candle[], endIndex: number, period: number): number {
  const start = Math.max(1, endIndex - period + 1);
  let sum = 0;
  let count = 0;

  for (let i = start; i <= endIndex; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    sum += tr;
    count++;
  }

  return count > 0 ? sum / count : 0;
}

/**
 * Compute EQH/EQL tolerance for a swing point.
 *
 * Primary: 15% of the swing candle's true range (what actually happened there)
 * Ceiling: 10% of ATR(14) (safety cap for flash crashes / news spikes)
 */
function computeTolerance(
  swing: SwingPoint,
  candles: Candle[]
): number {
  const swingBased = swing.trueRange * 0.15;
  const atr = computeATR(candles, swing.candleIndex, 14);
  const atrBased = atr * 0.10;

  // If ATR is 0 (not enough data), just use swing-based
  if (atrBased <= 0) return swingBased;

  return Math.min(swingBased, atrBased);
}

/**
 * Label swing points as HH/HL/LH/LL/EQH/EQL.
 *
 * Compares each swing to the previous swing of the same type:
 * - Highs: HH (higher), LH (lower), EQH (within tolerance)
 * - Lows: HL (higher), LL (lower), EQL (within tolerance)
 *
 * Returns a new array with labels filled in. First swing of each type
 * gets null label (no prior to compare against).
 */
export function labelSwings(
  swings: SwingPoint[],
  candles: Candle[]
): SwingPoint[] {
  const labeled = swings.map((s) => ({ ...s })); // shallow copy

  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;

  for (const swing of labeled) {
    if (swing.type === "high") {
      if (lastHigh === null) {
        swing.label = null; // first swing high — no prior to compare
      } else {
        const tolerance = computeTolerance(lastHigh, candles);
        const diff = swing.price - lastHigh.price;

        if (Math.abs(diff) <= tolerance) {
          swing.label = "EQH";
        } else if (diff > 0) {
          swing.label = "HH";
        } else {
          swing.label = "LH";
        }
      }
      lastHigh = swing;
    } else {
      // type === "low"
      if (lastLow === null) {
        swing.label = null; // first swing low — no prior to compare
      } else {
        const tolerance = computeTolerance(lastLow, candles);
        const diff = swing.price - lastLow.price;

        if (Math.abs(diff) <= tolerance) {
          swing.label = "EQL";
        } else if (diff > 0) {
          swing.label = "HL";
        } else {
          swing.label = "LL";
        }
      }
      lastLow = swing;
    }
  }

  return labeled;
}
