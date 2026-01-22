/**
 * Rate Limiter for Historical Backfill
 *
 * Implements request throttling with exponential backoff to avoid
 * getting blocked by ForexFactory.
 */

export interface RateLimiterOptions {
  minDelayMs: number; // Minimum delay between requests
  maxDelayMs: number; // Maximum delay after multiple retries
  maxRetries: number; // Maximum retries per request
}

const DEFAULT_OPTIONS: RateLimiterOptions = {
  minDelayMs: 3000, // 3 seconds minimum
  maxDelayMs: 120000, // 2 minutes maximum
  maxRetries: 10,
};

export class RateLimiter {
  private options: RateLimiterOptions;
  private lastRequestTime: number = 0;
  private consecutiveErrors: number = 0;
  private currentDelay: number;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.currentDelay = this.options.minDelayMs;
  }

  /**
   * Wait for the appropriate delay before next request.
   */
  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const remaining = this.currentDelay - elapsed;

    if (remaining > 0) {
      await this.sleep(remaining);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Report a successful request - reset backoff.
   */
  onSuccess(): void {
    this.consecutiveErrors = 0;
    this.currentDelay = this.options.minDelayMs;
  }

  /**
   * Report an error - increase backoff delay.
   * Returns true if we should retry, false if max retries exceeded.
   */
  onError(statusCode?: number): boolean {
    this.consecutiveErrors++;

    // Exponential backoff: delay doubles each time
    this.currentDelay = Math.min(
      this.options.minDelayMs * Math.pow(2, this.consecutiveErrors),
      this.options.maxDelayMs
    );

    // Special handling for rate limit (429) and server errors (503)
    if (statusCode === 429 || statusCode === 503) {
      // Extra long delay for explicit rate limits
      this.currentDelay = Math.min(this.currentDelay * 2, this.options.maxDelayMs);
      console.log(
        `[RateLimiter] Rate limited (${statusCode}). Backing off to ${this.currentDelay}ms`
      );
    } else {
      console.log(
        `[RateLimiter] Error (attempt ${this.consecutiveErrors}). Delay: ${this.currentDelay}ms`
      );
    }

    return this.consecutiveErrors < this.options.maxRetries;
  }

  /**
   * Get current retry count.
   */
  getRetryCount(): number {
    return this.consecutiveErrors;
  }

  /**
   * Get current delay in ms.
   */
  getCurrentDelay(): number {
    return this.currentDelay;
  }

  /**
   * Reset the rate limiter state.
   */
  reset(): void {
    this.consecutiveErrors = 0;
    this.currentDelay = this.options.minDelayMs;
    this.lastRequestTime = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Utility to execute a function with automatic retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  limiter: RateLimiter,
  description: string
): Promise<T> {
  while (true) {
    await limiter.wait();

    try {
      const result = await fn();
      limiter.onSuccess();
      return result;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (!limiter.onError(statusCode)) {
        console.error(`[RateLimiter] Max retries exceeded for: ${description}`);
        throw error;
      }

      console.log(`[RateLimiter] Retrying: ${description}`);
    }
  }
}
