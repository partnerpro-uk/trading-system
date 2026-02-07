"use client";

import { useState, useEffect } from "react";

interface SessionInfo {
  name: string;
  start: number; // UTC hour
  end: number; // UTC hour
  color: string;
  active: boolean;
}

function getActiveSessions(utcHour: number): SessionInfo[] {
  const sessions: SessionInfo[] = [
    { name: "Sydney", start: 21, end: 6, color: "bg-cyan-500", active: false },
    { name: "Tokyo", start: 0, end: 9, color: "bg-yellow-500", active: false },
    { name: "London", start: 7, end: 16, color: "bg-red-500", active: false },
    { name: "New York", start: 12, end: 21, color: "bg-blue-500", active: false },
  ];

  for (const s of sessions) {
    if (s.start > s.end) {
      // Wraps midnight (e.g. Sydney 21-6)
      s.active = utcHour >= s.start || utcHour < s.end;
    } else {
      s.active = utcHour >= s.start && utcHour < s.end;
    }
  }

  return sessions;
}

function getNextSessionOpen(sessions: SessionInfo[], utcHour: number): { name: string; hoursUntil: number } | null {
  // Find the next session that isn't currently active
  const inactive = sessions.filter((s) => !s.active);
  if (inactive.length === 0) return null;

  let nearest: { name: string; hoursUntil: number } | null = null;

  for (const s of inactive) {
    let hoursUntil = s.start - utcHour;
    if (hoursUntil <= 0) hoursUntil += 24;
    if (!nearest || hoursUntil < nearest.hoursUntil) {
      nearest = { name: s.name, hoursUntil };
    }
  }

  return nearest;
}

export function SessionStatus() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const sessions = getActiveSessions(utcHour);
  const activeSessions = sessions.filter((s) => s.active);
  const nextOpen = getNextSessionOpen(sessions, utcHour);

  // Detect overlaps
  const isLondonNYOverlap = sessions.find((s) => s.name === "London")?.active && sessions.find((s) => s.name === "New York")?.active;
  const isTokyoLondonOverlap = sessions.find((s) => s.name === "Tokyo")?.active && sessions.find((s) => s.name === "London")?.active;

  const utcTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`;

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Session Status</h3>
        <span className="text-xs font-mono text-gray-500">{utcTime} UTC</span>
      </div>

      {/* Active sessions */}
      <div className="space-y-2 mb-3">
        {sessions.map((s) => (
          <div key={s.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${s.active ? s.color : "bg-gray-700"}`} />
              <span className={s.active ? "text-gray-200 font-medium" : "text-gray-600"}>
                {s.name}
              </span>
            </div>
            <span className="text-gray-500 font-mono text-[10px]">
              {String(s.start).padStart(2, "0")}:00-{String(s.end).padStart(2, "0")}:00
            </span>
            {s.active && (
              <span className="text-green-400 text-[10px] font-medium">ACTIVE</span>
            )}
          </div>
        ))}
      </div>

      {/* Overlap indicator */}
      {(isLondonNYOverlap || isTokyoLondonOverlap) && (
        <div className="px-2 py-1.5 bg-amber-900/20 border border-amber-800/30 rounded text-xs text-amber-400 mb-2">
          {isLondonNYOverlap ? "London/NY Overlap" : "Tokyo/London Overlap"} — High volatility
        </div>
      )}

      {/* Next session */}
      {activeSessions.length === 0 && nextOpen && (
        <div className="text-xs text-gray-500">
          Next: <span className="text-gray-300">{nextOpen.name}</span> in {nextOpen.hoursUntil}h
        </div>
      )}
    </div>
  );
}
