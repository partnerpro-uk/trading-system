// Hashing and ID Generation Utilities

import type { ClusterNode } from "./types";

/**
 * FNV-1a hash to [0,1) deterministic value
 */
export function stableHashToUnit(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

/**
 * Seeded PRNG (mulberry32 algorithm)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate seed from string key
 */
export function seedFromKey(key: string | number): number {
  return (stableHashToUnit(String(key)) * 4294967295) >>> 0 || 1337;
}

/**
 * Normalize model name variants to canonical form
 */
export function canonicalModelName(name: unknown): string {
  const s = String(name ?? "").toLowerCase();
  const norm = s.replace(/[^a-z0-9]+/g, " ").trim();
  if (!norm) return String(name ?? "");
  if (norm.includes("momentum")) return "Momentum";
  if (norm.includes("mean") && norm.includes("reversion"))
    return "Mean Reversion";
  if (norm.includes("season")) return "Seasons";
  if (norm.includes("time") && norm.includes("day")) return "Time of Day";
  if (norm.includes("fibo")) return "Fibonacci";
  if (
    norm.includes("support") ||
    norm.includes("resistance") ||
    norm.includes("sr")
  )
    return "Support / Resistance";
  if (norm.includes("ai") && norm.includes("model")) return "AI Model";
  return String(name ?? "");
}

/**
 * Generate deterministic 6-char ID from trade/node data
 */
export function prettyIdForNode(n: ClusterNode): { short: string; raw: string } {
  const raw = String(
    n?.uid ??
      n?.tradeUid ??
      n?.tradeId ??
      n?.metaUid ??
      n?.metaTradeUid ??
      n?.mitUid ??
      n?.mitId ??
      n?.id ??
      ""
  );
  if (!raw || !raw.trim()) return { short: "—", raw: "" };

  const rawTrim = raw.trim();

  const toScope = (val: unknown) => {
    const s = String(val ?? "").trim();
    if (!s) return "";
    return s
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  };

  const guessScope = () => {
    const k = String(n?.kind ?? "").toLowerCase();
    if (k === "trade" || k === "close") return "live";

    if (rawTrim.startsWith("lib|")) {
      const parts = rawTrim.split("|");
      return toScope(parts[1] ?? "library");
    }
    if (rawTrim.includes("|")) {
      const pre = toScope(rawTrim.split("|")[0]);
      if (pre === "id" || pre === "uid" || pre === "mit") return "live";
      return pre;
    }

    if (/^id\d+/i.test(rawTrim)) return "live";
    if (/^phu_/i.test(rawTrim)) return "live";
    if (/^uid\d+/i.test(rawTrim)) return "live";

    const metaLib = n?.metaLib ?? n?.libId;
    if (metaLib != null && String(metaLib).trim()) return toScope(metaLib);

    const aiMode = String(n?.aiMode ?? "").toLowerCase();
    if (aiMode && aiMode.includes("ai")) return "ai_model";

    const model = n?.model ?? n?.origModel;
    if (model != null && String(model).trim())
      return toScope(canonicalModelName(model));

    return "id";
  };

  const entryTimestampMs = () => {
    const candidates: unknown[] = [
      n?.entryTime,
      n?.entryTimestamp,
      n?.entryTs,
      n?.openTime,
      n?.openTimestamp,
      n?.metaTime,
      n?.time,
      n?.timestamp,
      n?.t,
    ];

    if (rawTrim.startsWith("lib|")) {
      const parts = rawTrim.split("|");
      candidates.push(parts[3]);
    } else if (rawTrim.includes("|")) {
      candidates.push(rawTrim.split("|")[1]);
    }

    for (const c of candidates) {
      if (c == null || c === "") continue;
      if (typeof c === "number" && Number.isFinite(c)) {
        const n0 = c;
        if (n0 > 1e12) return Math.floor(n0);
        if (n0 > 1e9) return Math.floor(n0 * 1000);
        return Math.floor(n0);
      }
      const s = String(c).trim();
      if (!s) continue;
      const parsed = Date.parse(s);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
      const digits = s.replace(/[^0-9]/g, "");
      if (!digits) continue;
      const asNum = Number(digits);
      if (!Number.isFinite(asNum)) continue;
      if (asNum > 1e12) return Math.floor(asNum);
      if (asNum > 1e9) return Math.floor(asNum * 1000);
      return Math.floor(asNum);
    }

    return null;
  };

  const code6FromEntryTimestamp = () => {
    const ts = entryTimestampMs();
    const seed =
      ts == null ? `idNoTs|${rawTrim}` : `idTs|${Math.floor(ts)}|${rawTrim}`;
    const h = Math.floor(stableHashToUnit(seed) * 0xffffffff) >>> 0;
    return h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  };

  const scope = guessScope() || "id";
  const short = `${scope}| ${code6FromEntryTimestamp()}`;
  return { short, raw: rawTrim };
}

/**
 * User-facing ID helper: always return a clean, readable ID
 */
export function displayIdForNode(n: ClusterNode): string {
  const p = prettyIdForNode(n);
  return p.short || p.raw || "—";
}

/**
 * Generate display ID from raw string value
 */
export function displayIdFromRaw(v: unknown): string {
  const raw = v == null ? "" : String(v);
  if (!raw.trim()) return "—";
  return prettyIdForNode({ id: raw } as ClusterNode).short;
}

/**
 * Deterministic HSL color for library name
 */
export function colorForLibrary(key: string): string {
  const k = String(key ?? "");
  if (k.toLowerCase() === "suppressed") return "rgba(140,140,140,1)";
  const hue = Math.floor(stableHashToUnit("libColor:" + String(key)) * 360);
  return `hsla(${hue}, 92%, 62%, 0.98)`;
}

/**
 * Modify CSS color string alpha channel
 */
export function cssColorWithAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  const c = String(color || "");

  const hs = c.match(
    /hsla?\(\s*([0-9.+-]+)\s*,\s*([0-9.+-]+)%\s*,\s*([0-9.+-]+)%\s*(?:,\s*([0-9.+-]+)\s*)?\)/i
  );
  if (hs) return `hsla(${hs[1]}, ${hs[2]}%, ${hs[3]}%, ${a})`;

  const rg = c.match(
    /rgba?\(\s*([0-9.+-]+)\s*,\s*([0-9.+-]+)\s*,\s*([0-9.+-]+)\s*(?:,\s*([0-9.+-]+)\s*)?\)/i
  );
  if (rg) return `rgba(${rg[1]}, ${rg[2]}, ${rg[3]}, ${a})`;

  return c;
}
