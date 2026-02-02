/**
 * Drawing Tools Types
 *
 * Defines the data structures for chart drawings.
 * These types are used for persistence and Claude queryability.
 */

/**
 * Anchor point for drawings - ties to specific time/price coordinates
 */
export interface DrawingAnchor {
  timestamp: number;  // Candle time (Unix ms)
  price: number;      // Y coordinate
}

/**
 * Drawing creator type
 */
export type DrawingCreator = "user" | "strategy" | "claude";

/**
 * Price level semantic context for Claude understanding
 */
export interface PriceLevelContext {
  significance: string;   // "weekly high", "fib 0.618", "round number"
  lastTested?: number;    // Timestamp of last touch
  testCount?: number;     // How many times price tested this level
}

/**
 * Base drawing interface
 */
export interface BaseDrawing {
  id: string;
  type: DrawingType;
  strategyId?: string;   // Associated strategy
  tradeId?: string;      // Associated trade
  createdAt: number;
  updatedAt?: number;
  createdBy: DrawingCreator;

  // Claude-readable metadata
  label?: string;           // User-assigned name: "High", "Support Zone", "Entry Target"
  labelColor?: string;      // Custom label color (defaults to drawing color)
  notes?: string;           // Free-form notes: "Price rejected here 3 times"
  tags?: string[];          // Categorization: ["resistance", "weekly", "strong"]
  importance?: "low" | "medium" | "high";  // Visual weight for Claude prioritization

  // Semantic context
  priceLevel?: PriceLevelContext;

  // Lock status (prevents user editing/moving)
  locked?: boolean;         // If true, drawing cannot be moved or edited by user
}

/**
 * Supported drawing types
 */
export type DrawingType =
  | "fibonacci"
  | "trendline"
  | "ray"
  | "horizontalRay"
  | "arrow"
  | "extendedLine"
  | "horizontalLine"
  | "verticalLine"
  | "rectangle"
  | "circle"
  | "parallelChannel"
  | "longPosition"
  | "shortPosition"
  | "markerArrowUp"
  | "markerArrowDown"
  | "markerCircle"
  | "markerSquare";

/**
 * Fibonacci Retracement Drawing
 */
export interface FibonacciDrawing extends BaseDrawing {
  type: "fibonacci";
  anchor1: DrawingAnchor;
  anchor2: DrawingAnchor;
  levels: number[];           // e.g., [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
  extendLeft: boolean;
  extendRight: boolean;
  showLabels: boolean;
  showPrices: boolean;
  lineColor: string;
  levelColors?: Record<number, string>;  // Custom colors per level
}

/**
 * Trendline Drawing
 */
export interface TrendlineDrawing extends BaseDrawing {
  type: "trendline" | "ray" | "arrow" | "extendedLine";
  anchor1: DrawingAnchor;
  anchor2: DrawingAnchor;
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  showLabel?: boolean;
  labelText?: string;
}

/**
 * Horizontal Line Drawing
 */
export interface HorizontalLineDrawing extends BaseDrawing {
  type: "horizontalLine";
  price: number;
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  showLabel: boolean;
  labelText?: string;
  labelPosition?: "above" | "below" | "middle";  // Default: "middle"
}

/**
 * Horizontal Ray Drawing
 * Starts at a point and extends horizontally to the right
 */
export interface HorizontalRayDrawing extends BaseDrawing {
  type: "horizontalRay";
  anchor: DrawingAnchor;  // Start point (timestamp + price)
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  labelPosition?: "above" | "below" | "middle";  // Default: "middle"
}

/**
 * Vertical Line Drawing
 */
export interface VerticalLineDrawing extends BaseDrawing {
  type: "verticalLine";
  timestamp: number;
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  showLabel: boolean;
  labelText?: string;
}

/**
 * Rectangle Drawing
 */
