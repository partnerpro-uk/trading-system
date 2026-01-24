// @ts-nocheck
/* eslint-disable */
"use client";
// TODO: Add proper TypeScript types - temporarily disabled for port

// ClusterMap Component
// 2D/3D cluster visualization for trade analysis

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";

// Utilities from analysis library
import { clamp, quantile1D } from '../../lib/analysis/math';
import { formatNumber, formatMinutesShort } from '../../lib/analysis/formatting';
import { parseDateFromString, sessionFromTime, timeOfDayUnit, inferCandleMinutes, minutesBetween, formatDateTime, ParseMode } from '../../lib/analysis/dateTime';
import { displayIdForNode, displayIdFromRaw, colorForLibrary, cssColorWithAlpha, stableHashToUnit } from '../../lib/analysis/hashing';
import { convexHull2D, dist2 } from '../../lib/analysis/geometry2D';
import { drawClusterMapCanvas } from '../../lib/analysis/clusterMapCanvas';
import { buildMapVector, TIME_FEATURE_STRENGTH } from '../../lib/analysis/vectorBuilders';
import { standardiseVectors, computePCA, computeUMAPEmbedding2D } from '../../lib/analysis/dimensionReduction';
import { AI_LIBRARY_DEF_BY_ID } from '../../lib/analysis/constants';

// Types
import type { Trade, Candle } from '../../lib/analysis/types';

// Module-level variable for modality distinction display
let HDB_MODALITY_DISTINCTION = "real";

// Props interface for ClusterMap component
// Using `any` for complex data structures that have many dynamic properties
export interface ClusterMapProps {
  candles: any[];
  trades: any[];
  ghostEntries: any[];
  libraryPoints: any[];
  activeLibraries: any;
  libraryCounts: any;
  chunkBars: number;
  potential: any;
  parseMode: any;
  showPotential: boolean;
  resetKey: number;
  sliderValue: number;
  setSliderValue: any;
  onResetClusterMap: () => void;
  onPostHocTrades: (trades: any[]) => void;
  onPostHocProgress: any;
  onMitMap: (map: any) => void;
  aiMethod: string;
  aiModalities: any;
  hdbModalityDistinction: string;
  hdbMinClusterSize: number;
  hdbMinSamples: number;
  hdbEpsQuantile: number;
  staticLibrariesClusters: any;
  confidenceThreshold: number;
  statsDateStart: string;
  statsDateEnd: string;
  headless?: boolean;
}

