/**
 * In-memory rate limiting using sliding window algorithm
 *
 * For single instance deployments. If you scale to multiple instances,
 * replace this with Upstash Redis (@upstash/ratelimit).
 */

interface RateLimitEntry {
  timestamps: number[]; // Timestamps of requests in current window
}

// In-memory store: key -> request timestamps
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(): void {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window

  for (const [key, entry] of store.entries()) {
    // Remove timestamps older than window
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

    // Remove entry if no timestamps remain
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp (ms) when the oldest request expires
  limit: number;
}

/**
 * Check if a request is allowed under the rate limit
 *
 * @param key - Unique identifier (e.g., API key ID or IP address)
 * @param limit - Maximum requests per minute
 * @returns Whether the request is allowed and rate limit info
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window

  // Periodic cleanup
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanup();
    lastCleanup = now;
  }

  // Get or create entry
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside current window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  // Calculate reset time (when oldest request in window expires)
  const resetAt =
    entry.timestamps.length > 0
      ? entry.timestamps[0] + windowMs
      : now + windowMs;

  // Check if under limit
  if (entry.timestamps.length < limit) {
    // Allow request
    entry.timestamps.push(now);
    return {
      allowed: true,
      remaining: limit - entry.timestamps.length,
      resetAt,
      limit,
    };
  }

  // Rate limited
  return {
    allowed: false,
    remaining: 0,
    resetAt,
    limit,
  };
}

/**
 * Get current rate limit status without consuming a request
 */
export function getRateLimitStatus(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const windowMs = 60 * 1000;

  const entry = store.get(key);
  if (!entry) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: now + windowMs,
      limit,
    };
  }

  // Count requests in current window
  const recentTimestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
  const resetAt =
    recentTimestamps.length > 0
      ? recentTimestamps[0] + windowMs
      : now + windowMs;

  return {
    allowed: recentTimestamps.length < limit,
    remaining: Math.max(0, limit - recentTimestamps.length),
    resetAt,
    limit,
  };
}

/**
 * Clear rate limit for a key (useful for testing)
 */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Clear all rate limits (useful for testing)
 */
export function clearAllRateLimits(): void {
  store.clear();
}
