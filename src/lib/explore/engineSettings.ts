import type { Db } from "../db/client";
import { getSetting } from "../db/repositories/settings";

/** Locally installed coding-agent CLIs that can run reviews, audits and exploration. */
export type LocalEngineKind = "claude-code" | "codex" | "deepseek";

/** Exploration can use the hosted Anthropic API or one local engine. */
export type ExplorationEngineSetting = "api" | LocalEngineKind;

export const LOCAL_ENGINE_KINDS: LocalEngineKind[] = ["claude-code", "codex", "deepseek"];

export const CLAUDE_CODE_DEFAULT_COMMAND = "claude";
export const CODEX_DEFAULT_COMMAND = "codex";
export const DEEPSEEK_DEFAULT_COMMAND = "dsh";
export const LOCAL_COMMAND_MAX_LENGTH = 500;
export const CLAUDE_CODE_COMMAND_MAX_LENGTH = LOCAL_COMMAND_MAX_LENGTH;

export const LOCAL_ENGINE_DEFAULT_COMMANDS: Record<LocalEngineKind, string> = {
  "claude-code": CLAUDE_CODE_DEFAULT_COMMAND,
  codex: CODEX_DEFAULT_COMMAND,
  deepseek: DEEPSEEK_DEFAULT_COMMAND,
};

export const LOCAL_ENGINE_LABELS: Record<LocalEngineKind, string> = {
  "claude-code": "本地 Claude Code",
  codex: "本地 Codex",
  deepseek: "本地 DeepSeek Harness",
};

const LOCAL_ENGINE_COMMAND_SETTINGS: Record<LocalEngineKind, string> = {
  "claude-code": "claudeCodeCommand",
  codex: "codexCommand",
  deepseek: "deepseekCommand",
};

export function isLocalEngineKind(value: string | null | undefined): value is LocalEngineKind {
  return (
    value !== null && value !== undefined && LOCAL_ENGINE_KINDS.includes(value as LocalEngineKind)
  );
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects control bytes in untrusted settings
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A command name/path safe to pass to execFile without a shell. */
export function isValidLocalCommand(value: string): boolean {
  const command = value.trim();
  if (command.length === 0 || command.length > LOCAL_COMMAND_MAX_LENGTH) return false;
  return !CONTROL_CHARS.test(command);
}

/** Backwards-compatible alias used by existing call sites and tests. */
export const isValidClaudeCommand = isValidLocalCommand;

/**
 * `ZODIAC_LOCAL_ENGINE=off` disables every local engine; `ZODIAC_LOCAL_CLAUDE=off`
 * keeps its original meaning and only disables Claude Code.
 */
export function isLocalEngineEnabled(engine: LocalEngineKind): boolean {
  if ((process.env.ZODIAC_LOCAL_ENGINE ?? "").trim().toLowerCase() === "off") return false;
  if (engine === "claude-code" && process.env.ZODIAC_LOCAL_CLAUDE === "off") return false;
  return true;
}

export interface ExplorationEngineSettings {
  engine: ExplorationEngineSetting;
  /** Command for the local Claude Code CLI. */
  command: string;
  /** Command for the local Codex CLI. */
  codexCommand: string;
  /** Command for the local DeepSeek Harness (`dsh`) CLI. */
  deepseekCommand: string;
}

function storedCommand(db: Db, engine: LocalEngineKind): string {
  const stored = getSetting(db, LOCAL_ENGINE_COMMAND_SETTINGS[engine])?.trim() ?? "";
  return isValidLocalCommand(stored) ? stored : LOCAL_ENGINE_DEFAULT_COMMANDS[engine];
}

/**
 * Reads the exploration engine choice. The API engine remains the default so
 * existing installs keep their behaviour until the user opts into a CLI.
 */
export function getExplorationEngineSettings(db: Db): ExplorationEngineSettings {
  const stored = getSetting(db, "exploreEngine");
  const engine: ExplorationEngineSetting = isLocalEngineKind(stored) ? stored : "api";
  return {
    engine,
    command: storedCommand(db, "claude-code"),
    codexCommand: storedCommand(db, "codex"),
    deepseekCommand: storedCommand(db, "deepseek"),
  };
}

export function localCommandFor(
  settings: ExplorationEngineSettings,
  engine: LocalEngineKind,
): string {
  if (engine === "codex") return settings.codexCommand;
  if (engine === "deepseek") return settings.deepseekCommand;
  return settings.command;
}

/**
 * Resolves which local engine the automatic fallbacks use. When the user picked
 * the API engine, reviews and audits keep the historical Claude Code fallback.
 */
export function localEngineSelection(settings: ExplorationEngineSettings): {
  engine: LocalEngineKind;
  command: string;
} {
  const engine = isLocalEngineKind(settings.engine) ? settings.engine : "claude-code";
  return { engine, command: localCommandFor(settings, engine) };
}
