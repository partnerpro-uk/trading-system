"use client";

import { useCallback } from "react";
import {
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  Target,
  Layers,
} from "lucide-react";
import type { SimpleSettings, ModelKey } from "../../lib/analysis/simple-settings-types";

interface SimpleSettingsPanelProps {
  settings: SimpleSettings;
  onChange: (settings: SimpleSettings) => void;
  onRun: () => void;
  isComputing: boolean;
  onCancel?: () => void;
}

const MODEL_LABELS: Record<ModelKey, string> = {
  momentum: "Momentum",
  meanReversion: "Mean Rev",
  seasons: "Seasons",
  timeOfDay: "Time of Day",
  fibonacci: "Fibonacci",
  supportResistance: "S/R",
};

export function SimpleSettingsPanel({
  settings,
  onChange,
  onRun,
  isComputing,
  onCancel,
}: SimpleSettingsPanelProps) {
  const update = useCallback(
    <K extends keyof SimpleSettings>(key: K, value: SimpleSettings[K]) => {
      onChange({ ...settings, [key]: value });
    },
    [settings, onChange]
  );

  const toggleModel = useCallback(
    (modelKey: ModelKey) => {
      update("models", {
        ...settings.models,
        [modelKey]: !settings.models[modelKey],
      });
    },
    [settings.models, update]
  );

  const enabledCount = Object.values(settings.models).filter(Boolean).length;

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 p-4 space-y-5 h-full overflow-y-auto">
      {/* Run Button */}
      {isComputing ? (
        <button
          onClick={onCancel}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-lg text-white font-medium transition-colors"
        >
          <Loader2 className="w-5 h-5 animate-spin" />
          Cancel
        </button>
      ) : (
        <button
          onClick={onRun}
          disabled={enabledCount === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
        >
          <Play className="w-5 h-5" />
          Run Analysis
        </button>
      )}

      {/* Trade Setup */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <Target className="w-3 h-3" />
          Trade Setup
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">TP (pips)</label>
            <input
              type="number"
              value={settings.tpPips}
              onChange={(e) => update("tpPips", Math.max(5, Number(e.target.value)))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-purple-500"
              min={5}
              max={500}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">SL (pips)</label>
            <input
              type="number"
              value={settings.slPips}
              onChange={(e) => update("slPips", Math.max(5, Number(e.target.value)))}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-purple-500"
              min={5}
              max={500}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Window (bars)</label>
          <input
            type="number"
            value={settings.chunkBars}
            onChange={(e) => update("chunkBars", Math.max(4, Math.min(64, Number(e.target.value))))}
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            min={4}
            max={64}
          />
        </div>
      </div>

      {/* Models */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-3 h-3" />
          Models ({enabledCount})
        </h3>

        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(MODEL_LABELS) as ModelKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggleModel(key)}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                settings.models[key]
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
              }`}
            >
              {MODEL_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Direction */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Direction
        </h3>

        <div className="flex gap-1">
          {(["long", "short", "both"] as const).map((dir) => (
            <button
              key={dir}
              onClick={() => update("direction", dir)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                settings.direction === dir
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:bg-gray-700"
              }`}
            >
              {dir === "long" && <TrendingUp className="w-3 h-3" />}
              {dir === "short" && <TrendingDown className="w-3 h-3" />}
              {dir === "both" && <Minus className="w-3 h-3" />}
              {dir.charAt(0).toUpperCase() + dir.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* AI Toggle */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <Brain className="w-3 h-3" />
          AI Filter
        </h3>

        <button
          onClick={() => update("useAI", !settings.useAI)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
            settings.useAI
              ? "bg-purple-900/50 border border-purple-700"
              : "bg-gray-800 border border-gray-700"
          }`}
        >
          <span className={`text-sm ${settings.useAI ? "text-purple-300" : "text-gray-400"}`}>
            {settings.useAI ? "KNN Enabled" : "Disabled"}
          </span>
          <div
            className={`w-10 h-5 rounded-full transition-colors ${
              settings.useAI ? "bg-purple-600" : "bg-gray-700"
            }`}
          >
            <div
              className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${
                settings.useAI ? "translate-x-5" : ""
              }`}
            />
          </div>
        </button>
      </div>

      {/* Quick Info */}
      <div className="pt-3 border-t border-gray-800 text-xs text-gray-600">
        <p>TP: ${settings.tpPips * 100} | SL: ${settings.slPips * 100}</p>
        <p>R:R = {(settings.tpPips / settings.slPips).toFixed(2)}</p>
      </div>
    </div>
  );
}
