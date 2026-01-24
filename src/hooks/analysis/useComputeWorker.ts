"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { AnalysisCandle, SimulationStats, Trade, ComputeSettings } from "../../lib/analysis/types";

interface ComputeProgress {
  phase: string;
  pct: number;
}

interface ComputeResult {
  trades: Trade[];
  ghostEntries: Trade[];
  libraryPoints: unknown[];
  stats: SimulationStats;
}

interface UseComputeWorkerResult {
  isComputing: boolean;
  progress: ComputeProgress;
  result: ComputeResult | null;
  error: string | null;
  compute: (candles: AnalysisCandle[], settings: Partial<ComputeSettings>) => Promise<ComputeResult>;
  cancel: () => void;
}

export function useComputeWorker(): UseComputeWorkerResult {
  const [isComputing, setIsComputing] = useState(false);
  const [progress, setProgress] = useState<ComputeProgress>({ phase: "Idle", pct: 0 });
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const computeIdRef = useRef<number>(0);
  const resolveRef = useRef<((result: ComputeResult) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);

  // Initialize worker
  useEffect(() => {
    // Only create worker in browser environment
    if (typeof window === "undefined") return;

    try {
      // Create worker from the TypeScript file
      // Next.js will handle the bundling
      const worker = new Worker(
        new URL("../../workers/analysis.worker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (ev) => {
        const msg = ev.data || {};

        if (msg.type === "candles_ok") {
          // Candles loaded successfully
          return;
        }

        if (msg.type === "progress") {
          setProgress({
            phase: msg.phase || "Working",
            pct: Math.round((msg.pct || 0) * 100),
          });
          return;
        }

        if (msg.type === "result") {
          setIsComputing(false);
          setResult(msg.res);
          setProgress({ phase: "Done", pct: 100 });
          if (resolveRef.current) {
            resolveRef.current(msg.res);
            resolveRef.current = null;
            rejectRef.current = null;
          }
          return;
        }

        if (msg.type === "error") {
          setIsComputing(false);
          setError(msg.message || "Unknown error");
          setProgress({ phase: "Error", pct: 0 });
          if (rejectRef.current) {
            rejectRef.current(new Error(msg.message));
            resolveRef.current = null;
            rejectRef.current = null;
          }
          return;
        }
      };

      worker.onerror = (err) => {
        console.error("Worker error:", err);
        setIsComputing(false);
        setError("Worker crashed");
        if (rejectRef.current) {
          rejectRef.current(new Error("Worker crashed"));
          resolveRef.current = null;
          rejectRef.current = null;
        }
      };

      workerRef.current = worker;
    } catch (err) {
      console.error("Failed to create worker:", err);
      setError("Failed to initialize compute worker");
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Compute function
  const compute = useCallback(
    (candles: AnalysisCandle[], settings: Partial<ComputeSettings>): Promise<ComputeResult> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error("Worker not initialized"));
          return;
        }

        // Store resolve/reject for async handling
        resolveRef.current = resolve;
        rejectRef.current = reject;

        // Reset state
        setIsComputing(true);
        setError(null);
        setProgress({ phase: "Loading", pct: 0 });
        computeIdRef.current++;
        const id = computeIdRef.current;

        // Send candles to worker
        workerRef.current.postMessage({
          type: "set_candles",
          candles,
        });

        // Small delay to ensure candles are set, then compute
        setTimeout(() => {
          if (!workerRef.current) {
            reject(new Error("Worker terminated"));
            return;
          }
          workerRef.current.postMessage({
            type: "compute",
            id,
            settings: {
              parseMode: "utc",
              featureLevels: settings.featureLevels || {},
              featureModes: {},
              tpDist: settings.tpDist ?? 50,
              slDist: settings.slDist ?? 30,
              chunkBars: settings.chunkBars ?? 16,
              model: settings.model || "Momentum",
              aiMethod: settings.aiMethod || "off",
              ...settings,
            },
          });
        }, 50);
      });
    },
    []
  );

  // Cancel function
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setIsComputing(false);
      setProgress({ phase: "Cancelled", pct: 0 });

      // Recreate worker
      try {
        const worker = new Worker(
          new URL("../../workers/analysis.worker.ts", import.meta.url),
          { type: "module" }
        );
        workerRef.current = worker;
      } catch (err) {
        console.error("Failed to recreate worker:", err);
      }

      if (rejectRef.current) {
        rejectRef.current(new Error("Computation cancelled"));
        resolveRef.current = null;
        rejectRef.current = null;
      }
    }
  }, []);

  return {
    isComputing,
    progress,
    result,
    error,
    compute,
    cancel,
  };
}
