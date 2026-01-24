"use client";

import { useState, useEffect } from "react";
import { NewsEventData, HistoricalEventReaction } from "./NewsMarkersPrimitive";

// Lower-is-better events for classification
const LOWER_IS_BETTER_EVENTS = [
  "UNEMPLOYMENT", "UNEMPLOYMENT_RATE", "JOBLESS_CLAIMS", "INITIAL_CLAIMS",
  "CONTINUING_CLAIMS", "CPI_MOM", "CPI_YOY", "CPI", "CORE_CPI_MOM",
  "CORE_CPI_YOY", "CORE_CPI", "PPI_MOM", "PPI_YOY", "PPI", "CORE_PPI", "CORE_PPI_MOM",
];

function classifyOutcome(
  actual: number,
  forecast: number,
  eventType: string
): "beat" | "miss" | "inline" {
  if (forecast === 0) {
    if (actual === 0) return "inline";
    return actual > 0 ? "beat" : "miss";
  }
  const deviationPct = Math.abs((actual - forecast) / forecast) * 100;
  if (deviationPct <= 5) return "inline";
  const lowerIsBetter = LOWER_IS_BETTER_EVENTS.includes(eventType);
  if (lowerIsBetter) return actual < forecast ? "beat" : "miss";
  return actual > forecast ? "beat" : "miss";
}

interface HistoricalData {
  beatHistory: HistoricalEventReaction[];
  missHistory: HistoricalEventReaction[];
  rawHistory: HistoricalEventReaction[];
  hasForecastData: boolean;
}

// Event definition types
interface BeatMissInterpretation {
  direction: string;
  description: string;
  currency_impact: string;
}

interface NotableMoment {
  date: string;
  description: string;
}

interface SpeakerProfile {
  fullName: string;
  institution: string;
  institutionFull?: string;
  role: string;
  tenureStart?: string;
  tenureEnd?: string | null;
  votingMember: boolean;
  votingYears?: string;
  stance: string;
  stanceDescription: string;
  notableMoments?: NotableMoment[];
  wikipediaUrl?: string;
}

interface EconomicDefinition {
  eventName: string;
  shortDescription: string;
  detailedDescription?: string;
  measures?: string;
  typicalImpact: string;
  beatInterpretation?: BeatMissInterpretation;
  missInterpretation?: BeatMissInterpretation;
  tradingNotes?: string;
  historicalContext?: string;
  relatedEvents?: string[];
}

interface SpeakerDefinition {
  eventName: string;
  typicalImpact: string;
  whatToWatch?: string;
  marketSensitivity?: string;
  regimeChangePotential?: string;
  regimeChangeExamples?: string;
  speaker: SpeakerProfile;
}

interface EventDefinition {
  found: boolean;
  type: "economic" | "speaker" | null;
  definition: EconomicDefinition | SpeakerDefinition | null;
}

interface EventStatistics {
  totalOccurrences: number;
  avgSpikePips: number | null;
  upCount: number;
  downCount: number;
  reversalRate: number | null;
  upBias: number | null;
}

interface NewsEventPanelProps {
  event: NewsEventData;
  allEventsAtTimestamp: NewsEventData[];
  pair: string;
  onClose: () => void;
  onNavigate: (event: NewsEventData) => void;
}

