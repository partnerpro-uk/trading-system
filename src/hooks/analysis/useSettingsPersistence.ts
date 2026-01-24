"use client";

import { useState, useEffect, useCallback } from "react";
import type { AIMethod, FeatureLevels, HDBParams } from "../../components/analysis/SettingsSidebar";
import type { FilterState } from "../../components/analysis/filters/FilterBar";
import { DEFAULT_FEATURE_LEVELS, DEFAULT_HDB_PARAMS } from "../../components/analysis/SettingsSidebar";
import { DEFAULT_FILTERS } from "../../components/analysis/filters/FilterBar";

// ============================================
// Types
// ============================================
export interface AnalysisSettings {
  // Pair/Timeframe
  pair: string;
  timeframe: string;

  // Model
  model: string;

  // Trade settings
  tpDist: number;
  slDist: number;
  chunkBars: number;

  // Feature levels
  featureLevels: FeatureLevels;

  // AI settings
  aiMethod: AIMethod;
  aiModalities: string[];
  hdbMinClusterSize: number;
  hdbMinSamples: number;
  hdbEpsQuantile: number;

  // Filters
  filters: FilterState;
}

export interface SettingsPreset {
  name: string;
  description?: string;
  settings: Partial<AnalysisSettings>;
}

const STORAGE_KEY = "analysis-settings";
const PRESETS_KEY = "analysis-presets";

// ============================================
// Default Settings
// ============================================
export const DEFAULT_SETTINGS: AnalysisSettings = {
  pair: "EURUSD",
  timeframe: "15min",
  model: "Momentum",
  tpDist: 50,
  slDist: 30,
  chunkBars: 16,
  featureLevels: DEFAULT_FEATURE_LEVELS,
  aiMethod: "off",
  aiModalities: [],
  hdbMinClusterSize: 5,
  hdbMinSamples: 3,
  hdbEpsQuantile: 0.15,
  filters: DEFAULT_FILTERS,
};

// ============================================
// Built-in Presets
// ============================================
export const BUILT_IN_PRESETS: SettingsPreset[] = [
  {
    name: "Scalping",
    description: "Tight TP/SL, small chunks for scalping strategies",
    settings: {
      tpDist: 20,
      slDist: 15,
      chunkBars: 8,
    },
  },
  {
    name: "Swing Trading",
    description: "Wider TP/SL, larger chunks for swing trades",
    settings: {
      tpDist: 100,
      slDist: 50,
      chunkBars: 32,
    },
  },
  {
    name: "Momentum Hunter",
    description: "Optimized for Momentum model",
    settings: {
      model: "Momentum",
      tpDist: 60,
      slDist: 30,
      chunkBars: 16,
      featureLevels: {
        ...DEFAULT_FEATURE_LEVELS,
        pricePath: 4,
        rangeTrend: 3,
      },
    },
  },
  {
    name: "Mean Reversion",
    description: "Optimized for Mean Reversion model",
    settings: {
      model: "Mean Reversion",
      tpDist: 40,
      slDist: 25,
      chunkBars: 12,
      featureLevels: {
        ...DEFAULT_FEATURE_LEVELS,
        position: 4,
        rangeTrend: 3,
      },
    },
  },
  {
    name: "AI Enhanced",
    description: "KNN with multiple libraries enabled",
    settings: {
      aiMethod: "knn",
      aiModalities: ["priceAction", "timeContext", "support"],
    },
  },
];

// ============================================
// Hook
// ============================================
export function useSettingsPersistence(
  initialPair?: string,
  initialTimeframe?: string
) {
  const [settings, setSettings] = useState<AnalysisSettings>(() => ({
    ...DEFAULT_SETTINGS,
    pair: initialPair || DEFAULT_SETTINGS.pair,
    timeframe: initialTimeframe || DEFAULT_SETTINGS.timeframe,
  }));

  const [customPresets, setCustomPresets] = useState<SettingsPreset[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings((prev) => ({
          ...prev,
          ...parsed,
          // Keep pair/timeframe from URL params if provided
          pair: initialPair || parsed.pair || prev.pair,
          timeframe: initialTimeframe || parsed.timeframe || prev.timeframe,
        }));
      }

      const storedPresets = localStorage.getItem(PRESETS_KEY);
      if (storedPresets) {
        setCustomPresets(JSON.parse(storedPresets));
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }

    setIsLoaded(true);
  }, [initialPair, initialTimeframe]);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: Partial<AnalysisSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save settings:", error);
      }
      return updated;
    });
  }, []);

  // Reset to default settings
  const resetSettings = useCallback(() => {
    setSettings({
      ...DEFAULT_SETTINGS,
      pair: initialPair || DEFAULT_SETTINGS.pair,
      timeframe: initialTimeframe || DEFAULT_SETTINGS.timeframe,
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Failed to clear settings:", error);
    }
  }, [initialPair, initialTimeframe]);

  // Apply a preset
  const applyPreset = useCallback(
    (preset: SettingsPreset) => {
      saveSettings(preset.settings);
    },
    [saveSettings]
  );

  // Save current settings as a new preset
  const saveAsPreset = useCallback(
    (name: string, description?: string) => {
      const newPreset: SettingsPreset = {
        name,
        description,
        settings: { ...settings },
      };

      setCustomPresets((prev) => {
        const updated = [...prev.filter((p) => p.name !== name), newPreset];
        try {
          localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
        } catch (error) {
          console.error("Failed to save presets:", error);
        }
        return updated;
      });
    },
    [settings]
  );

  // Delete a custom preset
  const deletePreset = useCallback((name: string) => {
    setCustomPresets((prev) => {
      const updated = prev.filter((p) => p.name !== name);
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Failed to save presets:", error);
      }
      return updated;
    });
  }, []);

  // Export settings as JSON
  const exportSettings = useCallback((): string => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  // Import settings from JSON
  const importSettings = useCallback(
    (json: string): boolean => {
      try {
        const parsed = JSON.parse(json);
        saveSettings(parsed);
        return true;
      } catch (error) {
        console.error("Failed to import settings:", error);
        return false;
      }
    },
    [saveSettings]
  );

  // All presets (built-in + custom)
  const allPresets = [...BUILT_IN_PRESETS, ...customPresets];

  return {
    settings,
    saveSettings,
    resetSettings,
    applyPreset,
    saveAsPreset,
    deletePreset,
    exportSettings,
    importSettings,
    allPresets,
    customPresets,
    isLoaded,
  };
}

// ============================================
// Helper Types for Component Props
// ============================================
export type SettingsPersistence = ReturnType<typeof useSettingsPersistence>;
