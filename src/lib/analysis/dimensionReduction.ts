// Dimensionality Reduction Utilities (PCA, UMAP)
// Used for the Cluster Map visualization

import { stableHashToUnit, mulberry32, seedFromKey } from './hashing';
import { clamp } from './math';

// ============================================
// Standardization Functions
// ============================================

export interface StandardizeResult {
  stdData: number[][];
  mean: number[];
  stdev: number[];
}

export function standardiseVectors(data: number[][]): StandardizeResult {
  if (data.length === 0) return { stdData: [], mean: [], stdev: [] };
  const dim = data[0].length;
  const mean = new Array(dim).fill(0);
  const stdev = new Array(dim).fill(0);
  for (const v of data) {
    for (let i = 0; i < dim; i++) {
      mean[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) mean[i] /= data.length;
  for (const v of data) {
    for (let i = 0; i < dim; i++) {
      const d = v[i] - mean[i];
      stdev[i] += d * d;
    }
  }
  for (let i = 0; i < dim; i++) {
    stdev[i] = Math.sqrt(stdev[i] / data.length);
    if (stdev[i] < 1e-8) stdev[i] = 1;
  }
  const stdData: number[][] = [];
  for (const v of data) {
    const row = new Array(dim);
    for (let i = 0; i < dim; i++) {
      row[i] = (v[i] - mean[i]) / stdev[i];
    }
    stdData.push(row);
  }
  return { stdData, mean, stdev };
}

export function standardize2D(xs: number[], ys: number[]): { xs: number[]; ys: number[] } {
  const n = xs.length;
  if (!n) return { xs: [], ys: [] };
  let mx = 0,
    my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let vx = 0,
    vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    vx += dx * dx;
    vy += dy * dy;
  }
  vx = Math.sqrt(vx / n) || 1;
  vy = Math.sqrt(vy / n) || 1;
  const ox = new Array(n);
  const oy = new Array(n);
  for (let i = 0; i < n; i++) {
    ox[i] = (xs[i] - mx) / vx;
    oy[i] = (ys[i] - my) / vy;
  }
  return { xs: ox, ys: oy };
}

export function standardize1D(arr: number[]): number[] {
  const n = arr.length;
  if (!n) return [];
  let m = 0;
  for (let i = 0; i < n; i++) m += arr[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - m;
    v += d * d;
  }
  v = Math.sqrt(v / n) || 1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (arr[i] - m) / v;
  return out;
}

// ============================================
// Linear Algebra Helpers
// ============================================

export function multiplyMatrixVector(mat: number[][], vec: number[]): number[] {
  const dim = vec.length;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0;
    const row = mat[i];
    for (let j = 0; j < dim; j++) {
      sum += row[j] * vec[j];
    }
    out[i] = sum;
  }
  return out;
}

export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function normaliseVector(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

export function l2Dist(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function randomDir(dim: number, seedKey: string): number[] {
  const rand = mulberry32(seedFromKey(seedKey));
  const v = new Array(dim);
  let s = 0;
  for (let i = 0; i < dim; i++) {
    const x = rand() * 2 - 1;
    v[i] = x;
    s += x * x;
  }
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < dim; i++) v[i] /= s;
  return v;
}

// ============================================
// PCA (Principal Component Analysis)
// ============================================

export function powerIteration(cov: number[][], seedKey: string, iterations = 20): number[] {
  const dim = cov.length;
  const vec = new Array(dim);
  for (let i = 0; i < dim; i++) {
    const s = stableHashToUnit(seedKey + i);
    vec[i] = s * 2 - 1;
  }
  let v = normaliseVector(vec);
  for (let iter = 0; iter < iterations; iter++) {
    const next = multiplyMatrixVector(cov, v);
    v = normaliseVector(next);
  }
  return v;
}

export interface PCAResult {
  pc1: number[];
  pc2: number[];
}

export function computePCA(stdData: number[][]): PCAResult {
  if (stdData.length === 0) return { pc1: [], pc2: [] };
  const n = stdData.length;
  const dim = stdData[0].length;
  const cov: number[][] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    cov[i] = new Array(dim).fill(0);
  }
  for (const row of stdData) {
    for (let i = 0; i < dim; i++) {
      const vi = row[i];
      for (let j = i; j < dim; j++) {
        cov[i][j] += vi * row[j];
      }
    }
  }
  const invN = 1 / n;
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      cov[i][j] *= invN;
      cov[j][i] = cov[i][j];
    }
  }
  const pc1 = powerIteration(cov, 'pc1');
  const covPc1 = multiplyMatrixVector(cov, pc1);
  const eig1 = dotProduct(pc1, covPc1);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      cov[i][j] -= eig1 * pc1[i] * pc1[j];
    }
  }
  const pc2 = powerIteration(cov, 'pc2');
  return { pc1, pc2 };
}

