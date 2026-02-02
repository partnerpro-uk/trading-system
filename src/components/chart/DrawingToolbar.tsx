"use client";

import { useState, useRef, useEffect } from "react";
import {
  TrendingUp,
  Minus,
  Square,
  Circle,
  GitBranch,
  MousePointer,
  Trash2,
  MoveHorizontal,
  ArrowUpCircle,
  ArrowDownCircle,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Dot,
} from "lucide-react";
import { DrawingType } from "@/lib/drawings/types";

interface DrawingToolbarProps {
  activeDrawingTool: DrawingType | null;
  onToolSelect: (tool: DrawingType | null) => void;
  onClearAll: () => void;
  drawingCount: number;
}

interface ToolConfig {
  id: DrawingType | null;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  group?: "select" | "lines" | "shapes" | "markers" | "analysis";
}

const DRAWING_TOOLS: ToolConfig[] = [
  {
    id: null,
    icon: <MousePointer className="w-4 h-4" />,
    label: "Select",
    shortcut: "V",
    group: "select",
  },
  {
    id: "trendline",
    icon: <TrendingUp className="w-4 h-4" />,
    label: "Trendline",
    shortcut: "T",
    group: "lines",
  },
  {
    id: "horizontalRay",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="3" cy="8" r="2" fill="currentColor" stroke="none" />
        <line x1="5" y1="8" x2="14" y2="8" />
      </svg>
    ),
    label: "Horizontal Ray",
    shortcut: "R",
    group: "lines",
  },
  {
    id: "horizontalLine",
    icon: <Minus className="w-4 h-4" />,
    label: "Horizontal Line",
    shortcut: "H",
    group: "lines",
  },
  {
    id: "extendedLine",
    icon: <MoveHorizontal className="w-4 h-4" />,
    label: "Extended Line",
    shortcut: "E",
    group: "lines",
  },
  {
    id: "rectangle",
    icon: <Square className="w-4 h-4" />,
    label: "Rectangle",
    shortcut: "S",
    group: "shapes",
  },
  {
    id: "circle",
    icon: <Circle className="w-4 h-4" />,
    label: "Circle",
    shortcut: "C",
    group: "shapes",
  },
  {
    id: "fibonacci",
    icon: <GitBranch className="w-4 h-4" />,
    label: "Fibonacci Retracement",
    shortcut: "F",
    group: "analysis",
  },
  {
    id: "longPosition",
    icon: <ArrowUpCircle className="w-4 h-4 text-green-500" />,
    label: "Long Position",
    shortcut: "L",
    group: "analysis",
  },
  {
    id: "shortPosition",
    icon: <ArrowDownCircle className="w-4 h-4 text-red-500" />,
    label: "Short Position",
    shortcut: "O",
    group: "analysis",
  },
];

const MARKER_TOOLS: ToolConfig[] = [
  {
    id: "markerArrowUp",
    icon: <ArrowUp className="w-4 h-4 text-green-500" />,
    label: "Arrow Up",
    shortcut: "1",
    group: "markers",
  },
  {
    id: "markerArrowDown",
    icon: <ArrowDown className="w-4 h-4 text-red-500" />,
    label: "Arrow Down",
    shortcut: "2",
    group: "markers",
  },
  {
    id: "markerCircle",
    icon: <Dot className="w-5 h-5 text-blue-500" />,
    label: "Circle Marker",
    shortcut: "3",
    group: "markers",
  },
  {
    id: "markerSquare",
    icon: (
      <svg className="w-4 h-4 text-amber-500" viewBox="0 0 16 16" fill="currentColor">
        <rect x="4" y="4" width="8" height="8" />
      </svg>
    ),
    label: "Square Marker",
    shortcut: "4",
    group: "markers",
  },
];

