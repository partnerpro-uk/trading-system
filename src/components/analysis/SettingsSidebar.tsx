"use client";

import { useState, useCallback } from "react";
import {
  Settings,
  ChevronDown,
  ChevronUp,
  Play,
  Loader2,
  Sliders,
  Brain,
  Target,
  Layers,
  Clock,
  Shield,
  Zap,
  Database,
  TrendingUp,
  Upload,
  Download,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import {
  MODELS,
  FEATURE_DEFS,
  MODEL_FEATURE_DEFS_BY_MODEL,
  FEATURE_LEVEL_LABEL,
  AI_LIBRARY_DEFS,
} from "../../lib/analysis/constants";
import type {
  FullAnalysisSettings,
  FeatureLevels,
  FeatureModes,
  ModelStates,
  EnabledSessions,
  EnabledMonths,
  EnabledDows,
  EnabledHours,
  EnabledYears,
  LibrarySettings,
  AIMethod,
  StopMode,
  KnnVoteMode,
  DimStyle,
  CompressionMethod,
  DistanceMetric,
  ValidationMode,
  HdbModalityDistinction,
  FeatureMode,
} from "../../lib/analysis/settings-types";
import {
  DEFAULT_FULL_SETTINGS,
  DEFAULT_FEATURE_LEVELS,
  DEFAULT_FEATURE_MODES,
  DEFAULT_MODEL_STATES,
  DEFAULT_ENABLED_SESSIONS,
  DEFAULT_ENABLED_MONTHS,
  DEFAULT_ENABLED_DOWS,
  DEFAULT_ENABLED_HOURS,
  DEFAULT_ENABLED_YEARS,
  LIBRARY_IDS,
} from "../../lib/analysis/settings-types";

// Re-export types for backward compatibility
export type { FeatureLevels, AIMethod };
export type HDBParams = {
  minClusterSize: number;
  minSamples: number;
  epsQuantile: number;
};

export { DEFAULT_FEATURE_LEVELS };
export const DEFAULT_HDB_PARAMS: HDBParams = {
  minClusterSize: DEFAULT_FULL_SETTINGS.hdbMinClusterSize,
  minSamples: DEFAULT_FULL_SETTINGS.hdbMinSamples,
  epsQuantile: DEFAULT_FULL_SETTINGS.hdbEpsQuantile,
};

// ============================================
// PROPS INTERFACE
// ============================================

export interface SettingsSidebarProps {
  settings: FullAnalysisSettings;
  onSettingsChange: (updates: Partial<FullAnalysisSettings>) => void;
  onRunAnalysis: () => void;
  isComputing: boolean;
  onExportSettings?: () => void;
  onImportSettings?: (json: string) => void;
  onResetSettings?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function SettingsSidebar({
  settings,
  onSettingsChange,
  onRunAnalysis,
  isComputing,
  onExportSettings,
  onImportSettings,
  onResetSettings,
  isOpen = true,
  onToggle,
}: SettingsSidebarProps) {
  // Collapsible sections
  const [sectionsOpen, setSectionsOpen] = useState({
    trade: true,
    limits: false,
    stops: false,
    ai: true,
    hdbscan: false,
    knn: false,
    confidence: false,
    dimensionality: false,
    features: false,
    featureModes: false,
    models: false,
    timeFilters: false,
    libraries: false,
    librarySettings: false,
    validation: false,
  });

  const toggleSection = (section: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Helper to update settings
  const update = useCallback(
    <K extends keyof FullAnalysisSettings>(key: K, value: FullAnalysisSettings[K]) => {
      onSettingsChange({ [key]: value });
    },
    [onSettingsChange]
  );

  // Get model-specific features
  const activeModel = Object.entries(settings.modelStates).find(
    ([, state]) => state === 2
  )?.[0] || "Momentum";
  const modelFeatures = MODEL_FEATURE_DEFS_BY_MODEL[activeModel] || [];

  // Toggle library
  const toggleLibrary = (id: string) => {
    const active = settings.aiLibrariesActive;
    if (active.includes(id)) {
      update("aiLibrariesActive", active.filter((l) => l !== id));
    } else {
      update("aiLibrariesActive", [...active, id]);
    }
  };

  // Update library setting
  const updateLibrarySetting = (libId: string, key: keyof LibrarySettings, value: number | boolean | string) => {
    const current = settings.aiLibrariesSettings[libId] || { weight: 100, maxSamples: 10000, stride: 0 };
    update("aiLibrariesSettings", {
      ...settings.aiLibrariesSettings,
      [libId]: { ...current, [key]: value },
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed left-4 top-20 z-50 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
      >
        <Settings className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="w-96 bg-gray-900 border-r border-gray-800 h-full overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-purple-400" />
          <span className="font-semibold text-gray-200">Full Settings</span>
          <span className="text-xs text-gray-500">v{settings.version}</span>
        </div>
        {onToggle && (
          <button
            onClick={onToggle}
            className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-gray-300"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Run Analysis Button */}
      <div className="p-4 border-b border-gray-800 sticky top-14 bg-gray-900 z-10">
        <button
          onClick={onRunAnalysis}
          disabled={isComputing}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
        >
          {isComputing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Computing...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Run Analysis
            </>
          )}
        </button>

        {/* Import/Export/Reset Buttons */}
        <div className="flex gap-2 mt-3">
          {onImportSettings && (
            <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              Import
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const content = event.target?.result as string;
                      if (content) onImportSettings(content);
                    };
                    reader.readAsText(file);
                  }
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {onExportSettings && (
            <button
              onClick={onExportSettings}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          )}
          {onResetSettings && (
            <button
              onClick={onResetSettings}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm transition-colors"
              title="Reset to defaults"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ========== TRADE PARAMETERS ========== */}
        <Section
          title="Trade Parameters"
          icon={<Target className="w-4 h-4" />}
          isOpen={sectionsOpen.trade}
          onToggle={() => toggleSection("trade")}
        >
          <div className="space-y-4">
            <SliderControl
              label="Chunk Bars"
              value={settings.chunkBars}
              onChange={(v) => update("chunkBars", v)}
              min={4}
              max={64}
              step={1}
              unit="bars"
            />
            <SliderControl
              label="TP (Take Profit)"
              value={settings.tpDollars}
              onChange={(v) => update("tpDollars", v)}
              min={100}
              max={10000}
              step={50}
              unit="$"
            />
            <SliderControl
              label="SL (Stop Loss)"
              value={settings.slDollars}
              onChange={(v) => update("slDollars", v)}
              min={100}
              max={5000}
              step={25}
              unit="$"
            />
            <SliderControl
              label="Dollars Per Move"
              value={settings.dollarsPerMove}
              onChange={(v) => update("dollarsPerMove", v)}
              min={1}
              max={1000}
              step={1}
              unit="$/pip"
            />
          </div>
        </Section>

        {/* ========== TRADE LIMITS ========== */}
        <Section
          title="Trade Limits"
          icon={<Shield className="w-4 h-4" />}
          isOpen={sectionsOpen.limits}
          onToggle={() => toggleSection("limits")}
        >
          <div className="space-y-4">
            <SliderControl
              label="Max Trades Per Day"
              value={settings.maxTradesPerDay}
              onChange={(v) => update("maxTradesPerDay", v)}
              min={0}
              max={50}
              step={1}
              unit=""
              hint="0 = unlimited"
            />
            <SliderControl
              label="Cooldown Bars"
              value={settings.cooldownBars}
              onChange={(v) => update("cooldownBars", v)}
              min={0}
              max={100}
              step={1}
              unit="bars"
            />
            <SliderControl
              label="Max Concurrent Trades"
              value={settings.maxConcurrentTrades}
              onChange={(v) => update("maxConcurrentTrades", v)}
              min={1}
              max={10}
              step={1}
            />
            <SliderControl
              label="Max Bars In Trade"
              value={settings.maxBarsInTrade}
              onChange={(v) => update("maxBarsInTrade", v)}
              min={0}
              max={500}
              step={1}
              hint="0 = unlimited"
            />
          </div>
        </Section>

        {/* ========== STOP MANAGEMENT ========== */}
        <Section
          title="Stop Management"
          icon={<TrendingUp className="w-4 h-4" />}
          isOpen={sectionsOpen.stops}
          onToggle={() => toggleSection("stops")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Stop Mode</label>
              <select
                value={settings.stopMode}
                onChange={(e) => update("stopMode", Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value={0}>None</option>
                <option value={1}>Break Even</option>
                <option value={2}>Trailing Stop</option>
                <option value={3}>Both</option>
              </select>
            </div>

            {settings.stopMode > 0 && (
              <>
                <SliderControl
                  label="Stop Trigger %"
                  value={settings.stopTriggerPct}
                  onChange={(v) => update("stopTriggerPct", v)}
                  min={10}
                  max={100}
                  step={5}
                  unit="%"
                />
                {(settings.stopMode === 1 || settings.stopMode === 3) && (
                  <SliderControl
                    label="Break Even Trigger %"
                    value={settings.breakEvenTriggerPct}
                    onChange={(v) => update("breakEvenTriggerPct", v)}
                    min={10}
                    max={100}
                    step={5}
                    unit="%"
                  />
                )}
                {(settings.stopMode === 2 || settings.stopMode === 3) && (
                  <>
                    <SliderControl
                      label="Trailing Start %"
                      value={settings.trailingStartPct}
                      onChange={(v) => update("trailingStartPct", v)}
                      min={10}
                      max={100}
                      step={5}
                      unit="%"
                    />
                    <SliderControl
                      label="Trailing Distance %"
                      value={settings.trailingDistPct}
                      onChange={(v) => update("trailingDistPct", v)}
                      min={5}
                      max={100}
                      step={5}
                      unit="%"
                    />
                  </>
                )}
              </>
            )}
          </div>
        </Section>

        {/* ========== AI CORE ========== */}
        <Section
          title="AI Configuration"
          icon={<Brain className="w-4 h-4" />}
          isOpen={sectionsOpen.ai}
          onToggle={() => toggleSection("ai")}
        >
          <div className="space-y-4">
            {/* AI Method Toggle */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">AI Method</label>
              <div className="flex gap-1 p-1 bg-gray-800 rounded-lg">
                {(["off", "knn", "hdbscan"] as AIMethod[]).map((method) => (
                  <button
                    key={method}
                    onClick={() => {
                      update("aiMethod", method);
                      update("useAI", method !== "off");
                    }}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      settings.aiMethod === method
                        ? "bg-purple-600 text-white"
                        : "text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {method === "off" ? "Off" : method.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <ToggleControl
              label="Check Every Bar"
              checked={settings.checkEveryBar}
              onChange={(v) => update("checkEveryBar", v)}
              hint="Re-evaluate AI signals on each bar"
            />

            {/* Complexity Slider */}
            <SliderControl
              label="Complexity"
              value={settings.complexity}
              onChange={(v) => update("complexity", v)}
              min={1}
              max={100}
              step={1}
              unit="%"
              hint="Higher = more features"
            />
          </div>
        </Section>

        {/* ========== HDBSCAN PARAMETERS ========== */}
        {settings.aiMethod === "hdbscan" && (
          <Section
            title="HDBSCAN Parameters"
            icon={<Database className="w-4 h-4" />}
            isOpen={sectionsOpen.hdbscan}
            onToggle={() => toggleSection("hdbscan")}
          >
            <div className="space-y-4">
              <SliderControl
                label="Min Cluster Size"
                value={settings.hdbMinClusterSize}
                onChange={(v) => update("hdbMinClusterSize", v)}
                min={2}
                max={200}
                step={1}
              />
              <SliderControl
                label="Min Samples"
                value={settings.hdbMinSamples}
                onChange={(v) => update("hdbMinSamples", v)}
                min={1}
                max={100}
                step={1}
              />
              <SliderControl
                label="Eps Quantile"
                value={Math.round(settings.hdbEpsQuantile * 100)}
                onChange={(v) => update("hdbEpsQuantile", v / 100)}
                min={1}
                max={99}
                step={1}
                unit="%"
              />
              <SliderControl
                label="Sample Cap"
                value={settings.hdbSampleCap}
                onChange={(v) => update("hdbSampleCap", v)}
                min={100}
                max={10000}
                step={100}
              />
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">Modality Distinction</label>
                <select
                  value={settings.hdbModalityDistinction}
                  onChange={(e) => update("hdbModalityDistinction", e.target.value as HdbModalityDistinction)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="real">Real</option>
                  <option value="conceptual">Conceptual</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </Section>
        )}

        {/* ========== KNN PARAMETERS ========== */}
        {settings.aiMethod === "knn" && (
          <Section
            title="KNN Parameters"
            icon={<Zap className="w-4 h-4" />}
            isOpen={sectionsOpen.knn}
            onToggle={() => toggleSection("knn")}
          >
            <div className="space-y-4">
              <SliderControl
                label="K Entry"
                value={settings.kEntry}
                onChange={(v) => update("kEntry", v)}
                min={1}
                max={101}
                step={2}
                hint="Odd numbers recommended"
              />
              <SliderControl
                label="K Exit"
                value={settings.kExit}
                onChange={(v) => update("kExit", v)}
                min={1}
                max={51}
                step={2}
              />
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">Vote Mode</label>
                <select
                  value={settings.knnVoteMode}
                  onChange={(e) => update("knnVoteMode", e.target.value as KnnVoteMode)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="uniform">Uniform</option>
                  <option value="distance">Distance Weighted</option>
                  <option value="pnl_weighted">PnL Weighted</option>
                </select>
              </div>
            </div>
          </Section>
        )}

        {/* ========== CONFIDENCE & EXIT ========== */}
        {settings.aiMethod !== "off" && (
          <Section
            title="Confidence & Exit"
            icon={<Target className="w-4 h-4" />}
            isOpen={sectionsOpen.confidence}
            onToggle={() => toggleSection("confidence")}
          >
            <div className="space-y-4">
              <SliderControl
                label="Confidence Threshold"
                value={settings.confidenceThreshold}
                onChange={(v) => update("confidenceThreshold", v)}
                min={0}
                max={100}
                step={5}
                unit="%"
              />
              <SliderControl
                label="AI Exit Strict"
                value={settings.aiExitStrict}
                onChange={(v) => update("aiExitStrict", v)}
                min={0}
                max={100}
                step={5}
                unit="%"
              />
              <SliderControl
                label="AI Exit Loss Tolerance"
                value={settings.aiExitLossTol}
                onChange={(v) => update("aiExitLossTol", v)}
                min={0}
                max={100}
                step={5}
                unit="%"
              />
              <SliderControl
                label="AI Exit Win Tolerance"
                value={settings.aiExitWinTol}
                onChange={(v) => update("aiExitWinTol", v)}
                min={0}
                max={100}
                step={5}
                unit="%"
              />
              <ToggleControl
                label="Use MIM Exit"
                checked={settings.useMimExit}
                onChange={(v) => update("useMimExit", v)}
              />
            </div>
          </Section>
        )}

        {/* ========== DIMENSIONALITY ========== */}
        <Section
          title="Dimensionality"
          icon={<Layers className="w-4 h-4" />}
          isOpen={sectionsOpen.dimensionality}
          onToggle={() => toggleSection("dimensionality")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Dim Style</label>
              <select
                value={settings.dimStyle}
                onChange={(e) => update("dimStyle", e.target.value as DimStyle)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="recommended">Recommended</option>
                <option value="manual">Manual</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            {settings.dimStyle === "manual" && (
              <SliderControl
                label="Manual Dimensions"
                value={settings.dimManualAmount}
                onChange={(v) => update("dimManualAmount", v)}
                min={2}
                max={100}
                step={1}
              />
            )}

            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Compression Method</label>
              <select
                value={settings.compressionMethod}
                onChange={(e) => update("compressionMethod", e.target.value as CompressionMethod)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="pca">PCA</option>
                <option value="jl">Johnson-Lindenstrauss</option>
                <option value="none">None</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Distance Metric</label>
              <select
                value={settings.distanceMetric}
                onChange={(e) => update("distanceMetric", e.target.value as DistanceMetric)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="euclidean">Euclidean</option>
                <option value="cosine">Cosine</option>
                <option value="manhattan">Manhattan</option>
              </select>
            </div>

            <SliderControl
              label="Dim Weights Bump"
              value={settings.dimWeightsBump}
              onChange={(v) => update("dimWeightsBump", v)}
              min={0}
              max={100}
              step={1}
              unit="%"
            />
          </div>
        </Section>

        {/* ========== FEATURE LEVELS ========== */}
        <Section
          title="Feature Levels"
          icon={<Sliders className="w-4 h-4" />}
          isOpen={sectionsOpen.features}
          onToggle={() => toggleSection("features")}
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-500 mb-2">
              Adjust the importance of each feature family (0-4).
            </p>

            {/* Base Features */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Base Features
              </h4>
              {FEATURE_DEFS.map((f) => (
                <FeatureLevelControl
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  value={settings.featureLevels[f.key] ?? 2}
                  onChange={(v) =>
                    update("featureLevels", { ...settings.featureLevels, [f.key]: v })
                  }
                />
              ))}
            </div>

            {/* Model-Specific Features */}
            {modelFeatures.length > 0 && (
              <div className="space-y-3 pt-3 border-t border-gray-800">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {activeModel} Features
                </h4>
                {modelFeatures.map((f) => (
                  <FeatureLevelControl
                    key={f.key}
                    label={f.label}
                    hint={f.hint}
                    value={settings.featureLevels[f.key] ?? 2}
                    onChange={(v) =>
                      update("featureLevels", { ...settings.featureLevels, [f.key]: v })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ========== FEATURE MODES ========== */}
        <Section
          title="Feature Modes"
          icon={<Sliders className="w-4 h-4" />}
          isOpen={sectionsOpen.featureModes}
          onToggle={() => toggleSection("featureModes")}
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-2">
              Individual = per-feature, Ensemble = combined.
            </p>
            {FEATURE_DEFS.map((f) => (
              <div key={f.key} className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{f.label}</span>
                <select
                  value={settings.featureModes[f.key] || "ensemble"}
                  onChange={(e) =>
                    update("featureModes", {
                      ...settings.featureModes,
                      [f.key]: e.target.value as FeatureMode,
                    })
                  }
                  className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                >
                  <option value="ensemble">Ensemble</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
            ))}
          </div>
        </Section>

        {/* ========== MODEL STATES ========== */}
        <Section
          title="Model States"
          icon={<Layers className="w-4 h-4" />}
          isOpen={sectionsOpen.models}
          onToggle={() => toggleSection("models")}
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-2">
              0 = Disabled, 1 = Entry Only, 2 = Full
            </p>
            {MODELS.map((model) => (
              <div key={model} className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{model}</span>
                <div className="flex gap-1">
                  {[0, 1, 2].map((state) => (
                    <button
                      key={state}
                      onClick={() =>
                        update("modelStates", {
                          ...settings.modelStates,
                          [model]: state as 0 | 1 | 2,
                        })
                      }
                      className={`w-8 h-6 rounded text-xs font-medium transition-colors ${
                        settings.modelStates[model] === state
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {state}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ========== TIME FILTERS ========== */}
        <Section
          title="Time Filters"
          icon={<Clock className="w-4 h-4" />}
          isOpen={sectionsOpen.timeFilters}
          onToggle={() => toggleSection("timeFilters")}
        >
          <div className="space-y-4">
            {/* Sessions */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Sessions
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {(["Tokyo", "London", "New York", "Sydney"] as const).map((session) => (
                  <label key={session} className="flex items-center gap-2 p-2 bg-gray-800 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.enabledSessions[session]}
                      onChange={(e) =>
                        update("enabledSessions", {
                          ...settings.enabledSessions,
                          [session]: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-600"
                    />
                    <span className="text-sm text-gray-300">{session}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Days of Week */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Days of Week
              </h4>
              <div className="flex gap-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                  <button
                    key={day}
                    onClick={() =>
                      update("enabledDows", {
                        ...settings.enabledDows,
                        [String(i)]: !settings.enabledDows[String(i)],
                      })
                    }
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      settings.enabledDows[String(i)]
                        ? "bg-purple-600 text-white"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Months */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Months
              </h4>
              <div className="grid grid-cols-6 gap-1">
                {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
                  (month, i) => (
                    <button
                      key={month}
                      onClick={() =>
                        update("enabledMonths", {
                          ...settings.enabledMonths,
                          [String(i)]: !settings.enabledMonths[String(i)],
                        })
                      }
                      className={`py-1 rounded text-xs font-medium transition-colors ${
                        settings.enabledMonths[String(i)]
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {month}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Hours */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Hours (UTC)
              </h4>
              <div className="grid grid-cols-8 gap-1">
                {Array.from({ length: 24 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      update("enabledHours", {
                        ...settings.enabledHours,
                        [String(i)]: !settings.enabledHours[String(i)],
                      })
                    }
                    className={`py-1 rounded text-xs font-medium transition-colors ${
                      settings.enabledHours[String(i)]
                        ? "bg-purple-600 text-white"
                        : "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ========== AI LIBRARIES ========== */}
        {settings.aiMethod !== "off" && (
          <Section
            title="AI Libraries"
            icon={<Database className="w-4 h-4" />}
            isOpen={sectionsOpen.libraries}
            onToggle={() => toggleSection("libraries")}
          >
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-2">
                Select which libraries to use for AI signals.
              </p>
              {LIBRARY_IDS.map((libId) => {
                const libDef = AI_LIBRARY_DEFS.find((l) => l.id === libId);
                return (
                  <label
                    key={libId}
                    className="flex items-center gap-2 p-2 hover:bg-gray-800 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={settings.aiLibrariesActive.includes(libId)}
                      onChange={() => toggleLibrary(libId)}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-300">{libDef?.name || libId}</span>
                  </label>
                );
              })}
            </div>
          </Section>
        )}

        {/* ========== LIBRARY SETTINGS ========== */}
        {settings.aiMethod !== "off" && settings.aiLibrariesActive.length > 0 && (
          <Section
            title="Library Settings"
            icon={<Sliders className="w-4 h-4" />}
            isOpen={sectionsOpen.librarySettings}
            onToggle={() => toggleSection("librarySettings")}
          >
            <div className="space-y-4">
              {/* Bulk Operations */}
              <div className="p-3 bg-gray-800 rounded-lg space-y-3">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Bulk Operations
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Weight</label>
                    <input
                      type="number"
                      value={settings.aiBulkWeight}
                      onChange={(e) => update("aiBulkWeight", Number(e.target.value))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Stride</label>
                    <input
                      type="number"
                      value={settings.aiBulkStride}
                      onChange={(e) => update("aiBulkStride", Number(e.target.value))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Max Samples</label>
                    <input
                      type="number"
                      value={settings.aiBulkMaxSamples}
                      onChange={(e) => update("aiBulkMaxSamples", Number(e.target.value))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Scope</label>
                    <select
                      value={settings.aiBulkScope}
                      onChange={(e) => update("aiBulkScope", e.target.value as "active" | "all" | "none")}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                    >
                      <option value="active">Active</option>
                      <option value="all">All</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const scope = settings.aiBulkScope === "all" ? LIBRARY_IDS : settings.aiLibrariesActive;
                    const newSettings = { ...settings.aiLibrariesSettings };
                    scope.forEach((libId) => {
                      newSettings[libId] = {
                        ...newSettings[libId],
                        weight: settings.aiBulkWeight,
                        stride: settings.aiBulkStride,
                        maxSamples: settings.aiBulkMaxSamples,
                      };
                    });
                    update("aiLibrariesSettings", newSettings);
                  }}
                  className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-sm text-white"
                >
                  Apply Bulk Settings
                </button>
              </div>

              {/* Per-Library Settings */}
              {settings.aiLibrariesActive.map((libId) => {
                const libSettings = settings.aiLibrariesSettings[libId] || { weight: 100, maxSamples: 10000, stride: 0 };
                return (
                  <div key={libId} className="p-3 bg-gray-800 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-300 mb-2">{libId}</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Weight</label>
                        <input
                          type="number"
                          value={libSettings.weight}
                          onChange={(e) => updateLibrarySetting(libId, "weight", Number(e.target.value))}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Stride</label>
                        <input
                          type="number"
                          value={libSettings.stride}
                          onChange={(e) => updateLibrarySetting(libId, "stride", Number(e.target.value))}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Max</label>
                        <input
                          type="number"
                          value={libSettings.maxSamples}
                          onChange={(e) => updateLibrarySetting(libId, "maxSamples", Number(e.target.value))}
                          className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ========== VALIDATION ========== */}
        <Section
          title="Validation & Realism"
          icon={<Shield className="w-4 h-4" />}
          isOpen={sectionsOpen.validation}
          onToggle={() => toggleSection("validation")}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-gray-400">Validation Mode</label>
              <select
                value={settings.validationMode}
                onChange={(e) => update("validationMode", e.target.value as ValidationMode)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="none">None</option>
                <option value="split">Train/Test Split</option>
                <option value="walkforward">Walk Forward</option>
                <option value="kfold">K-Fold Cross Validation</option>
              </select>
            </div>

            <ToggleControl
              label="Anti-Cheat Mode"
              checked={settings.antiCheatEnabled}
              onChange={(v) => update("antiCheatEnabled", v)}
              hint="Prevents look-ahead bias"
            />

            <ToggleControl
              label="Prevent AI Leak"
              checked={settings.preventAiLeak}
              onChange={(v) => update("preventAiLeak", v)}
              hint="Isolates AI from future data"
            />

            <ToggleControl
              label="Remap Opposite Outcomes"
              checked={settings.remapOppositeOutcomes}
              onChange={(v) => update("remapOppositeOutcomes", v)}
            />

            <ToggleControl
              label="Static Libraries Clusters"
              checked={settings.staticLibrariesClusters}
              onChange={(v) => update("staticLibrariesClusters", v)}
            />

            <SliderControl
              label="Realism Level"
              value={settings.realismLevel}
              onChange={(v) => update("realismLevel", v)}
              min={0}
              max={5}
              step={1}
              hint="Higher = more realistic simulation"
            />

            <SliderControl
              label="Volatility Percentile"
              value={settings.volatilityPercentile}
              onChange={(v) => update("volatilityPercentile", v)}
              min={0}
              max={100}
              step={1}
              unit="%"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, icon, isOpen, onToggle, children }: SectionProps) {
  return (
    <div className="border-b border-gray-800">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-gray-300">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
}

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  hint,
}: SliderControlProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-gray-400">{label}</span>
          {hint && <p className="text-xs text-gray-600">{hint}</p>}
        </div>
        <span className="text-sm font-medium text-gray-200">
          {value}
          {unit && <span className="text-gray-500 ml-1">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>
  );
}

interface ToggleControlProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}

function ToggleControl({ label, checked, onChange, hint }: ToggleControlProps) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <div>
        <span className="text-sm text-gray-300">{label}</span>
        {hint && <p className="text-xs text-gray-600">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-purple-600" : "bg-gray-700"
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </label>
  );
}

interface FeatureLevelControlProps {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}

function FeatureLevelControl({
  label,
  hint,
  value,
  onChange,
}: FeatureLevelControlProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-gray-300">{label}</span>
          <p className="text-xs text-gray-500">{hint}</p>
        </div>
        <span className="text-xs font-medium text-purple-400">
          {FEATURE_LEVEL_LABEL[value] || `Level ${value}`}
        </span>
      </div>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((level) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            className={`flex-1 h-2 rounded transition-colors ${
              level <= value
                ? "bg-purple-500"
                : "bg-gray-700 hover:bg-gray-600"
            }`}
            title={FEATURE_LEVEL_LABEL[level]}
          />
        ))}
      </div>
    </div>
  );
}

export default SettingsSidebar;
