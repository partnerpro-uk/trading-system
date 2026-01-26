"use client";

import { useState, useRef, useEffect } from "react";
import { Trash2, Type, GripVertical, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from "lucide-react";
import { ColorPicker, RectangleColorPicker } from "./ColorPicker";
import { LineStyleSelector } from "./LineStyleSelector";
import {
  Drawing,
  HorizontalLineDrawing,
  isFibonacciDrawing,
  isTrendlineDrawing,
  isHorizontalLineDrawing,
  isRectangleDrawing,
  isCircleDrawing,
} from "@/lib/drawings/types";
import { hexToRgb } from "@/lib/drawings/colors";

/**
 * Parse rgba string to extract color and opacity
 */
function parseRgba(rgba: string): { color: string; opacity: number } {
  // Try to parse rgba(r, g, b, a)
  const rgbaMatch = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    return { color: hex.toUpperCase(), opacity: a };
  }
  // Assume it's a hex color
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

interface ContextualToolbarProps {
  drawing: Drawing;
  position: { x: number; y: number };
  onUpdate: (updates: Partial<Drawing>) => void;
  onDelete: () => void;
  containerBounds?: DOMRect;
}

/**
 * Floating toolbar that appears when a drawing is selected
 * TradingView-style contextual editing
 */
export function ContextualToolbar({
  drawing,
  position,
  onUpdate,
  onDelete,
  containerBounds,
}: ContextualToolbarProps) {
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [labelValue, setLabelValue] = useState(drawing.label || "");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [customPosition, setCustomPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Focus input when shown
  useEffect(() => {
    if (showLabelInput && labelInputRef.current) {
      labelInputRef.current.focus();
      labelInputRef.current.select();
    }
  }, [showLabelInput]);

  // Update label value when drawing changes
  useEffect(() => {
    setLabelValue(drawing.label || "");
  }, [drawing.label]);

  // Handle drag
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = toolbarRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const newX = e.clientX - dragOffset.x - (containerBounds?.left || 0);
      const newY = e.clientY - dragOffset.y - (containerBounds?.top || 0);
      setCustomPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(false);
    };

    // Use capture phase to ensure we get the event
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [isDragging, dragOffset, containerBounds]);

  // Get color from drawing based on type
  const getDrawingColor = (): string => {
    if (isFibonacciDrawing(drawing)) return drawing.lineColor;
    if (isTrendlineDrawing(drawing)) return drawing.color;
    if (isHorizontalLineDrawing(drawing)) return drawing.color;
    if (isRectangleDrawing(drawing)) return drawing.borderColor;
    if (isCircleDrawing(drawing)) return drawing.borderColor;
    return "#787B86";
  };

  // Get line width from drawing
  const getLineWidth = (): 1 | 2 | 3 | 4 => {
    if (isTrendlineDrawing(drawing)) return (drawing.lineWidth || 2) as 1 | 2 | 3 | 4;
    if (isHorizontalLineDrawing(drawing)) return (drawing.lineWidth || 2) as 1 | 2 | 3 | 4;
    if (isRectangleDrawing(drawing)) return (drawing.borderWidth || 2) as 1 | 2 | 3 | 4;
    return 2;
  };

  // Get line style from drawing
  const getLineStyle = (): "solid" | "dashed" | "dotted" => {
    if (isTrendlineDrawing(drawing)) return drawing.lineStyle || "solid";
    if (isHorizontalLineDrawing(drawing)) return drawing.lineStyle || "solid";
    return "solid";
  };

  // Update color based on drawing type
  const handleColorChange = (color: string) => {
    if (isFibonacciDrawing(drawing)) {
      onUpdate({ lineColor: color } as Partial<Drawing>);
    } else if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing)) {
      onUpdate({ color } as Partial<Drawing>);
    } else if (isRectangleDrawing(drawing)) {
      onUpdate({ borderColor: color } as Partial<Drawing>);
    }
  };

  // Update line width based on drawing type
  const handleLineWidthChange = (width: 1 | 2 | 3 | 4) => {
    if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing)) {
      onUpdate({ lineWidth: width } as Partial<Drawing>);
    } else if (isRectangleDrawing(drawing)) {
      onUpdate({ borderWidth: width } as Partial<Drawing>);
    }
  };

  // Update line style
  const handleLineStyleChange = (style: "solid" | "dashed" | "dotted") => {
    if (isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing)) {
      onUpdate({ lineStyle: style } as Partial<Drawing>);
    }
  };

  // Save label
  const handleLabelSave = () => {
    onUpdate({ label: labelValue || undefined } as Partial<Drawing>);
    setShowLabelInput(false);
  };

  // Calculate position (use custom if dragged, otherwise auto-position)
  const finalPosition = customPosition || {
    x: Math.max(10, Math.min(position.x - 80, (containerBounds?.width || 400) - 200)),
    y: Math.max(10, position.y - 50),
  };

  // Check if drawing supports line styles
  const supportsLineStyle = isTrendlineDrawing(drawing) || isHorizontalLineDrawing(drawing);
  const supportsLineWidth = supportsLineStyle || isRectangleDrawing(drawing);

  // Stop events from bubbling to chart
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      ref={toolbarRef}
      className="absolute z-20 flex items-center gap-1 p-1.5 bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl"
      style={{
        left: finalPosition.x,
        top: finalPosition.y,
        cursor: isDragging ? "grabbing" : "default",
      }}
      onMouseDown={stopPropagation}
      onMouseMove={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
    >
      {/* Drag handle */}
      <div
        className="cursor-grab active:cursor-grabbing p-1 text-gray-500 hover:text-gray-300"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="w-3 h-3" />
      </div>

      <div className="w-px h-5 bg-gray-700" />

      {/* Color picker - use RectangleColorPicker for rectangles and circles */}
      {(isRectangleDrawing(drawing) || isCircleDrawing(drawing)) ? (
        <RectangleColorPicker
          borderColor={(drawing as { borderColor: string }).borderColor}
          fillColor={parseRgba((drawing as { fillColor: string }).fillColor).color}
          fillOpacity={parseRgba((drawing as { fillColor: string }).fillColor).opacity}
          onBorderColorChange={(color) => onUpdate({ borderColor: color } as Partial<Drawing>)}
          onFillColorChange={(color) => {
            const currentOpacity = parseRgba((drawing as { fillColor: string }).fillColor).opacity;
            onUpdate({ fillColor: toRgba(color, currentOpacity) } as Partial<Drawing>);
          }}
          onFillOpacityChange={(opacity) => {
            const currentColor = parseRgba((drawing as { fillColor: string }).fillColor).color;
            onUpdate({ fillColor: toRgba(currentColor, opacity) } as Partial<Drawing>);
          }}
        />
      ) : (
        <ColorPicker
          value={getDrawingColor()}
          onChange={handleColorChange}
        />
      )}

      {/* Line style selector */}
      {supportsLineWidth && (
        <LineStyleSelector
          lineWidth={getLineWidth()}
          lineStyle={getLineStyle()}
          onLineWidthChange={handleLineWidthChange}
          onLineStyleChange={supportsLineStyle ? handleLineStyleChange : () => {}}
        />
      )}

      <div className="w-px h-5 bg-gray-700" />

      {/* Label button/input */}
      {showLabelInput ? (
        <input
          ref={labelInputRef}
          type="text"
          value={labelValue}
          onChange={(e) => setLabelValue(e.target.value)}
          onBlur={handleLabelSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLabelSave();
            if (e.key === "Escape") {
              setLabelValue(drawing.label || "");
              setShowLabelInput(false);
            }
          }}
          placeholder="Label..."
          className="w-24 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      ) : (
        <button
          onClick={() => setShowLabelInput(true)}
          className={`p-1.5 rounded transition-colors ${
            drawing.label
              ? "text-blue-400 bg-blue-500/20"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
          title={drawing.label || "Add label"}
        >
          <Type className="w-4 h-4" />
        </button>
      )}

      {/* Label color picker - only show when label exists */}
      {drawing.label && (
        <ColorPicker
          value={drawing.labelColor || getDrawingColor()}
          onChange={(color) => onUpdate({ labelColor: color } as Partial<Drawing>)}
        />
      )}

      {/* Label position selector - only for horizontal lines with labels */}
      {drawing.label && isHorizontalLineDrawing(drawing) && (
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => onUpdate({ labelPosition: "above" } as Partial<Drawing>)}
            className={`p-1 rounded transition-colors ${
              (drawing as HorizontalLineDrawing).labelPosition === "above"
                ? "text-blue-400 bg-blue-500/20"
                : "text-gray-400 hover:text-white hover:bg-gray-700"
            }`}
            title="Label above line"
          >
            <AlignVerticalJustifyStart className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onUpdate({ labelPosition: "middle" } as Partial<Drawing>)}
            className={`p-1 rounded transition-colors ${
              !((drawing as HorizontalLineDrawing).labelPosition) || (drawing as HorizontalLineDrawing).labelPosition === "middle"
                ? "text-blue-400 bg-blue-500/20"
                : "text-gray-400 hover:text-white hover:bg-gray-700"
            }`}
            title="Label on line (breaks line)"
          >
            <AlignVerticalJustifyCenter className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onUpdate({ labelPosition: "below" } as Partial<Drawing>)}
            className={`p-1 rounded transition-colors ${
              (drawing as HorizontalLineDrawing).labelPosition === "below"
                ? "text-blue-400 bg-blue-500/20"
                : "text-gray-400 hover:text-white hover:bg-gray-700"
            }`}
            title="Label below line"
          >
            <AlignVerticalJustifyEnd className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="w-px h-5 bg-gray-700" />

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/20 transition-colors"
        title="Delete (Del)"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
