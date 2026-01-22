import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// Cache the JSON data in memory
let economicEventsCache: EconomicEvent[] | null = null;
let speakersCache: SpeakerEvent[] | null = null;

interface BeatMissInterpretation {
  direction: string;
  description: string;
  currency_impact: string;
  equity_impact?: string;
  bond_impact?: string;
}

interface EconomicEvent {
  event_name: string;
  aliases?: string[];
  category: string;
  short_description: string;
  detailed_description?: string;
  measures?: string;
  release_frequency?: string;
  typical_release_time?: string;
  source_authority?: string;
  country?: string;
  primary_currency: string;
  secondary_currencies?: string[];
  typical_impact: string;
  beat_interpretation?: BeatMissInterpretation;
  miss_interpretation?: BeatMissInterpretation;
  global_spillover?: string;
  spillover_description?: string;
  revision_tendency?: string;
  related_events?: string[];
  historical_context?: string;
  trading_notes?: string;
}

interface NotableMoment {
  date: string;
  description: string;
}

interface Speaker {
  full_name: string;
  institution: string;
  institution_full?: string;
  role: string;
  tenure_start?: string;
  tenure_end?: string | null;
  board_term_end?: string;
  voting_member: boolean;
  voting_years?: string;
  stance: string;
  stance_description: string;
  education?: string;
  prior_roles?: string[];
  notable_moments?: NotableMoment[];
  current_status?: string;
  successor?: string;
  wikipedia_url?: string;
}

interface SpeakerEvent {
  event_name: string;
  category: string;
  speaker: Speaker;
  typical_impact: string;
  what_to_watch?: string;
  market_sensitivity?: string;
  regime_change_potential?: string;
  regime_change_examples?: string;
  primary_currency: string;
  related_events?: string[];
}