export function DrawingToolbar({
  activeDrawingTool,
  onToolSelect,
  onClearAll,
  drawingCount,
}: DrawingToolbarProps) {
  const [markerDropdownOpen, setMarkerDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMarkerDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Group tools
  const selectTool = DRAWING_TOOLS.filter((t) => t.group === "select");
  const lineTools = DRAWING_TOOLS.filter((t) => t.group === "lines");
  const shapeTools = DRAWING_TOOLS.filter((t) => t.group === "shapes");
  const analysisTools = DRAWING_TOOLS.filter((t) => t.group === "analysis");

  // Check if any marker tool is active
  const isMarkerToolActive = MARKER_TOOLS.some((t) => t.id === activeDrawingTool);

  const ToolButton = ({ tool }: { tool: ToolConfig }) => (
    <button
      onClick={() => onToolSelect(tool.id)}
      className={`group relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
        activeDrawingTool === tool.id
          ? "bg-blue-600 text-white"
          : "text-gray-400 hover:text-white hover:bg-gray-700/50"
      }`}
      title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}`}
    >
      {tool.icon}
      {/* Tooltip on hover */}
      <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-gray-700">
        {tool.label}
        {tool.shortcut && (
          <span className="ml-2 text-gray-400">{tool.shortcut}</span>
        )}
      </div>
    </button>
  );

  const Divider = () => <div className="w-6 h-px bg-gray-700 mx-auto my-1" />;

  // Get currently active marker tool icon, or default to arrow up
  const activeMarkerTool = MARKER_TOOLS.find((t) => t.id === activeDrawingTool);

  return (
    <div className="absolute left-0 top-0 bottom-0 w-11 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-2 z-10">
      {/* Select tool */}
      {selectTool.map((tool) => (
        <ToolButton key={tool.id || "select"} tool={tool} />
      ))}

      <Divider />

      {/* Line tools */}
      {lineTools.map((tool) => (
        <ToolButton key={tool.id || "line"} tool={tool} />
      ))}

      <Divider />

      {/* Shape tools */}
      {shapeTools.map((tool) => (
        <ToolButton key={tool.id || "shape"} tool={tool} />
      ))}

      <Divider />

      {/* Markers dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setMarkerDropdownOpen(!markerDropdownOpen)}
          className={`group relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
            isMarkerToolActive
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700/50"
          }`}
          title="Markers (1-4)"
        >
          {activeMarkerTool ? activeMarkerTool.icon : <ArrowUp className="w-4 h-4" />}
          <ChevronRight className="w-2.5 h-2.5 absolute right-0.5 bottom-0.5 opacity-60" />
          {/* Tooltip */}
          <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-gray-700">
            Markers
            <span className="ml-2 text-gray-400">1-4</span>
          </div>
        </button>

        {/* Dropdown menu */}
        {markerDropdownOpen && (
          <div className="absolute left-full ml-1 top-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
            {MARKER_TOOLS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => {
                  onToolSelect(tool.id);
                  setMarkerDropdownOpen(false);
                }}
                className={`w-full px-3 py-2 flex items-center gap-3 text-sm transition-colors ${
                  activeDrawingTool === tool.id
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`}
              >
                {tool.icon}
                <span className="flex-1 text-left">{tool.label}</span>
                {tool.shortcut && (
                  <span className="text-gray-500 text-xs">{tool.shortcut}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* Analysis tools */}
      {analysisTools.map((tool) => (
        <ToolButton key={tool.id || "analysis"} tool={tool} />
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear all button at bottom */}
      {drawingCount > 0 && (
        <button
          onClick={onClearAll}
          className="group relative w-9 h-9 flex items-center justify-center rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors mb-2"
          title={`Clear all (${drawingCount})`}
        >
          <Trash2 className="w-4 h-4" />
          {/* Count badge */}
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
            {drawingCount > 99 ? "99" : drawingCount}
          </span>
          {/* Tooltip */}
          <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-gray-700">
            Clear all drawings
          </div>
        </button>
      )}
    </div>
  );
}

/**
 * Hook for keyboard shortcuts
 */
export function useDrawingShortcuts(
  onToolSelect: (tool: DrawingType | null) => void
) {
  const handleKeyDown = (event: KeyboardEvent) => {
    // Don't trigger if typing in an input
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case "v":
        onToolSelect(null);
        break;
      case "t":
        onToolSelect("trendline");
        break;
      case "r":
        onToolSelect("horizontalRay");
        break;
      case "h":
        onToolSelect("horizontalLine");
        break;
      case "e":
        onToolSelect("extendedLine");
        break;
      case "f":
        onToolSelect("fibonacci");
        break;
      case "s":
        onToolSelect("rectangle");
        break;
      case "c":
        onToolSelect("circle");
        break;
      case "l":
        onToolSelect("longPosition");
        break;
      case "o":
        onToolSelect("shortPosition");
        break;
      // Marker shortcuts (1-4)
      case "1":
        onToolSelect("markerArrowUp");
        break;
      case "2":
        onToolSelect("markerArrowDown");
        break;
      case "3":
        onToolSelect("markerCircle");
        break;
      case "4":
        onToolSelect("markerSquare");
        break;
    }
  };

  return { handleKeyDown };
}
