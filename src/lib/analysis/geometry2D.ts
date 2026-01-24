// 2D Geometry Utilities
// Used for cluster visualization, projections, and 2D clustering

/**
 * Project a high-dimensional vector to 2D using deterministic pseudo-random weights
 */
export function projectTo2D(
  v: number[],
  seedA: number,
  seedB: number
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < v.length; i++) {
    const s1 = Math.sin((i + 1) * 12.9898 + seedA * 78.233) * 43758.5453;
    const s2 = Math.sin((i + 1) * 93.9898 + seedB * 11.133) * 12731.9182;
    const w1 = (s1 - Math.floor(s1)) * 2 - 1;
    const w2 = (s2 - Math.floor(s2)) * 2 - 1;
    x += v[i] * w1;
    y += v[i] * w2;
  }
  return { x, y };
}

export type Point2D = [number, number];

/**
 * Compute convex hull of 2D points using Andrew's monotone chain algorithm
 */
export function convexHull2D(pts: Point2D[]): Point2D[] {
  if (!pts || pts.length < 3) return pts || [];
  const p = pts
    .slice()
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));

  const cross = (o: Point2D, a: Point2D, b: Point2D): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Point2D[] = [];
  for (const pt of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0
    )
      lower.pop();
    lower.push(pt);
  }

  const upper: Point2D[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0
    )
      upper.pop();
    upper.push(pt);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Euclidean distance between two 2D points
 */
export function dist2(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export interface DBSCAN2DResult {
  labels: number[];
  nClusters: number;
}

/**
 * DBSCAN clustering algorithm for 2D points
 */
export function dbscan2D(
  points: Point2D[],
  eps: number,
  minSamples: number
): DBSCAN2DResult {
  const n = points.length;
  const labels = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);
  let clusterId = 0;

  // Precompute neighborhoods
  const neigh: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ni: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (dist2(points[i], points[j]) <= eps) ni.push(j);
    }
    neigh[i] = ni;
  }

  const expand = (i: number, neighbors: number[], cid: number) => {
    labels[i] = cid;
    const queue = neighbors.slice();
    while (queue.length) {
      const j = queue.shift() as number;
      if (!visited[j]) {
        visited[j] = true;
        const nj = neigh[j];
        if (nj.length + 1 >= minSamples) {
          for (const u of nj) if (!queue.includes(u)) queue.push(u);
        }
      }
      if (labels[j] === -1) labels[j] = cid;
    }
  };

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const nbs = neigh[i];
    if (nbs.length + 1 < minSamples) {
      labels[i] = -1;
    } else {
      expand(i, nbs, clusterId);
      clusterId++;
    }
  }

  return { labels, nClusters: clusterId };
}
