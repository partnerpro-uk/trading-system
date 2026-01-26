/**
 * Position Tool
 *
 * Wrapper for visualizing trade positions with entry, TP, and SL
 * Uses lightweight-charts-line-tools LongShortPosition
 */

import {
  PositionDrawing,
  LongPositionDrawing,
  ShortPositionDrawing,
  DrawingAnchor,
  DEFAULT_DRAWING_COLORS,
  isLongPositionDrawing,
} from "../types";

/**
 * Position metrics
 */
export interface PositionMetrics {
  direction: "long" | "short";
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tpDistance: number;
  slDistance: number;
  tpPips: number;
  slPips: number;
  riskRewardRatio: number;
  potentialProfit: number;   // In price units
  potentialLoss: number;     // In price units
}

/**
 * Pip size for different pairs
 */
const PIP_SIZES: Record<string, number> = {
  // Forex pairs with JPY
  USD_JPY: 0.01,
  EUR_JPY: 0.01,
  GBP_JPY: 0.01,
  AUD_JPY: 0.01,
  CAD_JPY: 0.01,
  CHF_JPY: 0.01,
  NZD_JPY: 0.01,

  // Standard forex pairs
  EUR_USD: 0.0001,
  GBP_USD: 0.0001,
  AUD_USD: 0.0001,
  NZD_USD: 0.0001,
  USD_CAD: 0.0001,
  USD_CHF: 0.0001,

  // Gold
  XAU_USD: 0.1,

  // Bitcoin
  BTC_USD: 1,

  // Indices
  SPX500_USD: 0.1,
  DXY: 0.001,
};

/**
 * Get pip size for a pair
 */
export function getPipSize(pair: string): number {
  return PIP_SIZES[pair] || 0.0001;
}

/**
 * Calculate position metrics
 */
export function calculatePositionMetrics(
  direction: "long" | "short",
  entryPrice: number,
  takeProfitPrice: number,
  stopLossPrice: number,
  pair: string = "EUR_USD"
): PositionMetrics {
  const pipSize = getPipSize(pair);

  const tpDistance = Math.abs(takeProfitPrice - entryPrice);
  const slDistance = Math.abs(stopLossPrice - entryPrice);

  const tpPips = tpDistance / pipSize;
  const slPips = slDistance / pipSize;

  const riskRewardRatio = slPips > 0 ? tpPips / slPips : 0;

  // Calculate potential profit/loss
  const potentialProfit = direction === "long"
    ? takeProfitPrice - entryPrice
    : entryPrice - takeProfitPrice;

  const potentialLoss = direction === "long"
    ? entryPrice - stopLossPrice
    : stopLossPrice - entryPrice;

  return {
    direction,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpDistance,
    slDistance,
    tpPips,
    slPips,
    riskRewardRatio,
    potentialProfit,
    potentialLoss,
  };
}

/**
 * Validate position setup
 */