export function pca2Coords(stdData: number[][], pc1: number[], pc2: number[]): { xs: number[]; ys: number[] } {
  const n = stdData.length;
  const xs = new Array(n);
  const ys = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = stdData[i];
    let x = 0;
    let y = 0;
    for (let j = 0; j < v.length; j++) {
      const val = v[j];
      x += val * pc1[j];
      y += val * pc2[j];
    }
    xs[i] = x;
    ys[i] = y;
  }
  return { xs, ys };
}

// ============================================
// kNN (k-Nearest Neighbors)
// ============================================

export interface KNNResult {
  nbrIdx: number[][];
  nbrDist: number[][];
}

export function knnBruteforce(X: number[][], k: number): KNNResult {
  const n = X.length;
  const nbrIdx: number[][] = new Array(n);
  const nbrDist: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const bestJ = new Array(k).fill(-1);
    const bestD = new Array(k).fill(Infinity);
    let worstPos = 0;
    let worstD = Infinity;

    for (let t = 0; t < k; t++) {
      if (bestD[t] > worstD) {
        worstD = bestD[t];
        worstPos = t;
      }
    }

    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = l2Dist(X[i], X[j]);
      if (d < bestD[worstPos]) {
        bestD[worstPos] = d;
        bestJ[worstPos] = j;
        worstPos = 0;
        worstD = bestD[0];
        for (let t = 1; t < k; t++) {
          if (bestD[t] > worstD) {
            worstD = bestD[t];
            worstPos = t;
          }
        }
      }
    }

    const pairs = bestJ.map((jj, t) => ({ j: jj, d: bestD[t] }));
    pairs.sort((a, b) => a.d - b.d);
    nbrIdx[i] = pairs.map((p) => p.j);
    nbrDist[i] = pairs.map((p) => p.d);
  }
  return { nbrIdx, nbrDist };
}

// ============================================
// UMAP (Uniform Manifold Approximation)
// ============================================

export function solveSigma(distances: number[], k: number, rho: number): number {
  const target = Math.log2(k);
  let lo = 1e-4;
  let hi = 64;
  for (let it = 0; it < 32; it++) {
    const mid = (lo + hi) * 0.5;
    let s = 0;
    for (let i = 0; i < distances.length; i++) {
      const d = distances[i];
      const v = d <= rho ? 1 : Math.exp(-(d - rho) / mid);
      s += v;
    }
    if (s > target) hi = mid;
    else lo = mid;
  }
  return (lo + hi) * 0.5;
}

export interface FuzzyEdge {
  i: number;
  j: number;
  w: number;
}

export function buildFuzzyGraph(nbrIdx: number[][], nbrDist: number[][]): FuzzyEdge[] {
  const n = nbrIdx.length;
  const k = nbrIdx[0]?.length || 0;
  const map = new Map<string, { a: number; b: number; p1: number; p2: number }>();
  for (let i = 0; i < n; i++) {
    const di = nbrDist[i];
    const ji = nbrIdx[i];
    const rho = di.length ? di[0] : 0;
    const sigma = solveSigma(di, k, rho);
    for (let t = 0; t < ji.length; t++) {
      const j = ji[t];
      const d = di[t];
      const p = d <= rho ? 1 : Math.exp(-(d - rho) / sigma);
      const a = i < j ? i : j;
      const b = i < j ? j : i;
      const key = a + '|' + b;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { a, b, p1: i === a ? p : 0, p2: i === b ? p : 0 });
      } else {
        if (i === a) prev.p1 = p;
        else prev.p2 = p;
        map.set(key, prev);
      }
    }
  }
  const edges: FuzzyEdge[] = [];
  for (const v of map.values()) {
    const p1 = v.p1 || 0;
    const p2 = v.p2 || 0;
    const w = p1 + p2 - p1 * p2;
    if (w > 1e-6) edges.push({ i: v.a, j: v.b, w });
  }
  return edges;
}

