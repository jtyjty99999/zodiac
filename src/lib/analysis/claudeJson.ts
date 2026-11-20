import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

export const CLAUDE_REQUEST_TIMEOUT_MS = 45_000;

export interface ClaudeCallConfig {
  enabled: boolean;
  hasKey: boolean;
  model: string;
}

export interface ClaudeJsonRequest<T> {
  config: ClaudeCallConfig;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens: number;
  timeoutMs?: number;
  clientFactory?: (apiKey: string) => Anthropic;
}

/** Extracts a JSON object from model output, tolerating fences and prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI response contained no JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Calls Claude once and validates the JSON response against a schema. Any
 * failure (disabled, missing key, timeout, invalid JSON/schema) returns null so
 * callers can fall back to heuristics.
 */
export async function requestClaudeJson<T>(request: ClaudeJsonRequest<T>): Promise<T | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!request.config.enabled || !apiKey) return null;

  try {
    const client = request.clientFactory
      ? request.clientFactory(apiKey)
      : new Anthropic({
          apiKey,
          timeout: request.timeoutMs ?? CLAUDE_REQUEST_TIMEOUT_MS,
          maxRetries: 1,
        });

    const response = await client.messages.create({
      model: request.config.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return request.schema.parse(extractJson(text));
  } catch (error) {
    console.warn(
      "[zodiac] Claude request failed, falling back to heuristics:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
