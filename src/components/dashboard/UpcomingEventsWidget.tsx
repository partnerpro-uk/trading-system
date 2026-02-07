"use client";

import { useState, useEffect } from "react";

interface UpcomingEvent {
  eventId: string;
  name: string;
  currency: string;
  impact: string;
  timestamp: number;
  datetimeLondon: string | null;
}

function formatCountdown(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return "Now";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(datetimeLondon: string | null, timestamp: number): string {
  if (datetimeLondon) {
    const timePart = datetimeLondon.split(" ")[1];
    if (timePart) return timePart.slice(0, 5) + " UK";
  }
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " UTC";
}

export function UpcomingEventsWidget() {
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await fetch("/api/news/upcoming?limit=5");
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        }
      } catch {
        // silent
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Update countdown every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Upcoming Events</h3>

      {events.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-4">No upcoming events</div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const isImminent = event.timestamp - Date.now() < 60 * 60 * 1000;
            const isVeryClose = event.timestamp - Date.now() < 15 * 60 * 1000;

            return (
              <div
                key={event.eventId}
                className={`px-3 py-2 rounded text-xs ${
                  isVeryClose
                    ? "bg-red-900/30 border border-red-800/40"
                    : isImminent
                    ? "bg-amber-900/20 border border-amber-800/30"
                    : "bg-gray-800/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        event.impact === "High" ? "bg-red-500" : event.impact === "Medium" ? "bg-amber-500" : "bg-gray-500"
                      }`}
                    />
                    <span className="text-gray-300 truncate">{event.name}</span>
                  </div>
                  <span className="text-gray-500 shrink-0">{event.currency}</span>
                </div>
                <div className="flex items-center justify-between mt-1 text-gray-500">
                  <span>{formatTime(event.datetimeLondon, event.timestamp)}</span>
                  <span
                    className={`font-medium ${
                      isVeryClose ? "text-red-400" : isImminent ? "text-amber-400" : "text-gray-400"
                    }`}
                  >
                    {formatCountdown(event.timestamp)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
