/**
 * Drawing Description Generator
 *
 * Generates natural language descriptions of drawings for Claude.
 * Enables semantic understanding of chart annotations.
 */

import {
  Drawing,
  isFibonacciDrawing,
  isTrendlineDrawing,
  isHorizontalLineDrawing,
  isVerticalLineDrawing,
  isRectangleDrawing,
  isPositionDrawing,
  isLongPositionDrawing,
  HorizontalLineDrawing,
  TrendlineDrawing,
  FibonacciDrawing,
  RectangleDrawing,
  PositionDrawing,
  DrawingAnchor,
} from "./types";
import { getColorName } from "./colors";

/**
 * Calculate slope of a trendline (price change per time unit)
 */
function calculateSlope(anchor1: DrawingAnchor, anchor2: DrawingAnchor): number {
  const timeDiff = anchor2.timestamp - anchor1.timestamp;
  if (timeDiff === 0) return 0;
  const priceDiff = anchor2.price - anchor1.price;
  return priceDiff / timeDiff;
}

/**
 * Get direction description from slope
 */
function getSlopeDirection(slope: number): string {
  if (slope > 0.000001) return "ascending";
  if (slope < -0.000001) return "descending";
  return "flat";
}

/**
 * Format price for display
 */
function formatPrice(price: number, precision = 5): string {
  return price.toFixed(precision);
}

/**
 * Format timestamp as readable date
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().split("T")[0];
}

/**
 * Describe a horizontal line drawing
 */
function describeHorizontalLine(drawing: HorizontalLineDrawing): string {
  const color = getColorName(drawing.color);
  const label = drawing.label ? `"${drawing.label}"` : "";
  const price = formatPrice(drawing.price);
  const style = drawing.lineStyle !== "solid" ? ` (${drawing.lineStyle})` : "";

  return `${color} horizontal line ${label} at ${price}${style}`.trim();
}

/**
 * Describe a trendline drawing
 */
function describeTrendline(drawing: TrendlineDrawing): string {
  const color = getColorName(drawing.color);
  const label = drawing.label ? `"${drawing.label}"` : "";
  const slope = calculateSlope(drawing.anchor1, drawing.anchor2);
  const direction = getSlopeDirection(slope);
  const typeLabel =
    drawing.type === "ray"
      ? "ray"
      : drawing.type === "extendedLine"
      ? "extended line"
      : "trendline";

  const from = formatPrice(drawing.anchor1.price);
  const to = formatPrice(drawing.anchor2.price);

  return `${color} ${direction} ${typeLabel} ${label} from ${from} to ${to}`.trim();
}

/**
 * Describe a fibonacci drawing
 */
function describeFibonacci(drawing: FibonacciDrawing): string {
  const label = drawing.label ? `"${drawing.label}"` : "";
  const from = formatPrice(drawing.anchor1.price);
  const to = formatPrice(drawing.anchor2.price);
  const direction = drawing.anchor2.price > drawing.anchor1.price ? "up" : "down";
  const levelCount = drawing.levels.length;

  return `fibonacci retracement ${label} (${levelCount} levels) from ${from} to ${to} (${direction} swing)`.trim();
}

/**
 * Describe a rectangle drawing
 */
function describeRectangle(drawing: RectangleDrawing): string {
  const color = getColorName(drawing.borderColor);
  const label = drawing.label ? `"${drawing.label}"` : "";
  const topPrice = Math.max(drawing.anchor1.price, drawing.anchor2.price);
  const bottomPrice = Math.min(drawing.anchor1.price, drawing.anchor2.price);

  return `${color} rectangle ${label} zone from ${formatPrice(bottomPrice)} to ${formatPrice(topPrice)}`.trim();
}

/**
 * Describe a position drawing
 */
