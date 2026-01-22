/**
 * ForexFactory Parser Utilities
 *
 * Replicates the parsing logic from Python scraper/ffs.py
 * for use with Puppeteer/Cheerio in Node.js
 */

import { formatInTimeZone } from "date-fns-tz";

// Timezone constants
export const TZ_UTC = "UTC";
export const TZ_NEW_YORK = "America/New_York";
export const TZ_LONDON = "Europe/London";

// Currency to source timezone mapping (where economic data is released from)
export const CURRENCY_TIMEZONES: Record<string, string> = {
  USD: "America/New_York",
  GBP: "Europe/London",
  EUR: "Europe/Berlin", // ECB is in Frankfurt
  JPY: "Asia/Tokyo",
  AUD: "Australia/Sydney",
  NZD: "Pacific/Auckland",
  CAD: "America/Toronto",
  CHF: "Europe/Zurich",
  CNY: "Asia/Shanghai",
  HKD: "Asia/Hong_Kong",
  SGD: "Asia/Singapore",
  SEK: "Europe/Stockholm",
  NOK: "Europe/Oslo",
  MXN: "America/Mexico_City",
  ZAR: "Africa/Johannesburg",
  INR: "Asia/Kolkata",
};

// Readable timezone names
const TIMEZONE_NAMES: Record<string, string> = {
  "America/New_York": "US/Eastern",
  "Europe/London": "UK/London",
  "Europe/Berlin": "EU/Frankfurt",
  "Asia/Tokyo": "Asia/Tokyo",
  "Australia/Sydney": "AU/Sydney",
  "Pacific/Auckland": "NZ/Auckland",
  "America/Toronto": "CA/Toronto",
  "Europe/Zurich": "CH/Zurich",
  "Asia/Shanghai": "CN/Shanghai",
  "Asia/Hong_Kong": "HK/HongKong",
  "Asia/Singapore": "SG/Singapore",
  "Europe/Stockholm": "SE/Stockholm",
  "Europe/Oslo": "NO/Oslo",
  "America/Mexico_City": "MX/Mexico",
  "Africa/Johannesburg": "ZA/Joburg",
  "Asia/Kolkata": "IN/Mumbai",
};

// Impact normalization mapping (ForexFactory -> normalized)
const IMPACT_MAPPING: Record<string, string> = {
  "High Impact Expected": "high",
  "Medium Impact Expected": "medium",
  "Low Impact Expected": "low",
  "Non-Economic": "non_economic",
  "": "non_economic",
};

// Country code from currency
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  GBP: "GB",
  EUR: "EU",
  JPY: "JP",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  HKD: "HK",
  SGD: "SG",
  SEK: "SE",
  NOK: "NO",
  MXN: "MX",
  ZAR: "ZA",
  INR: "IN",
  BRL: "BR",
  KRW: "KR",
};

/**
 * Parse a numeric value from forex factory format.
 * Handles: 1.5%, 100K, 2.5M, 1.2B, -0.5%, etc.
 */
export function parseNumericValue(value: string | null | undefined): number | null {
  if (!value || value.trim() === "") {
    return null;
  }

  let cleaned = value.trim().replace(/,/g, "");
  // Remove HTML entities and non-breaking spaces
  cleaned = cleaned.replace(/&nbsp;/g, "").replace(/\u00a0/g, "");

  // Skip non-numeric values
  if (cleaned === "" || cleaned.toLowerCase() === "n/a" || cleaned.toLowerCase() === "data") {
    return null;
  }

  const multipliers: Record<string, number> = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
    T: 1_000_000_000_000,
  };

  let multiplier = 1;

  // Remove percentage sign
  cleaned = cleaned.replace(/%/g, "");

  // Check for magnitude suffix (case-insensitive)
  const upperCleaned = cleaned.toUpperCase();
  for (const [suffix, mult] of Object.entries(multipliers)) {
    if (upperCleaned.includes(suffix)) {
      multiplier = mult;
      cleaned = cleaned.replace(new RegExp(suffix, "gi"), "");
      break;
    }
  }

  try {
    const result = parseFloat(cleaned) * multiplier;
    return isNaN(result) ? null : result;
  } catch {
    return null;
  }
}

/**
 * Calculate outcome based on actual vs forecast values.
 * Returns 'beat', 'miss', 'met', or null if comparison not possible.
 */
