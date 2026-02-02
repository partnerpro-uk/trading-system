// Shared pairs configuration - single source of truth for all UI components

export interface Pair {
  id: string;
  name: string;
  description: string;
  category: "forex" | "indices" | "commodities" | "crypto";
}

export const PAIRS: Pair[] = [
  // Indices
  { id: "DXY", name: "DXY", description: "US Dollar Index", category: "indices" },
  { id: "SPX500_USD", name: "S&P 500", description: "S&P 500 Index", category: "indices" },
  { id: "NAS100_USD", name: "Nasdaq 100", description: "Nasdaq 100 Index", category: "indices" },
  // Forex Majors
  { id: "EUR_USD", name: "EUR/USD", description: "Euro / US Dollar", category: "forex" },
  { id: "GBP_USD", name: "GBP/USD", description: "British Pound / US Dollar", category: "forex" },
  { id: "USD_JPY", name: "USD/JPY", description: "US Dollar / Japanese Yen", category: "forex" },
  { id: "USD_CHF", name: "USD/CHF", description: "US Dollar / Swiss Franc", category: "forex" },
  { id: "AUD_USD", name: "AUD/USD", description: "Australian Dollar / US Dollar", category: "forex" },
  { id: "USD_CAD", name: "USD/CAD", description: "US Dollar / Canadian Dollar", category: "forex" },
  { id: "NZD_USD", name: "NZD/USD", description: "New Zealand Dollar / US Dollar", category: "forex" },
  // Commodities
  { id: "XAU_USD", name: "Gold", description: "Gold / US Dollar", category: "commodities" },
  { id: "XAG_USD", name: "Silver", description: "Silver / US Dollar", category: "commodities" },
  // Crypto
  { id: "BTC_USD", name: "Bitcoin", description: "Bitcoin / US Dollar", category: "crypto" },
];

// Pair IDs only (for API routes)
export const PAIR_IDS = PAIRS.map((p) => p.id);

// Category definitions
export type PairCategory = "forex" | "indices" | "commodities" | "crypto";

export const PAIR_CATEGORIES: readonly { key: PairCategory; label: string }[] = [
  { key: "forex", label: "Forex" },
  { key: "indices", label: "Indices" },
  { key: "commodities", label: "Commodities" },
  { key: "crypto", label: "Crypto" },
];

// Pairs grouped by category
export interface PairsByCategory {
  key: PairCategory;
  label: string;
  pairs: Pair[];
}

export const PAIRS_BY_CATEGORY: PairsByCategory[] = PAIR_CATEGORIES.map((cat) => ({
  ...cat,
  pairs: PAIRS.filter((p) => p.category === cat.key),
})).filter((cat) => cat.pairs.length > 0);

// Price formatting based on pair type
export function formatPrice(pair: string, price: number): string {
  if (pair === "USD_JPY") return price.toFixed(3);
  if (pair === "XAU_USD") return price.toFixed(2);
  if (pair === "XAG_USD") return price.toFixed(4);
  if (pair === "BTC_USD") return price.toFixed(0);
  if (pair === "SPX500_USD" || pair === "NAS100_USD") return price.toFixed(1);
  if (pair === "DXY") return price.toFixed(3);
  return price.toFixed(5);
}