export interface RectangleDrawing extends BaseDrawing {
  type: "rectangle";
  anchor1: DrawingAnchor;
  anchor2: DrawingAnchor;
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  showLabel?: boolean;
  labelText?: string;
}

/**
 * Circle Drawing
 * Defined by center point (anchor1) and a point on edge (anchor2)
 */
export interface CircleDrawing extends BaseDrawing {
  type: "circle";
  anchor1: DrawingAnchor;  // Center point
  anchor2: DrawingAnchor;  // Point on edge (defines radius)
  fillColor: string;
  borderColor: string;
  borderWidth: number;
}

/**
 * Parallel Channel Drawing
 */
export interface ParallelChannelDrawing extends BaseDrawing {
  type: "parallelChannel";
  anchor1: DrawingAnchor;
  anchor2: DrawingAnchor;
  anchor3: DrawingAnchor;  // Third point defines channel width
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  extendLeft: boolean;
  extendRight: boolean;
}

/**
 * Position status for signal/trade lifecycle
 * - signal: Strategy-generated, not yet traded (visual only)
 * - pending: User confirmed intent to trade, waiting for fill
 * - open: Trade is active with entry filled
 * - closed: Trade completed (hit TP, SL, or manually closed)
 */
export type PositionStatus = "signal" | "pending" | "open" | "closed";

/**
 * Base Position Drawing (shared properties)
 */
interface BasePositionDrawing extends BaseDrawing {
  entry: DrawingAnchor;
  takeProfit: number;
  stopLoss: number;
  endTimestamp?: number;       // Right edge of position (for resizable width)
  quantity?: number;
  riskRewardRatio?: number;
  isActive?: boolean;

  // Colors (line color determines zone fill)
  tpColor?: string;            // Take profit line/zone color (default: #26A69A)
  slColor?: string;            // Stop loss line/zone color (default: #EF5350)

  // Trade tracking data
  candleCount?: number;        // How many candles the position spans
  outcome?: "tp" | "sl" | "manual" | "pending";  // How the trade ended
  exitTimestamp?: number;      // When the trade was closed
  exitPrice?: number;          // Price at which trade was closed

  // Convex sync
  convexTradeId?: string;      // ID of linked trade in Convex
  syncedToConvex?: boolean;    // Whether this position has been synced

  // Signal/Trade lifecycle status
  status?: PositionStatus;     // Signal lifecycle state (default: "open" for backwards compat)
  confirmedAt?: number;        // When user clicked "Take Trade" (signal → pending/open)
  entryFilledAt?: number;      // When entry was filled (pending → open)
  closedAt?: number;           // When trade closed
  closedReason?: "tp" | "sl" | "manual" | "timeout";  // Why the trade closed
}

/**
 * Long Position Drawing (for visualizing long trades)
 */
export interface LongPositionDrawing extends BasePositionDrawing {
  type: "longPosition";
}

/**
 * Short Position Drawing (for visualizing short trades)
 */
export interface ShortPositionDrawing extends BasePositionDrawing {
  type: "shortPosition";
}

/**
 * Union type for position drawings
 */
export type PositionDrawing = LongPositionDrawing | ShortPositionDrawing;

/**
 * Marker shape types (for single-point candle markers)
 */
export type MarkerShape = "arrowUp" | "arrowDown" | "circle" | "square";

/**
 * Marker Drawing
 * Single-point markers placed on specific candles
 */
export interface MarkerDrawing extends BaseDrawing {
  type: "markerArrowUp" | "markerArrowDown" | "markerCircle" | "markerSquare";
  anchor: DrawingAnchor;         // The candle to place marker on
  shape: MarkerShape;            // Visual shape
  color: string;                 // Marker color
  position: "aboveBar" | "belowBar" | "inBar";  // Position relative to candle
  size?: number;                 // Size multiplier (default: 1)
  text?: string;                 // Optional label text
}

/**
 * Union of all drawing types
 */