export function validatePosition(
  direction: "long" | "short",
  entryPrice: number,
  takeProfitPrice: number,
  stopLossPrice: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (direction === "long") {
    if (takeProfitPrice <= entryPrice) {
      errors.push("Take profit must be above entry for long positions");
    }
    if (stopLossPrice >= entryPrice) {
      errors.push("Stop loss must be below entry for long positions");
    }
  } else {
    if (takeProfitPrice >= entryPrice) {
      errors.push("Take profit must be below entry for short positions");
    }
    if (stopLossPrice <= entryPrice) {
      errors.push("Stop loss must be above entry for short positions");
    }
  }

  if (entryPrice <= 0 || takeProfitPrice <= 0 || stopLossPrice <= 0) {
    errors.push("All prices must be positive");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate break-even price including spread
 */
export function calculateBreakEven(
  direction: "long" | "short",
  entryPrice: number,
  spreadPips: number,
  pair: string = "EUR_USD"
): number {
  const pipSize = getPipSize(pair);
  const spreadCost = spreadPips * pipSize;

  return direction === "long"
    ? entryPrice + spreadCost
    : entryPrice - spreadCost;
}

/**
 * Calculate position size based on risk
 */
export function calculatePositionSize(
  accountBalance: number,
  riskPercent: number,
  entryPrice: number,
  stopLossPrice: number,
  pair: string = "EUR_USD"
): number {
  const pipSize = getPipSize(pair);
  const riskAmount = accountBalance * (riskPercent / 100);
  const slPips = Math.abs(entryPrice - stopLossPrice) / pipSize;

  if (slPips === 0) return 0;

  // Assuming $10 per pip per standard lot for most pairs
  const pipValue = 10;
  const positionSize = riskAmount / (slPips * pipValue);

  return Math.round(positionSize * 100) / 100;  // Round to 2 decimal places
}

/**
 * Get position colors
 */
export function getPositionColors(direction: "long" | "short", isProfit: boolean): {
  entryColor: string;
  tpColor: string;
  slColor: string;
  backgroundColor: string;
} {
  const colors = DEFAULT_DRAWING_COLORS.position[direction];

  return {
    entryColor: "#2196F3",  // Blue for entry
    tpColor: colors.profit,
    slColor: colors.loss,
    backgroundColor: isProfit
      ? "rgba(38, 166, 154, 0.1)"   // Green tint
      : "rgba(239, 83, 80, 0.1)",    // Red tint
  };
}

/**
 * Convert to lightweight-charts-line-tools format
 */
export function toLineToolsPositionFormat(
  drawing: PositionDrawing,
  pair: string = "EUR_USD"
): {
  points: Array<{ time: number; price: number }>;
  options: {
    side: 1 | -1;  // 1 = long, -1 = short
    profitPrice: number;
    stopPrice: number;
    quantity?: number;
    profitBackground?: string;
    stopBackground?: string;
    lineStyle?: number;
    lineWidth?: number;
  };
} {
  const isLong = isLongPositionDrawing(drawing);
  const direction = isLong ? "long" : "short";
  const colors = getPositionColors(direction, true);

  return {
    points: [
      { time: drawing.entry.timestamp / 1000, price: drawing.entry.price },
    ],
    options: {
      side: isLong ? 1 : -1,
      profitPrice: drawing.takeProfit,
      stopPrice: drawing.stopLoss,
      quantity: drawing.quantity,
      profitBackground: "rgba(38, 166, 154, 0.2)",
      stopBackground: "rgba(239, 83, 80, 0.2)",
      lineStyle: 0,  // Solid
      lineWidth: 1,
    },
  };
}

/**
 * Convert from lightweight-charts-line-tools format to our format
 */
export function fromLineToolsPositionFormat(
  lineToolData: {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  },
  createdBy: "user" | "strategy" | "claude" = "user"
): Omit<LongPositionDrawing, "id" | "createdAt"> | Omit<ShortPositionDrawing, "id" | "createdAt"> {
  const points = lineToolData.points;
  const options = lineToolData.options;

  const isLong = (options.side as number) === 1;
  const entryPrice = points[0]?.price || 0;
  const takeProfit = (options.profitPrice as number) || 0;
  const stopLoss = (options.stopPrice as number) || 0;

  const riskRewardRatio = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);

  return {
    type: isLong ? "longPosition" : "shortPosition",
    entry: {
      timestamp: (points[0]?.time || 0) * 1000,
      price: entryPrice,
    },
    takeProfit,
    stopLoss,
    quantity: options.quantity as number | undefined,
    riskRewardRatio,
    isActive: true,
    createdBy,
  };
}

/**
 * Create position from trade data
 */
export function createPositionFromTrade(
  trade: {
    direction: "LONG" | "SHORT";
    entryTime: number;
    entryPrice: number;
    takeProfit: number;
    stopLoss: number;
    quantity?: number;
  },
  tradeId?: string,
  strategyId?: string
): Omit<LongPositionDrawing, "id" | "createdAt"> | Omit<ShortPositionDrawing, "id" | "createdAt"> {
  const isLong = trade.direction === "LONG";
  const riskRewardRatio = Math.abs(trade.takeProfit - trade.entryPrice) /
                          Math.abs(trade.entryPrice - trade.stopLoss);

  return {
    type: isLong ? "longPosition" : "shortPosition",
    entry: {
      timestamp: trade.entryTime,
      price: trade.entryPrice,
    },
    takeProfit: trade.takeProfit,
    stopLoss: trade.stopLoss,
    quantity: trade.quantity,
    riskRewardRatio,
    isActive: true,
    tradeId,
    strategyId,
    createdBy: "strategy",
  };
}
