import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;

  const apiKey = process.env.OANDA_API_KEY;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  const streamUrl = process.env.OANDA_STREAM_URL || "https://stream-fxpractice.oanda.com";

  if (!apiKey || !accountId) {
    return new Response("OANDA credentials not configured", { status: 500 });
  }

  const url = `${streamUrl}/v3/accounts/${accountId}/pricing/stream?instruments=${pair}`;

  // Create an AbortController linked to the request's signal
  // This ensures we cancel the OANDA connection when the client disconnects
  const controller = new AbortController();

  // When the client disconnects, abort the OANDA fetch
  request.signal.addEventListener("abort", () => {
    try {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    } catch {
      // Ignore abort errors - this is expected behavior
    }
  });

  try {
    const oandaResponse = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!oandaResponse.ok) {
      const error = await oandaResponse.text();
      return new Response(`OANDA error: ${error}`, { status: oandaResponse.status });
    }

    // Create a TransformStream to process OANDA's chunked response
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process the OANDA stream in the background
    (async () => {
      const reader = oandaResponse.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          // Check if client disconnected
          if (request.signal.aborted) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                // Forward as Server-Sent Event
                await writer.write(
                  encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                );
              } catch {
                // Skip invalid JSON lines
              }
            }
          }
        }
      } catch (error) {
        // Ignore abort errors - they're expected when client disconnects
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Stream error:", error);
        }
      } finally {
        try {
          reader.cancel();
        } catch {
          // Ignore cancel errors
        }
        writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    // Ignore abort errors
    if (error instanceof Error && error.name === "AbortError") {
      return new Response("Client disconnected", { status: 499 });
    }
    console.error("Failed to connect to OANDA:", error);
    return new Response("Failed to connect to OANDA stream", { status: 500 });
  }
}