export function calculateOutcome(
  actual: string | null,
  forecast: string | null
): "beat" | "miss" | "met" | null {
  const actualNum = parseNumericValue(actual);
  const forecastNum = parseNumericValue(forecast);

  if (actualNum === null || forecastNum === null) {
    return null;
  }

  // Use small epsilon for float comparison
  const epsilon = forecastNum !== 0 ? Math.abs(forecastNum * 0.0001) : 0.0001;

  if (actualNum > forecastNum + epsilon) {
    return "beat";
  } else if (actualNum < forecastNum - epsilon) {
    return "miss";
  } else {
    return "met";
  }
}

/**
 * Calculate deviation and percentage deviation.
 */
export function calculateDeviation(
  actual: string | null,
  forecast: string | null
): { deviation: number | null; deviationPct: number | null } {
  const actualNum = parseNumericValue(actual);
  const forecastNum = parseNumericValue(forecast);

  if (actualNum === null || forecastNum === null) {
    return { deviation: null, deviationPct: null };
  }

  const deviation = actualNum - forecastNum;
  const deviationPct = forecastNum !== 0 ? (deviation / Math.abs(forecastNum)) * 100 : null;

  return { deviation, deviationPct };
}

/**
 * Determine forex trading session based on UTC hour.
 *
 * Trading sessions (in UTC):
 * - Sydney/Asian: 21:00 - 06:00 UTC (wraps midnight)
 * - London: 07:00 - 16:00 UTC
 * - New York: 12:00 - 21:00 UTC
 */
export function getTradingSession(date: Date): string {
  const utcHour = date.getUTCHours();

  // Session ranges in UTC
  const sydneyStart = 21,
    sydneyEnd = 6; // 21:00 - 06:00 (wraps midnight)
  const londonStart = 7,
    londonEnd = 16; // 07:00 - 16:00
  const nyStart = 12,
    nyEnd = 21; // 12:00 - 21:00

  const inSydney = utcHour >= sydneyStart || utcHour < sydneyEnd;
  const inLondon = utcHour >= londonStart && utcHour < londonEnd;
  const inNY = utcHour >= nyStart && utcHour < nyEnd;

  // Check for overlaps first (most active periods)
  if (inLondon && inNY) {
    return "london_ny_overlap";
  } else if (inSydney && inLondon) {
    return "asian_london_overlap";
  } else if (inLondon) {
    return "london";
  } else if (inNY) {
    return "new_york";
  } else if (inSydney) {
    return "asian";
  } else {
    return "off_hours";
  }
}

/**
 * Get day of week abbreviation.
 */
export function getDayOfWeek(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[date.getUTCDay()];
}

/**
 * Normalize event name for use in event ID.
 * Replaces non-alphanumeric with underscores, truncates to 20 chars.
 */
export function normalizeEventName(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9]/g, "_");
  // Remove consecutive underscores
  normalized = normalized.replace(/_+/g, "_");
  // Remove leading/trailing underscores
  normalized = normalized.replace(/^_|_$/g, "");
  // Truncate to 20 characters
  return normalized.substring(0, 20);
}

/**
 * Generate a unique event ID.
 * Format: {normalized_name}_{currency}_{YYYY-MM-DD}_{HH:MM}
 */
export function generateEventId(eventName: string, currency: string, date: Date): string {
  const normalized = normalizeEventName(eventName);
  const dateStr = formatInTimeZone(date, TZ_UTC, "yyyy-MM-dd");
  const timeStr = formatInTimeZone(date, TZ_UTC, "HH:mm");
  return `${normalized}_${currency}_${dateStr}_${timeStr}`;
}

/**
 * Normalize impact level.
 */
export function normalizeImpact(rawImpact: string | null | undefined): string {
  if (!rawImpact) return "non_economic";
  return IMPACT_MAPPING[rawImpact] || "non_economic";
}

/**
 * Get event type from event name (uppercase, underscored).
 */
