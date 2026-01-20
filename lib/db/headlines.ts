/**
 * Headlines & Drafts Queries
 *
 * Query functions for:
 * - news_headlines: GDELT/news feed for real-time awareness
 * - geopolitical_news_drafts: Claude-discovered events pending review
 */

import { getTimescalePool } from "./index";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsHeadline {
  id: string;
  source: string;
  headline: string;
  url: string;
  publishedAt: Date;
  countries: string[];
  themes: string[];
  currencies: string[];
  importanceScore: number;
  goldsteinScale: number | null;
}

export interface GeopoliticalDraft {
  id: string;
  discoveredAt: Date;
  discoveryTrigger: string;
  triggerPair: string | null;
  triggerDescription: string | null;
  headline: string;
  sourceUrl: string | null;
  sourceName: string | null;
  eventDate: Date;
  affectedPairs: string[];
  estimatedImpact: string;
  category: string;
  claudeSummary: string;
  status: "pending" | "approved" | "rejected" | "merged";
  reviewedAt: Date | null;
  mergedToEventId: string | null;
}

export interface CreateDraftInput {
  headline: string;
  sourceUrl?: string;
  sourceName?: string;
  eventDate: Date;
  affectedPairs: string[];
  estimatedImpact: string;
  category: string;
  claudeSummary: string;
  discoveryTrigger: string;
  triggerPair?: string;
  triggerDescription?: string;
  searchResults?: object;
}

// ═══════════════════════════════════════════════════════════════════════════
// NEWS HEADLINES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get recent headlines from the news_headlines table
 */
export async function getRecentHeadlines(options?: {
  currency?: string;
  hours?: number;
  minImportance?: number;
  limit?: number;
}): Promise<NewsHeadline[]> {
  const pool = getTimescalePool();
  const hours = options?.hours || 24;
  const minImportance = options?.minImportance || 5;
  const limit = options?.limit || 20;

  const result = await pool.query(
    `
    SELECT
      id, source, headline, url, published_at,
      countries, themes, currencies,
      importance_score, goldstein_scale
    FROM news_headlines
    WHERE published_at > NOW() - ($1 || ' hours')::INTERVAL
    AND importance_score >= $2
    ${options?.currency ? "AND $4 = ANY(currencies)" : ""}
    ORDER BY importance_score DESC, published_at DESC
    LIMIT $3
    `,
    options?.currency
      ? [hours.toString(), minImportance, limit, options.currency]
      : [hours.toString(), minImportance, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    headline: row.headline,
    url: row.url,
    publishedAt: row.published_at,
    countries: row.countries || [],
    themes: row.themes || [],
    currencies: row.currencies || [],
    importanceScore: row.importance_score,
    goldsteinScale: row.goldstein_scale,
  }));
}

/**
 * Get headlines for a specific pair
 */
export async function getHeadlinesForPair(
  pair: string,
  hours = 48
): Promise<NewsHeadline[]> {
  // Convert pair format: EUR_USD -> EUR, USD
  const currencies = pair.replace("_", "/").split("/");

  const pool = getTimescalePool();

  const result = await pool.query(
    `
    SELECT
      id, source, headline, url, published_at,
      countries, themes, currencies,
      importance_score, goldstein_scale
    FROM news_headlines
    WHERE published_at > NOW() - ($1 || ' hours')::INTERVAL
    AND currencies && $2::text[]
    ORDER BY importance_score DESC, published_at DESC
    LIMIT 30
    `,
    [hours.toString(), currencies]
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    headline: row.headline,
    url: row.url,
    publishedAt: row.published_at,
    countries: row.countries || [],
    themes: row.themes || [],
    currencies: row.currencies || [],
    importanceScore: row.importance_score,
    goldsteinScale: row.goldstein_scale,
  }));
}

/**
 * Search headlines by keyword
 */
