/**
 * Chat API Route
 *
 * Streaming SSE endpoint for Claude AI chat.
 * Handles tool execution (server-side data tools) and delegates
 * drawing tools to the client via SSE events.
 */

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ALL_TOOLS } from "@/lib/chat/tools";
import { buildSystemPrompt, buildDynamicContext } from "@/lib/chat/context";
import { isClientTool, MODEL_IDS } from "@/lib/chat/types";
import type { ChatModel, ChatRequest } from "@/lib/chat/types";
import { executeDataTool } from "./data-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── SSE Helpers ─────────────────────────────────────────────────────────────

function sseEvent(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, data })}\n\n`;
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const {
    messages,
    pair,
    timeframe,
    currentPrice,
    drawings,
    model = "sonnet",
    convexToken,
    summary,
  } = body;

  if (!messages || !Array.isArray(messages) || !pair || !timeframe) {
    return new Response("Missing required fields: messages, pair, timeframe", { status: 400 });
  }

  // Build system prompt and dynamic context
  const systemPrompt = buildSystemPrompt(pair, timeframe);
  const dynamicContext = await buildDynamicContext(pair, timeframe, currentPrice, drawings || []);

  // Build Anthropic messages — inject context (and optional summary) as a prefixed user message
  const anthropicMessages: Anthropic.MessageParam[] = [];

  if (summary && messages.length === 1) {
    // Compacted conversation, first message: summary + context + user message
    anthropicMessages.push({
      role: "user",
      content: `[Previous conversation summary]\n${summary}\n\n[Chart Context]\n${dynamicContext}\n\n[User Message]\n${messages[0].content}`,
    });
  } else if (summary && messages.length > 1) {
    // Compacted conversation, multi-turn: inject summary into first user message
    const firstMsg = messages[0];
    anthropicMessages.push({
      role: firstMsg.role,
      content: firstMsg.role === "user"
        ? `[Previous conversation summary]\n${summary}\n\n${firstMsg.content}`
        : firstMsg.content,
    });
    for (let i = 1; i < messages.length; i++) {
      anthropicMessages.push({
        role: messages[i].role,
        content: messages[i].content,
      });
    }
  } else if (messages.length === 1) {
    // Fresh conversation, first message — inject context
    anthropicMessages.push({
      role: "user",
      content: `[Chart Context]\n${dynamicContext}\n\n[User Message]\n${messages[0].content}`,
    });
  } else {
    // Multi-turn without summary — context was in first message
    for (const msg of messages) {
      anthropicMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  // Set up SSE streaming
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Process in the background
  (async () => {
    try {
      await streamWithToolLoop(
        anthropicMessages,
        systemPrompt,
        model,
        pair,
        timeframe,
        writer,
        encoder,
        request.signal,
        convexToken
      );
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("[Chat API] Stream error:", error);
        try {
          await writer.write(encoder.encode(
            sseEvent("error", { message: error.message || "Internal server error" })
          ));
        } catch {
          // Writer may be closed
        }
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Stream with Tool Loop ───────────────────────────────────────────────────

async function streamWithToolLoop(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  model: ChatModel,
  pair: string,
  timeframe: string,
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  signal: AbortSignal,
  convexToken?: string
): Promise<void> {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  // Tool loop: Claude may call multiple tools before giving a final text response
  const MAX_TOOL_ROUNDS = 5;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal.aborted) break;

    // Create the streaming message
    const stream = anthropic.messages.stream({
      model: MODEL_IDS[model],
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
      tools: ALL_TOOLS,
    });

    let hasToolUse = false;
    const toolUseBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let currentToolName = "";
    let currentToolInput = "";
    let currentToolId = "";

    // Stream events to the client
    for await (const event of stream) {
      if (signal.aborted) break;

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInput = "";
            hasToolUse = true;
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            await writer.write(encoder.encode(
              sseEvent("text", { delta: event.delta.text })
            ));
          } else if (event.delta.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          if (currentToolName) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(currentToolInput || "{}");
            } catch {
              parsedInput = {};
            }

            toolUseBlocks.push({
              id: currentToolId,
              name: currentToolName,
              input: parsedInput,
            });

            // Emit event to client
            if (isClientTool(currentToolName)) {
              await writer.write(encoder.encode(
                sseEvent("client_tool", {
                  id: currentToolId,
                  name: currentToolName,
                  input: parsedInput,
                })
              ));
            } else {
              await writer.write(encoder.encode(
                sseEvent("tool_use", {
                  id: currentToolId,
                  name: currentToolName,
                  input: parsedInput,
                })
              ));
            }

            currentToolName = "";
            currentToolInput = "";
            currentToolId = "";
          }
          break;
        }
        case "message_delta": {
          // Track usage
          if (event.usage) {
            totalOutputTokens += event.usage.output_tokens || 0;
          }
          break;
        }
      }
    }

    // Get final message for usage tracking
    const finalMessage = await stream.finalMessage();
    totalInputTokens += finalMessage.usage?.input_tokens || 0;
    totalOutputTokens = finalMessage.usage?.output_tokens || 0;
    // Cache usage fields may exist on the usage object but aren't in the base type
    const usageObj = finalMessage.usage as unknown as Record<string, number>;
    cacheReadTokens += usageObj["cache_read_input_tokens"] || 0;
    cacheCreationTokens += usageObj["cache_creation_input_tokens"] || 0;

    // If no tool use, we're done
    if (!hasToolUse || toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools and build tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tool of toolUseBlocks) {
      if (isClientTool(tool.name)) {
        // Client tools — we already emitted the event, assume success
        // In a more sophisticated implementation, we'd wait for client response
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: JSON.stringify({ success: true, message: `${tool.name} executed on client` }),
        });
      } else {
        // Server-side data tools — execute immediately
        try {
          const result = await executeDataTool(tool.name, tool.input, pair, timeframe, convexToken);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify(result),
          });

          // Emit result to client
          await writer.write(encoder.encode(
            sseEvent("tool_result", {
              toolCallId: tool.id,
              result: { success: true, data: result },
            })
          ));
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          });

          await writer.write(encoder.encode(
            sseEvent("tool_result", {
              toolCallId: tool.id,
              result: { success: false, error: errorMsg },
            })
          ));
        }
      }
    }

    // Add assistant message (with tool use) and tool results to conversation
    messages.push({
      role: "assistant",
      content: finalMessage.content,
    });

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  // Send done event
  await writer.write(encoder.encode(
    sseEvent("done", {
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      },
    })
  ));
}