export function getEventType(eventName: string): string {
  return eventName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Get country code from currency.
 */
export function getCountry(currency: string): string {
  return CURRENCY_TO_COUNTRY[currency.toUpperCase()] || currency;
}

/**
 * Get source timezone info for a currency.
 */
export function getSourceTimezone(currency: string): { tz: string; name: string } {
  const tz = CURRENCY_TIMEZONES[currency.toUpperCase()] || TZ_UTC;
  const name = TIMEZONE_NAMES[tz] || "UTC";
  return { tz, name };
}

/**
 * Determine if event is scheduled or released.
 */
export function determineEventStatus(actual: string | null | undefined): "scheduled" | "released" {
  if (actual && actual.trim() !== "") {
    return "released";
  }
  return "scheduled";
}

/**
 * Parse time string from ForexFactory.
 * Handles: "2:30pm", "10:30am", "Day", "Data", "Tentative"
 *
 * Returns: { hour, minute, isAllDay, isDataMarker }
 */
export function parseTimeString(
  timeStr: string
): { hour: number; minute: number; isAllDay: boolean; isDataMarker: boolean } | null {
  const cleaned = timeStr.trim().toLowerCase();

  if (cleaned === "" || cleaned === "tentative") {
    return null;
  }

  // All-day event
  if (cleaned.includes("day")) {
    return { hour: 23, minute: 59, isAllDay: true, isDataMarker: false };
  }

  // Historical data marker
  if (cleaned.includes("data")) {
    return { hour: 0, minute: 0, isAllDay: false, isDataMarker: true };
  }

  // Parse regular time: "2:30pm", "10:30am", "8am"
  // Format can be "H:MMam/pm" (6 chars) or "HH:MMam/pm" (7 chars)
  const match = cleaned.match(/^(\d{1,2}):?(\d{2})?(am|pm)$/);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const isPM = match[3] === "pm";

  // Convert to 24-hour format
  if (isPM && hour !== 12) {
    hour += 12;
  } else if (!isPM && hour === 12) {
    hour = 0;
  }

  return { hour, minute, isAllDay: false, isDataMarker: false };
}

/**
 * Parse date string from ForexFactory.
 * Format: "Mon Jan 20" or "MonJan 20" (sometimes no space)
 */
export function parseDateString(
  dateStr: string,
  _referenceYear: number // Kept for future use with year inference
): { month: number; day: number } | null {
  const cleaned = dateStr.trim().replace(/\n/g, "");

  // Match patterns like "Mon Jan 20" or "MonJan 20"
  const match = cleaned.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*([A-Za-z]{3})\s*(\d{1,2})/i);
  if (!match) {
    return null;
  }

  const monthNames: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const month = monthNames[match[1].toLowerCase()];
  const day = parseInt(match[2], 10);

  if (month === undefined || isNaN(day)) {
    return null;
  }

  return { month, day };
}

/**
 * Build date URL for ForexFactory calendar (single day).
 * Format: "jan20.2026" (month lowercase, day without leading zero)
 */
export function buildDateUrl(date: Date): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `calendar?day=${month}${day}.${year}`;
}

/**
 * Build week URL for ForexFactory calendar (full week view).
 * Format: "jan20.2026" - FF will show the week containing this date
 * Much more efficient than day-by-day scraping (7x fewer requests)
 */
export function buildWeekUrl(date: Date): string {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `calendar?week=${month}${day}.${year}`;
}

/**
 * Full event record structure matching TimescaleDB schema.
 */
export interface NewsEventRecord {
  eventId: string;
  eventType: string;
  name: string;
  country: string;
  currency: string;
  timestamp: Date;
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  datetimeUtc: string;
  datetimeNewYork: string;
  datetimeLondon: string;
  sourceTz: string;
  dayOfWeek: string;
  tradingSession: string;
  status: "scheduled" | "released";
  outcome: "beat" | "miss" | "met" | null;
  deviation: number | null;
  deviationPct: number | null;
  scrapedAt: Date;
}

/**
 * Build a complete event record from parsed data.
 */
export function buildEventRecord(
  date: Date,
  currency: string,
  rawImpact: string,
  eventName: string,
  actual: string | null,
  forecast: string | null,
  previous: string | null
): NewsEventRecord {
  const eventId = generateEventId(eventName, currency, date);
  const { name: sourceTzName } = getSourceTimezone(currency);
  const outcome = calculateOutcome(actual, forecast);
  const { deviation, deviationPct } = calculateDeviation(actual, forecast);

  return {
    eventId,
    eventType: getEventType(eventName),
    name: eventName,
    country: getCountry(currency),
    currency,
    timestamp: date,
    impact: normalizeImpact(rawImpact),
    actual: actual || null,
    forecast: forecast || null,
    previous: previous || null,
    datetimeUtc: formatInTimeZone(date, TZ_UTC, "yyyy-MM-dd HH:mm:ss"),
    datetimeNewYork: formatInTimeZone(date, TZ_NEW_YORK, "yyyy-MM-dd HH:mm:ss"),
    datetimeLondon: formatInTimeZone(date, TZ_LONDON, "yyyy-MM-dd HH:mm:ss"),
    sourceTz: sourceTzName,
    dayOfWeek: getDayOfWeek(date),
    tradingSession: getTradingSession(date),
    status: determineEventStatus(actual),
    outcome,
    deviation,
    deviationPct,
    scrapedAt: new Date(),
  };
}
