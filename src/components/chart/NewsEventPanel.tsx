"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
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

interface NewsEventPanelProps {
  event: NewsEventData;
  pair: string;
  onClose: () => void;
}

export function NewsEventPanel({ event, pair, onClose }: NewsEventPanelProps) {
  // Fetch historical events for this event type (excluding current event)
  const historicalData = useQuery(api.newsQueries.getHistoricalEventsForTooltip, {
    eventType: event.eventType,
    pair,
    beforeTimestamp: event.timestamp,
    limit: 10,
  });

  const eventDate = new Date(event.timestamp);
  const dateStr = eventDate.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeStr = eventDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

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
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">{dateStr} {timeStr}</div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <span
              className="w-1 h-6 rounded"
              style={{
                backgroundColor: event.impact === "high" ? "#ef4444" : event.impact === "medium" ? "#f59e0b" : "#6b7280"
              }}
            />
            {event.name}
          </h2>
          <div className="text-sm text-gray-400 mt-1">{event.currency}</div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors p-1"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
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

      {/* Historical Reactions Section */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Historical Reactions
        </h3>

        {!historicalData ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : historicalData.rawHistory.length === 0 ? (
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

  // Helper to safely calculate pips (returns null if data is missing)
  const calcPips = (price: number | undefined): number | null => {
    if (price === undefined || price === null || event.priceAtEvent === undefined) return null;
    const pips = (price - event.priceAtEvent) / pipValue;
    return isNaN(pips) ? null : pips;
  };

  const pipsAt15m = calcPips(event.priceAtPlus15m);
  const pipsAt30m = calcPips(event.priceAtPlus30m);
  const pipsAt1hr = calcPips(event.priceAtPlus1hr);
  const pipsAt3hr = calcPips(event.priceAtPlus3hr);

  // Check if we have settlement data to show
  const hasSettlementData = pipsAt15m !== null || pipsAt30m !== null || pipsAt1hr !== null;

  // Max for bar scaling (use largest absolute value across all timepoints)
  const allPips = [spikePips, pipsAt15m, pipsAt30m, pipsAt1hr, pipsAt3hr].filter((p): p is number => p !== null && !isNaN(p));
  const maxPips = Math.max(...allPips.map(Math.abs), 10);

  return (
    <div className="rounded bg-gray-800/50 p-2.5">
      {/* Date */}
      <div className="text-xs font-medium text-gray-300 mb-2">{dateStr}</div>

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

      {/* Reversal info */}
      <div className="flex items-center gap-2 mb-2">
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
      </div>

      {/* Mini diverging bar chart - full settlement timeline */}
      {hasSettlementData ? (
        <div className="border-t border-gray-700/50 pt-2 mt-1">
          <div className="text-xs text-gray-600 mb-1 text-center">
            ◄ DOWN │ UP ►
          </div>
          <SettlementBar label="Spike" pips={spikePips} maxPips={maxPips} />
          {pipsAt15m !== null && <SettlementBar label="+15m" pips={pipsAt15m} maxPips={maxPips} />}
          {pipsAt30m !== null && <SettlementBar label="+30m" pips={pipsAt30m} maxPips={maxPips} />}
          {pipsAt1hr !== null && <SettlementBar label="+1hr" pips={pipsAt1hr} maxPips={maxPips} />}
          {pipsAt3hr !== null && <SettlementBar label="+3hr" pips={pipsAt3hr} maxPips={maxPips} />}
        </div>
      ) : (
        <div className="border-t border-gray-700/50 pt-2 mt-1 text-xs text-gray-600 text-center">
          Settlement data not available
        </div>
      )}
    </div>
  );
}
