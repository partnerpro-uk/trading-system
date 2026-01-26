"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * UserSync component
 *
 * Syncs the authenticated user from Clerk to Convex on login.
 * This should be rendered inside both ClerkProvider and ConvexProvider.
 */
export function UserSync({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const syncUser = useMutation(api.users.syncUser);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      syncUser().catch((error: Error) => {
        console.error("Failed to sync user:", error);
      });
    }
  }, [isLoaded, isSignedIn, syncUser]);

  return <>{children}</>;
}