export function ClusterMap({
  candles,
  trades,
  ghostEntries,
  libraryPoints,
  activeLibraries,
  libraryCounts,
  chunkBars,
  potential,
  parseMode,
  showPotential,
  resetKey,
  sliderValue,
  setSliderValue,
  onResetClusterMap,
  onPostHocTrades,
  onPostHocProgress,
  onMitMap,
  aiMethod,
  aiModalities,
  hdbModalityDistinction,
  hdbMinClusterSize,
  hdbMinSamples,
  hdbEpsQuantile,
  staticLibrariesClusters,
  confidenceThreshold,
  statsDateStart,
  statsDateEnd,
  headless = false,
}: ClusterMapProps) {
  const disabled = false;
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const redrawRef = useRef(() => {});
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredGroup, setHoveredGroup] = useState<any>(null);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const hoveredGroupRef = useRef<any>(null);
  const selectedGroupRef = useRef<any>(null);
  const [searchUid, setSearchUid] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [searchStatus, setSearchStatus] = useState<null | "hit" | "miss">(null);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(
    null
  );
  const searchHighlightIdRef = useRef<string | null>(null);
  useEffect(() => {
    searchHighlightIdRef.current = searchHighlightId;
  }, [searchHighlightId]);
  // Box selection (2D only)
  // - Toggle selection mode with Option+T (and a clickable UI toggle; Option+T is less likely to be blocked by the browser)
  // - In selection mode: click (left or right) to set corner A, move mouse to preview, click again to set corner B.
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [boxStart, setBoxStart] = useState<null | { x: number; y: number }>(
    null
  );
  const [boxEnd, setBoxEnd] = useState<null | { x: number; y: number }>(null);
  const [boxPreview, setBoxPreview] = useState<null | { x: number; y: number }>(
    null
  );

  const [selShape, setSelShape] = useState<null | "rect" | "lasso">(null);
  const [lassoFinal, setLassoFinal] = useState<
    null | { x: number; y: number }[]
  >(null);
  const [lassoIsDrawing, setLassoIsDrawing] = useState(false);
  const lassoRef = useRef<{
    drawing: boolean;
    pts: { x: number; y: number }[];
  }>({ drawing: false, pts: [] });

  // Heatmap mode (2D): toggle with H. Hides nodes and shows a density field + local expectancy stats on hover.
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [heatHoverLive, setHeatHover] = useState<null | any>(null);
  const heatmapRef = useRef<any>(null);

  // Pinning: click the map to freeze hover coords (top-center) and heatmap stats (top-left).
  // Press Escape to clear the pin and resume live hover.
  const [pinnedWorld, setPinnedWorld] = useState<null | {
    x: number;
    y: number;
  }>(null);
  const [pinnedHeatHover, setPinnedHeatHover] = useState<null | any>(null);
  const pinnedRef = useRef(false);
  useEffect(() => {
    pinnedRef.current = !!pinnedWorld;
  }, [pinnedWorld]);

  // Track whether the mouse is currently over the map so WASD/arrow panning doesn't steal keys elsewhere.
  const mapFocusRef = useRef(false);

  // Effective heat hover used by UI (pinned beats live).
  const heatHover = pinnedHeatHover ?? heatHoverLive;

  const heatWinRateColor = (wrRaw: any) => {
    const wr = Number(wrRaw);
    if (!Number.isFinite(wr)) return "rgba(255,255,255,0.92)";
    if (wr >= 0.62) return "rgba(60,220,120,0.98)";
    if (wr >= 0.56) return "rgba(140,240,140,0.96)";
    if (wr >= 0.5) return "rgba(255,220,120,0.96)";
    if (wr >= 0.44) return "rgba(255,170,120,0.96)";
    return "rgba(230,80,80,0.98)";
  };
  const heatProfitFactorColor = (pfRaw: any) => {
    const pf = Number(pfRaw);
    if (pfRaw === Infinity) return "rgba(60,220,120,0.98)";
    if (!Number.isFinite(pf)) return "rgba(255,255,255,0.92)";
    if (pf >= 1.6) return "rgba(60,220,120,0.98)";
    if (pf >= 1.15) return "rgba(140,240,140,0.96)";
    if (pf >= 0.95) return "rgba(255,220,120,0.96)";
    if (pf >= 0.75) return "rgba(255,170,120,0.96)";
    return "rgba(230,80,80,0.98)";
  };
  const heatDampColor = (dRaw: any) => {
    const d = Number(dRaw);
    if (!Number.isFinite(d)) return "rgba(255,255,255,0.92)";
    if (d >= 0.72) return "rgba(140,230,255,0.98)";
    if (d >= 0.45) return "rgba(210,170,255,0.96)";
    if (d >= 0.22) return "rgba(255,220,120,0.92)";
    return "rgba(255,255,255,0.84)";
  };
  const heatBiasColor = (bRaw: any, sRaw: any) => {
    const b = Number(bRaw) || 0;
    const s = Number(sRaw) || 0;
    const tot = b + s;
    if (!tot) return "rgba(255,255,255,0.90)";
    const buyPct = b / tot;
    const sellPct = s / tot;
    if (buyPct >= 0.55) return "rgba(60,220,120,0.98)";
    if (sellPct >= 0.55) return "rgba(230,80,80,0.98)";
    return "rgba(255,220,120,0.96)";
  };

  const selectedIdRef = useRef(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    setBoxStart(null);
    setBoxEnd(null);
    setBoxPreview(null);
    setSelShape(null);
    setLassoFinal(null);
    setLassoIsDrawing(false);
    lassoRef.current.drawing = false;
    lassoRef.current.pts = [];
  }, [resetKey]);

  // Hotkeys for box selection mode.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // NOTE: On macOS, Option+T often produces a special character (e.key === "†" on US layout).
      // e.code stays stable ("KeyT"), so prefer it.
      const key = String((e as any).key || "");
      const k = key.toLowerCase();
      const code = String((e as any).code || "");
      const isToggle = !!(
        e.altKey &&
        (code === "KeyT" || k === "t" || (e as any).keyCode === 84)
      );

      // Option+T toggles selection mode.
      if (isToggle) {
        e.preventDefault();
        e.stopPropagation();
        setBoxSelectMode((v) => !v);
        return;
      }

      // H toggles heatmap mode (avoid toggling while typing in inputs).
      const active =
        document && document.activeElement
          ? (document.activeElement as any)
          : null;
      const tag = String(active?.tagName || "").toUpperCase();
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        !!active?.isContentEditable;

      // macOS Option+H can emit a special character, so prefer e.code ("KeyH").
      // User requested Option+H for heatmap.
      const isHeatToggle = !!(
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        (code === "KeyH" || k === "h" || (e as any).keyCode === 72)
      );

      if (isHeatToggle && !isTyping) {
        e.preventDefault();
        e.stopPropagation();
        setHeatmapOn((v) => {
          const nv = !v;
          return nv;
        });
        return;
      }

      // Keyboard pan for the 2D cluster map (WASD + Arrow keys).
      // Only active while the pointer is over the map (so keys aren't stolen elsewhere).
      if (!isTyping && mapFocusRef.current) {
        const step = e.shiftKey ? 80 : 22;
        let dx = 0;
        let dy = 0;
        if (code === "ArrowLeft" || code === "KeyA") dx = -step;
        else if (code === "ArrowRight" || code === "KeyD") dx = step;
        else if (code === "ArrowUp" || code === "KeyW") dy = -step;
        else if (code === "ArrowDown" || code === "KeyS") dy = step;

        if ((dx !== 0 || dy !== 0) && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          setView((v) => {
            const nv = { ...v, ox: v.ox + dx, oy: v.oy + dy };
            viewRef.current = nv;
            return nv;
          });
          return;
        }
      }

      if (k === "escape") {
        // Escape exits selection mode and clears the in-progress rectangle preview.
        setBoxSelectMode(false);
        setBoxStart(null);
        setBoxEnd(null);
        setBoxPreview(null);
        setHeatHover(null);
        setPinnedWorld(null);
        setPinnedHeatHover(null);
      }
    };
    // capture=true helps when focus is inside inputs/sliders.
    window.addEventListener("keydown", onKeyDown, {
      passive: false,
      capture: true,
    } as any);
    return () =>
      window.removeEventListener(
        "keydown",
        onKeyDown as any,
        { capture: true } as any
      );
  }, []);
  const hoveredIdRef = useRef(null);
  const projectionRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const sliderContainerRef = useRef(null);
  const [sliderHover, setSliderHover] = useState(null);

  // Slider CSS variables (same as 2D) for the themed range input track fill
  const sliderVars = (value, min, max) => {
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    return { ["--p"]: `${clamp(pct, 0, 100)}%` };
  };

  // Local monospace helper (ClusterMap scope)
  const mono = () => ({
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    letterSpacing: 0.2,
  });

  const themeKeyForNode = (n: any) => {
    if (!n) return "neutral";
    const kind = String(n.kind || "");
    if (kind === "potential") return "purple";
    if (kind === "active") return "cyan";
    if (kind === "close") return "orange";
    if (kind === "ghost") return "ghost";

    const pnl =
      typeof n.unrealizedPnl === "number"
        ? n.unrealizedPnl
        : typeof n.pnl === "number"
        ? n.pnl
        : null;
    if (typeof pnl === "number") return pnl >= 0 ? "green" : "red";
    return "neutral";
  };

  const themeForKey = (k: string) => {
    const map: any = {
      purple: {
        accent: "rgba(210,170,255,0.98)",
        border: "1px solid rgba(160,90,255,0.50)",
        bg: "rgba(120,60,200,0.28)",
        shadow: "none",
      },
      cyan: {
        accent: "rgba(140,230,255,0.98)",
        border: "1px solid rgba(0,210,255,0.45)",
        bg: "rgba(0,130,200,0.26)",
        shadow: "none",
      },
      orange: {
        accent: "rgba(255,200,120,0.98)",
        border: "1px solid rgba(255,140,0,0.45)",
        bg: "rgba(180,90,0,0.24)",
        shadow: "none",
      },
      green: {
        accent: "rgba(60,220,120,0.98)",
        border: "1px solid rgba(60,220,120,0.45)",
        bg: "rgba(40,160,80,0.24)",
        shadow: "none",
      },
      red: {
        accent: "rgba(255,140,140,0.98)",
        border: "1px solid rgba(230,80,80,0.50)",
        bg: "rgba(200,50,50,0.24)",
        shadow: "none",
      },
      ghost: {
        accent: "rgba(210,210,210,0.92)",
        border: "1px solid rgba(180,180,180,0.40)",
        bg: "rgba(120,120,120,0.20)",
        shadow: "none",
      },
      neutral: {
        accent: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        bg: "rgba(0,0,0,0.62)",
        shadow: "none",
      },
    };
    return map[k] || map.neutral;
  };

  const lineColor = (line: string) => {
    const s = String(line || "");
    const up = s.toUpperCase();
    if (up.includes("BUY")) return "rgba(60,220,120,0.98)";
    if (up.includes("SELL") || up.includes("SHORT"))
      return "rgba(230,80,80,0.98)";
    if (up.startsWith("PNL:")) {
      const mm = s.match(/-?\d+(?:\.\d+)?/);
      const v = mm ? Number(mm[0]) : NaN;
      if (Number.isFinite(v))
        return v >= 0 ? "rgba(60,220,120,0.98)" : "rgba(230,80,80,0.98)";
      return "rgba(255,255,255,0.90)";
    }
    if (up.startsWith("CONFIDENCE:") || up.includes("POTENTIAL"))
      return "rgba(210,170,255,0.95)";
    if (up.startsWith("EXIT:")) return "rgba(255,200,120,0.95)";
    if (
      up.startsWith("TIME:") ||
      up.startsWith("ENTRY:") ||
      up.startsWith("EXIT:")
    )
      return "rgba(140,230,255,0.92)";
    return "rgba(255,255,255,0.90)";
  };

  // Debounce chunk size so dragging the slider doesn't re-embed on every tick
  const [chunkBarsDeb, setChunkBarsDeb] = useState(chunkBars);
  useEffect(() => {
    const t = setTimeout(() => setChunkBarsDeb(chunkBars), 240);
    return () => clearTimeout(t);
  }, [chunkBars]);

  // View filters (for Cluster Map only)
  const [viewDir, setViewDir] = useState("All"); // All | Buy | Sell
  const [viewSession, setViewSession] = useState("All"); // All | session name
  const [viewMonth, setViewMonth] = useState("All"); // All | 0-11
  const [viewWeekday, setViewWeekday] = useState("All"); // All | 0-6
  const [viewHour, setViewHour] = useState("All"); // All | 0-23

  // Cluster Groups stats view mode for the table + selected group panel
  // (All = overall, Buy = BUY-only subset, Sell = SELL-only subset)
  const [clusterGroupStatsMode, setClusterGroupStatsMode] = useState<
    "All" | "Buy" | "Sell"
  >("All");
  const [clusterGroupUniverse, setClusterGroupUniverse] = useState<
    "Library" | "Live" | "All"
  >("Library");
  const [viewModel, setViewModel] = useState("All"); // All | model label

  const MONTH_SHORT = useMemo(
    () => [
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
    ],
    []
  );
  const DOW_SHORT = useMemo(
    () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    []
  );

  const viewOpts = useMemo(() => {
    const sessSet = new Set<string>();
    const monSet = new Set<number>();
    const dowSet = new Set<number>();
    const hourSet = new Set<number>();
    const modelSet = new Set<string>();
    const addTime = (raw: any) => {
      const t = String(raw || "");
      if (!t) return;
      const s = sessionFromTime(t, parseMode);
      if (s) sessSet.add(String(s));
      const d = parseDateFromString(t, parseMode);
      if (d) {
        const mon = parseMode === "utc" ? d.getUTCMonth() : d.getMonth();
        const dow = parseMode === "utc" ? d.getUTCDay() : d.getDay();
        const hr = parseMode === "utc" ? d.getUTCHours() : d.getHours();
        if (Number.isFinite(mon)) monSet.add(mon);
        if (Number.isFinite(dow)) dowSet.add(dow);
        if (Number.isFinite(hr)) hourSet.add(hr);
      }
    };

    const addModel = (raw: any) => {
      const m = String(raw || "");
      if (!m || m === "-") return;
      modelSet.add(m);
    };

    for (const t of trades || []) {
      addTime((t as any)?.entryTime ?? (t as any)?.time ?? "");
      addModel(
        (t as any)?.entryModel ??
          (t as any)?.model ??
          (t as any)?.origModel ??
          ((t as any)?.chunkType && (t as any)?.chunkType !== "AI Model"
            ? (t as any)?.chunkType
            : "")
      );
    }
    for (const g of ghostEntries || []) {
      addTime((g as any)?.entryTime ?? "");
      addModel((g as any)?.model ?? (g as any)?.chunkType ?? "");
    }
    for (const lp of libraryPoints || []) {
      addTime((lp as any)?.entryTime ?? (lp as any)?.metaTime ?? "");
      addModel((lp as any)?.model ?? (lp as any)?.chunkType ?? "");
    }
    if (potential) {
      // Approximate potential time using the signal bar candle time (next candle if available)
      const sIdx = clamp(
        Math.floor(Number((potential as any).signalIndex ?? 0) || 0),
        0,
        Math.max(0, (candles || []).length - 1)
      );
      const tRaw =
        (candles || [])[Math.min((candles || []).length - 1, sIdx + 1)]?.time ??
        (candles || [])[sIdx]?.time ??
        "";
      addTime(tRaw);
      addModel(String((potential as any).model ?? ""));
    }

    const sessions = Array.from(sessSet).sort();
    const months = Array.from(monSet).sort((a, b) => a - b);
    const dows = Array.from(dowSet).sort((a, b) => a - b);
    const hours = Array.from(hourSet).sort((a, b) => a - b);
    const models = Array.from(modelSet).sort();

    return { sessions, months, dows, hours, models };
  }, [trades, ghostEntries, libraryPoints, potential, candles, parseMode]);

  // Suppressed library count should be stable regardless of Cluster Map view filters (All/Buy/Sell, time, etc.).
  const suppressedLibraryTotalAll = useMemo(() => {
    let c = 0;
    for (const lp of (libraryPoints as any[]) || []) {
      if (!lp) continue;
      const lid = String((lp as any).libId ?? (lp as any).metaLib ?? "");
      if (lid.toLowerCase() === "suppressed") c++;
    }
    return c;
  }, [libraryPoints]);

  const passesViewFilter = React.useCallback(
    (dirRaw: any, timeRaw: any, modelRaw?: any) => {
      // NOTE: Direction toggle (All/Buy/Sell) should not change which nodes appear on the cluster map.
      // It is used for stats context elsewhere (e.g., Cluster Groups stats mode), not for view filtering here.

      const mRaw = String(modelRaw ?? "");
      const mKey = mRaw && mRaw !== "-" ? mRaw : "";
      if (viewModel !== "All") {
        if (!mKey) return false;
        if (String(mKey) !== String(viewModel)) return false;
      }

      const t = String(timeRaw || "");
      const sess = t ? sessionFromTime(t, parseMode) : null;
      if (viewSession !== "All" && String(sess || "") !== String(viewSession))
        return false;

      const d = t ? parseDateFromString(t, parseMode) : null;
      const mon = d
        ? parseMode === "utc"
          ? d.getUTCMonth()
          : d.getMonth()
        : null;
      const dow = d ? (parseMode === "utc" ? d.getUTCDay() : d.getDay()) : null;
      const hr = d
        ? parseMode === "utc"
          ? d.getUTCHours()
          : d.getHours()
        : null;

      if (viewMonth !== "All") {
        if (mon == null) return false;
        if (String(mon) !== String(viewMonth)) return false;
      }
      if (viewWeekday !== "All") {
        if (dow == null) return false;
        if (String(dow) !== String(viewWeekday)) return false;
      }
      if (viewHour !== "All") {
        if (hr == null) return false;
        if (String(hr) !== String(viewHour)) return false;
      }
      return true;
    },
    [
      viewDir,
      viewSession,
      viewMonth,
      viewWeekday,
      viewHour,
      viewModel,
      parseMode,
    ]
  );
  const pnlScale = useMemo(() => {
    const closed = trades.filter((t) => !t.isOpen && t.pnl != null);
    if (!closed.length) return 1;
    const avgAbs =
      closed.reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0) / closed.length;
    return Math.max(1, avgAbs || 1);
  }, [trades]);
  const nodes = useMemo(() => {
    // Debug logging
    console.log("[ClusterMap] Computing nodes - candles:", candles.length, "trades:", trades.length);
    if (candles.length === 0) return [];
    const entries = [];
    const actLibs = Array.isArray(activeLibraries)
      ? activeLibraries.map((v: any) => String(v))
      : [];
    const suppressedLibActive = actLibs.some(
      (v: string) => v.toLowerCase() === "suppressed"
    );
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const fi = t.signalIndex;
      const baseV = buildMapVector(
        candles,
        fi,
        chunkBarsDeb,
        t.chunkType,
        t,
        pnlScale,
        parseMode
      );
      const tod = timeOfDayUnit(t.entryTime, parseMode);
      const timeFeature = (tod - 0.5) * 2 * TIME_FEATURE_STRENGTH;
      const meta = baseV.slice(-6);
      const chunk = baseV.slice(0, Math.max(0, baseV.length - 6));

      const pnl = t.isOpen ? t.unrealizedPnl ?? 0 : t.pnl ?? 0;
      const baseR = (3.4 + Math.min(10, Math.log10(Math.abs(pnl) + 10))) * 0.78;

      const dtStr = (t.exitTime || t.entryTime || "") as any;
      const dt = dtStr ? parseDateFromString(dtStr, parseMode) : null;
      const monIdx =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCMonth()
            : dt.getMonth()
          : null;
      const monthKey = monIdx != null ? MONTH_SHORT[monIdx] : null;
      const dow =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCDay()
            : dt.getDay()
          : null;
      const dowKey = typeof dow === "number" ? DOW_SHORT[dow] : null;
      const hour =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCHours()
            : dt.getHours()
          : null;

      const entryModel =
        (t as any).entryModel ??
        (t as any).model ??
        (t as any).origModel ??
        ((t as any).chunkType && (t as any).chunkType !== "AI Model"
          ? (t as any).chunkType
          : null);
      entries.push({
        id: `trade-${t.uid ?? t.id ?? i}-${t.entryIndex}`,
        uid: t.uid || t.id || null,
        chunk,
        meta,
        timeFeature,
        baseR,
        kind: "trade",
        signalIndex: t.signalIndex,
        entryIndex: t.entryIndex,
        exitIndex: t.exitIndex ?? null,
        pnl,
        win: pnl >= 0,
        isOpen: !!t.isOpen,
        dir: t.direction,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        session: t.session,
        entryModel,
        exitModel: (t as any).exitModel ?? null,
        monthKey,
        dow,
        dowKey,
        hour,
        metaTime: t.entryTime,
        metaSession: t.session,
        metaSuppressed: !!(t as any).suppressed,
        label: pnl >= 0 ? 1 : -1,
        closestCluster: t.closestCluster,
        closestClusterUid: (t as any).closestClusterUid ?? null,
        entryMargin: (t as any).entryMargin ?? null,
        aiMode: (t as any).aiMode ?? null,
        chunkType: t.chunkType,
        exitReason: t.exitReason,
        entryPrice: t.entryPrice,
        suppressed: !!(t as any).suppressed,
      });
    }
    const hasLiveOpenTrade = trades.some((t) => !!t.isOpen);
    if (
      showPotential &&
      !hasLiveOpenTrade &&
      potential &&
      potential.signalIndex >= 0 &&
      potential.model !== "-"
    ) {
      const sIdx = Math.min(
        candles.length - 1,
        Math.max(0, potential.signalIndex)
      );
      const pseudo = {
        direction: potential.dir,
        result: null,
        pnl: 0,
        isOpen: false,
      };
      const baseV = buildMapVector(
        candles,
        sIdx,
        chunkBarsDeb,
        potential.model,
        pseudo,
        pnlScale,
        parseMode
      );
      const tRaw =
        candles[Math.min(candles.length - 1, sIdx + 1)]?.time ??
        candles[sIdx]?.time ??
        "";
      if (
        passesViewFilter(pseudo.direction, tRaw, (potential as any).model ?? "")
      ) {
        const tod = timeOfDayUnit(tRaw, parseMode);
        const timeFeature = (tod - 0.5) * 2 * TIME_FEATURE_STRENGTH;
        const meta = baseV.slice(-6);
        const chunk = baseV.slice(0, Math.max(0, baseV.length - 6));
        const baseR = 6.8;
        entries.push({
          id: `potential-${sIdx}`,
          entryModel: (potential as any).model ?? null,
          chunk,
          meta,
          timeFeature,
          baseR,
          kind: "potential",
          signalIndex: sIdx,
          entryIndex: sIdx,
          exitIndex: null,
          dir: potential.dir,
          closestCluster: potential.label ?? undefined,
          potentialMargin: potential.margin,
          entryTime: tRaw,
          chunkType: potential.model,
        });
      }
    }
    if (suppressedLibActive) {
      for (let gi = 0; gi < ghostEntries.length; gi++) {
        const g = ghostEntries[gi];
        const pseudo = {
          direction: g.dir,
          result: null,
          pnl: 0,
          isOpen: false,
        };
        const baseV = buildMapVector(
          candles,
          g.signalIndex,
          chunkBarsDeb,
          g.model,
          pseudo,
          pnlScale,
          parseMode
        );
        const tod = timeOfDayUnit(g.entryTime, parseMode);
        const timeFeature = (tod - 0.5) * 2 * TIME_FEATURE_STRENGTH;
        const meta = baseV.slice(-6);
        const chunk = baseV.slice(0, Math.max(0, baseV.length - 6));
        const baseR = 6.8;

        const dtStr = (g.entryTime || "") as any;
        const dt = dtStr ? parseDateFromString(dtStr, parseMode) : null;
        const monIdx =
          dt != null
            ? parseMode === "utc"
              ? dt.getUTCMonth()
              : dt.getMonth()
            : null;
        const monthKey = monIdx != null ? MONTH_SHORT[monIdx] : null;
        const dow =
          dt != null
            ? parseMode === "utc"
              ? dt.getUTCDay()
              : dt.getDay()
            : null;
        const dowKey = typeof dow === "number" ? DOW_SHORT[dow] : null;
        const hour =
          dt != null
            ? parseMode === "utc"
              ? dt.getUTCHours()
              : dt.getHours()
            : null;
        const session = sessionFromTime(g.entryTime, parseMode);
        const uid = `G${Number(g.signalIndex ?? 0)
          .toString(36)
          .toUpperCase()}${Number(g.entryIndex ?? 0)
          .toString(36)
          .toUpperCase()}`;

        entries.push({
          id: `lib-suppressed-${g.signalIndex}-${g.entryIndex}-${gi}`,
          libId: "suppressed",
          metaLib: "suppressed",
          uid,
          entryMargin: Number((g as any).margin),
          session,
          monthKey,
          dow,
          dowKey,
          hour,
          entryModel: g.model ?? null,
          metaTime: g.entryTime,
          metaSession: session,
          chunk,
          meta,
          timeFeature,
          baseR,
          kind: "library",
          signalIndex: g.signalIndex,
          entryIndex: g.entryIndex,
          exitIndex: (g as any).exitIndex ?? null,
          exitTime: (g as any).exitTime ?? null,
          pnl: typeof (g as any).pnl === "number" ? (g as any).pnl : 0,
          win: (typeof (g as any).pnl === "number" ? (g as any).pnl : 0) >= 0,
          isOpen: false,
          exitModel: (g as any).exitModel ?? null,
          exitReason: (g as any).exitReason ?? null,
          entryPrice: (g as any).entryPrice ?? null,
          suppressed: true,
          dir: g.dir,
          entryTime: g.entryTime,
          aiMode: (g as any).aiMode ?? null,
          closestClusterUid:
            (g as any).labelUid ?? (g as any).closestClusterUid ?? null,
          closestCluster: (g as any).label ?? undefined,
          chunkType: g.model,
        });
      }
    }

    // Library neighbor points (active libraries) – shown on the Cluster Map for context.
    for (let li = 0; li < (libraryPoints || []).length; li++) {
      const p: any = (libraryPoints as any[])[li];
      if (!p) continue;

      const sIdxRaw =
        (p as any).signalIndex ??
        (p as any).metaSignalIndex ??
        (p as any).metaEntryIndex ??
        -1;
      const sIdx = Number(sIdxRaw);
      if (!Number.isFinite(sIdx) || sIdx < 0) continue;

      const modelKey = String((p as any).model ?? (p as any).chunkType ?? "-");
      if (!modelKey || modelKey === "-") continue;

      const libId = String((p as any).libId ?? (p as any).metaLib ?? "unknown");

      const isSuppLib = libId.toLowerCase() === "suppressed";
      if (isSuppLib && !suppressedLibActive) continue;

      const dir = Number((p as any).dir ?? (p as any).direction ?? 0) || 0;
      const pnl = Number((p as any).pnl ?? (p as any).metaPnl ?? 0) || 0;
      const resultRaw = (p as any).result;
      const labelRaw = Number((p as any).label ?? 0) || 0;

      const pseudo: any = {
        direction: dir,
        result: resultRaw ?? (labelRaw > 0 ? "TP" : labelRaw < 0 ? "SL" : null),
        pnl,
        isOpen: false,
      };

      const entryTime = (p as any).entryTime ?? (p as any).metaTime ?? "";
      // Try to preserve real exit info for library points when available.
      const exitIdxFromP =
        typeof (p as any).exitIndex === "number"
          ? (p as any).exitIndex
          : typeof (p as any).closeIndex === "number"
          ? (p as any).closeIndex
          : typeof (p as any).endIndex === "number"
          ? (p as any).endIndex
          : null;

      const holdBarsFromP = Number(
        (p as any).holdBars ??
          (p as any).barsHeld ??
          (p as any).durationBars ??
          (p as any).durBars ??
          0
      );

      const inferredExitIndex =
        exitIdxFromP != null
          ? exitIdxFromP
          : holdBarsFromP > 0
          ? sIdx + holdBarsFromP
          : Math.min(sIdx + 1, (candles?.length ?? sIdx + 2) - 1);

      const exitTimeFromP =
        (p as any).exitTime ??
        (p as any).exit_time ??
        (p as any).exitTimestamp ??
        (p as any).exitTs ??
        (p as any).closeTime ??
        (p as any).closeTimestamp ??
        (p as any).closeTs ??
        (p as any).endTime ??
        (p as any).endTimestamp ??
        (p as any).endTs ??
        "";

      const inferredExitTime =
        exitTimeFromP || candles?.[inferredExitIndex]?.time || "";

      // Always include Trades library points in the embedding so MIT can be computed consistently
      // even when the Cluster Map view filters are restricting what's visible.
      // Other libraries can still respect the current view filters.
      const libIdLower = String(libId || "").toLowerCase();
      const isTradesLibrary =
        libIdLower === "trades" || libIdLower.includes("trade");
      if (
        !isTradesLibrary &&
        !passesViewFilter(pseudo.direction, entryTime, modelKey)
      )
        continue;

      const baseV = buildMapVector(
        candles,
        sIdx,
        chunkBarsDeb,
        modelKey,
        pseudo,
        pnlScale,
        parseMode
      );

      const tod = timeOfDayUnit(entryTime, parseMode);
      const timeFeature = (tod - 0.5) * 2 * TIME_FEATURE_STRENGTH;
      const meta = baseV.slice(-6);
      const chunk = baseV.slice(0, Math.max(0, baseV.length - 6));
      const baseR = 6.4;

      const dtStr = (entryTime || "") as any;
      const dt = dtStr ? parseDateFromString(dtStr, parseMode) : null;
      const monIdx =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCMonth()
            : dt.getMonth()
          : null;
      const monthKey = monIdx != null ? MONTH_SHORT[monIdx] : null;
      const dow =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCDay()
            : dt.getDay()
          : null;
      const dowKey = typeof dow === "number" ? DOW_SHORT[dow] : null;
      const hour =
        dt != null
          ? parseMode === "utc"
            ? dt.getUTCHours()
            : dt.getHours()
          : null;

      entries.push({
        id:
          (p as any).id ??
          (p as any).uid ??
          `lib-${libId}-${modelKey}-${String(sIdx)}-${String(li)}`,
        chunk,
        meta,
        timeFeature,
        baseR,
        kind: "library",
        libId,
        signalIndex: sIdx,
        entryIndex: sIdx,
        exitIndex: inferredExitIndex,
        dir: pseudo.direction,
        pnl,
        unrealizedPnl: null,
        isOpen: false,
        win: pnl >= 0,
        entryTime: entryTime,
        exitTime: inferredExitTime,
        session: sessionFromTime(entryTime, parseMode),
        entryModel: modelKey,
        exitModel: null,
        monthKey,
        dow,
        dowKey,
        hour,
        metaTime: entryTime,
        metaSession: sessionFromTime(entryTime, parseMode),
        metaSuppressed: false,
        label: pnl >= 0 ? 1 : -1,
        closestCluster: (p as any).label ?? undefined,
        closestClusterPnl: null,
        closestClusterUid: (p as any).closestClusterUid ?? null,
        entryMargin: null,
        aiMode: "library",
        chunkType: modelKey,
        exitReason: "Library",
        entryPrice: (p as any).entryPrice ?? null,
        suppressed: false,
      });
    }

    if (entries.length === 0) return [];

    // Skip any nodes whose CHUNK vector contains non‑finite values (no PCA2 fallback).
    for (const e of entries as any[]) {
      let bad = false;
      const ch = (e as any).chunk;
      if (!Array.isArray(ch)) {
        bad = true;
      } else {
        for (let j = 0; j < ch.length; j++) {
          const x = ch[j];
          if (!Number.isFinite(x)) {
            bad = true;
            break;
          }
        }
      }
      (e as any).badVec = bad;
    }
    let goodEntries: any[] = (entries as any[]).filter(
      (e) => !(e as any).badVec
    );
    if (goodEntries.length === 0) return [];

    // Ensure cluster vectors are aligned across model types:
    // pad the CHUNK portion (everything except the last 6 meta features) so dimensions line up.
    let maxChunkLen = 0;
    for (const e of goodEntries)
      maxChunkLen = Math.max(maxChunkLen, (e.chunk || []).length);

    // Build dense, finite vectors
    for (const e of goodEntries) {
      const target = maxChunkLen;
      let ch = e.chunk || [];
      if (ch.length > target) ch = ch.slice(0, target);
      else if (ch.length < target)
        ch = ch.concat(new Array(target - ch.length).fill(0));

      const vv = new Array(target);
      let bad = false;
      for (let j = 0; j < target; j++) {
        const x = ch[j];
        if (Number.isFinite(x)) vv[j] = x;
        else {
          vv[j] = 0;
          bad = true;
        }
      }
      if (bad) (e as any).badVec = true;
      e.v = vv; // CHUNK ONLY (no meta/time)
    }
    goodEntries = goodEntries.filter((e) => !(e as any).badVec);
    if (goodEntries.length === 0) return [];

    const allVectors = goodEntries.map((e) => e.v);
    const { stdData, mean, stdev } = standardiseVectors(allVectors);

    // UMAP embedding for the Cluster Map (better preserves local neighborhood structure than PCA).
    // We keep PCA2 around for fast approximate "transform" and for initialization.
    const { pc1, pc2 } = computePCA(stdData);
    const um = computeUMAPEmbedding2D(stdData, pc1, pc2, {
      seedKey: "cluster-map",
      nNeighbors: 18,
      nEpochs: 200,
      negRate: 4,
      learningRate: 1.0,
      maxN: 2000,
      sampleN: 1500,
    });
    const embedding = um.emb;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of embedding) {
      if (!p) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = -1;
      maxX = 1;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      minY = -1;
      maxY = 1;
    }
    const dx = Math.max(1e-6, maxX - minX);
    const dy = Math.max(1e-6, maxY - minY);
    projectionRef.current = {
      mean,
      stdev,
      pc1,
      pc2,
      sampleIdx: um.sampleIdx,
      samplePcaX: um.samplePcaX,
      samplePcaY: um.samplePcaY,
      sampleEmbX: um.sampleEmbX,
      sampleEmbY: um.sampleEmbY,
      chunkLen: maxChunkLen,
      dim: goodEntries[0]?.v?.length ?? 0,
      minX,
      maxX,
      dx,
      minY,
      maxY,
      dy,
    };

    const JITTER_PX = 50;
    const mapWidth = 2000;
    const mapHeight = 900;
    const out: any[] = [];
    for (let i = 0; i < goodEntries.length; i++) {
      const e: any = goodEntries[i];
      const p: any = embedding[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue; // skip node

      const jxSeed = stableHashToUnit(e.id + "jx");
      const jySeed = stableHashToUnit(e.id + "jy");
      const jx = (jxSeed - 0.5) * JITTER_PX;
      const jy = (jySeed - 0.5) * JITTER_PX;
      const r = (e.baseR ?? 7.2) * 1.25;
      out.push({
        id: e.id,
        uid: (e as any).uid || (e as any).tradeUid || e.id || null,
        libId: (e as any).libId ?? null,
        x: ((p.x - minX) / dx - 0.5) * mapWidth + jx,
        y: ((p.y - minY) / dy - 0.5) * mapHeight + jy,
        r,
        kind: e.kind,
        pnl: e.pnl,
        win: e.win,
        isOpen: e.isOpen,
        dir: e.dir,
        entryTime: e.entryTime,
        exitTime: e.exitTime,
        session: e.session,
        closestCluster: e.closestCluster,
        closestClusterUid: (e as any).closestClusterUid ?? null,
        entryMargin: (e as any).entryMargin ?? null,
        aiMode: (e as any).aiMode ?? null,
        potentialMargin: e.potentialMargin,
        chunkType: e.chunkType,
        exitReason: e.exitReason,
        signalIndex: e.signalIndex,
        entryIndex: e.entryIndex,
        exitIndex: e.exitIndex,
        entryPrice: e.entryPrice,
      });
    }

    // MIT: always point to the closest available *library* neighbor (in the embedded 2D space).
    // This keeps "MIT ID" consistent even if the underlying trade didn't come with a precomputed closestClusterUid.
    // IMPORTANT: trades may have a "library" string like "Trades" — that must NOT qualify them as MIT candidates.
    try {
      const isLibraryLike = (n: any) => {
        if (!n) return false;
        const kind = String(n?.kind || "").toLowerCase();

        // Explicit library kind is always allowed.
        if (kind === "library") return true;

        // Stable library-point id prefix.
        const id0 = String((n as any).id ?? "");
        if (id0.startsWith("lib|")) return true;

        // Never treat trades as library nodes.
        if (kind === "trade") return false;

        // Some library points come through without kind, but with libId/metaLib/metaLibrary markers.
        const lid0 =
          (n as any).libId ??
          (n as any).metaLib ??
          (n as any).metaLibrary ??
          null;

        return lid0 != null;
      };

      // Prefer the canonical libraryPoints pool (even if libraries aren't currently visible),
      // otherwise fall back to whatever library nodes happen to be in this timeline slice.
      const libs: any[] =
        Array.isArray(libraryPoints) && libraryPoints.length
          ? (libraryPoints as any[]).filter(isLibraryLike)
          : (out as any[]).filter(isLibraryLike);

      if (libs && libs.length) {
        for (const n of out) {
          if (!n) continue;
          if (String((n as any).kind || "").toLowerCase() !== "trade") continue;

          // If it's already a library id, keep it. Otherwise compute from libraries.
          const cur = (n as any).closestClusterUid;
          const curStr = cur == null ? "" : String(cur);
          const alreadyLib =
            curStr.startsWith("lib|") ||
            isLibraryLike({ id: curStr, kind: "library" });

          if (!alreadyLib) {
            let best: any = null;
            let bestD = Infinity;
            const nx = Number((n as any).x);
            const ny = Number((n as any).y);
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;

            for (const l of libs) {
              if (
                !Number.isFinite((l as any)?.x) ||
                !Number.isFinite((l as any)?.y)
              )
                continue;
              const dx0 = nx - Number((l as any).x);
              const dy0 = ny - Number((l as any).y);
              const d2 = dx0 * dx0 + dy0 * dy0;
              if (d2 < bestD) {
                bestD = d2;
                best = l;
              }
            }

            if (best) {
              (n as any).closestClusterUid =
                (best as any).uid ?? (best as any).id ?? null;
            }
          }
        }
      }
    } catch (_e) {}

    console.log("[ClusterMap] Computed nodes:", out.length, "entries:", entries.length);
    return out;
  }, [
    candles,
    trades,
    ghostEntries,
    activeLibraries,
    chunkBars,
    pnlScale,
    potential,
    parseMode,
    showPotential,
    libraryPoints,
  ]);

  const tradeNodeByUidAll = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of (nodes as any[]) || []) {
      if (!n) continue;
      if ((n as any).kind !== "trade") continue;
      const uid = (n as any).uid ?? (n as any).tradeUid ?? null;
      if (uid != null) m.set(String(uid), n);
    }
    return m;
  }, [nodes]);

  const viewNodes = useMemo(() => {
    // Apply the Cluster Map dropdown filters (Direction/Session/Month/Weekday/Hour) to the plotted nodes.
    // This was previously missing, which made the dropdowns appear "stuck".
    return (nodes || []).filter((n: any) =>
      passesViewFilter(
        (n as any)?.dir,
        (n as any)?.entryTime ?? (n as any)?.time ?? "",
        (n as any)?.entryModel ?? (n as any)?.chunkType ?? ""
      )
    );
  }, [nodes, passesViewFilter]);

  const sortedNodes = useMemo(() => {
    const arr = [...viewNodes];
    arr.sort((a, b) => {
      const ta = a.entryTime ? new Date(a.entryTime).getTime() : 0;
      const tb = b.entryTime ? new Date(b.entryTime).getTime() : 0;
      return ta - tb;
    });
    return arr;
  }, [viewNodes]);
  useEffect(() => {
    if (resetKey === undefined) return;
    const lastIdx = candles.length > 0 ? candles.length - 1 : 0;
    setSliderValue(lastIdx);
    const defView = { scale: 1, ox: 600, oy: 280 };
    setView(defView);
    viewRef.current = defView;
  }, [resetKey, candles.length]);
  const [isPlaying, setIsPlaying] = useState(false);
  const playRef = useRef(null);
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
  useEffect(() => {
    if (!isPlaying) {
      if (playRef.current !== null) {
        cancelAnimationFrame(playRef.current);
        playRef.current = null;
      }
      return;
    }
    const maxIdx = Math.max(0, candles.length - 1);
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      if (now - last >= 200) {
        setSliderValue((v) => {
          if (v < maxIdx) {
            return v + 1;
          } else {
            setIsPlaying(false);
            return v;
          }
        });
        last = now;
      }
      playRef.current = requestAnimationFrame(step);
    };
    playRef.current = requestAnimationFrame(step);
    return () => {
      if (playRef.current !== null) {
        cancelAnimationFrame(playRef.current);
      }
    };
  }, [isPlaying, candles.length]);
  useEffect(() => {
    if (candles.length > 0) {
      setSliderValue(candles.length - 1);
    } else {
      setSliderValue(0);
    }
  }, [candles.length]);
  const [legendToggles, setLegendToggles] = useState({
    closedWin: true,
    closedLoss: true,
    active: true,
    potential: true,
    close: true,
  });
  const [ghostLegendColored, setGhostLegendColored] = useState(false);

  const [groupOverlayOpacity, setGroupOverlayOpacity] = React.useState(1);
  const showGroupOverlays = (Number(groupOverlayOpacity) || 0) > 0.001;
  const [nodeSizeMul, setNodeSizeMul] = React.useState(1);
  const [nodeOutlineMul, setNodeOutlineMul] = React.useState(1);
  const [heatmapInterp, setHeatmapInterp] = React.useState(0.1);
  const [heatmapSmoothness, setHeatmapSmoothness] = React.useState(0.6);
  const [mapSpreadPct, setMapSpreadPct] = React.useState(0.2); // 20% = current baseline
  const mapSpreadMul = React.useMemo(() => {
    const p = Number(mapSpreadPct);
    const pct = Number.isFinite(p) ? p : 0.2;
    // Interpret pct as [0..1]. Current baseline is 0.2 -> mul 1.
    const mul = pct / 0.2;
    return Math.max(0.25, Math.min(8, mul || 1));
  }, [mapSpreadPct]);
  const mapSpreadMulRef = React.useRef(mapSpreadMul);
  React.useEffect(() => {
    mapSpreadMulRef.current = mapSpreadMul;
  }, [mapSpreadMul]);

  const [hoverWorld, setHoverWorld] = useState<null | { x: number; y: number }>(
    null
  );
  const hoverWorldShown = pinnedWorld ?? hoverWorld;

  // Ensure all active libraries have legend toggles (default ON).
  useEffect(() => {
    const libsArr = Array.isArray(activeLibraries) ? activeLibraries : [];
    if (libsArr.length === 0) return;
    setLegendToggles((prev: any) => {
      let changed = false;
      const next: any = { ...prev };
      for (const lid of libsArr) {
        const key = `lib:${String(lid)}`;
        if (!(key in next)) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeLibraries]);

  const mapSelectStyle: React.CSSProperties = useMemo(
    () => ({
      fontSize: 10,
      padding: "6px 8px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(0,0,0,0.30)",
      color: "rgba(255,255,255,0.92)",
      outline: "none",
    }),
    []
  );

  const timelineNodes = useMemo(() => {
    const idx = sliderValue;
    const out: any[] = [];
    const proj = projectionRef.current;

    for (const n of sortedNodes as any[]) {
      if (typeof (n as any).signalIndex !== "number") continue;

      // Library nodes are identified by their kind or stable id prefix.
      // Trades may reference a library (closestClusterUid, etc.), so we avoid using libId as a discriminator here.
      const isLib =
        (n as any).kind === "library" ||
        String((n as any).id || "").startsWith("lib|");

      // Timeline filter: normally hides "future" points; in Static Libraries mode,
      // library points are always available from time 0.
      if (idx < (n as any).signalIndex && !(staticLibrariesClusters && isLib))
        continue;

      let dKind = (n as any).kind;
      let dIsOpen = (n as any).isOpen;
      let dWin = (n as any).win;

      if (isLib) {
        dKind = "library";
        dIsOpen = false;
        dWin =
          typeof (n as any).win === "boolean"
            ? (n as any).win
            : (Number((n as any).pnl ?? (n as any).unrealizedPnl ?? 0) || 0) >=
              0;
      } else if ((n as any).kind === "ghost") {
        dKind = "ghost";
        dIsOpen = false;
      } else if ((n as any).kind === "potential") {
        dKind = "potential";
        dIsOpen = false;
      } else if ((n as any).kind === "close") {
        dKind = "close";
        dIsOpen = true;
      } else {
        const eIdx = (n as any).entryIndex ?? (n as any).signalIndex;
        const xIdx =
          typeof (n as any).exitIndex === "number"
            ? (n as any).exitIndex
            : Infinity;
        if (idx < eIdx) {
          dKind = "potential";
          dIsOpen = false;
        } else if (idx >= xIdx) {
          dKind = "trade";
          dIsOpen = false;
        } else {
          dKind = "trade";
          dIsOpen = true;
        }
      }

      if (dKind === "ghost") continue;

      const staticNode: any = {
        ...(n as any),
        kind: dKind,
        isOpen: dIsOpen,
        win: dWin,
      };
      out.push(staticNode);

      // Add "close" projection nodes for OPEN trades (visual only).
      // These should never be used as a clustering/stats basis.
      if (
        proj &&
        staticNode.kind === "trade" &&
        staticNode.isOpen &&
        typeof staticNode.entryIndex === "number" &&
        idx >= staticNode.entryIndex &&
        idx <
          (typeof staticNode.exitIndex === "number"
            ? staticNode.exitIndex
            : Infinity) &&
        typeof staticNode.entryPrice === "number" &&
        legendToggles.close
      ) {
        const closePnl =
          ((candles as any[])[idx]?.close - staticNode.entryPrice) *
          staticNode.dir;
        const vClose = buildMapVector(
          candles,
          idx,
          chunkBarsDeb,
          staticNode.chunkType ?? "Momentum",
          {
            direction: staticNode.dir,
            result: null,
            isOpen: true,
            unrealizedPnl: closePnl,
          },
          pnlScale,
          parseMode
        );

        const tRaw = (candles as any[])[idx]?.time ?? "";
        const chunkC = vClose.slice(0, Math.max(0, vClose.length - 6));
        const targetChunk = (proj as any).chunkLen ?? chunkC.length;

        let chC = chunkC;
        if (chC.length > targetChunk) chC = chC.slice(0, targetChunk);
        else if (chC.length < targetChunk)
          chC = chC.concat(new Array(targetChunk - chC.length).fill(0));

        const stdVec = new Array(chC.length);
        for (let j = 0; j < chC.length; j++) {
          stdVec[j] = (chC[j] - (proj as any).mean[j]) / (proj as any).stdev[j];
        }

        let pcaX = 0;
        let pcaY = 0;
        for (let j = 0; j < stdVec.length; j++) {
          const val = stdVec[j];
          pcaX += val * (proj as any).pc1[j];
          pcaY += val * (proj as any).pc2[j];
        }

        const spx = (proj as any).samplePcaX || [];
        const spy = (proj as any).samplePcaY || [];
        let best = 0;
        let bestD = Infinity;
        const m0 = Math.min(
          ((proj as any).sampleEmbX || []).length,
          spx.length,
          spy.length
        );
        for (let t = 0; t < m0; t++) {
          const dx = pcaX - spx[t];
          const dy = pcaY - spy[t];
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = t;
          }
        }

        const rawX =
          ((proj as any).sampleEmbX && (proj as any).sampleEmbX[best]) != null
            ? (proj as any).sampleEmbX[best]
            : 0;
        const rawY =
          ((proj as any).sampleEmbY && (proj as any).sampleEmbY[best]) != null
            ? (proj as any).sampleEmbY[best]
            : 0;

        const normX =
          ((rawX - (proj as any).minX) / (proj as any).dx - 0.5) * 2000;
        const normY =
          ((rawY - (proj as any).minY) / (proj as any).dy - 0.5) * 900;

        const jxSeed = stableHashToUnit(staticNode.id + "-close-jx-" + idx);
        const jySeed = stableHashToUnit(staticNode.id + "-close-jy-" + idx);
        const JITTER_PX = 50;
        const jx = (jxSeed - 0.5) * JITTER_PX;
        const jy = (jySeed - 0.5) * JITTER_PX;

        out.push({
          id: `${staticNode.id}-close-${idx}`,
          time: tRaw,
          x: normX + jx,
          y: normY + jy,
          r: staticNode.r,
          kind: "close",
          isOpen: true,
          pnl: closePnl * 100,
          win: staticNode.win,
          dir: staticNode.dir,
          entryTime: staticNode.entryTime,
          exitTime: staticNode.exitTime,
          session: staticNode.session,
          closestCluster: staticNode.closestCluster,
          potentialMargin: staticNode.potentialMargin,
          chunkType: staticNode.chunkType,
          exitReason: staticNode.exitReason,
          signalIndex: staticNode.signalIndex,
          entryIndex: staticNode.entryIndex,
          exitIndex: staticNode.exitIndex,
          parentId: staticNode.id,
          entryPrice: staticNode.entryPrice,
        });
      }
    }

    return out;
  }, [
    sortedNodes,
    sliderValue,
    candles,
    chunkBarsDeb,
    pnlScale,
    parseMode,
    legendToggles.close,
    staticLibrariesClusters,
  ]);

  const hdbOverlay = useMemo(() => {
    if (aiMethod !== "hdbscan") return null;

    const modSet = new Set<string>();
    const wantFilterClusters = false;
    const wantFilterStats = false;
    // Query context for modality matching.
    // IMPORTANT: Keep this overlay independent of selection/hover/slider so post-hoc does not recompute on node clicks.
    const ctxNode: any = null;
    const ctxTime = "";

    const ctxDate = parseDateFromString(ctxTime, parseMode);
    const ctxMonth =
      viewMonth !== "All"
        ? Number(viewMonth)
        : ctxDate
        ? parseMode === "utc"
          ? ctxDate.getUTCMonth()
          : ctxDate.getMonth()
        : null;
    const ctxDow =
      viewWeekday !== "All"
        ? Number(viewWeekday)
        : ctxDate
        ? parseMode === "utc"
          ? ctxDate.getUTCDay()
          : ctxDate.getDay()
        : null;
    const ctxHour =
      viewHour !== "All"
        ? Number(viewHour)
        : ctxDate
        ? parseMode === "utc"
          ? ctxDate.getUTCHours()
          : ctxDate.getHours()
        : null;
    const ctxYear = ctxDate
      ? parseMode === "utc"
        ? ctxDate.getUTCFullYear()
        : ctxDate.getFullYear()
      : null;

    const ctxSession =
      viewSession !== "All"
        ? String(viewSession)
        : String(ctxNode?.session ?? sessionFromTime(ctxTime, parseMode) ?? "");

    const ctxDir = 0;

    const ctxMeta: any = {
      dir: ctxDir,
      session: ctxSession,
      month: ctxMonth,
      dow: ctxDow,
      hour: ctxHour,
      year: ctxYear,
    };

    const metaCache = new Map<string, any>();
    const nodeMeta = (n: any) => {
      const k = String(n?.id ?? n?.uid ?? "");
      const hit = metaCache.get(k);
      if (hit) return hit;
      const t = String(n?.entryTime ?? n?.time ?? "");
      const d = parseDateFromString(t, parseMode);
      const m = {
        dir: Number(n?.dir ?? n?.direction ?? 0),
        session: String(n?.session ?? sessionFromTime(t, parseMode) ?? ""),
        month: d
          ? parseMode === "utc"
            ? d.getUTCMonth()
            : d.getMonth()
          : null,
        dow: d ? (parseMode === "utc" ? d.getUTCDay() : d.getDay()) : null,
        hour: d ? (parseMode === "utc" ? d.getUTCHours() : d.getHours()) : null,
        year: d
          ? parseMode === "utc"
            ? d.getUTCFullYear()
            : d.getFullYear()
          : null,
      };
      metaCache.set(k, m);
      return m;
    };

    const passesModalityForViz = (n: any) => {
      if (modSet.size === 0) return true;
      const m = nodeMeta(n);

      if (
        modSet.has("Direction") &&
        Number.isFinite(Number(ctxMeta.dir)) &&
        Number(ctxMeta.dir) !== 0
      ) {
        if (Number(m.dir) !== Number(ctxMeta.dir)) return false;
      }
      if (
        modSet.has("Session") &&
        String(ctxMeta.session || "") !== "All" &&
        String(ctxMeta.session || "") !== ""
      ) {
        if (String(m.session || "") !== String(ctxMeta.session || ""))
          return false;
      }
      if (modSet.has("Month") && ctxMeta.month != null) {
        if (Number(m.month) !== Number(ctxMeta.month)) return false;
      }
      if (modSet.has("Weekday") && ctxMeta.dow != null) {
        if (Number(m.dow) !== Number(ctxMeta.dow)) return false;
      }
      if (modSet.has("Hour") && ctxMeta.hour != null) {
        if (Number(m.hour) !== Number(ctxMeta.hour)) return false;
      }
      if (modSet.has("Year") && ctxMeta.year != null) {
        if (Number(m.year) !== Number(ctxMeta.year)) return false;
      }
      return true;
    };

    const baseNodes: any[] = (timelineNodes as any[]).filter(
      (n: any) =>
        n &&
        !n.isOpen &&
        n.kind !== "potential" &&
        n.kind !== "close" &&
        n.kind !== "ghost" &&
        !(n as any).metaFromLibrary &&
        !(
          String((n as any).kind || "").toLowerCase() === "trade" &&
          (String((n as any).exitReason ?? "").toLowerCase() === "library" ||
            String(
              (n as any).exitBy ?? (n as any).exitMethod ?? ""
            ).toLowerCase() === "library")
        )
    );

    const basisNodes: any[] = staticLibrariesClusters
      ? baseNodes.filter(
          (n: any) =>
            n &&
            (String((n as any).kind || "").toLowerCase() === "library" ||
              String((n as any).id || "").startsWith("lib|"))
        )
      : baseNodes;

    // Use visible nodes in UMAP space (2D) and run a density clustering for visualization.
    // This is purely visual — trading decisions use the feature-space clustering in the worker.
    const pts: [number, number][] = [];
    const nodeRefs: any[] = [];
    for (let i = 0; i < (basisNodes as any[]).length; i++) {
      const n: any = (basisNodes as any[])[i];
      if (!n) continue;
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      if (wantFilterClusters && !passesModalityForViz(n)) continue;
      if (n.isPotential || n.isOpen || n.isLive) continue;
      pts.push([n.x, n.y]);
      nodeRefs.push(n);
    }
    const N = pts.length;
    if (N < 10) return null;

    // ---- Performance note ----
    // A naive DBSCAN/HDBSCAN visualization that computes all pairwise distances is O(N^2) and will freeze the browser
    // once N gets large (e.g. thousands of nodes). We:
    // 1) estimate eps using a capped sample (k-distance quantile),
    // 2) run DBSCAN using a grid index in 2D (near-linear in practice).
    const ms = Math.max(2, Math.min(200, Number(hdbMinSamples || 12)));

    const CORE_CAP = 1400; // cap for eps estimation
    let sampIdx: number[] = [];
    if (N > CORE_CAP) {
      const step = Math.ceil(N / CORE_CAP);
      for (let i = 0; i < N; i += step) sampIdx.push(i);
      if (sampIdx.length > CORE_CAP) sampIdx = sampIdx.slice(0, CORE_CAP);
    } else {
      sampIdx = Array.from({ length: N }, (_, i) => i);
    }
    const sampPts = sampIdx.map((i) => pts[i]);
    const k = Math.max(2, Math.min(ms, sampPts.length - 1));

    // k-distance (kth nearest neighbor distance) for eps selection, computed without full sorts.
    const coreD: number[] = new Array(sampPts.length).fill(0);
    for (let i = 0; i < sampPts.length; i++) {
      const best = new Array(k).fill(Infinity);
      let max = Infinity;
      let maxIdx = 0;

      for (let j = 0; j < sampPts.length; j++) {
        if (i === j) continue;
        const d = dist2(sampPts[i], sampPts[j]);
        if (d < max) {
          best[maxIdx] = d;
          // recompute current max of the k-best list
          max = best[0];
          maxIdx = 0;
          for (let t = 1; t < k; t++) {
            if (best[t] > max) {
              max = best[t];
              maxIdx = t;
            }
          }
        }
      }
      coreD[i] = Number.isFinite(max) ? max : 0;
    }

    let eps = quantile1D(
      coreD,
      Math.max(0.5, Math.min(0.99, Number(hdbEpsQuantile || 0.85)))
    );
    if (!Number.isFinite(eps) || eps <= 0) eps = quantile1D(coreD, 0.75) || 1;

    // Grid-indexed DBSCAN in 2D (fast for large N)
    const dbscan2DGrid = (
      points: [number, number][],
      eps0: number,
      minSamples0: number
    ) => {
      const n = points.length;
      const labels = new Array(n).fill(-1);
      const visited = new Array(n).fill(false);
      let clusterId = 0;

      const epsSafe = Math.max(1e-9, Number(eps0) || 0);
      const eps2 = epsSafe * epsSafe;
      const inv = 1 / epsSafe;

      const grid = new Map<string, number[]>();
      for (let i = 0; i < n; i++) {
        const p = points[i];
        const cx = Math.floor(p[0] * inv);
        const cy = Math.floor(p[1] * inv);
        const key = String(cx) + "," + String(cy);
        const arr = grid.get(key);
        if (arr) arr.push(i);
        else grid.set(key, [i]);
      }

      const neighCache: (number[] | null)[] = new Array(n).fill(null);

      const regionQuery = (i: number) => {
        const cached = neighCache[i];
        if (cached) return cached;

        const p = points[i];
        const cx = Math.floor(p[0] * inv);
        const cy = Math.floor(p[1] * inv);

        const out: number[] = [];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = String(cx + dx) + "," + String(cy + dy);
            const bucket = grid.get(key);
            if (!bucket) continue;
            for (let bi = 0; bi < bucket.length; bi++) {
              const j = bucket[bi];
              if (j === i) continue;
              const q = points[j];
              const ddx = p[0] - q[0];
              const ddy = p[1] - q[1];
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 <= eps2) out.push(j);
            }
          }
        }
        neighCache[i] = out;
        return out;
      };

      const expand = (seed: number, cid: number, seedNeighbors: number[]) => {
        labels[seed] = cid;
        const queue = seedNeighbors.slice();
        const queued = new Set<number>(queue);
        for (let qi = 0; qi < queue.length; qi++) {
          const j = queue[qi];
          if (!visited[j]) {
            visited[j] = true;
            const nj = regionQuery(j);
            if (nj.length + 1 >= minSamples0) {
              for (let t = 0; t < nj.length; t++) {
                const u = nj[t];
                if (!queued.has(u)) {
                  queued.add(u);
                  queue.push(u);
                }
              }
            }
          }
          if (labels[j] === -1) labels[j] = cid;
        }
      };

      for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        visited[i] = true;
        const nbs = regionQuery(i);
        if (nbs.length + 1 < minSamples0) {
          labels[i] = -1;
        } else {
          expand(i, clusterId, nbs);
          clusterId++;
        }
      }

      return { labels, nClusters: clusterId };
    };

    const res = dbscan2DGrid(pts, eps, ms);
    const labels = res.labels.slice();

    // Prune tiny clusters -> noise
    const counts0 = new Array(res.nClusters).fill(0);
    for (const c of labels) if (c >= 0) counts0[c] += 1;
    const minSz = Math.max(5, Math.min(5000, Number(hdbMinClusterSize || 40)));
    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      if (c >= 0 && counts0[c] < minSz) labels[i] = -1;
    }

    // Re-index clusters to compact ids
    const remap = new Map<number, number>();
    let nextId = 0;
    for (let i = 0; i < labels.length; i++) {
      const cid = labels[i];
      if (cid < 0) continue;
      if (!remap.has(cid)) remap.set(cid, nextId++);
      labels[i] = remap.get(cid) as number;
    }

    const clusterPts: Record<string, [number, number][]> = {};
    const clusterMembers: Record<string, number[]> = {};
    const clusterStats: Record<string, any> = {};
    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      if (c < 0) continue;
      const key = String(c);
      if (!clusterPts[key]) clusterPts[key] = [];
      clusterPts[key].push(pts[i]);

      if (!clusterMembers[key]) clusterMembers[key] = [];
      clusterMembers[key].push(i);

      const n: any = nodeRefs[i];
      if (wantFilterStats && !passesModalityForViz(n)) {
        continue;
      }
      const pnl =
        typeof n?.pnl === "number"
          ? n.pnl
          : typeof n?.unrealizedPnl === "number"
          ? n.unrealizedPnl
          : typeof n?.closePnl === "number"
          ? n.closePnl
          : 0;
      const dir = Number(n?.dir ?? n?.direction ?? 0);

      if (!clusterStats[key])
        clusterStats[key] = {
          count: 0,
          wins: 0,
          buys: 0,
          sells: 0,
          sumPnl: 0,
          sumPos: 0,
          sumNeg: 0,
          maxWin: 0,
          maxLoss: 0,

          // Direction-specific (BUY / SELL)
          buyCount: 0,
          buyWins: 0,
          buySumPnl: 0,
          buySumPos: 0,
          buySumNeg: 0,
          buyMaxWin: 0,
          buyMaxLoss: 0,

          sellCount: 0,
          sellWins: 0,
          sellSumPnl: 0,
          sellSumPos: 0,
          sellSumNeg: 0,
          sellMaxWin: 0,
          sellMaxLoss: 0,
        };
      const st = clusterStats[key];
      st.count += 1;
      if (pnl >= 0) st.wins += 1;
      if (dir === 1) st.buys += 1;
      if (dir === -1) st.sells += 1;

      // Direction-specific (BUY / SELL) accumulators
      if (dir === 1) {
        st.buyCount += 1;
        if (pnl >= 0) st.buyWins += 1;
        st.buySumPnl += pnl;
        if (pnl >= 0) {
          st.buySumPos += pnl;
          if (pnl > (st.buyMaxWin || 0)) st.buyMaxWin = pnl;
        } else {
          st.buySumNeg += pnl;
          if (pnl < (st.buyMaxLoss || 0)) st.buyMaxLoss = pnl;
        }
      } else if (dir === -1) {
        st.sellCount += 1;
        if (pnl >= 0) st.sellWins += 1;
        st.sellSumPnl += pnl;
        if (pnl >= 0) {
          st.sellSumPos += pnl;
          if (pnl > (st.sellMaxWin || 0)) st.sellMaxWin = pnl;
        } else {
          st.sellSumNeg += pnl;
          if (pnl < (st.sellMaxLoss || 0)) st.sellMaxLoss = pnl;
        }
      }

      st.sumPnl += pnl;
      if (pnl >= 0) {
        st.sumPos += pnl;
        if (pnl > (st.maxWin || 0)) st.maxWin = pnl;
      } else {
        st.sumNeg += pnl;
        if (pnl < (st.maxLoss || 0)) st.maxLoss = pnl;
      }
    }

    const clusters: any[] = [];
    const keys = Object.keys(clusterPts).sort((a, b) => Number(a) - Number(b));
    for (const k0 of keys) {
      const arr = clusterPts[k0];
      if (!arr || arr.length < 6) continue;
      const hull = convexHull2D(arr);
      if (!hull || hull.length < 3) continue;
      const st0 = clusterStats[k0] || { count: 0, wins: 0, buys: 0, sells: 0 };
      const cN = Number(st0.count || 0);
      const wN = Number(st0.wins || 0);
      const lN = Math.max(0, cN - wN);
      const bN = Number(st0.buys || 0);
      const sN = Number(st0.sells || 0);

      const bcN = Number((st0 as any).buyCount || 0);
      const bwN = Number((st0 as any).buyWins || 0);
      const blN = Math.max(0, bcN - bwN);
      const scN = Number((st0 as any).sellCount || 0);
      const swN = Number((st0 as any).sellWins || 0);
      const slN = Math.max(0, scN - swN);

      clusters.push({
        id: Number(k0),
        members: (clusterMembers[k0] || []).slice(),
        hull,
        stats: {
          count: cN,
          wins: wN,
          losses: lN,
          buys: bN,
          sells: sN,
          buyCount: bcN,
          buyWins: bwN,
          buyLosses: blN,
          buyWinRate: bcN > 0 ? bwN / bcN : 0,
          buyTotalPnl: Number(st0.buySumPnl) || 0,
          buyAvgPnl: bcN > 0 ? (Number(st0.buySumPnl) || 0) / bcN : 0,
          buySumPos: Number(st0.buySumPos) || 0,
          buySumNeg: Number(st0.buySumNeg) || 0,
          buyAvgWin: bwN > 0 ? (Number(st0.buySumPos) || 0) / bwN : 0,
          buyAvgLoss: blN > 0 ? -(Number(st0.buySumNeg) || 0) / blN : 0,
          buyMaxWin: Number(st0.buyMaxWin) || 0,
          buyMaxLoss: Number(st0.buyMaxLoss) || 0,
          buyProfitFactor:
            (Number(st0.buySumNeg) || 0) < 0
              ? (Number(st0.buySumPos) || 0) /
                Math.max(1e-9, -(Number(st0.buySumNeg) || 0))
              : (Number(st0.buySumPos) || 0) > 0
              ? Infinity
              : 0,

          sellCount: scN,
          sellWins: swN,
          sellLosses: slN,
          sellWinRate: scN > 0 ? swN / scN : 0,
          sellTotalPnl: Number(st0.sellSumPnl) || 0,
          sellAvgPnl: scN > 0 ? (Number(st0.sellSumPnl) || 0) / scN : 0,
          sellSumPos: Number(st0.sellSumPos) || 0,
          sellSumNeg: Number(st0.sellSumNeg) || 0,
          sellAvgWin: swN > 0 ? (Number(st0.sellSumPos) || 0) / swN : 0,
          sellAvgLoss: slN > 0 ? -(Number(st0.sellSumNeg) || 0) / slN : 0,
          sellMaxWin: Number(st0.sellMaxWin) || 0,
          sellMaxLoss: Number(st0.sellMaxLoss) || 0,
          sellProfitFactor:
            (Number(st0.sellSumNeg) || 0) < 0
              ? (Number(st0.sellSumPos) || 0) /
                Math.max(1e-9, -(Number(st0.sellSumNeg) || 0))
              : (Number(st0.sellSumPos) || 0) > 0
              ? Infinity
              : 0,
          winRate: cN > 0 ? wN / cN : 0.5,
          totalPnl: Number(st0.sumPnl) || 0,
          avgPnl: cN > 0 ? (Number(st0.sumPnl) || 0) / cN : 0,
          sumPos: Number(st0.sumPos) || 0,
          sumNeg: Number(st0.sumNeg) || 0,
          avgWin: wN > 0 ? (Number(st0.sumPos) || 0) / wN : 0,
          avgLoss: lN > 0 ? -(Number(st0.sumNeg) || 0) / lN : 0,
          maxWin: Number(st0.maxWin) || 0,
          maxLoss: Number(st0.maxLoss) || 0,
          payoff:
            lN > 0
              ? wN > 0
                ? (Number(st0.sumPos) || 0) /
                  wN /
                  Math.max(1e-9, -(Number(st0.sumNeg) || 0) / lN)
                : 0
              : wN > 0 && (Number(st0.sumPos) || 0) > 0
              ? Infinity
              : 0,
          winLoss: lN > 0 ? wN / lN : wN > 0 ? Infinity : 0,
          profitFactor:
            (Number(st0.sumNeg) || 0) < 0
              ? (Number(st0.sumPos) || 0) /
                Math.max(1e-9, -(Number(st0.sumNeg) || 0))
              : (Number(st0.sumPos) || 0) > 0
              ? Infinity
              : 0,
        },
      });
    }

    return { eps, clusters };
  }, [
    aiMethod,
    timelineNodes,
    staticLibrariesClusters,
    candles,
    parseMode,
    viewSession,
    viewMonth,
    viewWeekday,
    viewHour,
    hdbModalityDistinction,
    hdbMinSamples,
    hdbEpsQuantile,
    hdbMinClusterSize,
  ]);

  const timelineNodesCheat = useMemo(() => {
    if (aiMethod !== "hdbscan") return timelineNodes as any[];
    const thrPct = clamp(Number(confidenceThreshold || 0), 0, 100);

    // --- Helpers: stable identity + "Library" exit detection (Library is not a real exit) ---
    const tradeKeyLocal = (n: any): string =>
      String(
        (n as any)?.uid ??
          (n as any)?.tradeUid ??
          (n as any)?.tradeId ??
          (n as any)?.id ??
          (n as any)?.metaOrigUid ??
          (n as any)?.metaOrigId ??
          (n as any)?.metaUid ??
          (n as any)?.metaTradeUid ??
          ""
      ).trim();

    const isLibraryExit = (n: any): boolean => {
      if (!n) return false;
      const tags = [
        (n as any).exitBy,
        (n as any).exitMethod,
        (n as any).exitReason,
        (n as any).exitModel,
        (n as any).exitType,
        (n as any).closedBy,
        (n as any).exitSource,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .filter(Boolean);
      return tags.some((t) => t === "library" || t.includes("library"));
    };

    // Deterministic 32-bit FNV-1a hash (stable across renders)
    const hash32 = (s: string) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const makePostHocId = (prefix: string, seed: string) => {
      const h = hash32(seed).toString(36).toUpperCase();
      return `${prefix}${h}`;
    };

    // Local HDBSCAN cluster info helper (declared here to avoid TDZ issues)
    // Computes membership directly from hdbOverlay so it does not depend on later declarations.
    const hdbInfoLocal = (
      node: any
    ): { wr: number; clusterId: number | null } | null => {
      if (!node || aiMethod !== "hdbscan") return null;

      const x = Number((node as any).x);
      const y = Number((node as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return { wr: 0.01, clusterId: null };

      // Direction modality check (avoid activeModSet TDZ)
      const wantDir =
        Array.isArray(aiModalities) &&
        (aiModalities as any[]).some(
          (m) => String(m || "").toLowerCase() === "direction"
        );

      // Point-in-polygon in world coords (avoid pointInPolyWorld TDZ)
      const pointInPoly = (
        px: number,
        py: number,
        poly: [number, number][]
      ) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0],
            yi = poly[i][1];
          const xj = poly[j][0],
            yj = poly[j][1];
          const intersect =
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const dir = Number((node as any).dir ?? (node as any).direction ?? 0);

      // Build confidence clusters locally from hdbOverlay (avoid hdbConfidenceClusters TDZ)
      const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
      for (const c of clArr) {
        const hull =
          c && (c as any).hull ? ((c as any).hull as [number, number][]) : null;
        if (!hull || hull.length < 3) continue;

        // Expand hull slightly (matches overlay stroke padding)
        let cx = 0,
          cy = 0;
        for (const p of hull) {
          cx += p[0];
          cy += p[1];
        }
        cx /= hull.length;
        cy /= hull.length;

        const poly = hull.map((p) => {
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          return [cx + dx * 1.08, cy + dy * 1.08] as [number, number];
        });

        // Cheap AABB reject
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of poly) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        if (!pointInPoly(x, y, poly)) continue;

        const st: any = (c as any)?.stats || {};
        let wr = Number(st?.winRate);

        // Direction-specific win rate only when Direction modality enabled
        if (wantDir) {
          if (dir === 1) {
            const bc = Number(st?.buyCount ?? st?.buys ?? 0);
            const bwr = Number(st?.buyWinRate);
            if (Number.isFinite(bwr) && bc > 0) wr = bwr;
          } else if (dir === -1) {
            const sc = Number(st?.sellCount ?? st?.sells ?? 0);
            const swr = Number(st?.sellWinRate);
            if (Number.isFinite(swr) && sc > 0) wr = swr;
          }
        }

        if (!Number.isFinite(wr)) {
          const wins = Number(st?.wins);
          const count = Number(st?.count);
          if (Number.isFinite(wins) && Number.isFinite(count) && count > 0)
            wr = wins / Math.max(1, count);
        }
        if (!Number.isFinite(wr)) wr = 0;

        const cidRaw = Number((c as any).id);
        const cid = Number.isFinite(cidRaw) ? cidRaw : null;
        return { wr: clamp(wr, 0, 1), clusterId: cid };
      }

      // Noise
      return { wr: 0.01, clusterId: null };
    };

    const demotedTradeIds = new Set<string>();
    const out: any[] = [];

    // Prevent duplicating real trades: the library seeding pool can reuse raw trade ids/uids.
    // If a library node corresponds to an existing trade, we never "promote" it into a duplicate trade.
    const existingTradeKeys = new Set<string>();
    for (const nn of timelineNodes as any[]) {
      if (!nn) continue;
      const k = String((nn as any).kind || "trade").toLowerCase();
      if (k !== "trade") continue;
      const key = String(
        (nn as any).uid ?? (nn as any).tradeUid ?? (nn as any).id ?? ""
      );
      if (key) existingTradeKeys.add(key);
    }

    // Trades with "exit by/method = Library" are not real exits; remove them everywhere.
    // Track their stable identity so we can also remove associated close markers.
    const libraryExitTradeKeys = new Set<string>();
    for (const nn of timelineNodes as any[]) {
      if (!nn) continue;
      const k = String((nn as any).kind || "trade").toLowerCase();
      if (k !== "trade") continue;
      if (!isLibraryExit(nn)) continue;
      const key = tradeKeyLocal(nn);
      if (key) libraryExitTradeKeys.add(key);
    }

    for (const n of timelineNodes as any[]) {
      if (!n) continue;

      const kind = String((n as any).kind || "trade").toLowerCase();

      // Close nodes are visual-only projections; never convert them.
      // If their parent trade was demoted, drop the close node entirely.
      if (kind === "close") {
        const pid = String((n as any).parentId ?? "");
        if (pid && demotedTradeIds.has(pid)) continue;
        // Also drop close nodes for trades we are removing ("exit by Library").
        // Close markers often carry only the parent id, so check both.
        if (pid && libraryExitTradeKeys.has(pid)) continue;
        const ck = tradeKeyLocal(n);
        if (ck && libraryExitTradeKeys.has(ck)) continue;
        out.push(n);
        continue;
      }

      // Remove any trade that claims to exit via "Library" (not a real exit)
      if (kind === "trade" && isLibraryExit(n)) {
        const tk = tradeKeyLocal(n);
        if (tk) libraryExitTradeKeys.add(tk);
        continue;
      }

      const info = hdbInfoLocal(n);
      const wr = info?.wr;
      const hasWr = typeof wr === "number" && Number.isFinite(wr);
      const clusterId = info?.clusterId ?? null;

      // Library -> Trade (if cluster qualifies): ONLY promote from suppressed-library points.
      // Base-seeding / non-suppressed libraries are *never* real trades and should never be promoted into trades.
      if (kind === "library") {
        const isSuppressedLibrary =
          !!(n as any).suppressed ||
          !!(n as any).metaSuppressed ||
          String((n as any).libId ?? "").toLowerCase() === "suppressed" ||
          String((n as any).metaLib ?? "").toLowerCase() === "suppressed" ||
          String((n as any).library ?? "").toLowerCase() === "suppressed" ||
          String((n as any).metaLibrary ?? "").toLowerCase() === "suppressed";

        // Non-suppressed libraries remain libraries forever (but still carry win-rate for tooltips/selection).
        if (!isSuppressedLibrary) {
          out.push({
            ...(n as any),
            aiMargin: wr,
            hdbWinRate: wr,
            hdbClusterId: clusterId,
            closestCluster:
              clusterId != null && Number.isFinite(clusterId)
                ? `HD #${clusterId}`
                : (n as any).closestCluster,
          });
          continue;
        }

        // If this suppressed-library node somehow shares identity with an existing trade, do NOT promote it.
        // (This avoids duplicate trades if upstream data contains both a trade and a suppressed library copy.)
        const libKey = String(
          (n as any).metaOrigUid ??
            (n as any).uid ??
            (n as any).tradeUid ??
            (n as any).metaOrigId ??
            (n as any).id ??
            ""
        );
        if (libKey && existingTradeKeys.has(libKey)) {
          out.push({
            ...(n as any),
            aiMargin: wr,
            hdbWinRate: wr,
            hdbClusterId: clusterId,
            closestCluster:
              clusterId != null && Number.isFinite(clusterId)
                ? `HD #${clusterId}`
                : (n as any).closestCluster,
          });
          continue;
        }

        // Never promote a suppressed-library point into a trade if it indicates an invalid "Library" exit.
        if (isLibraryExit(n)) {
          out.push({
            ...(n as any),
            aiMargin: wr,
            hdbWinRate: wr,
            hdbClusterId: clusterId,
            closestCluster:
              clusterId != null && Number.isFinite(clusterId)
                ? `HD #${clusterId}`
                : (n as any).closestCluster,
          });
          continue;
        }

        if (hasWr && wr * 100 >= thrPct) {
          const seed = [
            "promoteSuppressed",
            String(clusterId ?? "na"),
            String((n as any).metaOrigUid ?? (n as any).uid ?? ""),
            String((n as any).metaOrigId ?? (n as any).id ?? ""),
            String((n as any).signalIndex ?? ""),
            String((n as any).entryIndex ?? ""),
            String(Math.round(wr * 10000)),
            String(Math.round(thrPct)),
          ].join("|");

          const newId = makePostHocId("phT_", seed);
          const dir = (n as any).dir ?? (n as any).direction ?? 0;

          const pnlRaw =
            typeof (n as any).pnl === "number" &&
            Number.isFinite((n as any).pnl)
              ? (n as any).pnl
              : typeof (n as any).unrealizedPnl === "number" &&
                Number.isFinite((n as any).unrealizedPnl)
              ? (n as any).unrealizedPnl
              : 0;

          // Minimal trade-shaped node with fresh identity; keep geometry/embedding + core trade fields for UI.
          // This is a *real* trade being reinstated from a suppressed-library copy, so it should be included
          // in trade history/stats. (Do NOT mark metaFromLibrary.)
          out.push({
            id: newId,
            uid: makePostHocId("phU_", seed),
            // Preserve link to the original (pre post-hoc) trade identity for search/selection resolution.
            metaOrigId: (n as any).metaOrigId ?? null,
            metaOrigUid: (n as any).metaOrigUid ?? null,
            tradeUid: makePostHocId("phTU_", seed),
            aiMargin: wr,
            hdbWinRate: wr,
            hdbClusterId: clusterId,
            closestCluster:
              clusterId != null && Number.isFinite(clusterId)
                ? `HD #${clusterId}`
                : null,
            kind: "trade",
            isOpen: false,
            // geometry / vectors (needed for map + clustering context)
            x: (n as any).x,
            y: (n as any).y,
            r: (n as any).r,
            baseR: (n as any).baseR,
            chunk: (n as any).chunk,
            meta: (n as any).meta,
            timeFeature: (n as any).timeFeature,
            // timeline identity
            time: (n as any).time,
            metaTime: (n as any).metaTime ?? (n as any).time,
            signalIndex: (n as any).signalIndex,
            entryIndex: (n as any).entryIndex ?? (n as any).signalIndex,
            exitIndex: (n as any).exitIndex ?? null,
            entryTime:
              (n as any).entryTime ?? (n as any).metaTime ?? (n as any).time,
            exitTime: (n as any).exitTime ?? null,
            session: (n as any).session ?? (n as any).metaSession ?? null,
            // trade semantics
            dir,
            direction: dir,
            pnl: pnlRaw,
            unrealizedPnl: null,
            win:
              typeof (n as any).win === "boolean"
                ? (n as any).win
                : pnlRaw >= 0,
            entryModel: (n as any).entryModel ?? null,
            exitModel: (n as any).exitModel ?? null,
            chunkType: (n as any).chunkType ?? (n as any).model ?? null,
            // Preserve exitReason exactly as-is. We do NOT relabel anything as "Model".
            exitReason: (n as any).exitReason ?? null,
            entryPrice: (n as any).entryPrice ?? null,
            tpPrice: (n as any).tpPrice ?? null,
            slPrice: (n as any).slPrice ?? null,
            // IMPORTANT: do NOT carry over library/suppressed identity fields.
            libId: null,
            metaLib: null,
            library: null,
            metaLibrary: null,
            suppressed: false,
            metaSuppressed: false,
          });
          continue;
        }

        // Not promoted: keep suppressed library point (but attach win-rate for consistency)
        out.push({
          ...(n as any),
          aiMargin: wr,
          hdbWinRate: wr,
          hdbClusterId: clusterId,
          closestCluster:
            clusterId != null && Number.isFinite(clusterId)
              ? `HD #${clusterId}`
              : (n as any).closestCluster,
        });
        continue;
      }

      // Trade -> Suppressed library (if cluster does NOT qualify): replace with a brand-new library node
      if (kind === "trade") {
        if (hasWr && wr * 100 < thrPct) {
          const seed = [
            "demote",
            String(clusterId ?? "na"),
            String((n as any).uid ?? ""),
            String((n as any).id ?? ""),
            String((n as any).signalIndex ?? ""),
            String((n as any).entryIndex ?? ""),
            String((n as any).exitIndex ?? ""),
            String(Math.round(wr * 10000)),
            String(Math.round(thrPct)),
          ].join("|");

          const newId = makePostHocId("phL_", seed);
          demotedTradeIds.add(String((n as any).id ?? ""));

          const dir = (n as any).dir ?? (n as any).direction ?? 0;
          const pnlRaw =
            typeof (n as any).pnl === "number" &&
            Number.isFinite((n as any).pnl)
              ? (n as any).pnl
              : typeof (n as any).unrealizedPnl === "number" &&
                Number.isFinite((n as any).unrealizedPnl)
              ? (n as any).unrealizedPnl
              : 0;

          // Minimal library-shaped node with fresh identity; keep geometry/embedding + core fields for UI.
          out.push({
            id: newId,
            uid: makePostHocId("phU_", seed),
            // Keep a link back to the pre post-hoc identity so search/selection can resolve correctly.
            metaOrigId: (n as any).id ?? null,
            metaOrigUid: (n as any).uid ?? (n as any).tradeUid ?? null,
            kind: "library",
            // geometry / vectors
            x: (n as any).x,
            y: (n as any).y,
            r: (n as any).r,
            baseR: (n as any).baseR,
            chunk: (n as any).chunk,
            meta: (n as any).meta,
            timeFeature: (n as any).timeFeature,
            // timeline identity
            time: (n as any).time,
            metaTime: (n as any).metaTime ?? (n as any).time,
            signalIndex: (n as any).signalIndex ?? (n as any).entryIndex,
            entryIndex: (n as any).entryIndex ?? (n as any).signalIndex,
            exitIndex: (n as any).exitIndex ?? null,
            entryTime:
              (n as any).entryTime ?? (n as any).metaTime ?? (n as any).time,
            exitTime: (n as any).exitTime ?? null,
            session: (n as any).session ?? (n as any).metaSession ?? null,
            // library / suppression identity (fresh)
            libId: "suppressed",
            metaLib: "suppressed",
            library: "suppressed",
            metaLibrary: "suppressed",
            suppressed: true,
            metaSuppressed: true,
            // keep some semantics for tooltips/stats
            dir,
            direction: dir,
            pnl: pnlRaw,
            win:
              typeof (n as any).win === "boolean"
                ? (n as any).win
                : pnlRaw >= 0,
            entryModel: (n as any).entryModel ?? null,
            exitModel: (n as any).exitModel ?? null,
            chunkType: (n as any).chunkType ?? (n as any).entryModel ?? null,
            exitReason: (n as any).exitReason ?? null,
            entryPrice: (n as any).entryPrice ?? null,
          });
          continue;
        }

        // Not demoted: keep original trade (attach cluster win-rate so UI confidence matches)
        out.push({
          ...(n as any),
          aiMargin: wr,
          hdbWinRate: wr,
          hdbClusterId: clusterId,
          closestCluster:
            clusterId != null && Number.isFinite(clusterId)
              ? `HD #${clusterId}`
              : (n as any).closestCluster,
        });
        continue;
      }

      // Any other kinds: keep as-is (attach cluster win-rate so selection/tooltips stay consistent)
      out.push({
        ...(n as any),
        aiMargin: wr,
        hdbWinRate: wr,
        hdbClusterId: clusterId,
        closestCluster:
          clusterId != null && Number.isFinite(clusterId)
            ? `HD #${clusterId}`
            : (n as any).closestCluster,
      });
    }

    return out;
  }, [timelineNodes, aiMethod, confidenceThreshold, hdbOverlay]);

  // HDBSCAN cluster info helper for hover/tooltips (component-scope).
  // Uses stamped fields when available, otherwise falls back to hull membership.
  const hdbInfo = useCallback(
    (node: any): { wr: number; clusterId: number | null } | null => {
      if (!node || aiMethod !== "hdbscan") return null;

      let wr: any = (node as any).hdbWinRate;
      if (wr == null) wr = (node as any).aiMargin;
      if (wr == null) wr = (node as any).confidence;
      let clusterId: any =
        (node as any).hdbClusterId ?? (node as any).clusterId ?? null;

      // Normalize wr into [0,1]
      let wrNum = Number(wr);
      if (Number.isFinite(wrNum)) {
        if (wrNum > 1.01) wrNum = wrNum / 100;
        wrNum = clamp(wrNum, 0, 1);
        const cidNum = Number(clusterId);
        return {
          wr: wrNum,
          clusterId: Number.isFinite(cidNum) ? cidNum : null,
        };
      }

      // Fallback: infer by polygon membership in world coords (no modality filtering).
      const x = Number((node as any).x);
      const y = Number((node as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return { wr: 0.01, clusterId: null };

      const pointInPoly = (
        px: number,
        py: number,
        poly: [number, number][]
      ) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0],
            yi = poly[i][1];
          const xj = poly[j][0],
            yj = poly[j][1];
          const intersect =
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
      for (const c of clArr) {
        const hull =
          c && (c as any).hull ? ((c as any).hull as [number, number][]) : null;
        if (!hull || hull.length < 3) continue;

        // expand slightly
        let cx = 0,
          cy = 0;
        for (const p of hull) {
          cx += p[0];
          cy += p[1];
        }
        cx /= hull.length;
        cy /= hull.length;
        const poly = hull.map((p) => {
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          return [cx + dx * 1.08, cy + dy * 1.08] as [number, number];
        });

        // AABB reject
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of poly) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        if (!pointInPoly(x, y, poly)) continue;

        const st: any = (c as any)?.stats || {};
        let wr2 = Number(st?.winRate);
        if (!Number.isFinite(wr2)) {
          const wins = Number(st?.wins);
          const count = Number(st?.count);
          if (Number.isFinite(wins) && Number.isFinite(count) && count > 0)
            wr2 = wins / Math.max(1, count);
        }
        if (!Number.isFinite(wr2)) wr2 = 0;

        const cidRaw = Number((c as any).id);
        return {
          wr: clamp(wr2, 0, 1),
          clusterId: Number.isFinite(cidRaw) ? cidRaw : null,
        };
      }

      return { wr: 0.01, clusterId: null };
    },
    [aiMethod, hdbOverlay]
  );

  // Stable identity key for de-duping / mapping nodes across post-hoc and raw streams.
  const tradeKey = (n: any): string => {
    return String(
      (n as any)?.uid ??
        (n as any)?.tradeUid ??
        (n as any)?.tradeId ??
        (n as any)?.id ??
        (n as any)?.metaOrigUid ??
        (n as any)?.metaOrigId ??
        (n as any)?.metaUid ??
        (n as any)?.metaTradeUid ??
        ""
    ).trim();
  };

  const displayNodesRaw = useMemo(() => {
    const out: any[] = [];
    const seenTradeKeys = new Set<string>();
    for (const n of timelineNodesCheat as any[]) {
      const categories: string[] = [];

      if ((n as any).kind === "library") {
        const lk = `lib:${String((n as any).libId || "unknown")}`;
        categories.push(lk);
      } else if ((n as any).kind === "potential") {
        categories.push("potential");
      } else if ((n as any).kind === "close") {
        categories.push("close");
      } else {
        if ((n as any).isOpen) {
          categories.push("active");
        } else {
          categories.push((n as any).win ? "closedWin" : "closedLoss");
        }
      }

      // Exclude phantom/library-exit trade nodes everywhere ("Library" is not a real exit).
      // This keeps Cluster Map consistent with Trade History / stats / calendar.
      const _exitReasonTag = String((n as any).exitReason ?? "").toLowerCase();
      const _exitByTag = String(
        (n as any).exitBy ?? (n as any).exitMethod ?? ""
      ).toLowerCase();
      if ((n as any).metaFromLibrary) continue;
      if (
        String((n as any).kind || "").toLowerCase() === "trade" &&
        (_exitReasonTag === "library" || _exitByTag === "library")
      )
        continue;

      let visible = true;
      for (const c of categories) {
        if ((legendToggles as any)[c] === false) {
          visible = false;
          break;
        }
      }
      if (!visible) continue;

      // De-dupe trade-shaped nodes by stable trade identity so the map doesn't double-count.
      if (String((n as any).kind || "").toLowerCase() === "trade") {
        const k = tradeKey(n);
        if (k) {
          if (seenTradeKeys.has(k)) continue;
          seenTradeKeys.add(k);
        }
      }

      out.push(n);
    }
    return out;
  }, [timelineNodesCheat, legendToggles]);
  const selectedNodeRaw = useMemo(() => {
    if (!selectedId) return null;
    return displayNodesRaw.find((n) => n.id === selectedId) || null;
  }, [displayNodesRaw, selectedId]);
  const nodeByIdRaw = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of displayNodesRaw as any[]) m.set(n.id, n);
    return m;
  }, [displayNodesRaw]);

  const boxCornerA = selShape === "rect" ? boxStart : null;
  const boxCornerB =
    selShape === "rect"
      ? boxEnd || (boxSelectMode && boxStart ? boxPreview : null)
      : null;

  const boxRect = useMemo(() => {
    if (!boxCornerA || !boxCornerB) return null;
    const x0 = Math.min(boxCornerA.x, boxCornerB.x);
    const x1 = Math.max(boxCornerA.x, boxCornerB.x);
    const y0 = Math.min(boxCornerA.y, boxCornerB.y);
    const y1 = Math.max(boxCornerA.y, boxCornerB.y);
    return { x0, y0, x1, y1 };
  }, [boxCornerA, boxCornerB]);

  const boxViz = useMemo(() => {
    return {
      kind: selShape,
      anchor: boxCornerA ? { x: boxCornerA.x, y: boxCornerA.y } : null,
      rect: boxRect,
      // While drawing, use the live lasso points (mutated in-place in lassoRef).
      // This ensures the line shows up immediately instead of only after mouse-up.
      lasso:
        selShape === "lasso"
          ? lassoIsDrawing
            ? (lassoRef.current.pts as any)
            : lassoFinal
          : null,
      lassoClosed:
        selShape === "lasso" &&
        !lassoIsDrawing &&
        !!lassoFinal &&
        lassoFinal.length >= 3,
    };
  }, [selShape, boxCornerA, boxRect, lassoFinal, lassoIsDrawing]);

  // NOTE: These selection stats are computed from the *raw* node list and are used only
  // for HDB overlay hit-testing/visualization (not the user-facing selection stats).
  const boxStatsBase = useMemo(() => {
    if (!boxRect) return null;
    const { x0, y0, x1, y1 } = boxRect;
    const picked = (displayNodesRaw as any[]).filter(
      (n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1
    );

    // Count all picked nodes (as currently visible on the map).
    // This includes library points, suppressed points, ghosts, potentials, etc.
    const arr = picked;

    const summarize = (list: any[]) => {
      let count = 0;
      let totalPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let wins = 0;

      for (const n of list) {
        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;
        count++;
        totalPnl += pnl;

        const hasWin = typeof (n as any).win === "boolean";
        const isWin = hasWin ? !!(n as any).win : pnl >= 0;
        if (isWin) {
          wins++;
          if (pnl > 0) grossProfit += pnl;
        } else {
          if (pnl < 0) grossLoss += Math.abs(pnl);
        }
      }

      const losses = Math.max(0, count - wins);
      const winRate = count > 0 ? wins / count : 0;
      const expValue = count > 0 ? totalPnl / count : 0;
      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
          ? Infinity
          : NaN;
      const avgWin = wins > 0 ? grossProfit / wins : 0;
      const avgLoss = losses > 0 ? grossLoss / losses : 0;

      return {
        count,
        totalPnl,
        grossProfit,
        grossLoss,
        wins,
        losses,
        winRate,
        expValue,
        profitFactor,
        avgWin,
        avgLoss,
      };
    };

    const all = summarize(arr);
    const buy = summarize(
      arr.filter((n) => ((n as any).dir ?? (n as any).direction) === 1)
    );
    const sell = summarize(
      arr.filter((n) => ((n as any).dir ?? (n as any).direction) === -1)
    );

    return {
      all,
      buy,
      sell,
      buys: buy.count,
      sells: sell.count,
    };
  }, [boxRect, displayNodesRaw]);

  const lassoStatsBase = useMemo(() => {
    const poly = lassoFinal;
    if (!poly || poly.length < 3) return null;

    const pointInPoly = (
      x: number,
      y: number,
      pts: { x: number; y: number }[]
    ) => {
      // Ray casting
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x,
          yi = pts[i].y;
        const xj = pts[j].x,
          yj = pts[j].y;
        const intersect =
          yi > y !== yj > y &&
          x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const picked = (displayNodesRaw as any[]).filter((n) =>
      pointInPoly(n.x, n.y, poly)
    );

    // Count all picked nodes (as currently visible on the map).
    // This includes library points, suppressed points, ghosts, potentials, etc.
    const arr = picked;

    const summarize = (list: any[]) => {
      let count = 0;
      let totalPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let wins = 0;

      for (const n of list) {
        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;
        count++;
        totalPnl += pnl;

        const hasWin = typeof (n as any).win === "boolean";
        const isWin = hasWin ? !!(n as any).win : pnl >= 0;
        if (isWin) {
          wins++;
          if (pnl > 0) grossProfit += pnl;
        } else {
          if (pnl < 0) grossLoss += Math.abs(pnl);
        }
      }

      const losses = Math.max(0, count - wins);
      const winRate = count > 0 ? wins / count : 0;
      const expValue = count > 0 ? totalPnl / count : 0;
      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
          ? Infinity
          : NaN;
      const avgWin = wins > 0 ? grossProfit / wins : 0;
      const avgLoss = losses > 0 ? grossLoss / losses : 0;

      return {
        count,
        totalPnl,
        grossProfit,
        grossLoss,
        wins,
        losses,
        winRate,
        expValue,
        profitFactor,
        avgWin,
        avgLoss,
      };
    };

    const all = summarize(arr);
    const buy = summarize(
      arr.filter((n) => ((n as any).dir ?? (n as any).direction) === 1)
    );
    const sell = summarize(
      arr.filter((n) => ((n as any).dir ?? (n as any).direction) === -1)
    );

    return {
      all,
      buy,
      sell,
      buys: buy.count,
      sells: sell.count,
    };
  }, [displayNodesRaw, lassoFinal]);

  const countsRaw = (() => {
    // "Live/Normal" = non-library nodes (trades/potential), libraries are tracked separately.
    let liveTotal = 0;
    let liveWins = 0;
    let liveLosses = 0;
    let liveBuys = 0;
    let liveSells = 0;
    let livePotential = 0;
    let liveActive = 0;

    let libraryPts = 0;
    let libWins = 0;
    let libLosses = 0;
    let libBuys = 0;
    let libSells = 0;

    const libraryById: Record<string, number> = {};

    for (const n of displayNodesRaw as any[]) {
      if (!n) continue;

      const dir = n.dir ?? n.direction ?? 0;
      const dirNum = dir === 1 ? 1 : dir === -1 ? -1 : 0;
      const isWin =
        typeof n.win === "boolean" ? !!n.win : Number(n.pnl ?? 0) >= 0;

      const kind = String(n.kind ?? "").toLowerCase();

      // Libraries
      if (kind === "library") {
        libraryPts++;
        const lid = String(n.libId || "unknown");
        libraryById[lid] = (libraryById[lid] || 0) + 1;

        if (dirNum === 1) libBuys++;
        else if (dirNum === -1) libSells++;
        if (isWin) libWins++;
        else libLosses++;
        continue;
      }

      // Suppressed / ghost nodes are hidden from the map now (and don't pollute counts)
      if (kind === "ghost") continue;

      // Live/Normal headline counts should reflect *trade nodes* on the map.
      // (Ignore helper nodes like "close" markers, and keep "potential" separate.)
      if (kind === "potential") {
        livePotential++;
        continue;
      }
      if (kind === "close") {
        continue;
      }
      if (kind !== "trade") {
        continue;
      }

      liveTotal++;
      if (dirNum === 1) liveBuys++;
      else if (dirNum === -1) liveSells++;

      if (n.isOpen) {
        liveActive++;
        continue;
      }

      if (isWin) liveWins++;
      else liveLosses++;
    }

    return {
      total: liveTotal,
      wins: liveWins,
      losses: liveLosses,
      buys: liveBuys,
      sells: liveSells,
      potential: livePotential,
      active: liveActive,
      libraryPts,
      libWins,
      libLosses,
      libBuys,
      libSells,
      libraryById,
    };
  })();

  const [view, setView] = useState({ scale: 1, ox: 600, oy: 280 });
  const viewRef = useRef(view);
  const [isDragging, setIsDragging] = useState(false);

  const computeHeatHover = React.useCallback((wx: number, wy: number) => {
    const hm = heatmapRef.current;
    if (!hm) return null;
    const {
      xMin,
      xMax,
      yMin,
      yMax,
      nx,
      ny,
      cnt,
      wins,
      gp,
      gl,
      tpnl,
      buys,
      sells,
      buyWins,
      buyGp,
      buyGl,
      buyTpnl,
      sellWins,
      sellGp,
      sellGl,
      sellTpnl,
      smooth,
      maxSmooth,
    } = hm || {};
    if (
      !Number.isFinite(xMin) ||
      !Number.isFinite(xMax) ||
      !Number.isFinite(yMin) ||
      !Number.isFinite(yMax)
    )
      return null;
    const dxW = xMax - xMin;
    const dyW = yMax - yMin;
    if (dxW <= 1e-9 || dyW <= 1e-9) return null;
    const fx = (wx - xMin) / dxW;
    const fy = (wy - yMin) / dyW;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
      return {
        count: 0,
        winRate: 0,
        profitFactor: NaN,
        expValue: 0,
        avgWin: 0,
        avgLoss: 0,
        buys: 0,
        sells: 0,
        buyCount: 0,
        buyWinRate: 0,
        buyProfitFactor: NaN,
        buyExpValue: 0,
        buyAvgWin: 0,
        buyAvgLoss: 0,
        sellCount: 0,
        sellWinRate: 0,
        sellProfitFactor: NaN,
        sellExpValue: 0,
        sellAvgWin: 0,
        sellAvgLoss: 0,
        dampness: 0,
      };
    }
    const ix = Math.min(nx - 1, Math.max(0, Math.floor(fx * nx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor(fy * ny)));
    const toIdx = (x: number, y: number) => y * nx + x;

    // Aggregate a small neighborhood (5x5) for smoother hover stats.
    let c = 0;
    let w = 0;
    let gP = 0;
    let gL = 0;
    let tP = 0;

    // Direction-specific neighborhood aggregates.
    let bc = 0;
    let bw = 0;
    let bgP = 0;
    let bgL = 0;
    let btP = 0;

    let sc = 0;
    let sw = 0;
    let sgP = 0;
    let sgL = 0;
    let stP = 0;

    // 5x5 weighted kernel (center-weighted) so the hover feels stable and "smooth".
    for (let oy2 = -2; oy2 <= 2; oy2++) {
      const yy = iy + oy2;
      if (yy < 0 || yy >= ny) continue;
      const wy2 = oy2 === 0 ? 3 : Math.abs(oy2) === 1 ? 2 : 1;
      for (let ox2 = -2; ox2 <= 2; ox2++) {
        const xx = ix + ox2;
        if (xx < 0 || xx >= nx) continue;
        const wx2 = ox2 === 0 ? 3 : Math.abs(ox2) === 1 ? 2 : 1;
        const wgt = wx2 * wy2;

        const id = toIdx(xx, yy);
        const cc = cnt?.[id] || 0;
        if (cc <= 0) continue;

        c += cc * wgt;
        w += (wins?.[id] || 0) * wgt;
        gP += (gp?.[id] || 0) * wgt;
        gL += (gl?.[id] || 0) * wgt;
        tP += (tpnl?.[id] || 0) * wgt;

        const bcc = (buys?.[id] || 0) * wgt;
        const scc = (sells?.[id] || 0) * wgt;
        bc += bcc;
        sc += scc;

        bw += (buyWins?.[id] || 0) * wgt;
        bgP += (buyGp?.[id] || 0) * wgt;
        bgL += (buyGl?.[id] || 0) * wgt;
        btP += (buyTpnl?.[id] || 0) * wgt;

        sw += (sellWins?.[id] || 0) * wgt;
        sgP += (sellGp?.[id] || 0) * wgt;
        sgL += (sellGl?.[id] || 0) * wgt;
        stP += (sellTpnl?.[id] || 0) * wgt;
      }
    }

    const winRate = c > 0 ? w / c : 0;
    const expValue = c > 0 ? tP / c : 0;
    const profitFactor = gL > 0 ? gP / gL : gP > 0 ? Infinity : NaN;

    const buyWinRate = bc > 0 ? bw / bc : 0;
    const buyExpValue = bc > 0 ? btP / bc : 0;
    const buyProfitFactor = bgL > 0 ? bgP / bgL : bgP > 0 ? Infinity : NaN;
    const buyLosses = Math.max(0, bc - bw);
    const buyAvgWin = bw > 0 ? bgP / bw : 0;
    const buyAvgLoss = buyLosses > 0 ? bgL / buyLosses : 0;

    const sellWinRate = sc > 0 ? sw / sc : 0;
    const sellExpValue = sc > 0 ? stP / sc : 0;
    const sellProfitFactor = sgL > 0 ? sgP / sgL : sgP > 0 ? Infinity : NaN;
    const sellLosses = Math.max(0, sc - sw);
    const sellAvgWin = sw > 0 ? sgP / sw : 0;
    const sellAvgLoss = sellLosses > 0 ? sgL / sellLosses : 0;

    const losses0 = Math.max(0, c - w);
    const avgWin = w > 0 ? gP / w : 0;
    const avgLoss = losses0 > 0 ? gL / losses0 : 0;
    const dampBase =
      smooth && maxSmooth > 0 ? (smooth[toIdx(ix, iy)] || 0) / maxSmooth : 0;

    return {
      count: c,
      winRate,
      profitFactor,
      expValue,
      avgWin,
      avgLoss,
      buys: bc,
      sells: sc,
      buyCount: bc,
      buyWinRate,
      buyProfitFactor,
      buyExpValue,
      buyAvgWin,
      buyAvgLoss,
      sellCount: sc,
      sellWinRate,
      sellProfitFactor,
      sellExpValue,
      sellAvgWin,
      sellAvgLoss,
      dampness: Math.min(1, Math.max(0, dampBase)),
    };
  }, []);

  const overlayColorForWr = (wr: number) =>
    wr >= 0.6
      ? "rgba(80,255,150,0.95)"
      : wr <= 0.4
      ? "rgba(255,90,90,0.95)"
      : "rgba(120,190,255,0.95)";

  // (Gaussian mixture overlays removed.)

  const hdbGroupsUI = useMemo(() => {
    const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
    const out: any[] = [];

    // Library: stats precomputed from the clustered (library) points.
    // Live: compute stats from the live trade nodes that landed in each cluster id.
    let liveStatsById: Record<string, any> | null = null;
    if (clusterGroupUniverse === "Live" || clusterGroupUniverse === "All") {
      const init = () => ({
        count: 0,
        wins: 0,
        buys: 0,
        sells: 0,
        sumPnl: 0,
        sumPos: 0,
        sumNeg: 0,
        maxWin: 0,
        maxLoss: 0,

        buyCount: 0,
        buyWins: 0,
        buySumPnl: 0,
        buySumPos: 0,
        buySumNeg: 0,
        buyMaxWin: 0,
        buyMaxLoss: 0,

        sellCount: 0,
        sellWins: 0,
        sellSumPnl: 0,
        sellSumPos: 0,
        sellSumNeg: 0,
        sellMaxWin: 0,
        sellMaxLoss: 0,
      });

      const safeNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const liveTradeNodes = ((displayNodesRaw as any[]) || []).filter(
        (n: any) => {
          const k = String((n as any)?.kind || "").toLowerCase();
          const isTrade = k === "trade";
          const isSuppressedTrade =
            k === "library" &&
            ((n as any)?.metaSuppressed === true ||
              (n as any)?.metaSuppressedTrade === true ||
              (n as any)?.metaIsSuppressedTrade === true ||
              (n as any)?.suppressed === true ||
              String((n as any)?.libId || (n as any)?.library || "")
                .toLowerCase()
                .includes("suppressed"));
          return isTrade || isSuppressedTrade;
        }
      );

      liveStatsById = {};
      for (const n of liveTradeNodes) {
        const cid = Number(
          (n as any).hdbClusterId ??
            (n as any).clusterId ??
            (n as any).closestClusterId ??
            -1
        );
        if (!Number.isFinite(cid) || cid < 0) continue;
        const key = String(cid);
        const st0 = liveStatsById[key] || (liveStatsById[key] = init());

        const pnl =
          typeof (n as any)?.pnl === "number"
            ? (n as any).pnl
            : typeof (n as any)?.closePnl === "number"
            ? (n as any).closePnl
            : typeof (n as any)?.unrealizedPnl === "number"
            ? (n as any).unrealizedPnl
            : 0;

        const dir = Number((n as any)?.dir ?? (n as any)?.direction ?? 0);

        st0.count += 1;
        if (pnl >= 0) st0.wins += 1;
        st0.sumPnl += safeNum(pnl);
        if (pnl >= 0) {
          st0.sumPos += safeNum(pnl);
          if (safeNum(pnl) > (st0.maxWin || 0)) st0.maxWin = safeNum(pnl);
        } else {
          st0.sumNeg += safeNum(pnl);
          if (safeNum(pnl) < (st0.maxLoss || 0)) st0.maxLoss = safeNum(pnl);
        }

        if (dir === 1) {
          st0.buys += 1;
          st0.buyCount += 1;
          if (pnl >= 0) st0.buyWins += 1;
          st0.buySumPnl += safeNum(pnl);
          if (pnl >= 0) {
            st0.buySumPos += safeNum(pnl);
            if (safeNum(pnl) > (st0.buyMaxWin || 0))
              st0.buyMaxWin = safeNum(pnl);
          } else {
            st0.buySumNeg += safeNum(pnl);
            if (safeNum(pnl) < (st0.buyMaxLoss || 0))
              st0.buyMaxLoss = safeNum(pnl);
          }
        } else if (dir === -1) {
          st0.sells += 1;
          st0.sellCount += 1;
          if (pnl >= 0) st0.sellWins += 1;
          st0.sellSumPnl += safeNum(pnl);
          if (pnl >= 0) {
            st0.sellSumPos += safeNum(pnl);
            if (safeNum(pnl) > (st0.sellMaxWin || 0))
              st0.sellMaxWin = safeNum(pnl);
          } else {
            st0.sellSumNeg += safeNum(pnl);
            if (safeNum(pnl) < (st0.sellMaxLoss || 0))
              st0.sellMaxLoss = safeNum(pnl);
          }
        }
      }

      // Finalize derived fields to match the library stats shape.
      for (const k of Object.keys(liveStatsById)) {
        const st = liveStatsById[k];
        const cN = safeNum(st.count);
        const wN = safeNum(st.wins);
        const lN = Math.max(0, cN - wN);

        const bN = safeNum(st.buys);
        const sN = safeNum(st.sells);

        const bcN = safeNum(st.buyCount);
        const bwN = safeNum(st.buyWins);
        const blN = Math.max(0, bcN - bwN);

        const scN = safeNum(st.sellCount);
        const swN = safeNum(st.sellWins);
        const slN = Math.max(0, scN - swN);

        st.losses = lN;
        st.winRate = cN > 0 ? wN / cN : 0;
        st.totalPnl = safeNum(st.sumPnl);
        st.avgPnl = cN > 0 ? safeNum(st.sumPnl) / cN : 0;
        st.avgWin = wN > 0 ? safeNum(st.sumPos) / wN : 0;
        st.avgLoss = lN > 0 ? -safeNum(st.sumNeg) / lN : 0;
        st.payoff =
          lN > 0
            ? wN > 0
              ? safeNum(st.sumPos) /
                Math.max(1, wN) /
                Math.max(1e-9, -safeNum(st.sumNeg) / Math.max(1, lN))
              : 0
            : wN > 0 && safeNum(st.sumPos) > 0
            ? Infinity
            : 0;
        st.winLoss = lN > 0 ? wN / lN : wN > 0 ? Infinity : 0;
        st.profitFactor =
          safeNum(st.sumNeg) < 0
            ? safeNum(st.sumPos) / Math.max(1e-9, -safeNum(st.sumNeg))
            : safeNum(st.sumPos) > 0
            ? Infinity
            : 0;

        st.buyLosses = blN;
        st.buyWinRate = bcN > 0 ? bwN / bcN : 0;
        st.buyTotalPnl = safeNum(st.buySumPnl);
        st.buyAvgPnl = bcN > 0 ? safeNum(st.buySumPnl) / bcN : 0;
        st.buySumPos = safeNum(st.buySumPos);
        st.buySumNeg = safeNum(st.buySumNeg);
        st.buyAvgWin = bwN > 0 ? safeNum(st.buySumPos) / bwN : 0;
        st.buyAvgLoss = blN > 0 ? -safeNum(st.buySumNeg) / blN : 0;
        st.buyProfitFactor =
          safeNum(st.buySumNeg) < 0
            ? safeNum(st.buySumPos) / Math.max(1e-9, -safeNum(st.buySumNeg))
            : safeNum(st.buySumPos) > 0
            ? Infinity
            : 0;

        st.sellLosses = slN;
        st.sellWinRate = scN > 0 ? swN / scN : 0;
        st.sellTotalPnl = safeNum(st.sellSumPnl);
        st.sellAvgPnl = scN > 0 ? safeNum(st.sellSumPnl) / scN : 0;
        st.sellSumPos = safeNum(st.sellSumPos);
        st.sellSumNeg = safeNum(st.sellSumNeg);
        st.sellAvgWin = swN > 0 ? safeNum(st.sellSumPos) / swN : 0;
        st.sellAvgLoss = slN > 0 ? -safeNum(st.sellSumNeg) / slN : 0;
        st.sellProfitFactor =
          safeNum(st.sellSumNeg) < 0
            ? safeNum(st.sellSumPos) / Math.max(1e-9, -safeNum(st.sellSumNeg))
            : safeNum(st.sellSumPos) > 0
            ? Infinity
            : 0;
      }
    }

    for (const c of clArr) {
      const libSt: any = (c as any)?.stats;
      const liveSt: any = liveStatsById?.[String((c as any)?.id)];
      const mergeStats = (a: any, b: any) => {
        if (!a && !b) return null;
        if (!a) return b;
        if (!b) return a;
        const out: any = { ...a };
        const add = (k: string) =>
          (out[k] = (Number(out[k]) || 0) + (Number(b[k]) || 0));
        const max = (k: string) =>
          (out[k] = Math.max(Number(out[k]) || 0, Number(b[k]) || 0));
        const min = (k: string) =>
          (out[k] = Math.min(Number(out[k]) || 0, Number(b[k]) || 0));
        // sums / counts
        [
          "count",
          "wins",
          "buys",
          "sells",
          "sumPnl",
          "sumPos",
          "sumNeg",
          "buyCount",
          "buyWins",
          "buyBuys",
          "buySells",
          "buySumPnl",
          "buySumPos",
          "buySumNeg",
          "sellCount",
          "sellWins",
          "sellBuys",
          "sellSells",
          "sellSumPnl",
          "sellSumPos",
          "sellSumNeg",
        ].forEach(add);
        // extrema
        ["maxWin", "buyMaxWin", "sellMaxWin"].forEach(max);
        ["maxLoss", "buyMaxLoss", "sellMaxLoss"].forEach(min);
        return out;
      };
      const st: any =
        clusterGroupUniverse === "Live"
          ? liveSt
          : clusterGroupUniverse === "All"
          ? mergeStats(libSt, liveSt)
          : libSt;
      if (!st || !Number.isFinite(Number(st.count)) || Number(st.count) <= 0)
        continue;
      const buys = Number(st.buys) || 0;
      const sells = Number(st.sells) || 0;

      // Mode-aware stats (All vs Buy vs Sell) so labels/colors match the current view.
      const ms = pickClusterGroupStats(st, clusterGroupStatsMode);
      const count = Number(ms.count) || 0;
      const wins = Number(ms.wins) || 0;
      const losses = Number(ms.losses) || 0;
      const wr = Number(ms.winRate) || 0;
      out.push({
        key: "hdb-" + String((c as any).id),
        type: "hdb",
        id: Number((c as any).id),
        label: `HDB ${String((c as any).id)} · WR ${(wr * 100).toFixed(
          1
        )}% (n=${count})`,
        winRate: wr,
        count,
        wins,
        losses,
        buys,
        sells,
        buyCount: Number((st as any).buyCount) || 0,
        buyWins: Number((st as any).buyWins) || 0,
        buyLosses: Number.isFinite(Number((st as any).buyLosses))
          ? Number((st as any).buyLosses)
          : Math.max(
              0,
              (Number((st as any).buyCount) || 0) -
                (Number((st as any).buyWins) || 0)
            ),
        buyWinRate: Number((st as any).buyWinRate) || 0,
        buyProfitFactor: Number.isFinite(Number((st as any).buyProfitFactor))
          ? Number((st as any).buyProfitFactor)
          : (st as any).buyProfitFactor === Infinity
          ? Infinity
          : 0,
        buyAvgPnl: Number((st as any).buyAvgPnl) || 0,
        buyAvgWin: Number((st as any).buyAvgWin) || 0,
        buyAvgLoss: Number((st as any).buyAvgLoss) || 0,

        sellCount: Number((st as any).sellCount) || 0,
        sellWins: Number((st as any).sellWins) || 0,
        sellLosses: Number.isFinite(Number((st as any).sellLosses))
          ? Number((st as any).sellLosses)
          : Math.max(
              0,
              (Number((st as any).sellCount) || 0) -
                (Number((st as any).sellWins) || 0)
            ),
        sellWinRate: Number((st as any).sellWinRate) || 0,
        sellProfitFactor: Number.isFinite(Number((st as any).sellProfitFactor))
          ? Number((st as any).sellProfitFactor)
          : (st as any).sellProfitFactor === Infinity
          ? Infinity
          : 0,
        sellAvgPnl: Number((st as any).sellAvgPnl) || 0,
        sellAvgWin: Number((st as any).sellAvgWin) || 0,
        sellAvgLoss: Number((st as any).sellAvgLoss) || 0,
        totalPnl: Number(st.totalPnl) || 0,
        avgPnl: Number(st.avgPnl) || 0,
        profitFactor: Number.isFinite(Number(st.profitFactor))
          ? Number(st.profitFactor)
          : Number(st.profitFactor) === Infinity
          ? Infinity
          : 0,
        sumPos: Number(st.sumPos) || 0,
        sumNeg: Number(st.sumNeg) || 0,
        avgWin: Number(st.avgWin) || 0,
        avgLoss: Number(st.avgLoss) || 0,
        maxWin: Number(st.maxWin) || 0,
        maxLoss: Number(st.maxLoss) || 0,
        payoff: Number.isFinite(Number(st.payoff))
          ? Number(st.payoff)
          : st.payoff === Infinity
          ? Infinity
          : 0,
        winLoss: Number.isFinite(Number(st.winLoss))
          ? Number(st.winLoss)
          : st.winLoss === Infinity
          ? Infinity
          : 0,
      });
    }
    out.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    return out;
  }, [
    hdbOverlay,
    clusterGroupStatsMode,
    clusterGroupUniverse,
    displayNodesRaw,
  ]);

  const groupRowsUI = useMemo(() => {
    const rows: any[] = [];
    for (const r of (hdbGroupsUI as any[]) || []) rows.push(r);
    return rows;
  }, [hdbGroupsUI]);

  const [groupSort, setGroupSort] = useState<{
    key: string;
    dir: "asc" | "desc";
  }>({
    key: "count",
    dir: "desc",
  });

  function pickClusterGroupStats(st: any, mode: "All" | "Buy" | "Sell") {
    const m = mode || "All";
    const safeNum = (v: any) => {
      if (v === Infinity) return Infinity;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    if (m === "Buy") {
      const count = safeNum(st?.buyCount ?? st?.buys ?? 0);
      const wins = safeNum(st?.buyWins ?? 0);
      const losses = Number.isFinite(Number(st?.buyLosses))
        ? safeNum(st?.buyLosses)
        : Math.max(0, count - wins);
      const winRate = Number.isFinite(Number(st?.buyWinRate))
        ? safeNum(st?.buyWinRate)
        : count > 0
        ? wins / Math.max(1, count)
        : 0;
      const totalPnl = safeNum(
        st?.buyTotalPnl ?? safeNum(st?.buyAvgPnl) * count
      );
      const avgPnl = Number.isFinite(Number(st?.buyAvgPnl))
        ? safeNum(st?.buyAvgPnl)
        : count > 0
        ? totalPnl / Math.max(1, count)
        : 0;
      const avgWin = safeNum(st?.buyAvgWin ?? 0);
      const avgLoss = safeNum(st?.buyAvgLoss ?? 0);
      const profitFactor =
        st?.buyProfitFactor === Infinity
          ? Infinity
          : Number.isFinite(Number(st?.buyProfitFactor))
          ? safeNum(st?.buyProfitFactor)
          : 0;
      const payoff =
        avgLoss > 0
          ? avgWin / Math.max(1e-9, avgLoss)
          : avgWin > 0
          ? Infinity
          : 0;
      const maxWin = safeNum(st?.buyMaxWin ?? 0);
      const maxLoss = safeNum(st?.buyMaxLoss ?? 0);
      return {
        count,
        wins,
        losses,
        winRate,
        totalPnl,
        avgPnl,
        avgWin,
        avgLoss,
        profitFactor,
        payoff,
        maxWin,
        maxLoss,
      };
    }
    if (m === "Sell") {
      const count = safeNum(st?.sellCount ?? st?.sells ?? 0);
      const wins = safeNum(st?.sellWins ?? 0);
      const losses = Number.isFinite(Number(st?.sellLosses))
        ? safeNum(st?.sellLosses)
        : Math.max(0, count - wins);
      const winRate = Number.isFinite(Number(st?.sellWinRate))
        ? safeNum(st?.sellWinRate)
        : count > 0
        ? wins / Math.max(1, count)
        : 0;
      const totalPnl = safeNum(
        st?.sellTotalPnl ?? safeNum(st?.sellAvgPnl) * count
      );
      const avgPnl = Number.isFinite(Number(st?.sellAvgPnl))
        ? safeNum(st?.sellAvgPnl)
        : count > 0
        ? totalPnl / Math.max(1, count)
        : 0;
      const avgWin = safeNum(st?.sellAvgWin ?? 0);
      const avgLoss = safeNum(st?.sellAvgLoss ?? 0);
      const profitFactor =
        st?.sellProfitFactor === Infinity
          ? Infinity
          : Number.isFinite(Number(st?.sellProfitFactor))
          ? safeNum(st?.sellProfitFactor)
          : 0;
      const payoff =
        avgLoss > 0
          ? avgWin / Math.max(1e-9, avgLoss)
          : avgWin > 0
          ? Infinity
          : 0;
      const maxWin = safeNum(st?.sellMaxWin ?? 0);
      const maxLoss = safeNum(st?.sellMaxLoss ?? 0);
      return {
        count,
        wins,
        losses,
        winRate,
        totalPnl,
        avgPnl,
        avgWin,
        avgLoss,
        profitFactor,
        payoff,
        maxWin,
        maxLoss,
      };
    }

    // All
    const count = safeNum(st?.count ?? 0);
    const wins = safeNum(st?.wins ?? 0);
    const losses = Number.isFinite(Number(st?.losses))
      ? safeNum(st?.losses)
      : Math.max(0, count - wins);
    const winRate = Number.isFinite(Number(st?.winRate))
      ? safeNum(st?.winRate)
      : count > 0
      ? wins / Math.max(1, count)
      : 0;
    const totalPnl = safeNum(st?.totalPnl ?? 0);
    const avgPnl = Number.isFinite(Number(st?.avgPnl))
      ? safeNum(st?.avgPnl)
      : count > 0
      ? totalPnl / Math.max(1, count)
      : 0;
    const avgWin = safeNum(st?.avgWin ?? 0);
    const avgLoss = safeNum(st?.avgLoss ?? 0);
    const profitFactor =
      st?.profitFactor === Infinity
        ? Infinity
        : Number.isFinite(Number(st?.profitFactor))
        ? safeNum(st?.profitFactor)
        : 0;
    const payoff =
      st?.payoff === Infinity
        ? Infinity
        : Number.isFinite(Number(st?.payoff))
        ? safeNum(st?.payoff)
        : avgLoss > 0
        ? avgWin / Math.max(1e-9, avgLoss)
        : avgWin > 0
        ? Infinity
        : 0;
    const maxWin = safeNum(st?.maxWin ?? 0);
    const maxLoss = safeNum(st?.maxLoss ?? 0);
    return {
      count,
      wins,
      losses,
      winRate,
      totalPnl,
      avgPnl,
      avgWin,
      avgLoss,
      profitFactor,
      payoff,
      maxWin,
      maxLoss,
    };
  }

  const sortedGroupRowsUI = useMemo(() => {
    const rows = ((groupRowsUI as any[]) || []).slice();
    const key = (groupSort as any)?.key || "count";
    const dir = (groupSort as any)?.dir === "asc" ? 1 : -1;

    const toNum = (v: any) => {
      if (v === Infinity) return 1e18;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const getVal = (r: any) => {
      const ms = pickClusterGroupStats(r, clusterGroupStatsMode);
      switch (key) {
        case "group":
          return 0;
        case "id":
          return toNum(r.id);
        case "winRate":
          return toNum(ms.winRate);
        case "count":
          return toNum(ms.count);
        case "wins":
          return toNum(ms.wins);
        case "losses":
          return toNum(ms.losses);
        case "buys":
        case "sells":
          return toNum((r as any)[key]);
        case "totalPnl":
          return toNum(ms.totalPnl);
        case "avgPnl":
          return toNum(ms.avgPnl);
        case "avgWin":
          return toNum(ms.avgWin);
        case "avgLoss":
          return toNum(ms.avgLoss);
        case "profitFactor":
          return toNum(ms.profitFactor);
        case "payoff":
          return toNum(ms.payoff);
        case "maxWin":
          return toNum(ms.maxWin);
        case "maxLoss":
          return toNum(ms.maxLoss);
        default:
          return toNum((r as any)[key]);
      }
    };

    rows.sort((a: any, b: any) => {
      let va = getVal(a);
      let vb = getVal(b);

      // Group is now a single type (HDBSCAN only).
      if (key === "group") {
        const ida = toNum(a.id);
        const idb = toNum(b.id);
        if (ida !== idb) return dir * (ida - idb);
        return String(a.key || "").localeCompare(String(b.key || ""));
      }

      if (va !== vb) return dir * (va - vb);
      // Tie-breakers: larger count first, then stable key
      const ca = toNum(pickClusterGroupStats(a, clusterGroupStatsMode).count);
      const cb = toNum(pickClusterGroupStats(b, clusterGroupStatsMode).count);
      if (ca !== cb) return -1 * (ca - cb);
      return String(a.key || "hdb-" + a.id).localeCompare(
        String(b.key || "hdb-" + b.id)
      );
    });

    return rows;
  }, [groupRowsUI, groupSort, clusterGroupStatsMode]);

  const currentGroupHit = useMemo(() => {
    // "Current candle" group = the group containing the current query node (Potential/Open/Live) if present.
    const nodes0: any[] = (displayNodesRaw as any[]) || [];
    const n0 =
      nodes0.find((n) => n && n.isPotential) ||
      nodes0.find((n) => n && n.isOpen) ||
      nodes0.find((n) => n && n.isLive) ||
      null;
    if (!n0) return null;

    const x = Number((n0 as any).x);
    const y = Number((n0 as any).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const pointInPolyWorld = (
      px: number,
      py: number,
      poly: [number, number][]
    ) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0],
          yi = poly[i][1];
        const xj = poly[j][0],
          yj = poly[j][1];
        const intersect =
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // Prefer HDB hull membership if present
    const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
    for (const c of clArr) {
      const hull =
        c && (c as any).hull ? ((c as any).hull as [number, number][]) : null;
      if (!hull || hull.length < 3) continue;

      // Expand hull slightly in world space so the highlight matches the visual stroke padding.
      let cx = 0,
        cy = 0;
      for (const p of hull) {
        cx += p[0];
        cy += p[1];
      }
      cx /= hull.length;
      cy /= hull.length;
      const exp = hull.map((p) => {
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        return [cx + dx * 1.08, cy + dy * 1.08] as [number, number];
      });

      if (pointInPolyWorld(x, y, exp))
        return { type: "hdb", id: Number((c as any).id) };
    }

    return null;
  }, [displayNodesRaw, hdbOverlay, showGroupOverlays]);

  const currentHdbClusterStats = useMemo(() => {
    if (aiMethod !== "hdbscan") return null;
    if (!currentGroupHit || (currentGroupHit as any).type !== "hdb")
      return null;
    const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
    const cid = Number((currentGroupHit as any).id);
    for (const c of clArr) {
      if (Number((c as any).id) === cid) return (c as any)?.stats || null;
    }
    return null;
  }, [aiMethod, currentGroupHit, hdbOverlay]);

  const pointInPolyWorld = React.useCallback(
    (px: number, py: number, poly: [number, number][]) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0],
          yi = poly[i][1];
        const xj = poly[j][0],
          yj = poly[j][1];
        const intersect =
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    },
    []
  );

  const hdbConfidenceClusters = useMemo(() => {
    const out: any[] = [];
    if (aiMethod !== "hdbscan") return out;
    const clArr: any[] = ((hdbOverlay as any)?.clusters as any[]) || [];
    for (const c of clArr) {
      const hull =
        c && (c as any).hull ? ((c as any).hull as [number, number][]) : null;
      if (!hull || hull.length < 3) continue;

      // Expand hull slightly (matches overlay stroke padding) so membership feels consistent.
      let cx = 0,
        cy = 0;
      for (const p of hull) {
        cx += p[0];
        cy += p[1];
      }
      cx /= hull.length;
      cy /= hull.length;

      const poly = hull.map((p) => {
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        return [cx + dx * 1.08, cy + dy * 1.08] as [number, number];
      });

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const p of poly) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }

      out.push({
        id: Number((c as any).id),
        poly,
        minX,
        maxX,
        minY,
        maxY,
        stats: (c as any)?.stats || null,
      });
    }
    return out;
  }, [aiMethod, hdbOverlay]);

  // Active AI modalities selected by the user (UI-side).
  // NOTE: The backtest/runtime engine also has its own modality set, but that one is not in scope here.
  const activeModSet = useMemo(
    () => new Set<string>((aiModalities as any) || []),
    [aiModalities]
  );

  const hdbConfidenceForNode = React.useCallback(
    (n: any) => {
      if (!n) return 0.01;

      // Potential nodes use their own margin.
      if ((n as any).kind === "potential") {
        const pm = Number((n as any).potentialMargin);
        return Number.isFinite(pm) ? clamp(pm, 0, 1) : 0;
      }

      // Non-HDBSCAN modes: keep the existing confidence signal.
      if (aiMethod !== "hdbscan") {
        const em = Number((n as any).entryMargin);
        if (Number.isFinite(em)) return clamp(em, 0, 1);
        const pm = Number((n as any).potentialMargin);
        if (Number.isFinite(pm)) return clamp(pm, 0, 1);
        return 0;
      }

      // HDBSCAN mode: confidence = win rate of the cluster group the node falls into.
      // If it's "noise" (not in any group hull), confidence = 1%.
      const x = Number((n as any).x);
      const y = Number((n as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 0.01;

      const dir = Number((n as any).dir ?? (n as any).direction ?? 0);

      for (const c of hdbConfidenceClusters as any[]) {
        if (!c || !c.poly) continue;
        if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue;
        if (!pointInPolyWorld(x, y, c.poly)) continue;

        const st: any = c.stats || {};
        let wr = Number(st?.winRate);

        // Use direction-specific win rate ONLY when the Direction modality is enabled.
        // Otherwise, keep the cluster's overall winRate.
        if (activeModSet && activeModSet.has("Direction")) {
          if (dir === 1) {
            const bc = Number(st?.buyCount ?? st?.buys ?? 0);
            const bwr = Number(st?.buyWinRate);
            if (Number.isFinite(bwr) && bc > 0) wr = bwr;
          } else if (dir === -1) {
            const sc = Number(st?.sellCount ?? st?.sells ?? 0);
            const swr = Number(st?.sellWinRate);
            if (Number.isFinite(swr) && sc > 0) wr = swr;
          }
        }

        if (!Number.isFinite(wr)) {
          const wins = Number(st?.wins);
          const count = Number(st?.count);
          if (Number.isFinite(wins) && Number.isFinite(count) && count > 0) {
            wr = wins / Math.max(1, count);
          }
        }

        if (!Number.isFinite(wr)) wr = 0;
        return clamp(wr, 0, 1);
      }

      // Noise
      return 0.01;
    },
    [aiMethod, hdbConfidenceClusters, pointInPolyWorld, activeModSet]
  );

  const gateConfidenceForNode = React.useCallback((n: any): number | null => {
    if (!n) return null;
    const raw =
      (n as any).entryMargin ??
      (n as any).aiMargin ??
      (n as any).entryConfidence ??
      (n as any).aiConfidence ??
      (n as any).potentialMargin ??
      (n as any).confidence ??
      (n as any).margin ??
      null;

    const v = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(v) ? clamp(v, 0, 1) : null;
  }, []);

  const hdbClusterInfoForNode = React.useCallback(
    (n: any): { wr: number; clusterId: number | null } | null => {
      if (!n || aiMethod !== "hdbscan") return null;

      // Noise (not in any hull) => 1% with unknown cluster id.
      const x = Number((n as any).x);
      const y = Number((n as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { wr: 0.01, clusterId: null };
      }

      const dir = Number((n as any).dir ?? (n as any).direction ?? 0);

      for (const c of hdbConfidenceClusters as any[]) {
        if (!c || !c.poly) continue;
        if (x < c.minX || x > c.maxX || y < c.minY || y > c.maxY) continue;
        if (!pointInPolyWorld(x, y, c.poly)) continue;

        const st: any = c.stats || {};
        let wr = Number(st?.winRate);

        // Use direction-specific win rate ONLY when the Direction modality is enabled.
        if (activeModSet && activeModSet.has("Direction")) {
          if (dir === 1) {
            const bc = Number(st?.buyCount ?? st?.buys ?? 0);
            const bwr = Number(st?.buyWinRate);
            if (Number.isFinite(bwr) && bc > 0) wr = bwr;
          } else if (dir === -1) {
            const sc = Number(st?.sellCount ?? st?.sells ?? 0);
            const swr = Number(st?.sellWinRate);
            if (Number.isFinite(swr) && sc > 0) wr = swr;
          }
        }

        if (!Number.isFinite(wr)) {
          const wins = Number(st?.wins);
          const count = Number(st?.count);
          if (Number.isFinite(wins) && Number.isFinite(count) && count > 0) {
            wr = wins / Math.max(1, count);
          }
        }

        if (!Number.isFinite(wr)) wr = 0;

        const cidRaw = Number((c as any).id);
        const cid = Number.isFinite(cidRaw) ? cidRaw : null;
        return { wr: clamp(wr, 0, 1), clusterId: cid };
      }

      return { wr: 0.01, clusterId: null };
    },
    [aiMethod, hdbConfidenceClusters, pointInPolyWorld, activeModSet]
  );

  // --- HDBSCAN post-hoc entry pass: determine entries purely from cluster win-rate (no gate)
  // In HDBSCAN mode we *replace* nodes that change category with brand-new objects:
  //   - Promoted: library -> trade (new id/uid/tradeUid and scrubbed library/suppression identity)
  //   - Demoted: trade -> suppressed library (new id/uid and scrubbed trade identity)
  // This prevents post-hoc nodes from retaining their original library/trade identity.

  // Recompute visibility filtering using the cheated node list (so turning off the library toggle still shows converted trades).
  const displayNodes = useMemo(() => {
    const out: any[] = [];
    const seenTradeKeys = new Set<string>();
    const tradeKey = (n: any) =>
      String(
        (n as any)?.uid ??
          (n as any)?.tradeUid ??
          (n as any)?.tradeId ??
          (n as any)?.id ??
          (n as any)?.metaOrigUid ??
          (n as any)?.metaOrigId ??
          ""
      );
    for (const n of timelineNodesCheat as any[]) {
      const categories: string[] = [];

      if ((n as any).kind === "library") {
        const lk = `lib:${String((n as any).libId || "unknown")}`;
        categories.push(lk);
      } else if ((n as any).kind === "potential") {
        categories.push("potential");
      } else if ((n as any).kind === "close") {
        categories.push("close");
      } else {
        if ((n as any).isOpen) {
          categories.push("active");
        } else {
          categories.push((n as any).win ? "closedWin" : "closedLoss");
        }
      }

      let visible = true;
      for (const c of categories) {
        if ((legendToggles as any)[c] === false) {
          visible = false;
          break;
        }
      }
      if (!visible) continue;

      // De-dupe trade-shaped nodes by stable trade identity so the map doesn't double-count.
      if (String((n as any).kind || "").toLowerCase() === "trade") {
        const k = tradeKey(n);
        if (k) {
          if (seenTradeKeys.has(k)) continue;
          seenTradeKeys.add(k);
        }
      }

      out.push(n);
    }
    return out;
  }, [timelineNodesCheat, legendToggles]);

  // Post-hoc trade list (used by parent so all stats/views match the Cluster Map).
  // NOTE: Includes open + closed trades; parent can filter as needed.
  // Post-hoc trade list (used by parent so all stats/views match the Cluster Map).
  // NOTE: Includes open + closed trades; parent can filter as needed.
  // IMPORTANT: De-duped by stable trade identity so we don't double-count the same trade.
  const postHocTrades = useMemo(() => {
    const src: any[] =
      aiMethod === "hdbscan"
        ? (timelineNodesCheat as any[]) || []
        : (timelineNodes as any[]) || [];

    const tradeKey = (n: any) =>
      String(
        (n as any)?.uid ??
          (n as any)?.tradeUid ??
          (n as any)?.tradeId ??
          (n as any)?.id ??
          (n as any)?.metaOrigUid ??
          (n as any)?.metaOrigId ??
          ""
      );

    const bestByKey = new Map<string, any>();

    for (const n of src) {
      if (!n) continue;
      const kind = String((n as any).kind || "trade").toLowerCase();
      if (kind !== "trade") continue;

      // Not real trades (visual-only) must never leak into history/stats.
      if ((n as any).metaFromLibrary) continue;

      // "Exit by Library" isn't a real exit/trade lifecycle event in this app.
      const exitReasonTag = String((n as any).exitReason ?? "").toLowerCase();
      const exitByTag = String(
        (n as any).exitBy ?? (n as any).exitMethod ?? ""
      ).toLowerCase();
      if (exitReasonTag === "library" || exitByTag === "library") continue;

      const k = tradeKey(n);
      if (!k) continue;

      const prev = bestByKey.get(k);
      if (!prev) {
        bestByKey.set(k, n);
        continue;
      }

      // Prefer CLOSED over OPEN if duplicates exist.
      const prevOpen = !!(prev as any).isOpen;
      const curOpen = !!(n as any).isOpen;
      if (prevOpen && !curOpen) {
        bestByKey.set(k, n);
        continue;
      }
      if (!prevOpen && curOpen) continue;

      // If both same open/closed state, keep the one with the later exit time (or entry time).
      const prevT =
        new Date(
          (prev as any).exitTime ??
            (prev as any).entryTime ??
            (prev as any).time ??
            0
        ).getTime() || 0;
      const curT =
        new Date(
          (n as any).exitTime ?? (n as any).entryTime ?? (n as any).time ?? 0
        ).getTime() || 0;
      if (curT >= prevT) bestByKey.set(k, n);
    }

    return Array.from(bestByKey.values());
  }, [aiMethod, timelineNodesCheat, timelineNodes]);
  const postHocTradesRanged = useMemo(() => {
    const start = statsDateStart ? new Date(statsDateStart).getTime() : null;
    const end = statsDateEnd ? new Date(statsDateEnd).getTime() : null;
    if (!start && !end) return postHocTrades;

    const out: any[] = [];
    for (const t of postHocTrades as any[]) {
      const etRaw =
        (t as any).entryTime ??
        (t as any).entry ??
        (t as any).time ??
        (t as any).timestamp;
      const et = etRaw ? new Date(etRaw).getTime() : null;
      if (!et || !Number.isFinite(et)) continue;
      if (start && et < start) continue;
      if (end && et > end) continue;
      out.push(t);
    }
    return out;
  }, [postHocTrades, statsDateStart, statsDateEnd]);

  const countsStats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let buys = 0;
    let sells = 0;

    for (const t of postHocTradesRanged as any[]) {
      if (!t) continue;
      const dir = (t as any).dir ?? (t as any).direction ?? 0;
      const dirNum = dir === 1 ? 1 : dir === -1 ? -1 : 0;
      if (dirNum === 1) buys++;
      else if (dirNum === -1) sells++;

      const isWin =
        typeof (t as any).win === "boolean"
          ? !!(t as any).win
          : typeof (t as any).pnl === "number"
          ? (t as any).pnl > 0
          : typeof (t as any).pnlUsd === "number"
          ? (t as any).pnlUsd > 0
          : false;

      if (isWin) wins++;
      else losses++;
    }

    return {
      total: wins + losses,
      wins,
      losses,
      buys,
      sells,
      potential: 0,
      active: 0,
    };
  }, [postHocTradesRanged]);

  // Report post-hoc processing progress to the top progress bar (App)
  useEffect(() => {
    if (aiMethod !== "hdbscan") return;
    if (typeof onPostHocProgress !== "function") return;
    onPostHocProgress("Post-hoc processing", 0);
    const t = setTimeout(() => {
      onPostHocProgress("Post-hoc processing", 1, true);
    }, 0);
    return () => clearTimeout(t);
  }, [aiMethod, confidenceThreshold, timelineNodesCheat, timelineNodes]);

  useEffect(() => {
    if (typeof onPostHocTrades !== "function") return;
    onPostHocTrades(postHocTrades);
  }, [onPostHocTrades, postHocTrades]);

  const mitMap = useMemo(() => {
    // MIT: for each *live* trade (and suppressed trade), find the closest *library trade* in embedded 2D space.
    // Library trade candidates are library nodes that look like trades (have entry fields) and are not Base Seeding.
    const out = new Map<string, any>();
    const src = (timelineNodesCheat as any[]) || [];
    if (!src.length) return out;

    const stableKey = (n: any) =>
      String(
        (n as any)?.uid ??
          (n as any)?.tradeUid ??
          (n as any)?.tradeId ??
          (n as any)?.id ??
          (n as any)?.metaOrigUid ??
          (n as any)?.metaOrigId ??
          ""
      );

    const libLabel = (n: any) =>
      String(
        (n as any)?.library ??
          (n as any)?.libraryName ??
          (n as any)?.libId ??
          (n as any)?.metaLibId ??
          (n as any)?.metaLibrary ??
          ""
      )
        .toLowerCase()
        .trim();

    const looksTradeLike = (n: any) =>
      n &&
      ((n as any).entryIndex != null ||
        (n as any).entryTime != null ||
        (n as any).entryTs != null ||
        (n as any).entryTimestamp != null ||
        (n as any).entryDate != null);

    const isTradesLibraryCandidate = (n: any) => {
      if (!n) return false;
      if (String((n as any).kind || "").toLowerCase() !== "library")
        return false;

      const x = Number((n as any).x);
      const y = Number((n as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      const lib = libLabel(n);

      // Never allow Base Seeding.
      if (
        lib.includes("base seeding") ||
        lib.includes("baseseed") ||
        lib.includes("base_seed")
      )
        return false;

      // Prefer explicit Trades library labeling if present...
      if (lib === "trades" || lib.includes("trades") || lib.includes("trade"))
        return looksTradeLike(n);

      // ...but if the dataset doesn't label it cleanly, fall back to any non-base library point that looks like a trade.
      return looksTradeLike(n);
    };

    // Candidate MIT library trades (unfiltered; relies on the embedded pool that includes positions).
    const libsPreferred = src.filter(isTradesLibraryCandidate);
    const libsFallback = src.filter(
      (n: any) =>
        String((n as any).kind || "").toLowerCase() === "library" &&
        looksTradeLike(n) &&
        Number.isFinite(Number((n as any).x)) &&
        Number.isFinite(Number((n as any).y)) &&
        !libLabel(n).includes("base seeding") &&
        !libLabel(n).includes("baseseed") &&
        !libLabel(n).includes("base_seed")
    );
    const libs = libsPreferred.length ? libsPreferred : libsFallback;
    if (!libs.length) return out;

    const isSuppressedTrade = (n: any) => {
      if (!n) return false;
      if (String((n as any).kind || "").toLowerCase() !== "library")
        return false;
      return Boolean(
        (n as any).suppressed ||
          (n as any).metaSuppressed ||
          (n as any).metaIsSuppressedTrade ||
          (n as any).metaSuppressedTrade
      );
    };

    const isLiveTrade = (n: any) => {
      if (!n) return false;
      if (String((n as any).kind || "").toLowerCase() !== "trade") return false;
      const sc = String(
        (n as any).scope ?? (n as any).metaScope ?? "live"
      ).toLowerCase();
      return sc === "live";
    };

    const addKey = (k: any, mit: any) => {
      const kk = k == null ? "" : String(k);
      if (!kk) return;
      if (!out.has(kk)) out.set(kk, mit);
    };

    const targets = src.filter((n: any) => {
      if (!(isLiveTrade(n) || isSuppressedTrade(n))) return false;
      const x = Number((n as any).x);
      const y = Number((n as any).y);
      return Number.isFinite(x) && Number.isFinite(y);
    });

    for (const n of targets) {
      const nx = Number((n as any).x);
      const ny = Number((n as any).y);

      let best: any = null;
      let bestD = Infinity;

      for (const c of libs) {
        const cx = Number((c as any).x);
        const cy = Number((c as any).y);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const dx = nx - cx;
        const dy = ny - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = c;
        }
      }

      if (!best) continue;

      // Map all stable ids for lookup consistency.
      addKey(stableKey(n), best);
      addKey((n as any).uid, best);
      addKey((n as any).tradeUid, best);
      addKey((n as any).tradeId, best);
      addKey((n as any).id, best);
      addKey((n as any).metaOrigUid, best);
      addKey((n as any).metaOrigId, best);
    }

    return out;
  }, [timelineNodesCheat]);

  useEffect(() => {
    if (typeof onMitMap !== "function") return;
    onMitMap(mitMap);
  }, [onMitMap, mitMap]);

  // Cheated versions of derived lookups/stats (used throughout the UI below)
  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return (
      (displayNodes as any[]).find((n: any) => n && n.id === selectedId) || null
    );
  }, [displayNodes, selectedId]);

  const nodeById = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of displayNodes as any[]) {
      if (!n || !(n as any).id) continue;
      m.set(String((n as any).id), n);
    }
    return m;
  }, [displayNodes]);

  // User-facing selection stats should reflect exactly what the map is showing.
  // In HDBSCAN mode this includes post-hoc promotion/demotion.
  const boxStats = useMemo(() => {
    if (!boxRect) return null;
    const { x0, y0, x1, y1 } = boxRect;
    const picked = (displayNodes as any[]).filter(
      (n) => n && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1
    );
    // Only count actual trade nodes in user-facing selection stats.
    // (The map can also render helper nodes like kind:"close"; those must not double-count trades.)
    const pickedTrades = picked.filter(
      (n: any) => String((n as any).kind || "trade").toLowerCase() === "trade"
    );

    const summarize = (list: any[]) => {
      let count = 0;
      let totalPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let wins = 0;

      for (const n of list) {
        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;
        count++;
        totalPnl += pnl;

        const hasWin = typeof (n as any).win === "boolean";
        const isWin = hasWin ? !!(n as any).win : pnl >= 0;
        if (isWin) {
          wins++;
          if (pnl > 0) grossProfit += pnl;
        } else {
          if (pnl < 0) grossLoss += Math.abs(pnl);
        }
      }

      const losses = Math.max(0, count - wins);
      const winRate = count > 0 ? wins / count : 0;
      const expValue = count > 0 ? totalPnl / count : 0;
      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
          ? Infinity
          : NaN;
      const avgWin = wins > 0 ? grossProfit / wins : 0;
      const avgLoss = losses > 0 ? grossLoss / losses : 0;

      return {
        count,
        totalPnl,
        grossProfit,
        grossLoss,
        wins,
        losses,
        winRate,
        expValue,
        profitFactor,
        avgWin,
        avgLoss,
      };
    };

    const all = summarize(pickedTrades);
    const buy = summarize(
      pickedTrades.filter((n) => ((n as any).dir ?? (n as any).direction) === 1)
    );
    const sell = summarize(
      pickedTrades.filter(
        (n) => ((n as any).dir ?? (n as any).direction) === -1
      )
    );

    return { all, buy, sell, buys: buy.count, sells: sell.count };
  }, [boxRect, displayNodes]);

  const lassoStats = useMemo(() => {
    const poly = lassoFinal;
    if (!poly || poly.length < 3) return null;

    const pointInPoly = (
      x: number,
      y: number,
      pts: { x: number; y: number }[]
    ) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x,
          yi = pts[i].y;
        const xj = pts[j].x,
          yj = pts[j].y;
        const intersect =
          yi > y !== yj > y &&
          x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const picked = (displayNodes as any[]).filter(
      (n) => n && pointInPoly(n.x, n.y, poly)
    );
    // Only count actual trade nodes in user-facing selection stats.
    const pickedTrades = picked.filter(
      (n: any) => String((n as any).kind || "trade").toLowerCase() === "trade"
    );

    const summarize = (list: any[]) => {
      let count = 0;
      let totalPnl = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let wins = 0;

      for (const n of list) {
        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;
        count++;
        totalPnl += pnl;

        const hasWin = typeof (n as any).win === "boolean";
        const isWin = hasWin ? !!(n as any).win : pnl >= 0;
        if (isWin) {
          wins++;
          if (pnl > 0) grossProfit += pnl;
        } else {
          if (pnl < 0) grossLoss += Math.abs(pnl);
        }
      }

      const losses = Math.max(0, count - wins);
      const winRate = count > 0 ? wins / count : 0;
      const expValue = count > 0 ? totalPnl / count : 0;
      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
          ? Infinity
          : NaN;
      const avgWin = wins > 0 ? grossProfit / wins : 0;
      const avgLoss = losses > 0 ? grossLoss / losses : 0;

      return {
        count,
        totalPnl,
        grossProfit,
        grossLoss,
        wins,
        losses,
        winRate,
        expValue,
        profitFactor,
        avgWin,
        avgLoss,
      };
    };

    const all = summarize(pickedTrades);
    const buy = summarize(
      pickedTrades.filter((n) => ((n as any).dir ?? (n as any).direction) === 1)
    );
    const sell = summarize(
      pickedTrades.filter(
        (n) => ((n as any).dir ?? (n as any).direction) === -1
      )
    );

    return { all, buy, sell, buys: buy.count, sells: sell.count };
  }, [displayNodes, lassoFinal]);

  const counts = useMemo(() => {
    // "Live/Normal" = non-library nodes (trades/potential), libraries are tracked separately.
    let liveTotal = 0;
    let liveWins = 0;
    let liveLosses = 0;
    let liveBuys = 0;
    let liveSells = 0;
    let livePotential = 0;
    let liveActive = 0;

    let libraryPts = 0;
    let libWins = 0;
    let libLosses = 0;
    let libBuys = 0;
    let libSells = 0;

    const libraryById: Record<string, number> = {};

    for (const n of displayNodes as any[]) {
      if (!n) continue;
      const kind = String((n as any).kind || "trade").toLowerCase();

      if (kind === "library") {
        libraryPts++;
        const lid = String((n as any).libId || (n as any).metaLib || "unknown");
        libraryById[lid] = (libraryById[lid] || 0) + 1;

        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;

        const win = pnl >= 0;
        if (win) libWins++;
        else libLosses++;

        const d = Number((n as any).dir ?? (n as any).direction ?? 0);
        if (d === 1) libBuys++;
        else if (d === -1) libSells++;
        continue;
      }

      // Live/normal (includes converted trades)
      if (kind === "potential") {
        livePotential++;
        liveTotal++;
        continue;
      }
      if (kind === "close") continue;

      liveTotal++;
      if ((n as any).isOpen) {
        liveActive++;
      } else {
        const pnl =
          typeof (n as any).unrealizedPnl === "number" &&
          Number.isFinite((n as any).unrealizedPnl)
            ? (n as any).unrealizedPnl
            : typeof (n as any).pnl === "number" &&
              Number.isFinite((n as any).pnl)
            ? (n as any).pnl
            : 0;
        const win = pnl >= 0;
        if (win) liveWins++;
        else liveLosses++;
      }

      const d = Number((n as any).dir ?? (n as any).direction ?? 0);
      if (d === 1) liveBuys++;
      else if (d === -1) liveSells++;
    }

    return {
      // Back-compat keys used by the header UI
      total: liveTotal,
      wins: liveWins,
      losses: liveLosses,
      buys: liveBuys,
      sells: liveSells,

      // Explicit keys (used elsewhere)
      liveTotal,
      liveWins,
      liveLosses,
      liveBuys,
      liveSells,
      potential: livePotential,
      active: liveActive,

      // Library stats
      libraryPts,
      libWins,
      libLosses,
      libBuys,
      libSells,
      libraryById,
    };
  }, [displayNodes]);

  const hdbModalitiesForNode = React.useCallback(
    (n: any) => {
      if (!n || aiMethod !== "hdbscan") return "";
      const parts: string[] = [];

      // Show whether we're in REAL vs CONCEPTUAL (how modalities affect clustering).
      if (
        typeof HDB_MODALITY_DISTINCTION === "string" &&
        HDB_MODALITY_DISTINCTION.length
      ) {
        parts.push(`Distinction=${HDB_MODALITY_DISTINCTION}`);
      }
      // Trade direction (informational)
      const dir = Number((n as any).dir ?? (n as any).direction ?? 0);
      if (dir === 1) parts.push("Dir=Buy");
      else if (dir === -1) parts.push("Dir=Sell");

      // Active modalities (only what the user enabled)
      if (activeModSet && activeModSet.size) {
        parts.push("Mods=" + Array.from(activeModSet).sort().join(","));
      }

      const t = (n as any).entryTime ?? (n as any).metaTime ?? "";
      // Inline meta parsing here (avoid depending on queryMetaFromTime, which may be out of scope in the UI layer)
      const d = parseDateFromString(t, parseMode);
      const session = sessionFromTime(t, parseMode);
      const month = d
        ? (parseMode === "utc" ? d.getUTCMonth() : d.getMonth()) + 1
        : null;
      const dow = d ? (parseMode === "utc" ? d.getUTCDay() : d.getDay()) : null;
      const hour = d
        ? parseMode === "utc"
          ? d.getUTCHours()
          : d.getHours()
        : null;
      const year = d
        ? parseMode === "utc"
          ? d.getUTCFullYear()
          : d.getFullYear()
        : null;

      if (activeModSet) {
        if (activeModSet.has("Session"))
          parts.push(`Session=${String(session ?? "-")}`);
        if (activeModSet.has("Month"))
          parts.push(`Month=${String(month ?? "-")}`);
        if (activeModSet.has("Weekday"))
          parts.push(`Weekday=${String(dow ?? "-")}`);
        if (activeModSet.has("Hour")) parts.push(`Hour=${String(hour ?? "-")}`);
        if (activeModSet.has("Year")) parts.push(`Year=${String(year ?? "-")}`);
      }

      return parts.join(" · ");
    },
    [aiMethod, parseMode, activeModSet]
  );

  const effectiveTradeConfidence = React.useCallback(
    (t: any) => {
      if (!t) return 0;

      if (aiMethod !== "hdbscan") {
        const raw =
          (t as any).entryConfidence ??
          (t as any).aiConfidence ??
          (t as any).confidence ??
          (t as any).entryMargin ??
          (t as any).margin ??
          null;
        const v = raw === null || raw === undefined ? NaN : Number(raw);
        return Number.isFinite(v) ? clamp(Math.abs(v), 0, 1) : 0;
      }

      const uid = (t as any).uid ?? (t as any).id ?? null;
      if (uid != null) {
        const node = (tradeNodeByUidAll as any).get(String(uid));
        if (node) return hdbConfidenceForNode(node);
      }

      // Fallback: if we can't map back to a node, try using the trade/node itself (post-hoc nodes have fresh IDs).
      return hdbConfidenceForNode(t as any);
    },
    [aiMethod, tradeNodeByUidAll, hdbConfidenceForNode]
  );

  const sortArrow = (k: string) => {
    return (groupSort as any)?.key === k
      ? (groupSort as any)?.dir === "asc"
        ? "▲"
        : "▼"
      : "";
  };

  const toggleGroupSort = (k: string) => {
    setGroupSort((prev) => {
      const p: any = prev || { key: "count", dir: "desc" };
      if (String(p.key) === String(k)) {
        return { key: k, dir: p.dir === "asc" ? "desc" : "asc" };
      }
      return { key: k, dir: "desc" };
    });
  };

  const heatmapBasisNodes = useMemo(() => {
    // Heatmap should be computed from the *data basis* (not legend visibility):
    // - never include "close" projection nodes
    // - never include "potential" nodes
    // - never include OPEN trades
    // In HDBSCAN mode, this should follow post-hoc promotion/demotion (timelineNodesCheat).
    const src =
      (aiMethod === "hdbscan"
        ? (timelineNodesCheat as any[])
        : (timelineNodes as any[])) || [];

    const base = src.filter(
      (n: any) =>
        n &&
        !n.isOpen &&
        n.kind !== "potential" &&
        n.kind !== "close" &&
        n.kind !== "ghost"
    );

    if (!staticLibrariesClusters) return base;

    return base.filter(
      (n: any) => n && String((n as any).kind || "").toLowerCase() === "library"
    );
  }, [timelineNodes, timelineNodesCheat, staticLibrariesClusters, aiMethod]);

  // Keep a stable redraw function for ResizeObserver/visibility changes.
  useEffect(() => {
    redrawRef.current = () => {
      const c = canvasRef.current;
      if (!c) return;
      drawClusterMapCanvas(
        c,
        displayNodes,
        viewRef.current,
        hoveredIdRef.current,
        searchHighlightIdRef.current,
        ghostLegendColored,
        boxViz,
        heatmapOn,
        heatmapRef,
        hdbOverlay,
        hoveredGroupRef.current,
        selectedGroupRef.current,
        groupOverlayOpacity,
        nodeSizeMul,
        nodeOutlineMul,
        heatmapInterp,
        mapSpreadMulRef.current,
        heatmapSmoothness,
        heatmapBasisNodes
      );
    };
  });

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    let ro: any = null;
    const trigger = () => {
      const fn: any = (redrawRef as any).current;
      if (typeof fn === "function") fn();
    };
    if (typeof (window as any).ResizeObserver !== "undefined") {
      ro = new (window as any).ResizeObserver(() => {
        requestAnimationFrame(trigger);
      });
      ro.observe(el);
    } else {
      window.addEventListener("resize", trigger);
    }
    requestAnimationFrame(trigger);
    return () => {
      if (ro && ro.disconnect) ro.disconnect();
      window.removeEventListener("resize", trigger);
    };
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    hoveredIdRef.current = hoveredId;
    drawClusterMapCanvas(
      c,
      displayNodes,
      viewRef.current,
      hoveredIdRef.current,
      searchHighlightIdRef.current,
      ghostLegendColored,
      boxViz,
      heatmapOn,
      heatmapRef,
      hdbOverlay,
      hoveredGroupRef.current,
      selectedGroupRef.current,
      groupOverlayOpacity,
      nodeSizeMul,
      nodeOutlineMul,
      heatmapInterp,
      mapSpreadMulRef.current,
      heatmapSmoothness,
      heatmapBasisNodes
    );
  }, [
    displayNodes,
    heatmapBasisNodes,
    hoveredId,
    searchHighlightId,
    ghostLegendColored,
    boxViz,
    heatmapOn,
    hdbOverlay,
    groupOverlayOpacity,
    nodeSizeMul,
    nodeOutlineMul,
    heatmapInterp,
    mapSpreadMul,
  ]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const getLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const effView = () => {
      const v = viewRef.current;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      const s = Number(mapSpreadMulRef.current) || 1;
      const baseScale = Number(v.scale) || 1;
      const scale = baseScale * s;

      // Same center-anchored spread transform as drawClusterMapCanvas.
      const ox = w * 0.5 - (w * 0.5 - (Number(v.ox) || 0)) * s;
      const oy = h * 0.5 - (h * 0.5 - (Number(v.oy) || 0)) * s;

      return { w, h, s, baseScale, scale, ox, oy };
    };

    const toWorld = (sx, sy) => {
      const ev = effView();
      return {
        x: (sx - ev.ox) / (ev.scale || 1),
        y: (sy - ev.oy) / (ev.scale || 1),
      };
    };
    const pickNode = (sx, sy) => {
      const ev = effView();
      const w = {
        x: (sx - ev.ox) / (ev.scale || 1),
        y: (sy - ev.oy) / (ev.scale || 1),
      };
      let best = null;
      for (const n of displayNodes as any[]) {
        const dx = n.x - w.x;
        const dy = n.y - w.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const hit = n.r * 1.35 + 3 / (ev.scale || 1);
        if (d <= hit) {
          if (!best || d < best.d) best = { id: n.id, d };
        }
      }
      return best?.id ?? null;
    };

    // Overlay group picking (HDB hulls)
    const pointInPoly = (
      x: number,
      y: number,
      poly: Array<{ sx: number; sy: number }>
    ) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].sx,
          yi = poly[i].sy;
        const xj = poly[j].sx,
          yj = poly[j].sy;
        const intersect =
          yi > y !== yj > y &&
          x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const pickGroup = (sx: number, sy: number) => {
      const ev = effView();
      const ox = ev.ox,
        oy = ev.oy,
        sc = ev.scale;

      // 1) HDB clusters (use expanded hull in screen space, matching the draw)
      if (
        hdbOverlay &&
        (hdbOverlay as any).clusters &&
        Array.isArray((hdbOverlay as any).clusters)
      ) {
        for (const c of (hdbOverlay as any).clusters) {
          const hull = c && c.hull ? (c.hull as [number, number][]) : null;
          if (!hull || hull.length < 3) continue;

          const spts = hull.map((p) => ({
            sx: p[0] * sc + ox,
            sy: p[1] * sc + oy,
          }));
          let cx = 0,
            cy = 0;
          for (const p of spts) {
            cx += p.sx;
            cy += p.sy;
          }
          cx /= spts.length;
          cy /= spts.length;

          const padPix = 18;
          const expPts = spts.map((p) => {
            const dx = p.sx - cx;
            const dy = p.sy - cy;
            const ll = Math.sqrt(dx * dx + dy * dy) || 1e-9;
            const f = 1 + padPix / ll;
            return { sx: cx + dx * f, sy: cy + dy * f };
          });

          if (pointInPoly(sx, sy, expPts)) {
            const stats = (c as any)?.stats || {};
            return { type: "hdb", id: (c as any).id, stats };
          }
        }
      }

      return null;
    };

    let dragging = false;
    let drag = { x: 0, y: 0, ox: 0, oy: 0, moved: false };
    let rafId = null;
    let pendingOx = view.ox;
    let pendingOy = view.oy;
    const onPointerDown = (e) => {
      const p = getLocal(e);

      // Selection mode:
      // - Right-click => rectangle (two clicks)
      // - Left-click drag => free draw lasso
      if (boxSelectMode) {
        // Right-click rectangle
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          setSelShape("rect");
          setLassoFinal(null);
          setLassoIsDrawing(false);
          lassoRef.current.drawing = false;
          lassoRef.current.pts = [];

          const w = toWorld(p.x, p.y);
          if (!boxStart || boxEnd) {
            setBoxStart(w);
            setBoxEnd(null);
            setBoxPreview(w);
          } else {
            setBoxEnd(w);
            setBoxPreview(null);
          }
          drawClusterMapCanvas(
            canvas,
            displayNodes,
            viewRef.current,
            hoveredIdRef.current,
            searchHighlightIdRef.current,
            ghostLegendColored,
            (() => {
              // React state updates haven't flushed yet, so compute corners locally.
              const a = !boxStart || boxEnd ? w : boxStart;
              const b = w;
              const x0 = Math.min(a.x, b.x);
              const x1 = Math.max(a.x, b.x);
              const y0 = Math.min(a.y, b.y);
              const y1 = Math.max(a.y, b.y);
              return {
                ...boxViz,
                kind: "rect",
                anchor: { x: a.x, y: a.y },
                rect: { x0, y0, x1, y1 },
                lasso: null,
                lassoClosed: false,
              };
            })(),
            heatmapOn,
            heatmapRef,
            hdbOverlay,
            hoveredGroupRef.current,
            selectedGroupRef.current,
            groupOverlayOpacity,
            nodeSizeMul,
            nodeOutlineMul,
            heatmapInterp,
            mapSpreadMulRef.current,
            heatmapSmoothness
          );
          return;
        }

        // Left-click starts lasso (drag to draw)
        if (e.button === 0) {
          e.preventDefault();
          e.stopPropagation();
          setSelShape("lasso");
          setBoxStart(null);
          setBoxEnd(null);
          setBoxPreview(null);
          setLassoFinal(null);
          setLassoIsDrawing(true);

          const w = toWorld(p.x, p.y);
          lassoRef.current.drawing = true;
          lassoRef.current.pts = [w];
          canvas.setPointerCapture?.(e.pointerId);

          // Immediate redraw for a responsive first point
          drawClusterMapCanvas(
            canvas,
            displayNodes,
            viewRef.current,
            hoveredIdRef.current,
            searchHighlightIdRef.current,
            ghostLegendColored,
            {
              ...boxViz,
              kind: "lasso",
              lasso: lassoRef.current.pts,
              lassoClosed: false,
            },
            heatmapOn,
            heatmapRef,
            hdbOverlay,
            hoveredGroupRef.current,
            selectedGroupRef.current,
            groupOverlayOpacity,
            nodeSizeMul,
            nodeOutlineMul,
            heatmapInterp,
            mapSpreadMulRef.current,
            heatmapSmoothness
          );
          return;
        }
      }

      // Normal pan/drag
      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture?.(e.pointerId);
      dragging = true;
      setIsDragging(true);
      drag = {
        x: p.x,
        y: p.y,
        ox: viewRef.current.ox,
        oy: viewRef.current.oy,
        moved: false,
      };
    };
    const onPointerMove = (e) => {
      const p = getLocal(e);
      const wpos0 = toWorld(p.x, p.y);
      setHoverWorld(wpos0);

      // Live preview / drawing while in selection mode.
      if (boxSelectMode) {
        // Rectangle preview (corner B)
        if (selShape === "rect" && boxStart && !boxEnd) {
          const w = toWorld(p.x, p.y);
          setBoxPreview(w);

          // Draw immediately using the live pointer position, rather than waiting
          // for React state to flush.
          const rx0 = Math.min(boxStart.x, w.x);
          const rx1 = Math.max(boxStart.x, w.x);
          const ry0 = Math.min(boxStart.y, w.y);
          const ry1 = Math.max(boxStart.y, w.y);
          setTooltip(null);
          setHoveredId(null);
          hoveredIdRef.current = null;
          if (hoveredGroupRef.current) {
            hoveredGroupRef.current = null;
            setHoveredGroup(null);
          }
          if (hoveredGroupRef.current) {
            hoveredGroupRef.current = null;
            setHoveredGroup(null);
          }
          drawClusterMapCanvas(
            canvas,
            displayNodes,
            viewRef.current,
            hoveredIdRef.current,
            searchHighlightIdRef.current,
            ghostLegendColored,
            {
              kind: "rect",
              anchor: { x: boxStart.x, y: boxStart.y },
              rect: { x0: rx0, y0: ry0, x1: rx1, y1: ry1 },
              lasso: null,
              lassoClosed: false,
            },
            heatmapOn,
            heatmapRef,
            hdbOverlay,
            hoveredGroupRef.current,
            selectedGroupRef.current,
            groupOverlayOpacity,
            nodeSizeMul,
            nodeOutlineMul,
            heatmapInterp,
            mapSpreadMulRef.current,
            heatmapSmoothness
          );
          return;
        }

        // Lasso drawing (left-drag)
        if (lassoRef.current.drawing) {
          const w = toWorld(p.x, p.y);
          const pts = lassoRef.current.pts;
          const last = pts[pts.length - 1] || w;

          // Throttle point density in *screen space* (≈4px)
          const effScale = effView().scale || 1;
          const dx = (w.x - last.x) * effScale;
          const dy = (w.y - last.y) * effScale;
          if (dx * dx + dy * dy >= 16) pts.push(w);

          // IMPORTANT: keep the lasso visible while drawing.
          // We draw here and return early so the normal hover redraw below
          // doesn't overwrite the in-progress path.
          setTooltip(null);
          setHoveredId(null);
          hoveredIdRef.current = null;
          if (hoveredGroupRef.current) {
            hoveredGroupRef.current = null;
            setHoveredGroup(null);
          }
          drawClusterMapCanvas(
            canvas,
            displayNodes,
            viewRef.current,
            hoveredIdRef.current,
            searchHighlightIdRef.current,
            ghostLegendColored,
            {
              ...boxViz,
              kind: "lasso",
              lasso: pts,
              lassoClosed: false,
            },
            heatmapOn,
            heatmapRef,
            hdbOverlay,
            hoveredGroupRef.current,
            selectedGroupRef.current,
            groupOverlayOpacity,
            nodeSizeMul,
            nodeOutlineMul,
            heatmapInterp,
            mapSpreadMulRef.current,
            heatmapSmoothness
          );
          return;
        }
      }
      if (dragging) {
        e.preventDefault();
        if (
          !drag.moved &&
          (Math.abs(p.x - drag.x) > 3 || Math.abs(p.y - drag.y) > 3)
        ) {
          drag.moved = true;
        }
        const s = Number(mapSpreadMulRef.current) || 1;
        const newOx = drag.ox + (p.x - drag.x) / (s || 1);
        const newOy = drag.oy + (p.y - drag.y) / (s || 1);
        pendingOx = newOx;
        pendingOy = newOy;
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            setView((v) => {
              const newV = { ...v, ox: pendingOx, oy: pendingOy };
              viewRef.current = newV;
              return newV;
            });
            drawClusterMapCanvas(
              canvas,
              displayNodes,
              viewRef.current,
              hoveredIdRef.current,
              searchHighlightIdRef.current,
              ghostLegendColored,
              boxViz,
              heatmapOn,
              heatmapRef,
              hdbOverlay,
              hoveredGroupRef.current,
              selectedGroupRef.current,
              groupOverlayOpacity,
              nodeSizeMul,
              nodeOutlineMul,
              heatmapInterp,
              mapSpreadMulRef.current,
              heatmapSmoothness
            );
            rafId = null;
          });
        }
        return;
      }
      // Heatmap hover (when ON, nodes are hidden; show local expectancy stats instead).
      if (heatmapOn) {
        if (!pinnedRef.current) {
          const wpos = wpos0;
          const hs = computeHeatHover(wpos.x, wpos.y);
          setHeatHover(hs);
        }

        setTooltip(null);
        setHoveredId(null);
        hoveredIdRef.current = null;

        drawClusterMapCanvas(
          canvas,
          displayNodes,
          viewRef.current,
          hoveredIdRef.current,
          searchHighlightIdRef.current,
          ghostLegendColored,
          boxViz,
          heatmapOn,
          heatmapRef,
          hdbOverlay,
          hoveredGroupRef.current,
          selectedGroupRef.current,
          groupOverlayOpacity,
          nodeSizeMul,
          nodeOutlineMul,
          heatmapInterp,
          mapSpreadMulRef.current,
          heatmapSmoothness
        );
        return;
      } else if (heatHover) {
        // Clear hover box when leaving heatmap mode.
        setHeatHover(null);
      }
      const id = pickNode(p.x, p.y);
      if (id) {
        // Node hover has priority over overlay-group hover
        if (hoveredGroupRef.current) {
          hoveredGroupRef.current = null;
          setHoveredGroup(null);
        }
      }
      setHoveredId(id);
      hoveredIdRef.current = id;
      if (id) {
        const n = displayNodes.find((x) => x.id === id);
        if (n) {
          const lines = [];
          const kind = String((n as any).kind ?? "").toLowerCase();
          if (kind === "potential") {
            lines.push(
              `Potential · ${n.dir === 1 ? "Buy" : "Sell"} · ${n.chunkType}`
            );
            lines.push(`Time: ${formatDateTime(n.entryTime, parseMode)}`);
            lines.push(
              `Confidence: ${Math.round((n.potentialMargin ?? 0) * 100)}%`
            );
            const mods = hdbModalitiesForNode(n);
            if (mods) lines.push(`Modalities: ${mods}`);
            if (n.closestCluster) lines.push(`Closest: ${n.closestCluster}`);
          } else if (kind === "ghost") {
            const sess =
              n.session || sessionFromTime(n.entryTime, parseMode) || "-";
            lines.push(
              `Suppressed Trade · ${n.dir === 1 ? "Buy" : "Sell"} · ${sess} · ${
                n.chunkType
              }`
            );
            lines.push(`ID: ${displayIdForNode(n)}`);
            if (aiMethod !== "hdbscan") {
              const gate = gateConfidenceForNode(n);
              if (typeof gate === "number" && Number.isFinite(gate)) {
                lines.push(`Gate: ${Math.round(gate * 100)}%`);
              }
            }

            if (aiMethod === "hdbscan") {
              const info = hdbInfo(n);
              const wr = info?.wr ?? 0.01;
              const cid = info?.clusterId;
              const label =
                cid != null && Number.isFinite(cid)
                  ? `Cluster WR (HD #${cid})`
                  : "Cluster WR";
              lines.push(`${label}: ${Math.round(wr * 100)}%`);
            } else {
              const c = hdbConfidenceForNode(n);
              lines.push(`Confidence: ${Math.round(c * 100)}%`);
            }

            const mods = hdbModalitiesForNode(n);
            if (mods) lines.push(`Modalities: ${mods}`);
            lines.push(`Entry: ${formatDateTime(n.entryTime, parseMode)}`);
          } else {
            const isLiveNode = kind === "close";
            const isOpenEntry = kind === "trade" && !!n.isOpen;
            const label = isLiveNode
              ? "Live Trade"
              : isOpenEntry
              ? "Open Trade"
              : "Trade";
            const pnl = isLiveNode ? n.pnl ?? 0 : isOpenEntry ? 0 : n.pnl ?? 0;
            lines.push(
              `${label} · ${n.dir === 1 ? "Buy" : "Sell"} · ${n.session} · ${
                n.chunkType
              }`
            );
            lines.push(`ID: ${displayIdForNode(n)}`);
            {
              const am = (n as any).aiMode;
              const aLab =
                am === "model"
                  ? "AI Model"
                  : am === "filter"
                  ? "AI Filter"
                  : "Model";
              lines.push(`Entry via: ${aLab}`);
            }
            {
              const conf = hdbConfidenceForNode(n);
              if (typeof conf === "number" && Number.isFinite(conf)) {
                if (aiMethod !== "hdbscan") {
                  const gate = gateConfidenceForNode(n);
                  if (typeof gate === "number" && Number.isFinite(gate)) {
                    lines.push(`Gate: ${Math.round(gate * 100)}%`);
                  }
                }

                if (aiMethod === "hdbscan") {
                  const info = hdbInfo(n);
                  const wr = info?.wr ?? conf;
                  const cid = info?.clusterId;
                  const label =
                    cid != null && Number.isFinite(cid)
                      ? `Cluster WR (HD #${cid})`
                      : "Cluster WR";
                  lines.push(`${label}: ${Math.round(wr * 100)}%`);
                } else {
                  lines.push(`Confidence: ${Math.round(conf * 100)}%`);
                }

                const mods = hdbModalitiesForNode(n);
                if (mods) lines.push(`Modalities: ${mods}`);
              }
            }
            if (n.closestCluster) lines.push(`Closest: ${n.closestCluster}`);
            if ((n as any).closestClusterUid)
              lines.push(
                `MIT ID: ${displayIdFromRaw((n as any).closestClusterUid)}`
              );
            lines.push(`PnL: ${formatNumber(pnl, 2)}`);
            if (n.exitReason && !n.isOpen) lines.push(`Exit: ${n.exitReason}`);
            lines.push(`Entry: ${formatDateTime(n.entryTime, parseMode)}`);
            lines.push(
              `Exit: ${n.isOpen ? "-" : formatDateTime(n.exitTime, parseMode)}`
            );
          }
          const tKey = themeKeyForNode(n);
          setTooltip({ x: p.x + 12, y: p.y + 12, lines, themeKey: tKey });
        }
      } else {
        // Overlay group hover (HDBSCAN hulls) when not on a node
        const grp = pickGroup(p.x, p.y);
        hoveredGroupRef.current = grp;
        setHoveredGroup(grp);
        if (grp && grp.stats) {
          const st: any = grp.stats || {};
          const count = Number(st.count ?? 0);
          const wins = Number(st.wins ?? 0);
          const losses = Number.isFinite(Number(st.losses))
            ? Number(st.losses)
            : Math.max(0, count - wins);
          const buys = Number(st.buys ?? 0);
          const sells = Number(st.sells ?? 0);
          const wr = Number.isFinite(Number(st.winRate))
            ? Number(st.winRate)
            : count > 0
            ? wins / count
            : 0;
          const themeKey = wr >= 0.6 ? "green" : wr <= 0.4 ? "red" : "neutral";
          const title = `HDB Cluster #${Number(grp.id)}`;
          const lines = [
            `${title} · WR ${formatNumber(wr * 100, 1)}% · n=${count}`,
            `Wins ${wins} · Losses ${losses}`,
            `Buys ${buys} · Sells ${sells}`,
          ];
          setTooltip({ x: p.x + 12, y: p.y + 12, lines, themeKey });
        } else {
          setTooltip(null);
        }
      }
      drawClusterMapCanvas(
        canvas,
        displayNodes,
        viewRef.current,
        hoveredIdRef.current,
        searchHighlightIdRef.current,
        ghostLegendColored,
        boxViz,
        heatmapOn,
        heatmapRef,
        hdbOverlay,
        hoveredGroupRef.current,
        selectedGroupRef.current,
        groupOverlayOpacity,
        nodeSizeMul,
        nodeOutlineMul,
        heatmapInterp,
        mapSpreadMulRef.current,
        heatmapSmoothness
      );
    };
    const endDrag = (e) => {
      dragging = false;
      setIsDragging(false);
      // In selection mode we don't do click-to-select node here.
      // Finish lasso selection on release.
      if (boxSelectMode) {
        if (lassoRef.current.drawing) {
          lassoRef.current.drawing = false;
          setLassoIsDrawing(false);
          const pts = (lassoRef.current.pts || []).slice();
          if (pts.length >= 3) {
            setSelShape("lasso");
            setLassoFinal(pts);
          } else {
            setLassoFinal(null);
          }
        }
        if (e && canvas.releasePointerCapture) {
          try {
            canvas.releasePointerCapture(e.pointerId);
          } catch {}
        }
        return;
      }

      if (e && !drag.moved) {
        const p = getLocal(e);
        const w = toWorld(p.x, p.y);

        // Heatmap: click toggles a "locked" hover point (coords + heatmap stats).
        if (heatmapOn) {
          if (pinnedRef.current) {
            setPinnedWorld(null);
            setPinnedHeatHover(null);
          } else {
            setPinnedWorld(w);
            const hsPinned = computeHeatHover(w.x, w.y);
            setPinnedHeatHover(hsPinned);
          }

          if (e && canvas.releasePointerCapture) {
            try {
              canvas.releasePointerCapture(e.pointerId);
            } catch {}
          }
          return;
        }

        // Non-heatmap: keep the pinned coordinate handy (but don't lock heat stats).
        setPinnedWorld(w);
        setPinnedHeatHover(null);

        const hitNode = pickNode(p.x, p.y);
        if (hitNode) {
          setSelectedId(hitNode);
          setSelectedGroup(null);
          selectedGroupRef.current = null;
        } else {
          const hitGrp = pickGroup(p.x, p.y);
          setSelectedId(null);
          {
            const gid = hitGrp
              ? typeof hitGrp === "object"
                ? (hitGrp as any).id
                : hitGrp
              : null;
            setSelectedGroup(gid);
            selectedGroupRef.current = gid;
          }
        }
      }

      if (e && canvas.releasePointerCapture) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const oldScale = Number(v.scale) || 1;
        const zoom = Math.exp(-e.deltaY * 0.0012);
        const newScale = clamp(oldScale * zoom, 0.25, 6);

        const s = Number(mapSpreadMulRef.current) || 1;
        const cw = canvas.clientWidth || 1;
        const ch = canvas.clientHeight || 1;

        // Effective transform (center-anchored "spread" zoom).
        const oldEffScale = oldScale * s;
        const oldEffOx = cw * 0.5 - (cw * 0.5 - (Number(v.ox) || 0)) * s;
        const oldEffOy = ch * 0.5 - (ch * 0.5 - (Number(v.oy) || 0)) * s;

        const wx = (mx - oldEffOx) / (oldEffScale || 1);
        const wy = (my - oldEffOy) / (oldEffScale || 1);

        const newEffScale = newScale * s;

        // Solve base offsets so the same world point stays under the mouse.
        const nox = (mx - wx * newEffScale - cw * 0.5 * (1 - s)) / (s || 1);
        const noy = (my - wy * newEffScale - ch * 0.5 * (1 - s)) / (s || 1);

        const newV = { scale: newScale, ox: nox, oy: noy };
        viewRef.current = newV;
        return newV;
      });
      drawClusterMapCanvas(
        canvas,
        displayNodes,
        viewRef.current,
        hoveredIdRef.current,
        searchHighlightIdRef.current,
        ghostLegendColored,
        boxViz,
        heatmapOn,
        heatmapRef,
        hdbOverlay,
        hoveredGroupRef.current,
        selectedGroupRef.current,
        groupOverlayOpacity,
        nodeSizeMul,
        nodeOutlineMul,
        heatmapInterp,
        mapSpreadMulRef.current,
        heatmapSmoothness
      );
    };

    const onContextMenu = (e) => {
      // Always prevent the browser menu on the cluster map.
      // (Selection mode uses right-click as an alternate to left-click.)
      e.preventDefault();
    };

    const onEnter = () => {
      mapFocusRef.current = true;
    };

    const onLeave = () => {
      mapFocusRef.current = false;

      setTooltip(null);
      setHoveredId(null);
      hoveredIdRef.current = null;
      if (hoveredGroupRef.current) {
        hoveredGroupRef.current = null;
        setHoveredGroup(null);
      }
      setHeatHover(null);
      setHoverWorld(null);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    displayNodes,
    parseMode,
    boxSelectMode,
    boxStart,
    boxEnd,
    boxPreview,
    selShape,
    boxViz,
    ghostLegendColored,
    heatmapOn,
    heatHover,
    computeHeatHover,
    hdbOverlay,
    groupOverlayOpacity,
    nodeSizeMul,
    nodeOutlineMul,
  ]);

  const searchPool = useMemo(() => {
    const all: any[] = [];
    const pushAll = (arr: any) => {
      if (!Array.isArray(arr)) return;
      for (const n of arr) {
        if (!n) continue;
        const _er = String((n as any).exitReason ?? "").toLowerCase();
        const _eb = String(
          (n as any).exitBy ?? (n as any).exitMethod ?? ""
        ).toLowerCase();
        if ((n as any).metaFromLibrary) continue;
        if (
          String((n as any).kind || "").toLowerCase() === "trade" &&
          (_er === "library" || _eb === "library")
        )
          continue;
        all.push(n);
      }
    };

    // In HDBSCAN post-hoc mode, include the *post-hoc* pool so promoted trades are searchable.
    if (aiMethod === "hdbscan") pushAll(timelineNodesCheat as any[]);

    // Always include the raw embedded pool so legacy/raw IDs remain searchable.
    pushAll(nodes as any[]);

    // De-dupe by stable identity.
    const seen = new Set<string>();
    const out: any[] = [];
    for (const n of all) {
      const key = String(
        (n as any)?.id ?? (n as any)?.uid ?? (n as any)?.tradeUid ?? ""
      );
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  }, [aiMethod, timelineNodesCheat, nodes]);

  const searchSuggestions = useMemo(() => {
    const q = String(searchUid || "").trim();
    if (!q) return [] as any[];
    const qlc = q.toLowerCase();

    // Suggest across the FULL embedded pool (not just the currently-filtered view).
    const pool: any[] = (searchPool as any[]) || [];
    const out: any[] = [];
    const seen = new Set<string>();

    const push = (n: any) => {
      if (!n) return;
      const raw = String(n.uid || n.tradeUid || n.id || "");
      const disp = String(displayIdForNode(n) || "");
      const key = (disp || raw).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);

      const kind = String((n as any).kind || "").toLowerCase();
      const libKey = String(
        (n as any).libId ??
          (n as any).metaLib ??
          (n as any).library ??
          (n as any).metaLibrary ??
          ""
      );
      const isLib =
        kind === "library" ||
        (n as any).libId != null ||
        (n as any).metaLib != null ||
        (n as any).library != null ||
        (n as any).metaLibrary != null ||
        String((n as any).id || "").startsWith("lib|");

      const pnlRaw =
        typeof (n as any).pnl === "number"
          ? (n as any).pnl
          : typeof (n as any).metaPnl === "number"
          ? (n as any).metaPnl
          : null;

      const win =
        typeof (n as any).win === "boolean"
          ? (n as any).win
          : pnlRaw != null
          ? pnlRaw >= 0
          : false;

      const isOpen = !!(n as any).isOpen && kind === "trade" && !isLib;

      out.push({
        id: (n as any).id,
        raw,
        disp,
        kind,
        value: disp || raw,
        isLib,
        libKey,
        win,
        isOpen,
      });
    };

    // 1) Prefer startsWith matches
    for (const n of pool) {
      if (out.length >= 10) break;
      const raw = String(n?.uid || n?.tradeUid || n?.id || "");
      const disp = String(displayIdForNode(n) || "");
      const rl = raw.toLowerCase();
      const dl = disp.toLowerCase();
      if ((rl && rl.startsWith(qlc)) || (dl && dl.startsWith(qlc))) push(n);
    }

    // 2) Then includes matches
    for (const n of pool) {
      if (out.length >= 10) break;
      const raw = String(n?.uid || n?.tradeUid || n?.id || "");
      const disp = String(displayIdForNode(n) || "");
      const rl = raw.toLowerCase();
      const dl = disp.toLowerCase();
      if ((rl && rl.includes(qlc)) || (dl && dl.includes(qlc))) push(n);
    }
    return out;
  }, [searchUid, searchPool]);

  // When HDBSCAN post-hoc promotion/demotion is enabled, the visible node IDs can differ from the
  // raw embedded `nodes` pool. This helper resolves a searched suggestion to the currently-rendered
  // node (so highlighting + the Selected panel always works).
  const resolveNodeForSelection = React.useCallback(
    (candidate: any) => {
      if (!candidate) return null;

      const candId = candidate.id != null ? String(candidate.id) : "";
      const candUidRaw =
        (candidate as any).uid ??
        (candidate as any).tradeUid ??
        (candidate as any).metaUid ??
        (candidate as any).metaTradeUid ??
        null;
      const candUid = candUidRaw != null ? String(candUidRaw) : "";
      const candDisp = String(displayIdForNode(candidate as any) || "");
      const candDispLc = candDisp.toLowerCase();

      const pool: any[] = Array.isArray(timelineNodesCheat)
        ? (timelineNodesCheat as any[]) || []
        : [];

      // 1) Direct id match
      let hit =
        candId &&
        pool.find((n: any) => n && String((n as any).id ?? "") === candId);
      if (hit) return hit;

      // 2) UID match (including post-hoc backrefs)
      if (candUid) {
        hit = pool.find((n: any) => {
          if (!n) return false;
          const u =
            (n as any).uid ??
            (n as any).tradeUid ??
            (n as any).metaUid ??
            (n as any).metaTradeUid ??
            "";
          if (u && String(u) === candUid) return true;
          if (
            (n as any).metaOrigUid &&
            String((n as any).metaOrigUid) === candUid
          )
            return true;
          return false;
        });
        if (hit) return hit;
      }

      // 3) Original-id backref match (post-hoc nodes store metaOrigId)
      if (candId) {
        hit = pool.find(
          (n: any) =>
            n &&
            (n as any).metaOrigId &&
            String((n as any).metaOrigId) === candId
        );
        if (hit) return hit;
      }

      // 4) Display-ID match (fallback)
      if (candDispLc) {
        hit = pool.find((n: any) => {
          const d = String(displayIdForNode(n as any) || "").toLowerCase();
          return d && d === candDispLc;
        });
        if (hit) return hit;
      }

      return null;
    },
    [timelineNodesCheat]
  );
  const runSearch = (query?: string) => {
    const q = String(query ?? searchUid ?? "").trim();
    if (query !== undefined) setSearchUid(q);
    if (!q) {
      setSearchStatus(null);
      setSearchHighlightId(null);
      searchHighlightIdRef.current = null;
      return;
    }

    // Search across ALL embedded nodes (even if currently filtered out by the view dropdowns).
    const pool: any[] = (searchPool as any[]) || [];
    const qlc = q.toLowerCase();
    const hit = pool.find((n: any) => {
      const raw = String(n.uid || n.tradeUid || n.id || "");
      const disp = displayIdForNode(n);
      if (raw && raw.toLowerCase() === qlc) return true;
      if (disp && disp.toLowerCase() === qlc) return true;
      // Allow partial matches so you can paste either the raw ID or the smart ID.
      if (raw && raw.toLowerCase().includes(qlc)) return true;
      if (disp && disp.toLowerCase().includes(qlc)) return true;
      return false;
    });
    if (!hit) {
      setSearchStatus("miss");
      return;
    }

    // If the hit is currently filtered out, clear filters so it becomes visible.
    try {
      const inView = Array.isArray(viewNodes)
        ? (viewNodes as any[]).some((n: any) => n && n.id === hit.id)
        : false;
      if (!inView) {
        setViewSession("All");
        setViewMonth("All");
        setViewWeekday("All");
        setViewHour("All");
        setViewModel("All");
      }
    } catch (_e) {}

    setSearchStatus("hit");

    const resolved = resolveNodeForSelection(hit) || hit;

    setSelectedId((resolved as any).id);
    setSearchHighlightId((resolved as any).id);
    searchHighlightIdRef.current = (resolved as any).id;
    setSearchFocus(false);

    // Center view on the found node (CSS pixels, not the devicePixel canvas buffer).
    const c = canvasRef.current as any;
    const rect =
      c && c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    const w = (rect && rect.width) || 1200;
    const h = (rect && rect.height) || 440;
    setView((v: any) => {
      const nv = {
        ...v,
        ox: w / 2 - (Number((resolved as any).x) || 0) * v.scale,
        oy: h / 2 - (Number((resolved as any).y) || 0) * v.scale,
      };
      viewRef.current = nv;
      return nv;
    });
  };

  if (headless) return null;

  return (
    <div
      style={{
        background: "#070707",
        borderRadius: 10,
        padding: 12,
        border: "1px solid rgba(255,255,255,0.10)",
        "boxShadow": "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: "0.08em",
              color: "#fff",
            }}
          >
            Cluster Map
          </div>
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.65)",
              marginTop: 2,
            }}
          >
            {(() => {
              const linePillStyle: any = {
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.18)",
                whiteSpace: "nowrap",
                flexWrap: "wrap",
                width: "fit-content",
                maxWidth: "100%",
              };
              const pillRowStyle: any = {
                display: "flex",
                flexDirection: "column",
                gap: 6,
                alignItems: "flex-start",
              };
              const pill = (children: any) => (
                <div style={linePillStyle}>{children}</div>
              );

              // These header pills should always reflect what is actually visible on the map.
              // `counts` is derived from `displayNodes` (the same array the canvas draws), so use it everywhere.
              const liveBS =
                Number((counts as any).buys || 0) +
                  Number((counts as any).sells || 0) || 0;
              const libBS =
                Number((counts as any).libBuys || 0) +
                  Number((counts as any).libSells || 0) || 0;
              const liveWL =
                Number((counts as any).wins || 0) +
                  Number((counts as any).losses || 0) || 0;
              const libWL =
                Number((counts as any).libWins || 0) +
                  Number((counts as any).libLosses || 0) || 0;

              const pct = (a: number, b: number) =>
                b > 0 ? Math.round((a / b) * 1000) / 10 : NaN;
              const fmt = (v: number) =>
                Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";

              const liveBuyPct = pct(Number((counts as any).buys || 0), liveBS);
              const liveSellPct = pct(
                Number((counts as any).sells || 0),
                liveBS
              );
              const libBuyPct = pct(
                Number((counts as any).libBuys || 0),
                libBS
              );
              const libSellPct = pct(
                Number((counts as any).libSells || 0),
                libBS
              );

              const liveWinPct = pct(Number((counts as any).wins || 0), liveWL);
              const liveLossPct = pct(
                Number((counts as any).losses || 0),
                liveWL
              );
              const libWinPct = pct(
                Number((counts as any).libWins || 0),
                libWL
              );
              const libLossPct = pct(
                Number((counts as any).libLosses || 0),
                libWL
              );

              const miniPill = (label: string, pieces: any[]) => (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(0,0,0,0.18)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ opacity: 0.72 }}>{label}</span>
                  {pieces}
                </span>
              );

              return (
                <div style={pillRowStyle}>
                  {pill(
                    <>
                      <span style={{ opacity: 0.78 }}>Total Nodes:</span>
                      <b style={{ color: "rgba(255,255,255,0.92)" }}>
                        Library{" "}
                        {Number(
                          (counts as any).libraryPts || 0
                        ).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>+</span>
                      <b style={{ color: "rgba(255,255,255,0.92)" }}>
                        Live/Normal{" "}
                        {Number((counts as any).total || 0).toLocaleString()}
                      </b>
                    </>
                  )}

                  {pill(
                    <>
                      <span style={{ opacity: 0.78 }}>Live/Normal:</span>
                      <span style={{ opacity: 0.72 }}>Wins</span>
                      <b style={{ color: "rgba(60,220,120,0.95)" }}>
                        {Number((counts as any).wins || 0).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ opacity: 0.72 }}>Losses</span>
                      <b style={{ color: "rgba(230,80,80,0.95)" }}>
                        {Number((counts as any).losses || 0).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ opacity: 0.72 }}>Buys</span>
                      <b style={{ color: "rgba(60,220,120,0.95)" }}>
                        {Number((counts as any).buys || 0).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ opacity: 0.72 }}>Sells</span>
                      <b style={{ color: "rgba(230,80,80,0.95)" }}>
                        {Number((counts as any).sells || 0).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ opacity: 0.72 }}>Potential</span>
                      <b style={{ color: "rgba(210,170,255,0.95)" }}>
                        {Number(
                          (counts as any).potential || 0
                        ).toLocaleString()}
                      </b>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ opacity: 0.72 }}>Active</span>
                      <b style={{ color: "rgba(240,200,60,0.95)" }}>
                        {Number((counts as any).active || 0).toLocaleString()}
                      </b>
                    </>
                  )}

                  {counts.libraryPts
                    ? pill(
                        <>
                          <span style={{ opacity: 0.78 }}>Library Nodes:</span>
                          <span style={{ opacity: 0.72 }}>Wins</span>
                          <b style={{ color: "rgba(60,220,120,0.95)" }}>
                            {Number(
                              (counts as any).libWins || 0
                            ).toLocaleString()}
                          </b>
                          <span style={{ opacity: 0.6 }}>·</span>
                          <span style={{ opacity: 0.72 }}>Losses</span>
                          <b style={{ color: "rgba(230,80,80,0.95)" }}>
                            {Number(
                              (counts as any).libLosses || 0
                            ).toLocaleString()}
                          </b>
                          <span style={{ opacity: 0.6 }}>·</span>
                          <span style={{ opacity: 0.72 }}>Buys</span>
                          <b style={{ color: "rgba(60,220,120,0.95)" }}>
                            {Number(
                              (counts as any).libBuys || 0
                            ).toLocaleString()}
                          </b>
                          <span style={{ opacity: 0.6 }}>·</span>
                          <span style={{ opacity: 0.72 }}>Sells</span>
                          <b style={{ color: "rgba(230,80,80,0.95)" }}>
                            {Number(
                              (counts as any).libSells || 0
                            ).toLocaleString()}
                          </b>
                        </>
                      )
                    : null}

                  {counts.libraryPts
                    ? pill(
                        <>
                          <span style={{ opacity: 0.78 }}>Libraries:</span>
                          {(
                            Object.entries(
                              (counts as any).libraryById || {}
                            ) as any[]
                          )
                            .sort(
                              (a: any, b: any) =>
                                (Number(b[1]) || 0) - (Number(a[1]) || 0)
                            )
                            .map(([lid, cnt]: any) => {
                              const def = (AI_LIBRARY_DEF_BY_ID as any)[
                                String(lid)
                              ];
                              const name = def
                                ? def.name || def.label || def.id
                                : String(lid);
                              const hue = Math.floor(
                                stableHashToUnit("libLegend:" + String(lid)) *
                                  360
                              );
                              const col = `hsla(${hue}, 92%, 64%, 0.98)`;
                              const isSupp =
                                String(lid).toLowerCase() === "suppressed";
                              const showCnt = isSupp
                                ? suppressedLibraryTotalAll
                                : Number(cnt || 0);
                              return (
                                <span
                                  key={String(lid)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginLeft: 8,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(255,255,255,0.10)",
                                    background: "rgba(0,0,0,0.14)",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <span style={{ opacity: 0.72 }}>{name}</span>
                                  <b style={{ color: col }}>
                                    {showCnt.toLocaleString()}
                                  </b>
                                </span>
                              );
                            })}
                        </>
                      )
                    : null}

                  {counts.libraryPts ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        alignItems: "flex-start",
                      }}
                    >
                      {miniPill("Buy/Sell", [
                        <span key="l1" style={{ opacity: 0.65 }}>
                          Live
                        </span>,
                        <b key="l2" style={{ color: "rgba(60,220,120,0.95)" }}>
                          {fmt(liveBuyPct)}
                        </b>,
                        <span key="l3" style={{ opacity: 0.65 }}>
                          /
                        </span>,
                        <b key="l4" style={{ color: "rgba(230,80,80,0.95)" }}>
                          {fmt(liveSellPct)}
                        </b>,
                        <span key="l5" style={{ opacity: 0.45 }}>
                          ·
                        </span>,
                        <span key="lb1" style={{ opacity: 0.65 }}>
                          Lib
                        </span>,
                        <b key="lb2" style={{ color: "rgba(60,220,120,0.85)" }}>
                          {fmt(libBuyPct)}
                        </b>,
                        <span key="lb3" style={{ opacity: 0.65 }}>
                          /
                        </span>,
                        <b key="lb4" style={{ color: "rgba(230,80,80,0.85)" }}>
                          {fmt(libSellPct)}
                        </b>,
                      ])}
                      {miniPill("Win/Loss", [
                        <span key="w1" style={{ opacity: 0.65 }}>
                          Live
                        </span>,
                        <b key="w2" style={{ color: "rgba(60,220,120,0.95)" }}>
                          {fmt(liveWinPct)}
                        </b>,
                        <span key="w3" style={{ opacity: 0.65 }}>
                          /
                        </span>,
                        <b key="w4" style={{ color: "rgba(230,80,80,0.95)" }}>
                          {fmt(liveLossPct)}
                        </b>,
                        <span key="w5" style={{ opacity: 0.45 }}>
                          ·
                        </span>,
                        <span key="wb1" style={{ opacity: 0.65 }}>
                          Lib
                        </span>,
                        <b key="wb2" style={{ color: "rgba(60,220,120,0.85)" }}>
                          {fmt(libWinPct)}
                        </b>,
                        <span key="wb3" style={{ opacity: 0.65 }}>
                          /
                        </span>,
                        <b key="wb4" style={{ color: "rgba(230,80,80,0.85)" }}>
                          {fmt(libLossPct)}
                        </b>,
                      ])}
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Direction</div>
              <select
                value={viewDir}
                onChange={(e) => setViewDir(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                <option value="Buy">Buy</option>
                <option value="Sell">Sell</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Model</div>
              <select
                value={viewModel}
                onChange={(e) => setViewModel(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                {(viewOpts.models || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Session</div>
              <select
                value={viewSession}
                onChange={(e) => setViewSession(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                {(viewOpts.sessions || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Month</div>
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                {(viewOpts.months || []).map((m) => (
                  <option key={m} value={String(m)}>
                    {MONTH_SHORT[m] || String(m)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Weekday</div>
              <select
                value={viewWeekday}
                onChange={(e) => setViewWeekday(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                {(viewOpts.dows || []).map((d) => (
                  <option key={d} value={String(d)}>
                    {DOW_SHORT[d] || String(d)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Hour</div>
              <select
                value={viewHour}
                onChange={(e) => setViewHour(e.target.value)}
                style={mapSelectStyle}
              >
                <option value="All">All</option>
                {(viewOpts.hours || []).map((h) => (
                  <option key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.65)",
              marginTop: 2,
            }}
          >
            Drag to pan · scroll to zoom · hover to inspect
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            minWidth: 320,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={onResetClusterMap}
              style={{
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(0,0,0,0.35)",
                color: "rgba(255,255,255,0.92)",
                borderRadius: 10,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 900,
                cursor: "pointer",
              }}
              title="Reset pan/zoom (R)"
            >
              Reset
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ position: "relative" }}>
                <input
                  value={searchUid}
                  onChange={(e) => {
                    setSearchUid(e.target.value);
                    setSearchStatus(null);
                    setSearchHighlightId(null);
                    searchHighlightIdRef.current = null;
                  }}
                  onFocus={() => setSearchFocus(true)}
                  onBlur={() => {
                    // Delay so clicking a suggestion doesn't immediately close the list.
                    setTimeout(() => setSearchFocus(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runSearch();
                  }}
                  placeholder="Search ID…"
                  style={{
                    width: 190,
                    padding: "7px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(0,0,0,0.30)",
                    color: "rgba(255,255,255,0.92)",
                    outline: "none",
                    fontSize: 11,
                  }}
                />

                {searchFocus && searchSuggestions.length ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "calc(100% + 6px)",
                      width: 190,
                      maxHeight: 260,
                      overflowY: "auto",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(0,0,0,0.82)",
                      backdropFilter: "blur(10px)",
                      "boxShadow": "none",
                      zIndex: 50,
                    }}
                  >
                    {searchSuggestions.map((s: any) => {
                      const title = String(s.disp || s.raw || "");
                      const sub =
                        s.raw && s.disp && String(s.raw) !== String(s.disp)
                          ? String(s.raw)
                          : "";

                      const kind = String(s.kind || "").toLowerCase();
                      const isLive = kind === "close";
                      const isOpen = !!(s as any).isOpen;
                      const isLib = !!(s as any).isLib;
                      const win = !!(s as any).win;
                      const libKey = String((s as any).libKey || "");

                      const bg = isLive
                        ? "rgba(255,140,0,0.20)"
                        : isOpen
                        ? "rgba(0,210,255,0.18)"
                        : isLib
                        ? cssColorWithAlpha(
                            colorForLibrary(libKey || "library"),
                            0.18
                          )
                        : win
                        ? "rgba(60,220,120,0.18)"
                        : "rgba(230,80,80,0.18)";

                      const borderCol = isLive
                        ? "rgba(255,140,0,0.85)"
                        : isOpen
                        ? "rgba(0,210,255,0.85)"
                        : isLib
                        ? cssColorWithAlpha(
                            colorForLibrary(libKey || "library"),
                            0.85
                          )
                        : win
                        ? "rgba(60,220,120,0.85)"
                        : "rgba(230,80,80,0.85)";

                      return (
                        <div
                          key={String(s.id || s.value || title)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            runSearch(String(s.value || s.disp || s.raw || ""));
                          }}
                          style={{
                            padding: "8px 10px",
                            cursor: "pointer",
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                            background: bg,
                            borderLeft: "4px solid " + borderCol,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 900,
                              color: "rgba(255,255,255,0.92)",
                              letterSpacing: "0.01em",
                            }}
                          >
                            {title}
                            {s.kind ? (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  fontWeight: 900,
                                  opacity: 0.65,
                                }}
                              >
                                {String(s.kind)}
                              </span>
                            ) : null}
                          </div>
                          {sub ? (
                            <div
                              style={{
                                marginTop: 2,
                                fontSize: 10,
                                opacity: 0.65,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {sub}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => runSearch()}
                style={{
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.92)",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Go
              </button>
              {searchStatus === "miss" ? (
                <div style={{ fontSize: 10, color: "rgba(255,140,0,0.95)" }}>
                  Not found
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={canvasWrapRef}
        style={{
          marginTop: 10,
          position: "relative",
          height: 440,
          borderRadius: 11,
          // Clear visual "armed" state while in selection mode
          border: heatmapOn
            ? "2px solid rgba(255,80,80,0.95)"
            : boxSelectMode
            ? "2px solid rgba(90,170,255,0.95)"
            : "1px solid rgba(255,255,255,0.10)",
          boxShadow: heatmapOn
            ? "0 0 0 2px rgba(255,80,80,0.28), 0 18px 45px rgba(0,0,0,0.55)"
            : boxSelectMode
            ? "0 0 0 2px rgba(90,170,255,0.32), 0 18px 45px rgba(0,0,0,0.55)"
            : undefined,
          overflow: "hidden",
        }}
      >
        <canvas
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: boxSelectMode
              ? "crosshair"
              : isDragging
              ? "grabbing"
              : "grab",
            touchAction: "none",
          }}
          ref={canvasRef}
        />

        {hoverWorldShown && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "5px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(0,0,0,0.42)",
              backdropFilter: "blur(10px)",
              "boxShadow": "none",
              color: "rgba(255,255,255,0.90)",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.01em",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            x&nbsp;{formatNumber(hoverWorldShown.x, 2)}
            &nbsp;&nbsp;·&nbsp;&nbsp;y&nbsp;{formatNumber(hoverWorldShown.y, 2)}
          </div>
        )}

        {heatmapOn && (
          <div
            style={{
              position: "absolute",
              left: 12,
              top: 12,
              minWidth: 250,
              maxWidth: 360,
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(255,110,110,0.55)",
              background:
                "rgba(255,80,80,0.16)",
              backdropFilter: "blur(10px)",
              "boxShadow": "none",
              color: "rgba(255,255,255,0.92)",
              // Allow clicking the All/Buy/Sell toggle. (Hover stats stop updating while the cursor is over the panel, which is fine.)
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div
                style={{
                  fontWeight: 950,
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  color: "rgba(255,170,170,0.98)",
                }}
              >
                Heatmap
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 950,
                  color: "rgba(255,220,220,0.90)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 999,
                  padding: "3px 9px",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                ON · ⌥H
              </div>
            </div>

            {!heatHover ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  opacity: 0.75,
                  lineHeight: 1.25,
                }}
              >
                Hover the map to see local expectancy (win rate, profit factor,
                EV) and dampness (trade density).
              </div>
            ) : (
              (() => {
                const mode = clusterGroupStatsMode;
                const count0 =
                  mode === "Buy"
                    ? Number(heatHover.buyCount || 0)
                    : mode === "Sell"
                    ? Number(heatHover.sellCount || 0)
                    : Number(heatHover.count || 0);
                const wr0 =
                  mode === "Buy"
                    ? Number(heatHover.buyWinRate || 0)
                    : mode === "Sell"
                    ? Number(heatHover.sellWinRate || 0)
                    : Number(heatHover.winRate || 0);
                const pf0 =
                  mode === "Buy"
                    ? (heatHover.buyProfitFactor as any)
                    : mode === "Sell"
                    ? (heatHover.sellProfitFactor as any)
                    : (heatHover.profitFactor as any);
                const ev0 =
                  mode === "Buy"
                    ? Number(heatHover.buyExpValue || 0)
                    : mode === "Sell"
                    ? Number(heatHover.sellExpValue || 0)
                    : Number(heatHover.expValue || 0);
                const aw0 =
                  mode === "Buy"
                    ? Number(heatHover.buyAvgWin || 0)
                    : mode === "Sell"
                    ? Number(heatHover.sellAvgWin || 0)
                    : Number(heatHover.avgWin || 0);
                const al0 =
                  mode === "Buy"
                    ? Number(heatHover.buyAvgLoss || 0)
                    : mode === "Sell"
                    ? Number(heatHover.sellAvgLoss || 0)
                    : Number(heatHover.avgLoss || 0);

                const fmtPf = (v: any) =>
                  v === Infinity
                    ? "∞"
                    : Number.isFinite(Number(v))
                    ? formatNumber(Number(v), 2)
                    : "—";

                return (
                  <>
                    {/* Stats mode toggle inside the heatmap panel */}
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{ fontSize: 10, fontWeight: 900, opacity: 0.85 }}
                      >
                        Stats
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(0,0,0,0.18)",
                          overflow: "hidden",
                        }}
                      >
                        {(["All", "Buy", "Sell"] as const).map((m) => {
                          const active = clusterGroupStatsMode === m;
                          const bg =
                            m === "Buy"
                              ? "rgba(40,160,80,0.26)"
                              : m === "Sell"
                              ? "rgba(200,50,50,0.26)"
                              : "rgba(120,80,255,0.22)";
                          return (
                            <button
                              key={m}
                              onClick={() => setClusterGroupStatsMode(m)}
                              style={{
                                fontSize: 10,
                                fontWeight: 950,
                                padding: "6px 9px",
                                border: "none",
                                borderRight:
                                  m !== "Sell"
                                    ? "1px solid rgba(255,255,255,0.10)"
                                    : "none",
                                background: active ? bg : "rgba(0,0,0,0.18)",
                                color: active
                                  ? "rgba(255,255,255,0.94)"
                                  : "rgba(255,255,255,0.72)",
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                              title={`Show ${m} stats`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        justifyContent: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          display: "inline-flex",
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(0,0,0,0.18)",
                          overflow: "hidden",
                        }}
                      >
                        {(["All", "Library", "Live"] as const).map(
                          (m, idx, arr) => {
                            const active = clusterGroupUniverse === m;
                            const bg =
                              m === "Live"
                                ? "rgba(60,220,120,0.18)"
                                : m === "All"
                                ? "rgba(255,255,255,0.14)"
                                : "rgba(180,120,255,0.18)";
                            return (
                              <button
                                key={m}
                                onClick={() => setClusterGroupUniverse(m)}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 950,
                                  padding: "6px 10px",
                                  border: "none",
                                  borderRight:
                                    idx !== (arr as any).length - 1
                                      ? "1px solid rgba(255,255,255,0.10)"
                                      : "none",
                                  background: active ? bg : "rgba(0,0,0,0.18)",
                                  color: active
                                    ? "rgba(255,255,255,0.94)"
                                    : "rgba(255,255,255,0.72)",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                                title={
                                  m === "Live"
                                    ? "Show stats of live trades that landed in each cluster"
                                    : "Show the original (library) cluster stats"
                                }
                              >
                                {m}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "grid",
                        gridTemplateColumns: "112px 1fr",
                        gap: "6px 10px",
                        fontSize: 11,
                        lineHeight: 1.2,
                      }}
                    >
                      <div style={{ opacity: 0.65 }}>Dampness</div>
                      <div
                        style={{
                          fontWeight: 950,
                          color: heatDampColor(heatHover.dampness || 0),
                        }}
                      >
                        {formatNumber((heatHover.dampness || 0) * 100, 0)}%
                      </div>

                      <div style={{ opacity: 0.65 }}>Density</div>
                      <div
                        style={{
                          fontWeight: 900,
                          color: heatDampColor(heatHover.dampness || 0),
                        }}
                      >
                        {Math.round(count0 || 0)}
                      </div>

                      <div style={{ opacity: 0.65 }}>Win Rate</div>
                      <div
                        style={{
                          fontWeight: 950,
                          color: heatWinRateColor(wr0 || 0),
                        }}
                      >
                        {count0 > 0
                          ? formatNumber((wr0 || 0) * 100, 1) + "%"
                          : "—"}
                      </div>

                      <div style={{ opacity: 0.65 }}>Profit Factor</div>
                      <div
                        style={{
                          fontWeight: 950,
                          color: heatProfitFactorColor(pf0),
                        }}
                      >
                        {count0 > 0 ? fmtPf(pf0) : "—"}
                      </div>

                      <div style={{ opacity: 0.65 }}>Average PnL</div>
                      <div
                        style={{
                          fontWeight: 1000,
                          color:
                            (ev0 || 0) >= 0
                              ? "rgba(60,220,120,0.98)"
                              : "rgba(230,80,80,0.98)",
                        }}
                      >
                        {count0 > 0 ? formatNumber(ev0 || 0, 2) : "—"}
                      </div>

                      <div style={{ opacity: 0.65 }}>Average Win</div>
                      <div
                        style={{
                          fontWeight: 950,
                          color: "rgba(60,220,120,0.98)",
                        }}
                      >
                        {count0 > 0 ? formatNumber(aw0 || 0, 2) : "—"}
                      </div>

                      <div style={{ opacity: 0.65 }}>Average Loss</div>
                      <div
                        style={{
                          fontWeight: 950,
                          color: "rgba(230,80,80,0.98)",
                        }}
                      >
                        {count0 > 0 ? formatNumber(al0 || 0, 2) : "—"}
                      </div>

                      {mode === "All" ? (
                        <>
                          <div style={{ opacity: 0.65 }}>Bias</div>
                          <div
                            style={{
                              fontWeight: 950,
                              color: heatBiasColor(
                                heatHover.buys || 0,
                                heatHover.sells || 0
                              ),
                            }}
                          >
                            {(() => {
                              const b = (heatHover.buys || 0) as number;
                              const s = (heatHover.sells || 0) as number;
                              const tot = b + s;
                              if (!tot) return "—";
                              const buyPct = b / tot;
                              const sellPct = s / tot;
                              if (buyPct >= 0.55)
                                return `BUY ${formatNumber(buyPct * 100, 0)}%`;
                              if (sellPct >= 0.55)
                                return `SELL ${formatNumber(
                                  sellPct * 100,
                                  0
                                )}%`;
                              return "Mixed";
                            })()}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ opacity: 0.65 }}>Direction</div>
                          <div style={{ fontWeight: 950 }}>{mode}</div>
                        </>
                      )}
                    </div>
                  </>
                );
              })()
            )}
          </div>
        )}

        {(boxSelectMode ||
          boxStart ||
          boxStats ||
          lassoIsDrawing ||
          lassoFinal ||
          lassoStats) &&
          (() => {
            const isRect = selShape === "rect";
            const isLasso = selShape === "lasso";
            const hasRect = isRect && !!boxRect;
            const hasA = isRect && !!boxStart;
            const hasB = isRect && !!boxEnd;
            const hasLasso = isLasso && !!lassoFinal && lassoFinal.length >= 3;
            const stats = isLasso ? lassoStats : boxStats;
            const mode = clusterGroupStatsMode;
            const ms = stats
              ? mode === "Buy"
                ? (stats as any).buy
                : mode === "Sell"
                ? (stats as any).sell
                : (stats as any).all
              : null;

            const hint = boxSelectMode
              ? isLasso
                ? lassoIsDrawing
                  ? "Free draw — release to finish the selection."
                  : hasLasso
                  ? "Free draw locked — draw again to replace (or Clear)."
                  : "Free draw — left-click and drag to draw a region."
                : !hasA
                ? "Selection mode ON — right-click twice for a rectangle, or left-drag to draw."
                : !hasB
                ? "Move mouse to size the rectangle, then right-click again to lock."
                : "Rectangle locked — right-click to start a new rectangle (or Clear)."
              : stats
              ? "Selection mode OFF — press ⌥T to start a new selection."
              : "Press ⌥T to enter selection mode.";

            return (
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  top: heatmapOn ? 128 : 12,
                  minWidth: 240,
                  maxWidth: 340,
                  padding: 10,
                  borderRadius: 8,
                  border: boxSelectMode
                    ? "1px solid rgba(210,170,255,0.55)"
                    : "1px solid rgba(160,90,255,0.35)",
                  background:
                    "rgba(120,60,200,0.22)",
                  backdropFilter: "blur(10px)",
                  "boxShadow": "none",
                  color: "rgba(255,255,255,0.92)",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        fontWeight: 950,
                        fontSize: 12,
                        letterSpacing: "0.02em",
                        color: "rgba(210,170,255,0.98)",
                      }}
                    >
                      Box Selection
                    </div>
                    <button
                      onClick={() => setBoxSelectMode((v) => !v)}
                      style={{
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: boxSelectMode
                          ? "rgba(210,170,255,0.14)"
                          : "rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.86)",
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontSize: 10,
                        fontWeight: 950,
                        cursor: "pointer",
                      }}
                      title="Toggle selection mode (⌥T)"
                    >
                      {boxSelectMode ? "ON" : "OFF"} · ⌥T
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setBoxStart(null);
                      setBoxEnd(null);
                      setBoxPreview(null);
                      setSelShape(null);
                      setLassoFinal(null);
                      setLassoIsDrawing(false);
                      lassoRef.current.drawing = false;
                      lassoRef.current.pts = [];
                    }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.86)",
                      borderRadius: 10,
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    opacity: 0.78,
                    lineHeight: 1.25,
                  }}
                >
                  {hint}
                </div>

                {/* Stats mode toggle (All / Buy / Sell) */}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85 }}>
                    Stats
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.18)",
                      overflow: "hidden",
                    }}
                  >
                    {(["All", "Buy", "Sell"] as const).map((m) => {
                      const active = clusterGroupStatsMode === m;
                      const bg =
                        m === "Buy"
                          ? "rgba(40,160,80,0.26)"
                          : m === "Sell"
                          ? "rgba(200,50,50,0.26)"
                          : "rgba(120,80,255,0.22)";
                      return (
                        <button
                          key={m}
                          onClick={() => setClusterGroupStatsMode(m)}
                          style={{
                            fontSize: 10,
                            fontWeight: 950,
                            padding: "6px 9px",
                            border: "none",
                            borderRight:
                              m !== "Sell"
                                ? "1px solid rgba(255,255,255,0.10)"
                                : "none",
                            background: active ? bg : "rgba(0,0,0,0.18)",
                            color: active
                              ? "rgba(255,255,255,0.94)"
                              : "rgba(255,255,255,0.72)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          title={`Show ${m} stats`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {ms ? (
                  <div
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: "112px 1fr",
                      gap: "6px 10px",
                      fontSize: 11,
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ opacity: 0.65 }}>Trades</div>
                    <div style={{ fontWeight: 900 }}>{ms.count}</div>

                    <div style={{ opacity: 0.65 }}>Total PnL</div>
                    <div
                      style={{
                        fontWeight: 1000,
                        color:
                          ms.totalPnl >= 0
                            ? "rgba(60,220,120,0.98)"
                            : "rgba(230,80,80,0.98)",
                      }}
                    >
                      {(ms.totalPnl >= 0 ? "+" : "-") +
                        "$" +
                        formatNumber(Math.abs(ms.totalPnl), 2)}
                    </div>

                    <div style={{ opacity: 0.65 }}>Average PnL</div>
                    <div style={{ fontWeight: 950 }}>
                      {(ms.expValue >= 0 ? "+" : "-") +
                        "$" +
                        formatNumber(Math.abs(ms.expValue), 2)}
                    </div>

                    <div style={{ opacity: 0.65 }}>Win Rate</div>
                    <div style={{ fontWeight: 900 }}>
                      {Math.round(ms.winRate * 100)}%
                    </div>

                    <div style={{ opacity: 0.65 }}>Profit Factor</div>
                    <div style={{ fontWeight: 950 }}>
                      {ms.profitFactor === Infinity
                        ? "∞"
                        : Number.isFinite(ms.profitFactor)
                        ? formatNumber(ms.profitFactor, 2)
                        : "—"}
                    </div>

                    <div style={{ opacity: 0.65 }}>Average Win</div>
                    <div
                      style={{
                        fontWeight: 950,
                        color: "rgba(60,220,120,0.98)",
                      }}
                    >
                      {ms.count > 0
                        ? "$" + formatNumber(ms.avgWin || 0, 2)
                        : "—"}
                    </div>

                    <div style={{ opacity: 0.65 }}>Average Loss</div>
                    <div
                      style={{ fontWeight: 950, color: "rgba(230,80,80,0.98)" }}
                    >
                      {ms.count > 0
                        ? "$" + formatNumber(ms.avgLoss || 0, 2)
                        : "—"}
                    </div>

                    {mode === "All" ? (
                      <>
                        <div style={{ opacity: 0.65 }}>Buy Trades</div>
                        <div style={{ fontWeight: 900 }}>
                          {(stats as any)?.buys ?? 0}
                        </div>

                        <div style={{ opacity: 0.65 }}>Sell Trades</div>
                        <div style={{ fontWeight: 900 }}>
                          {(stats as any)?.sells ?? 0}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ opacity: 0.65 }}>Direction</div>
                        <div style={{ fontWeight: 900 }}>{mode}</div>
                      </>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      fontWeight: 850,
                      color: "rgba(255,255,255,0.86)",
                    }}
                  >
                    Make a selection to define the box.
                  </div>
                )}
              </div>
            );
          })()}
        {selectedNode &&
          (() => {
            const tKey = themeKeyForNode(selectedNode);
            const th = themeForKey(tKey);
            const pnlNum =
              typeof selectedNode.unrealizedPnl === "number"
                ? selectedNode.unrealizedPnl
                : typeof selectedNode.pnl === "number"
                ? selectedNode.pnl
                : null;
            const pnlColor =
              typeof pnlNum === "number"
                ? pnlNum >= 0
                  ? "rgba(60,220,120,0.98)"
                  : "rgba(230,80,80,0.98)"
                : "rgba(255,255,255,0.90)";
            const dirColor =
              selectedNode.dir === 1
                ? "rgba(60,220,120,0.98)"
                : "rgba(230,80,80,0.98)";

            const exitRaw = (selectedNode as any).exitReason;
            const exitU = String(exitRaw || "")
              .trim()
              .toUpperCase();
            const exitLabel =
              (selectedNode as any).isOpen ||
              !exitU ||
              exitU === "NONE" ||
              exitU === "-"
                ? "—"
                : exitU === "TP" || exitU.includes("TAKE")
                ? "TP"
                : exitU === "SL" || exitU.includes("STOP")
                ? "SL"
                : exitU === "BE" || exitU.includes("BREAK")
                ? "BE"
                : exitU === "TSL" || exitU.includes("TRAIL")
                ? "TSL"
                : exitU.includes("MIM") || exitU.includes("MIT")
                ? "MIT"
                : exitU.includes("AI")
                ? "AI"
                : exitU.includes("MODEL")
                ? "Model"
                : String(exitRaw || "—");

            const exitColor =
              exitLabel === "TP"
                ? "rgba(60,220,120,0.98)"
                : exitLabel === "SL"
                ? "rgba(230,80,80,0.98)"
                : exitLabel === "BE"
                ? "rgba(250,210,70,0.98)"
                : exitLabel === "TSL"
                ? "rgba(255,140,0,0.98)"
                : exitLabel === "Model"
                ? "rgba(190,120,255,0.98)"
                : exitLabel === "AI"
                ? "rgba(90,210,255,0.98)"
                : exitLabel === "MIT"
                ? "rgba(255,175,90,0.98)"
                : "rgba(255,255,255,0.90)";
            const entryTimeRaw =
              (selectedNode as any).entryTime ||
              candles?.[selectedNode.signalIndex]?.time ||
              (selectedNode as any).time ||
              "";
            const exitTimeRaw =
              (selectedNode as any).exitTime ||
              (selectedNode as any).exit_time ||
              (selectedNode as any).exitTimestamp ||
              (selectedNode as any).exitTs ||
              (selectedNode as any).tExit ||
              (selectedNode as any).t1 ||
              (selectedNode as any).exit ||
              (selectedNode as any).end ||
              (selectedNode as any).endTime ||
              (selectedNode as any).closeTime ||
              (selectedNode as any).closeTimestamp ||
              (selectedNode as any).closeTs ||
              (selectedNode as any).tClose ||
              (selectedNode as any).exitDate ||
              (selectedNode as any).trade?.exitTime ||
              (selectedNode as any).trade?.exit_time ||
              (selectedNode as any).trade?.exitTimestamp ||
              (selectedNode as any).trade?.exitTs ||
              (selectedNode as any).trade?.closeTime ||
              (selectedNode as any).trade?.tExit ||
              (typeof (selectedNode as any).exitIndex === "number"
                ? candles?.[(selectedNode as any).exitIndex]?.time
                : "") ||
              (typeof (selectedNode as any).closeIndex === "number"
                ? candles?.[(selectedNode as any).closeIndex]?.time
                : "") ||
              (typeof (selectedNode as any).endIndex === "number"
                ? candles?.[(selectedNode as any).endIndex]?.time
                : "") ||
              "";

            const entryDt = entryTimeRaw
              ? parseDateFromString(entryTimeRaw, parseMode)
              : null;
            const entryDow =
              entryDt != null
                ? parseMode === "utc"
                  ? entryDt.getUTCDay()
                  : entryDt.getDay()
                : null;
            const entryDowKey =
              typeof entryDow === "number" ? DOW_SHORT[entryDow] : "—";

            const sessionLabel =
              selectedNode.session ||
              sessionFromTime(entryTimeRaw, parseMode) ||
              "—";
            const durEndRaw = (selectedNode as any).isOpen
              ? candles?.[sliderValue]?.time ??
                candles?.[candles.length - 1]?.time ??
                ""
              : exitTimeRaw;

            // Prefer index-based duration if indices are available; fallback to timestamp diff otherwise.
            const candleMins = inferCandleMinutes(candles, parseMode);

            const entryIdxNum =
              typeof (selectedNode as any).entryIndex === "number"
                ? (selectedNode as any).entryIndex
                : typeof (selectedNode as any).trade?.entryIndex === "number"
                ? (selectedNode as any).trade.entryIndex
                : null;

            const exitIdxNum0 =
              typeof (selectedNode as any).exitIndex === "number"
                ? (selectedNode as any).exitIndex
                : typeof (selectedNode as any).closeIndex === "number"
                ? (selectedNode as any).closeIndex
                : typeof (selectedNode as any).endIndex === "number"
                ? (selectedNode as any).endIndex
                : typeof (selectedNode as any).trade?.exitIndex === "number"
                ? (selectedNode as any).trade.exitIndex
                : typeof (selectedNode as any).trade?.closeIndex === "number"
                ? (selectedNode as any).trade.closeIndex
                : null;

            const exitIdxNum = (selectedNode as any).isOpen
              ? sliderValue
              : exitIdxNum0;

            const durMins =
              entryIdxNum != null && exitIdxNum != null && candleMins != null
                ? Math.max(0, (exitIdxNum - entryIdxNum) * candleMins)
                : entryTimeRaw && durEndRaw
                ? minutesBetween(entryTimeRaw, durEndRaw, parseMode)
                : null;
            const durLabel =
              typeof durMins === "number" ? formatMinutesShort(durMins) : "—";

            // Selected-node panel tint should match its grouping (cluster/library) color.
            const nodeColorKey = (() => {
              const n: any = selectedNode as any;
              const hdbId =
                n.hdbClusterId ??
                n.hdbId ??
                n.hdbCluster ??
                n.clusterId ??
                n.hdbscanClusterId ??
                n.hdbscanId;

              if (
                hdbId != null &&
                hdbId !== "" &&
                hdbId !== -1 &&
                hdbId !== "-1"
              ) {
                return "hdbscan_cluster_" + String(hdbId);
              }

              return (
                n.groupColorKey ||
                n.clusterColorKey ||
                n.clusterKey ||
                n.groupKey ||
                n.libraryKey ||
                n.libKey ||
                n.library ||
                n.sourceKey ||
                n.source ||
                n.modelKey ||
                n.id ||
                "neutral"
              );
            })();

            const groupCol = colorForLibrary(String(nodeColorKey));
            const groupBg = `linear-gradient(135deg, ${cssColorWithAlpha(
              groupCol,
              0.26
            )}, rgba(0,0,0,0.62))`;
            const groupBorder = `1px solid ${cssColorWithAlpha(
              groupCol,
              0.46
            )}`;
            const groupShadow = `0 18px 40px rgba(0,0,0,0.60), 0 0 0 1px ${cssColorWithAlpha(
              groupCol,
              0.12
            )}`;

            return (
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: 12,
                  minWidth: 220,
                  maxWidth: 320,
                  padding: 10,
                  borderRadius: 8,
                  border: groupBorder,
                  background: groupBg,
                  backdropFilter: "blur(10px)",
                  boxShadow: groupShadow,
                  color: "rgba(255,255,255,0.92)",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 950,
                      fontSize: 12,
                      letterSpacing: "0.02em",
                      color: th.accent,
                    }}
                  >
                    Selected
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.86)",
                      borderRadius: 10,
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gridTemplateColumns: "112px 1fr",
                    gap: "6px 10px",
                    fontSize: 11,
                    lineHeight: 1.2,
                  }}
                >
                  <div style={{ opacity: 0.65 }}>ID</div>
                  <div style={{ fontWeight: 850 }}>
                    <div style={{ fontWeight: 850 }}>
                      {displayIdForNode(selectedNode as any)}
                    </div>
                  </div>

                  <div style={{ opacity: 0.65 }}>Kind</div>
                  <div style={{ fontWeight: 900, color: th.accent }}>
                    {selectedNode.kind}
                  </div>

                  <div style={{ opacity: 0.65 }}>Library</div>
                  <div style={{ fontWeight: 900, color: th.titleColor }}>
                    {(() => {
                      const base = (selectedNode as any).parentId
                        ? (nodeById as any).get(
                            String((selectedNode as any).parentId || "")
                          ) || selectedNode
                        : selectedNode;
                      const lid =
                        (base as any).libId ?? (base as any).metaLib ?? null;
                      if (!lid)
                        return (base as any).kind === "trade" ? "Trades" : "—";
                      const def = (AI_LIBRARY_DEF_BY_ID as any)[String(lid)];
                      return def
                        ? def.name || def.label || def.id || String(lid)
                        : String(lid);
                    })()}
                  </div>

                  <div style={{ opacity: 0.65 }}>Direction</div>
                  <div style={{ fontWeight: 950, color: dirColor }}>
                    {selectedNode.dir === 1 ? "Buy" : "Sell"}
                  </div>

                  <div style={{ opacity: 0.65 }}>Entry Date</div>
                  <div style={{ fontWeight: 800 }}>
                    {entryTimeRaw
                      ? formatDateTime(entryTimeRaw, parseMode)
                      : "—"}
                  </div>

                  <div style={{ opacity: 0.65 }}>Exit Date</div>
                  <div style={{ fontWeight: 800 }}>
                    {selectedNode.isOpen || !exitTimeRaw
                      ? "—"
                      : formatDateTime(exitTimeRaw, parseMode)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Duration</div>
                  <div style={{ fontWeight: 800 }}>{durLabel}</div>

                  <div style={{ opacity: 0.65 }}>Session</div>
                  <div style={{ fontWeight: 800 }}>{sessionLabel}</div>

                  <div style={{ opacity: 0.65 }}>Weekday</div>
                  <div style={{ fontWeight: 800 }}>{entryDowKey}</div>

                  <div style={{ opacity: 0.65 }}>Entry Method</div>
                  <div style={{ fontWeight: 900, color: th.titleColor }}>
                    {(selectedNode as any).entryModel ||
                      (selectedNode as any).origModel ||
                      (selectedNode as any).chunkType ||
                      "—"}
                  </div>

                  <div style={{ opacity: 0.65 }}>AI Entry</div>
                  <div
                    style={{
                      fontWeight: 950,
                      color: (() => {
                        const am = (selectedNode as any).aiMode;
                        return am === "model"
                          ? "rgba(190,120,255,0.98)"
                          : am === "filter"
                          ? "rgba(210,170,255,0.95)"
                          : "rgba(255,255,255,0.90)";
                      })(),
                    }}
                  >
                    {(() => {
                      const am = (selectedNode as any).aiMode;
                      return am === "model"
                        ? "AI Model"
                        : am === "filter"
                        ? "AI Filter"
                        : "Model";
                    })()}
                  </div>

                  <div style={{ opacity: 0.65 }}>Cluster Win Rate</div>
                  <div
                    style={{ fontWeight: 900, color: "rgba(120,190,255,0.92)" }}
                  >
                    {(() => {
                      if (aiMethod === "hdbscan") {
                        const info = hdbClusterInfoForNode(selectedNode);
                        const v = info?.wr;
                        const cid = info?.clusterId;
                        if (v == null) return "—";
                        const pct = Math.round(v * 100);
                        return cid != null && Number.isFinite(cid)
                          ? `${pct}% (HD #${cid})`
                          : `${pct}%`;
                      }
                      const v = hdbConfidenceForNode(selectedNode);
                      return v == null ? "—" : `${Math.round(v * 100)}%`;
                    })()}
                  </div>

                  <div style={{ opacity: 0.65 }}>MIT ID</div>
                  <div
                    style={{
                      ...mono(),
                      fontSize: 11,
                      fontWeight: 950,
                      color: "rgba(210,170,255,0.95)",
                    }}
                  >
                    {(() => {
                      const k = String(
                        (selectedNode as any)?.kind || ""
                      ).toLowerCase();
                      const isSuppressed =
                        k === "library" &&
                        (!!(selectedNode as any).suppressed ||
                          !!(selectedNode as any).metaSuppressed ||
                          String(
                            (selectedNode as any).libId ??
                              (selectedNode as any).metaLib ??
                              (selectedNode as any).library ??
                              (selectedNode as any).metaLibrary ??
                              ""
                          )
                            .toLowerCase()
                            .trim() === "suppressed");
                      if (k !== "trade" && !isSuppressed) return "—";
                      const key = String(
                        (selectedNode as any)?.uid ??
                          (selectedNode as any)?.tradeUid ??
                          (selectedNode as any)?.id ??
                          (selectedNode as any)?.tradeId ??
                          ""
                      );
                      const mitRef = key ? (mitMap as any).get(key) : null;
                      return mitRef ? displayIdForNode(mitRef as any) : "—";
                    })()}
                  </div>

                  <div style={{ opacity: 0.65 }}>Exit Method</div>
                  <div style={{ fontWeight: 950, color: exitColor }}>
                    {exitLabel}
                  </div>

                  <div style={{ opacity: 0.65 }}>PnL</div>
                  <div style={{ fontWeight: 1000, color: pnlColor }}>
                    {typeof selectedNode.unrealizedPnl === "number"
                      ? `${
                          selectedNode.unrealizedPnl >= 0 ? "+" : "-"
                        }$${formatNumber(
                          Math.abs(selectedNode.unrealizedPnl),
                          2
                        )}`
                      : typeof selectedNode.pnl === "number"
                      ? `${selectedNode.pnl >= 0 ? "+" : "-"}$${formatNumber(
                          Math.abs(selectedNode.pnl),
                          2
                        )}`
                      : "—"}
                  </div>
                </div>
              </div>
            );
          })()}

        {selectedGroup &&
          (() => {
            const g: any =
              (hdbGroupsUI || []).find(
                (gg: any) => String((gg as any).id) === String(selectedGroup)
              ) ||
              (typeof selectedGroup === "object"
                ? (selectedGroup as any)
                : null);
            if (!g) return null;
            const st: any = g || {};
            const overallCount = Number(st.count) || 0;
            const buys = Number(st.buys) || 0;
            const sells = Number(st.sells) || 0;
            const ms = pickClusterGroupStats(st, clusterGroupStatsMode);
            const count = Number(ms.count) || 0;
            const wins = Number(ms.wins) || 0;
            const losses = Number(ms.losses) || 0;
            const wr = Number(ms.winRate) || 0;
            const tp = Number(ms.totalPnl) || 0;
            const ap = Number(ms.avgPnl) || 0;
            const aw = Number(ms.avgWin) || 0;
            const al = Number(ms.avgLoss) || 0;
            const pf = (ms as any).profitFactor;
            const payoff = (ms as any).payoff;
            const mxw = Number(ms.maxWin) || 0;
            const mxl = Number(ms.maxLoss) || 0;
            const tKey = wr >= 0.6 ? "green" : wr <= 0.4 ? "red" : "neutral";
            const th = themeForKey(tKey);

            const groupColorKey = String((g as any).type || "")
              .toLowerCase()
              .includes("hdb")
              ? "hdbscan_cluster_" + String((g as any).id)
              : String(
                  (g as any)?.stats?.key ||
                    (g as any)?.stats?.colorKey ||
                    (g as any).id ||
                    ""
                );
            const groupCol = colorForLibrary(groupColorKey);
            const groupBg = `linear-gradient(135deg, ${cssColorWithAlpha(
              groupCol,
              0.26
            )}, rgba(0,0,0,0.62))`;
            const groupBorder = `1px solid ${cssColorWithAlpha(
              groupCol,
              0.46
            )}`;
            const groupShadow = `0 18px 40px rgba(0,0,0,0.60), 0 0 0 1px ${cssColorWithAlpha(
              groupCol,
              0.12
            )}`;

            const fmtPf = (v: any) =>
              v === Infinity
                ? "∞"
                : Number.isFinite(Number(v))
                ? formatNumber(Number(v), 2)
                : "—";

            const title = `HDB Cluster #${Number(g.id)}`;

            const buyPct =
              overallCount > 0 ? buys / Math.max(1, overallCount) : 0;
            const modeLabel =
              clusterGroupStatsMode === "All" ? "All" : clusterGroupStatsMode;
            return (
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: 12,
                  minWidth: 220,
                  maxWidth: 320,
                  padding: 10,
                  borderRadius: 8,
                  border: groupBorder,
                  background: groupBg,
                  backdropFilter: "blur(10px)",
                  boxShadow: groupShadow,
                  color: "rgba(255,255,255,0.92)",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 950,
                      fontSize: 12,
                      letterSpacing: "0.02em",
                      color: th.accent,
                    }}
                  >
                    Selected Group
                  </div>

                  <button
                    onClick={() => {
                      selectedGroupRef.current = null;
                      setSelectedGroup(null);
                    }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.86)",
                      borderRadius: 10,
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                  }}
                >
                  <div
                    title="Choose whether group stats are based on Library clusters, Live trades (incl. suppressed), or both"
                    style={{
                      display: "inline-flex",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.18)",
                      overflow: "hidden",
                    }}
                  >
                    {(["All", "Library", "Live"] as const).map(
                      (u, idx, arr) => {
                        const active = clusterGroupUniverse === u;
                        const bg =
                          u === "Live"
                            ? "rgba(60,220,120,0.18)"
                            : u === "All"
                            ? "rgba(120,80,255,0.22)"
                            : "rgba(180,120,255,0.18)";
                        return (
                          <button
                            key={u}
                            onClick={() => setClusterGroupUniverse(u)}
                            style={{
                              fontSize: 9,
                              fontWeight: 950,
                              padding: "4px 7px",
                              border: "none",
                              borderRight:
                                idx !== (arr as any).length - 1
                                  ? "1px solid rgba(255,255,255,0.10)"
                                  : "none",
                              background: active ? bg : "rgba(0,0,0,0.18)",
                              color: active
                                ? "rgba(255,255,255,0.94)"
                                : "rgba(255,255,255,0.72)",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                            title={
                              u === "Library"
                                ? "Library stats per cluster"
                                : u === "Live"
                                ? "Live trade stats per cluster (includes suppressed)"
                                : "Combined Library + Live stats per cluster"
                            }
                          >
                            {u}
                          </button>
                        );
                      }
                    )}
                  </div>

                  <div
                    style={{
                      display: "inline-flex",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.18)",
                      overflow: "hidden",
                    }}
                  >
                    {(["All", "Buy", "Sell"] as const).map((m) => {
                      const active = clusterGroupStatsMode === m;
                      const bg =
                        m === "Buy"
                          ? "rgba(40,160,80,0.26)"
                          : m === "Sell"
                          ? "rgba(200,50,50,0.26)"
                          : "rgba(120,80,255,0.22)";
                      return (
                        <button
                          key={m}
                          onClick={() => setClusterGroupStatsMode(m)}
                          style={{
                            fontSize: 9,
                            fontWeight: 950,
                            padding: "4px 7px",
                            border: "none",
                            borderRight:
                              m !== "Sell"
                                ? "1px solid rgba(255,255,255,0.10)"
                                : "none",
                            background: active ? bg : "rgba(0,0,0,0.18)",
                            color: active
                              ? "rgba(255,255,255,0.94)"
                              : "rgba(255,255,255,0.72)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          title={`Show ${m} stats`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 950 }}>
                  {title}
                </div>

                {aiMethod === "hdbscan" && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      opacity: 0.75,
                      lineHeight: 1.2,
                    }}
                  >
                    {(() => {
                      const parts: string[] = [];
                      if (
                        typeof HDB_MODALITY_DISTINCTION === "string" &&
                        HDB_MODALITY_DISTINCTION.length
                      ) {
                        parts.push(`Distinction: ${HDB_MODALITY_DISTINCTION}`);
                      }
                      const mods = activeModSet
                        ? Array.from(activeModSet).sort()
                        : [];
                      parts.push(
                        `Enabled: ${mods.length ? mods.join(", ") : "none"}`
                      );
                      return parts.join(" · ");
                    })()}
                  </div>
                )}

                <div
                  style={{
                    marginTop: 8,
                    display: "grid",
                    gridTemplateColumns: "112px 1fr",
                    gap: "6px 10px",
                    fontSize: 11,
                    lineHeight: 1.2,
                  }}
                >
                  <div style={{ opacity: 0.65 }}>Mode</div>
                  <div style={{ fontWeight: 950 }}>{modeLabel}</div>

                  <div style={{ opacity: 0.65 }}>Win Rate</div>
                  <div style={{ fontWeight: 1000 }}>
                    {count > 0 ? `${formatNumber(wr * 100, 1)}%` : "—"}
                  </div>

                  <div style={{ opacity: 0.65 }}>Count</div>
                  <div style={{ fontWeight: 900 }}>
                    {formatNumber(count, 0)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Wins / Losses</div>
                  <div style={{ fontWeight: 900 }}>
                    <span style={{ color: "rgba(60,220,120,0.98)" }}>
                      {formatNumber(wins, 0)}
                    </span>
                    <span style={{ opacity: 0.55 }}> / </span>
                    <span style={{ color: "rgba(230,80,80,0.98)" }}>
                      {formatNumber(losses, 0)}
                    </span>
                  </div>

                  <div style={{ opacity: 0.65 }}>Buy Trades / Sell Trades</div>
                  <div style={{ fontWeight: 900 }}>
                    <span style={{ color: "rgba(60,220,120,0.98)" }}>
                      {formatNumber(buys, 0)}
                    </span>
                    <span style={{ opacity: 0.55 }}> / </span>
                    <span style={{ color: "rgba(230,80,80,0.98)" }}>
                      {formatNumber(sells, 0)}
                    </span>
                    <span style={{ opacity: 0.65 }}>
                      {overallCount
                        ? `  (${formatNumber(buyPct * 100, 0)}% BUY)`
                        : ""}
                    </span>
                  </div>

                  <div style={{ opacity: 0.65 }}>Profit Factor</div>
                  <div style={{ fontWeight: 950 }}>
                    {count > 0 ? fmtPf(pf) : "—"}
                  </div>

                  <div style={{ opacity: 0.65 }}>Payoff</div>
                  <div style={{ fontWeight: 950 }}>
                    {count > 0 ? fmtPf(payoff) : "—"}
                  </div>

                  <div style={{ opacity: 0.65 }}>Total PnL</div>
                  <div
                    style={{
                      fontWeight: 1000,
                      color:
                        tp >= 0
                          ? "rgba(60,220,120,0.98)"
                          : "rgba(230,80,80,0.98)",
                    }}
                  >
                    {tp >= 0 ? "+" : "-"}${formatNumber(Math.abs(tp), 0)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Average PnL</div>
                  <div
                    style={{
                      fontWeight: 950,
                      color:
                        ap >= 0
                          ? "rgba(60,220,120,0.90)"
                          : "rgba(230,80,80,0.90)",
                    }}
                  >
                    {ap >= 0 ? "+" : "-"}${formatNumber(Math.abs(ap), 2)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Average Win</div>
                  <div
                    style={{ fontWeight: 900, color: "rgba(60,220,120,0.90)" }}
                  >
                    +${formatNumber(Math.abs(aw), 2)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Average Loss</div>
                  <div
                    style={{ fontWeight: 900, color: "rgba(230,80,80,0.90)" }}
                  >
                    -${formatNumber(Math.abs(al), 2)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Max Win</div>
                  <div
                    style={{ fontWeight: 900, color: "rgba(60,220,120,0.90)" }}
                  >
                    +${formatNumber(Math.abs(mxw), 0)}
                  </div>

                  <div style={{ opacity: 0.65 }}>Max Loss</div>
                  <div
                    style={{ fontWeight: 900, color: "rgba(230,80,80,0.90)" }}
                  >
                    -${formatNumber(Math.abs(mxl), 0)}
                  </div>
                </div>
              </div>
            );
          })()}

        {tooltip &&
          (() => {
            const th = themeForKey((tooltip as any).themeKey || "neutral");
            return (
              <div
                style={{
                  position: "absolute",
                  left: tooltip.x,
                  top: tooltip.y,
                  pointerEvents: "none",
                  background: th.bg,
                  border: th.border,
                  borderRadius: 10,
                  padding: "8px 10px",
                  maxWidth: 380,
                  color: "rgba(255,255,255,0.96)",
                  fontSize: 10,
                  lineHeight: 1.35,
                  boxShadow: th.shadow,
                  backdropFilter: "blur(6px)",
                }}
              >
                {tooltip.lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      color: i === 0 ? th.accent : lineColor(l),
                      fontWeight: i === 0 ? 950 : 800,
                      opacity: i === 0 ? 1 : 0.95,
                    }}
                  >
                    {l}
                  </div>
                ))}
              </div>
            );
          })()}
      </div>

      <div
        ref={sliderContainerRef}
        onMouseMove={(e) => {
          const container = sliderContainerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const offsetX = e.clientX - rect.left;
          const width = rect.width;
          const ratio =
            width > 0 ? Math.max(0, Math.min(1, offsetX / width)) : 0;
          const maxIdx = Math.max(0, candles.length - 1);
          const idx = Math.round(ratio * maxIdx);
          const t = candles[idx]?.time;
          const text = formatDateTime(t, parseMode);
          setSliderHover({ pos: offsetX, text });
        }}
        onMouseLeave={() => {
          setSliderHover(null);
        }}
        style={{
          marginTop: 10,
          width: "100%",
          position: "relative",
        }}
      >
        {sliderHover && (
          <div
            style={{
              position: "absolute",
              left: sliderHover.pos,
              top: -20,
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.85)",
              color: "rgba(255,255,255,0.95)",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 9,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {sliderHover.text}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={Math.max(0, candles.length - 1)}
          value={sliderValue}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSliderValue(v);
          }}
          className="theme-slider"
          style={{
            ...sliderVars(sliderValue, 0, Math.max(0, candles.length - 1)),
            width: "100%",
            height: 6,
            cursor: "pointer",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.10)",
          paddingTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 900,
            color: "rgba(255,255,255,0.92)",
          }}
        >
          Legend &amp; Map Info
        </div>
        <div
          style={{
            fontSize: 10,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.70)",
          }}
        >
          Each point on the map is a past trade or the current potential setup.
          Points are projected from a high‑dimensional market state into a 2D
          space; similar setups cluster together. Dot size scales with the
          magnitude of the trade’s profit or loss. Positions are learned via a
          UMAP-style embedding so that similar trades (in the full standardized
          feature space) land near each other. Pan by dragging, zoom with the
          mouse wheel and hover to inspect details.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          {/* Row 1 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              <span>Node Size</span>
              <span
                style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
              >
                {(Number(nodeSizeMul) || 1).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.6}
              step={0.05}
              value={nodeSizeMul}
              onChange={(e) => setNodeSizeMul(Number((e as any).target.value))}
              className="theme-slider"
              style={{
                ...sliderVars(nodeSizeMul, 0.4, 2.6),
                width: "100%",
                height: 6,
                cursor: "pointer",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              <span>Outline Width</span>
              <span
                style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
              >
                {(Number(nodeOutlineMul) || 1).toFixed(2)}×
              </span>
            </div>
            <input
              type="range"
              min={0.4}
              max={3.0}
              step={0.05}
              value={nodeOutlineMul}
              onChange={(e) =>
                setNodeOutlineMul(Number((e as any).target.value))
              }
              className="theme-slider"
              style={{
                ...sliderVars(nodeOutlineMul, 0.4, 3.0),
                width: "100%",
                height: 6,
                cursor: "pointer",
              }}
            />
          </div>

          {/* Row 2 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              <span>Data Spread</span>
              <span
                style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
              >
                {Math.round((Number(mapSpreadPct) || 0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={mapSpreadPct}
              onChange={(e) => setMapSpreadPct(Number((e as any).target.value))}
              className="theme-slider"
              style={{
                ...sliderVars(mapSpreadPct, 0.05, 1),
                width: "100%",
                height: 6,
                cursor: "pointer",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              <span>Grouping Opacity</span>
              <span
                style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
              >
                {Math.round((Number(groupOverlayOpacity) || 0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={0.05}
              value={groupOverlayOpacity}
              onChange={(e) =>
                setGroupOverlayOpacity(Number((e as any).target.value))
              }
              className="theme-slider"
              style={{
                ...sliderVars(groupOverlayOpacity, 0, 5),
                width: "100%",
                height: 6,
                cursor: "pointer",
              }}
            />
          </div>

          {/* Row 3 (span) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
              gridColumn: "1 / -1",
            }}
          >
            <div
              className="rounded-md border border-neutral-800"
              style={{
                padding: "8px 10px",
                background:
                  "rgba(20,20,20,0.75)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                <span>Heatmap Interpolation</span>
                <span
                  style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
                >
                  {Math.round(
                    (Math.min(3, Math.max(0, Number(heatmapInterp) || 0)) / 3) *
                      100
                  )}
                  %
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.05}
                value={heatmapInterp}
                onChange={(e) =>
                  setHeatmapInterp(Number((e as any).target.value))
                }
                className="theme-slider"
                style={{
                  ...sliderVars(heatmapInterp, 0, 3),
                  width: "100%",
                  height: 6,
                  cursor: "pointer",
                }}
              />
            </div>

            <div
              className="rounded-md border border-neutral-800"
              style={{
                padding: "8px 10px",
                background:
                  "rgba(20,20,20,0.75)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                <span>Heatmap Smoothness</span>
                <span
                  style={{ color: "rgba(255,255,255,0.92)", fontWeight: 800 }}
                >
                  {Math.round(
                    Math.min(1, Math.max(0, Number(heatmapSmoothness) || 0)) *
                      100
                  )}
                  %
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={heatmapSmoothness}
                onChange={(e) =>
                  setHeatmapSmoothness(Number((e as any).target.value))
                }
                className="theme-slider"
                style={{
                  ...sliderVars(heatmapSmoothness, 0, 1),
                  width: "100%",
                  height: 6,
                  cursor: "pointer",
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 8,
          }}
        >
          {[
            {
              key: "potential",
              label: "Potential Setup",
              description: "Purple node · current candle’s projected position",
              dot: "rgba(160,90,255,1.0)",
              bg: "rgba(120,60,200,0.28)",
              border: "1px solid rgba(200,160,255,0.55)",
              titleColor: "rgba(160,90,255,1.0)",
              span: 1,
            },
            {
              key: "active",
              label: "Open Trade",
              description: "Cyan fill · open trade (unrealized PnL)",
              dot: "rgba(0,210,255,1.0)",
              bg: "rgba(0,130,200,0.28)",
              border: "1px solid rgba(0,210,255,0.55)",
              titleColor: "rgba(0,210,255,1.0)",
              span: 1,
            },
            {
              key: "close",
              label: "Live Trade",
              description: "Orange fill · live trade point (during trade)",
              dot: "rgba(255,140,0,1.0)",
              bg: "rgba(180,90,0,0.26)",
              border: "1px solid rgba(255,140,0,0.55)",
              titleColor: "rgba(255,140,0,1.0)",
              span: 1,
            },
            {
              key: "closedWin",
              label: "Closed Win",
              description: "Green fill · trade closed with non‑negative PnL",
              dot: "rgba(60,220,120,1.0)",
              bg: "rgba(40,160,80,0.28)",
              border: "1px solid rgba(60,220,120,0.55)",
              titleColor: "rgba(60,220,120,1.0)",
              span: 1,
            },
            {
              key: "closedLoss",
              label: "Closed Loss",
              description: "Red fill · trade closed with negative PnL",
              dot: "rgba(230,80,80,1.0)",
              bg: "rgba(200,50,50,0.28)",
              border: "1px solid rgba(230,80,80,0.55)",
              titleColor: "rgba(230,80,80,1.0)",
              span: 1,
            },

            ...(Array.isArray(activeLibraries) ? activeLibraries : []).map(
              (lid) => {
                const def = (AI_LIBRARY_DEF_BY_ID as any)[String(lid)];
                const name = def
                  ? def.name || def.label || def.id
                  : String(lid);
                const isSupp = String(lid).toLowerCase() === "suppressed";
                const hue = Math.floor(
                  stableHashToUnit("libLegend:" + String(lid)) * 360
                );
                const c0 = isSupp
                  ? "rgba(140,140,140,1)"
                  : `hsla(${hue}, 92%, 64%, 1)`;
                const bg0 = isSupp
                  ? "rgba(140,140,140,0.18)"
                  : `hsla(${hue}, 92%, 64%, 0.18)`;
                const br0 = isSupp
                  ? "rgba(140,140,140,0.55)"
                  : `hsla(${hue}, 92%, 64%, 0.55)`;
                const cntRaw = Number(
                  (counts as any)?.libraryById?.[String(lid)] ?? 0
                );
                const cnt = isSupp ? suppressedLibraryTotalAll : cntRaw;
                return {
                  key: `lib:${String(lid)}`,
                  label: `Library · ${name}`,
                  description: `${cnt.toLocaleString()} points`,
                  dot: c0,
                  bg: `linear-gradient(135deg, ${bg0}, rgba(0,0,0,0.18), rgba(255,255,255,0.03))`,
                  border: `1px solid ${br0}`,
                  titleColor: "rgba(255,255,255,0.94)",
                  span: 1,
                  isLibrary: true,
                };
              }
            ),
          ].map((item) => {
            const enabled = legendToggles[item.key];
            const disabledBg =
              "rgba(60,60,60,0.20)";
            const disabledBorder = "1px solid rgba(120,120,120,0.50)";
            const disabledDot = "rgba(120,120,120,1.0)";
            const disabledTitle = "rgba(180,180,180,0.9)";
            const disabledDesc = "rgba(200,200,200,0.6)";
            return (
              <div
                key={item.key}
                onClick={() => {
                  setLegendToggles((prev) => ({
                    ...prev,
                    [item.key]: !prev[item.key],
                  }));
                }}
                onContextMenu={(e) => {
                  if (item.key !== "ghost") return;
                  e.preventDefault();
                  setGhostLegendColored((v) => !v);
                }}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: 10,
                  borderRadius: 11,
                  background: enabled ? item.bg : disabledBg,
                  border: enabled ? item.border : disabledBorder,
                  "boxShadow": "none",
                  cursor: "pointer",
                  userSelect: "none",
                  gridColumn:
                    item.span && item.span > 1
                      ? `span ${item.span}`
                      : undefined,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: (item as any).isDirection
                      ? undefined
                      : enabled
                      ? item.dot
                      : disabledDot,
                    border: (item as any).isDirection
                      ? `2px solid ${
                          enabled
                            ? item.key === "buy"
                              ? "rgba(60,220,120,1.0)"
                              : "rgba(230,80,80,1.0)"
                            : disabledDot
                        }`
                      : undefined,
                    marginTop: 2,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: enabled ? item.titleColor : disabledTitle,
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: enabled ? "rgba(255,255,255,0.85)" : disabledDesc,
                      marginTop: 2,
                    }}
                  >
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 950,
              color: "rgba(255,255,255,0.92)",
              marginBottom: 6,
            }}
          >
            Cluster Groups Table (HDBSCAN)
          </div>
          <div
            style={{
              fontSize: 10,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.65)",
              marginBottom: 8,
            }}
          >
            Hover groups on the map for a quick tooltip. Click a row (or click a
            group on the map) to select it and see the detailed panel.
          </div>

          {/* Direction toggle for group stats (All / Buy / Sell) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  color: "rgba(255,255,255,0.80)",
                }}
              >
                Stats
              </div>
              <div
                style={{
                  display: "inline-flex",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.18)",
                  overflow: "hidden",
                }}
              >
                {(["All", "Buy", "Sell"] as const).map((m) => {
                  const active = clusterGroupStatsMode === m;
                  const bg =
                    m === "Buy"
                      ? "rgba(40,160,80,0.26)"
                      : m === "Sell"
                      ? "rgba(200,50,50,0.26)"
                      : "rgba(120,80,255,0.22)";
                  return (
                    <button
                      key={m}
                      onClick={() => setClusterGroupStatsMode(m)}
                      style={{
                        fontSize: 10,
                        fontWeight: 950,
                        padding: "7px 10px",
                        border: "none",
                        borderRight:
                          m !== "Sell"
                            ? "1px solid rgba(255,255,255,0.10)"
                            : "none",
                        background: active ? bg : "rgba(0,0,0,0.18)",
                        color: active
                          ? "rgba(255,255,255,0.94)"
                          : "rgba(255,255,255,0.72)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                      title={`Show ${m} stats`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  display: "inline-flex",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.18)",
                  overflow: "hidden",
                }}
                title="Choose whether the table is showing Library stats or Live-trade stats for each cluster"
              >
                {(["All", "Library", "Live"] as const).map((m, idx, arr) => {
                  const active = clusterGroupUniverse === m;
                  const bg =
                    m === "Live"
                      ? "rgba(60,220,120,0.18)"
                      : "rgba(180,120,255,0.18)";
                  return (
                    <button
                      key={m}
                      onClick={() => setClusterGroupUniverse(m)}
                      style={{
                        fontSize: 10,
                        fontWeight: 950,
                        padding: "7px 10px",
                        border: "none",
                        borderRight:
                          m !== "Live"
                            ? "1px solid rgba(255,255,255,0.10)"
                            : "none",
                        background: active ? bg : "rgba(0,0,0,0.18)",
                        color: active
                          ? "rgba(255,255,255,0.94)"
                          : "rgba(255,255,255,0.72)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.55)" }}>
                {clusterGroupUniverse === "Live"
                  ? "Live trades in each cluster"
                  : "Library stats per cluster"}
              </div>
            </div>
          </div>

          <div
            style={{
              maxHeight: 320,
              overflow: "auto",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 10,
                  minWidth: 1280,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.75 }}>
                    <th
                      onClick={() => toggleGroupSort("group")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Group {sortArrow("group")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("winRate")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Win Rate {sortArrow("winRate")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("count")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Count {sortArrow("count")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("wins")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Wins {sortArrow("wins")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("losses")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Losses {sortArrow("losses")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("buys")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Buy Trades {sortArrow("buys")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("sells")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Sell Trades {sortArrow("sells")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("totalPnl")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Total PnL {sortArrow("totalPnl")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("avgPnl")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Average PnL {sortArrow("avgPnl")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("avgWin")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Average Win {sortArrow("avgWin")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("avgLoss")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Average Loss {sortArrow("avgLoss")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("profitFactor")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Profit Factor {sortArrow("profitFactor")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("payoff")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Payoff {sortArrow("payoff")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("maxWin")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Max Win {sortArrow("maxWin")}
                    </th>
                    <th
                      onClick={() => toggleGroupSort("maxLoss")}
                      style={{
                        padding: "7px 8px",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Max Loss {sortArrow("maxLoss")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGroupRowsUI.map((r: any) => {
                    const isSel =
                      selectedGroup &&
                      String((selectedGroup as any).type) === String(r.type) &&
                      String((selectedGroup as any).id) === String(r.id);
                    const isCur =
                      currentGroupHit &&
                      String((currentGroupHit as any).type) ===
                        String(r.type) &&
                      String((currentGroupHit as any).id) === String(r.id);

                    // Row tint should always match the group/hull color
                    const groupCol = colorForLibrary(
                      "hdbscan_cluster_" + String(r.id)
                    );
                    const rowBgBase = `linear-gradient(90deg, ${cssColorWithAlpha(
                      groupCol,
                      0.14
                    )} 0%, ${cssColorWithAlpha(
                      groupCol,
                      0.06
                    )} 44%, rgba(0,0,0,0) 100%)`;
                    const rowBgHover = `linear-gradient(90deg, ${cssColorWithAlpha(
                      groupCol,
                      0.18
                    )} 0%, ${cssColorWithAlpha(
                      groupCol,
                      0.08
                    )} 46%, rgba(0,0,0,0) 100%)`;
                    const rowBgSel = `linear-gradient(90deg, ${cssColorWithAlpha(
                      groupCol,
                      0.24
                    )} 0%, ${cssColorWithAlpha(
                      groupCol,
                      0.1
                    )} 50%, rgba(0,0,0,0) 100%)`;
                    const accentW = isSel ? 4 : isCur ? 3 : 2;
                    const rowAccent = cssColorWithAlpha(
                      groupCol,
                      isSel ? 0.92 : isCur ? 0.72 : 0.32
                    );

                    const ms = pickClusterGroupStats(r, clusterGroupStatsMode);

                    const wr0 = Number(ms.winRate) || 0;
                    const c0 = Number(ms.count) || 0;
                    const w0 = Number(ms.wins) || 0;
                    const l0 = Number.isFinite(Number(ms.losses))
                      ? Number(ms.losses)
                      : Math.max(0, c0 - w0);

                    const b0 = Number(r.buys) || 0;
                    const s0 = Number(r.sells) || 0;

                    const tp = Number(ms.totalPnl) || 0;
                    const ap = Number(ms.avgPnl) || 0;
                    const aw = Number(ms.avgWin) || 0;
                    const al = Number(ms.avgLoss) || 0;

                    const pf = (ms as any).profitFactor;
                    const payoff = (ms as any).payoff;
                    const mxw = Number(ms.maxWin) || 0;
                    const mxl = Number(ms.maxLoss) || 0;

                    const wrCol = overlayColorForWr(wr0);
                    const fmtPf = (v: any) =>
                      v === Infinity
                        ? "∞"
                        : Number.isFinite(Number(v))
                        ? formatNumber(Number(v), 2)
                        : "—";

                    return (
                      <tr
                        key={String(r.key || r.type + "-" + r.id)}
                        onClick={() => {
                          const next = { type: r.type, id: r.id, stats: r };
                          selectedGroupRef.current = next;
                          setSelectedGroup(next);
                        }}
                        style={{
                          cursor: "pointer",
                          background: isSel
                            ? rowBgSel
                            : isCur
                            ? rowBgHover
                            : rowBgBase,
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          boxShadow: `inset ${accentW}px 0 0 ${rowAccent}`,
                        }}
                      >
                        <td
                          style={{
                            padding: "7px 8px",
                            fontWeight: isSel ? 950 : 750,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {`HDB ${String(r.id)}`}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color: c0 > 0 ? wrCol : "rgba(255,255,255,0.55)",
                            fontWeight: 950,
                          }}
                        >
                          {c0 > 0 ? `${formatNumber(wr0 * 100, 1)}%` : "—"}
                        </td>

                        <td style={{ padding: "7px 8px" }}>
                          {formatNumber(c0, 0)}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(60,220,120,0.98)",
                            fontWeight: 900,
                          }}
                        >
                          {formatNumber(w0, 0)}
                        </td>
                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(230,80,80,0.98)",
                            fontWeight: 900,
                          }}
                        >
                          {formatNumber(l0, 0)}
                        </td>

                        <td style={{ padding: "7px 8px" }}>
                          {formatNumber(b0, 0)}
                        </td>
                        <td style={{ padding: "7px 8px" }}>
                          {formatNumber(s0, 0)}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color:
                              tp >= 0
                                ? "rgba(60,220,120,0.98)"
                                : "rgba(230,80,80,0.98)",
                            fontWeight: 950,
                          }}
                        >
                          {tp >= 0 ? "+" : "-"}${formatNumber(Math.abs(tp), 0)}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color:
                              ap >= 0
                                ? "rgba(60,220,120,0.90)"
                                : "rgba(230,80,80,0.90)",
                          }}
                        >
                          {ap >= 0 ? "+" : "-"}${formatNumber(Math.abs(ap), 2)}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(60,220,120,0.90)",
                          }}
                        >
                          +${formatNumber(Math.abs(aw), 2)}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(230,80,80,0.90)",
                          }}
                        >
                          -${formatNumber(Math.abs(al), 2)}
                        </td>

                        <td style={{ padding: "7px 8px" }}>
                          {c0 > 0 ? fmtPf(pf) : "—"}
                        </td>
                        <td style={{ padding: "7px 8px" }}>
                          {c0 > 0 ? fmtPf(payoff) : "—"}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(60,220,120,0.90)",
                          }}
                        >
                          +${formatNumber(Math.abs(mxw), 0)}
                        </td>

                        <td
                          style={{
                            padding: "7px 8px",
                            color: "rgba(230,80,80,0.90)",
                          }}
                        >
                          -${formatNumber(Math.abs(mxl), 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
