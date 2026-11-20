import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { grepCode, listDirectory, readBlobLines } from "../git/search";
import type { HarnessSource } from "./evidence";

const MAX_MATCHES_PER_FILE = 5;
const MAX_READS_PER_FILE = 2;
const MAX_FILES_PER_HARNESS = 80;
const MAX_TOOL_TEXT_CHARS = 10_000;

const slugField = z.string().trim().min(1).max(60);
const pathField = z.string().trim().max(400);

const listDirSchema = z.object({
  slug: slugField,
  path: pathField.optional(),
});

const grepSchema = z.object({
  slug: slugField,
  pattern: z.string().trim().min(2).max(80),
  path: pathField.optional(),
});

const readFileSchema = z.object({
  slug: slugField,
  path: pathField,
  startLine: z.number().int().min(1).max(1_000_000).optional(),
});

export interface ObservedFile {
  path: string;
  matches: Array<{ line: number; text: string }>;
  /** Numbered blocks returned by read_file, one per call. */
  reads: Array<{ line: number; text: string }>;
}

export interface ExplorationObservations {
  files: Map<number, Map<string, ObservedFile>>;
  patterns: Set<string>;
  /** Harness ids whose observations hit a size cap. */
  truncated: Set<number>;
}

export function createObservationState(): ExplorationObservations {
  return { files: new Map(), patterns: new Set(), truncated: new Set() };
}

export interface ExploreToolContext {
  sources: Map<string, HarnessSource>;
  observations: ExplorationObservations;
}

/** Tool schemas exposed to Claude; slugs are constrained to real harnesses. */
export function exploreToolDefinitions(slugs: string[]): Anthropic.Tool[] {
  const slugSchema = {
    type: "string" as const,
    enum: slugs,
    description: "要探索的 harness slug，必须来自可用列表",
  };
  return [
    {
      name: "list_dir",
      description:
        "列出一个 harness 仓库某目录下的直接子项（目录与文件）。path 省略表示仓库根目录。",
      input_schema: {
        type: "object",
        properties: {
          slug: slugSchema,
          path: { type: "string", description: "仓库内相对目录路径，例如 packages/core" },
        },
        required: ["slug"],
      },
    },
    {
      name: "grep_code",
      description:
        "在 harness 仓库中做大小写不敏感的字面检索，返回 path:line: 代码行（每个文件最多 2 处，总数受限）。path 可选，限定检索目录。",
      input_schema: {
        type: "object",
        properties: {
          slug: slugSchema,
          pattern: { type: "string", description: "字面检索词，2-80 字符，不支持正则" },
          path: { type: "string", description: "可选：限定检索的目录或文件路径" },
        },
        required: ["slug", "pattern"],
      },
    },
    {
      name: "read_file",
      description: "读取 harness 仓库中的一个文本文件，返回带行号的代码，最多 120 行。",
      input_schema: {
        type: "object",
        properties: {
          slug: slugSchema,
          path: {
            type: "string",
            description: "仓库内相对文件路径，必须来自 list_dir 或 grep_code 的结果",
          },
          startLine: { type: "integer", minimum: 1, description: "起始行号，默认 1" },
        },
        required: ["slug", "path"],
      },
    },
  ];
}

function observationFile(
  observations: ExplorationObservations,
  harnessId: number,
  filePath: string,
): ObservedFile | null {
  const perHarness = observations.files.get(harnessId) ?? new Map<string, ObservedFile>();
  observations.files.set(harnessId, perHarness);
  const existing = perHarness.get(filePath);
  if (existing) return existing;
  if (perHarness.size >= MAX_FILES_PER_HARNESS) {
    observations.truncated.add(harnessId);
    return null;
  }
  const created: ObservedFile = { path: filePath, matches: [], reads: [] };
  perHarness.set(filePath, created);
  return created;
}

