/**
 * Zigzag Filter
 *
 * Enforces strict alternating high-low-high-low sequence on detected swings.
 * When two consecutive same-type swings appear, keeps the more extreme one
 * (higher high for consecutive highs, lower low for consecutive lows).
 *
 * This eliminates noise where minor retracements produce multiple swings
 * of the same type without an intervening opposite swing.
 */

import type { SwingPoint } from "./types";

/**
 * Filter swings to enforce alternating high-low-high-low.
 *
 * Input must be sorted by timestamp (detectSwings already does this).
 * Returns a new array — does not mutate input.
 */
export function enforceZigzag(swings: SwingPoint[]): SwingPoint[] {
  if (swings.length <= 1) return [...swings];

  const result: SwingPoint[] = [swings[0]];

  for (let i = 1; i < swings.length; i++) {
    const current = swings[i];
    const last = result[result.length - 1];

    if (current.type === last.type) {
      // Consecutive same type — keep the more extreme
      if (current.type === "high") {
        if (current.price > last.price) {
          result[result.length - 1] = current;
        }
      } else {
        if (current.price < last.price) {
          result[result.length - 1] = current;
        }
      }
    } else {
      // Alternating — keep it
      result.push(current);
    }
  }

  return result;
}
