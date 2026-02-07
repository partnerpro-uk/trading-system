"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EntityType, QueryResult } from "@/hooks/useBacktesting";

interface EntityTableProps {
  results: QueryResult[];
  entityType: EntityType;
}

const PAGE_SIZE = 25;

// Column definitions per entity type
const COLUMNS: Record<EntityType, { key: string; label: string; align?: "right" | "center" }[]> = {
  bos: [
    { key: "time", label: "Time" },
    { key: "pair", label: "Pair" },
    { key: "timeframe", label: "TF" },
    { key: "direction", label: "Dir" },
    { key: "status", label: "Status" },
    { key: "magnitude_pips", label: "Magnitude", align: "right" },
    { key: "is_displacement", label: "Disp", align: "center" },
    { key: "is_counter_trend", label: "CT", align: "center" },
    { key: "broken_level", label: "Broken Level", align: "right" },
  ],
  fvg: [
    { key: "time", label: "Time" },
    { key: "pair", label: "Pair" },
    { key: "timeframe", label: "TF" },
    { key: "direction", label: "Dir" },
    { key: "status", label: "Status" },
    { key: "tier", label: "Tier", align: "center" },
    { key: "gap_size_pips", label: "Gap (pips)", align: "right" },
    { key: "fill_percent", label: "Fill %", align: "right" },
    { key: "bars_to_fill", label: "Bars to Fill", align: "right" },
  ],
  sweep: [
    { key: "time", label: "Time" },
    { key: "pair", label: "Pair" },
    { key: "timeframe", label: "TF" },
    { key: "direction", label: "Dir" },
    { key: "swept_level_type", label: "Level Type" },
    { key: "swept_level", label: "Swept Level", align: "right" },
    { key: "wick_extreme", label: "Wick Extreme", align: "right" },
    { key: "followed_by_bos", label: "BOS Follow", align: "center" },
  ],
  swing: [
    { key: "time", label: "Time" },
    { key: "pair", label: "Pair" },
    { key: "timeframe", label: "TF" },
    { key: "swing_type", label: "Type" },
    { key: "label", label: "Label" },
    { key: "price", label: "Price", align: "right" },
    { key: "true_range", label: "True Range", align: "right" },
    { key: "lookback_used", label: "Lookback", align: "right" },
  ],
};

function formatCellValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "-";

  if (key === "time") {
    const d = new Date(String(value));
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (key === "pair") return String(value).replace("_", "/");

  if (key === "is_displacement" || key === "is_counter_trend" || key === "followed_by_bos") {
    return Number(value) === 1 ? "Yes" : "No";
  }

  if (key === "fill_percent") return `${Number(value).toFixed(0)}%`;

  if (
    key === "magnitude_pips" ||
    key === "gap_size_pips" ||
    key === "broken_level" ||
    key === "swept_level" ||
    key === "wick_extreme" ||
    key === "price" ||
    key === "true_range"
  ) {
    return Number(value).toFixed(2);
  }

  return String(value);
}

function getCellColor(key: string, value: unknown): string {
  if (key === "direction") {
    const dir = String(value).toLowerCase();
    return dir.includes("bull") ? "text-green-400" : dir.includes("bear") ? "text-red-400" : "";
  }
  if (key === "status") {
    const s = String(value).toLowerCase();
    if (s === "active" || s === "fresh") return "text-blue-400";
    if (s === "filled") return "text-green-400";
    if (s === "reclaimed" || s === "inverted") return "text-red-400";
    return "text-yellow-400";
  }
  if (key === "is_displacement" || key === "followed_by_bos") {
    return Number(value) === 1 ? "text-green-400" : "text-gray-500";
  }
  if (key === "is_counter_trend") {
    return Number(value) === 1 ? "text-orange-400" : "text-gray-500";
  }
  if (key === "swing_type") {
    const t = String(value).toLowerCase();
    return t.includes("high") ? "text-green-400" : "text-red-400";
  }
  return "";
}

export function EntityTable({ results, entityType }: EntityTableProps) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns = COLUMNS[entityType];
  const allData = results.flatMap((r) =>
    (r.data || []).map((d) => {
      const row = d as Record<string, unknown>;
      return { ...row, pair: r.pair } as Record<string, unknown>;
    })
  );

  // Sort
  const sorted = sortKey
    ? [...allData].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av || "").localeCompare(String(bv || ""));
        return sortDir === "asc" ? cmp : -cmp;
      })
    : allData;

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  if (allData.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Results</h3>
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
          No results found
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-medium text-gray-300">
          Results ({allData.length.toLocaleString()})
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1 rounded hover:bg-gray-800 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-2 font-medium text-gray-500 cursor-pointer hover:text-gray-300 transition-colors ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {pageData.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-1.5 font-mono ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left"
                    } ${getCellColor(col.key, row[col.key]) || "text-gray-300"}`}
                  >
                    {formatCellValue(col.key, row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
