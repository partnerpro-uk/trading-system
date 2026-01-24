"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, LineChart, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const PAIRS = [
  { id: "DXY", name: "DXY", category: "indices" },
  { id: "SPX500_USD", name: "S&P 500", category: "indices" },
  { id: "EUR_USD", name: "EUR/USD", category: "forex" },
  { id: "GBP_USD", name: "GBP/USD", category: "forex" },
  { id: "USD_JPY", name: "USD/JPY", category: "forex" },
  { id: "USD_CHF", name: "USD/CHF", category: "forex" },
  { id: "AUD_USD", name: "AUD/USD", category: "forex" },
  { id: "USD_CAD", name: "USD/CAD", category: "forex" },
  { id: "NZD_USD", name: "NZD/USD", category: "forex" },
  { id: "XAU_USD", name: "Gold", category: "commodities" },
  { id: "BTC_USD", name: "Bitcoin", category: "crypto" },
];

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

function NavLink({ href, icon, label, isActive }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-600 text-white"
          : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function ChartsDropdown({ isActive }: { isActive: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? "bg-blue-600 text-white"
            : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
        }`}
      >
        <LineChart className="w-4 h-4" />
        Charts
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider">
            Forex
          </div>
          {PAIRS.filter((p) => p.category === "forex").map((pair) => (
            <Link
              key={pair.id}
              href={`/chart/${pair.id}`}
              onClick={() => setIsOpen(false)}
              className="block px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
            >
              {pair.name}
            </Link>
          ))}

          <div className="border-t border-gray-700 my-1" />
          <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider">
            Indices
          </div>
          {PAIRS.filter((p) => p.category === "indices").map((pair) => (
            <Link
              key={pair.id}
              href={`/chart/${pair.id}`}
              onClick={() => setIsOpen(false)}
              className="block px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
            >
              {pair.name}
            </Link>
          ))}

          <div className="border-t border-gray-700 my-1" />
          <div className="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wider">
            Commodities & Crypto
          </div>
          {PAIRS.filter((p) => p.category === "commodities" || p.category === "crypto").map(
            (pair) => (
              <Link
                key={pair.id}
                href={`/chart/${pair.id}`}
                onClick={() => setIsOpen(false)}
                className="block px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                {pair.name}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();

  const isDashboard = pathname === "/";
  const isCharts = pathname.startsWith("/chart");
  const isAnalysis = pathname.startsWith("/analysis");

  // Hide navbar on chart pages - they have their own header
  if (isCharts) {
    return null;
  }

  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo / Brand */}
          <Link href="/" className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-500" />
            <span className="text-lg font-bold text-gray-100">Trading System</span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1">
            <NavLink
              href="/"
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Dashboard"
              isActive={isDashboard}
            />
            <ChartsDropdown isActive={isCharts} />
            <NavLink
              href="/analysis"
              icon={<BarChart3 className="w-4 h-4" />}
              label="Analysis"
              isActive={isAnalysis}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
