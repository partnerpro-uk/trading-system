"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * UserSync component
 *
 * Syncs the authenticated user from Clerk to Convex on login.
 * This should be rendered inside both ClerkProvider and ConvexProvider.
 *
 * Waits for both Clerk AND Convex to be authenticated before syncing,
 * to avoid race conditions where Convex doesn't have the JWT yet.
 */
export function UserSync({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const { isAuthenticated, isLoading: isConvexLoading } = useConvexAuth();
  const syncUser = useMutation(api.users.syncUser);

  useEffect(() => {
    // Wait for both Clerk to be loaded AND Convex to have the auth token
    if (isLoaded && isSignedIn && !isConvexLoading && isAuthenticated) {
      syncUser().catch((error: Error) => {
        console.error("Failed to sync user:", error);
      });
    }
  }, [isLoaded, isSignedIn, isConvexLoading, isAuthenticated, syncUser]);

  return <>{children}</>;
}
