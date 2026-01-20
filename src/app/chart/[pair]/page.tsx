"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Chart } from "@/components/chart/Chart";
import { ChartSidebar } from "@/components/chart/ChartSidebar";
import { NewsEventPanel } from "@/components/chart/NewsEventPanel";
import { NewsEventData } from "@/components/chart/NewsMarkersPrimitive";
import { useOandaStream } from "@/hooks/useOandaStream";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ChartPage() {
  const params = useParams();
  const pair = params.pair as string;
  const [timeframe, setTimeframe] = useState<string>("M15");

  // Chart control states (lifted from Chart component)
  const [magnetMode, setMagnetMode] = useState<boolean>(false); // Off by default
  const [showSessions, setShowSessions] = useState<boolean>(true);
  const [showNews, setShowNews] = useState<boolean>(true);

  // Selected event for sidebar panel
  const [selectedEvent, setSelectedEvent] = useState<NewsEventData | null>(null);

  // Reset view function from Chart component
  const [resetViewFn, setResetViewFn] = useState<(() => void) | null>(null);
  const handleResetViewReady = useCallback((fn: () => void) => {
    setResetViewFn(() => fn);
  }, []);

  const handleEventSelect = useCallback((event: NewsEventData | null) => {
    setSelectedEvent(event);
  }, []);

  const handleCloseEventPanel = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const { status, currentSession, nextOpen, livePrice } = useOandaStream(pair);

  // Format pair for display (EUR_USD -> EUR/USD)
  const displayPair = pair.replace("_", "/");

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-xl font-semibold">{displayPair}</h1>
          {livePrice && (
            <span className="text-lg font-mono text-gray-200">
              {livePrice.mid.toFixed(5)}
            </span>
          )}
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              status === "connected" ? "bg-green-500" :
              status === "connecting" ? "bg-yellow-500 animate-pulse" :
              status === "market_closed" ? "bg-gray-500" :
              "bg-red-500"
            }`} />
            <span className="text-gray-400">
              {status === "connected" && "Live"}
              {status === "connecting" && "Connecting..."}
              {status === "disconnected" && "Disconnected"}
              {status === "market_closed" && "Market Closed"}
              {status === "error" && "Error"}
            </span>
            {currentSession !== "closed" && (
              <span className="text-gray-500 capitalize">
                ({currentSession})
              </span>
            )}
            {status === "market_closed" && nextOpen && (
              <span className="text-gray-500">
                · Opens in {nextOpen}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main content: resizable chart / sidebar */}
      <main className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal" className="h-full">
          {/* Chart Panel */}
          <Panel id="chart" defaultSize="80%" minSize="50%">
            <div className="h-full w-full">
              <Chart
                pair={pair}
                timeframe={timeframe}
                magnetMode={magnetMode}
                showSessions={showSessions}
                showNews={showNews}
                livePrice={livePrice}
                onResetViewReady={handleResetViewReady}
                onEventSelect={handleEventSelect}
              />
            </div>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-2 bg-gray-700 hover:bg-blue-500 transition-colors cursor-col-resize" />

          {/* Sidebar Panel */}
          <Panel id="sidebar" defaultSize="20%" minSize="15%" maxSize="40%">
            <div className="h-full w-full">
              {selectedEvent ? (
                <NewsEventPanel
                  event={selectedEvent}
                  pair={pair}
                  onClose={handleCloseEventPanel}
                />
              ) : (
                <ChartSidebar
                  currentPair={pair}
                  timeframe={timeframe}
                  onTimeframeChange={setTimeframe}
                  magnetMode={magnetMode}
                  onMagnetModeChange={setMagnetMode}
                  showSessions={showSessions}
                  onShowSessionsChange={setShowSessions}
                  showNews={showNews}
                  onShowNewsChange={setShowNews}
                  onResetView={resetViewFn || undefined}
                />
              )}
            </div>
          </Panel>
        </PanelGroup>
      </main>
    </div>
  );
}
