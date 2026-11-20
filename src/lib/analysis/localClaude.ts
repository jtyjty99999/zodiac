import os from "node:os";
import { z } from "zod";
import { parseClaudeOutput, runClaudeCommand } from "../claude/cli";
import { isValidClaudeCommand } from "../explore/engineSettings";
import { COMMIT_CATEGORIES, type CommitCategory } from "../types";
import {
  AI_RESULT_JSON_SCHEMA,
  type AiAnalysis,
  type AiCommitContext,
  buildUserPrompt,
  COMMIT_REVIEW_SYSTEM_PROMPT,
} from "./anthropic";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RATING_REASON_CHARS = 800;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_TAGS = 10;
const MAX_TAG_CHARS = 40;
const MAX_ERROR_CHARS = 500;

export interface LocalClaudeOptions {
  /** Command name or absolute path from settings; executed without a shell. */
  command: string;
  timeoutMs?: number;
}

const reviewSchema = z.object({
  category: z.enum(COMMIT_CATEGORIES as [CommitCategory, ...CommitCategory[]]),
  rating: z.number().int().min(1).max(5),
  ratingReason: z.string().trim().min(1).max(MAX_RATING_REASON_CHARS),
  summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
  tags: z.array(z.string().trim().min(1).max(MAX_TAG_CHARS)).max(MAX_TAGS),
  candidate: z
    .object({
      name: z.string().trim().min(3).max(120),
      description: z.string().trim().max(500),
      moduleKey: z.string().trim().max(60).nullable(),
    })
    .nullable(),
});

function clampString(value: unknown, max: number): unknown {
  return typeof value === "string" ? value.slice(0, max) : value;
}

/**
 * Trims oversized model output to the schema bounds instead of discarding an
 * otherwise usable review (a long paragraph should not lose the whole result).
 */
export function normalizeReview(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const rating =
    typeof record.rating === "number" && Number.isFinite(record.rating)
      ? Math.min(5, Math.max(1, Math.round(record.rating)))
      : record.rating;
  const tags = Array.isArray(record.tags)
    ? record.tags.slice(0, MAX_TAGS).map((tag) => clampString(tag, MAX_TAG_CHARS))
    : [];
  return {
    ...record,
    rating,
    ratingReason: clampString(record.ratingReason, MAX_RATING_REASON_CHARS),
    summary: clampString(record.summary, MAX_SUMMARY_CHARS),
    tags,
  };
}

/**
 * Runs one headless local Claude Code call to review a commit. Read-only and
 * sandboxed: no tools, no project settings, no MCP, no persistence.
 */
export async function analyzeWithLocalClaude(
  context: AiCommitContext,
  options: LocalClaudeOptions,
): Promise<AiAnalysis | null> {
  if (!isValidClaudeCommand(options.command)) return null;

  const args = [
    "-p",
    buildUserPrompt(context),
    "--output-format",
    "json",
    "--restricted",
    "--safe-mode",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--tools",
    "",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--append-system-prompt",
    COMMIT_REVIEW_SYSTEM_PROMPT,
    "--json-schema",
    JSON.stringify(AI_RESULT_JSON_SCHEMA),
  ];

  try {
    const { stdout } = await runClaudeCommand(options.command.trim(), args, {
      cwd: os.tmpdir(),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return reviewSchema.parse(normalizeReview(parseClaudeOutput(stdout)));
  } catch (error) {
    console.warn(
      "local Claude Code commit review failed:",
      (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS),
    );
    return null;
  }
}
