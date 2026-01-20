import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { NEWS_PAIRS } from "./newsEvents";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface PatternCounts {
  spike_reversal: number;
  continuation: number;
  fade: number;
  range: number;
}

// Type for reaction data from the query
interface ReactionData {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  spikeMagnitudePips: number;
  spikeDirection: string;
  didReverse: boolean;
  finalDirectionMatchesSpike: boolean;
  patternType: string;
}

// Type for event data
interface EventData {
  eventId: string;
  eventType: string;
  actualValue?: number;
  forecastValue?: number;
}

// Type for aggregation result
interface AggregationData {
  event: EventData;
  reaction: ReactionData;
}

// Type for combination
interface TypePairCombination {
  eventType: string;
  pair: string;
}

// Type for conditional stats
interface ConditionalStats {
  sampleSize: number;
  avgSpikePips: number;
  medianSpikePips: number;
  spikeUpPct: number;
  reversalWithin30minPct: number;
  dominantPattern: string;
}

// Type for classified reaction
export type OutcomeType = "beat" | "miss" | "inline";

interface ClassifiedReaction {
  reaction: ReactionData;
  outcome: OutcomeType;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Within 5% deviation = inline
export const INLINE_THRESHOLD_PCT = 5;

// Minimum sample size for conditional stats
const MIN_CONDITIONAL_SAMPLE = 5;

// Events where LOWER actual = positive outcome (beat)
// For these, actual < forecast means "beat" (better than expected)
export const LOWER_IS_BETTER_EVENTS = [
  "UNEMPLOYMENT",
  "UNEMPLOYMENT_RATE",
  "JOBLESS_CLAIMS",
  "INITIAL_CLAIMS",
  "CONTINUING_CLAIMS",
  "CPI_MOM",
  "CPI_YOY",
  "CPI",
  "CORE_CPI_MOM",
  "CORE_CPI_YOY",
  "CORE_CPI",
  "PPI_MOM",
  "PPI_YOY",
  "PPI",
  "CORE_PPI",
  "CORE_PPI_MOM",
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate median of an array
 */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate standard deviation
 */
function stdDev(arr: number[], mean: number): number {
  if (arr.length === 0) return 0;
  const variance =
    arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Classify an event outcome as beat, miss, or inline
 */
export function classifyOutcome(
  actual: number,
  forecast: number,
  eventType: string
): OutcomeType {
  // Handle edge case of zero forecast
  if (forecast === 0) {
    if (actual === 0) return "inline";
    return actual > 0 ? "beat" : "miss";
  }

  // Calculate percentage deviation
  const deviationPct = Math.abs((actual - forecast) / forecast) * 100;

  // Within threshold = inline
  if (deviationPct <= INLINE_THRESHOLD_PCT) {
    return "inline";
  }

  // Check if this is a "lower is better" event
  const lowerIsBetter = LOWER_IS_BETTER_EVENTS.includes(eventType);

  if (lowerIsBetter) {
    // For unemployment, CPI, etc: lower actual = beat
    return actual < forecast ? "beat" : "miss";
  }
  // For GDP, NFP, retail sales, etc: higher actual = beat
  return actual > forecast ? "beat" : "miss";
}

/**
 * Classify all reactions by beat/miss/inline
 */
function classifyReactions(
  data: AggregationData[],
  eventType: string
): ClassifiedReaction[] {
  return data
    .filter(
      (d) =>
        d.event.actualValue !== undefined && d.event.forecastValue !== undefined
    )
    .map((d) => {
      const outcome = classifyOutcome(
        d.event.actualValue!,
        d.event.forecastValue!,
        eventType
      );
      return { reaction: d.reaction, outcome };
    });
}

/**
 * Compute conditional stats for a subset of reactions
 */
function computeConditionalStats(reactions: ReactionData[]): ConditionalStats {
  if (reactions.length === 0) {
    return {
      sampleSize: 0,
      avgSpikePips: 0,
      medianSpikePips: 0,
      spikeUpPct: 0,
      reversalWithin30minPct: 0,
      dominantPattern: "none",
    };
  }

  const spikes = reactions.map((r) => r.spikeMagnitudePips);
  const avgSpikePips =
    Math.round((spikes.reduce((a, b) => a + b, 0) / spikes.length) * 10) / 10;

  const spikeUpCount = reactions.filter((r) => r.spikeDirection === "UP").length;
  const spikeUpPct = Math.round((spikeUpCount / reactions.length) * 1000) / 10;

  const reversalCount = reactions.filter((r) => r.didReverse).length;
  const reversalWithin30minPct =
    Math.round((reversalCount / reactions.length) * 1000) / 10;

  // Find dominant pattern
  const patternCounts: Record<string, number> = {
    spike_reversal: 0,
    continuation: 0,
    fade: 0,
    range: 0,
  };
  for (const r of reactions) {
    if (r.patternType in patternCounts) {
      patternCounts[r.patternType]++;
    }
  }
  const dominantPattern = Object.entries(patternCounts).sort(
    (a, b) => b[1] - a[1]
  )[0][0];

  return {
    sampleSize: reactions.length,
    avgSpikePips,
    medianSpikePips: Math.round(median(spikes) * 10) / 10,
    spikeUpPct,
    reversalWithin30minPct,
    dominantPattern,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get statistics for an event type and pair (internal use)
 */
export const getStatistics = internalQuery({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eventTypeStatistics")
      .withIndex("by_type_pair", (q) =>
        q.eq("eventType", args.eventType).eq("pair", args.pair)
      )
      .first();
  },
});

/**
 * Get all statistics for an event type (all pairs)
 */
export const getStatisticsForType = query({
  args: { eventType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("eventTypeStatistics")
      .withIndex("by_type", (q) => q.eq("eventType", args.eventType))
      .collect();
  },
});

/**
 * Get all unique event type + pair combinations that have reactions (internal use)
 */
export const getUniqueCombinations = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all events
    const events = await ctx.db.query("economicEvents").collect();

    // Get unique event types
    const eventTypes = [...new Set(events.map((e) => e.eventType))];

    // Create combinations with NEWS_PAIRS
    const combinations: { eventType: string; pair: string }[] = [];

    for (const eventType of eventTypes) {
      for (const pair of NEWS_PAIRS) {
        combinations.push({ eventType, pair });
      }
    }

    return combinations;
  },
});

/**
 * Public query to get unique event types that have reactions
 */
export const getUniqueCombinationsPublic = query({
  args: {},
  handler: async (ctx) => {
    // Get distinct event types from economicEvents
    const events = await ctx.db.query("economicEvents").take(10000);
    const eventTypes = [...new Set(events.map((e) => e.eventType))];
    return eventTypes;
  },
});

/**
 * Get reactions for an event type and pair (for aggregation, internal use)
 */
export const getReactionsForAggregation = internalQuery({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all events of this type
    const events = await ctx.db
      .query("economicEvents")
      .withIndex("by_type", (q) => q.eq("eventType", args.eventType))
      .collect();

    // Get reactions for each event
    const reactions = [];
    for (const event of events) {
      const reaction = await ctx.db
        .query("eventPriceReactions")
        .withIndex("by_pair_event", (q) =>
          q.eq("pair", args.pair).eq("eventId", event.eventId)
        )
        .first();

      if (reaction) {
        reactions.push({ event, reaction });
      }
    }

    return reactions;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert statistics for an event type and pair
 */
export const upsertStatistics = internalMutation({
  args: {
    eventType: v.string(),
    pair: v.string(),
    sampleSize: v.number(),
    dateRangeStart: v.number(),
    dateRangeEnd: v.number(),
    lastUpdated: v.number(),
    historicalStdDev: v.number(),
    avgSpikePips: v.number(),
    medianSpikePips: v.number(),
    maxSpikePips: v.number(),
    minSpikePips: v.number(),
    stdDevSpikePips: v.number(),
    spikeUpCount: v.number(),
    spikeDownCount: v.number(),
    spikeUpPct: v.number(),
    reversalWithin30minCount: v.number(),
    reversalWithin1hrCount: v.number(),
    reversalWithin30minPct: v.number(),
    reversalWithin1hrPct: v.number(),
    finalMatchesSpikeCount: v.number(),
    patternCounts: v.object({
      spike_reversal: v.number(),
      continuation: v.number(),
      fade: v.number(),
      range: v.number(),
    }),
    // Conditional stats (optional)
    hasForecastData: v.optional(v.boolean()),
    beatStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
    missStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
    inlineStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("eventTypeStatistics")
      .withIndex("by_type_pair", (q) =>
        q.eq("eventType", args.eventType).eq("pair", args.pair)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("eventTypeStatistics", args);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate statistics for an event type + pair
 */
export const aggregateStatistics = internalAction({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    sampleSize?: number;
    avgSpikePips?: number;
    reversalPct?: number;
    hasForecastData?: boolean;
    beatN?: number;
    missN?: number;
    inlineN?: number;
  }> => {
    // Get all reactions for this event type + pair
    const data = (await ctx.runQuery(
      internal.newsStatistics.getReactionsForAggregation,
      {
        eventType: args.eventType,
        pair: args.pair,
      }
    )) as AggregationData[];

    if (data.length < 3) {
      return {
        success: false,
        error: `Insufficient sample size (${data.length})`,
      };
    }

    const reactions = data.map((d: AggregationData) => d.reaction);
    const events = data.map((d: AggregationData) => d.event);

    // Spike statistics
    const spikes: number[] = reactions.map((r: ReactionData) => r.spikeMagnitudePips);
    const avgSpikePips =
      Math.round((spikes.reduce((a: number, b: number) => a + b, 0) / spikes.length) * 10) / 10;
    const medianSpikePips = Math.round(median(spikes) * 10) / 10;
    const maxSpikePips = Math.max(...spikes);
    const minSpikePips = Math.min(...spikes);
    const stdDevSpikePips = Math.round(stdDev(spikes, avgSpikePips) * 10) / 10;

    // Direction statistics
    const spikeUpCount = reactions.filter(
      (r: ReactionData) => r.spikeDirection === "UP"
    ).length;
    const spikeDownCount = reactions.length - spikeUpCount;
    const spikeUpPct = Math.round((spikeUpCount / reactions.length) * 1000) / 10;

    // Reversal statistics
    const reversalWithin30minCount = reactions.filter((r: ReactionData) => r.didReverse).length;
    // For 1hr, we'd need to check priceAtPlus1hr vs spike, but for now use same
    const reversalWithin1hrCount = reversalWithin30minCount;
    const reversalWithin30minPct =
      Math.round((reversalWithin30minCount / reactions.length) * 1000) / 10;
    const reversalWithin1hrPct =
      Math.round((reversalWithin1hrCount / reactions.length) * 1000) / 10;

    const finalMatchesSpikeCount = reactions.filter(
      (r: ReactionData) => r.finalDirectionMatchesSpike
    ).length;

    // Pattern distribution
    const patternCounts: PatternCounts = {
      spike_reversal: reactions.filter((r: ReactionData) => r.patternType === "spike_reversal")
        .length,
      continuation: reactions.filter((r: ReactionData) => r.patternType === "continuation")
        .length,
      fade: reactions.filter((r: ReactionData) => r.patternType === "fade").length,
      range: reactions.filter((r: ReactionData) => r.patternType === "range").length,
    };

    // Date range
    const timestamps: number[] = reactions.map((r: ReactionData) => r.eventTimestamp);
    const dateRangeStart = Math.min(...timestamps);
    const dateRangeEnd = Math.max(...timestamps);

    // Calculate historical standard deviation for z-score
    // This is for the actual-forecast deviation, not spike pips
    const surprises: number[] = events
      .filter((e: EventData) => e.actualValue !== undefined && e.forecastValue !== undefined)
      .map((e: EventData) => (e.actualValue as number) - (e.forecastValue as number));

    const avgSurprise =
      surprises.length > 0
        ? surprises.reduce((a: number, b: number) => a + b, 0) / surprises.length
        : 0;
    const historicalStdDev =
      surprises.length > 2 ? stdDev(surprises, avgSurprise) : 1;

    // === CONDITIONAL STATS (Beat/Miss/Inline) ===
    // Check if this event type has forecast data
    const eventsWithForecasts = events.filter(
      (e: EventData) => e.actualValue !== undefined && e.forecastValue !== undefined
    );
    const hasForecastData = eventsWithForecasts.length >= 3;

    let beatStats: ConditionalStats | undefined;
    let missStats: ConditionalStats | undefined;
    let inlineStats: ConditionalStats | undefined;

    if (hasForecastData) {
      // Classify each reaction by outcome
      const classified = classifyReactions(data, args.eventType);

      const beats = classified.filter((c) => c.outcome === "beat");
      const misses = classified.filter((c) => c.outcome === "miss");
      const inlines = classified.filter((c) => c.outcome === "inline");

      // Only compute stats if sample size >= MIN_CONDITIONAL_SAMPLE
      if (beats.length >= MIN_CONDITIONAL_SAMPLE) {
        beatStats = computeConditionalStats(beats.map((c) => c.reaction));
      }
      if (misses.length >= MIN_CONDITIONAL_SAMPLE) {
        missStats = computeConditionalStats(misses.map((c) => c.reaction));
      }
      if (inlines.length >= MIN_CONDITIONAL_SAMPLE) {
        inlineStats = computeConditionalStats(inlines.map((c) => c.reaction));
      }
    }

    // Store statistics
    await ctx.runMutation(internal.newsStatistics.upsertStatistics, {
      eventType: args.eventType,
      pair: args.pair,
      sampleSize: reactions.length,
      dateRangeStart,
      dateRangeEnd,
      lastUpdated: Date.now(),
      historicalStdDev: Math.round(historicalStdDev * 10000) / 10000,
      avgSpikePips,
      medianSpikePips,
      maxSpikePips,
      minSpikePips,
      stdDevSpikePips,
      spikeUpCount,
      spikeDownCount,
      spikeUpPct,
      reversalWithin30minCount,
      reversalWithin1hrCount,
      reversalWithin30minPct,
      reversalWithin1hrPct,
      finalMatchesSpikeCount,
      patternCounts,
      // Conditional stats
      hasForecastData,
      beatStats,
      missStats,
      inlineStats,
    });

    return {
      success: true,
      sampleSize: reactions.length,
      avgSpikePips,
      reversalPct: reversalWithin30minPct,
      // Include conditional info in response
      hasForecastData,
      beatN: beatStats?.sampleSize,
      missN: missStats?.sampleSize,
      inlineN: inlineStats?.sampleSize,
    };
  },
});

/**
 * Public wrapper for aggregateStatistics (for scripts)
 */
export const aggregateStatisticsPublic = action({
  args: {
    eventType: v.string(),
    pair: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    sampleSize?: number;
    avgSpikePips?: number;
    reversalPct?: number;
    hasForecastData?: boolean;
    beatN?: number;
    missN?: number;
    inlineN?: number;
  }> => {
    return await ctx.runAction(internal.newsStatistics.aggregateStatistics, {
      eventType: args.eventType,
      pair: args.pair,
    }) as {
      success: boolean;
      error?: string;
      sampleSize?: number;
      avgSpikePips?: number;
      reversalPct?: number;
      hasForecastData?: boolean;
      beatN?: number;
      missN?: number;
      inlineN?: number;
    };
  },
});

/**
 * Regenerate all statistics (run after bulk backfill)
 */
export const regenerateAllStatistics = action({
  args: {},
  handler: async (ctx): Promise<{ processed: number; failed: number; total: number; results: Record<string, unknown> }> => {
    // Get all unique combinations
    const combinations = (await ctx.runQuery(
      internal.newsStatistics.getUniqueCombinations,
      {}
    )) as TypePairCombination[];

    const results: Record<string, unknown> = {};
    let processed = 0;
    let failed = 0;

    for (const { eventType, pair } of combinations) {
      const key = `${eventType}_${pair}`;
      try {
        const result = (await ctx.runAction(
          internal.newsStatistics.aggregateStatistics,
          { eventType, pair }
        )) as { success: boolean; error?: string };
        results[key] = result;
        if (result.success) {
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        results[key] = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        failed++;
      }
    }

    return { processed, failed, total: combinations.length, results };
  },
});

/**
 * Update z-scores for all events of a type after stats are computed
 */
export const updateZScoresForType = action({
  args: { eventType: v.string() },
  handler: async (ctx, args) => {
    // Get the historical std dev for this event type (use any pair, it's the same)
    const stats = await ctx.runQuery(internal.newsStatistics.getStatistics, {
      eventType: args.eventType,
      pair: "EUR_USD",
    });

    if (!stats || stats.historicalStdDev === 0) {
      return { success: false, error: "No statistics found or zero stdDev" };
    }

    // Get all events of this type
    const events = await ctx.runQuery(
      internal.newsStatistics.getEventsOfType,
      { eventType: args.eventType }
    );

    let updated = 0;
    for (const event of events) {
      if (
        event.actualValue !== undefined &&
        event.forecastValue !== undefined
      ) {
        const surprise = event.actualValue - event.forecastValue;
        const zScore =
          Math.round((surprise / stats.historicalStdDev) * 100) / 100;

        await ctx.runMutation(internal.newsStatistics.updateEventZScore, {
          eventId: event.eventId,
          surpriseZScore: zScore,
        });
        updated++;
      }
    }

    return { success: true, updated };
  },
});

/**
 * Get events of a specific type (internal use)
 */
export const getEventsOfType = internalQuery({
  args: { eventType: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("economicEvents")
      .withIndex("by_type", (q) => q.eq("eventType", args.eventType))
      .collect();
  },
});

/**
 * Update z-score for a single event
 */
export const updateEventZScore = internalMutation({
  args: {
    eventId: v.string(),
    surpriseZScore: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("economicEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (event) {
      await ctx.db.patch(event._id, { surpriseZScore: args.surpriseZScore });
    }
  },
});

/**
 * Public mutation for uploading locally-calculated statistics
 * Used by scripts/process-pipeline.ts for bulk uploads
 */
export const uploadStatistics = mutation({
  args: {
    eventType: v.string(),
    pair: v.string(),
    sampleSize: v.number(),
    dateRangeStart: v.number(),
    dateRangeEnd: v.number(),
    lastUpdated: v.number(),
    historicalStdDev: v.number(),
    avgSpikePips: v.number(),
    medianSpikePips: v.number(),
    maxSpikePips: v.number(),
    minSpikePips: v.number(),
    stdDevSpikePips: v.number(),
    spikeUpCount: v.number(),
    spikeDownCount: v.number(),
    spikeUpPct: v.number(),
    reversalWithin30minCount: v.number(),
    reversalWithin1hrCount: v.number(),
    reversalWithin30minPct: v.number(),
    reversalWithin1hrPct: v.number(),
    finalMatchesSpikeCount: v.number(),
    patternCounts: v.object({
      spike_reversal: v.number(),
      continuation: v.number(),
      fade: v.number(),
      range: v.number(),
    }),
    hasForecastData: v.optional(v.boolean()),
    beatStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
    missStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
    inlineStats: v.optional(
      v.object({
        sampleSize: v.number(),
        avgSpikePips: v.number(),
        medianSpikePips: v.number(),
        spikeUpPct: v.number(),
        reversalWithin30minPct: v.number(),
        dominantPattern: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("eventTypeStatistics")
      .withIndex("by_type_pair", (q) =>
        q.eq("eventType", args.eventType).eq("pair", args.pair)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("eventTypeStatistics", args);
    return { updated: false, id };
  },
});
