"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

interface UpcomingEvent {
  eventId: string;
  name: string;
  currency: string;
  impact: string;
  timestamp: number;
  datetimeLondon: string | null;
}

const PAIRS = [
  // Indices
  { id: "DXY", name: "DXY", category: "indices" },
  { id: "SPX500_USD", name: "S&P 500", category: "indices" },
  // Forex Majors
  { id: "EUR_USD", name: "EUR/USD", category: "forex" },
  { id: "GBP_USD", name: "GBP/USD", category: "forex" },
  { id: "USD_JPY", name: "USD/JPY", category: "forex" },
  { id: "USD_CHF", name: "USD/CHF", category: "forex" },
  { id: "AUD_USD", name: "AUD/USD", category: "forex" },
  { id: "USD_CAD", name: "USD/CAD", category: "forex" },
  { id: "NZD_USD", name: "NZD/USD", category: "forex" },
  // Commodities & Crypto
  { id: "XAU_USD", name: "Gold", category: "commodities" },
  { id: "BTC_USD", name: "Bitcoin", category: "crypto" },
];

interface ChartSidebarProps {
  currentPair: string;
  magnetMode: boolean;
  onMagnetModeChange: (value: boolean) => void;
  showSessionBgs: boolean;
  onShowSessionBgsChange: (value: boolean) => void;
  showSessionLines: boolean;
  onShowSessionLinesChange: (value: boolean) => void;
  showSessionLabels: boolean;
  onShowSessionLabelsChange: (value: boolean) => void;
  showNews: boolean;
  onShowNewsChange: (value: boolean) => void;
}

// Format price based on pair type
function formatPrice(pair: string, price: number): string {
  if (pair === "USD_JPY") return price.toFixed(3);
  if (pair === "XAU_USD") return price.toFixed(2);
  if (pair === "BTC_USD") return price.toFixed(0);
  if (pair === "SPX500_USD") return price.toFixed(1);
  if (pair === "DXY") return price.toFixed(3);
  return price.toFixed(5);
}

// Format countdown until event
function formatCountdown(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;

  if (diff <= 0) return "Now";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Format time from London datetime
function formatEventTime(datetimeLondon: string | null, timestamp: number): string {
  if (datetimeLondon) {
    const timePart = datetimeLondon.split(" ")[1];
    if (timePart) {
      return timePart.slice(0, 5) + " UK";
    }
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " UTC";
}

export function ChartSidebar({
  currentPair,
  magnetMode,
  onMagnetModeChange,
  showSessionBgs,
  onShowSessionBgsChange,
  showSessionLines,
  onShowSessionLinesChange,
  showSessionLabels,
  onShowSessionLabelsChange,
  showNews,
  onShowNewsChange,
}: ChartSidebarProps) {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [, setCountdownTick] = useState(0);

  // Fetch prices on mount and every 5 seconds
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

  // Fetch upcoming events on mount and every minute
  useEffect(() => {
    const fetchUpcoming = async () => {
      try {
        const response = await fetch("/api/news/upcoming?limit=8");
        if (response.ok) {
          const data = await response.json();
          setUpcomingEvents(data.events || []);
        }
      } catch (error) {
        console.error("Failed to fetch upcoming events:", error);
      }
    };

    fetchUpcoming();
    const interval = setInterval(fetchUpcoming, 60000);
    return () => clearInterval(interval);
  }, []);

  // Update countdown every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdownTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full bg-gray-900 border-l border-gray-800 flex flex-col">
      {/* Pairs Section */}
      <div className="p-3 border-b border-gray-800 flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Pairs
        </h3>
        <div className="space-y-0.5">
          {PAIRS.map((pair) => {
            const priceData = prices[pair.id];
            const isActive = currentPair === pair.id;
            const isPositive = priceData && priceData.changePercent > 0;
            const isNegative = priceData && priceData.changePercent < 0;

            return (
              <Link
                key={pair.id}
                href={`/chart/${pair.id}`}
                className={`flex items-center justify-between px-2 py-1.5 text-sm rounded transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <span className="font-medium">{pair.name}</span>
                {priceData && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`font-mono ${isActive ? "text-white" : "text-gray-300"}`}>
                      {formatPrice(pair.id, priceData.price)}
                    </span>
                    <span
                      className={`${
                        isActive
                          ? isPositive
                            ? "text-green-300"
                            : isNegative
                            ? "text-red-300"
                            : "text-gray-300"
                          : isPositive
                          ? "text-green-500"
                          : isNegative
                          ? "text-red-500"
                          : "text-gray-500"
                      }`}
                    >
                      {isPositive ? "▲" : isNegative ? "▼" : "─"}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Upcoming Events Section */}
      {upcomingEvents.length > 0 && (
        <div className="p-3 border-b border-gray-800">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Upcoming Events
          </h3>
          <div className="space-y-1.5">
            {upcomingEvents.slice(0, 6).map((event) => {
              const isImminent = event.timestamp - Date.now() < 60 * 60 * 1000; // < 1 hour
              const isVeryClose = event.timestamp - Date.now() < 15 * 60 * 1000; // < 15 min

              return (
                <div
                  key={event.eventId}
                  className={`px-2 py-1.5 rounded text-xs ${
                    isVeryClose
                      ? "bg-red-900/40 border border-red-800/50"
                      : isImminent
                      ? "bg-amber-900/30 border border-amber-800/30"
                      : "bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          event.impact === "High" ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      <span className="text-gray-300 truncate">{event.name}</span>
                    </div>
                    <span className="text-gray-500 flex-shrink-0">{event.currency}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-gray-500">
                    <span>{formatEventTime(event.datetimeLondon, event.timestamp)}</span>
                    <span
                      className={`font-medium ${
                        isVeryClose
                          ? "text-red-400"
                          : isImminent
                          ? "text-amber-400"
                          : "text-gray-400"
                      }`}
                    >
                      {formatCountdown(event.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls Section */}
      <div className="p-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Controls
        </h3>
        <div className="space-y-2">
          {/* News & Magnet toggles */}
          <div className="flex gap-2">
            <button
              onClick={() => onShowNewsChange(!showNews)}
              className={`flex-1 px-2 py-2 text-xs rounded transition-colors ${
                showNews
                  ? "bg-red-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              News
            </button>
            <button
              onClick={() => onMagnetModeChange(!magnetMode)}
              className={`flex-1 px-2 py-2 text-xs rounded transition-colors ${
                magnetMode
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              Magnet
            </button>
          </div>

          {/* Sessions toggles - 3 separate controls */}
          <div className="mt-3">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Sessions</span>
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => onShowSessionBgsChange(!showSessionBgs)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  showSessionBgs
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
                title="Session background colors"
              >
                BGs
              </button>
              <button
                onClick={() => onShowSessionLinesChange(!showSessionLines)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  showSessionLines
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
                title="Session H/L lines"
              >
                Lines
              </button>
              <button
                onClick={() => onShowSessionLabelsChange(!showSessionLabels)}
                className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                  showSessionLabels
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
                title="Session H/L labels"
              >
                Labels
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
