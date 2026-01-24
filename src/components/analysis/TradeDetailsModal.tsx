"use client";

import React, { useEffect, useMemo } from "react";
import type { Trade, ClusterNode, Candle } from "../../lib/analysis/types";
import type { ParseMode } from "../../lib/analysis/dateTime";
import { clampInt } from "../../lib/analysis/math";
import { minutesBetween } from "../../lib/analysis/dateTime";
import { formatMinutesShort } from "../../lib/analysis/formatting";
import { displayIdForNode, canonicalModelName } from "../../lib/analysis/hashing";

// ============================================
// InfoBox Component (internal to modal)
// ============================================
interface InfoBoxProps {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "green" | "red" | "blue" | "amber";
}

function InfoBox({ label, value, tone = "neutral" }: InfoBoxProps) {
  const isEmpty =
    value == null ||
    value === "" ||
    value === "—" ||
    (typeof value === "number" && !Number.isFinite(value));

  const toneMap: Record<
    string,
    { border: string; bg: string; value: string; label: string }
  > = {
    neutral: {
      border: "rgba(255,255,255,0.10)",
      bg: "rgba(255,255,255,0.03)",
      value: "rgba(255,255,255,0.88)",
      label: "rgba(255,255,255,0.72)",
    },
    green: {
      border: "rgba(52,211,153,0.22)",
      bg: "rgba(52,211,153,0.10)",
      value: "rgba(167,243,208,0.98)",
      label: "rgba(167,243,208,0.72)",
    },
    red: {
      border: "rgba(248,113,113,0.22)",
      bg: "rgba(248,113,113,0.10)",
      value: "rgba(254,202,202,0.98)",
      label: "rgba(254,202,202,0.72)",
    },
    blue: {
      border: "rgba(96,165,250,0.22)",
      bg: "rgba(96,165,250,0.10)",
      value: "rgba(191,219,254,0.98)",
      label: "rgba(191,219,254,0.72)",
    },
    amber: {
      border: "rgba(251,191,36,0.22)",
      bg: "rgba(251,191,36,0.10)",
      value: "rgba(253,230,138,0.98)",
      label: "rgba(253,230,138,0.72)",
    },
  };

  const t = toneMap[tone] ?? toneMap.neutral;

  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        background: t.bg,
        borderRadius: 8,
        padding: "10px 12px",
        minHeight: 58,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "none",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: 0.7,
          opacity: 1,
          color: t.label,
          textTransform: "uppercase",
          marginBottom: 6,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 850,
          color: isEmpty ? "rgba(255,255,255,0.55)" : t.value,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={typeof value === "string" ? value : undefined}
      >
        {isEmpty ? "N/A" : value}
      </div>
    </div>
  );
}

// ============================================
// Formatting Helpers
// ============================================
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : NaN;
  }
  if (v == null) return NaN;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function fmtPrice(v: number): string {
  return Number.isFinite(v)
    ? Number(v).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
}

