/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as candles from "../candles.js";
import type * as crons from "../crons.js";
import type * as massive from "../massive.js";
import type * as newsEvents from "../newsEvents.js";
import type * as newsEventsActions from "../newsEventsActions.js";
import type * as newsQueries from "../newsQueries.js";
import type * as newsReactions from "../newsReactions.js";
import type * as newsStatistics from "../newsStatistics.js";
import type * as oanda from "../oanda.js";
import type * as sessions from "../sessions.js";
import type * as yahoo from "../yahoo.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  candles: typeof candles;
  crons: typeof crons;
  massive: typeof massive;
  newsEvents: typeof newsEvents;
  newsEventsActions: typeof newsEventsActions;
  newsQueries: typeof newsQueries;
  newsReactions: typeof newsReactions;
  newsStatistics: typeof newsStatistics;
  oanda: typeof oanda;
  sessions: typeof sessions;
  yahoo: typeof yahoo;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
