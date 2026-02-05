"use client";

import { useState, useRef, useEffect } from "react";
import { Check } from "lucide-react";
import { COLOR_PRESETS, getContrastingTextColor } from "@/lib/drawings/colors";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  showOpacity?: boolean;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  className?: string;
}

/**
 * Compact color picker with 3x3 preset grid
 * TradingView-style design for drawing tools
 */
export function ColorPicker({
  value,
  onChange,
  showOpacity = false,
  opacity = 1,
  onOpacityChange,
  className = "",
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Check if dropdown should open upward
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // Open upward if less than 80px below
      setOpenUpward(spaceBelow < 80);
    }
  }, [isOpen]);

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

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Color button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="w-6 h-6 rounded border border-gray-600 hover:border-gray-400 transition-colors"
        style={{ backgroundColor: value }}
        title="Change color"
      />

      {/* Dropdown - horizontal row */}
      {isOpen && (
        <div
          className={`absolute right-0 p-1.5 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-[100] ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {/* Horizontal color row */}
          <div className="flex gap-1">
            {COLOR_PRESETS.map((preset) => {
              const isSelected = preset.value.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={preset.value}
                  onClick={() => {
                    onChange(preset.value);
                    if (!showOpacity) setIsOpen(false);
                  }}
                  className={`w-6 h-6 rounded transition-all flex items-center justify-center ${
                    isSelected
                      ? "ring-2 ring-white ring-offset-1 ring-offset-gray-900"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                >
                  {isSelected && (
                    <Check
                      className="w-3 h-3"
                      style={{ color: getContrastingTextColor(preset.value) }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Opacity slider */}
          {showOpacity && onOpacityChange && (
            <>
              <div className="h-px bg-gray-700 my-1.5" />
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={opacity * 100}
                  onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
                  className="flex-1 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3
                    [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-white
                    [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <span className="text-xs text-gray-400 w-8 text-right">
                  {Math.round(opacity * 100)}%
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline color row for settings panels
 */
export function ColorRow({
  label,
  value,
  onChange,
  showOpacity = false,
  opacity = 1,
  onOpacityChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  showOpacity?: boolean;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <ColorPicker
        value={value}
        onChange={onChange}
        showOpacity={showOpacity}
        opacity={opacity}
        onOpacityChange={onOpacityChange}
      />
    </div>
  );
}

/**
 * Rectangle color picker with border + fill options
 * Shows border color button, dropdown has both border and fill pickers
 */
interface RectangleColorPickerProps {
  borderColor: string;
  fillColor: string;
  fillOpacity: number;
  onBorderColorChange: (color: string) => void;
  onFillColorChange: (color: string) => void;
  onFillOpacityChange: (opacity: number) => void;
  className?: string;
}

export function RectangleColorPicker({
  borderColor,
  fillColor,
  fillOpacity,
  onBorderColorChange,
  onFillColorChange,
  onFillOpacityChange,
  className = "",
}: RectangleColorPickerProps) {
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

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Color button - shows border color with fill color inner square */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-6 h-6 rounded border-2 hover:border-gray-400 transition-colors flex items-center justify-center"
        style={{ borderColor: borderColor }}
        title="Change colors"
      >
        <div
          className="w-3 h-3 rounded-sm"
          style={{ backgroundColor: fillColor, opacity: fillOpacity }}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 min-w-[140px]">
          {/* Border color section */}
          <div className="mb-3">
            <span className="text-xs text-gray-400 mb-1.5 block">Border</span>
            <div className="grid grid-cols-3 gap-1">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = preset.value.toLowerCase() === borderColor.toLowerCase();
                return (
                  <button
                    key={preset.value}
                    onClick={() => onBorderColorChange(preset.value)}
                    className={`w-7 h-7 rounded transition-all flex items-center justify-center ${
                      isSelected
                        ? "ring-2 ring-white ring-offset-1 ring-offset-gray-900"
                        : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: preset.value }}
                    title={preset.name}
                  >
                    {isSelected && (
                      <Check
                        className="w-4 h-4"
                        style={{ color: getContrastingTextColor(preset.value) }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-gray-700 my-2" />

          {/* Fill color section */}
          <div>
            <span className="text-xs text-gray-400 mb-1.5 block">Fill</span>
            <div className="grid grid-cols-3 gap-1 mb-2">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = preset.value.toLowerCase() === fillColor.toLowerCase();
                return (
                  <button
                    key={preset.value}
                    onClick={() => onFillColorChange(preset.value)}
                    className={`w-7 h-7 rounded transition-all flex items-center justify-center ${
                      isSelected
                        ? "ring-2 ring-white ring-offset-1 ring-offset-gray-900"
                        : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: preset.value, opacity: fillOpacity }}
                    title={preset.name}
                  >
                    {isSelected && (
                      <Check
                        className="w-4 h-4"
                        style={{ color: getContrastingTextColor(preset.value) }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Fill opacity slider */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-500 w-12">Opacity</span>
              <input
                type="range"
                min="0"
                max="100"
                value={fillOpacity * 100}
                onChange={(e) => onFillOpacityChange(parseInt(e.target.value) / 100)}
                className="flex-1 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-white
                  [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <span className="text-xs text-gray-500 w-8 text-right">
                {Math.round(fillOpacity * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
