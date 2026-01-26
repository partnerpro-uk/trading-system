/**
 * Indicator Primitives
 *
 * Core indicator implementations. Each primitive is a pure function
 * that takes candle data and returns computed values.
 */

// Moving Averages
export { computeEMA, getEMAAtTimestamp, EMA_DEFAULTS } from "./ema";
export type { EMAParams } from "./ema";

export { computeSMA, getSMAAtTimestamp, SMA_DEFAULTS } from "./sma";
export type { SMAParams } from "./sma";

// Volatility
export { computeATR, getATRAtTimestamp, getATRMultiple, ATR_DEFAULTS } from "./atr";
export type { ATRParams } from "./atr";

// Momentum
export {
  computeRSI,
  isOverbought,
  isOversold,
  detectRSIDivergence,
  getRSIZone,
  RSI_DEFAULTS,
} from "./rsi";
export type { RSIParams } from "./rsi";

// Trend (MACD)
export {
  computeMACD,
  detectMACDCrossover,
  detectMACDZeroCrossover,
  getHistogramDirection,
  getMACDState,
  MACD_DEFAULTS,
} from "./macd";
export type { MACDParams, MACDOutput } from "./macd";

// Volatility (Bollinger)
export {
  computeBollinger,
  isTouchingUpperBand,
  isTouchingLowerBand,
  isOutsideBands,
  detectSqueeze,
  getBollingerPosition,
  detectBandExpansion,
  BOLLINGER_DEFAULTS,
} from "./bollinger";
export type { BollingerParams, BollingerOutput } from "./bollinger";
