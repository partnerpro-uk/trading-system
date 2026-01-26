"use client";

import { useState, useEffect, useRef } from "react";
import { X, Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { ColorPicker, RectangleColorPicker } from "./ColorPicker";
import { LineStyleSelector } from "./LineStyleSelector";
import {
  Drawing,
  DrawingAnchor,
  FibonacciDrawing,
  PositionDrawing,
  isFibonacciDrawing,
  isTrendlineDrawing,
  isHorizontalLineDrawing,
  isHorizontalRayDrawing,
  isRectangleDrawing,
  isCircleDrawing,
  isPositionDrawing,
} from "@/lib/drawings/types";
import { hexToRgb } from "@/lib/drawings/colors";
import { useStrategies } from "@/hooks/useStrategies";
import {
  detectSession,
  formatDuration,
  getSessionColor,
  getSessionInfo,
} from "@/lib/trading/sessions";

type TabId = "style" | "text" | "coordinates" | "visibility" | "tradeInfo";

interface DrawingSettingsProps {
  drawing: Drawing;
  onUpdate: (updates: Partial<Drawing>) => void;
  onClose: () => void;
  positions?: PositionDrawing[]; // Available positions to link to
}

/**
 * Parse rgba string to extract color and opacity
 */
function parseRgba(rgba: string): { color: string; opacity: number } {
  const rgbaMatch = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    return { color: hex.toUpperCase(), opacity: a };
  }
  return { color: rgba, opacity: 1 };
}

/**
 * Convert hex color + opacity to rgba string
 */
