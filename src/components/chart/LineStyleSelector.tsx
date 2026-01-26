"use client";

import { useState, useRef, useEffect } from "react";

type LineWidth = 1 | 2 | 3 | 4;
type LineStyle = "solid" | "dashed" | "dotted";

interface LineStyleSelectorProps {
  lineWidth: LineWidth;
  lineStyle: LineStyle;
  onLineWidthChange: (width: LineWidth) => void;
  onLineStyleChange: (style: LineStyle) => void;
  className?: string;
}

const LINE_WIDTHS: { value: LineWidth; label: string }[] = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Medium" },
  { value: 3, label: "Thick" },
  { value: 4, label: "Extra Thick" },
];

const LINE_STYLES: { value: LineStyle; label: string; dashArray: string }[] = [
  { value: "solid", label: "Solid", dashArray: "" },
  { value: "dashed", label: "Dashed", dashArray: "6,3" },
  { value: "dotted", label: "Dotted", dashArray: "2,2" },
];

/**
 * Line width and style selector
 * Visual picker with SVG previews
 */
export function LineStyleSelector({
  lineWidth,
  lineStyle,
  onLineWidthChange,
  onLineStyleChange,
  className = "",
}: LineStyleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const currentStyleDash = LINE_STYLES.find((s) => s.value === lineStyle)?.dashArray || "";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Preview button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-6 rounded border border-gray-600 hover:border-gray-400 transition-colors bg-gray-800 flex items-center justify-center"
        title="Line style"
      >
        <svg width="24" height="12" viewBox="0 0 24 12">
          <line
            x1="2"
            y1="6"
            x2="22"
            y2="6"
            stroke="white"
            strokeWidth={lineWidth}
            strokeDasharray={currentStyleDash}
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[140px]">
          {/* Line Width */}
          <div className="mb-2">
            <span className="text-xs text-gray-400 mb-1 block">Width</span>
            <div className="flex gap-1">
              {LINE_WIDTHS.map((w) => (
                <button
                  key={w.value}
                  onClick={() => onLineWidthChange(w.value)}
                  className={`flex-1 h-7 rounded border transition-colors flex items-center justify-center ${
                    lineWidth === w.value
                      ? "border-blue-500 bg-blue-500/20"
                      : "border-gray-600 hover:border-gray-400 bg-gray-800"
                  }`}
                  title={w.label}
                >
                  <svg width="20" height="14" viewBox="0 0 20 14">
                    <line
                      x1="2"
                      y1="7"
                      x2="18"
                      y2="7"
                      stroke="white"
                      strokeWidth={w.value}
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-gray-700 my-2" />

          {/* Line Style */}
          <div>
            <span className="text-xs text-gray-400 mb-1 block">Style</span>
            <div className="flex flex-col gap-1">
              {LINE_STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    onLineStyleChange(s.value);
                    setIsOpen(false);
                  }}
                  className={`h-7 rounded border transition-colors flex items-center px-2 gap-2 ${
                    lineStyle === s.value
                      ? "border-blue-500 bg-blue-500/20"
                      : "border-gray-600 hover:border-gray-400 bg-gray-800"
                  }`}
                  title={s.label}
                >
                  <svg width="40" height="12" viewBox="0 0 40 12">
                    <line
                      x1="2"
                      y1="6"
                      x2="38"
                      y2="6"
                      stroke="white"
                      strokeWidth={2}
                      strokeDasharray={s.dashArray}
                    />
                  </svg>
                  <span className="text-xs text-gray-300">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact line width selector only
 */
export function LineWidthSelector({
  value,
  onChange,
  className = "",
}: {
  value: LineWidth;
  onChange: (width: LineWidth) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {LINE_WIDTHS.map((w) => (
        <button
          key={w.value}
          onClick={() => onChange(w.value)}
          className={`w-6 h-6 rounded border transition-colors flex items-center justify-center ${
            value === w.value
              ? "border-blue-500 bg-blue-500/20"
              : "border-gray-600 hover:border-gray-400 bg-gray-800"
          }`}
          title={w.label}
        >
          <div
            className="bg-white rounded-full"
            style={{ width: w.value + 2, height: w.value + 2 }}
          />
        </button>
      ))}
    </div>
  );
}
