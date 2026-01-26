import { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Get the authenticated user from the context.
 * Throws if not authenticated.
 */
export async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return {
    clerkId: identity.subject,
    email: identity.email,
    name: identity.name,
  };
}

/**
 * Get the user if authenticated, or null if not.
 * Use for optional auth (public routes that work better with user context).
 */
export async function getOptionalUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return {
    clerkId: identity.subject,
    email: identity.email,
    name: identity.name,
  };
}