export interface UMAPOptions {
  nEpochs?: number;
  negRate?: number;
  learningRate?: number;
  seedKey?: string;
  nNeighbors?: number;
  maxN?: number;
  sampleN?: number;
}

export function optimizeUMAP2D(
  n: number,
  edges: FuzzyEdge[],
  initX: number[],
  initY: number[],
  opts?: UMAPOptions
): { x: number[]; y: number[] } {
  const epochs = opts?.nEpochs ?? 180;
  const negRate = opts?.negRate ?? 4;
  const seed = seedFromKey(opts?.seedKey ?? 'umap');
  const rand = mulberry32(seed);

  const x = initX.slice();
  const y = initY.slice();

  for (let e = 0; e < epochs; e++) {
    const lr = (opts?.learningRate ?? 1.0) * (1 - e / Math.max(1, epochs));
    const offset = Math.floor(rand() * edges.length);
    for (let kk = 0; kk < edges.length; kk++) {
      const edge = edges[(kk + offset) % edges.length];
      if (rand() > edge.w) continue;

      const i = edge.i;
      const j = edge.j;
      let dx = x[i] - x[j];
      let dy = y[i] - y[j];
      const dist2 = dx * dx + dy * dy + 1e-6;

      const att = (edge.w / (1 + dist2)) * lr * 0.5;
      x[i] -= att * dx;
      y[i] -= att * dy;
      x[j] += att * dx;
      y[j] += att * dy;

      for (let t = 0; t < negRate; t++) {
        const k = Math.floor(rand() * n);
        if (k === i || k === j) continue;
        dx = x[i] - x[k];
        dy = y[i] - y[k];
        const d2 = dx * dx + dy * dy + 1e-6;
        const rep = (lr * 0.1) / (1 + d2);
        x[i] += rep * dx;
        y[i] += rep * dy;
        x[k] -= rep * dx;
        y[k] -= rep * dy;
      }
    }
  }
  return { x, y };
}

export function optimizeUMAP3D(
  n: number,
  edges: FuzzyEdge[],
  initX: number[],
  initY: number[],
  initZ: number[],
  opts?: UMAPOptions
): { x: number[]; y: number[]; z: number[] } {
  const epochs = opts?.nEpochs ?? 200;
  const negRate = opts?.negRate ?? 4;
  const seed = seedFromKey(opts?.seedKey ?? 'umap3d');
  const rand = mulberry32(seed);

  const x = initX.slice();
  const y = initY.slice();
  const z = initZ.slice();

  for (let e = 0; e < epochs; e++) {
    const lr = (opts?.learningRate ?? 1.0) * (1 - e / Math.max(1, epochs));
    const offset = Math.floor(rand() * edges.length);
    for (let kk = 0; kk < edges.length; kk++) {
      const edge = edges[(kk + offset) % edges.length];
      if (rand() > edge.w) continue;

      const i = edge.i;
      const j = edge.j;
      let dx = x[i] - x[j];
      let dy = y[i] - y[j];
      let dz = z[i] - z[j];
      const dist2 = dx * dx + dy * dy + dz * dz + 1e-6;

      const att = (edge.w / (1 + dist2)) * lr * 0.5;
      x[i] -= att * dx;
      y[i] -= att * dy;
      z[i] -= att * dz;
      x[j] += att * dx;
      y[j] += att * dy;
      z[j] += att * dz;

      for (let t = 0; t < negRate; t++) {
        const k = Math.floor(rand() * n);
        if (k === i || k === j) continue;
        dx = x[i] - x[k];
        dy = y[i] - y[k];
        dz = z[i] - z[k];
        const d2 = dx * dx + dy * dy + dz * dz + 1e-6;
        const rep = (lr * 0.1) / (1 + d2);
        x[i] += rep * dx;
        y[i] += rep * dy;
        z[i] += rep * dz;
        x[k] -= rep * dx;
        y[k] -= rep * dy;
        z[k] -= rep * dz;
      }
    }
  }
  return { x, y, z };
}

// ============================================
// High-level UMAP Embedding Functions
// ============================================

export interface EmbeddingPoint2D {
  x: number;
  y: number;
}

