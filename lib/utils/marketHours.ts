/**
 * Forex Market Hours Utility
 *
 * Forex market is open 24/5:
 * - Opens: Sunday 5:00 PM EST (22:00 UTC)
 * - Closes: Friday 5:00 PM EST (22:00 UTC)
 *
 * Sessions:
 * - Sydney: 5:00 PM - 2:00 AM EST
 * - Tokyo: 7:00 PM - 4:00 AM EST
 * - London: 3:00 AM - 12:00 PM EST
 * - New York: 8:00 AM - 5:00 PM EST
 */

export type MarketSession = "sydney" | "tokyo" | "london" | "new_york" | "closed";

interface MarketStatus {
  isOpen: boolean;
  currentSession: MarketSession;
  sessionsActive: MarketSession[];
  nextOpen: Date | null;
  nextClose: Date | null;
}

// Convert local time to EST (UTC-5, or UTC-4 during DST)
function getESTHour(date: Date): { day: number; hour: number; minute: number } {
  // Create a formatter for EST timezone
  const estOptions: Intl.DateTimeFormatOptions = {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  };

  const parts = new Intl.DateTimeFormat("en-US", estOptions).formatToParts(date);
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value || "";
  const hourPart = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minutePart = parseInt(parts.find((p) => p.type === "minute")?.value || "0");

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: dayMap[weekdayPart] ?? 0,
    hour: hourPart,
    minute: minutePart,
  };
}

export function isForexMarketOpen(date: Date = new Date()): boolean {
  const { day, hour } = getESTHour(date);

  // Closed all day Saturday
  if (day === 6) return false;

  // Sunday: opens at 5 PM EST
  if (day === 0) {
    return hour >= 17;
  }

  // Friday: closes at 5 PM EST
  if (day === 5) {
    return hour < 17;
  }

  // Mon-Thu: open 24 hours
  return true;
}

export function getActiveSessions(date: Date = new Date()): MarketSession[] {
  if (!isForexMarketOpen(date)) return [];

  const { hour } = getESTHour(date);
  const sessions: MarketSession[] = [];

  // Sydney: 5:00 PM - 2:00 AM EST (17:00 - 02:00)
  if (hour >= 17 || hour < 2) {
    sessions.push("sydney");
  }

  // Tokyo: 7:00 PM - 4:00 AM EST (19:00 - 04:00)
  if (hour >= 19 || hour < 4) {
    sessions.push("tokyo");
  }

  // London: 3:00 AM - 12:00 PM EST (03:00 - 12:00)
  if (hour >= 3 && hour < 12) {
    sessions.push("london");
  }

  // New York: 8:00 AM - 5:00 PM EST (08:00 - 17:00)
  if (hour >= 8 && hour < 17) {
    sessions.push("new_york");
  }

  return sessions;
}

export function getPrimarySession(date: Date = new Date()): MarketSession {
  const sessions = getActiveSessions(date);

  if (sessions.length === 0) return "closed";

  // Priority: New York > London > Tokyo > Sydney
  if (sessions.includes("new_york")) return "new_york";
  if (sessions.includes("london")) return "london";
  if (sessions.includes("tokyo")) return "tokyo";
  if (sessions.includes("sydney")) return "sydney";

  return "closed";
}

export function getNextMarketOpen(date: Date = new Date()): Date {
  const { day, hour } = getESTHour(date);

  // If market is open, return null or current time
  if (isForexMarketOpen(date)) {
    return date;
  }

  const result = new Date(date);

  if (day === 6) {
    // Saturday: next open is Sunday 5 PM EST
    result.setDate(result.getDate() + 1);
  } else if (day === 0 && hour < 17) {
    // Sunday before 5 PM: opens today at 5 PM EST
    // Keep same day
  } else if (day === 5 && hour >= 17) {
    // Friday after 5 PM: next open is Sunday 5 PM EST
    result.setDate(result.getDate() + 2);
  }

  // Set to 5 PM EST (22:00 UTC approximately)
  // This is simplified - proper implementation would use timezone library
  result.setHours(17, 0, 0, 0);

  return result;
}

export function getNextMarketClose(date: Date = new Date()): Date | null {
  if (!isForexMarketOpen(date)) return null;

  const { day } = getESTHour(date);
  const result = new Date(date);

  // Find next Friday
  const daysUntilFriday = (5 - day + 7) % 7 || 7;

  if (day === 5) {
    // Already Friday, closes today at 5 PM EST
    result.setHours(17, 0, 0, 0);
  } else {
    result.setDate(result.getDate() + daysUntilFriday);
    result.setHours(17, 0, 0, 0);
  }

  return result;
}

export function getMarketStatus(date: Date = new Date()): MarketStatus {
  const isOpen = isForexMarketOpen(date);
  const sessionsActive = getActiveSessions(date);
  const currentSession = getPrimarySession(date);

  return {
    isOpen,
    currentSession,
    sessionsActive,
    nextOpen: isOpen ? null : getNextMarketOpen(date),
    nextClose: isOpen ? getNextMarketClose(date) : null,
  };
}

export function formatTimeUntil(target: Date): string {
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return "now";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}
