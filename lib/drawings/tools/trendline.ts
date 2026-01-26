/**
 * Trendline Tool
 *
 * Wrapper for lightweight-charts-line-tools TrendLine, Ray, Arrow, ExtendedLine
 */

import {
  TrendlineDrawing,
  DrawingAnchor,
  DEFAULT_DRAWING_COLORS,
} from "../types";

/**
 * Trendline slope and angle calculations
 */
export interface TrendlineMetrics {
  slope: number;           // Price change per candle
  angle: number;           // Angle in degrees
  direction: "up" | "down" | "flat";
  lengthCandles: number;   // Number of candles spanned
  priceChange: number;     // Total price change
  percentChange: number;   // Percentage change
}

/**
 * Calculate trendline metrics
 *
 * @param anchor1 - Start point
 * @param anchor2 - End point
 * @param candleDuration - Duration of one candle in milliseconds
 * @returns TrendlineMetrics
 */
export function calculateTrendlineMetrics(
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor,
  candleDuration: number = 15 * 60 * 1000  // Default 15 minutes
): TrendlineMetrics {
  const timeDiff = anchor2.timestamp - anchor1.timestamp;
  const priceDiff = anchor2.price - anchor1.price;
  const lengthCandles = Math.abs(timeDiff / candleDuration);

  // Calculate slope (price per candle)
  const slope = lengthCandles > 0 ? priceDiff / lengthCandles : 0;

  // Calculate angle in degrees
  // Using atan2 with normalized values for visual angle
  const normalizedPriceDiff = priceDiff / anchor1.price * 100;  // As percentage
  const normalizedTimeDiff = lengthCandles;
  const angle = Math.atan2(normalizedPriceDiff, normalizedTimeDiff) * (180 / Math.PI);

  // Determine direction
  let direction: "up" | "down" | "flat";
  if (Math.abs(slope) < 0.0001) {
    direction = "flat";
  } else if (slope > 0) {
    direction = "up";
  } else {
    direction = "down";
  }

  return {
    slope,
    angle,
    direction,
    lengthCandles: Math.round(lengthCandles),
    priceChange: priceDiff,
    percentChange: (priceDiff / anchor1.price) * 100,
  };
}

/**
 * Get price at a specific timestamp along the trendline
 *
 * @param anchor1 - Start point
 * @param anchor2 - End point
 * @param timestamp - Target timestamp
 * @returns Price at that timestamp (extrapolates if outside range)
 */
export function getPriceOnTrendline(
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor,
  timestamp: number
): number {
  const timeDiff = anchor2.timestamp - anchor1.timestamp;
  const priceDiff = anchor2.price - anchor1.price;

  if (timeDiff === 0) return anchor1.price;

  const ratio = (timestamp - anchor1.timestamp) / timeDiff;
  return anchor1.price + priceDiff * ratio;
}

/**
 * Check if price is above or below the trendline at a given timestamp
 */
export function isPriceAboveTrendline(
  price: number,
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor,
  timestamp: number
): boolean {
  const trendlinePrice = getPriceOnTrendline(anchor1, anchor2, timestamp);
  return price > trendlinePrice;
}

/**
 * Find intersection point of two trendlines
 */
export function findTrendlineIntersection(
  line1Anchor1: DrawingAnchor,
  line1Anchor2: DrawingAnchor,
  line2Anchor1: DrawingAnchor,
  line2Anchor2: DrawingAnchor
): DrawingAnchor | null {
  // Line 1: p1 + t * (p2 - p1)
  // Line 2: p3 + s * (p4 - p3)

  const x1 = line1Anchor1.timestamp;
  const y1 = line1Anchor1.price;
  const x2 = line1Anchor2.timestamp;
  const y2 = line1Anchor2.price;

  const x3 = line2Anchor1.timestamp;
  const y3 = line2Anchor1.price;
  const x4 = line2Anchor2.timestamp;
  const y4 = line2Anchor2.price;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  if (Math.abs(denom) < 0.0001) {
    return null;  // Lines are parallel
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    timestamp: x1 + t * (x2 - x1),
    price: y1 + t * (y2 - y1),
  };
}

/**
 * Convert to lightweight-charts-line-tools format
 */
export function toLineToolsTrendlineFormat(drawing: TrendlineDrawing): {
  toolType: string;
  points: Array<{ time: number; price: number }>;
  options: {
    line: {
      color: string;
      width: number;
      style: number;
    };
    text?: {
      value: string;
      visible: boolean;
    };
  };
} {
  // Convert line style to number
  const styleMap = { solid: 0, dashed: 2, dotted: 1 };

  // Map our type to line-tools type
  const toolTypeMap = {
    trendline: "TrendLine",
    ray: "Ray",
    arrow: "Arrow",
    extendedLine: "ExtendedLine",
  };

  return {
    toolType: toolTypeMap[drawing.type] || "TrendLine",
    points: [
      { time: drawing.anchor1.timestamp / 1000, price: drawing.anchor1.price },
      { time: drawing.anchor2.timestamp / 1000, price: drawing.anchor2.price },
    ],
    options: {
      line: {
        color: drawing.color,
        width: drawing.lineWidth,
        style: styleMap[drawing.lineStyle] || 0,
      },
      text: drawing.showLabel
        ? {
            value: drawing.labelText || "",
            visible: true,
          }
        : undefined,
    },
  };
}

/**
 * Convert from lightweight-charts-line-tools format to our format
 */
export function fromLineToolsTrendlineFormat(
  lineToolData: {
    toolType: string;
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  },
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<TrendlineDrawing, "id" | "createdAt"> {
  const points = lineToolData.points;
  const options = lineToolData.options;
  const lineOptions = options.line as Record<string, unknown> || {};

  // Map tool type back to our type
  const typeMap: Record<string, TrendlineDrawing["type"]> = {
    TrendLine: "trendline",
    Ray: "ray",
    Arrow: "arrow",
    ExtendedLine: "extendedLine",
  };

  // Map style number to string
  const styleMap: Record<number, "solid" | "dashed" | "dotted"> = {
    0: "solid",
    1: "dotted",
    2: "dashed",
  };

  return {
    type: typeMap[lineToolData.toolType] || "trendline",
    anchor1: {
      timestamp: (points[0]?.time || 0) * 1000,
      price: points[0]?.price || 0,
    },
    anchor2: {
      timestamp: (points[1]?.time || 0) * 1000,
      price: points[1]?.price || 0,
    },
    color: (lineOptions.color as string) || DEFAULT_DRAWING_COLORS.trendline,
    lineWidth: (lineOptions.width as number) || 2,
    lineStyle: styleMap[(lineOptions.style as number)] || "solid",
    showLabel: !!(options.text as Record<string, unknown>)?.visible,
    labelText: (options.text as Record<string, unknown>)?.value as string,
    createdBy,
  };
}