export interface EmbeddingPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface UMAP2DResult {
  emb: (EmbeddingPoint2D | undefined)[];
  sampleIdx: number[];
  samplePcaX?: number[];
  samplePcaY?: number[];
  sampleEmbX?: number[];
  sampleEmbY?: number[];
  pc1?: number[];
  pc2?: number[];
}

export function computeUMAPEmbedding2D(
  stdData: number[][],
  pc1: number[],
  pc2: number[],
  opts: UMAPOptions = {}
): UMAP2DResult {
  const n = stdData.length;
  if (!n) {
    return {
      emb: [],
      sampleIdx: [],
      samplePcaX: [],
      samplePcaY: [],
      sampleEmbX: [],
      sampleEmbY: [],
    };
  }

  const pca = pca2Coords(stdData, pc1, pc2);
  const useMax = Math.max(100, opts.maxN ?? 2000);
  const sampleN = Math.min(opts.sampleN ?? 1500, useMax);

  let sampleIdx: number[] = [];
  if (n <= useMax) {
    sampleIdx = Array.from({ length: n }, (_, i) => i);
  } else {
    const stride = Math.max(1, Math.ceil(n / sampleN));
    for (let i = 0; i < n && sampleIdx.length < sampleN; i += stride) {
      sampleIdx.push(i);
    }
    if (sampleIdx[sampleIdx.length - 1] !== n - 1 && sampleIdx.length < sampleN)
      sampleIdx.push(n - 1);
  }

  const Xs = sampleIdx.map((i) => stdData[i]);
  if (Xs.length < 3) {
    const { xs, ys } = standardize2D(
      sampleIdx.map((i) => pca.xs[i]),
      sampleIdx.map((i) => pca.ys[i])
    );
    const emb: (EmbeddingPoint2D | undefined)[] = new Array(n);
    for (let t = 0; t < sampleIdx.length; t++)
      emb[sampleIdx[t]] = { x: xs[t], y: ys[t] };
    return {
      emb,
      sampleIdx,
      samplePcaX: sampleIdx.map((i) => pca.xs[i]),
      samplePcaY: sampleIdx.map((i) => pca.ys[i]),
      sampleEmbX: xs.slice(),
      sampleEmbY: ys.slice(),
      pc1,
      pc2,
    };
  }

  const { xs: initPX, ys: initPY } = standardize2D(
    sampleIdx.map((i) => pca.xs[i]),
    sampleIdx.map((i) => pca.ys[i])
  );

  const k = clamp(opts.nNeighbors ?? 18, 5, 45);
  const { nbrIdx, nbrDist } = knnBruteforce(
    Xs,
    Math.min(k, Math.max(2, Xs.length - 1))
  );
  const edges = buildFuzzyGraph(nbrIdx, nbrDist);

  const { x: embX, y: embY } = optimizeUMAP2D(
    Xs.length,
    edges,
    initPX,
    initPY,
    {
      nEpochs: opts.nEpochs ?? 180,
      negRate: opts.negRate ?? 4,
      learningRate: opts.learningRate ?? 1.0,
      seedKey: opts.seedKey ?? 'cluster-umap',
    }
  );

  const emb: (EmbeddingPoint2D | undefined)[] = new Array(n);
  const samplePcaX = sampleIdx.map((i) => pca.xs[i]);
  const samplePcaY = sampleIdx.map((i) => pca.ys[i]);
  const sampleEmbX = embX.slice();
  const sampleEmbY = embY.slice();

  if (n <= useMax) {
    for (let t = 0; t < sampleIdx.length; t++) {
      emb[sampleIdx[t]] = { x: embX[t], y: embY[t] };
    }
  } else {
    for (let i = 0; i < n; i++) {
      const px = pca.xs[i];
      const py = pca.ys[i];
      let best = 0;
      let bestD = Infinity;
      for (let t = 0; t < sampleIdx.length; t++) {
        const dx = px - samplePcaX[t];
        const dy = py - samplePcaY[t];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = t;
        }
      }
      const jx = (stableHashToUnit('umap-jx-' + i) - 0.5) * 0.02;
      const jy = (stableHashToUnit('umap-jy-' + i) - 0.5) * 0.02;
      emb[i] = { x: sampleEmbX[best] + jx, y: sampleEmbY[best] + jy };
    }
  }

  return {
    emb,
    sampleIdx,
    samplePcaX,
    samplePcaY,
    sampleEmbX,
    sampleEmbY,
    pc1,
    pc2,
  };
}