function describePosition(drawing: PositionDrawing): string {
  const label = drawing.label ? `"${drawing.label}"` : "";
  const dir = isLongPositionDrawing(drawing) ? "LONG" : "SHORT";
  const entry = formatPrice(drawing.entry.price);
  const tp = formatPrice(drawing.takeProfit);
  const sl = formatPrice(drawing.stopLoss);
  const rr = drawing.riskRewardRatio?.toFixed(2) || "?";

  return `${dir} position ${label} entry at ${entry}, TP: ${tp}, SL: ${sl} (R:R ${rr})`.trim();
}

/**
 * Generate natural language description of a drawing
 * Used by Claude to understand chart annotations
 */
export function describeDrawing(drawing: Drawing): string {
  if (isHorizontalLineDrawing(drawing)) {
    return describeHorizontalLine(drawing);
  }
  if (isTrendlineDrawing(drawing)) {
    return describeTrendline(drawing);
  }
  if (isFibonacciDrawing(drawing)) {
    return describeFibonacci(drawing);
  }
  if (isRectangleDrawing(drawing)) {
    return describeRectangle(drawing);
  }
  if (isPositionDrawing(drawing)) {
    return describePosition(drawing);
  }
  if (isVerticalLineDrawing(drawing)) {
    const color = getColorName(drawing.color);
    const label = drawing.label ? `"${drawing.label}"` : "";
    const time = formatTime(drawing.timestamp);
    return `${color} vertical line ${label} at ${time}`.trim();
  }

  return `unknown drawing type`;
}

/**
 * Check if a drawing's price is near a given price (within threshold)
 */
export function isNearPrice(
  drawing: Drawing,
  currentPrice: number,
  thresholdPips: number = 20
): boolean {
  const threshold = thresholdPips * 0.0001; // Convert pips to price

  if (isHorizontalLineDrawing(drawing)) {
    return Math.abs(drawing.price - currentPrice) <= threshold;
  }

  if (isTrendlineDrawing(drawing) || isRectangleDrawing(drawing) || isFibonacciDrawing(drawing)) {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    const minPrice = Math.min(d.anchor1.price, d.anchor2.price);
    const maxPrice = Math.max(d.anchor1.price, d.anchor2.price);
    return currentPrice >= minPrice - threshold && currentPrice <= maxPrice + threshold;
  }

  if (isPositionDrawing(drawing)) {
    const d = drawing as PositionDrawing;
    const minPrice = Math.min(d.entry.price, d.takeProfit, d.stopLoss);
    const maxPrice = Math.max(d.entry.price, d.takeProfit, d.stopLoss);
    return currentPrice >= minPrice - threshold && currentPrice <= maxPrice + threshold;
  }

  return false;
}

/**
 * Check if a drawing represents a level above the current price
 */
export function isPriceAbove(drawing: Drawing, currentPrice: number): boolean {
  if (isHorizontalLineDrawing(drawing)) {
    return drawing.price > currentPrice;
  }

  if (isRectangleDrawing(drawing)) {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    const maxPrice = Math.max(d.anchor1.price, d.anchor2.price);
    return maxPrice > currentPrice;
  }

  return false;
}

/**
 * Check if a drawing represents a level below the current price
 */
export function isPriceBelow(drawing: Drawing, currentPrice: number): boolean {
  if (isHorizontalLineDrawing(drawing)) {
    return drawing.price < currentPrice;
  }

  if (isRectangleDrawing(drawing)) {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    const minPrice = Math.min(d.anchor1.price, d.anchor2.price);
    return minPrice < currentPrice;
  }

  return false;
}

/**
 * Get the primary price level of a drawing
 */
export function getDrawingPrice(drawing: Drawing): number | null {
  if (isHorizontalLineDrawing(drawing)) {
    return drawing.price;
  }

  if (isTrendlineDrawing(drawing) || isRectangleDrawing(drawing) || isFibonacciDrawing(drawing)) {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    return (d.anchor1.price + d.anchor2.price) / 2;
  }

  if (isPositionDrawing(drawing)) {
    return drawing.entry.price;
  }

  return null;
}

/**
 * Describe all drawings with context relative to current price
 */
