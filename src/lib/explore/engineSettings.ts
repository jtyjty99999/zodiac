import type { Db } from "../db/client";
import { getSetting } from "../db/repositories/settings";

export type ExplorationEngineSetting = "api" | "claude-code";

export const CLAUDE_CODE_DEFAULT_COMMAND = "claude";
export const CLAUDE_CODE_COMMAND_MAX_LENGTH = 500;

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects control bytes in untrusted settings
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A command name/path safe to pass to execFile without a shell. */
export function isValidClaudeCommand(value: string): boolean {
  const command = value.trim();
  if (command.length === 0 || command.length > CLAUDE_CODE_COMMAND_MAX_LENGTH) return false;
  return !CONTROL_CHARS.test(command);
}

export interface ExplorationEngineSettings {
  engine: ExplorationEngineSetting;
  /** Command used to invoke the local Claude Code CLI. */
  command: string;
}

/**
 * Reads the exploration engine choice. The API engine remains the default so
 * existing installs keep their behaviour until the user opts into the CLI.
 */
export function getExplorationEngineSettings(db: Db): ExplorationEngineSettings {
  const engine: ExplorationEngineSetting =
    getSetting(db, "exploreEngine") === "claude-code" ? "claude-code" : "api";
  const stored = getSetting(db, "claudeCodeCommand")?.trim() ?? "";
  const command = isValidClaudeCommand(stored) ? stored : CLAUDE_CODE_DEFAULT_COMMAND;
  return { engine, command };
}
