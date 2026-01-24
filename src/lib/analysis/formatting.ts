// Formatting Utility Functions

/**
 * Format a number as signed USD currency (e.g., +$100.00 or -$50.00)
 */
export const fmtSignedUSD = (x: number): string => {
  if (!Number.isFinite(x)) return "–";
  const sign = x > 0 ? "+" : x < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 2 })
  );
};

/**
 * Format a number as USD currency (e.g., $100.00 or -$50.00)
 */
export const fmtUSD = (x: number): string => {
  if (!Number.isFinite(x)) return "–";
  return (
    (x < 0 ? "-" : "") +
    "$" +
    Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 2 })
  );
};

/**
 * Get Tailwind CSS class for money value (green/red/neutral)
 */
export const moneyClass = (x: number): string => {
  return x > 0
    ? "text-emerald-400"
    : x < 0
    ? "text-rose-400"
    : "text-neutral-400";
};

/**
 * Format a number with specified decimal places
 */
export function formatNumber(value: number, decimals: number = 2): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse interval string to minutes (e.g., "15min" -> 15, "1h" -> 60)
 */
export function parseIntervalToMinutes(s: string | null | undefined): number {
  if (!s) return 1;
  const m = s.toLowerCase().trim();
  const numMatch = m.match(/\d+/);
  const n = numMatch ? Number(numMatch[0]) : 1;
  if (m.includes("min")) return n;
  if (m.includes("hour") || m.includes("hr") || m.includes("h")) return n * 60;
  if (m.includes("day") || m.includes("d")) return n * 1440;
  return 1;
}

/**
 * Format minutes as short duration string (e.g., "5d 2h", "3h 15m")
 */
export function formatMinutesShort(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return "-";
  if (mins === 0) return "0m";
  const total = Math.round(mins);
  const days = Math.floor(total / (60 * 24));
  const remAfterDays = total - days * 60 * 24;
  const hours = Math.floor(remAfterDays / 60);
  const minutes = remAfterDays - hours * 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Humanize duration in minutes (e.g., "5 Days and 3 Hours")
 */
export function humanizeDurationMinutes(totalMin: number): string {
  const minutes = Math.max(0, Math.round(totalMin));
  const parts: string[] = [];
  const days = Math.floor(minutes / 1440);
  const remAfterDays = minutes % 1440;
  const hours = Math.floor(remAfterDays / 60);
  const mins = remAfterDays % 60;

  const push = (n: number, w: string) => {
    if (n > 0) parts.push(`${n} ${w}${n === 1 ? "" : "s"}`);
  };
  push(days, "Day");
  push(hours, "Hour");
  push(mins, "Minute");

  if (!parts.length) return "0 Minutes";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
