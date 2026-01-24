// ============================================
// TRADE INTERFACE
// Supports multiple naming conventions from different data sources
// ============================================
export interface Trade {
  // Identity
  id?: string;
  uid?: string;
  tradeId?: string;

  // Entry (multiple naming conventions)
  entryTime?: string | number;
  entryTs?: number;
  openTime?: string | number;
  time?: string | number;

  entryPrice?: number;
  entry?: number;
  openPrice?: number;

  entryIndex?: number;
  entryIdx?: number;
  entryBar?: number;
  iEntry?: number;
  entry_i?: number;

  // Exit
  exitTime?: string | number;
  exitTs?: number;
  closeTime?: string | number;

  exitPrice?: number;
  exit?: number;
  closePrice?: number;
  close?: number;

  exitIndex?: number;
  exitIdx?: number;
  exitBar?: number;
  iExit?: number;
  exit_i?: number;

  // Direction
  dir?: number; // 1 = long, -1 = short
  direction?: number;
  sideNum?: number;
  side?: string | number;
  Side?: string;
  dirText?: string;
  directionText?: string;

  // PnL
  pnl?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  profit?: number;
  netPnl?: number;

  // Status
  isOpen?: boolean;

  // Duration
  barsHeld?: number;
  bars?: number;
  barsInTrade?: number;
  bars_in_trade?: number;

  // TP/SL
  tp?: number;
  tpPrice?: number;
  takeProfit?: number;
  sl?: number;
  slPrice?: number;
  stopLoss?: number;

  // Cluster info
  closestCluster?: string;
  closestClusterUid?: string;
  closestClusterPnl?: number;

  // Flexible fallback for unknown properties
  [key: string]: unknown;
}

// ============================================
// NODE INTERFACE (for cluster map)
// ============================================
export interface ClusterNode {
  // Identity
  id?: string;
  uid?: string;
  metaUid?: string;
  tradeUid?: string;

  // Type
  kind?: "trade" | "library" | "ghost" | string;
  isOpen?: boolean;

  // Coordinates
  x?: number;
  y?: number;
  z?: number;

  // Cluster membership
  clusterId?: number;
  hdbClusterId?: number;
  closestCluster?: string;
  closestClusterUid?: string;

  // Stats
  hdbWinRate?: number;
  winRate?: number;
  confidence?: number;
  aiMargin?: number;

  // Trade properties (when kind === 'trade')
  entryPrice?: number;
  entryIndex?: number;
  exitIndex?: number;
  dir?: number;
  pnl?: number;

  // Library properties
  libId?: string;
  metaLib?: string;
  weight?: number;

  // Time properties (for ID generation)
  entryTime?: string | number;
  entryTimestamp?: number;
  entryTs?: number;
  openTime?: string | number;
  openTimestamp?: number;
  metaTime?: string | number;
  time?: string | number;
  timestamp?: number;
  t?: number;

  // Additional identity fields
  tradeId?: string;
  metaTradeUid?: string;
  mitUid?: string;
  mitId?: string;

  // Model info
  model?: string;
  origModel?: string;
  aiMode?: string;

  // Rendering
  r?: number;
  color?: string;

  [key: string]: unknown;
}

// ============================================
// LIBRARY POINT INTERFACE
// ============================================
export interface LibraryPoint {
  id?: string;
  uid?: string;
  metaUid?: string;
  metaTime?: string | number;

  // Embedding vector
  v?: number[];

  // Trade metadata
  dir?: number;
  metaSession?: string;
  metaOutcome?: "Win" | "Loss" | string;
  metaPnl?: number;
  metaSuppressed?: boolean;

  // Source
  kind?: string;
  libId?: string;

  [key: string]: unknown;
}

// ============================================
// CLUSTER INTERFACE
// ============================================
export interface Cluster {
  id?: number;
  clusterId?: number;

  // Geometry
  hull?: [number, number][];

  // Stats
  stats?: {
    winRate?: number;
    wins?: number;
    losses?: number;
    count?: number;
    profitFactor?: number;
    [key: string]: unknown;
  };

  [key: string]: unknown;
}

// ============================================
// ANALYSIS CANDLE INTERFACE
// Compatible with the existing Candle from lib/db/candles.ts
// ============================================
export interface AnalysisCandle {
  time: string;
  timestamp: number;
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: unknown;
}

// ============================================
// CANDLE TYPE ALIAS
// Used by ClusterMap and other components
// ============================================
export interface Candle {
  time?: string;
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  pair?: string;
  timeframe?: string;
  [key: string]: unknown;
}

// ============================================
// SIMULATION STATS
// ============================================
export interface SimulationStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  rr: number;
  sharpe: number;
  sortino: number;
  avgDrawdown: number;
  avgWinDurationMin: number;
  avgLossDurationMin: number;
}

// ============================================
// COMPUTE SETTINGS
// ============================================
export interface ComputeSettings {
  pair: string;
  timeframe: string;
  model: string;
  tpDist: number;
  slDist: number;
  chunkBars: number;
  featureLevels: Record<string, number>;
  aiMethod: "off" | "knn" | "hdbscan";
  aiModalities: Record<string, boolean>;
  librarySettings: Record<string, unknown>;
  activeLibraries: Record<string, boolean>;
}

// ============================================
// COMPUTE RESULT
// ============================================
export interface ComputeResult {
  trades: Trade[];
  ghostEntries: Trade[];
  libraryPoints: LibraryPoint[];
  clusters: Cluster[];
  stats: SimulationStats;
}
