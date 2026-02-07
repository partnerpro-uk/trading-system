"use client";

import { useRef, useCallback } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

export interface OverlayToggles {
  swings: boolean;
  bos: boolean;
  fvgs: boolean;
  levels: boolean;
  premiumDiscount: boolean;
  sweeps: boolean;
  hud?: boolean;
}

interface StructurePrefsData {
  overlayToggles: OverlayToggles;
  fvgMinTier: number;
  showRecentOnly: boolean;
}

/**
 * Hook for loading/saving structure overlay preferences to Convex.
 * Returns current prefs (or null before loaded) and a debounced save function.
 */
export function useStructurePrefs() {
  const { isAuthenticated } = useConvexAuth();
  const prefs = useQuery(api.structurePrefs.get, isAuthenticated ? {} : "skip");
  const upsert = useMutation(api.structurePrefs.upsert);

  // Debounce: accumulate the latest value and flush after 500ms
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<StructurePrefsData | null>(null);

  const flush = useCallback(() => {
    if (pendingRef.current) {
      upsert(pendingRef.current).catch((err) => {
        console.error("Failed to save structure prefs:", err);
      });
      pendingRef.current = null;
    }
  }, [upsert]);

  const save = useCallback(
    (data: StructurePrefsData) => {
      pendingRef.current = data;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 500);
    },
    [flush]
  );

  return { prefs: prefs ?? null, save };
}
