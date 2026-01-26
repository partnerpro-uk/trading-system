/**
 * Convex Auth Configuration for Clerk
 *
 * SETUP INSTRUCTIONS:
 * 1. Create a Clerk application at https://clerk.com
 * 2. In Clerk Dashboard, go to JWT Templates and create a "Convex" template
 * 3. Copy your issuer domain (looks like https://your-app.clerk.accounts.dev)
 * 4. Set the CLERK_JWT_ISSUER_DOMAIN environment variable in Convex Dashboard:
 *    https://dashboard.convex.dev/d/befitting-zebra-214/settings/environment-variables
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
