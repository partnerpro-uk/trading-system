// Cluster Map Canvas Rendering
// 2D canvas rendering for the cluster visualization map

import { colorForLibrary } from './hashing';

// Types for cluster map rendering
// Using loose types to match original behavior - nodes come from various sources
export interface ClusterMapNode {
  id?: string;
  x?: number;
  y?: number;
  r?: number;
  kind?: string;
  dir?: number;
  direction?: number;
  pnl?: number;
  unrealizedPnl?: number;
  win?: boolean;
  isOpen?: boolean;
  libId?: string;
  metaLib?: string;
  time?: string | number;
  entryTime?: string | number;
  exitTime?: string | number;
  uid?: string;
  tradeUid?: string;
  metaUid?: string;
  metaTradeUid?: string;
  parentId?: string;
  [key: string]: unknown;
}

export interface ClusterMapView {
  ox: number;
  oy: number;
  scale: number;
}

export interface BoxSelection {
  kind?: string;
  rect?: { x0: number; y0: number; x1: number; y1: number };
  anchor?: { x: number; y: number };
  lasso?: { x: number; y: number }[];
  lassoClosed?: boolean;
}

export interface HDBOverlayCluster {
  id: number | string;
  hull: [number, number][];
}

export interface HDBOverlay {
  clusters?: HDBOverlayCluster[];
}

export interface HeatmapOutput {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  nx: number;
  ny: number;
  cnt: Float32Array;
  wins: Float32Array;
  gp: Float32Array;
  gl: Float32Array;
  tpnl: Float32Array;
  buys: Float32Array;
  sells: Float32Array;
  buyWins: Float32Array;
  buyGp: Float32Array;
  buyGl: Float32Array;
  buyTpnl: Float32Array;
  sellWins: Float32Array;
  sellGp: Float32Array;
  sellGl: Float32Array;
  sellTpnl: Float32Array;
  smooth: Float32Array;
  maxSmooth: number;
}

export interface HeatmapOutRef {
  current: HeatmapOutput | null;
}

/**
 * Draw the 2D cluster map canvas
 * Renders nodes, heatmap, HDBSCAN cluster hulls, and selection overlays
 */
