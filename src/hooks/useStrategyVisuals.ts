/**
 * useStrategyVisuals Hook
 *
 * Fetches strategy visual configuration and computes indicators.
 * Returns indicator series ready for chart rendering.
 * Also computes custom indicators and generates markers/zones.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  IndicatorConfig,
  IndicatorSeries,
  CandleInput,
  computeIndicators,
  getIndicatorSnapshot,
} from "@/lib/indicators";
import { computeSpikeDetector, SpikeDetectorOutput } from "@/strategies/echo-strategy/custom/spike-detector";

/** Marker configuration from visuals.json */
interface MarkerConfig {
  condition: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  position: "belowBar" | "aboveBar" | "inBar";
  text?: string;
}

/** Zone configuration from visuals.json */
interface ZoneConfig {
  condition: string;
  color: string;
}

/** Custom indicator configuration */
interface CustomIndicatorConfig {
  id: string;
  module: string;
  params: Record<string, unknown>;
}

/** Strategy visuals configuration from visuals.json */
interface StrategyVisuals {
  strategyId: string;
  name: string;
  version: string;
  indicators: IndicatorConfig[];
  customIndicators?: CustomIndicatorConfig[];
  markers?: Record<string, MarkerConfig>;
  zones?: Record<string, ZoneConfig>;
  description?: Record<string, string>;
  trend_rules?: Record<string, string>;
  notes?: string;
}

/** Chart marker data for rendering */
export interface ChartMarker {
  time: number;
  position: "belowBar" | "aboveBar" | "inBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
}

/** Zone data for rendering */
export interface ChartZone {
  startTime: number;
  endTime: number;
  color: string;
}

interface UseStrategyVisualsOptions {
  /** Strategy ID to load visuals for (null = no strategy selected) */
  strategyId: string | null;
  /** Candle data to compute indicators from */
  candles: CandleInput[] | null;
}

interface UseStrategyVisualsReturn {
  /** Strategy visuals configuration */
  visuals: StrategyVisuals | null;
  /** Computed indicator series for chart rendering */
  indicatorSeries: IndicatorSeries[];
  /** Indicator configs for styling */
  indicatorConfigs: IndicatorConfig[];
  /** Markers to render on chart */
  markers: ChartMarker[];
  /** Zones to render on chart */
  zones: ChartZone[];
  /** Loading state */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Get indicator snapshot at a specific timestamp */
  getSnapshot: (timestamp: number) => Record<string, number>;
  /** Check if fast EMA is above slow EMA (uptrend) */
  isUptrend: (timestamp: number) => boolean | null;
}

/**
 * Evaluate a marker condition like "spike_detector.upSpike === 1"
 */