function loadEconomicEvents(): EconomicEvent[] {
  if (economicEventsCache) return economicEventsCache;

  try {
    const filePath = join(process.cwd(), "data/event_definitions/economic_events.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const events: EconomicEvent[] = data.economic_events || [];
    economicEventsCache = events;
    return events;
  } catch (error) {
    console.error("Failed to load economic events:", error);
    return [];
  }
}

function loadSpeakers(): SpeakerEvent[] {
  if (speakersCache) return speakersCache;

  try {
    const filePath = join(process.cwd(), "data/event_definitions/speakers.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const speakers: SpeakerEvent[] = data.speakers || [];
    speakersCache = speakers;
    return speakers;
  } catch (error) {
    console.error("Failed to load speakers:", error);
    return [];
  }
}

// Normalize event name for matching
function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Find best match for an event name
function findEventDefinition(eventName: string): { type: "economic" | "speaker"; data: EconomicEvent | SpeakerEvent } | null {
  const normalized = normalizeEventName(eventName);

  // Check speakers first (more specific matches)
  const speakers = loadSpeakers();
  for (const speaker of speakers) {
    const speakerNormalized = normalizeEventName(speaker.event_name);
    if (speakerNormalized === normalized || normalized.includes(speakerNormalized) || speakerNormalized.includes(normalized)) {
      return { type: "speaker", data: speaker };
    }
  }

  // Check economic events
  const events = loadEconomicEvents();
  for (const event of events) {
    const eventNormalized = normalizeEventName(event.event_name);
    if (eventNormalized === normalized || normalized.includes(eventNormalized) || eventNormalized.includes(normalized)) {
      return { type: "economic", data: event };
    }

    // Check aliases
    if (event.aliases) {
      for (const alias of event.aliases) {
        const aliasNormalized = normalizeEventName(alias);
        if (aliasNormalized === normalized || normalized.includes(aliasNormalized) || aliasNormalized.includes(normalized)) {
          return { type: "economic", data: event };
        }
      }
    }
  }

  // Fuzzy match: check if event name contains key words
  const keywordMatches = [
    { keywords: ["powell", "fed chair"], type: "speaker" as const },
    { keywords: ["fomc member", "fed member"], type: "speaker" as const },
    { keywords: ["boe gov", "bank of england"], type: "speaker" as const },
    { keywords: ["ecb president", "lagarde"], type: "speaker" as const },
    { keywords: ["nfp", "non-farm", "payroll"], type: "economic" as const },
    { keywords: ["cpi", "inflation"], type: "economic" as const },
    { keywords: ["gdp", "gross domestic"], type: "economic" as const },
    { keywords: ["unemployment", "jobless"], type: "economic" as const },
    { keywords: ["retail sales"], type: "economic" as const },
    { keywords: ["pmi", "purchasing manager"], type: "economic" as const },
    { keywords: ["interest rate", "rate decision"], type: "economic" as const },
  ];

  for (const { keywords, type } of keywordMatches) {
    if (keywords.some(kw => normalized.includes(kw))) {
      if (type === "speaker") {
        // Find a relevant speaker
        for (const speaker of speakers) {
          const speakerNormalized = normalizeEventName(speaker.event_name);
          if (keywords.some(kw => speakerNormalized.includes(kw))) {
            return { type: "speaker", data: speaker };
          }
        }
      } else {
        // Find a relevant economic event
        for (const event of events) {
          const eventNormalized = normalizeEventName(event.event_name);
          if (keywords.some(kw => eventNormalized.includes(kw) || (event.aliases || []).some(a => normalizeEventName(a).includes(kw)))) {
            return { type: "economic", data: event };
          }
        }
      }
    }
  }

  return null;
}

/**
 * GET /api/news/definitions
 *
 * Look up event definition by event name.
 * Returns economic event definition or speaker profile.
 *
 * Query params:
 * - eventName: The event name to look up (required)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const eventName = searchParams.get("eventName");

  if (!eventName) {
    return NextResponse.json(
      { error: "Missing required parameter: eventName" },
      { status: 400 }
    );
  }

  const result = findEventDefinition(eventName);

  if (!result) {
    return NextResponse.json({
      found: false,
      eventName,
      type: null,
      definition: null,
    });
  }

  if (result.type === "speaker") {
    const speaker = result.data as SpeakerEvent;
    return NextResponse.json({
      found: true,
      eventName,
      type: "speaker",
      definition: {
        eventName: speaker.event_name,
        category: speaker.category,
        typicalImpact: speaker.typical_impact,
        primaryCurrency: speaker.primary_currency,
        whatToWatch: speaker.what_to_watch,
        marketSensitivity: speaker.market_sensitivity,
        regimeChangePotential: speaker.regime_change_potential,
        regimeChangeExamples: speaker.regime_change_examples,
        relatedEvents: speaker.related_events,
        speaker: {
          fullName: speaker.speaker.full_name,
          institution: speaker.speaker.institution,
          institutionFull: speaker.speaker.institution_full,
          role: speaker.speaker.role,
          tenureStart: speaker.speaker.tenure_start,
          tenureEnd: speaker.speaker.tenure_end,
          votingMember: speaker.speaker.voting_member,
          votingYears: speaker.speaker.voting_years,
          stance: speaker.speaker.stance,
          stanceDescription: speaker.speaker.stance_description,
          education: speaker.speaker.education,
          priorRoles: speaker.speaker.prior_roles,
          notableMoments: speaker.speaker.notable_moments,
          currentStatus: speaker.speaker.current_status,
          wikipediaUrl: speaker.speaker.wikipedia_url,
        },
      },
    });
  } else {
    const event = result.data as EconomicEvent;
    return NextResponse.json({
      found: true,
      eventName,
      type: "economic",
      definition: {
        eventName: event.event_name,
        aliases: event.aliases,
        category: event.category,
        shortDescription: event.short_description,
        detailedDescription: event.detailed_description,
        measures: event.measures,
        releaseFrequency: event.release_frequency,
        typicalReleaseTime: event.typical_release_time,
        sourceAuthority: event.source_authority,
        country: event.country,
        primaryCurrency: event.primary_currency,
        secondaryCurrencies: event.secondary_currencies,
        typicalImpact: event.typical_impact,
        beatInterpretation: event.beat_interpretation,
        missInterpretation: event.miss_interpretation,
        globalSpillover: event.global_spillover,
        spilloverDescription: event.spillover_description,
        revisionTendency: event.revision_tendency,
        relatedEvents: event.related_events,
        historicalContext: event.historical_context,
        tradingNotes: event.trading_notes,
      },
    });
  }
}
