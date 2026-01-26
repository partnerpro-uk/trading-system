/**
 * Fibonacci Retracement Tool
 *
 * Wrapper for lightweight-charts-line-tools FibRetracement
 */

import {
  FibonacciDrawing,
  DrawingAnchor,
  DEFAULT_FIB_LEVELS,
  DEFAULT_DRAWING_COLORS,
} from "../types";

/**
 * Fibonacci level interface with computed price
 */
export interface FibLevel {
  level: number;      // 0, 0.236, 0.382, etc.
  price: number;      // Computed price at this level
  label: string;      // Display label (e.g., "0.618")
  color: string;      // Line color
}

/**
 * Calculate Fibonacci retracement levels between two price points
 *
 * @param startPrice - Starting price (usually swing low/high)
 * @param endPrice - Ending price (usually swing high/low)
 * @param levels - Array of Fibonacci levels to calculate
 * @returns Array of FibLevel objects
 */
export function calculateFibLevels(
  startPrice: number,
  endPrice: number,
  levels: number[] = DEFAULT_FIB_LEVELS
): FibLevel[] {
  const range = endPrice - startPrice;
  const colors = DEFAULT_DRAWING_COLORS.fibonacci.levels as Record<number, string>;

  return levels.map((level) => ({
    level,
    price: startPrice + range * (1 - level),  // Retracement is from end to start
    label: level === 0 ? "0" : level === 1 ? "1" : level.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
    color: colors[level] || DEFAULT_DRAWING_COLORS.fibonacci.line,
  }));
}

/**
 * Calculate Fibonacci extension levels beyond the range
 *
 * @param startPrice - Starting price
 * @param endPrice - Ending price
 * @param extensionLevels - Extension levels to calculate (e.g., [1.272, 1.618, 2.618])
 * @returns Array of FibLevel objects for extensions
 */
export function calculateFibExtensions(
  startPrice: number,
  endPrice: number,
  extensionLevels: number[] = [1.272, 1.618, 2.618]
): FibLevel[] {
  const range = endPrice - startPrice;

  return extensionLevels.map((level) => ({
    level,
    price: startPrice + range * level,
    label: level.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
    color: "#9C27B0",  // Purple for extensions
  }));
}

/**
 * Find which Fibonacci level a price is closest to
 *
 * @param price - Current price
 * @param fibLevels - Array of calculated Fib levels
 * @returns The closest FibLevel or null if none within reasonable distance
 */
export function findClosestFibLevel(
  price: number,
  fibLevels: FibLevel[],
  tolerancePercent: number = 0.5
): FibLevel | null {
  let closest: FibLevel | null = null;
  let minDistance = Infinity;

  for (const level of fibLevels) {
    const distance = Math.abs(price - level.price);
    const percentDistance = (distance / level.price) * 100;

    if (percentDistance <= tolerancePercent && distance < minDistance) {
      minDistance = distance;
      closest = level;
    }
  }

  return closest;
}

/**
 * Check if price is at a Fibonacci level
 */
export function isAtFibLevel(
  price: number,
  fibLevels: FibLevel[],
  tolerancePercent: number = 0.1
): boolean {
  return findClosestFibLevel(price, fibLevels, tolerancePercent) !== null;
}

/**
 * Get Fibonacci drawing data for chart rendering
 */
export function getFibDrawingData(drawing: FibonacciDrawing): {
  levels: FibLevel[];
  anchor1: DrawingAnchor;
  anchor2: DrawingAnchor;
  showLabels: boolean;
  showPrices: boolean;
} {
  const levels = calculateFibLevels(
    drawing.anchor1.price,
    drawing.anchor2.price,
    drawing.levels
  );

  return {
    levels,
    anchor1: drawing.anchor1,
    anchor2: drawing.anchor2,
    showLabels: drawing.showLabels,
    showPrices: drawing.showPrices,
  };
}

/**
 * Convert to lightweight-charts-line-tools format
 */
export function toLineToolsFibFormat(drawing: FibonacciDrawing): {
  points: Array<{ time: number; price: number }>;
  options: {
    levels: Array<{ coeff: number; color: string }>;
    extendLeft: boolean;
    extendRight: boolean;
    showLabels: boolean;
    showPrices: boolean;
    lineColor: string;
  };
} {
  const colors = drawing.levelColors || (DEFAULT_DRAWING_COLORS.fibonacci.levels as Record<number, string>);

  return {
    points: [
      { time: drawing.anchor1.timestamp / 1000, price: drawing.anchor1.price },
      { time: drawing.anchor2.timestamp / 1000, price: drawing.anchor2.price },
    ],
    options: {
      levels: drawing.levels.map((level) => ({
        coeff: level,
        color: colors[level] || drawing.lineColor,
      })),
      extendLeft: drawing.extendLeft,
      extendRight: drawing.extendRight,
      showLabels: drawing.showLabels,
      showPrices: drawing.showPrices,
      lineColor: drawing.lineColor,
    },
  };
}

/**
 * Convert from lightweight-charts-line-tools format to our format
 */
export function fromLineToolsFibFormat(
  lineToolData: {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  },
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<FibonacciDrawing, "id" | "createdAt"> {
  const points = lineToolData.points;
  const options = lineToolData.options;

  return {
    type: "fibonacci",
    anchor1: {
      timestamp: (points[0]?.time || 0) * 1000,
      price: points[0]?.price || 0,
    },
    anchor2: {
      timestamp: (points[1]?.time || 0) * 1000,
      price: points[1]?.price || 0,
    },
    levels: (options.levels as Array<{ coeff: number }>)?.map((l) => l.coeff) || DEFAULT_FIB_LEVELS,
    extendLeft: (options.extendLeft as boolean) || false,
    extendRight: (options.extendRight as boolean) ?? true,
    showLabels: (options.showLabels as boolean) ?? true,
    showPrices: (options.showPrices as boolean) ?? true,
    lineColor: (options.lineColor as string) || DEFAULT_DRAWING_COLORS.fibonacci.line,
    createdBy,
  };
}
