// Math Utility Functions

/**
 * Clamp a value between lo and hi bounds
 */
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Clamp an integer value between lo and hi bounds
 */
export function clampInt(v: number | string, lo: number, hi: number): number {
  const n = Math.floor(Number(v) || 0);
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Simple Moving Average
 */
export function sma(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Standard Deviation
 */
export function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = sma(values);
  const v = values.reduce((s, x) => s + (x - m) * (x - m), 0) / values.length;
  return Math.sqrt(Math.max(0, v));
}

/**
 * Median of an array
 */
export function mMedian(vals: number[]): number {
  if (!vals.length) return 0;
  const a = [...vals].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Calculate quantile from a 1D array
 */
export function quantile1D(arr: number[], q: number): number {
  if (!arr || arr.length === 0) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const t = (a.length - 1) * q;
  const i0 = Math.floor(t);
  const i1 = Math.min(a.length - 1, i0 + 1);
  const f = t - i0;
  return a[i0] + (a[i1] - a[i0]) * f;
}

/**
 * Decimate array to max N elements, keeping first and last
 */
export function decimateEvery<T>(arr: T[] | null | undefined, maxN: number): T[] {
  const n = arr ? arr.length : 0;
  if (!n || n <= maxN) return arr || [];
  const step = Math.ceil(n / maxN);
  const out: T[] = [];
  for (let i = 0; i < n; i += step) out.push(arr![i]);
  if (out[out.length - 1] !== arr![n - 1]) out.push(arr![n - 1]);
  return out;
}

/**
 * Safely bound an array index
 */
export function safeSliceIndex(n: number, i: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}