function toRgba(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

/**
 * Format timestamp to datetime-local input value
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 16);
}

/**
 * Parse datetime-local input value to timestamp
 */
function parseTimestamp(value: string): number {
  return new Date(value).getTime();
}

/**
 * Get drawing type display name
 */
function getDrawingTypeName(drawing: Drawing): string {
  switch (drawing.type) {
    case "fibonacci": return "Fibonacci Retracement";
    case "trendline": return "Trendline";
    case "ray": return "Ray";
    case "arrow": return "Arrow";
    case "extendedLine": return "Extended Line";
    case "horizontalLine": return "Horizontal Line";
    case "horizontalRay": return "Horizontal Ray";
    case "verticalLine": return "Vertical Line";
    case "rectangle": return "Rectangle";
    case "circle": return "Circle";
    case "parallelChannel": return "Parallel Channel";
    case "longPosition": return "Long Position";
    case "shortPosition": return "Short Position";
    default: return "Drawing";
  }
}

/**
 * Full settings modal for drawing properties
 * Opens on double-click
 */
export function DrawingSettings({ drawing, onUpdate, onClose, positions = [] }: DrawingSettingsProps) {
  // Default to Trade Info tab for position drawings
  const [activeTab, setActiveTab] = useState<TabId>(
    isPositionDrawing(drawing) ? "tradeInfo" : "style"
  );
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to prevent immediate close on open
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // For position drawings, show Trade Info as primary tab
  // For other drawings, show standard tabs
  const tabs: { id: TabId; label: string }[] = isPositionDrawing(drawing)
    ? [
        { id: "tradeInfo", label: "Trade Info" },
        { id: "style", label: "Style" },
        { id: "coordinates", label: "Coordinates" },
        { id: "visibility", label: "Visibility" },
      ]
    : [
        { id: "style", label: "Style" },
        { id: "text", label: "Text" },
        { id: "coordinates", label: "Coordinates" },
        { id: "visibility", label: "Visibility" },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-modal>
      <div
        ref={modalRef}
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-[380px] max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium">{getDrawingTypeName(drawing)}</span>
            {drawing.label && (
              <span className="text-gray-400 text-sm">"{drawing.label}"</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-white border-b-2 border-blue-500"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4 overflow-y-auto max-h-[400px]">
          {activeTab === "tradeInfo" && isPositionDrawing(drawing) && (
            <TradeInfoTab drawing={drawing} onUpdate={onUpdate} />
          )}
          {activeTab === "style" && <StyleTab drawing={drawing} onUpdate={onUpdate} />}
          {activeTab === "text" && <TextTab drawing={drawing} onUpdate={onUpdate} positions={positions} />}
          {activeTab === "coordinates" && <CoordinatesTab drawing={drawing} onUpdate={onUpdate} />}
          {activeTab === "visibility" && <VisibilityTab drawing={drawing} onUpdate={onUpdate} />}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-white text-black rounded font-medium hover:bg-gray-200 transition-colors"
          >
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Style Tab - Colors, line width, line style, opacity
 */
function StyleTab({ drawing, onUpdate }: { drawing: Drawing; onUpdate: (updates: Partial<Drawing>) => void }) {
  // Get current color based on drawing type
  const getColor = (): string => {
    if (isFibonacciDrawing(drawing)) return drawing.lineColor;
    if (isTrendlineDrawing(drawing)) return drawing.color;
    if (isHorizontalLineDrawing(drawing)) return drawing.color;
    if (isHorizontalRayDrawing(drawing)) return drawing.color;
    if (isRectangleDrawing(drawing)) return drawing.borderColor;
    if (isCircleDrawing(drawing)) return drawing.borderColor;
    return "#787B86";
  };

  const handleColorChange = (color: string) => {
    if (isFibonacciDrawing(drawing)) {
      onUpdate({ lineColor: color } as Partial<Drawing>);
    } else if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing) || isHorizontalRayDrawing(drawing)) {
      onUpdate({ color } as Partial<Drawing>);
    } else if (isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
      onUpdate({ borderColor: color } as Partial<Drawing>);
    }
  };

  // Line width
  const getLineWidth = (): number => {
    if (isTrendlineDrawing(drawing)) return drawing.lineWidth || 2;
    if (isHorizontalLineDrawing(drawing)) return drawing.lineWidth || 1;
    if (isHorizontalRayDrawing(drawing)) return drawing.lineWidth || 1;
    if (isRectangleDrawing(drawing)) return drawing.borderWidth || 1;
    if (isCircleDrawing(drawing)) return drawing.borderWidth || 1;
    return 2;
  };

  const handleLineWidthChange = (width: 1 | 2 | 3 | 4) => {
    if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing) || isHorizontalRayDrawing(drawing)) {
      onUpdate({ lineWidth: width } as Partial<Drawing>);
    } else if (isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
      onUpdate({ borderWidth: width } as Partial<Drawing>);
    }
  };

  // Line style
  const getLineStyle = (): "solid" | "dashed" | "dotted" => {
    if (isTrendlineDrawing(drawing)) return drawing.lineStyle || "solid";
    if (isHorizontalLineDrawing(drawing)) return drawing.lineStyle || "solid";
    if (isHorizontalRayDrawing(drawing)) return drawing.lineStyle || "solid";
    return "solid";
  };

  const handleLineStyleChange = (style: "solid" | "dashed" | "dotted") => {
    if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing) || isHorizontalRayDrawing(drawing)) {
      onUpdate({ lineStyle: style } as Partial<Drawing>);
    }
  };

  const supportsLineStyle = isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing) || isHorizontalRayDrawing(drawing);
  const supportsFill = isRectangleDrawing(drawing) || isCircleDrawing(drawing);

  return (
    <div className="space-y-4">
      {/* Color */}
      {supportsFill ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Border Color</span>
            <ColorPicker
              value={(drawing as { borderColor: string }).borderColor}
              onChange={(color) => onUpdate({ borderColor: color } as Partial<Drawing>)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Fill Color</span>
            <ColorPicker
              value={parseRgba((drawing as { fillColor: string }).fillColor).color}
              onChange={(color) => {
                const opacity = parseRgba((drawing as { fillColor: string }).fillColor).opacity;
                onUpdate({ fillColor: toRgba(color, opacity) } as Partial<Drawing>);
              }}
            />
          </div>
          <div>
            <span className="text-sm text-gray-400 block mb-2">Fill Opacity</span>
            <input
              type="range"
              min="0"
              max="100"
              value={parseRgba((drawing as { fillColor: string }).fillColor).opacity * 100}
              onChange={(e) => {
                const color = parseRgba((drawing as { fillColor: string }).fillColor).color;
                onUpdate({ fillColor: toRgba(color, parseInt(e.target.value) / 100) } as Partial<Drawing>);
              }}
              className="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer"
            />
            <div className="text-xs text-gray-500 text-right mt-1">
              {Math.round(parseRgba((drawing as { fillColor: string }).fillColor).opacity * 100)}%
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Color</span>
          <ColorPicker value={getColor()} onChange={handleColorChange} />
        </div>
      )}

      {/* Line Width & Style */}
      {supportsLineStyle && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Line Width</span>
            <div className="flex gap-1">
              {([1, 2, 3, 4] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => handleLineWidthChange(w)}
                  className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                    getLineWidth() === w
                      ? "bg-blue-500 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Line Style</span>
            <div className="flex gap-1">
              {(["solid", "dashed", "dotted"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => handleLineStyleChange(style)}
                  className={`px-3 py-1.5 rounded text-xs transition-colors ${
                    getLineStyle() === style
                      ? "bg-blue-500 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Fibonacci-specific settings */}
      {isFibonacciDrawing(drawing) && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Extend Left</span>
            <ToggleSwitch
              checked={drawing.extendLeft}
              onChange={(checked) => onUpdate({ extendLeft: checked } as Partial<Drawing>)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Extend Right</span>
            <ToggleSwitch
              checked={drawing.extendRight}
              onChange={(checked) => onUpdate({ extendRight: checked } as Partial<Drawing>)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Show Labels</span>
            <ToggleSwitch
              checked={drawing.showLabels}
              onChange={(checked) => onUpdate({ showLabels: checked } as Partial<Drawing>)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Show Prices</span>
            <ToggleSwitch
              checked={drawing.showPrices}
              onChange={(checked) => onUpdate({ showPrices: checked } as Partial<Drawing>)}
            />
          </div>
        </>
      )}

      {/* Position-specific settings (TP/SL colors) */}
      {isPositionDrawing(drawing) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-green-400">Take Profit Color</span>
            <ColorPicker
              value={(drawing as PositionDrawing).tpColor || "#26A69A"}
              onChange={(color) => onUpdate({ tpColor: color } as Partial<Drawing>)}
            />
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Line color determines zone fill
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-red-400">Stop Loss Color</span>
            <ColorPicker
              value={(drawing as PositionDrawing).slColor || "#EF5350"}
              onChange={(color) => onUpdate({ slColor: color } as Partial<Drawing>)}
            />
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Line color determines zone fill
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Trade Info Tab - Position-specific trade data
 * Shows outcome, duration, session, strategy, and notes
 */
function TradeInfoTab({ drawing, onUpdate }: { drawing: PositionDrawing; onUpdate: (updates: Partial<Drawing>) => void }) {
  const { strategies, isLoading: strategiesLoading } = useStrategies();
  const [notes, setNotes] = useState(drawing.notes || "");
  const [tagsInput, setTagsInput] = useState((drawing.tags || []).join(", "));

  // Determine pip multiplier based on price (forex = 10000, JPY pairs = 100)
  const pipMultiplier = drawing.entry.price < 10 ? 10000 : drawing.entry.price < 1000 ? 100 : 1;
  const pipDecimals = pipMultiplier === 10000 ? 1 : pipMultiplier === 100 ? 1 : 0;
  const isLong = drawing.type === "longPosition";

  // Calculate metrics
  const calculatePnlPips = (): number | null => {
    if (!drawing.exitPrice) return null;
    const diff = isLong
      ? drawing.exitPrice - drawing.entry.price
      : drawing.entry.price - drawing.exitPrice;
    return diff * pipMultiplier;
  };

  const calculateRMultiple = (): number | null => {
    if (!drawing.exitPrice) return null;
    const riskPips = Math.abs(drawing.entry.price - drawing.stopLoss) * pipMultiplier;
    const actualPips = isLong
      ? (drawing.exitPrice - drawing.entry.price) * pipMultiplier
      : (drawing.entry.price - drawing.exitPrice) * pipMultiplier;
    return riskPips > 0 ? actualPips / riskPips : 0;
  };

  const detectOutcome = (): "tp" | "sl" | "manual" | "pending" => {
    // Use stored outcome if available
    if (drawing.outcome) return drawing.outcome;
    if (!drawing.exitPrice) return "pending";

    const tpDistance = Math.abs(drawing.exitPrice - drawing.takeProfit);
    const slDistance = Math.abs(drawing.exitPrice - drawing.stopLoss);
    const tolerance = 1 / pipMultiplier; // 1 pip tolerance

    if (tpDistance < tolerance) return "tp";
    if (slDistance < tolerance) return "sl";
    return "manual";
  };

  const pnlPips = calculatePnlPips();
  const rMultiple = calculateRMultiple();
  const outcome = detectOutcome();
  const entrySession = detectSession(drawing.entry.timestamp);
  const exitSession = drawing.exitTimestamp ? detectSession(drawing.exitTimestamp) : null;

  // Outcome badge styles
  const getOutcomeBadge = () => {
    switch (outcome) {
      case "tp":
        return { label: "TP Hit", icon: "✅", color: "bg-green-500/20 text-green-400 border-green-500" };
      case "sl":
        return { label: "SL Hit", icon: "❌", color: "bg-red-500/20 text-red-400 border-red-500" };
      case "manual":
        return { label: "Manual Close", icon: "📝", color: "bg-blue-500/20 text-blue-400 border-blue-500" };
      case "pending":
        return { label: "Pending", icon: "⏳", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500" };
    }
  };

  const outcomeBadge = getOutcomeBadge();

  const handleNotesBlur = () => {
    onUpdate({ notes: notes || undefined } as Partial<Drawing>);
  };

  const handleTagsBlur = () => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    onUpdate({ tags: tags.length > 0 ? tags : undefined } as Partial<Drawing>);
  };

  const handleStrategyChange = (strategyId: string) => {
    onUpdate({ strategyId: strategyId || undefined } as Partial<Drawing>);
  };

  return (
    <div className="space-y-4">
      {/* Outcome Badge */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">Outcome</span>
        <span className={`px-3 py-1 rounded border text-sm font-medium ${outcomeBadge.color}`}>
          {outcomeBadge.icon} {outcomeBadge.label}
        </span>
      </div>

      {/* P&L Section (only if trade is closed) */}
      {pnlPips !== null && (
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">P&L</span>
            <span className={`text-lg font-semibold ${pnlPips >= 0 ? "text-green-400" : "text-red-400"}`}>
              {pnlPips >= 0 ? "+" : ""}{pnlPips.toFixed(pipDecimals)} pips
            </span>
          </div>
          {rMultiple !== null && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">R Multiple</span>
              <span className={`text-sm font-medium ${rMultiple >= 0 ? "text-green-400" : "text-red-400"}`}>
                {rMultiple >= 0 ? "+" : ""}{rMultiple.toFixed(2)}R
              </span>
            </div>
          )}
          {drawing.exitPrice && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Exit Price</span>
              <span className="text-sm text-white">{drawing.exitPrice.toFixed(5)}</span>
            </div>
          )}
        </div>
      )}

      {/* Duration Section */}
      <div className="space-y-2">
        <span className="text-sm text-gray-400 font-medium">Duration</span>
        <div className="grid grid-cols-2 gap-2">
          {drawing.candleCount !== undefined && (
            <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="text-xs text-gray-500">Candles</div>
              <div className="text-sm text-white font-medium">{drawing.candleCount}</div>
            </div>
          )}
          {drawing.exitTimestamp && (
            <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="text-xs text-gray-500">Time</div>
              <div className="text-sm text-white font-medium">
                {formatDuration(drawing.entry.timestamp, drawing.exitTimestamp)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Session Section */}
      <div className="space-y-2">
        <span className="text-sm text-gray-400 font-medium">Session</span>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
            <div className="text-xs text-gray-500">Entry</div>
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getSessionColor(entrySession) }}
              />
              <span className="text-sm text-white font-medium">
                {getSessionInfo(entrySession).abbreviation}
              </span>
            </div>
          </div>
          {exitSession && (
            <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="text-xs text-gray-500">Exit</div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getSessionColor(exitSession) }}
                />
                <span className="text-sm text-white font-medium">
                  {getSessionInfo(exitSession).abbreviation}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-gray-700" />

      {/* Strategy Section */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Strategy</label>
        <select
          value={drawing.strategyId || ""}
          onChange={(e) => handleStrategyChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
          disabled={strategiesLoading}
        >
          <option value="">No Strategy (Manual Trade)</option>
          {strategies.map((strategy) => (
            <option key={strategy.id} value={strategy.id}>
              {strategy.name}
            </option>
          ))}
        </select>
      </div>

      {/* Notes Section */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Trade reasoning, observations, lessons learned..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {/* Tags Section */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Tags (comma separated)</label>
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={handleTagsBlur}
          placeholder="confluence, fib-618, london-open"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {drawing.tags && drawing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {drawing.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Entry/Exit Times (read-only) */}
      <div className="pt-2 border-t border-gray-700 text-xs text-gray-500 space-y-1">
        <p>Entry: {new Date(drawing.entry.timestamp).toLocaleString()}</p>
        {drawing.exitTimestamp && (
          <p>Exit: {new Date(drawing.exitTimestamp).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Text Tab - Label, notes, tags, importance, and link to position
 */
function TextTab({
  drawing,
  onUpdate,
  positions = [],
}: {
  drawing: Drawing;
  onUpdate: (updates: Partial<Drawing>) => void;
  positions?: PositionDrawing[];
}) {
  const [label, setLabel] = useState(drawing.label || "");
  const [notes, setNotes] = useState(drawing.notes || "");
  const [tagsInput, setTagsInput] = useState((drawing.tags || []).join(", "));

  // Update drawing when values change (debounced via blur)
  const handleLabelBlur = () => {
    onUpdate({ label: label || undefined } as Partial<Drawing>);
  };

  const handleNotesBlur = () => {
    onUpdate({ notes: notes || undefined } as Partial<Drawing>);
  };

  const handleTagsBlur = () => {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    onUpdate({ tags: tags.length > 0 ? tags : undefined } as Partial<Drawing>);
  };

  const handleLinkToPosition = (positionId: string) => {
    // tradeId is the field that links drawings to positions
    onUpdate({ tradeId: positionId || undefined } as Partial<Drawing>);
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={handleLabelBlur}
          placeholder="e.g., 2014 High, Support Zone"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Label Color */}
      {drawing.label && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Label Color</span>
          <ColorPicker
            value={drawing.labelColor || "#787B86"}
            onChange={(color) => onUpdate({ labelColor: color } as Partial<Drawing>)}
          />
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Price rejected here 3 times..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Tags (comma separated)</label>
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={handleTagsBlur}
          placeholder="resistance, weekly, strong"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {drawing.tags && drawing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {drawing.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Importance */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Importance</label>
        <div className="flex gap-2">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              onClick={() => onUpdate({ importance: level } as Partial<Drawing>)}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                drawing.importance === level
                  ? level === "high"
                    ? "bg-red-500/20 text-red-400 border border-red-500"
                    : level === "medium"
                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500"
                    : "bg-gray-500/20 text-gray-400 border border-gray-500"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700"
              }`}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Link to Position (only for non-position drawings when positions exist) */}
      {!isPositionDrawing(drawing) && positions.length > 0 && (
        <div className="pt-4 border-t border-gray-700">
          <label className="text-sm text-gray-400 block mb-1.5">Link to Position</label>
          <select
            value={drawing.tradeId || ""}
            onChange={(e) => handleLinkToPosition(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-purple-500"
          >
            <option value="">Not linked</option>
            {positions.map((pos) => {
              const isLong = pos.type === "longPosition";
              const direction = isLong ? "Long" : "Short";
              const price = pos.entry.price.toFixed(5);
              const dateStr = new Date(pos.entry.timestamp).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              });
              return (
                <option key={pos.id} value={pos.id}>
                  {direction} @ {price} ({dateStr})
                </option>
              );
            })}
          </select>
          <p className="text-[10px] text-gray-500 mt-1">
            {drawing.tradeId
              ? "Linked. Appears grouped in sidebar."
              : "Tip: You can also drag drawings onto positions in the sidebar."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Helper to convert rectangle anchors to edges
 */
function toEdges(anchor1: DrawingAnchor, anchor2: DrawingAnchor) {
  return {
    topEdge: Math.max(anchor1.price, anchor2.price),
    bottomEdge: Math.min(anchor1.price, anchor2.price),
    leftEdge: Math.min(anchor1.timestamp, anchor2.timestamp),
    rightEdge: Math.max(anchor1.timestamp, anchor2.timestamp),
  };
}

/**
 * Calculate radius from circle center to edge point
 */
function calculateRadius(center: DrawingAnchor, edge: DrawingAnchor): number {
  // Use price distance as radius (in price units)
  return Math.abs(edge.price - center.price);
}

/**
 * Coordinates Tab - Semantic coordinate representation
 * Each drawing type shows coordinates with meaningful labels
 */
function CoordinatesTab({ drawing, onUpdate }: { drawing: Drawing; onUpdate: (updates: Partial<Drawing>) => void }) {
  // Handle anchor changes for drawings with anchor1/anchor2
  const handleAnchorChange = (key: string, field: "timestamp" | "price", value: number) => {
    if (key === "anchor") {
      const currentAnchor = (drawing as { anchor: DrawingAnchor }).anchor;
      onUpdate({ anchor: { ...currentAnchor, [field]: value } } as Partial<Drawing>);
    } else if (key === "anchor1" || key === "anchor2") {
      const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
      const currentAnchor = key === "anchor1" ? d.anchor1 : d.anchor2;
      onUpdate({ [key]: { ...currentAnchor, [field]: value } } as Partial<Drawing>);
    } else if (key === "entry") {
      const currentEntry = (drawing as { entry: DrawingAnchor }).entry;
      onUpdate({ entry: { ...currentEntry, [field]: value } } as Partial<Drawing>);
    }
  };

  // Handle edge changes for rectangles
  const handleEdgeChange = (edge: "top" | "bottom" | "left" | "right", value: number) => {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    const edges = toEdges(d.anchor1, d.anchor2);

    // Reconstruct anchors from edges
    // anchor1 = top-left, anchor2 = bottom-right
    if (edge === "top") {
      edges.topEdge = value;
    } else if (edge === "bottom") {
      edges.bottomEdge = value;
    } else if (edge === "left") {
      edges.leftEdge = value;
    } else if (edge === "right") {
      edges.rightEdge = value;
    }

    onUpdate({
      anchor1: { timestamp: edges.leftEdge, price: edges.topEdge },
      anchor2: { timestamp: edges.rightEdge, price: edges.bottomEdge },
    } as Partial<Drawing>);
  };

  // Handle circle center/radius changes
  const handleCircleChange = (field: "centerTime" | "centerPrice" | "radius", value: number) => {
    const d = drawing as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
    if (field === "centerTime") {
      onUpdate({ anchor1: { ...d.anchor1, timestamp: value } } as Partial<Drawing>);
    } else if (field === "centerPrice") {
      onUpdate({ anchor1: { ...d.anchor1, price: value } } as Partial<Drawing>);
    } else if (field === "radius") {
      // Keep anchor2 at same timestamp as center, adjust price for radius
      onUpdate({ anchor2: { timestamp: d.anchor1.timestamp, price: d.anchor1.price + value } } as Partial<Drawing>);
    }
  };

  return (
    <div className="space-y-4">
      {/* Horizontal Line - Price Level only */}
      {isHorizontalLineDrawing(drawing) && (
        <div>
          <label className="text-sm text-white font-medium block mb-1.5">Price Level</label>
          <input
            type="number"
            step="0.00001"
            value={drawing.price.toFixed(5)}
            onChange={(e) => onUpdate({ price: parseFloat(e.target.value) } as Partial<Drawing>)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Horizontal Ray - Start Point */}
      {isHorizontalRayDrawing(drawing) && (
        <div className="space-y-2">
          <span className="text-sm text-white font-medium">Start Point</span>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Price</label>
              <input
                type="number"
                step="0.00001"
                value={drawing.anchor.price.toFixed(5)}
                onChange={(e) => handleAnchorChange("anchor", "price", parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Time</label>
              <input
                type="datetime-local"
                value={formatTimestamp(drawing.anchor.timestamp)}
                onChange={(e) => handleAnchorChange("anchor", "timestamp", parseTimestamp(e.target.value))}
                className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Trendline / Ray / Arrow / Extended Line - Start Point, End Point */}
      {isTrendlineDrawing(drawing) && (
        <>
          <div className="space-y-2">
            <span className="text-sm text-white font-medium">
              {drawing.type === "arrow" ? "From" : "Start Point"}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={drawing.anchor1.price.toFixed(5)}
                  onChange={(e) => handleAnchorChange("anchor1", "price", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time</label>
                <input
                  type="datetime-local"
                  value={formatTimestamp(drawing.anchor1.timestamp)}
                  onChange={(e) => handleAnchorChange("anchor1", "timestamp", parseTimestamp(e.target.value))}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm text-white font-medium">
              {drawing.type === "arrow" ? "To" : "End Point"}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={drawing.anchor2.price.toFixed(5)}
                  onChange={(e) => handleAnchorChange("anchor2", "price", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time</label>
                <input
                  type="datetime-local"
                  value={formatTimestamp(drawing.anchor2.timestamp)}
                  onChange={(e) => handleAnchorChange("anchor2", "timestamp", parseTimestamp(e.target.value))}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Rectangle - Edge-based representation */}
      {isRectangleDrawing(drawing) && (() => {
        const edges = toEdges(drawing.anchor1, drawing.anchor2);
        return (
          <>
            <div className="space-y-2">
              <span className="text-sm text-white font-medium">Price Edges</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Top Edge</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={edges.topEdge.toFixed(5)}
                    onChange={(e) => handleEdgeChange("top", parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Bottom Edge</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={edges.bottomEdge.toFixed(5)}
                    onChange={(e) => handleEdgeChange("bottom", parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-sm text-white font-medium">Time Edges</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Left Edge</label>
                  <input
                    type="datetime-local"
                    value={formatTimestamp(edges.leftEdge)}
                    onChange={(e) => handleEdgeChange("left", parseTimestamp(e.target.value))}
                    className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Right Edge</label>
                  <input
                    type="datetime-local"
                    value={formatTimestamp(edges.rightEdge)}
                    onChange={(e) => handleEdgeChange("right", parseTimestamp(e.target.value))}
                    className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Circle - Center + Radius */}
      {isCircleDrawing(drawing) && (() => {
        const radius = calculateRadius(drawing.anchor1, drawing.anchor2);
        return (
          <>
            <div className="space-y-2">
              <span className="text-sm text-white font-medium">Center</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Price</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={drawing.anchor1.price.toFixed(5)}
                    onChange={(e) => handleCircleChange("centerPrice", parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Time</label>
                  <input
                    type="datetime-local"
                    value={formatTimestamp(drawing.anchor1.timestamp)}
                    onChange={(e) => handleCircleChange("centerTime", parseTimestamp(e.target.value))}
                    className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm text-white font-medium block mb-1.5">Radius (price units)</label>
              <input
                type="number"
                step="0.00001"
                value={radius.toFixed(5)}
                onChange={(e) => handleCircleChange("radius", parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </>
        );
      })()}

      {/* Fibonacci - High Point / Low Point */}
      {isFibonacciDrawing(drawing) && (
        <>
          <div className="space-y-2">
            <span className="text-sm text-white font-medium">High Point</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={drawing.anchor1.price.toFixed(5)}
                  onChange={(e) => handleAnchorChange("anchor1", "price", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time</label>
                <input
                  type="datetime-local"
                  value={formatTimestamp(drawing.anchor1.timestamp)}
                  onChange={(e) => handleAnchorChange("anchor1", "timestamp", parseTimestamp(e.target.value))}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm text-white font-medium">Low Point</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Price</label>
                <input
                  type="number"
                  step="0.00001"
                  value={drawing.anchor2.price.toFixed(5)}
                  onChange={(e) => handleAnchorChange("anchor2", "price", parseFloat(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time</label>
                <input
                  type="datetime-local"
                  value={formatTimestamp(drawing.anchor2.timestamp)}
                  onChange={(e) => handleAnchorChange("anchor2", "timestamp", parseTimestamp(e.target.value))}
                  className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Position - Entry, Take Profit, Stop Loss */}
      {isPositionDrawing(drawing) && (() => {
        // Determine pip multiplier based on price (forex = 10000, JPY pairs = 100, indices = 1)
        const pipMultiplier = drawing.entry.price < 10 ? 10000 : drawing.entry.price < 1000 ? 100 : 1;
        const pipDecimals = pipMultiplier === 10000 ? 1 : pipMultiplier === 100 ? 1 : 0;

        // Calculate pips from entry
        const tpPips = (drawing.takeProfit - drawing.entry.price) * pipMultiplier;
        const slPips = (drawing.entry.price - drawing.stopLoss) * pipMultiplier;

        // Handle pip input changes
        const handleTpPipsChange = (pips: number) => {
          const newTp = drawing.entry.price + (pips / pipMultiplier);
          onUpdate({ takeProfit: newTp } as Partial<Drawing>);
        };

        const handleSlPipsChange = (pips: number) => {
          const newSl = drawing.entry.price - (pips / pipMultiplier);
          onUpdate({ stopLoss: newSl } as Partial<Drawing>);
        };

        return (
          <>
            <div className="space-y-2">
              <span className="text-sm text-white font-medium">Entry</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Price</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={drawing.entry.price.toFixed(5)}
                    onChange={(e) => handleAnchorChange("entry", "price", parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Time</label>
                  <input
                    type="datetime-local"
                    value={formatTimestamp(drawing.entry.timestamp)}
                    onChange={(e) => handleAnchorChange("entry", "timestamp", parseTimestamp(e.target.value))}
                    className="w-full px-2 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Take Profit */}
            <div className="space-y-2">
              <span className="text-sm text-green-400 font-medium">Take Profit</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Price</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={drawing.takeProfit.toFixed(5)}
                    onChange={(e) => onUpdate({ takeProfit: parseFloat(e.target.value) } as Partial<Drawing>)}
                    className="w-full px-3 py-2 bg-gray-800 border border-green-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Pips</label>
                  <input
                    type="number"
                    step="0.1"
                    value={tpPips.toFixed(pipDecimals)}
                    onChange={(e) => handleTpPipsChange(parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-green-700 rounded text-green-400 text-sm focus:outline-none focus:border-green-500"
                  />
                </div>
              </div>
            </div>

            {/* Stop Loss */}
            <div className="space-y-2">
              <span className="text-sm text-red-400 font-medium">Stop Loss</span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Price</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={drawing.stopLoss.toFixed(5)}
                    onChange={(e) => onUpdate({ stopLoss: parseFloat(e.target.value) } as Partial<Drawing>)}
                    className="w-full px-3 py-2 bg-gray-800 border border-red-700 rounded text-white text-sm focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Pips</label>
                  <input
                    type="number"
                    step="0.1"
                    value={slPips.toFixed(pipDecimals)}
                    onChange={(e) => handleSlPipsChange(parseFloat(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-800 border border-red-700 rounded text-red-400 text-sm focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>
            </div>

            {/* R:R display */}
            <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Risk : Reward</span>
                <span className="text-white font-medium">
                  1 : {(Math.abs(tpPips) / Math.abs(slPips)).toFixed(2)}
                </span>
              </div>
            </div>
          </>
        );
      })()}

      {/* Created timestamp (read-only info) */}
      <div className="pt-2 border-t border-gray-700">
        <span className="text-xs text-gray-500">
          Created: {new Date(drawing.createdAt).toLocaleString()}
        </span>
        {drawing.updatedAt && (
          <span className="text-xs text-gray-500 block">
            Updated: {new Date(drawing.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Visibility Tab - Lock, visible toggles
 */
function VisibilityTab({ drawing, onUpdate }: { drawing: Drawing; onUpdate: (updates: Partial<Drawing>) => void }) {
  // Note: locked and visible aren't in our current types, but we can add them
  // For now, show placeholder UI that could be wired up later

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400">Lock Drawing</span>
        </div>
        <ToggleSwitch
          checked={false}
          onChange={() => {
            // TODO: Add locked field to Drawing types
            console.log("Lock toggle - not yet implemented");
          }}
        />
      </div>
      <p className="text-xs text-gray-500">
        Prevent accidental modifications to this drawing.
      </p>

      <div className="h-px bg-gray-700 my-4" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-400">Visible</span>
        </div>
        <ToggleSwitch
          checked={true}
          onChange={() => {
            // TODO: Add visible field to Drawing types
            console.log("Visible toggle - not yet implemented");
          }}
        />
      </div>
      <p className="text-xs text-gray-500">
        Toggle visibility of this drawing on the chart.
      </p>

      <div className="h-px bg-gray-700 my-4" />

      {/* Drawing metadata */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>ID: {drawing.id}</p>
        <p>Type: {drawing.type}</p>
        <p>Created by: {drawing.createdBy}</p>
        {drawing.strategyId && <p>Strategy: {drawing.strategyId}</p>}
        {drawing.tradeId && <p>Trade: {drawing.tradeId}</p>}
      </div>
    </div>
  );
}

/**
 * Toggle Switch Component
 */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? "bg-blue-500" : "bg-gray-700"
      }`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