function fmtUsd(v: number): string {
  return Number.isFinite(v)
    ? `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function fmtPct(v: number, d = 1): string {
  return Number.isFinite(v) ? `${(Number(v) * 100).toFixed(d)}%` : "—";
}

// ============================================
// Trade Details Modal Props
// ============================================
export interface TradeDetailsModalProps {
  trade: Trade;
  candles: Candle[];
  dollarsPerMove?: number;
  interval?: string;
  parseMode?: ParseMode;
  tpDist?: number | null;
  slDist?: number | null;
  onClose: () => void;
  /** Render prop for the candlestick chart */
  renderChart?: (props: {
    trade: Trade;
    candles: Candle[];
    interval: string;
    parseMode: ParseMode;
    tpDist: number | null;
    slDist: number | null;
    heightPx: number;
  }) => React.ReactNode;
}

// ============================================
// Trade Details Modal Component
// ============================================
export function TradeDetailsModal({
  trade,
  candles,
  dollarsPerMove = 1,
  interval = "15min",
  parseMode = "utc",
  tpDist = null,
  slDist = null,
  onClose,
  renderChart,
}: TradeDetailsModalProps) {
  const entryPrice = num(
    trade.entryPrice ?? trade.entry ?? (trade as Trade & { openPrice?: number }).openPrice
  );
  const rawExitPrice = num(
    trade.exitPrice ??
      trade.exit ??
      (trade as Trade & { closePrice?: number }).closePrice ??
      (trade as Trade & { close?: number }).close ??
      (trade as Trade & { priceExit?: number }).priceExit
  );

  // Direction can be stored in several ways (1/-1, "long"/"short", etc.)
  const dirRaw =
    trade.dir ??
    trade.direction ??
    trade.sideNum ??
    trade.side ??
    trade.Side ??
    trade.dirText ??
    trade.directionText;

  const dirNum = num(dirRaw);
  const dirStr = typeof dirRaw === "string" ? dirRaw.toLowerCase() : "";
  const dirSign = dirNum === -1 || dirStr.startsWith("s") ? -1 : 1;
  const dir = dirSign;

  // Prefer realized pnl; fall back to whatever the dataset provides.
  const pnl = num(
    trade.isOpen
      ? trade.unrealizedPnl ?? trade.pnl
      : trade.pnl ?? trade.realizedPnl ?? trade.profit ?? trade.netPnl
  );

  const isWin = Number.isFinite(pnl) ? pnl >= 0 : false;
  const accent = isWin ? "rgba(52,211,153,0.95)" : "rgba(248,113,113,0.95)";

  let exitPrice = rawExitPrice;
  // If the dataset doesn't store exitPrice, derive it from PnL and dollarsPerMove.
  if (
    !Number.isFinite(exitPrice) &&
    Number.isFinite(entryPrice) &&
    Number.isFinite(pnl) &&
    Number.isFinite(dollarsPerMove) &&
    dollarsPerMove !== 0
  ) {
    const delta = pnl / dollarsPerMove;
    exitPrice = entryPrice + delta * (dirSign === -1 ? -1 : 1);
  }

  let tpPrice = num(
    trade.tpPrice ?? trade.tp ?? (trade as Trade & { takeProfitPrice?: number }).takeProfitPrice
  );
  let slPrice = num(
    trade.slPrice ?? trade.sl ?? (trade as Trade & { stopLossPrice?: number }).stopLossPrice
  );

  if (!Number.isFinite(tpPrice) && Number.isFinite(entryPrice) && Number.isFinite(tpDist)) {
    tpPrice = entryPrice + dir * Number(tpDist);
  }
  if (!Number.isFinite(slPrice) && Number.isFinite(entryPrice) && Number.isFinite(slDist)) {
    slPrice = entryPrice - dir * Number(slDist);
  }

  const durationMin = useMemo(() => {
    const nowT = trade.isOpen ? Date.now() : null;
    const endT = trade.isOpen
      ? nowT
      : trade.exitTime ?? trade.exitTs ?? (trade as Trade & { closeTime?: string | number }).closeTime;
    return (
      minutesBetween(
        trade.entryTime ?? trade.entryTs ?? (trade as Trade & { openTime?: string | number }).openTime,
        endT,
        parseMode
      ) ?? null
    );
  }, [trade, parseMode]);

  const pathStats = useMemo(() => {
    const a = Number(trade.entryIndex ?? trade.entryIdx ?? trade.entryBar ?? -1);
    const b = Number(trade.exitIndex ?? trade.exitIdx ?? trade.exitBar ?? -1);
    if (!candles?.length || a < 0) return null;

    const start = clampInt(a, 0, candles.length - 1);
    const end = b >= 0 ? clampInt(b, 0, candles.length - 1) : start;

    const ep = entryPrice;
    if (!Number.isFinite(ep)) return null;

    let maxFav = -Infinity;
    let maxAdv = Infinity;
    let peak = -Infinity;
    let trough = Infinity;

    for (let i = start; i <= end; i++) {
      const c = candles[i];
      const hi = num(c?.high ?? (c as Candle & { h?: number })?.h);
      const lo = num(c?.low ?? (c as Candle & { l?: number })?.l);
      const closeVal = num(c?.close ?? (c as Candle & { c?: number })?.c);

      const hiPx = Number.isFinite(hi) ? hi : closeVal;
      const loPx = Number.isFinite(lo) ? lo : closeVal;
      if (!Number.isFinite(hiPx) || !Number.isFinite(loPx)) continue;

      const fav = (hiPx - ep) * dir * (dollarsPerMove ?? 1);
      const adv = (loPx - ep) * dir * (dollarsPerMove ?? 1);

      if (fav > maxFav) maxFav = fav;
      if (adv < maxAdv) maxAdv = adv;

      if (hiPx > peak) peak = hiPx;
      if (loPx < trough) trough = loPx;
    }

    return {
      entryIndex: start,
      exitIndex: end,
      maxFavorable: Number.isFinite(maxFav) ? maxFav : null,
      maxAdverse: Number.isFinite(maxAdv) ? maxAdv : null,
      peak,
      trough,
    };
  }, [trade, candles, dollarsPerMove, entryPrice, dir]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const titleId = displayIdForNode(trade as ClusterNode);

  // Extract trade properties with proper typing
  const entryModel =
    (trade as Trade & { entryModel?: string; model?: string }).entryModel ??
    (trade as Trade & { model?: string }).model;
  const exitModel = (trade as Trade & { exitModel?: string }).exitModel;
  const session =
    (trade as Trade & { session?: string; sess?: string }).session ??
    (trade as Trade & { sess?: string }).sess;
  const aiMargin = (trade as Trade & { aiMargin?: number }).aiMargin;
  const closestCluster =
    (trade as Trade & { closestCluster?: string; clusterName?: string; clusterLabel?: string })
      .closestCluster ??
    (trade as Trade & { clusterName?: string }).clusterName ??
    (trade as Trade & { clusterLabel?: string }).clusterLabel;
  const hdbClusterId =
    (trade as Trade & { hdbClusterId?: number; clusterGroupId?: number; clusterGroup?: number })
      .hdbClusterId ??
    (trade as Trade & { clusterGroupId?: number }).clusterGroupId ??
    (trade as Trade & { clusterGroup?: number }).clusterGroup;

  // Entry/Exit reasons
  const entryReason =
    (
      trade as Trade & {
        entryReason?: string;
        entry_reason?: string;
        reasonEntry?: string;
        entryTag?: string;
        entry_source?: string;
        entrySource?: string;
        chunkType?: string;
        setup?: string;
        strategy?: string;
      }
    ).entryReason ??
    (trade as Trade & { entry_reason?: string }).entry_reason ??
    (trade as Trade & { reasonEntry?: string }).reasonEntry ??
    (trade as Trade & { entryTag?: string }).entryTag ??
    (trade as Trade & { entry_source?: string }).entry_source ??
    (trade as Trade & { entrySource?: string }).entrySource ??
    (entryModel ? `Model: ${canonicalModelName(entryModel)}` : null) ??
    (trade as Trade & { chunkType?: string }).chunkType ??
    (trade as Trade & { setup?: string }).setup ??
    (trade as Trade & { strategy?: string }).strategy;

  const exitReason =
    (
      trade as Trade & {
        exitReason?: string;
        exit_reason?: string;
        reasonExit?: string;
        exitTag?: string;
        exit_source?: string;
        exitSource?: string;
      }
    ).exitReason ??
    (trade as Trade & { exit_reason?: string }).exit_reason ??
    (trade as Trade & { reasonExit?: string }).reasonExit ??
    (trade as Trade & { exitTag?: string }).exitTag ??
    (trade as Trade & { exit_source?: string }).exit_source ??
    (trade as Trade & { exitSource?: string }).exitSource ??
    (exitModel ? `Model: ${canonicalModelName(exitModel)}` : null);

  const modelDisplay =
    entryModel ??
    (trade as Trade & { model?: string }).model ??
    (trade as Trade & { modelName?: string }).modelName ??
    exitModel ??
    (trade as Trade & { chunkType?: string }).chunkType ??
    (trade as Trade & { strategy?: string }).strategy ??
    (trade as Trade & { setup?: string }).setup;

  const mostInfluentialDim =
    (
      trade as Trade & {
        mostInfluentialDimension?: string;
        most_influential_dimension?: string;
        mostInfluentialDim?: string;
        influentialDimension?: string;
        influential_dimension?: string;
        topDim?: string;
        top_dimension?: string;
        bestDim?: string;
        dimension?: string;
        dim?: string;
      }
    ).mostInfluentialDimension ??
    (trade as Trade & { most_influential_dimension?: string }).most_influential_dimension ??
    (trade as Trade & { mostInfluentialDim?: string }).mostInfluentialDim ??
    (trade as Trade & { influentialDimension?: string }).influentialDimension ??
    (trade as Trade & { influential_dimension?: string }).influential_dimension ??
    (trade as Trade & { topDim?: string }).topDim ??
    (trade as Trade & { top_dimension?: string }).top_dimension ??
    (trade as Trade & { bestDim?: string }).bestDim ??
    (trade as Trade & { dimension?: string }).dimension ??
    (trade as Trade & { dim?: string }).dim;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        style={{
          width: "min(1120px, 96vw)",
          height: "min(900px, 90vh)",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(12,12,12,0.96)",
          boxShadow: "none",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 900,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              {titleId || "Trade"}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${accent}`,
                color: accent,
              }}
            >
              {trade.isOpen ? "OPEN" : isWin ? "WIN" : "LOSS"}
            </div>
            {entryModel ? (
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.85,
                  color: "rgba(255,255,255,0.72)",
                }}
              >
                <span style={{ fontWeight: 800, color: "rgba(255,255,255,0.82)" }}>
                  {canonicalModelName(entryModel)}
                </span>
              </div>
            ) : null}
          </div>

          <button
            onClick={onClose}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.86)",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {/* AI Cluster Info */}
        <div style={{ padding: "12px 16px", overflowY: "auto", flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 0.4,
                opacity: 0.92,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              AI Cluster Info
            </div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.72,
                textAlign: "right",
                lineHeight: 1.2,
                color: "rgba(255,255,255,0.72)",
              }}
            >
              <span style={{ opacity: 0.9 }}>
                AI Margin{" "}
                <b style={{ color: "rgba(255,255,255,0.88)" }}>{fmtPct(num(aiMargin), 1)}</b>
              </span>
              <span style={{ opacity: 0.45 }}> · </span>
              <span style={{ opacity: 0.9 }}>
                Cluster <b style={{ color: "rgba(255,255,255,0.88)" }}>{closestCluster ?? "—"}</b>
              </span>
              <span style={{ opacity: 0.45 }}> · </span>
              <span style={{ opacity: 0.9 }}>
                Group <b style={{ color: "rgba(255,255,255,0.82)" }}>{hdbClusterId ?? "—"}</b>
              </span>
            </div>
          </div>

          {/* Row 1 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <InfoBox label="Entry Reason" tone="blue" value={entryReason ?? "—"} />
            <InfoBox label="Entry Price" value={fmtPrice(entryPrice)} />
            <InfoBox label="Exit Reason" tone="blue" value={exitReason ?? "—"} />
            <InfoBox
              label="Exit Price"
              value={Number.isFinite(exitPrice) ? fmtPrice(exitPrice) : "—"}
            />
          </div>

          {/* Row 2 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <InfoBox label="PnL" value={fmtUsd(pnl)} tone={pnl >= 0 ? "green" : "red"} />
            <InfoBox
              label="Duration"
              value={durationMin != null ? formatMinutesShort(durationMin) : "—"}
            />
          </div>

          {/* Row 3 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <InfoBox
              label="Take Profit"
              value={Number.isFinite(tpPrice) ? fmtPrice(tpPrice) : "—"}
              tone="green"
            />
            <InfoBox
              label="Stop Loss"
              value={Number.isFinite(slPrice) ? fmtPrice(slPrice) : "—"}
              tone="red"
            />
            <InfoBox
              label="Peak (MFE)"
              value={pathStats?.maxFavorable != null ? fmtUsd(pathStats.maxFavorable) : "—"}
              tone="green"
            />
            <InfoBox
              label="DD (MAE)"
              value={pathStats?.maxAdverse != null ? fmtUsd(pathStats.maxAdverse) : "—"}
              tone="red"
            />
          </div>

          {/* Row 4 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <InfoBox label="Session" value={session ?? "—"} />
            <InfoBox
              label="Model"
              tone="amber"
              value={modelDisplay ? canonicalModelName(modelDisplay) : "—"}
            />
            <InfoBox label="Most Influential Dimension" tone="blue" value={mostInfluentialDim ?? "—"} />
          </div>

          {/* Chart */}
          {renderChart?.({
            trade,
            candles,
            interval,
            parseMode,
            tpDist: tpDist ?? null,
            slDist: slDist ?? null,
            heightPx: 420,
          })}
        </div>
      </div>
    </div>
  );
}
