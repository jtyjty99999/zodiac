import { execFile } from "node:child_process";
import { extractJson } from "../analysis/claudeJson";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface LocalCommandOptions {
  cwd?: string;
  timeoutMs: number;
  maxBytes?: number;
  /** When provided, written to the child's stdin before it is closed. */
  stdin?: string;
}

export type ClaudeCommandOptions = Omit<LocalCommandOptions, "stdin">;

export interface LocalCommandResult {
  stdout: string;
  stderr: string;
}

export type ClaudeCommandResult = LocalCommandResult;

/**
 * Runs a local CLI invocation without a shell. Rejects with a bounded message:
 * `execFile` echoes the full argv in `error.message`, which would leak the
 * (potentially large, untrusted) prompt into logs.
 */
export function runLocalCommand(
  command: string,
  args: string[],
  options: LocalCommandOptions,
): Promise<LocalCommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        env: process.env,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const reason = error.killed
            ? `timed out after ${options.timeoutMs}ms`
            : typeof error.code === "string"
              ? error.code
              : `exit ${error.code ?? "?"}`;
          const detail = stderr?.trim() || reason;
          reject(new Error(`${command} failed: ${detail.slice(0, 500)}`));
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
    // Leaving stdin open makes headless CLIs wait for piped input and emit a
    // "no stdin data" warning, so always close it after optionally writing.
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();
  });
}

/** Backwards-compatible wrapper for Claude Code call sites. */
export function runClaudeCommand(
  command: string,
  args: string[],
  options: ClaudeCommandOptions,
): Promise<LocalCommandResult> {
  return runLocalCommand(command, args, options);
}

/** Extracts the JSON payload from `claude -p --output-format json` output. */
export function parseClaudeOutput(stdout: string): unknown {
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(stdout);
  } catch {
    return extractJson(stdout);
  }
  if (wrapper && typeof wrapper === "object") {
    const record = wrapper as Record<string, unknown>;
    if (record.is_error === true) {
      throw new Error(
        typeof record.result === "string"
          ? record.result.slice(0, 500)
          : "Claude Code reported an error",
      );
    }
    if (record.structured_output !== undefined) {
      return typeof record.structured_output === "string"
        ? extractJson(record.structured_output)
        : record.structured_output;
    }
    if (typeof record.result === "string") return extractJson(record.result);
  }
  return wrapper;
}
