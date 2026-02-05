/**
 * API Key management utilities
 *
 * Key format: trd_<32 random chars>
 * Example: trd_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 *
 * Storage: Only the SHA-256 hash is stored in DB
 * The full key is only shown once at creation time
 */

import { createHash, randomBytes } from "crypto";
import { getTimescalePool } from "./db";

const KEY_PREFIX = "trd_";

export interface ApiKeyInfo {
  id: string;
  name: string;
  tier: string;
  rateLimitPerMinute: number;
  allowedPairs: string[];
  allowedTimeframes: string[];
}

export interface ApiKeyValidationResult {
  valid: boolean;
  keyInfo?: ApiKeyInfo;
  error?: string;
}

// In-memory cache for validated keys (avoids DB hit on every request)
const keyCache = new Map<string, { info: ApiKeyInfo; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Generate a new API key
 * Returns the full key (only shown once) and the hash for storage
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const randomPart = randomBytes(24).toString("base64url"); // 32 chars
  const key = `${KEY_PREFIX}${randomPart}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, 8);

  return { key, hash, prefix };
}

/**
 * Hash an API key for storage/comparison
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate an API key and return key info
 * Uses in-memory cache to avoid DB hits
 */
export async function validateApiKey(key: string): Promise<ApiKeyValidationResult> {
  if (!key || !key.startsWith(KEY_PREFIX)) {
    return { valid: false, error: "Invalid API key format" };
  }

  const hash = hashApiKey(key);

  // Check cache first
  const cached = keyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return { valid: true, keyInfo: cached.info };
  }

  // Query database
  const pool = getTimescalePool();

  try {
    const result = await pool.query(
      `SELECT id, name, tier, rate_limit_per_minute, allowed_pairs, allowed_timeframes,
              is_active, expires_at
       FROM api_keys
       WHERE key_hash = $1`,
      [hash]
    );

    if (result.rows.length === 0) {
      return { valid: false, error: "Invalid API key" };
    }

    const row = result.rows[0];

    if (!row.is_active) {
      return { valid: false, error: "API key has been revoked" };
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { valid: false, error: "API key has expired" };
    }

    const keyInfo: ApiKeyInfo = {
      id: row.id,
      name: row.name,
      tier: row.tier,
      rateLimitPerMinute: row.rate_limit_per_minute,
      allowedPairs: row.allowed_pairs || [],
      allowedTimeframes: row.allowed_timeframes || [],
    };

    // Cache the result
    keyCache.set(hash, {
      info: keyInfo,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    // Update last_used_at and total_requests in background (don't await)
    pool
      .query(
        `UPDATE api_keys SET last_used_at = NOW(), total_requests = total_requests + 1 WHERE id = $1`,
        [keyInfo.id]
      )
      .catch(() => {}); // Ignore errors

    return { valid: true, keyInfo };
  } catch (error) {
    console.error("Error validating API key:", error);
    return { valid: false, error: "Internal error validating API key" };
  }
}

/**
 * Create a new API key in the database
 */
export async function createApiKey(params: {
  name: string;
  email?: string;
  description?: string;
  tier?: string;
  rateLimitPerMinute?: number;
  allowedPairs?: string[];
  allowedTimeframes?: string[];
  expiresAt?: Date;
}): Promise<{ key: string; id: string }> {
  const { key, hash, prefix } = generateApiKey();
  const pool = getTimescalePool();

  const result = await pool.query(
    `INSERT INTO api_keys (
      key_prefix, key_hash, name, email, description,
      tier, rate_limit_per_minute, allowed_pairs, allowed_timeframes, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      prefix,
      hash,
      params.name,
      params.email || null,
      params.description || null,
      params.tier || "free",
      params.rateLimitPerMinute || 60,
      params.allowedPairs || [],
      params.allowedTimeframes || [],
      params.expiresAt || null,
    ]
  );

  return { key, id: result.rows[0].id };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(id: string, reason?: string): Promise<boolean> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `UPDATE api_keys
     SET is_active = false, revoked_at = NOW(), revoked_reason = $2
     WHERE id = $1`,
    [id, reason || null]
  );

  // Clear from cache
  // Note: We'd need to iterate cache to find by ID, but cache expires quickly anyway

  return (result.rowCount || 0) > 0;
}

/**
 * List all API keys (without the actual key, just metadata)
 */
export async function listApiKeys(): Promise<
  Array<{
    id: string;
    keyPrefix: string;
    name: string;
    email: string | null;
    tier: string;
    isActive: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
    totalRequests: number;
  }>
> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `SELECT id, key_prefix, name, email, tier, is_active, created_at, last_used_at, total_requests
     FROM api_keys
     ORDER BY created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    name: row.name,
    email: row.email,
    tier: row.tier,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    totalRequests: Number(row.total_requests),
  }));
}

/**
 * Clear the key cache (useful for testing or after revoking keys)
 */
export function clearKeyCache(): void {
  keyCache.clear();
}
