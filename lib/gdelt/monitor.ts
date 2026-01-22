/**
 * GDELT News Monitor
 *
 * Fetches geopolitical headlines from GDELT Project API
 * and stores high-importance ones to the news_headlines table.
 *
 * GDELT API: https://api.gdeltproject.org/
 */

import { getTimescalePool } from "../db";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface GDELTArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
  language: string;
  sourcecountry?: string;
  socialimage?: string;
}

interface GDELTResponse {
  articles?: GDELTArticle[];
}

interface ScoredHeadline {
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

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Keywords that indicate geopolitically significant news
const HIGH_VALUE_KEYWORDS = [
  "war",
  "invasion",
  "sanctions",
  "military strike",
  "nuclear",
  "missile",
  "troops deployed",
];

const MEDIUM_VALUE_KEYWORDS = [
  "tariff",
  "conflict",
  "crisis",
  "troops",
  "embargo",
  "blockade",
  "escalation",
  "ceasefire",
  "peace talks",
  "intervention",
];

// Countries that matter for forex markets
const FOREX_COUNTRIES: Record<string, string[]> = {
  "United States": ["USD"],
  USA: ["USD"],
  US: ["USD"],
  China: ["CNH", "AUD"],
  Russia: ["EUR", "XAU"],
  Ukraine: ["EUR", "XAU"],
  Israel: ["XAU"],
  Iran: ["XAU", "OIL"],
  Venezuela: ["OIL", "USD"],
  "United Kingdom": ["GBP"],
  UK: ["GBP"],
  Japan: ["JPY"],
  Europe: ["EUR"],
  EU: ["EUR"],
  Germany: ["EUR"],
  France: ["EUR"],
  Australia: ["AUD"],
  Canada: ["CAD"],
  Switzerland: ["CHF"],
  "Saudi Arabia": ["OIL", "USD"],
  Taiwan: ["AUD", "JPY"],
};

// ═══════════════════════════════════════════════════════════════════════════
// GDELT API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch articles from GDELT DOC API
 */
async function fetchGDELTArticles(): Promise<GDELTArticle[]> {
  const keywords = [
    "war",
    "sanctions",
    "military",
    "invasion",
    "conflict",
    "crisis",
    "tariff",
    "nuclear",
  ];

  const query = encodeURIComponent(`(${keywords.join(" OR ")}) sourcelang:eng`);

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=75&format=json&sort=datedesc`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "TradingSystem/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`GDELT API error: ${response.status}`);
    }

    const data: GDELTResponse = await response.json();
    return data.articles || [];
  } catch (error) {
    console.error("GDELT fetch error:", error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCORING ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate importance score (0-10) for an article
 */
function calculateImportance(article: GDELTArticle): number {
  let score = 0;
  const title = article.title.toLowerCase();

  // High-value keywords (+3 each, max 6)
  let highMatches = 0;
  for (const keyword of HIGH_VALUE_KEYWORDS) {
    if (title.includes(keyword)) {
      highMatches++;
      if (highMatches <= 2) score += 3;
    }
  }

  // Medium-value keywords (+2 each, max 4)
  let medMatches = 0;
  for (const keyword of MEDIUM_VALUE_KEYWORDS) {
    if (title.includes(keyword)) {
      medMatches++;
      if (medMatches <= 2) score += 2;
    }
  }

  // Country relevance (+2)
  const countries = extractCountries(article);
  if (countries.length > 0) {
    score += 2;
  }

  // Multiple countries = likely international event (+1)
  if (countries.length >= 2) {
    score += 1;
  }

  return Math.min(10, score);
}

/**
 * Extract countries mentioned in title/source
 */
function extractCountries(article: GDELTArticle): string[] {
  const countries: string[] = [];
  const text = `${article.title} ${article.sourcecountry || ""}`.toLowerCase();

  for (const country of Object.keys(FOREX_COUNTRIES)) {
    if (text.includes(country.toLowerCase())) {
      countries.push(country);
    }
  }

  return [...new Set(countries)];
}

/**
 * Map countries to affected currencies
 */
function mapCountriesToCurrencies(countries: string[]): string[] {
  const currencies: string[] = [];

  for (const country of countries) {
    const mapped = FOREX_COUNTRIES[country];
    if (mapped) {
      currencies.push(...mapped);
    }
  }

  // Always include XAU for geopolitical events
  if (currencies.length > 0 && !currencies.includes("XAU")) {
    currencies.push("XAU");
  }

  return [...new Set(currencies)];
}

/**
 * Extract themes from title
 */
function extractThemes(title: string): string[] {
  const themes: string[] = [];
  const lower = title.toLowerCase();

  if (lower.includes("war") || lower.includes("military") || lower.includes("troops")) {
    themes.push("military");
  }
  if (lower.includes("sanction") || lower.includes("embargo")) {
    themes.push("sanctions");
  }
  if (lower.includes("oil") || lower.includes("energy") || lower.includes("gas")) {
    themes.push("energy");
  }
  if (lower.includes("nuclear")) {
    themes.push("nuclear");
  }
  if (lower.includes("tariff") || lower.includes("trade")) {
    themes.push("trade");
  }
  if (lower.includes("crisis")) {
    themes.push("crisis");
  }
  if (lower.includes("election") || lower.includes("vote")) {
    themes.push("political");
  }

  return themes;
}

/**
 * Parse GDELT date format (YYYYMMDDHHMMSS) to Date
 */
function parseGDELTDate(seendate: string): Date {
  // Format: YYYYMMDDHHMMSS
  const year = parseInt(seendate.substring(0, 4));
  const month = parseInt(seendate.substring(4, 6)) - 1;
  const day = parseInt(seendate.substring(6, 8));
  const hour = parseInt(seendate.substring(8, 10));
  const minute = parseInt(seendate.substring(10, 12));
  const second = parseInt(seendate.substring(12, 14));

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE INSERT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Insert scored headlines to database
 */
async function insertHeadlines(headlines: ScoredHeadline[]): Promise<number> {
  if (headlines.length === 0) return 0;

  const pool = getTimescalePool();
  let inserted = 0;

  for (const h of headlines) {
    try {
      await pool.query(
        `
        INSERT INTO news_headlines (
          source, headline, url, published_at,
          countries, themes, currencies,
          importance_score, goldstein_scale
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (source, url) DO UPDATE SET
          importance_score = GREATEST(news_headlines.importance_score, EXCLUDED.importance_score),
          fetched_at = NOW()
        `,
        [
          h.source,
          h.headline,
          h.url,
          h.publishedAt,
          h.countries,
          h.themes,
          h.currencies,
          h.importanceScore,
          h.goldsteinScale,
        ]
      );
      inserted++;
    } catch {
      // Likely duplicate or constraint violation, skip
      console.warn(`Failed to insert headline: ${h.headline.substring(0, 50)}...`);
    }
  }

  return inserted;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch GDELT headlines, score them, and store high-importance ones
 */
export async function fetchGDELTHeadlines(): Promise<{
  fetched: number;
  scored: number;
  inserted: number;
  highImportance: number;
}> {
  console.log("📰 Fetching GDELT headlines...");

  // Fetch from GDELT
  const articles = await fetchGDELTArticles();
  console.log(`  Fetched ${articles.length} articles`);

  if (articles.length === 0) {
    return { fetched: 0, scored: 0, inserted: 0, highImportance: 0 };
  }

  // Score and transform
  const scoredHeadlines: ScoredHeadline[] = articles.map((article) => {
    const countries = extractCountries(article);
    const currencies = mapCountriesToCurrencies(countries);
    const themes = extractThemes(article.title);
    const importanceScore = calculateImportance(article);

    return {
      source: "gdelt",
      headline: article.title,
      url: article.url,
      publishedAt: parseGDELTDate(article.seendate),
      countries,
      themes,
      currencies,
      importanceScore,
      goldsteinScale: null, // GDELT DOC API doesn't include this
    };
  });

  // Filter to high-importance only (>= 5)
  const highImportance = scoredHeadlines.filter((h) => h.importanceScore >= 5);
  console.log(`  ${highImportance.length} high-importance headlines (score >= 5)`);

  // Insert to database
  const inserted = await insertHeadlines(highImportance);
  console.log(`  Inserted ${inserted} headlines`);

  return {
    fetched: articles.length,
    scored: scoredHeadlines.length,
    inserted,
    highImportance: highImportance.length,
  };
}

/**
 * Get recent headlines from database
 */
export async function getRecentHeadlines(options?: {
  currency?: string;
  hours?: number;
  minImportance?: number;
  limit?: number;
}): Promise<
  Array<{
    headline: string;
    source: string;
    publishedAt: Date;
    countries: string[];
    themes: string[];
    importanceScore: number;
    url: string;
  }>
> {
  const pool = getTimescalePool();
  const hours = options?.hours || 24;
  const minImportance = options?.minImportance || 5;
  const limit = options?.limit || 20;

  let query = `
    SELECT headline, source, published_at, countries, themes, importance_score, url
    FROM news_headlines
    WHERE published_at > NOW() - ($1 || ' hours')::INTERVAL
    AND importance_score >= $2
  `;
  const params: (string | number)[] = [hours.toString(), minImportance];

  if (options?.currency) {
    query += ` AND $3 = ANY(currencies)`;
    params.push(options.currency);
  }

  query += ` ORDER BY importance_score DESC, published_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    headline: row.headline,
    source: row.source,
    publishedAt: row.published_at,
    countries: row.countries,
    themes: row.themes,
    importanceScore: row.importance_score,
    url: row.url,
  }));
}
