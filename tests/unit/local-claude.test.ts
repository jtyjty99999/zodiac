import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AiCommitContext } from "@/lib/analysis/anthropic";
import { analyzeWithLocalClaude } from "@/lib/analysis/localClaude";

const context: AiCommitContext = {
  repo: "https://github.com/openai/codex",
  sha: "a".repeat(40),
  subject: "feat: add MCP stdio transport",
  body: "Exposes an MCP client.",
  files: [{ path: "src/mcp.ts", additions: 120, deletions: 3 }],
  diff: "diff --git a/src/mcp.ts b/src/mcp.ts\n+export const transport = 1;\n",
};

const review = {
  category: "feature",
  rating: 4,
  ratingReason: "新增 MCP 传输层，影响所有 MCP 用户。",
  summary:
    "**解决的问题**\n\n外部工具无法接入。\n\n**实现思路**\n\n新增 transport 层。\n\n**影响与风险**\n\n新增协议入口。",
  tags: ["mcp"],
  candidate: { name: "MCP stdio transport", description: "stdio 传输", moduleKey: "mcp" },
};

const tempDirs: string[] = [];

function fakeClaude(scriptBody: string): { command: string; argsFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-claude-"));
  tempDirs.push(dir);
  const command = path.join(dir, "claude");
  const argsFile = path.join(dir, "args.txt");
  fs.writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${scriptBody}\n`, {
    mode: 0o755,
  });
  return { command, argsFile };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("analyzeWithLocalClaude", () => {
  test("parses structured output from headless Claude Code", async () => {
    const { command, argsFile } = fakeClaude(
      `cat <<'EOF'\n${JSON.stringify({ type: "result", is_error: false, structured_output: review })}\nEOF\n`,
    );

    const result = await analyzeWithLocalClaude(context, { command });

    expect(result).toMatchObject({ category: "feature", rating: 4, tags: ["mcp"] });

    const args = fs.readFileSync(argsFile, "utf8");
    expect(args.split("\n")).toContain("--restricted");
    expect(args.split("\n")).toContain("--safe-mode");
    expect(args.split("\n")).toContain("--json-schema");
    expect(args.split("\n")).toContain("--no-session-persistence");
    expect(args).toContain("feat: add MCP stdio transport");
  });

  test("clamps oversized fields instead of discarding the review", async () => {
    const { command } = fakeClaude(
      `cat <<'EOF'\n${JSON.stringify({
        type: "result",
        is_error: false,
        structured_output: {
          ...review,
          rating: 9,
          ratingReason: "r".repeat(2000),
          summary: "s".repeat(9000),
          tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
        },
      })}\nEOF\n`,
    );

    const result = await analyzeWithLocalClaude(context, { command });

    expect(result?.rating).toBe(5);
    expect(result?.ratingReason.length).toBe(800);
    expect(result?.summary.length).toBe(4000);
    expect(result?.tags).toHaveLength(10);
  });

  test("returns null when the CLI reports an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { command } = fakeClaude(
      `cat <<'EOF'\n${JSON.stringify({ type: "result", is_error: true, result: "Not logged in" })}\nEOF\n`,
    );

    expect(await analyzeWithLocalClaude(context, { command })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  test("returns null without spawning for an invalid command", async () => {
    expect(await analyzeWithLocalClaude(context, { command: "bad\ncommand" })).toBeNull();
  });

  test("returns null and warns when the executable is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = path.join(os.tmpdir(), `zodiac-missing-${Date.now()}`);
    expect(await analyzeWithLocalClaude(context, { command: missing })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
