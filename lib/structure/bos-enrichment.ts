/**
 * BOS Enrichment Pipeline — Pure Computation
 *
 * Cross-references each BOS event with key levels, COT data,
 * news proximity, MTF score, and session context to compute
 * a significance score (0-100).
 *
 * Pure functions only — no database dependencies.
 */

import type {
  BOSEvent,
  BOSEnrichment,
  KeyLevelEntry,
  MTFScore,
} from "./types";

// ─── Session Detection (lightweight, inlined from sessions.ts pattern) ───────

function detectSessionFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const utcHour = date.getUTCHours();

  if (utcHour >= 12 && utcHour < 16) return "london_ny_overlap";
  if (utcHour >= 7 && utcHour < 12) return "london";
  if (utcHour >= 16 && utcHour < 21) return "new_york";
  if (utcHour >= 0 && utcHour < 9) return "tokyo";
  return "sydney";
}

const SESSION_SCORES: Record<string, number> = {
  london_ny_overlap: 100,
  london: 80,
  new_york: 80,
  tokyo: 40,
  sydney: 20,
};

// ─── Timeframe Score ─────────────────────────────────────────────────────────

const TF_SCORES: Record<string, number> = {
  MN: 100, M: 100,
  W1: 80, W: 80,
  D1: 60, D: 60,
  H4: 40,
  H1: 20,
  M30: 10,
  M15: 5,
};

// ─── Key Level Scoring ───────────────────────────────────────────────────────

const LEVEL_SCORES: Record<string, number> = {
  YH: 25, YL: 25,
  PMH: 20, PML: 20,
  PWH: 15, PWL: 15,
  PDH: 10, PDL: 10,
};

/**
 * Check which key levels a BOS broken price is near.
 * Tolerance = 0.1% of price.
 */
function checkKeyLevels(
  brokenLevel: number,
  keyLevelEntries: KeyLevelEntry[]
): { broken: string[]; score: number } {
  const tolerance = brokenLevel * 0.001; // 0.1%
  const broken: string[] = [];
  let score = 0;

  for (const entry of keyLevelEntries) {
    if (Math.abs(entry.price - brokenLevel) <= tolerance) {
      broken.push(entry.label);
      score += LEVEL_SCORES[entry.label] || 5;
    }
  }

  return { broken, score: Math.min(score, 100) };
}

// ─── COT Alignment ──────────────────────────────────────────────────────────

function computeCOTAlignment(
  bosDirection: string,
  cotData: { direction: string; percentile: number } | null | undefined
): { alignment: number; direction: string | null } {
  if (!cotData) {
    return { alignment: 50, direction: null }; // Neutral when no data
  }

  if (cotData.direction === bosDirection) {
    return { alignment: cotData.percentile, direction: cotData.direction };
  }

  // Opposing direction
  return { alignment: 0, direction: cotData.direction };
}

// ─── News Proximity ─────────────────────────────────────────────────────────

interface NewsProximityEntry {
  name: string;
  impact: string;
  hoursAway: number;
}

function computeNewsProximity(
  bosTimestamp: number,
  events: { name: string; impact: string; timestamp: number }[] | undefined
): { proximity: NewsProximityEntry[]; score: number } {
  if (!events || events.length === 0) {
    return { proximity: [], score: 0 };
  }

  const twoHoursMs = 2 * 60 * 60 * 1000;
  const proximity: NewsProximityEntry[] = [];
  let score = 0;

  for (const event of events) {
    const diffMs = Math.abs(event.timestamp - bosTimestamp);
    if (diffMs <= twoHoursMs) {
      const hoursAway = Math.round((diffMs / (60 * 60 * 1000)) * 10) / 10;
      proximity.push({
        name: event.name,
        impact: event.impact,
        hoursAway,
      });

      // Score based on impact and proximity
      const isHighImpact = event.impact === "high";
      const oneHourMs = 60 * 60 * 1000;

      if (isHighImpact) {
        score = Math.max(score, diffMs <= oneHourMs ? 100 : 60);
      } else {
        score = Math.max(score, diffMs <= oneHourMs ? 50 : 30);
      }
    }
  }

  return { proximity, score: Math.min(score, 100) };
}

// ─── MTF Alignment ──────────────────────────────────────────────────────────

function computeMTFAlignment(
  bosDirection: string,
  mtfScore: MTFScore | undefined
): number {
  if (!mtfScore) return 50; // Neutral when no data

  // If MTF composite is same direction as BOS, alignment = abs(composite)
  const sameDirection =
    (bosDirection === "bullish" && mtfScore.composite > 0) ||
    (bosDirection === "bearish" && mtfScore.composite < 0);

  if (sameDirection) {
    return Math.min(Math.abs(mtfScore.composite), 100);
  }

  // Opposing — invert
  return Math.max(0, 100 - Math.abs(mtfScore.composite));
}

// ─── Main Enrichment Pipeline ───────────────────────────────────────────────

/**
 * Enrich BOS events with significance scoring.
 *
 * Mutates each BOS event's `enrichment` field in-place.
 *
 * @param bosEvents - BOS events to enrich
 * @param keyLevelEntries - Key level grid entries
 * @param timeframe - Timeframe of the BOS events (for TF scoring)
 * @param cotData - COT positioning data (optional)
 * @param events - Upcoming/recent news events (optional)
 * @param mtfScore - MTF composite score (optional)
 * @returns The same bosEvents array (mutated)
 */
export function enrichBOSEvents(
  bosEvents: BOSEvent[],
  keyLevelEntries: KeyLevelEntry[],
  timeframe: string,
  cotData?: { direction: string; percentile: number } | null,
  events?: { name: string; impact: string; timestamp: number }[],
  mtfScore?: MTFScore
): BOSEvent[] {
  const tfScore = TF_SCORES[timeframe] ?? 10;

  for (const bos of bosEvents) {
    // 1. Key level check (25% weight)
    const { broken: keyLevelsBroken, score: keyLevelScore } = checkKeyLevels(
      bos.brokenLevel,
      keyLevelEntries
    );

    // 2. COT alignment (20% weight)
    const { alignment: cotAlignment, direction: cotDirection } =
      computeCOTAlignment(bos.direction, cotData);

    // 3. News proximity (informational, not in significance)
    const { proximity: newsProximity, score: newsScore } =
      computeNewsProximity(bos.timestamp, events);

    // 4. MTF alignment (20% weight)
    const mtfAlignment = computeMTFAlignment(bos.direction, mtfScore);

    // 5. Session context (10% weight)
    const sessionContext = detectSessionFromTimestamp(bos.timestamp);
    const sessionScore = SESSION_SCORES[sessionContext] ?? 20;

    // 6. Significance composite
    // Weights: TF=25%, keyLevel=25%, COT=20%, MTF=20%, session=10%
    const significance = Math.round(
      tfScore * 0.25 +
      keyLevelScore * 0.25 +
      cotAlignment * 0.20 +
      mtfAlignment * 0.20 +
      sessionScore * 0.10
    );

    const enrichment: BOSEnrichment = {
      keyLevelsBroken,
      keyLevelScore,
      cotAlignment,
      cotDirection,
      newsProximity,
      newsScore,
      mtfScore: mtfScore?.composite ?? 0,
      mtfAlignment,
      sessionContext,
      sessionScore,
      significance: Math.min(significance, 100),
      isHighConviction: significance > 70,
    };

    bos.enrichment = enrichment;
  }

  return bosEvents;
}
