"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { BarChart2, LineChart, TrendingUp, ArrowRight } from "lucide-react";

interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

const PAIRS = [
  // Indices
  { id: "DXY", name: "DXY", description: "US Dollar Index", category: "indices" },
  { id: "SPX500_USD", name: "S&P 500", description: "S&P 500 Index", category: "indices" },
  // Forex Majors
  { id: "EUR_USD", name: "EUR/USD", description: "Euro / US Dollar", category: "forex" },
  { id: "GBP_USD", name: "GBP/USD", description: "British Pound / US Dollar", category: "forex" },
  { id: "USD_JPY", name: "USD/JPY", description: "US Dollar / Japanese Yen", category: "forex" },
  { id: "USD_CHF", name: "USD/CHF", description: "US Dollar / Swiss Franc", category: "forex" },
  { id: "AUD_USD", name: "AUD/USD", description: "Australian Dollar / US Dollar", category: "forex" },
  { id: "USD_CAD", name: "USD/CAD", description: "US Dollar / Canadian Dollar", category: "forex" },
  { id: "NZD_USD", name: "NZD/USD", description: "New Zealand Dollar / US Dollar", category: "forex" },
  // Commodities & Crypto
  { id: "XAU_USD", name: "Gold", description: "Gold / US Dollar", category: "commodities" },
  { id: "BTC_USD", name: "Bitcoin", description: "Bitcoin / US Dollar", category: "crypto" },
];

function formatPrice(pair: string, price: number): string {
  if (pair === "USD_JPY") return price.toFixed(3);
  if (pair === "XAU_USD") return price.toFixed(2);
  if (pair === "BTC_USD") return price.toFixed(0);
  if (pair === "SPX500_USD") return price.toFixed(1);
  if (pair === "DXY") return price.toFixed(3);
  return price.toFixed(5);
}

function PairCard({
  pair,
  priceData,
}: {
  pair: (typeof PAIRS)[number];
  priceData?: PriceData;
}) {
  const isPositive = priceData && priceData.changePercent > 0;
  const isNegative = priceData && priceData.changePercent < 0;

  return (
    <Link
      href={`/chart/${pair.id}`}
      className="block p-4 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-600 hover:bg-gray-800/50 transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-100 group-hover:text-white">
            {pair.name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">{pair.description}</p>
        </div>
        <div className="text-right">
          {priceData ? (
            <>
              <div className="font-mono text-sm text-gray-200">
                {formatPrice(pair.id, priceData.price)}
              </div>
              <div
                className={`text-xs font-medium ${
                  isPositive
                    ? "text-green-500"
                    : isNegative
                    ? "text-red-500"
                    : "text-gray-500"
                }`}
              >
                {isPositive ? "+" : ""}
                {priceData.changePercent.toFixed(2)}%
              </div>
            </>
          ) : (
            <div className="w-16 h-8 bg-gray-800 rounded animate-pulse" />
          )}
        </div>
      </div>
    </Link>
  );
}

function QuickAccessCard({
  href,
  icon: Icon,
  title,
  description,
  color,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 p-5 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-600 hover:bg-gray-800/50 transition-all group"
    >
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-gray-100 group-hover:text-white">
          {title}
        </h3>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
      <ArrowRight className="w-5 h-5 text-gray-600 group-hover:text-gray-400 transition-colors" />
    </Link>
  );
}

export default function Home() {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch("/api/prices");
        if (response.ok) {
          const data = await response.json();
          setPrices(data);
        }
      } catch (error) {
        console.error("Failed to fetch prices:", error);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, []);

  const forexPairs = PAIRS.filter((p) => p.category === "forex");
  const indicesPairs = PAIRS.filter((p) => p.category === "indices");
  const otherPairs = PAIRS.filter(
    (p) => p.category === "commodities" || p.category === "crypto"
  );

  return (
    <div className="min-h-screen bg-gray-950">
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Quick Access */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Quick Access</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <QuickAccessCard
              href="/chart/EUR_USD"
              icon={LineChart}
              title="Charts"
              description="View live charts with real-time price data"
              color="bg-blue-600"
            />
            <QuickAccessCard
              href="/analysis"
              icon={TrendingUp}
              title="Analysis"
              description="Run cluster analysis on historical data"
              color="bg-purple-600"
            />
          </div>
        </section>

        {/* Forex Majors */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Forex Majors</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {forexPairs.map((pair) => (
              <PairCard key={pair.id} pair={pair} priceData={prices[pair.id]} />
            ))}
          </div>
        </section>

        {/* Indices */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Indices</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {indicesPairs.map((pair) => (
              <PairCard key={pair.id} pair={pair} priceData={prices[pair.id]} />
            ))}
          </div>
        </section>

        {/* Commodities & Crypto */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-4">
            Commodities & Crypto
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {otherPairs.map((pair) => (
              <PairCard key={pair.id} pair={pair} priceData={prices[pair.id]} />
            ))}
          </div>
        </section>

        {/* Info Box */}
        <section className="mt-8 p-5 bg-gray-900/50 rounded-xl border border-gray-800">
          <div className="flex items-start gap-3">
            <BarChart2 className="w-5 h-5 text-blue-500 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-1">
                AI-Augmented Trading
              </h3>
              <p className="text-sm text-gray-500">
                Use the Analysis module to run cluster analysis, pattern recognition, and
                statistical backtesting on your historical data. Click on any pair to view
                its live chart with session tracking and news events.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
