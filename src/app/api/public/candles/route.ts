import { NextRequest, NextResponse } from "next/server";
import { getLatestCandles } from "@/lib/db/candles";
import { PAIR_IDS } from "@/lib/pairs";
import { validateApiKey } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";

const VALID_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "M"];
const MAX_LIMIT = 10000;
const DEFAULT_LIMIT = 500;

function addRateLimitHeaders(
  response: NextResponse,
  limit: number,
  remaining: number,
  resetAt: number
): NextResponse {
  response.headers.set("X-RateLimit-Limit", limit.toString());
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  response.headers.set("X-RateLimit-Reset", Math.ceil(resetAt / 1000).toString());
  return response;
}

export async function GET(request: NextRequest) {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. API Key Authentication
  // ═══════════════════════════════════════════════════════════════════════════
  const apiKey = request.headers.get("X-API-Key") || request.nextUrl.searchParams.get("api_key");

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Missing API key",
        message: "Provide your API key via X-API-Key header or api_key query parameter",
      },
      { status: 401 }
    );
  }

  const validation = await validateApiKey(apiKey);

  if (!validation.valid || !validation.keyInfo) {
    return NextResponse.json(
      { error: "Invalid API key", message: validation.error },
      { status: 401 }
    );
  }

  const { keyInfo } = validation;

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Rate Limiting
  // ═══════════════════════════════════════════════════════════════════════════
  const rateLimitResult = checkRateLimit(keyInfo.id, keyInfo.rateLimitPerMinute);

  if (!rateLimitResult.allowed) {
    const response = NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: `You have exceeded ${keyInfo.rateLimitPerMinute} requests per minute`,
        retry_after: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000),
      },
      { status: 429 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Parse Parameters
  // ═══════════════════════════════════════════════════════════════════════════
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");
  const limitParam = searchParams.get("limit");

  // Validate required parameters
  if (!pair) {
    const response = NextResponse.json(
      { error: "Missing required parameter: pair", valid_pairs: PAIR_IDS },
      { status: 400 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  if (!timeframe) {
    const response = NextResponse.json(
      { error: "Missing required parameter: timeframe", valid_timeframes: VALID_TIMEFRAMES },
      { status: 400 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // Validate pair
  if (!PAIR_IDS.includes(pair)) {
    const response = NextResponse.json(
      { error: `Invalid pair: ${pair}`, valid_pairs: PAIR_IDS },
      { status: 400 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // Check pair permissions
  if (keyInfo.allowedPairs.length > 0 && !keyInfo.allowedPairs.includes(pair)) {
    const response = NextResponse.json(
      {
        error: "Pair not allowed",
        message: `Your API key does not have access to ${pair}`,
        allowed_pairs: keyInfo.allowedPairs,
      },
      { status: 403 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // Validate timeframe
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    const response = NextResponse.json(
      { error: `Invalid timeframe: ${timeframe}`, valid_timeframes: VALID_TIMEFRAMES },
      { status: 400 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // Check timeframe permissions
  if (keyInfo.allowedTimeframes.length > 0 && !keyInfo.allowedTimeframes.includes(timeframe)) {
    const response = NextResponse.json(
      {
        error: "Timeframe not allowed",
        message: `Your API key does not have access to ${timeframe}`,
        allowed_timeframes: keyInfo.allowedTimeframes,
      },
      { status: 403 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }

  // Parse and validate limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      const response = NextResponse.json(
        { error: "Invalid limit: must be a positive integer" },
        { status: 400 }
      );
      return addRateLimitHeaders(
        response,
        rateLimitResult.limit,
        rateLimitResult.remaining,
        rateLimitResult.resetAt
      );
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Fetch and Return Data
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    const candles = await getLatestCandles(pair, timeframe, limit);

    const response = NextResponse.json({
      pair,
      timeframe,
      count: candles.length,
      candles,
    });

    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  } catch (error) {
    console.error("Error fetching candles:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch candles" },
      { status: 500 }
    );
    return addRateLimitHeaders(
      response,
      rateLimitResult.limit,
      rateLimitResult.remaining,
      rateLimitResult.resetAt
    );
  }
}
