"use client";

import React, { useState, useCallback } from "react";
import {
  ChevronDown,
  Filter,
  X,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";

// ============================================
// Types
// ============================================
export type Direction = "all" | "long" | "short";

export interface FilterState {
  direction: Direction;
  sessions: Record<string, boolean>;
  months: number[];
  weekdays: number[];
  hourRange: [number, number];
  dateStart: string | null;
  dateEnd: string | null;
}

export const DEFAULT_FILTERS: FilterState = {
  direction: "all",
  sessions: {
    Tokyo: true,
    Sydney: true,
    London: true,
    "New York": true,
  },
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  hourRange: [0, 23],
  dateStart: null,
  dateEnd: null,
};

export interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  activeCount?: number;
}

// ============================================
// Dropdown Component
// ============================================
interface DropdownProps {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  hasSelection?: boolean;
}

function Dropdown({
  label,
  isOpen,
  onToggle,
  children,
  hasSelection,
}: DropdownProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
          transition-colors border
          ${
            hasSelection
              ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
              : "bg-neutral-800/60 border-neutral-700/50 text-neutral-300 hover:bg-neutral-700/60"
          }
        `}
      >
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 z-50 min-w-[180px]
          bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl
          py-2 px-2"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================
// FilterBar Component
// ============================================
export function FilterBar({
  filters,
  onFiltersChange,
  activeCount = 0,
}: FilterBarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const toggleDropdown = useCallback((name: string) => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  }, []);

  const closeDropdown = useCallback(() => {
    setOpenDropdown(null);
  }, []);

  // Direction filter
  const handleDirectionChange = useCallback(
    (dir: Direction) => {
      onFiltersChange({ ...filters, direction: dir });
      closeDropdown();
    },
    [filters, onFiltersChange, closeDropdown]
  );

  // Session filter
  const handleSessionToggle = useCallback(
    (session: string) => {
      const newSessions = { ...filters.sessions };
      newSessions[session] = !newSessions[session];
      onFiltersChange({ ...filters, sessions: newSessions });
    },
    [filters, onFiltersChange]
  );

  // Month filter
  const handleMonthToggle = useCallback(
    (month: number) => {
      const newMonths = filters.months.includes(month)
        ? filters.months.filter((m) => m !== month)
        : [...filters.months, month].sort((a, b) => a - b);
      onFiltersChange({ ...filters, months: newMonths });
    },
    [filters, onFiltersChange]
  );

  // Weekday filter
  const handleWeekdayToggle = useCallback(
    (day: number) => {
      const newWeekdays = filters.weekdays.includes(day)
        ? filters.weekdays.filter((d) => d !== day)
        : [...filters.weekdays, day].sort((a, b) => a - b);
      onFiltersChange({ ...filters, weekdays: newWeekdays });
    },
    [filters, onFiltersChange]
  );

  // Hour range filter
  const handleHourChange = useCallback(
    (type: "start" | "end", value: number) => {
      const newRange: [number, number] =
        type === "start"
          ? [value, filters.hourRange[1]]
          : [filters.hourRange[0], value];
      onFiltersChange({ ...filters, hourRange: newRange });
    },
    [filters, onFiltersChange]
  );

  // Date filter
  const handleDateChange = useCallback(
    (type: "start" | "end", value: string) => {
      if (type === "start") {
        onFiltersChange({ ...filters, dateStart: value || null });
      } else {
        onFiltersChange({ ...filters, dateEnd: value || null });
      }
    },
    [filters, onFiltersChange]
  );

  // Reset all filters
  const handleReset = useCallback(() => {
    onFiltersChange(DEFAULT_FILTERS);
    closeDropdown();
  }, [onFiltersChange, closeDropdown]);

  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const SESSIONS = ["Tokyo", "Sydney", "London", "New York"];

  const hasDirectionFilter = filters.direction !== "all";
  const hasSessionFilter = Object.values(filters.sessions).some((v) => !v);
  const hasMonthFilter = filters.months.length !== 12;
  const hasWeekdayFilter = filters.weekdays.length !== 7;
  const hasHourFilter =
    filters.hourRange[0] !== 0 || filters.hourRange[1] !== 23;
  const hasDateFilter = filters.dateStart !== null || filters.dateEnd !== null;

  const totalActiveFilters =
    (hasDirectionFilter ? 1 : 0) +
    (hasSessionFilter ? 1 : 0) +
    (hasMonthFilter ? 1 : 0) +
    (hasWeekdayFilter ? 1 : 0) +
    (hasHourFilter ? 1 : 0) +
    (hasDateFilter ? 1 : 0);

  return (
    <div className="flex items-center gap-2 p-3 bg-neutral-900/80 border-b border-neutral-800">
      {/* Filter Icon */}
      <div className="flex items-center gap-1.5 text-neutral-400">
        <Filter className="w-4 h-4" />
        <span className="text-xs font-medium">Filters</span>
        {totalActiveFilters > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/30 text-blue-300 rounded">
            {totalActiveFilters}
          </span>
        )}
      </div>

      <div className="w-px h-5 bg-neutral-700" />

      {/* Direction Filter */}
      <Dropdown
        label={
          filters.direction === "all"
            ? "Direction"
            : filters.direction === "long"
            ? "Long Only"
            : "Short Only"
        }
        isOpen={openDropdown === "direction"}
        onToggle={() => toggleDropdown("direction")}
        hasSelection={hasDirectionFilter}
      >
        <div className="space-y-1">
          <button
            onClick={() => handleDirectionChange("all")}
            className={`
              w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left
              ${
                filters.direction === "all"
                  ? "bg-blue-500/20 text-blue-300"
                  : "text-neutral-300 hover:bg-neutral-800"
              }
            `}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            All Directions
          </button>
          <button
            onClick={() => handleDirectionChange("long")}
            className={`
              w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left
              ${
                filters.direction === "long"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-neutral-300 hover:bg-neutral-800"
              }
            `}
          >
            <ArrowUp className="w-3.5 h-3.5" />
            Long Only
          </button>
          <button
            onClick={() => handleDirectionChange("short")}
            className={`
              w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left
              ${
                filters.direction === "short"
                  ? "bg-rose-500/20 text-rose-300"
                  : "text-neutral-300 hover:bg-neutral-800"
              }
            `}
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Short Only
          </button>
        </div>
      </Dropdown>

      {/* Session Filter */}
      <Dropdown
        label="Sessions"
        isOpen={openDropdown === "sessions"}
        onToggle={() => toggleDropdown("sessions")}
        hasSelection={hasSessionFilter}
      >
        <div className="space-y-1">
          {SESSIONS.map((session) => (
            <label
              key={session}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs
                text-neutral-300 hover:bg-neutral-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={filters.sessions[session] ?? true}
                onChange={() => handleSessionToggle(session)}
                className="rounded border-neutral-600 bg-neutral-800 text-blue-500
                  focus:ring-blue-500 focus:ring-offset-0"
              />
              {session}
            </label>
          ))}
          <button
            onClick={closeDropdown}
            className="w-full mt-2 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500
              text-xs font-medium text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </Dropdown>

      {/* Month Filter */}
      <Dropdown
        label="Months"
        isOpen={openDropdown === "months"}
        onToggle={() => toggleDropdown("months")}
        hasSelection={hasMonthFilter}
      >
        <div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((month, idx) => (
              <button
                key={month}
                onClick={() => handleMonthToggle(idx + 1)}
                className={`
                  px-2 py-1.5 rounded text-xs text-center
                  ${
                    filters.months.includes(idx + 1)
                      ? "bg-blue-500/20 text-blue-300"
                      : "text-neutral-500 hover:bg-neutral-800"
                  }
                `}
              >
                {month}
              </button>
            ))}
          </div>
          <button
            onClick={closeDropdown}
            className="w-full mt-2 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500
              text-xs font-medium text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </Dropdown>

      {/* Weekday Filter */}
      <Dropdown
        label="Weekdays"
        isOpen={openDropdown === "weekdays"}
        onToggle={() => toggleDropdown("weekdays")}
        hasSelection={hasWeekdayFilter}
      >
        <div>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day, idx) => (
              <button
                key={day}
                onClick={() => handleWeekdayToggle(idx)}
                className={`
                  px-2.5 py-1.5 rounded text-xs
                  ${
                    filters.weekdays.includes(idx)
                      ? "bg-blue-500/20 text-blue-300"
                      : "text-neutral-500 hover:bg-neutral-800"
                  }
                `}
              >
                {day}
              </button>
            ))}
          </div>
          <button
            onClick={closeDropdown}
            className="w-full mt-2 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500
              text-xs font-medium text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </Dropdown>

      {/* Hour Range Filter */}
      <Dropdown
        label={`Hours: ${filters.hourRange[0]}-${filters.hourRange[1]}`}
        isOpen={openDropdown === "hours"}
        onToggle={() => toggleDropdown("hours")}
        hasSelection={hasHourFilter}
      >
        <div className="space-y-3 px-1">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400 w-12">From:</label>
            <input
              type="number"
              min={0}
              max={23}
              value={filters.hourRange[0]}
              onChange={(e) =>
                handleHourChange("start", parseInt(e.target.value) || 0)
              }
              className="w-16 px-2 py-1 rounded bg-neutral-800 border border-neutral-700
                text-xs text-neutral-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400 w-12">To:</label>
            <input
              type="number"
              min={0}
              max={23}
              value={filters.hourRange[1]}
              onChange={(e) =>
                handleHourChange("end", parseInt(e.target.value) || 23)
              }
              className="w-16 px-2 py-1 rounded bg-neutral-800 border border-neutral-700
                text-xs text-neutral-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={closeDropdown}
            className="w-full px-3 py-2 rounded bg-blue-600 hover:bg-blue-500
              text-xs font-medium text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </Dropdown>

      {/* Date Range Filter */}
      <Dropdown
        label="Date Range"
        isOpen={openDropdown === "dates"}
        onToggle={() => toggleDropdown("dates")}
        hasSelection={hasDateFilter}
      >
        <div className="space-y-3 px-1" style={{ minWidth: 200 }}>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400">Start Date:</label>
            <input
              type="date"
              value={filters.dateStart || ""}
              onChange={(e) => handleDateChange("start", e.target.value)}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700
                text-sm text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              style={{ colorScheme: "dark" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400">End Date:</label>
            <input
              type="date"
              value={filters.dateEnd || ""}
              onChange={(e) => handleDateChange("end", e.target.value)}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700
                text-sm text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              style={{ colorScheme: "dark" }}
            />
          </div>
          <button
            onClick={closeDropdown}
            className="w-full mt-2 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500
              text-xs font-medium text-white transition-colors"
          >
            Apply
          </button>
        </div>
      </Dropdown>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Active Count */}
      {activeCount > 0 && (
        <span className="text-xs text-neutral-400">
          {activeCount} trade{activeCount !== 1 ? "s" : ""} shown
        </span>
      )}

      {/* Reset Button */}
      {totalActiveFilters > 0 && (
        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs
            text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800
            transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Reset
        </button>
      )}
    </div>
  );
}
