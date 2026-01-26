/**
 * Trading Session Utilities
 *
 * Detects trading sessions based on timestamp and provides
 * duration formatting for trade analysis.
 */

export type TradingSession = "Sydney" | "Tokyo" | "London" | "New York" | "Overlap";

/**
 * Session time ranges in UTC hours
 * Note: Sessions overlap, so we prioritize certain sessions
 */
const SESSION_HOURS = {
  sydney: { start: 21, end: 6 },   // 21:00 - 06:00 UTC (wraps midnight)
  tokyo: { start: 0, end: 9 },     // 00:00 - 09:00 UTC
  london: { start: 7, end: 16 },   // 07:00 - 16:00 UTC
  newYork: { start: 12, end: 21 }, // 12:00 - 21:00 UTC
};

/**
 * Detect which trading session a timestamp falls into
 * Priority: Overlap > London > New York > Tokyo > Sydney
 */
export function detectSession(timestamp: number): TradingSession {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();

  // London/NY overlap (highest liquidity)
  if (utcHour >= 12 && utcHour < 16) {
    return "Overlap";
  }

  // London session (excluding overlap)
  if (utcHour >= 7 && utcHour < 12) {
    return "London";
  }

  // New York session (excluding overlap)
  if (utcHour >= 16 && utcHour < 21) {
    return "New York";
  }

  // Tokyo session
  if (utcHour >= 0 && utcHour < 9) {
    return "Tokyo";
  }

  // Sydney session (evening hours before Tokyo)
  return "Sydney";
}

/**
 * Get session color for UI display
 */
export function getSessionColor(session: TradingSession): string {
  switch (session) {
    case "Sydney":
      return "#9333EA"; // Purple
    case "Tokyo":
      return "#DC2626"; // Red (Japan flag)
    case "London":
      return "#2563EB"; // Blue (UK)
    case "New York":
      return "#16A34A"; // Green (USD)
    case "Overlap":
      return "#F59E0B"; // Amber (high liquidity)
    default:
      return "#6B7280"; // Gray
  }
}

/**
 * Format duration between two timestamps
 */
export function formatDuration(entryTime: number, exitTime: number): string {
  const diffMs = exitTime - entryTime;

  if (diffMs < 0) return "Invalid";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

/**
 * Format duration in candles based on timeframe
 */
export function formatCandleDuration(candleCount: number, timeframe: string): string {
  const tfMinutes = parseTimeframeMinutes(timeframe);
  const totalMinutes = candleCount * tfMinutes;

  const hours = Math.floor(totalMinutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${candleCount} candles (~${days}d)`;
  }

  if (hours > 0) {
    return `${candleCount} candles (~${hours}h)`;
  }

  return `${candleCount} candles (~${totalMinutes}m)`;
}

/**
 * Parse timeframe string to minutes
 */
function parseTimeframeMinutes(timeframe: string): number {
  const match = timeframe.match(/^(\d+)([mhDWM])$/);
  if (!match) return 1; // Default to 1 minute

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "D":
      return value * 60 * 24;
    case "W":
      return value * 60 * 24 * 7;
    case "M":
      return value * 60 * 24 * 30;
    default:
      return value;
  }
}

/**
 * Get session display info
 */
export function getSessionInfo(session: TradingSession): {
  name: string;
  abbreviation: string;
  color: string;
  description: string;
} {
  switch (session) {
    case "Sydney":
      return {
        name: "Sydney",
        abbreviation: "SYD",
        color: getSessionColor(session),
        description: "Asian session opening",
      };
    case "Tokyo":
      return {
        name: "Tokyo",
        abbreviation: "TKY",
        color: getSessionColor(session),
        description: "Asian session peak",
      };
    case "London":
      return {
        name: "London",
        abbreviation: "LDN",
        color: getSessionColor(session),
        description: "European session",
      };
    case "New York":
      return {
        name: "New York",
        abbreviation: "NYC",
        color: getSessionColor(session),
        description: "American session",
      };
    case "Overlap":
      return {
        name: "London/NY Overlap",
        abbreviation: "OVL",
        color: getSessionColor(session),
        description: "Highest liquidity period",
      };
    default:
      return {
        name: "Unknown",
        abbreviation: "???",
        color: "#6B7280",
        description: "",
      };
  }
}

/**
 * Format a timestamp as a readable date/time string
 */
export function formatTradeTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Calculate R multiple for a trade
 *
 * @param entryPrice Entry price
 * @param exitPrice Exit price
 * @param stopLoss Stop loss price
 * @param direction Trade direction (LONG or SHORT)
 * @returns R multiple (positive = profit, negative = loss)
 */
export function calculateRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  direction: "LONG" | "SHORT"
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk === 0) return 0;

  const pnl =
    direction === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;

  return pnl / risk;
}

/**
 * Calculate P&L in pips for forex pairs
 *
 * @param entryPrice Entry price
 * @param exitPrice Exit price
 * @param direction Trade direction
 * @param pair Currency pair (for pip calculation)
 * @returns P&L in pips
 */
export function calculatePnlPips(
  entryPrice: number,
  exitPrice: number,
  direction: "LONG" | "SHORT",
  pair: string
): number {
  const pnl =
    direction === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice;

  // JPY pairs have 2 decimal places (100 pips = 1.00)
  // All other pairs have 4-5 decimal places (10000 pips = 1.0000)
  const isJPYPair = pair.includes("JPY");
  const pipMultiplier = isJPYPair ? 100 : 10000;

  return pnl * pipMultiplier;
}
