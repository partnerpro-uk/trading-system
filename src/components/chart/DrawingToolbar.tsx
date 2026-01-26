"use client";

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
} from "lucide-react";
import { DrawingType } from "@/lib/drawings/types";

interface DrawingToolbarProps {
  activeDrawingTool: DrawingType | null;
  onToolSelect: (tool: DrawingType | null) => void;
  onClearAll: () => void;
  drawingCount: number;
}

const DRAWING_TOOLS: Array<{
  id: DrawingType | null;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  group?: "select" | "lines" | "shapes" | "analysis";
}> = [
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

export function DrawingToolbar({
  activeDrawingTool,
  onToolSelect,
  onClearAll,
  drawingCount,
}: DrawingToolbarProps) {
  // Group tools
  const selectTool = DRAWING_TOOLS.filter((t) => t.group === "select");
  const lineTools = DRAWING_TOOLS.filter((t) => t.group === "lines");
  const shapeTools = DRAWING_TOOLS.filter((t) => t.group === "shapes");
  const analysisTools = DRAWING_TOOLS.filter((t) => t.group === "analysis");

  const ToolButton = ({
    tool,
  }: {
    tool: (typeof DRAWING_TOOLS)[0];
  }) => (
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
    }
  };

  return { handleKeyDown };
}
