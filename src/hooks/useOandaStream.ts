import { useEffect, useRef, useState, useCallback } from "react";
import {
  isForexMarketOpen,
  getMarketStatus,
  formatTimeUntil,
  type MarketSession,
} from "@/lib/utils/marketHours";

export interface OandaPrice {
  type: "PRICE" | "HEARTBEAT";
  time: string;
  bids?: Array<{ price: string; liquidity: number }>;
  asks?: Array<{ price: string; liquidity: number }>;
  closeoutBid?: string;
  closeoutAsk?: string;
  tradeable?: boolean;
  instrument?: string;
}

export interface LivePrice {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: Date;
  tradeable: boolean;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "market_closed"
  | "error";

interface UseOandaStreamOptions {
  enabled?: boolean;
}

export function useOandaStream(
  pair: string,
  options: UseOandaStreamOptions = {}
) {
  const { enabled = true } = options;
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<MarketSession>("closed");
  const [nextOpen, setNextOpen] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const marketCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const statusRef = useRef<ConnectionStatus>("disconnected");
  const MAX_RECONNECT_DELAY = 60000; // Max 1 minute between retries

  // Keep statusRef in sync with status state
  statusRef.current = status;

  // Check market status
  const checkMarketStatus = useCallback(() => {
    const marketStatus = getMarketStatus();
    setCurrentSession(marketStatus.currentSession);

    if (!marketStatus.isOpen && marketStatus.nextOpen) {
      setNextOpen(formatTimeUntil(marketStatus.nextOpen));
    } else {
      setNextOpen(null);
    }

    return marketStatus.isOpen;
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !pair) return;

    // Prevent multiple simultaneous connections
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
      console.log("Stream already connected or connecting, skipping");
      return;
    }

    // Check if market is open first
    if (!isForexMarketOpen()) {
      setStatus("market_closed");
      checkMarketStatus();
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus("connecting");
    setError(null);

    const eventSource = new EventSource(`/api/stream/${pair}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setStatus("connected");
      setError(null);
      reconnectAttemptRef.current = 0; // Reset on successful connection
      checkMarketStatus();
    };

    eventSource.onmessage = (event) => {
      try {
        const data: OandaPrice = JSON.parse(event.data);

        if (data.type === "PRICE" && data.bids && data.asks) {
          const bid = parseFloat(data.bids[0]?.price || "0");
          const ask = parseFloat(data.asks[0]?.price || "0");
          const mid = (bid + ask) / 2;
          const spread = ask - bid;

          setLivePrice({
            bid,
            ask,
            mid,
            spread,
            time: new Date(data.time),
            tradeable: data.tradeable ?? false,
          });
          setStatus("connected");
        }
        // Heartbeats keep connection alive but don't update price
      } catch (e) {
        console.error("Failed to parse stream data:", e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();

      // Check if market closed
      if (!isForexMarketOpen()) {
        setStatus("market_closed");
        checkMarketStatus();
        return;
      }

      setStatus("error");
      setError("Stream disconnected");

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Exponential backoff: 5s, 10s, 20s, 40s... up to MAX_RECONNECT_DELAY
      reconnectAttemptRef.current++;
      const delay = Math.min(
        5000 * Math.pow(2, reconnectAttemptRef.current - 1),
        MAX_RECONNECT_DELAY
      );

      console.log(`Stream error, reconnecting in ${delay / 1000}s (attempt ${reconnectAttemptRef.current})`);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [pair, enabled, checkMarketStatus]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (marketCheckIntervalRef.current) {
      clearInterval(marketCheckIntervalRef.current);
      marketCheckIntervalRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setStatus("disconnected");
    setLivePrice(null);
  }, []);

  // Initial connection and market status check
  useEffect(() => {
    checkMarketStatus();
    connect();

    // Check market status every minute
    marketCheckIntervalRef.current = setInterval(() => {
      const isOpen = checkMarketStatus();

      // If market just opened and we're in market_closed state, try to connect
      // Use statusRef to avoid adding status to deps (which would cause reconnection loops)
      if (isOpen && statusRef.current === "market_closed") {
        connect();
      }
      // If market just closed, update status
      else if (!isOpen && statusRef.current === "connected") {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
        setStatus("market_closed");
      }
    }, 60000); // Check every minute

    return () => {
      disconnect();
    };
  }, [connect, disconnect, checkMarketStatus]);

  // Reconnect when pair changes (skip initial mount - handled by main effect)
  const prevPairRef = useRef<string | null>(null);
  useEffect(() => {
    // Skip first render - main effect handles initial connection
    if (prevPairRef.current === null) {
      prevPairRef.current = pair;
      return;
    }

    // Only reconnect if pair actually changed
    if (pair && pair !== prevPairRef.current) {
      prevPairRef.current = pair;
      disconnect();
      // Small delay to ensure clean disconnect
      const timer = setTimeout(() => connect(), 200);
      return () => clearTimeout(timer);
    }
  }, [pair, disconnect, connect]);

  return {
    livePrice,
    status,
    isConnected: status === "connected",
    isMarketOpen: status !== "market_closed",
    currentSession,
    nextOpen,
    error,
    reconnect: connect,
    disconnect,
  };
}
