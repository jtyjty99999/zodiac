import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractJson } from "../analysis/claudeJson";
import { parseClaudeOutput, runLocalCommand } from "../claude/cli";
import {
  isLocalEngineEnabled,
  isValidLocalCommand,
  LOCAL_ENGINE_LABELS,
  type LocalEngineKind,
} from "../explore/engineSettings";

const VERSION_TIMEOUT_MS = 5_000;
const MAX_VERSION_CHARS = 120;
const MAX_ERROR_CHARS = 500;

export interface LocalEngineStatus {
  engine: LocalEngineKind;
  command: string;
  available: boolean;
  version: string | null;
}

export interface LocalEngineRunOptions {
  prompt: string;
  systemPrompt: string;
  cwd: string;
  timeoutMs: number;
  /** JSON Schema for engines that can enforce a structured final answer. */
  jsonSchema?: unknown;
  /** Claude Code tool allowlist (comma separated); ignored by other engines. */
  allowedTools?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Checks whether a local engine command is runnable and returns its version. */
export async function getLocalEngineStatus(
  engine: LocalEngineKind,
  command: string,
  timeoutMs: number = VERSION_TIMEOUT_MS,
): Promise<LocalEngineStatus> {
  if (!isValidLocalCommand(command)) {
    return { engine, command, available: false, version: null };
  }
  try {
    const { stdout } = await runLocalCommand(command.trim(), ["--version"], {
      timeoutMs,
      maxBytes: 64 * 1024,
    });
    const version = stdout.trim().split("\n").find(Boolean)?.slice(0, MAX_VERSION_CHARS) ?? null;
    return { engine, command, available: true, version };
  } catch {
    return { engine, command, available: false, version: null };
  }
}

function combinedPrompt(systemPrompt: string, prompt: string): string {
  const system = systemPrompt.trim();
  return system.length > 0 ? `${system}\n\n---\n\n${prompt}` : prompt;
}

function claudeArgs(options: LocalEngineRunOptions): string[] {
  const tools = options.allowedTools?.trim() ?? "";
  const args = [
    "-p",
    options.prompt,
    "--output-format",
    "json",
    "--restricted",
    "--safe-mode",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--append-system-prompt",
    options.systemPrompt,
  ];
  if (tools.length > 0) args.push("--tools", tools, "--allowedTools", tools);
  if (options.jsonSchema !== undefined) {
    args.push("--json-schema", JSON.stringify(options.jsonSchema));
  }
  return args;
}

/**
 * Codex runs in a read-only sandbox with no session persistence. The prompt is
 * piped through stdin and the final message is read from a temp file, because
 * `codex exec` streams human-readable events to stdout by default.
 */
async function runCodex(command: string, options: LocalEngineRunOptions): Promise<unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-codex-"));
  try {
    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-c",
      "project_doc_max_bytes=0",
    ];
    if (options.jsonSchema !== undefined) {
      const schemaPath = path.join(dir, "schema.json");
      fs.writeFileSync(schemaPath, JSON.stringify(options.jsonSchema), "utf8");
      args.push("--output-schema", schemaPath);
    }
    const messagePath = path.join(dir, "last-message.txt");
    args.push("--output-last-message", messagePath, "--cd", options.cwd, "-");

    const { stdout } = await runLocalCommand(command, args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      stdin: combinedPrompt(options.systemPrompt, options.prompt),
    });
    const text = fs.existsSync(messagePath) ? fs.readFileSync(messagePath, "utf8") : stdout;
    return extractJson(text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `dsh --profile headless` answers one task, prints the final assistant text
 * and exits. There is no structured-output flag, so the prompt asks for JSON
 * and we extract it from stdout.
 */
async function runDeepSeek(command: string, options: LocalEngineRunOptions): Promise<unknown> {
  const { stdout } = await runLocalCommand(
    command,
    ["--profile", "headless", combinedPrompt(options.systemPrompt, options.prompt)],
    { cwd: options.cwd, timeoutMs: options.timeoutMs },
  );
  return extractJson(stdout);
}

/**
 * Runs one headless prompt through the selected local engine and returns the
 * parsed JSON answer. Callers validate it with their own schema and normalise
 * oversized fields, so a bad answer never reaches the database unchecked.
 */
export async function runLocalEngine(
  engine: LocalEngineKind,
  command: string,
  options: LocalEngineRunOptions,
): Promise<unknown> {
  const label = LOCAL_ENGINE_LABELS[engine];
  const trimmed = command.trim();
  if (!isValidLocalCommand(trimmed)) throw new Error(`${label} 命令无效`);
  if (!isLocalEngineEnabled(engine)) throw new Error(`${label} 已被环境变量禁用`);

  try {
    if (engine === "claude-code") {
      const { stdout } = await runLocalCommand(trimmed, claudeArgs(options), {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
      });
      return parseClaudeOutput(stdout);
    }
    if (engine === "codex") return await runCodex(trimmed, options);
    return await runDeepSeek(trimmed, options);
  } catch (error) {
    throw new Error(`${label} 调用失败：${errorMessage(error).slice(0, MAX_ERROR_CHARS)}`);
  }
}
