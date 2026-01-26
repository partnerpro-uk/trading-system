"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { BarChart2, LineChart, TrendingUp, ArrowRight, Zap, Shield, BarChart3, BookOpen, Activity } from "lucide-react";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";

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

// Landing page for unauthenticated users
function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-transparent to-purple-600/10" />

        <div className="relative max-w-7xl mx-auto px-4 py-20 sm:py-32">
          <div className="text-center max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-6">
              <BarChart3 className="w-10 h-10 text-blue-500" />
              <span className="text-2xl font-bold text-gray-100">Trading System</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
              Professional Trading
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500"> Analysis Platform</span>
            </h1>

            <p className="text-lg sm:text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
              Track your trades, analyze market sessions, and journal your trading journey with our comprehensive trading toolkit.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <SignUpButton mode="modal">
                <button className="w-full sm:w-auto px-8 py-3 text-lg font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                  Get Started Free
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="w-full sm:w-auto px-8 py-3 text-lg font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors border border-gray-700">
                  Sign In
                </button>
              </SignInButton>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-7xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center text-gray-200 mb-12">
          Everything you need for serious trading
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={LineChart}
            title="Advanced Charts"
            description="Professional charting with session markers, news events, and drawing tools. Multiple timeframes from M5 to Monthly."
            color="bg-blue-600"
          />
          <FeatureCard
            icon={BookOpen}
            title="Trade Journal"
            description="Log and track your trades with automatic P&L calculation, win rate statistics, and performance metrics."
            color="bg-green-600"
          />
          <FeatureCard
            icon={Activity}
            title="Session Tracking"
            description="Visual markers for London, New York, and Asian trading sessions. Know exactly when markets are most active."
            color="bg-purple-600"
          />
          <FeatureCard
            icon={Zap}
            title="Real-time Data"
            description="Live price streaming from OANDA with automatic candle updates. Never miss a market move."
            color="bg-yellow-600"
          />
          <FeatureCard
            icon={TrendingUp}
            title="Performance Tracking"
            description="Track your win rate, P&L, and trading patterns. Know which setups work best for your style."
            color="bg-pink-600"
          />
          <FeatureCard
            icon={Shield}
            title="Your Data, Private"
            description="All your trades and drawings are private to your account. Nobody else can see your analysis."
            color="bg-cyan-600"
          />
        </div>
      </div>

      {/* CTA Section */}
      <div className="max-w-7xl mx-auto px-4 py-16">
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-2xl border border-gray-800 p-8 sm:p-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Ready to level up your trading?
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Join now and start tracking your trades, analyzing your performance, and improving your results.
          </p>
          <SignUpButton mode="modal">
            <button className="px-8 py-3 text-lg font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
              Create Free Account
            </button>
          </SignUpButton>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
          Trading System - Professional analysis for serious traders
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
      <div className={`w-12 h-12 rounded-lg ${color} flex items-center justify-center mb-4`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="text-lg font-semibold text-gray-100 mb-2">{title}</h3>
      <p className="text-gray-500 text-sm">{description}</p>
    </div>
  );
}

// Dashboard for authenticated users
function Dashboard() {
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
              href="/trades"
              icon={BookOpen}
              title="Trade Journal"
              description="Track and review your trades"
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
                Professional Trading Tools
              </h3>
              <p className="text-sm text-gray-500">
                Click on any pair to view its live chart with session tracking and news events.
                Use the Trade Journal to log and review your trades.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <SignedOut>
        <LandingPage />
      </SignedOut>
      <SignedIn>
        <Dashboard />
      </SignedIn>
    </>
  );
}
