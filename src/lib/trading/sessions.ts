/**
 * Trading Session Detection Utilities
 *
 * Detects which trading session a timestamp falls into based on major forex market hours.
 */

export type TradingSession = "Sydney" | "Tokyo" | "London" | "New York" | "Overlap";

interface SessionInfo {
  name: TradingSession;
  abbreviation: string;
  color: string;
  hours: string;
}

const SESSION_INFO: Record<TradingSession, SessionInfo> = {
  Sydney: {
    name: "Sydney",
    abbreviation: "SYD",
    color: "#9333EA", // Purple
    hours: "21:00 - 06:00 UTC",
  },
  Tokyo: {
    name: "Tokyo",
    abbreviation: "TKY",
    color: "#F97316", // Orange
    hours: "00:00 - 09:00 UTC",
  },
  London: {
    name: "London",
    abbreviation: "LDN",
    color: "#3B82F6", // Blue
    hours: "07:00 - 16:00 UTC",
  },
  "New York": {
    name: "New York",
    abbreviation: "NYC",
    color: "#22C55E", // Green
    hours: "12:00 - 21:00 UTC",
  },
  Overlap: {
    name: "Overlap",
    abbreviation: "LDN/NYC",
    color: "#EAB308", // Yellow
    hours: "12:00 - 16:00 UTC",
  },
};

/**
 * Detect which trading session a timestamp falls into.
 *
 * Session times (approximate, UTC):
 * - Sydney: 21:00 - 06:00 UTC
 * - Tokyo: 00:00 - 09:00 UTC
 * - London: 07:00 - 16:00 UTC
 * - New York: 12:00 - 21:00 UTC
 * - Overlap (London/NY): 12:00 - 16:00 UTC
 */
export function detectSession(timestamp: number): TradingSession {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();

  // London/NY overlap: 12:00 - 16:00 UTC (highest liquidity)
  if (utcHour >= 12 && utcHour < 16) {
    return "Overlap";
  }

  // London: 07:00 - 16:00 UTC
  if (utcHour >= 7 && utcHour < 16) {
    return "London";
  }

  // New York: 12:00 - 21:00 UTC
  if (utcHour >= 12 && utcHour < 21) {
    return "New York";
  }

  // Tokyo: 00:00 - 09:00 UTC
  if (utcHour >= 0 && utcHour < 9) {
    return "Tokyo";
  }

  // Sydney: 21:00 - 06:00 UTC (wraps around midnight)
  return "Sydney";
}

/**
 * Format duration between two timestamps as human-readable string.
 */
export function formatDuration(entryTime: number, exitTime: number): string {
  const diffMs = exitTime - entryTime;

  if (diffMs < 0) return "0m";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get the color associated with a trading session.
 */
export function getSessionColor(session: TradingSession): string {
  return SESSION_INFO[session].color;
}

/**
 * Get full session info including name, abbreviation, color, and hours.
 */
export function getSessionInfo(session: TradingSession): SessionInfo {
  return SESSION_INFO[session];
}

/**
 * Get all session info for display purposes.
 */
export function getAllSessions(): SessionInfo[] {
  return Object.values(SESSION_INFO);
}

/**
 * Check if a timestamp is during a specific session.
 */
export function isDuringSession(timestamp: number, session: TradingSession): boolean {
  return detectSession(timestamp) === session;
}

/**
 * Get the next session open time after a given timestamp.
 */
export function getNextSessionOpen(timestamp: number, session: TradingSession): Date {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();

  // Session start hours (UTC)
  const sessionStarts: Record<TradingSession, number> = {
    Sydney: 21,
    Tokyo: 0,
    London: 7,
    "New York": 12,
    Overlap: 12, // Same as NY start
  };

  const startHour = sessionStarts[session];
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);

  if (utcHour >= startHour) {
    // Already past start, move to next day
    result.setUTCDate(result.getUTCDate() + 1);
  }
  result.setUTCHours(startHour);

  return result;
}

/**
 * Calculate R multiple for a trade.
 * R = (exit - entry) / (entry - stopLoss) for longs
 * R = (entry - exit) / (stopLoss - entry) for shorts
 */
export function calculateRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopLoss: number,
  direction: "LONG" | "SHORT"
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk === 0) return 0;

  const reward =
    direction === "LONG"
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

  return reward / risk;
}