function evaluateCondition(
  condition: string,
  timestamp: number,
  indicatorMaps: Map<string, Map<number, number>>,
  customMaps: Map<string, Map<string, Map<number, number>>>
): boolean {
  try {
    // Parse condition like "spike_detector.upSpike === 1"
    const match = condition.match(/^(\w+)\.(\w+)\s*(===|==|>|<|>=|<=)\s*(\d+(?:\.\d+)?)$/);
    if (match) {
      const [, indicatorId, field, operator, valueStr] = match;
      const targetValue = parseFloat(valueStr);

      // Check custom indicators first
      const customFields = customMaps.get(indicatorId);
      if (customFields) {
        const fieldMap = customFields.get(field);
        if (fieldMap) {
          const actualValue = fieldMap.get(timestamp);
          if (actualValue !== undefined) {
            return compareValues(actualValue, operator, targetValue);
          }
        }
      }
    }

    // Parse simple indicator comparison like "fast_ema > slow_ema"
    const simpleMatch = condition.match(/^(\w+)\s*(>|<|>=|<=|===|==)\s*(\w+)$/);
    if (simpleMatch) {
      const [, ind1, operator, ind2] = simpleMatch;
      const map1 = indicatorMaps.get(ind1);
      const map2 = indicatorMaps.get(ind2);
      if (map1 && map2) {
        const val1 = map1.get(timestamp);
        const val2 = map2.get(timestamp);
        if (val1 !== undefined && val2 !== undefined) {
          return compareValues(val1, operator, val2);
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Evaluate a zone condition like "fast_ema > slow_ema"
 */
function evaluateZoneCondition(
  condition: string,
  timestamp: number,
  indicatorMaps: Map<string, Map<number, number>>
): boolean {
  try {
    // Parse comparison like "fast_ema > slow_ema"
    const match = condition.match(/^(\w+)\s*(>|<|>=|<=|===|==)\s*(\w+)$/);
    if (match) {
      const [, ind1, operator, ind2] = match;
      const map1 = indicatorMaps.get(ind1);
      const map2 = indicatorMaps.get(ind2);
      if (map1 && map2) {
        const val1 = map1.get(timestamp);
        const val2 = map2.get(timestamp);
        if (val1 !== undefined && val2 !== undefined) {
          return compareValues(val1, operator, val2);
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Compare two values with an operator
 */
function compareValues(a: number, operator: string, b: number): boolean {
  switch (operator) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "===":
    case "==": return a === b;
    default: return false;
  }
}

export function useStrategyVisuals({
  strategyId,
  candles,
}: UseStrategyVisualsOptions): UseStrategyVisualsReturn {
  const [visuals, setVisuals] = useState<StrategyVisuals | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch visuals.json when strategy changes
  useEffect(() => {
    if (!strategyId) {
      setVisuals(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetch(`/api/strategies/${strategyId}/visuals`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load strategy visuals: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        setVisuals(data);
      })
      .catch((err) => {
        console.error("Error loading strategy visuals:", err);
        setError(err.message);
        setVisuals(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [strategyId]);

  // Compute indicator series when candles or visuals change
  const indicatorSeries = useMemo(() => {
    if (!visuals || !candles || candles.length === 0) {
      return [];
    }

    try {
      // Convert candles to CandleInput format
      const candleInputs: CandleInput[] = candles.map((c) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Compute all indicators defined in visuals.json
      return computeIndicators(candleInputs, visuals.indicators);
    } catch (err) {
      console.error("Error computing indicators:", err);
      return [];
    }
  }, [visuals, candles]);

  // Extract indicator configs from visuals
  const indicatorConfigs = useMemo(() => {
    return visuals?.indicators || [];
  }, [visuals]);

  // Compute custom indicators (spike detector)
  const customIndicatorOutputs = useMemo(() => {
    if (!visuals?.customIndicators || !candles || candles.length === 0) {
      return new Map<string, SpikeDetectorOutput>();
    }

    const outputs = new Map<string, SpikeDetectorOutput>();

    for (const customConfig of visuals.customIndicators) {
      if (customConfig.module.includes("spike-detector")) {
        // Convert candles to CandleInput format
        const candleInputs: CandleInput[] = candles.map((c) => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        try {
          const output = computeSpikeDetector(candleInputs, customConfig.params as Record<string, number>);
          outputs.set(customConfig.id, output);
        } catch (err) {
          console.error(`Error computing ${customConfig.id}:`, err);
        }
      }
    }

    return outputs;
  }, [visuals, candles]);

  // Generate markers from marker configs
  const markers = useMemo((): ChartMarker[] => {
    if (!visuals?.markers || !candles || candles.length === 0) {
      return [];
    }

    const result: ChartMarker[] = [];

    // Build lookup maps for indicator values
    const indicatorMaps = new Map<string, Map<number, number>>();
    for (const series of indicatorSeries) {
      const valueMap = new Map<number, number>();
      for (const v of series.values) {
        valueMap.set(v.timestamp, v.value);
      }
      indicatorMaps.set(series.id, valueMap);
    }

    // Build lookup maps for custom indicator outputs
    const customMaps = new Map<string, Map<string, Map<number, number>>>();
    for (const [id, output] of customIndicatorOutputs) {
      const fieldMaps = new Map<string, Map<number, number>>();
      // upSpike, downSpike, spikeStrength
      for (const fieldName of ["upSpike", "downSpike", "spikeStrength"] as const) {
        const valueMap = new Map<number, number>();
        for (const v of output[fieldName]) {
          valueMap.set(v.timestamp, v.value);
        }
        fieldMaps.set(fieldName, valueMap);
      }
      customMaps.set(id, fieldMaps);
    }

    // Evaluate each marker config for each candle
    for (const [markerId, config] of Object.entries(visuals.markers)) {
      for (const candle of candles) {
        const timestamp = candle.timestamp;

        // Evaluate condition
        const conditionMet = evaluateCondition(
          config.condition,
          timestamp,
          indicatorMaps,
          customMaps
        );

        if (conditionMet) {
          result.push({
            time: timestamp,
            position: config.position,
            color: config.color,
            shape: config.shape,
            text: config.text,
          });
        }
      }
    }

    // Sort by time
    result.sort((a, b) => a.time - b.time);

    return result;
  }, [visuals, candles, indicatorSeries, customIndicatorOutputs]);

  // Generate zones from zone configs
  const zones = useMemo((): ChartZone[] => {
    if (!visuals?.zones || !candles || candles.length === 0 || indicatorSeries.length === 0) {
      return [];
    }

    const result: ChartZone[] = [];

    // Build lookup maps for indicator values
    const indicatorMaps = new Map<string, Map<number, number>>();
    for (const series of indicatorSeries) {
      const valueMap = new Map<number, number>();
      for (const v of series.values) {
        valueMap.set(v.timestamp, v.value);
      }
      indicatorMaps.set(series.id, valueMap);
    }

    // For each zone config, find continuous ranges where condition is true
    for (const [zoneId, config] of Object.entries(visuals.zones)) {
      let currentZone: { startTime: number; color: string } | null = null;

      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const timestamp = candle.timestamp;

        // Evaluate condition (zones typically use indicator comparisons)
        const conditionMet = evaluateZoneCondition(
          config.condition,
          timestamp,
          indicatorMaps
        );

        if (conditionMet) {
          if (!currentZone) {
            // Start new zone
            currentZone = { startTime: timestamp, color: config.color };
          }
        } else {
          if (currentZone) {
            // End current zone
            const prevTimestamp = i > 0 ? candles[i - 1].timestamp : currentZone.startTime;
            result.push({
              startTime: currentZone.startTime,
              endTime: prevTimestamp,
              color: currentZone.color,
            });
            currentZone = null;
          }
        }
      }

      // Close any open zone at the end
      if (currentZone && candles.length > 0) {
        result.push({
          startTime: currentZone.startTime,
          endTime: candles[candles.length - 1].timestamp,
          color: currentZone.color,
        });
      }
    }

    return result;
  }, [visuals, candles, indicatorSeries]);

  // Get snapshot of indicator values at a timestamp
  const getSnapshot = useCallback(
    (timestamp: number): Record<string, number> => {
      if (indicatorSeries.length === 0) return {};
      return getIndicatorSnapshot(indicatorSeries, timestamp).indicators;
    },
    [indicatorSeries]
  );

  // Check trend state (for Echo Strategy: fast EMA > slow EMA = uptrend)
  const isUptrend = useCallback(
    (timestamp: number): boolean | null => {
      const snapshot = getSnapshot(timestamp);
      const fastEma = snapshot["fast_ema"];
      const slowEma = snapshot["slow_ema"];

      if (fastEma === undefined || slowEma === undefined) {
        return null;
      }

      return fastEma > slowEma;
    },
    [getSnapshot]
  );

  return {
    visuals,
    indicatorSeries,
    indicatorConfigs,
    markers,
    zones,
    isLoading,
    error,
    getSnapshot,
    isUptrend,
  };
}