export async function searchHeadlines(
  query: string,
  options?: {
    hours?: number;
    limit?: number;
  }
): Promise<NewsHeadline[]> {
  const pool = getTimescalePool();
  const hours = options?.hours || 72;
  const limit = options?.limit || 20;

  const result = await pool.query(
    `
    SELECT
      id, source, headline, url, published_at,
      countries, themes, currencies,
      importance_score, goldstein_scale
    FROM news_headlines
    WHERE published_at > NOW() - ($1 || ' hours')::INTERVAL
    AND headline ILIKE $2
    ORDER BY importance_score DESC, published_at DESC
    LIMIT $3
    `,
    [hours.toString(), `%${query}%`, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    headline: row.headline,
    url: row.url,
    publishedAt: row.published_at,
    countries: row.countries || [],
    themes: row.themes || [],
    currencies: row.currencies || [],
    importanceScore: row.importance_score,
    goldsteinScale: row.goldstein_scale,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOPOLITICAL NEWS DRAFTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new draft event (discovered by Claude)
 */
export async function createEventDraft(
  draft: CreateDraftInput
): Promise<string> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `
    INSERT INTO geopolitical_news_drafts (
      headline,
      source_url,
      source_name,
      event_date,
      affected_pairs,
      estimated_impact,
      category,
      claude_summary,
      discovery_trigger,
      trigger_pair,
      trigger_description,
      search_results
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
    `,
    [
      draft.headline,
      draft.sourceUrl || null,
      draft.sourceName || null,
      draft.eventDate,
      draft.affectedPairs,
      draft.estimatedImpact,
      draft.category,
      draft.claudeSummary,
      draft.discoveryTrigger,
      draft.triggerPair || null,
      draft.triggerDescription || null,
      draft.searchResults ? JSON.stringify(draft.searchResults) : null,
    ]
  );

  return result.rows[0].id;
}

/**
 * Get pending drafts for review
 */
export async function getPendingDrafts(): Promise<GeopoliticalDraft[]> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `
    SELECT
      id, discovered_at, discovery_trigger, trigger_pair, trigger_description,
      headline, source_url, source_name, event_date,
      affected_pairs, estimated_impact, category, claude_summary,
      status, reviewed_at, merged_to_event_id
    FROM geopolitical_news_drafts
    WHERE status = 'pending'
    ORDER BY discovered_at DESC
    `
  );

  return result.rows.map(mapDraftRow);
}

/**
 * Get all drafts (with optional status filter)
 */
export async function getDrafts(options?: {
  status?: string;
  limit?: number;
}): Promise<GeopoliticalDraft[]> {
  const pool = getTimescalePool();
  const limit = options?.limit || 50;

  let query = `
    SELECT
      id, discovered_at, discovery_trigger, trigger_pair, trigger_description,
      headline, source_url, source_name, event_date,
      affected_pairs, estimated_impact, category, claude_summary,
      status, reviewed_at, merged_to_event_id
    FROM geopolitical_news_drafts
  `;

  const params: (string | number)[] = [];

  if (options?.status) {
    query += ` WHERE status = $1`;
    params.push(options.status);
  }

  query += ` ORDER BY discovered_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows.map(mapDraftRow);
}

/**
 * Update draft status (approve/reject)
 */
export async function updateDraftStatus(
  id: string,
  status: "approved" | "rejected" | "merged",
  mergedToEventId?: string
): Promise<void> {
  const pool = getTimescalePool();

  await pool.query(
    `
    UPDATE geopolitical_news_drafts
    SET status = $2, reviewed_at = NOW(), merged_to_event_id = $3
    WHERE id = $1
    `,
    [id, status, mergedToEventId || null]
  );
}

/**
 * Check if a similar draft already exists
 */
export async function checkDuplicateDraft(
  headline: string,
  eventDate: Date
): Promise<boolean> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `
    SELECT 1 FROM geopolitical_news_drafts
    WHERE headline ILIKE $1
    AND event_date = $2
    AND status != 'rejected'
    LIMIT 1
    `,
    [`%${headline.substring(0, 50)}%`, eventDate]
  );

  return result.rows.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function mapDraftRow(row: Record<string, unknown>): GeopoliticalDraft {
  return {
    id: row.id as string,
    discoveredAt: row.discovered_at as Date,
    discoveryTrigger: row.discovery_trigger as string,
    triggerPair: row.trigger_pair as string | null,
    triggerDescription: row.trigger_description as string | null,
    headline: row.headline as string,
    sourceUrl: row.source_url as string | null,
    sourceName: row.source_name as string | null,
    eventDate: row.event_date as Date,
    affectedPairs: row.affected_pairs as string[],
    estimatedImpact: row.estimated_impact as string,
    category: row.category as string,
    claudeSummary: row.claude_summary as string,
    status: row.status as "pending" | "approved" | "rejected" | "merged",
    reviewedAt: row.reviewed_at as Date | null,
    mergedToEventId: row.merged_to_event_id as string | null,
  };
}