export function describeAllDrawings(
  drawings: Drawing[],
  currentPrice: number,
  thresholdPips: number = 20
): string {
  if (drawings.length === 0) {
    return "No drawings on the chart.";
  }

  const nearby = drawings.filter((d) => isNearPrice(d, currentPrice, thresholdPips));
  const above = drawings.filter((d) => isPriceAbove(d, currentPrice) && !isNearPrice(d, currentPrice, thresholdPips));
  const below = drawings.filter((d) => isPriceBelow(d, currentPrice) && !isNearPrice(d, currentPrice, thresholdPips));

  const lines: string[] = [
    `Current price: ${formatPrice(currentPrice)}`,
    `Total drawings: ${drawings.length}`,
  ];

  if (nearby.length > 0) {
    lines.push(`\nNearby levels (within ${thresholdPips} pips):`);
    nearby.forEach((d) => lines.push(`  - ${describeDrawing(d)}`));
  }

  if (above.length > 0) {
    lines.push(`\nResistance above:`);
    // Sort by price, closest first
    above
      .sort((a, b) => (getDrawingPrice(a) || 0) - (getDrawingPrice(b) || 0))
      .forEach((d) => lines.push(`  - ${describeDrawing(d)}`));
  }

  if (below.length > 0) {
    lines.push(`\nSupport below:`);
    // Sort by price, closest first (descending)
    below
      .sort((a, b) => (getDrawingPrice(b) || 0) - (getDrawingPrice(a) || 0))
      .forEach((d) => lines.push(`  - ${describeDrawing(d)}`));
  }

  return lines.join("\n");
}

/**
 * Extract key price levels from drawings
 * Returns levels sorted by proximity to current price
 */
export function extractKeyLevels(
  drawings: Drawing[],
  currentPrice: number
): Array<{ price: number; description: string; label?: string; type: string }> {
  const levels: Array<{
    price: number;
    description: string;
    label?: string;
    type: string;
  }> = [];

  for (const drawing of drawings) {
    if (isHorizontalLineDrawing(drawing)) {
      levels.push({
        price: drawing.price,
        description: describeDrawing(drawing),
        label: drawing.label,
        type: "horizontal",
      });
    }

    if (isFibonacciDrawing(drawing)) {
      const priceRange = drawing.anchor2.price - drawing.anchor1.price;
      for (const level of drawing.levels) {
        const levelPrice = drawing.anchor1.price + priceRange * level;
        levels.push({
          price: levelPrice,
          description: `Fib ${(level * 100).toFixed(1)}%${drawing.label ? ` (${drawing.label})` : ""}`,
          label: drawing.label,
          type: "fibonacci",
        });
      }
    }

    if (isRectangleDrawing(drawing)) {
      const topPrice = Math.max(drawing.anchor1.price, drawing.anchor2.price);
      const bottomPrice = Math.min(drawing.anchor1.price, drawing.anchor2.price);
      levels.push({
        price: topPrice,
        description: `Zone top${drawing.label ? ` (${drawing.label})` : ""}`,
        label: drawing.label,
        type: "zone_top",
      });
      levels.push({
        price: bottomPrice,
        description: `Zone bottom${drawing.label ? ` (${drawing.label})` : ""}`,
        label: drawing.label,
        type: "zone_bottom",
      });
    }

    if (isPositionDrawing(drawing)) {
      const dir = isLongPositionDrawing(drawing) ? "LONG" : "SHORT";
      levels.push({
        price: drawing.entry.price,
        description: `${dir} entry${drawing.label ? ` (${drawing.label})` : ""}`,
        label: drawing.label,
        type: "position_entry",
      });
      levels.push({
        price: drawing.takeProfit,
        description: `Take profit${drawing.label ? ` (${drawing.label})` : ""}`,
        label: drawing.label,
        type: "position_tp",
      });
      levels.push({
        price: drawing.stopLoss,
        description: `Stop loss${drawing.label ? ` (${drawing.label})` : ""}`,
        label: drawing.label,
        type: "position_sl",
      });
    }
  }

  // Sort by distance to current price
  levels.sort(
    (a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
  );

  return levels;
}