export interface UMAP3DResult {
  emb: (EmbeddingPoint3D | undefined)[];
  sampleIdx: number[];
  pc1?: number[];
  pc2?: number[];
}

export function computeUMAPEmbedding3D(
  stdData: number[][],
  pc1: number[],
  pc2: number[],
  opts: UMAPOptions = {}
): UMAP3DResult {
  const n = stdData.length;
  if (!n) return { emb: [], sampleIdx: [] };

  const pca = pca2Coords(stdData, pc1, pc2);
  const useMax = Math.max(150, opts.maxN ?? 2500);
  const sampleN = Math.min(opts.sampleN ?? 1600, useMax);

  let sampleIdx: number[] = [];
  if (n <= useMax) {
    sampleIdx = Array.from({ length: n }, (_, i) => i);
  } else {
    const stride = Math.max(1, Math.ceil(n / sampleN));
    for (let i = 0; i < n && sampleIdx.length < sampleN; i += stride) {
      sampleIdx.push(i);
    }
    if (
      sampleIdx[sampleIdx.length - 1] !== n - 1 &&
      sampleIdx.length < sampleN
    ) {
      sampleIdx.push(n - 1);
    }
  }

  const Xs = sampleIdx.map((i) => stdData[i]);
  if (Xs.length < 4) {
    const xs = standardize1D(sampleIdx.map((i) => pca.xs[i]));
    const ys = standardize1D(sampleIdx.map((i) => pca.ys[i]));
    const zs = standardize1D(
      sampleIdx.map((i) => stableHashToUnit('umap3d-z-' + i))
    );
    const emb: (EmbeddingPoint3D | undefined)[] = new Array(n);
    for (let t = 0; t < sampleIdx.length; t++) {
      emb[sampleIdx[t]] = { x: xs[t], y: ys[t], z: zs[t] };
    }
    return { emb, sampleIdx, pc1, pc2 };
  }

  const initX = standardize1D(sampleIdx.map((i) => pca.xs[i]));
  const initY = standardize1D(sampleIdx.map((i) => pca.ys[i]));
  const zDir = randomDir(
    stdData[0].length,
    (opts.seedKey ?? 'cluster-umap3d') + '-zdir'
  );
  const initZ = standardize1D(sampleIdx.map((i) => dot(stdData[i], zDir)));

  const k = clamp(opts.nNeighbors ?? 18, 5, 50);
  const { nbrIdx, nbrDist } = knnBruteforce(
    Xs,
    Math.min(k, Math.max(2, Xs.length - 1))
  );
  const edges = buildFuzzyGraph(nbrIdx, nbrDist);

  const {
    x: ex,
    y: ey,
    z: ez,
  } = optimizeUMAP3D(Xs.length, edges, initX, initY, initZ, {
    nEpochs: opts.nEpochs ?? 220,
    negRate: opts.negRate ?? 4,
    learningRate: opts.learningRate ?? 1.0,
    seedKey: opts.seedKey ?? 'cluster-umap3d',
  });

  const emb: (EmbeddingPoint3D | undefined)[] = new Array(n);
  if (n <= useMax) {
    for (let t = 0; t < sampleIdx.length; t++) {
      emb[sampleIdx[t]] = { x: ex[t], y: ey[t], z: ez[t] };
    }
  } else {
    const samplePcaX = sampleIdx.map((i) => pca.xs[i]);
    const samplePcaY = sampleIdx.map((i) => pca.ys[i]);
    for (let i = 0; i < n; i++) {
      const px = pca.xs[i];
      const py = pca.ys[i];
      let best = 0;
      let bestD = Infinity;
      for (let t = 0; t < sampleIdx.length; t++) {
        const dx = px - samplePcaX[t];
        const dy = py - samplePcaY[t];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = t;
        }
      }
      const jx = (stableHashToUnit('umap3d-jx-' + i) - 0.5) * 0.02;
      const jy = (stableHashToUnit('umap3d-jy-' + i) - 0.5) * 0.02;
      const jz = (stableHashToUnit('umap3d-jz-' + i) - 0.5) * 0.02;
      emb[i] = { x: ex[best] + jx, y: ey[best] + jy, z: ez[best] + jz };
    }
  }

  return { emb, sampleIdx, pc1, pc2 };
}