export function drawClusterMapCanvas(
  canvas: HTMLCanvasElement | null,
  nodes: ClusterMapNode[] | unknown[],
  view: ClusterMapView | Record<string, unknown>,
  hoveredId: string | null,
  searchHighlightId: string | null,
  ghostColored: boolean,
  boxSel: BoxSelection | Record<string, unknown> | null,
  heatmapOn: boolean,
  heatmapOutRef: HeatmapOutRef | { current: unknown } | null,
  hdbOverlay: HDBOverlay | Record<string, unknown> | null = null,
  hoveredGroup: unknown = null,
  selectedGroup: unknown = null,
  groupOverlayOpacity: number = 1,
  nodeSizeMul: number = 1,
  nodeOutlineMul: number = 1,
  heatmapInterp: number = 1,
  mapSpreadMul: number = 1,
  heatmapSmoothness: number = 0.6,
  heatmapNodesOverride: ClusterMapNode[] | null = null
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, w, h);
  const spreadMul = Number(mapSpreadMul) || 1;
  const viewTyped = view as ClusterMapView;
  const baseScale = Number(viewTyped?.scale) || 1;
  const scale = baseScale * spreadMul;

  // Apply "Data Spread" as a zoom about the current view center (not world origin),
  // so changing spread feels like zooming in/out rather than shifting the map.
  const cxW = (w * 0.5 - viewTyped.ox) / (baseScale || 1);
  const cyW = (h * 0.5 - viewTyped.oy) / (baseScale || 1);
  const ox = w * 0.5 - cxW * scale;
  const oy = h * 0.5 - cyW * scale;

  const toScreen = (x: number, y: number) => ({
    sx: x * scale + ox,
    sy: y * scale + oy,
  });

  // Heatmap mode (2D): hide nodes, render a smoothed density field + store per-cell stats for hover info.
  // We compute bins in the *visible world window* so zoom/pan behaves naturally.
  if (heatmapOn) {
    const xMin = (0 - ox) / scale;
    const xMax = (w - ox) / scale;
    const yMin = (0 - oy) / scale;
    const yMax = (h - oy) / scale;
    const dxW = xMax - xMin;
    const dyW = yMax - yMin;

    const hmSmooth = Math.max(0, Math.min(1, Number(heatmapSmoothness) || 0));
    // Heatmap Smoothness controls the bin resolution (pixel size): higher = more cells (smoother gradients).
    const div = 12 - hmSmooth * 7; // 12 (chunky) -> 5 (smooth)
    const nx = Math.max(50, Math.min(360, Math.floor(w / (div || 1))));
    const ny = Math.max(40, Math.min(300, Math.floor(h / (div || 1))));
    const nCells = nx * ny;

    // Raw accumulators (will be smoothed with a small Gaussian blur for a cleaner heatmap).
    const cnt = new Float32Array(nCells);
    const wins = new Float32Array(nCells);
    const gp = new Float32Array(nCells);
    const gl = new Float32Array(nCells);
    const tpnl = new Float32Array(nCells);

    // Direction-specific accumulators for All/Buy/Sell toggles in the heatmap hover UI.
    // We keep buys/sells as direction counts for backward compatibility.
    const buys = new Float32Array(nCells);
    const sells = new Float32Array(nCells);
    const buyWins = new Float32Array(nCells);
    const buyGp = new Float32Array(nCells);
    const buyGl = new Float32Array(nCells);
    const buyTpnl = new Float32Array(nCells);
    const sellWins = new Float32Array(nCells);
    const sellGp = new Float32Array(nCells);
    const sellGl = new Float32Array(nCells);
    const sellTpnl = new Float32Array(nCells);

    const toIdx = (ix: number, iy: number) => iy * nx + ix;

    if (dxW > 1e-9 && dyW > 1e-9) {
      const srcNodes = (heatmapNodesOverride || nodes || []) as ClusterMapNode[];
      for (const n of srcNodes) {
        if (!n) continue;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        const kind = String(n.kind ?? "").toLowerCase();
        // Ignore "potential" point for the heatmap; it's not historical evidence.
        if (kind === "potential") continue;

        const fx = (n.x! - xMin) / dxW;
        const fy = (n.y! - yMin) / dyW;
        if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue;

        const ix = Math.min(nx - 1, Math.max(0, Math.floor(fx * nx)));
        const iy = Math.min(ny - 1, Math.max(0, Math.floor(fy * ny)));
        const id = toIdx(ix, iy);

        const pnl =
          typeof n.pnl === "number"
            ? n.pnl
            : typeof n.unrealizedPnl === "number"
            ? n.unrealizedPnl
            : 0;
        const dir = n.dir ?? n.direction ?? 0;

        const isWin = pnl >= 0;

        cnt[id] += 1;
        tpnl[id] += pnl;
        if (isWin) {
          wins[id] += 1;
          gp[id] += pnl;
        } else {
          gl[id] += -pnl;
        }

        if (dir === 1) {
          buys[id] += 1;
          buyTpnl[id] += pnl;
          if (isWin) {
            buyWins[id] += 1;
            buyGp[id] += pnl;
          } else {
            buyGl[id] += -pnl;
          }
        }
        if (dir === -1) {
          sells[id] += 1;
          sellTpnl[id] += pnl;
          if (isWin) {
            sellWins[id] += 1;
            sellGp[id] += pnl;
          } else {
            sellGl[id] += -pnl;
          }
        }
      }
    }

    // Smooth fields with a small Gaussian blur so the heatmap is cleaner + more continuous.
    const gaussianBlur5 = (src: Float32Array): Float32Array => {
      const tmp = new Float32Array(nCells);
      const dst = new Float32Array(nCells);
      // 5-tap kernel [1,4,6,4,1] / 16 (separable)
      for (let y = 0; y < ny; y++) {
        const row = y * nx;
        for (let x = 0; x < nx; x++) {
          const x0 = Math.max(0, x - 2);
          const x1 = Math.max(0, x - 1);
          const x2 = x;
          const x3 = Math.min(nx - 1, x + 1);
          const x4 = Math.min(nx - 1, x + 2);
          tmp[row + x] =
            (src[row + x0] * 1 +
              src[row + x1] * 4 +
              src[row + x2] * 6 +
              src[row + x3] * 4 +
              src[row + x4] * 1) /
            16;
        }
      }
      for (let y = 0; y < ny; y++) {
        const y0 = Math.max(0, y - 2);
        const y1 = Math.max(0, y - 1);
        const y2 = y;
        const y3 = Math.min(ny - 1, y + 1);
        const y4 = Math.min(ny - 1, y + 2);
        const r0 = y0 * nx;
        const r1 = y1 * nx;
        const r2 = y2 * nx;
        const r3 = y3 * nx;
        const r4 = y4 * nx;
        const row = y * nx;
        for (let x = 0; x < nx; x++) {
          dst[row + x] =
            (tmp[r0 + x] * 1 +
              tmp[r1 + x] * 4 +
              tmp[r2 + x] * 6 +
              tmp[r3 + x] * 4 +
              tmp[r4 + x] * 1) /
            16;
        }
      }
      return dst;
    };

    const interpVal = Math.max(0, Number(heatmapInterp) || 0);
    const blurT = Math.min(3, interpVal); // 0..3 (slider may exceed 1)
    const mixT = Math.min(1, blurT); // 0..1 for raw↔blur blending

    // Increase blur radius as interpolation increases by applying multiple small Gaussian passes.
    // For values > 1, we keep full blur blending (mixT=1) and continue increasing radius.
    const blurPasses = Math.max(
      1,
      Math.min(24, Math.round(1 + (blurT / 3) * 23))
    ); // 1..24
    const blurN = (src: Float32Array): Float32Array => {
      let out = src;
      for (let i = 0; i < blurPasses; i++) out = gaussianBlur5(out);
      return out;
    };

    const cntB = blurN(cnt);
    const winsB = blurN(wins);
    const gpB = blurN(gp);
    const glB = blurN(gl);
    const tpnlB = blurN(tpnl);
    const buysB = blurN(buys);
    const sellsB = blurN(sells);

    const buyWinsB = blurN(buyWins);
    const buyGpB = blurN(buyGp);
    const buyGlB = blurN(buyGl);
    const buyTpnlB = blurN(buyTpnl);
    const sellWinsB = blurN(sellWins);
    const sellGpB = blurN(sellGp);
    const sellGlB = blurN(sellGl);
    const sellTpnlB = blurN(sellTpnl);

    // Interpolation control:
    // heatmapInterp = 0 -> raw bins (blocky)
    // heatmapInterp = 1 -> fully blurred (smooth)
    // (values > 1 keep full blur blending and only increase blur radius)
    const tInterp = mixT;
    const mixArr = (rawArr: Float32Array, blurArr: Float32Array): Float32Array => {
      if (tInterp <= 0) return rawArr;
      if (tInterp >= 1) return blurArr;
      const out = new Float32Array(nCells);
      const a = 1 - tInterp;
      for (let i = 0; i < nCells; i++)
        out[i] = rawArr[i] * a + blurArr[i] * tInterp;
      return out;
    };

    const cntS = mixArr(cnt, cntB);
    const winsS = mixArr(wins, winsB);
    const gpS = mixArr(gp, gpB);
    const glS = mixArr(gl, glB);
    const tpnlS = mixArr(tpnl, tpnlB);
    const buysS = mixArr(buys, buysB);
    const sellsS = mixArr(sells, sellsB);

    const buyWinsS = mixArr(buyWins, buyWinsB);
    const buyGpS = mixArr(buyGp, buyGpB);
    const buyGlS = mixArr(buyGl, buyGlB);
    const buyTpnlS = mixArr(buyTpnl, buyTpnlB);
    const sellWinsS = mixArr(sellWins, sellWinsB);
    const sellGpS = mixArr(sellGp, sellGpB);
    const sellGlS = mixArr(sellGl, sellGlB);
    const sellTpnlS = mixArr(sellTpnl, sellTpnlB);

    // Use blurred density as the "smooth" field (keeps existing hover logic happy).
    const smooth = cntS;
    let maxSmooth = 0;
    for (let i = 0; i < nCells; i++) {
      const v = smooth[i];
      if (v > maxSmooth) maxSmooth = v;
    }

    // Determine PF range (log-scaled) across visible, non-empty cells so colors are comparable
    // within the current viewport. Red = higher Profit Factor, Blue = lower Profit Factor.
    const pfCap = 10; // cap to keep extremes from blowing out the scale
    let minLogPf = Infinity;
    let maxLogPf = -Infinity;
    for (let i = 0; i < nCells; i++) {
      const dens0 = maxSmooth > 0 ? smooth[i] / maxSmooth : 0;
      if (dens0 <= 0.01) continue;
      const c = cntS[i];
      if (!(c > 0.05)) continue;
      const gpp = gpS[i];
      const gll = glS[i];
      let pf = 0;
      if (gll > 1e-6) pf = gpp / gll;
      else if (gpp > 1e-6) pf = pfCap;
      else pf = 0;
      pf = Math.max(0.05, Math.min(pfCap, pf));
      const lp = Math.log(pf);
      if (lp < minLogPf) minLogPf = lp;
      if (lp > maxLogPf) maxLogPf = lp;
    }
    if (
      !Number.isFinite(minLogPf) ||
      !Number.isFinite(maxLogPf) ||
      maxLogPf - minLogPf < 1e-6
    ) {
      minLogPf = Math.log(0.5);
      maxLogPf = Math.log(2);
    }
    const invRange = 1 / (maxLogPf - minLogPf);

    // Draw heatmap:
    // - Hue encodes Profit Factor (blue = low, red = high)
    // - Opacity encodes dampness (local trade density)
    const cellW = w / nx;
    const cellH = h / ny;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const id = iy * nx + ix;
        const dens0 = maxSmooth > 0 ? smooth[id] / maxSmooth : 0;
        if (dens0 <= 0) continue;

        // Density → alpha (smooth + a bit contrast so it "reads" as a field)
        const dens = Math.pow(Math.min(1, Math.max(0, dens0)), 0.55);
        const a = Math.min(0.92, 0.06 + 0.86 * dens);
        if (a <= 0.02) continue;

        // Profit Factor (blurred sums for stability)
        const gpp = gpS[id];
        const gll = glS[id];
        let pf = 0;
        if (gll > 1e-6) pf = gpp / gll;
        else if (gpp > 1e-6) pf = pfCap;
        else pf = 0;
        pf = Math.max(0.05, Math.min(pfCap, pf));
        const lp = Math.log(pf);

        const t0 = (lp - minLogPf) * invRange;
        const t = Math.min(1, Math.max(0, t0));

        // Blue→Red (simple palette)
        const r = Math.round(30 + (245 - 30) * t);
        const g = Math.round(22 + (60 - 22) * (1 - Math.abs(t - 0.5) * 2));
        const b = Math.round(245 - (245 - 30) * t);

        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        // +1 to avoid tiny gaps due to pixel rounding.
        ctx.fillRect(ix * cellW, iy * cellH, cellW + 1, cellH + 1);
      }
    }

    if (heatmapOutRef) {
      (heatmapOutRef as HeatmapOutRef).current = {
        xMin,
        xMax,
        yMin,
        yMax,
        nx,
        ny,
        cnt: cntS,
        wins: winsS,
        gp: gpS,
        gl: glS,
        tpnl: tpnlS,
        buys: buysS,
        sells: sellsS,
        buyWins: buyWinsS,
        buyGp: buyGpS,
        buyGl: buyGlS,
        buyTpnl: buyTpnlS,
        sellWins: sellWinsS,
        sellGp: sellGpS,
        sellGl: sellGlS,
        sellTpnl: sellTpnlS,
        smooth,
        maxSmooth,
      };
    }
  } else {
    if (heatmapOutRef) (heatmapOutRef as HeatmapOutRef).current = null;
  }

  if (!heatmapOn) {
    // Draw in passes so Open Trade + Live Trade always render on top.
    if (!nodes || !Array.isArray(nodes)) return;
    const ordered = [...(nodes as ClusterMapNode[])].filter(n => n != null).sort((a, b) => {
      const rank = (node: ClusterMapNode) => {
        if (!node) return 0;
        const isLib =
          node.kind === "library" ||
          node.libId != null ||
          String(node.id || "").startsWith("lib|");
        const isOpenTrade = !!node.isOpen && node.kind === "trade" && !isLib;
        if (isOpenTrade) return 80; // Open Trade (cyan) on top
        if (node.kind === "close") return 70; // Live Trade point on top
        if (node.kind === "potential") return 60;
        if (isLib) return 30;
        if (node.kind === "trade") return 20;
        if (node.kind === "ghost") return 10;
        return 0;
      };
      const timeMs = (node: ClusterMapNode) => {
        if (!node) return 0;
        const raw = node.time ?? node.entryTime ?? node.exitTime ?? "";
        const s = (typeof raw === "string" ? raw : String(raw)).trim();
        if (!s) return 0;
        if (/^\d+$/.test(s)) {
          const num = Number(s);
          if (!Number.isFinite(num)) return 0;
          const ms = s.length >= 13 ? num : num * 1000;
          return Number.isFinite(ms) ? ms : 0;
        }
        const d = new Date(s);
        const t = d.getTime();
        return Number.isFinite(t) ? t : 0;
      };

      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;

      // Chronological stacking within the same layer:
      // older first, newer last (newer draws on top).
      const ta = timeMs(a);
      const tb = timeMs(b);
      if (ta !== tb) return ta - tb;

      // final tie-breaker: small → big (big draws on top)
      return (a.r ?? 0) - (b.r ?? 0);
    });

    const screenPositions: Record<string, { sx: number; sy: number }> = {};

    // HDBSCAN visualization (2D only): draw cluster hulls behind nodes
    const hdbTyped = hdbOverlay as HDBOverlay | null;
    if (
      (Number(groupOverlayOpacity) || 0) > 0.001 &&
      hdbTyped &&
      !heatmapOn &&
      hdbTyped.clusters &&
      hdbTyped.clusters.length
    ) {
      for (const c of hdbTyped.clusters) {
        const hull = c.hull as [number, number][];
        if (!hull || hull.length < 3) continue;
        const col = colorForLibrary("hdbscan_cluster_" + String(c.id));

        // Expand the hull in screen-space so the grouping extends beyond the nodes.
        const spts = hull.map((p) => toScreen(p[0], p[1]));
        let cx = 0;
        let cy = 0;
        for (const p of spts) {
          cx += p.sx;
          cy += p.sy;
        }
        cx /= spts.length;
        cy /= spts.length;

        const padPix = 18; // outward padding (pixels)
        const expPts = spts.map((p) => {
          const dx = p.sx - cx;
          const dy = p.sy - cy;
          const ll = Math.sqrt(dx * dx + dy * dy) || 1e-9;
          const f = 1 + padPix / ll;
          return { sx: cx + dx * f, sy: cy + dy * f };
        });

        ctx.save();
        ctx.fillStyle = col;
        ctx.strokeStyle = col;

        // darker + more noticeable
        ctx.shadowColor = col;
        ctx.shadowBlur = 18;

        // fill
        ctx.globalAlpha = 0.22 * (Number(groupOverlayOpacity) || 0);
        ctx.beginPath();
        for (let i = 0; i < expPts.length; i++) {
          const sp = expPts[i];
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.closePath();
        ctx.fill();

        // outer stroke
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.72 * (Number(groupOverlayOpacity) || 0);
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        for (let i = 0; i < expPts.length; i++) {
          const sp = expPts[i];
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.closePath();
        ctx.stroke();

        // inner definition stroke
        ctx.globalAlpha = 0.35 * Math.min(1, Number(groupOverlayOpacity) || 0);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        for (let i = 0; i < expPts.length; i++) {
          const sp = expPts[i];
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.restore();
      }
    }

    for (const n of nodes as ClusterMapNode[]) {
      if (!n) continue;
      const { sx, sy } = toScreen(Number(n.x) || 0, Number(n.y) || 0);
      if (sx >= -60 && sy >= -60 && sx <= w + 60 && sy <= h + 60) {
        if (n.id != null) screenPositions[String(n.id)] = { sx, sy };
      }
    }

    const isTop = (n: ClusterMapNode) => {
      if (!n) return false;
      const kind = String(n.kind ?? "").toLowerCase();
      const isLib =
        kind === "library" ||
        n.libId != null ||
        String(n.id || "").startsWith("lib|");
      return (
        kind === "close" ||
        kind === "potential" ||
        (!!n.isOpen && kind === "trade" && !isLib)
      );
    };

    const drawOne = (n: ClusterMapNode) => {
      if (!n) return;
      const kind = String(n.kind ?? "").toLowerCase();
      const { sx, sy } = toScreen(Number(n.x) || 0, Number(n.y) || 0);
      if (sx < -60 || sy < -60 || sx > w + 60 || sy > h + 60) return;

      const isLib =
        kind === "library" ||
        n.libId != null ||
        String(n.id || "").startsWith("lib|");

      const isHovered = hoveredId === n.id;
      const isSearch = searchHighlightId === n.id;
      const r = (Number(n.r) || 0) * (Number(nodeSizeMul) || 1);
      let fill: string;
      let outline: string;

      if (kind === "close") {
        fill = "rgba(255,140,0,0.92)";
        outline = n.dir === 1 ? "rgba(30,180,80,1.0)" : "rgba(180,50,50,1.0)";
      } else if (kind === "potential") {
        fill = "rgba(200,140,255,0.95)";
        outline = n.dir === 1 ? "rgba(30,180,80,1.0)" : "rgba(180,50,50,1.0)";
      } else if (isLib) {
        const win = n.win ?? false ? true : false;
        const libKey = String(n.libId ?? n.metaLib ?? n.id ?? "");
        const isSupp = libKey.toLowerCase() === "suppressed";
        const a = isSupp ? 0.5 : 0.9; // suppressed library = ghost-like
        fill = win ? "rgba(60,220,120," + a + ")" : "rgba(230,80,80," + a + ")";
        outline = n.dir === 1 ? "rgba(30,180,80,1.0)" : "rgba(180,50,50,1.0)";
      } else if (kind === "ghost") {
        if (ghostColored) {
          if (n.isOpen) {
            fill = "rgba(0,210,255,0.90)";
          } else {
            fill =
              n.win ?? false ? "rgba(60,220,120,1.0)" : "rgba(230,80,80,1.0)";
          }
        } else {
          fill = "rgba(150,150,150,0.80)";
        }
        outline = n.dir === 1 ? "rgba(30,180,80,1.0)" : "rgba(180,50,50,1.0)";
      } else {
        if (n.isOpen) {
          fill = "rgba(0,210,255,0.90)";
        } else {
          fill =
            n.win ?? false ? "rgba(60,220,120,0.90)" : "rgba(230,80,80,0.90)";
        }
        outline = n.dir === 1 ? "rgba(30,180,80,1.0)" : "rgba(180,50,50,1.0)";
      }

      // Search spotlight: make the searched node unmistakable.
      if (isSearch) {
        fill = "rgba(255,255,255,0.98)";
        outline = "rgba(255,255,255,1.0)";
      }

      // Glow for potential + open trades (but not libraries)
      if (
        isSearch ||
        n.kind === "close" ||
        n.kind === "potential" ||
        (n.isOpen && !isLib)
      ) {
        ctx.beginPath();
        const glowR = r * 2.3;
        ctx.arc(sx, sy, glowR * (isHovered ? 1.3 : 1.0), 0, Math.PI * 2);
        let glowColor: string;
        if (isSearch) {
          glowColor = "rgba(255,255,255,0.40)";
        } else if (kind === "potential") {
          glowColor = "rgba(200,140,255,0.45)";
        } else if (kind === "close") {
          glowColor = "rgba(255,140,0,0.42)";
        } else {
          glowColor = "rgba(0,210,255,0.42)";
        }
        ctx.fillStyle = glowColor;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(sx, sy, r * (isHovered ? 1.25 : 1.0), 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = (isHovered ? 4 : 2) * (Number(nodeOutlineMul) || 1);
      ctx.strokeStyle = outline;
      ctx.stroke();
    };

    const bgNodes = ordered.filter((n) => !isTop(n));
    const topNodes = ordered.filter((n) => isTop(n));

    // Background nodes first
    for (const n of bgNodes) drawOne(n);

    // Open ↔ Live links (thinner, and above background nodes)
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,80,220,0.86)";
    ctx.shadowColor = "rgba(255,80,220,0.45)";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    for (const n of nodes as ClusterMapNode[]) {
      if (n.kind === "close" && n.parentId) {
        const parent = screenPositions[n.parentId];
        const child = screenPositions[n.id!];
        if (parent && child) {
          ctx.moveTo(parent.sx, parent.sy);
          ctx.lineTo(child.sx, child.sy);
        }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Top nodes last (Open Trades + Live Trade points + Potential)
    for (const n of topNodes) drawOne(n);

    // Ensure the searched/selected node is rendered on top of everything.
    // This makes the white "search-selected" node visually come to the front even in dense regions.
    const pinId = searchHighlightId || null;
    if (pinId != null) {
      const pid = String(pinId);
      const pin =
        ((nodes as ClusterMapNode[]) || []).find((x) => x && String(x.id ?? "") === pid) ||
        ((nodes as ClusterMapNode[]) || []).find(
          (x) =>
            x &&
            (String(x.uid ?? "") === pid ||
              String(x.tradeUid ?? "") === pid ||
              String(x.metaUid ?? "") === pid ||
              String(x.metaTradeUid ?? "") === pid)
        ) ||
        null;

      if (pin) {
        // Draw last so it appears above other nodes/links.
        drawOne(pin);

        // Extra halo to reinforce front-most selection.
        const { sx: psx, sy: psy } = toScreen(
          Number(pin.x) || 0,
          Number(pin.y) || 0
        );
        const pr = (Number(pin.r) || 0) * (Number(nodeSizeMul) || 1);
        const rHalo = Math.max(8, pr * 2.8);

        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2.25;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.shadowColor = "rgba(255,255,255,0.55)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(psx, psy, rHalo, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Selection overlay (2D)
    const boxSelTyped = boxSel as BoxSelection | null;
    if (
      boxSelTyped &&
      (boxSelTyped.rect || boxSelTyped.anchor || (boxSelTyped.lasso && boxSelTyped.lasso.length))
    ) {
      const toS = (x: number, y: number) => ({
        sx: x * scale + viewTyped.ox,
        sy: y * scale + viewTyped.oy,
      });
      ctx.save();
      if (boxSelTyped.rect) {
        const a = toS(boxSelTyped.rect.x0, boxSelTyped.rect.y0);
        const b = toS(boxSelTyped.rect.x1, boxSelTyped.rect.y1);
        const rx = Math.min(a.sx, b.sx);
        const ry = Math.min(a.sy, b.sy);
        const rw = Math.abs(a.sx - b.sx);
        const rh = Math.abs(a.sy - b.sy);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.strokeStyle = "rgba(210,170,255,0.85)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }

      // Free-draw lasso (screen-space path in world coords)
      if (boxSelTyped.lasso && boxSelTyped.lasso.length >= 2) {
        ctx.save();
        ctx.fillStyle = "rgba(80,140,255,0.07)";
        ctx.strokeStyle = "rgba(80,140,255,0.92)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);

        const p0 = toS(boxSelTyped.lasso[0].x, boxSelTyped.lasso[0].y);
        ctx.beginPath();
        ctx.moveTo(p0.sx, p0.sy);
        for (let i = 1; i < boxSelTyped.lasso.length; i++) {
          const pi = toS(boxSelTyped.lasso[i].x, boxSelTyped.lasso[i].y);
          ctx.lineTo(pi.sx, pi.sy);
        }
        if (boxSelTyped.lassoClosed) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (boxSelTyped.anchor && !boxSelTyped.rect) {
        const p = toS(boxSelTyped.anchor.x, boxSelTyped.anchor.y);
        ctx.strokeStyle = "rgba(210,170,255,0.92)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.sx - 14, p.sy);
        ctx.lineTo(p.sx + 14, p.sy);
        ctx.moveTo(p.sx, p.sy - 14);
        ctx.lineTo(p.sx, p.sy + 14);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
