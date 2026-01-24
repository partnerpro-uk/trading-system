// Trade Filter Utility Functions

import {
  parseDateFromString,
  ymdToStartMs,
  ymdToEndExclusiveMs,
  ParseMode,
} from "./dateTime";
import type { Trade } from "./types";

/**
 * Check if all months are enabled
 */
export function allMonthsEnabled(months: Record<number, boolean>): boolean {
  for (let i = 0; i < 12; i++) {
    if (!months[i]) return false;
  }
  return true;
}

/**
 * Check if all days of week are enabled
 */
export function allDowsEnabled(dows: Record<number, boolean>): boolean {
  for (let i = 0; i < 7; i++) {
    if (!dows[i]) return false;
  }
  return true;
}

/**
 * Check if all hours are enabled
 */
export function allHoursEnabled(hours: Record<number, boolean>): boolean {
  for (let i = 0; i < 24; i++) {
    if (!hours[i]) return false;
  }
  return true;
}

/**
 * Check if years filter is effectively a no-op
 */
export function yearsFilterIsNoop(
  years: Record<number, boolean> | null | undefined
): boolean {
  if (!years) return true;
  for (const k of Object.keys(years)) {
    const yn = Number(k);
    if (Number.isFinite(yn) && years[yn] === false) return false;
  }
  return true;
}

/**
 * Extract year value from trade timestamp
 */
export function tradeYearValue(trade: Trade, parseMode: ParseMode): number {
  const raw = trade?.entryTime ?? trade?.exitTime ?? trade?.time;
  if (!raw) return -1;
  const d = parseDateFromString(raw, parseMode);
  if (!d) return -1;
  return parseMode === "utc" ? d.getUTCFullYear() : d.getFullYear();
}

/**
 * Filter trades by enabled years
 */
export function filterTradesByYears<T extends Trade>(
  tradesList: T[] | null | undefined,
  years: Record<number, boolean> | null | undefined,
  parseMode: ParseMode
): T[] {
  if (!Array.isArray(tradesList) || tradesList.length === 0)
    return tradesList || [];
  if (yearsFilterIsNoop(years)) return tradesList;
  return tradesList.filter((t) => {
    const y = tradeYearValue(t, parseMode);
    if (y < 0) return true;
    const v = years![y];
    if (v === false) return false;
    return true;
  });
}

/**
 * Extract month index (0-11) from trade timestamp
 */
export function tradeMonthIndex(trade: Trade, parseMode: ParseMode): number {
  const raw = trade?.entryTime ?? trade?.exitTime ?? trade?.time;
  if (!raw) return -1;
  const d = parseDateFromString(raw, parseMode);
  if (!d) return -1;
  return parseMode === "utc" ? d.getUTCMonth() : d.getMonth();
}

/**
 * Filter trades by enabled months
 */
export function filterTradesByMonths<T extends Trade>(
  tradesList: T[] | null | undefined,
  months: Record<number, boolean> | null | undefined,
  parseMode: ParseMode
): T[] {
  if (!Array.isArray(tradesList) || tradesList.length === 0)
    return tradesList || [];
  if (!months || allMonthsEnabled(months)) return tradesList;
  return tradesList.filter((t) => {
    const mi = tradeMonthIndex(t, parseMode);
    if (mi < 0 || mi > 11) return true;
    return !!months[mi];
  });
}

/**
 * Extract day of week (0-6) from trade timestamp
 */
export function tradeDowIndex(trade: Trade, parseMode: ParseMode): number {
  const raw = trade?.entryTime ?? trade?.exitTime ?? trade?.time;
  if (!raw) return -1;
  const d = parseDateFromString(raw, parseMode);
  if (!d) return -1;
  return parseMode === "utc" ? d.getUTCDay() : d.getDay();
}

/**
 * Filter trades by enabled days of week
 */
export function filterTradesByDows<T extends Trade>(
  tradesList: T[] | null | undefined,
  dows: Record<number, boolean> | null | undefined,
  parseMode: ParseMode
): T[] {
  if (!Array.isArray(tradesList) || tradesList.length === 0)
    return tradesList || [];
  if (!dows || allDowsEnabled(dows)) return tradesList;
  return tradesList.filter((t) => {
    const di = tradeDowIndex(t, parseMode);
    if (di < 0 || di > 6) return true;
    return !!dows[di];
  });
}

/**
 * Extract hour (0-23) from trade timestamp
 */
export function tradeHourIndex(trade: Trade, parseMode: ParseMode): number {
  const raw = trade?.entryTime ?? trade?.exitTime ?? trade?.time;
  if (!raw) return -1;
  const d = parseDateFromString(raw, parseMode);
  if (!d) return -1;
  return parseMode === "utc" ? d.getUTCHours() : d.getHours();
}

/**
 * Filter trades by enabled hours
 */
export function filterTradesByHours<T extends Trade>(
  tradesList: T[] | null | undefined,
  hours: Record<number, boolean> | null | undefined,
  parseMode: ParseMode
): T[] {
  if (!Array.isArray(tradesList) || tradesList.length === 0)
    return tradesList || [];
  if (!hours || allHoursEnabled(hours)) return tradesList;
  return tradesList.filter((t) => {
    const hi = tradeHourIndex(t, parseMode);
    if (hi < 0 || hi > 23) return true;
    return !!hours[hi];
  });
}

/**
 * Filter trades by date range (YYYY-MM-DD strings)
 */
export function filterTradesByDateRange<T extends Trade>(
  tradesList: T[] | null | undefined,
  startYmd: string | null | undefined,
  endYmd: string | null | undefined,
  parseMode: ParseMode
): T[] {
  if (!Array.isArray(tradesList) || tradesList.length === 0)
    return tradesList || [];
  const start = ymdToStartMs(startYmd, parseMode);
  const endEx = ymdToEndExclusiveMs(endYmd, parseMode);
  if (start == null && endEx == null) return tradesList;
  return tradesList.filter((t) => {
    const raw = t?.entryTime ?? t?.exitTime ?? t?.time;
    const d = raw ? parseDateFromString(raw, parseMode) : null;
    if (!d) return true;
    const ts = d.getTime();
    if (start != null && ts < start) return false;
    if (endEx != null && ts >= endEx) return false;
    return true;
  });
}