export function NewsEventPanel({ event, allEventsAtTimestamp, pair, onClose, onNavigate }: NewsEventPanelProps) {
  // Multi-event navigation
  const currentIndex = allEventsAtTimestamp.findIndex(e => e.eventId === event.eventId);
  const hasMultipleEvents = allEventsAtTimestamp.length > 1;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < allEventsAtTimestamp.length - 1;

  const handlePrev = () => {
    if (canGoPrev) {
      onNavigate(allEventsAtTimestamp[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onNavigate(allEventsAtTimestamp[currentIndex + 1]);
    }
  };

  // State for historical data, event definition, and statistics
  const [historicalData, setHistoricalData] = useState<HistoricalData | null>(null);
  const [eventDefinition, setEventDefinition] = useState<EventDefinition | null>(null);
  const [statistics, setStatistics] = useState<EventStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    about: false,
    stats: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Fetch all data in parallel
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);

      const [historicalRes, definitionRes, statsRes] = await Promise.allSettled([
        // Historical events
        fetch(`/api/news/historical?eventType=${encodeURIComponent(event.eventType)}&pair=${pair}&beforeTimestamp=${event.timestamp}&limit=10`),
        // Event definition
        fetch(`/api/news/definitions?eventName=${encodeURIComponent(event.name)}`),
        // Statistics
        fetch(`/api/news/statistics?eventType=${encodeURIComponent(event.eventType)}&pair=${pair}`),
      ]);

      // Process historical data
      if (historicalRes.status === "fulfilled" && historicalRes.value.ok) {
        const data = await historicalRes.value.json();
        setHistoricalData(data);
      } else {
        setHistoricalData({ beatHistory: [], missHistory: [], rawHistory: [], hasForecastData: false });
      }

      // Process event definition
      if (definitionRes.status === "fulfilled" && definitionRes.value.ok) {
        const data = await definitionRes.value.json();
        setEventDefinition(data);
      } else {
        setEventDefinition({ found: false, type: null, definition: null });
      }

      // Process statistics
      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const data = await statsRes.value.json();
        setStatistics(data);
      } else {
        setStatistics(null);
      }

      setIsLoading(false);
    };

    fetchAllData();
  }, [event.eventType, event.name, event.timestamp, pair]);

  // Use London time if available (UK timezone), fallback to UTC timestamp
  const formatDateTimeFromLondon = (londonDatetime: string | undefined, timestamp: number) => {
    if (londonDatetime) {
      // Parse "2025-01-20 07:00:00" format
      const [datePart, timePart] = londonDatetime.split(" ");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour, minute] = timePart.split(":").map(Number);

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const d = new Date(year, month - 1, day);

      return {
        dateStr: `${dayNames[d.getDay()]}, ${day} ${monthNames[month - 1]} ${year}`,
        timeStr: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} UK`,
      };
    }
    // Fallback to timestamp (display in user's local time)
    const eventDate = new Date(timestamp);
    return {
      dateStr: eventDate.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      timeStr: eventDate.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC",
    };
  };

  const { dateStr, timeStr } = formatDateTimeFromLondon(event.datetimeLondon, event.timestamp);

  const isFutureEvent = !event.actual;

  // Get outcome for past events
  let outcome: "beat" | "miss" | "inline" | null = null;
  if (!isFutureEvent && event.actual && event.forecast) {
    const actualNum = parseFloat(event.actual.replace(/[%,K]/g, ""));
    const forecastNum = parseFloat(event.forecast.replace(/[%,K]/g, ""));
    if (!isNaN(actualNum) && !isNaN(forecastNum)) {
      outcome = classifyOutcome(actualNum, forecastNum, event.eventType);
    }
  }

  return (
    <div className="h-full bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      {/* Multi-event navigation */}
      {hasMultipleEvents && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-800/50">
          <button
            onClick={handlePrev}
            disabled={!canGoPrev}
            className={`p-1 rounded transition-colors ${
              canGoPrev ? "text-gray-300 hover:text-white hover:bg-gray-700" : "text-gray-600 cursor-not-allowed"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm text-gray-400">
            {currentIndex + 1} of {allEventsAtTimestamp.length} events
          </span>
          <button
            onClick={handleNext}
            disabled={!canGoNext}
            className={`p-1 rounded transition-colors ${
              canGoNext ? "text-gray-300 hover:text-white hover:bg-gray-700" : "text-gray-600 cursor-not-allowed"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-500 mb-1">{dateStr} {timeStr}</div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span
                className="w-1 h-6 rounded flex-shrink-0"
                style={{
                  backgroundColor: event.impact === "high" ? "#ef4444" : event.impact === "medium" ? "#f59e0b" : "#6b7280"
                }}
              />
              <span className="truncate">{event.name}</span>
            </h2>
            <div className="text-sm text-gray-400 mt-1">{event.currency}</div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Short description from event definition */}
        {eventDefinition?.found && eventDefinition.type === "economic" && (
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">
            {(eventDefinition.definition as EconomicDefinition).shortDescription}
          </p>
        )}
        {eventDefinition?.found && eventDefinition.type === "speaker" && (
          <p className="text-xs text-gray-400 mt-2 leading-relaxed italic">
            {(eventDefinition.definition as SpeakerDefinition).speaker.stanceDescription}
          </p>
        )}
      </div>

      {/* Values Section */}
      <div className="p-4 border-b border-gray-800">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">Actual</div>
            <div className={`text-lg font-semibold ${
              outcome === "beat" ? "text-green-400" : outcome === "miss" ? "text-red-400" : "text-white"
            }`}>
              {event.actual || "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">Forecast</div>
            <div className="text-lg font-semibold text-white">{event.forecast || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">Previous</div>
            <div className="text-lg font-semibold text-gray-400">{event.previous || "—"}</div>
          </div>
        </div>

        {/* Result Badge */}
        {outcome && (
          <div className="mt-3 text-center">
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
              outcome === "beat" ? "bg-green-500/20 text-green-400" :
              outcome === "miss" ? "bg-red-500/20 text-red-400" :
              "bg-gray-500/20 text-gray-400"
            }`}>
              {outcome.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* THIS EVENT's Reaction - show if we have reaction data */}
      {event.reaction && (
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            This Event&apos;s Reaction
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Spike:</span>
              <span className={`text-sm font-semibold ${
                event.reaction.spikeDirection === "UP" ? "text-green-400" : "text-red-400"
              }`}>
                {event.reaction.spikeMagnitudePips.toFixed(1)} pips {event.reaction.spikeDirection === "UP" ? "↑" : "↓"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14">Pattern:</span>
              <span className={`text-sm font-semibold ${
                event.reaction.didReverse ? "text-amber-400" : "text-green-400"
              }`}>
                {event.reaction.didReverse ? "Reversed" : "Held direction ✓"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Statistics Section */}
      {statistics && statistics.totalOccurrences > 0 && (
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("stats")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-800/30 transition-colors"
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Statistics
            </h3>
            <svg
              className={`w-4 h-4 text-gray-500 transition-transform ${expandedSections.stats ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.stats && (
            <div className="px-4 pb-4 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-500">Avg Spike</div>
                  <div className="text-sm font-semibold text-white">
                    {statistics.avgSpikePips !== null ? `${statistics.avgSpikePips.toFixed(1)} pips` : "—"}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-500">Sample Size</div>
                  <div className="text-sm font-semibold text-white">{statistics.totalOccurrences}</div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-500">Direction Bias</div>
                  <div className={`text-sm font-semibold ${
                    statistics.upBias !== null
                      ? statistics.upBias > 55 ? "text-green-400" : statistics.upBias < 45 ? "text-red-400" : "text-gray-300"
                      : "text-gray-500"
                  }`}>
                    {statistics.upBias !== null ? `${statistics.upBias.toFixed(0)}% UP` : "—"}
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded p-2">
                  <div className="text-xs text-gray-500">Reversal Rate</div>
                  <div className={`text-sm font-semibold ${
                    statistics.reversalRate !== null
                      ? statistics.reversalRate > 0.4 ? "text-amber-400" : "text-gray-300"
                      : "text-gray-500"
                  }`}>
                    {statistics.reversalRate !== null ? `${(statistics.reversalRate * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* About This Event Section */}
      {eventDefinition?.found && (
        <div className="border-b border-gray-800">
          <button
            onClick={() => toggleSection("about")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-800/30 transition-colors"
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {eventDefinition.type === "speaker" ? "About This Speaker" : "What This Means"}
            </h3>
            <svg
              className={`w-4 h-4 text-gray-500 transition-transform ${expandedSections.about ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.about && (
            <div className="px-4 pb-4">
              {eventDefinition.type === "speaker" ? (
                <SpeakerProfileCard definition={eventDefinition.definition as SpeakerDefinition} />
              ) : (
                <EconomicEventCard definition={eventDefinition.definition as EconomicDefinition} outcome={outcome} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Historical Reactions Section */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Historical Reactions
        </h3>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : !historicalData || historicalData.rawHistory.length === 0 ? (
          <div className="text-gray-500 text-sm">No historical data available</div>
        ) : (
          <div className="space-y-3">
            {/* Show beat/miss sections for events with forecast data */}
            {historicalData.hasForecastData && isFutureEvent && (
              <>
                {historicalData.beatHistory.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-green-400 mb-2">
                      If BEATS ({historicalData.beatHistory.length})
                    </h4>
                    <div className="space-y-2">
                      {historicalData.beatHistory.map((evt, idx) => (
                        <HistoricalEventCard key={idx} event={evt} pair={pair} />
                      ))}
                    </div>
                  </div>
                )}
                {historicalData.missHistory.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-medium text-red-400 mb-2">
                      If MISSES ({historicalData.missHistory.length})
                    </h4>
                    <div className="space-y-2">
                      {historicalData.missHistory.map((evt, idx) => (
                        <HistoricalEventCard key={idx} event={evt} pair={pair} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Show relevant history for past events */}
            {historicalData.hasForecastData && !isFutureEvent && outcome && (
              <div>
                <h4 className="text-xs font-medium text-gray-300 mb-2">
                  Similar {outcome.toUpperCase()}s ({
                    outcome === "beat" ? historicalData.beatHistory.length : historicalData.missHistory.length
                  })
                </h4>
                <div className="space-y-2">
                  {(outcome === "beat" ? historicalData.beatHistory : historicalData.missHistory).map((evt, idx) => (
                    <HistoricalEventCard key={idx} event={evt} pair={pair} />
                  ))}
                </div>
              </div>
            )}

            {/* Show raw history for speeches/no forecast data */}
            {!historicalData.hasForecastData && (
              <div>
                <h4 className="text-xs font-medium text-gray-300 mb-2">
                  Last {historicalData.rawHistory.length} Reactions
                </h4>
                <div className="space-y-2">
                  {historicalData.rawHistory.map((evt, idx) => (
                    <HistoricalEventCard key={idx} event={evt} pair={pair} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Diverging bar chart component for settlement timeline
function SettlementBar({
  label,
  pips,
  maxPips
}: {
  label: string;
  pips: number;
  maxPips: number;
}) {
  const isUp = pips > 0;
  const barWidth = Math.min(Math.abs(pips) / maxPips * 100, 100);

  return (
    <div className="flex items-center gap-2 h-5">
      <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 flex items-center h-full">
        {/* Left side (DOWN) */}
        <div className="w-1/2 flex justify-end h-3">
          {!isUp && (
            <div
              className="bg-red-500 rounded-l h-full"
              style={{ width: `${barWidth}%` }}
            />
          )}
        </div>
        {/* Center line */}
        <div className="w-px h-full bg-gray-600 flex-shrink-0" />
        {/* Right side (UP) */}
        <div className="w-1/2 flex justify-start h-3">
          {isUp && (
            <div
              className="bg-green-500 rounded-r h-full"
              style={{ width: `${barWidth}%` }}
            />
          )}
        </div>
      </div>
      <span className={`text-xs font-medium w-16 ${isUp ? "text-green-400" : "text-red-400"}`}>
        {pips > 0 ? "+" : ""}{pips.toFixed(1)}
      </span>
    </div>
  );
}

// Helper to get pip value for a pair (simplified - assumes 4 decimal places for most pairs)
function getPipValue(pair: string): number {
  // JPY pairs have 2 decimal places
  if (pair.includes("JPY")) return 0.01;
  return 0.0001;
}

// Compact historical event card with Spike/Reversal format + diverging bar chart
function HistoricalEventCard({ event, pair = "EUR_USD" }: { event: HistoricalEventReaction; pair?: string }) {
  const date = new Date(event.timestamp);
  const dateStr = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const formatPrice = (price: number) => price.toFixed(5);
  const spikeTarget = event.spikeDirection === "UP" ? event.spikeHigh : event.spikeLow;
  const pipValue = getPipValue(pair);

  // Calculate pips from event price for each settlement point
  // Handle potentially missing settlement prices gracefully
  const spikePips = event.spikeDirection === "UP" ? event.spikeMagnitudePips : -event.spikeMagnitudePips;

  // Use T-15 baseline pips if available (more accurate), otherwise calculate from T+0
  const usePipsFromBaseline = event.pipsFromBaseline !== undefined;
  const baseline = event.priceAtMinus15m ?? event.priceAtEvent;

  // Helper to safely calculate pips (returns null if data is missing)
  const calcPips = (price: number | undefined): number | null => {
    if (price === undefined || price === null || baseline === undefined) return null;
    const pips = (price - baseline) / pipValue;
    return isNaN(pips) ? null : pips;
  };

  // Use pre-calculated pips from baseline if available
  const pipsAt15m = usePipsFromBaseline ? event.pipsFromBaseline?.at15m ?? null : calcPips(event.priceAtPlus15m);
  const pipsAt30m = usePipsFromBaseline ? event.pipsFromBaseline?.at30m ?? null : calcPips(event.priceAtPlus30m);
  const pipsAt60m = usePipsFromBaseline ? event.pipsFromBaseline?.at60m ?? null : calcPips(event.priceAtPlus60m ?? event.priceAtPlus1hr);
  const pipsAt90m = usePipsFromBaseline ? event.pipsFromBaseline?.at90m ?? null : calcPips(event.priceAtPlus90m);

  // Extended aftermath pips
  const pipsAt2hr = usePipsFromBaseline ? event.pipsFromBaseline?.at2hr ?? null : calcPips(event.priceAtPlus2hr);
  const pipsAt4hr = usePipsFromBaseline ? event.pipsFromBaseline?.at4hr ?? null : calcPips(event.priceAtPlus4hr);
  const pipsAt8hr = usePipsFromBaseline ? event.pipsFromBaseline?.at8hr ?? null : calcPips(event.priceAtPlus8hr);
  const pipsAt24hr = usePipsFromBaseline ? event.pipsFromBaseline?.at24hr ?? null : calcPips(event.priceAtPlus24hr);

  // Check if we have settlement data to show
  const hasSettlementData = pipsAt15m !== null || pipsAt30m !== null || pipsAt60m !== null;
  const hasExtendedData = pipsAt2hr !== null || pipsAt4hr !== null || pipsAt8hr !== null || pipsAt24hr !== null;

  // Max for bar scaling (use largest absolute value across all timepoints)
  const allPips = [spikePips, pipsAt15m, pipsAt30m, pipsAt60m, pipsAt90m, pipsAt2hr, pipsAt4hr, pipsAt8hr, pipsAt24hr].filter((p): p is number => p !== null && !isNaN(p));
  const maxPips = Math.max(...allPips.map(Math.abs), 10);

  // Window type indicator
  const windowLabel = event.windowMinutes === 105 ? "Extended" : event.windowMinutes === 75 ? "High Impact" : "";

  return (
    <div className="rounded bg-gray-800/50 p-2.5">
      {/* Date and window type */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-300">{dateStr}</div>
        {windowLabel && (
          <div className="text-[10px] text-gray-500 px-1.5 py-0.5 bg-gray-700/50 rounded">
            {windowLabel}
          </div>
        )}
      </div>

      {/* Spike info */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500">Spike:</span>
        <span className={`text-sm font-semibold ${event.spikeDirection === "UP" ? "text-green-400" : "text-red-400"}`}>
          {event.spikeMagnitudePips.toFixed(1)} pips {event.spikeDirection === "UP" ? "↑" : "↓"}
        </span>
        <span className="text-xs text-gray-600">
          ({formatPrice(event.priceAtEvent)} → {formatPrice(spikeTarget)})
        </span>
      </div>

      {/* Reversal info + Pattern type */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {event.didReverse && event.reversalMagnitudePips ? (
          <>
            <span className="text-xs text-gray-500">Reversal:</span>
            <span className="text-sm font-semibold text-amber-400">
              {event.reversalMagnitudePips.toFixed(1)} pips pullback
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-500">Result:</span>
            <span className="text-sm font-semibold text-green-400">Held direction ✓</span>
          </>
        )}
        {event.patternType && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            event.patternType === "continuation" ? "bg-green-900/50 text-green-400" :
            event.patternType === "spike_reversal" ? "bg-red-900/50 text-red-400" :
            event.patternType === "fade" ? "bg-amber-900/50 text-amber-400" :
            event.patternType === "trap" ? "bg-purple-900/50 text-purple-400" :
            event.patternType === "range" ? "bg-blue-900/50 text-blue-400" :
            "bg-gray-700/50 text-gray-400"
          }`}>
            {event.patternType.replace(/_/g, " ")}
          </span>
        )}
        {event.extendedPatternType && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            event.extendedPatternType === "spike_trend" ? "bg-green-900/50 text-green-400" :
            event.extendedPatternType === "mean_reversion" ? "bg-amber-900/50 text-amber-400" :
            event.extendedPatternType === "new_range" ? "bg-blue-900/50 text-blue-400" :
            "bg-gray-700/50 text-gray-400"
          }`}>
            24hr: {event.extendedPatternType.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Mini diverging bar chart - full settlement timeline from T-15 baseline */}
      {hasSettlementData ? (
        <div className="border-t border-gray-700/50 pt-2 mt-1">
          <div className="text-xs text-gray-600 mb-1 text-center">
            ◄ DOWN │ UP ► {usePipsFromBaseline && <span className="text-gray-700">(from T-15)</span>}
          </div>
          <SettlementBar label="Spike" pips={spikePips} maxPips={maxPips} />
          {pipsAt15m !== null && <SettlementBar label="+15m" pips={pipsAt15m} maxPips={maxPips} />}
          {pipsAt30m !== null && <SettlementBar label="+30m" pips={pipsAt30m} maxPips={maxPips} />}
          {pipsAt60m !== null && <SettlementBar label="+60m" pips={pipsAt60m} maxPips={maxPips} />}
          {pipsAt90m !== null && <SettlementBar label="+90m" pips={pipsAt90m} maxPips={maxPips} />}

          {/* Extended aftermath section */}
          {hasExtendedData && (
            <>
              <div className="border-t border-gray-700/30 my-1" />
              {pipsAt2hr !== null && <SettlementBar label="+2hr" pips={pipsAt2hr} maxPips={maxPips} />}
              {pipsAt4hr !== null && <SettlementBar label="+4hr" pips={pipsAt4hr} maxPips={maxPips} />}
              {pipsAt8hr !== null && <SettlementBar label="+8hr" pips={pipsAt8hr} maxPips={maxPips} />}
              {pipsAt24hr !== null && <SettlementBar label="+24hr" pips={pipsAt24hr} maxPips={maxPips} />}
            </>
          )}
        </div>
      ) : (
        <div className="border-t border-gray-700/50 pt-2 mt-1 text-xs text-gray-600 text-center">
          Settlement data not available
        </div>
      )}
    </div>
  );
}

// Speaker Profile Card Component
function SpeakerProfileCard({ definition }: { definition: SpeakerDefinition }) {
  const { speaker } = definition;

  const stanceColor = {
    hawkish: "text-red-400",
    dovish: "text-green-400",
    neutral: "text-gray-400",
    pragmatic: "text-blue-400",
    "dovish-to-neutral": "text-green-300",
    "hawkish-to-neutral": "text-red-300",
  }[speaker.stance.toLowerCase()] || "text-gray-400";

  return (
    <div className="space-y-3">
      {/* Role and Institution */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Role:</span>
          <span className="text-sm text-white">{speaker.role}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Institution:</span>
          <span className="text-sm text-gray-300">{speaker.institution}</span>
        </div>
        {speaker.votingMember && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Voting:</span>
            <span className="text-sm text-amber-400">{speaker.votingYears || "Yes"}</span>
          </div>
        )}
      </div>

      {/* Stance */}
      <div className="bg-gray-800/50 rounded p-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500">Stance:</span>
          <span className={`text-sm font-semibold capitalize ${stanceColor}`}>
            {speaker.stance}
          </span>
        </div>
      </div>

      {/* What to Watch */}
      {definition.whatToWatch && (
        <div>
          <div className="text-xs text-gray-500 mb-1">What to Watch</div>
          <p className="text-xs text-gray-300 leading-relaxed">{definition.whatToWatch}</p>
        </div>
      )}

      {/* Market Sensitivity */}
      {definition.marketSensitivity && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Market Sensitivity</div>
          <p className="text-xs text-gray-300 leading-relaxed">{definition.marketSensitivity}</p>
        </div>
      )}

      {/* Regime Change Potential */}
      {definition.regimeChangePotential && (
        <div className="bg-gray-800/50 rounded p-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Regime Change Potential:</span>
            <span className={`text-xs font-semibold capitalize ${
              definition.regimeChangePotential === "very high" ? "text-red-400" :
              definition.regimeChangePotential === "high" ? "text-amber-400" :
              "text-gray-400"
            }`}>
              {definition.regimeChangePotential}
            </span>
          </div>
        </div>
      )}

      {/* Notable Moments */}
      {speaker.notableMoments && speaker.notableMoments.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-2">Notable Moments</div>
          <div className="space-y-2">
            {speaker.notableMoments.slice(0, 3).map((moment, idx) => (
              <div key={idx} className="bg-gray-800/30 rounded p-2">
                <div className="text-xs text-gray-500">{moment.date}</div>
                <div className="text-xs text-gray-300 leading-relaxed">{moment.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Wikipedia Link */}
      {speaker.wikipediaUrl && (
        <a
          href={speaker.wikipediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <span>Learn more</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}

// Economic Event Card Component
function EconomicEventCard({
  definition,
  outcome
}: {
  definition: EconomicDefinition;
  outcome: "beat" | "miss" | "inline" | null;
}) {
  return (
    <div className="space-y-3">
      {/* Beat/Miss Interpretations */}
      {definition.beatInterpretation && definition.missInterpretation && (
        <div className="space-y-2">
          {/* Show relevant interpretation based on outcome, or both for future events */}
          {(outcome === null || outcome === "beat") && (
            <div className={`rounded p-2 ${outcome === "beat" ? "bg-green-900/30 border border-green-800/50" : "bg-gray-800/50"}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-semibold text-green-400">If BEATS</span>
                <span className="text-xs text-gray-500">({definition.beatInterpretation.direction})</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">{definition.beatInterpretation.description}</p>
              <p className="text-xs text-gray-400 mt-1">{definition.beatInterpretation.currency_impact}</p>
            </div>
          )}
          {(outcome === null || outcome === "miss") && (
            <div className={`rounded p-2 ${outcome === "miss" ? "bg-red-900/30 border border-red-800/50" : "bg-gray-800/50"}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-xs font-semibold text-red-400">If MISSES</span>
                <span className="text-xs text-gray-500">({definition.missInterpretation.direction})</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">{definition.missInterpretation.description}</p>
              <p className="text-xs text-gray-400 mt-1">{definition.missInterpretation.currency_impact}</p>
            </div>
          )}
        </div>
      )}

      {/* Trading Notes */}
      {definition.tradingNotes && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Trading Notes</div>
          <p className="text-xs text-gray-300 leading-relaxed">{definition.tradingNotes}</p>
        </div>
      )}

      {/* Historical Context */}
      {definition.historicalContext && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Historical Context</div>
          <p className="text-xs text-gray-400 leading-relaxed">{definition.historicalContext}</p>
        </div>
      )}

      {/* Related Events */}
      {definition.relatedEvents && definition.relatedEvents.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Related Events</div>
          <div className="flex flex-wrap gap-1">
            {definition.relatedEvents.slice(0, 5).map((related, idx) => (
              <span key={idx} className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                {related}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
