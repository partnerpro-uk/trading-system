// Date/Time Utility Functions

export type ParseMode = "utc" | "local";

/**
 * Parse a date from various string formats
 */
export function parseDateFromString(
  raw: string | number | null | undefined,
  parseMode: ParseMode
): Date | null {
  if (raw == null) return null;
  const s = (typeof raw === "string" ? raw : String(raw)).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const num = Number(s);
    if (!Number.isFinite(num)) return null;
    const ms = s.length >= 13 ? num : num * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6] ?? 0);
    const d =
      parseMode === "utc"
        ? new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss, 0))
        : new Date(yyyy, mm - 1, dd, hh, mi, ss, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert YYYY-MM-DD string to start-of-day milliseconds
 */
export function ymdToStartMs(
  ymd: string | null | undefined,
  parseMode: ParseMode
): number | null {
  if (!ymd) return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return null;
  return parseMode === "utc"
    ? Date.UTC(y, mo, d, 0, 0, 0, 0)
    : new Date(y, mo, d, 0, 0, 0, 0).getTime();
}

/**
 * Convert YYYY-MM-DD string to end-of-day milliseconds (exclusive)
 */
export function ymdToEndExclusiveMs(
  ymd: string | null | undefined,
  parseMode: ParseMode
): number | null {
  const start = ymdToStartMs(ymd, parseMode);
  if (start == null) return null;
  const oneDay = 24 * 60 * 60 * 1000;
  return start + oneDay;
}

/**
 * Format timestamp to locale string
 */
export function formatDateTime(
  raw: string | number | null | undefined,
  parseMode: ParseMode
): string {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return (raw as string) ?? "-";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Calculate minutes between two timestamps
 */
export function minutesBetween(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  parseMode: ParseMode
): number | null {
  const da = parseDateFromString(a, parseMode);
  const db = parseDateFromString(b, parseMode);
  if (!da || !db) return null;
  const diff = db.getTime() - da.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, diff / 60000);
}

/**
 * Infer candle interval in minutes from candle timestamps
 */
export function inferCandleMinutes(
  candles: Array<{ time?: string | number }> | null | undefined,
  parseMode: ParseMode
): number | null {
  if (!candles || candles.length < 2) return null;
  const maxProbe = Math.min(12, candles.length - 1);
  for (let i = 1; i <= maxProbe; i++) {
    const a = candles[i - 1]?.time;
    const b = candles[i]?.time;
    const m = a && b ? minutesBetween(a, b, parseMode) : null;
    if (typeof m === "number" && Number.isFinite(m) && m > 0) return m;
  }
  return null;
}

/**
 * Add N months to a UTC date
 */
export const addMonthsUTC = (d: Date, n: number): Date => {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
};

/**
 * Get start of month for a UTC date
 */
export const startOfMonthUTC = (d: Date): Date => {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/**
 * Get start of week (Sunday) for a UTC date
 */
export function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay();
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

/**
 * Build a 42-day calendar grid starting from Sunday
 */
export function buildMonthGridUTC(monthDateUTC: Date): Array<{
  dateUTC: Date;
  inMonth: boolean;
  dateKey: string;
}> {
  const first = startOfMonthUTC(monthDateUTC);
  const gridStart = startOfWeekUTC(first);
  const days: Array<{ dateUTC: Date; inMonth: boolean; dateKey: string }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dayNum = String(d.getUTCDate()).padStart(2, "0");
    days.push({
      dateUTC: d,
      inMonth: d.getUTCMonth() === monthDateUTC.getUTCMonth(),
      dateKey: `${y}-${m}-${dayNum}`,
    });
  }
  return days;
}

/**
 * Get trading session from timestamp hour
 */
export function sessionFromTime(
  raw: string | number | null | undefined,
  parseMode: ParseMode
): string {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return "Sydney";
  const h =
    parseMode === "utc"
      ? d.getUTCHours() + d.getUTCMinutes() / 60
      : d.getHours() + d.getMinutes() / 60;
  if (h >= 16 || h < 1) return "Tokyo";
  if (h >= 12 && h < 21) return "Sydney";
  if (h >= 0 && h < 9) return "London";
  if (h >= 5 && h < 14) return "New York";
  return "London";
}

/**
 * Check if session is allowed based on enabled sessions map
 */
export function isSessionAllowed(
  raw: string | number | null | undefined,
  enabled: Record<string, boolean>,
  parseMode: ParseMode
): boolean {
  return !!enabled[sessionFromTime(raw, parseMode)];
}

/**
 * Normalize hour to [0,1] range for daily seasonality
 */
export function timeOfDayUnit(
  raw: string | number | null | undefined,
  parseMode: ParseMode
): number {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return 0.5;
  const h =
    parseMode === "utc"
      ? d.getUTCHours() + d.getUTCMinutes() / 60
      : d.getHours() + d.getMinutes() / 60;
  return Math.max(0, Math.min(1, h / 24));
}

/**
 * Normalize day-of-year to [0,1] range
 */
export function dayOfYearUnit(
  raw: string | number | null | undefined,
  parseMode: ParseMode
): number {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return 0.5;
  const yyyy = parseMode === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const start =
    parseMode === "utc" ? new Date(Date.UTC(yyyy, 0, 0)) : new Date(yyyy, 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const doy = Math.floor(diff / oneDay);
  return Math.max(0, Math.min(1, doy / 366));
}