function clip(text: string): string {
  return text.length > MAX_TOOL_TEXT_CHARS ? `${text.slice(0, MAX_TOOL_TEXT_CHARS)}…` : text;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

function errorResult(message: string): ToolResult {
  return { text: `错误：${message}`, isError: true };
}

async function runListDir(context: ExploreToolContext, input: unknown): Promise<ToolResult> {
  const parsed = listDirSchema.safeParse(input);
  if (!parsed.success) return errorResult("参数无效：需要 slug，path 可选");
  const source = context.sources.get(parsed.data.slug);
  if (!source) return errorResult(`未知 harness slug：${parsed.data.slug}`);

  const { entries, truncated } = await listDirectory(
    source.dir,
    source.rev,
    parsed.data.path ?? "",
  );
  if (truncated) context.observations.truncated.add(source.harness.id);

  const header = `${parsed.data.path || "(仓库根目录)"}：共 ${entries.length} 项${
    truncated ? "（已截断）" : ""
  }`;
  const body = entries.map((entry) => (entry.type === "dir" ? `${entry.name}/` : entry.name));
  return { text: clip([header, ...body].join("\n")), isError: false };
}

async function runGrep(context: ExploreToolContext, input: unknown): Promise<ToolResult> {
  const parsed = grepSchema.safeParse(input);
  if (!parsed.success) return errorResult("参数无效：需要 slug 与 pattern（2-80 字符）");
  const source = context.sources.get(parsed.data.slug);
  if (!source) return errorResult(`未知 harness slug：${parsed.data.slug}`);

  const { lines, truncated } = await grepCode(source.dir, source.rev, parsed.data.pattern, {
    pathPrefix: parsed.data.path,
  });
  context.observations.patterns.add(parsed.data.pattern.trim());
  if (truncated) context.observations.truncated.add(source.harness.id);

  const harnessId = source.harness.id;
  for (const line of lines) {
    const file = observationFile(context.observations, harnessId, line.path);
    if (!file || file.matches.length >= MAX_MATCHES_PER_FILE) continue;
    file.matches.push({ line: line.line, text: line.text });
  }

  const header = `「${parsed.data.pattern}」命中 ${lines.length} 处${
    truncated ? "（已截断）" : ""
  }`;
  const body = lines.map((line) => `${line.path}:${line.line}: ${line.text}`);
  return { text: clip([header, ...body].join("\n")), isError: false };
}

async function runReadFile(context: ExploreToolContext, input: unknown): Promise<ToolResult> {
  const parsed = readFileSchema.safeParse(input);
  if (!parsed.success) return errorResult("参数无效：需要 slug 与 path");
  const source = context.sources.get(parsed.data.slug);
  if (!source) return errorResult(`未知 harness slug：${parsed.data.slug}`);

  const read = await readBlobLines(source.dir, source.rev, parsed.data.path, {
    startLine: parsed.data.startLine,
  });
  if (!read) return errorResult("文件不存在、超过大小限制或不是文本文件");
  if (read.truncated) context.observations.truncated.add(source.harness.id);

  const file = observationFile(context.observations, source.harness.id, parsed.data.path);
  const startLine = parsed.data.startLine ?? 1;
  if (file && file.reads.length < MAX_READS_PER_FILE) {
    file.reads.push({ line: startLine, text: read.lines.join("\n").slice(0, 1400) });
  }

  const header = `${parsed.data.path}（第 ${startLine} 行起，${read.lines.length} 行${
    read.truncated ? "，后续未显示" : ""
  }）`;
  return { text: clip([header, ...read.lines].join("\n")), isError: false };
}

/** Executes one tool call from Claude. Never throws; failures become tool errors. */
export async function executeExploreTool(
  context: ExploreToolContext,
  name: string,
  input: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_dir":
        return await runListDir(context, input);
      case "grep_code":
        return await runGrep(context, input);
      case "read_file":
        return await runReadFile(context, input);
      default:
        return errorResult(`未知工具：${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
