/**
 * Rectangle Tool
 *
 * Wrapper for lightweight-charts-line-tools Rectangle
 * Used for zones, ranges, and highlighted areas
 */

import {
  RectangleDrawing,
  DrawingAnchor,
  DEFAULT_DRAWING_COLORS,
} from "../types";

/**
 * Rectangle zone metrics
 */
export interface RectangleMetrics {
  topPrice: number;
  bottomPrice: number;
  startTime: number;
  endTime: number;
  priceRange: number;
  priceRangePercent: number;
  durationMs: number;
  area: number;  // Price range * time range (abstract units)
}

/**
 * Calculate rectangle metrics
 */
export function calculateRectangleMetrics(
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor
): RectangleMetrics {
  const topPrice = Math.max(anchor1.price, anchor2.price);
  const bottomPrice = Math.min(anchor1.price, anchor2.price);
  const startTime = Math.min(anchor1.timestamp, anchor2.timestamp);
  const endTime = Math.max(anchor1.timestamp, anchor2.timestamp);

  const priceRange = topPrice - bottomPrice;
  const avgPrice = (topPrice + bottomPrice) / 2;
  const priceRangePercent = (priceRange / avgPrice) * 100;
  const durationMs = endTime - startTime;

  return {
    topPrice,
    bottomPrice,
    startTime,
    endTime,
    priceRange,
    priceRangePercent,
    durationMs,
    area: priceRange * durationMs,
  };
}

/**
 * Check if a point is inside the rectangle
 */
export function isPointInRectangle(
  timestamp: number,
  price: number,
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor
): boolean {
  const { topPrice, bottomPrice, startTime, endTime } = calculateRectangleMetrics(anchor1, anchor2);

  return (
    timestamp >= startTime &&
    timestamp <= endTime &&
    price >= bottomPrice &&
    price <= topPrice
  );
}

/**
 * Get the center point of a rectangle
 */
export function getRectangleCenter(
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor
): DrawingAnchor {
  return {
    timestamp: (anchor1.timestamp + anchor2.timestamp) / 2,
    price: (anchor1.price + anchor2.price) / 2,
  };
}

/**
 * Check if a candle is within the rectangle time range
 */
export function isCandleInTimeRange(
  candleTimestamp: number,
  anchor1: DrawingAnchor,
  anchor2: DrawingAnchor
): boolean {
  const startTime = Math.min(anchor1.timestamp, anchor2.timestamp);
  const endTime = Math.max(anchor1.timestamp, anchor2.timestamp);

  return candleTimestamp >= startTime && candleTimestamp <= endTime;
}

/**
 * Create a supply zone (typically above current price)
 */
export function createSupplyZone(
  startTime: number,
  endTime: number,
  topPrice: number,
  bottomPrice: number,
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<RectangleDrawing, "id" | "createdAt"> {
  return {
    type: "rectangle",
    anchor1: { timestamp: startTime, price: topPrice },
    anchor2: { timestamp: endTime, price: bottomPrice },
    fillColor: "rgba(239, 68, 68, 0.1)",    // Red tint
    borderColor: "#EF4444",
    borderWidth: 1,
    showLabel: true,
    labelText: "Supply",
    createdBy,
  };
}

/**
 * Create a demand zone (typically below current price)
 */
export function createDemandZone(
  startTime: number,
  endTime: number,
  topPrice: number,
  bottomPrice: number,
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<RectangleDrawing, "id" | "createdAt"> {
  return {
    type: "rectangle",
    anchor1: { timestamp: startTime, price: topPrice },
    anchor2: { timestamp: endTime, price: bottomPrice },
    fillColor: "rgba(34, 197, 94, 0.1)",    // Green tint
    borderColor: "#22C55E",
    borderWidth: 1,
    showLabel: true,
    labelText: "Demand",
    createdBy,
  };
}

/**
 * Convert to lightweight-charts-line-tools format
 */
export function toLineToolsRectangleFormat(drawing: RectangleDrawing): {
  points: Array<{ time: number; price: number }>;
  options: {
    background: {
      color: string;
    };
    border: {
      color: string;
      width: number;
    };
    text?: {
      value: string;
      visible: boolean;
    };
  };
} {
  return {
    points: [
      { time: drawing.anchor1.timestamp / 1000, price: drawing.anchor1.price },
      { time: drawing.anchor2.timestamp / 1000, price: drawing.anchor2.price },
    ],
    options: {
      background: {
        color: drawing.fillColor,
      },
      border: {
        color: drawing.borderColor,
        width: drawing.borderWidth,
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
export function fromLineToolsRectangleFormat(
  lineToolData: {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  },
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<RectangleDrawing, "id" | "createdAt"> {
  const points = lineToolData.points;
  const options = lineToolData.options;
  const bgOptions = options.background as Record<string, unknown> || {};
  const borderOptions = options.border as Record<string, unknown> || {};
  const textOptions = options.text as Record<string, unknown> || {};

  return {
    type: "rectangle",
    anchor1: {
      timestamp: (points[0]?.time || 0) * 1000,
      price: points[0]?.price || 0,
    },
    anchor2: {
      timestamp: (points[1]?.time || 0) * 1000,
      price: points[1]?.price || 0,
    },
    fillColor: (bgOptions.color as string) || DEFAULT_DRAWING_COLORS.rectangle.fill,
    borderColor: (borderOptions.color as string) || DEFAULT_DRAWING_COLORS.rectangle.border,
    borderWidth: (borderOptions.width as number) || 1,
    showLabel: !!textOptions.visible,
    labelText: textOptions.value as string,
    createdBy,
  };
}
