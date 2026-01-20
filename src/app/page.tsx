import Link from "next/link";
import { BarChart2 } from "lucide-react";

const PAIRS = [
  { id: "DXY", name: "DXY", description: "US Dollar Index" },
  { id: "EUR_USD", name: "EUR/USD", description: "Euro / US Dollar" },
  { id: "GBP_USD", name: "GBP/USD", description: "British Pound / US Dollar" },
  { id: "USD_JPY", name: "USD/JPY", description: "US Dollar / Japanese Yen" },
  { id: "USD_CHF", name: "USD/CHF", description: "US Dollar / Swiss Franc" },
  { id: "AUD_USD", name: "AUD/USD", description: "Australian Dollar / US Dollar" },
  { id: "USD_CAD", name: "USD/CAD", description: "US Dollar / Canadian Dollar" },
  { id: "NZD_USD", name: "NZD/USD", description: "New Zealand Dollar / US Dollar" },
];

function PairCard({ pair }: { pair: (typeof PAIRS)[number] }) {
  return (
    <Link
      href={`/chart/${pair.id}`}
      className="block p-6 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 hover:bg-gray-800/50 transition-all group"
    >
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-100 group-hover:text-white">
            {pair.name}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{pair.description}</p>
        </div>
        <div className="p-2 bg-gray-800 rounded-lg group-hover:bg-gray-700 transition-colors">
          <BarChart2 className="w-5 h-5 text-blue-400" />
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-100">Trading System</h1>
          <p className="text-gray-500 mt-1">AI-Augmented Forex Trading</p>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <section>
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Currency Pairs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PAIRS.map((pair) => (
              <PairCard key={pair.id} pair={pair} />
            ))}
          </div>
        </section>

        {/* Quick start guide */}
        <section className="mt-12 p-6 bg-gray-900/50 rounded-xl border border-gray-800">
          <h2 className="text-lg font-semibold text-gray-300 mb-3">Getting Started</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-400">
            <li>Click on a currency pair to open its chart</li>
            <li>Select a timeframe (M5, M15, H1, H4, D)</li>
            <li>Click &quot;Fetch Data&quot; to load candles from OANDA</li>
            <li>The chart will update in real-time as new data arrives</li>
          </ol>
          <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
            <p className="text-yellow-200 text-sm">
              <strong>Note:</strong> Make sure you have configured your OANDA API credentials
              in the Convex dashboard environment variables.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