export type Drawing =
  | FibonacciDrawing
  | TrendlineDrawing
  | HorizontalLineDrawing
  | HorizontalRayDrawing
  | VerticalLineDrawing
  | RectangleDrawing
  | CircleDrawing
  | ParallelChannelDrawing
  | LongPositionDrawing
  | ShortPositionDrawing
  | MarkerDrawing;

/**
 * Drawing state for a specific chart view
 */
export interface DrawingState {
  pair: string;
  timeframe: string;
  drawings: Drawing[];
  lastUpdated: number;
}

/**
 * Drawing options for creating new drawings
 */
export interface CreateDrawingOptions {
  type: DrawingType;
  strategyId?: string;
  tradeId?: string;
  createdBy?: DrawingCreator;
}

/**
 * Default Fibonacci levels
 */
export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Extended Fibonacci levels (includes extensions)
 */
export const EXTENDED_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2.618];

/**
 * Default colors for drawing tools
 */
export const DEFAULT_DRAWING_COLORS = {
  fibonacci: {
    line: "#787B86",
    levels: {
      0: "#787B86",
      0.236: "#F7525F",
      0.382: "#FF9800",
      0.5: "#4CAF50",
      0.618: "#2196F3",
      0.786: "#9C27B0",
      1: "#787B86",
    },
  },
  trendline: "#2962FF",
  horizontalLine: "#787B86",
  verticalLine: "#787B86",
  rectangle: {
    fill: "rgba(33, 150, 243, 0.1)",
    border: "#2196F3",
  },
  circle: {
    fill: "rgba(156, 39, 176, 0.1)",
    border: "#9C27B0",
  },
  position: {
    long: {
      profit: "#26A69A",
      loss: "#EF5350",
    },
    short: {
      profit: "#26A69A",
      loss: "#EF5350",
    },
  },
  marker: {
    arrowUp: "#22C55E",    // Green for bullish
    arrowDown: "#EF5350",  // Red for bearish
    circle: "#3B82F6",     // Blue
    square: "#F59E0B",     // Amber
  },
};

/**
 * Type guard functions
 */
export function isFibonacciDrawing(drawing: Drawing): drawing is FibonacciDrawing {
  return drawing.type === "fibonacci";
}

export function isTrendlineDrawing(drawing: Drawing): drawing is TrendlineDrawing {
  return ["trendline", "ray", "arrow", "extendedLine"].includes(drawing.type);
}

export function isHorizontalLineDrawing(drawing: Drawing): drawing is HorizontalLineDrawing {
  return drawing.type === "horizontalLine";
}

export function isHorizontalRayDrawing(drawing: Drawing): drawing is HorizontalRayDrawing {
  return drawing.type === "horizontalRay";
}

export function isVerticalLineDrawing(drawing: Drawing): drawing is VerticalLineDrawing {
  return drawing.type === "verticalLine";
}

export function isRectangleDrawing(drawing: Drawing): drawing is RectangleDrawing {
  return drawing.type === "rectangle";
}

export function isCircleDrawing(drawing: Drawing): drawing is CircleDrawing {
  return drawing.type === "circle";
}

export function isPositionDrawing(drawing: Drawing): drawing is PositionDrawing {
  return drawing.type === "longPosition" || drawing.type === "shortPosition";
}

export function isLongPositionDrawing(drawing: Drawing): drawing is LongPositionDrawing {
  return drawing.type === "longPosition";
}

export function isShortPositionDrawing(drawing: Drawing): drawing is ShortPositionDrawing {
  return drawing.type === "shortPosition";
}

export function isMarkerDrawing(drawing: Drawing): drawing is MarkerDrawing {
  return ["markerArrowUp", "markerArrowDown", "markerCircle", "markerSquare"].includes(drawing.type);
}

/**
 * Check if a drawing is locked (either explicitly or because it's strategy-generated)
 */
export function isDrawingLocked(drawing: Drawing): boolean {
  return drawing.locked === true || drawing.createdBy === "strategy";
}
