import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { exploreWithClaudeCode, getClaudeCodeStatus } from "@/lib/explore/claudeCode";
import { ensureMirror, mirrorPath } from "@/lib/git/mirror";
import { createTempRepo, makeDb } from "./helpers";

const REPO_FILES = {
  "src/tasks/todo.ts": [
    "export interface TodoItem { text: string }",
    "export function planTodos(items: TodoItem[]): string {",
    "  return items.map((item) => item.text).join('\\n');",
    "}",
    "",
  ].join("\n"),
  "src/context/compact.ts":
    "export function compactContext(history: string[]): string[] {\n  return history.filter(Boolean);\n}\n",
};

/** Writes an executable fake `claude` that runs `body` with node. */
function fakeClaude(body: string, output?: string): { dir: string; command: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-fake-claude-"));
  const command = path.join(dir, "claude");
  fs.writeFileSync(command, ["#!/usr/bin/env node", body, output ?? ""].join("\n"), "utf8");
  fs.chmodSync(command, 0o755);
  return { dir, command };
}

function worktreeList(slug: string): string {
  return execFileSync("git", ["--git-dir", mirrorPath(slug), "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
}

async function setupMirror(slug: string) {
  const repo = createTempRepo([{ subject: "feat: long-running tasks", files: REPO_FILES }]);
  await ensureMirror({ slug, repoUrl: repo.url, branch: "main", allowLocalRepo: true });
  const db = makeDb();
  const { harness } = createHarness(db, { slug, name: "Fake", repoUrl: repo.url });
  return { db, harness };
}

function input(harness: Awaited<ReturnType<typeof setupMirror>>["harness"]) {
  return {
    proposition: "各 harness 如何处理长程任务",
    patterns: ["long-running"],
    matchedFeatures: [],
    harnesses: [harness],
  };
}

// The global test setup disables local engines; these tests drive fake CLI
// executables, so they re-enable the Claude Code engine for this file.
beforeAll(() => {
  delete process.env.ZODIAC_LOCAL_CLAUDE;
});

afterAll(() => {
  process.env.ZODIAC_LOCAL_CLAUDE = "off";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exploreWithClaudeCode", () => {
  test("materializes snapshots, runs the local CLI and verifies cited evidence", async () => {
    const slug = "fake-main";
    const { db, harness } = await setupMirror(slug);
    const argsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-args-")), "args.json");

    const payload = {
      summaryMd: "本地 Claude Code 认为 Codex 用 todo 列表跟踪长程任务。",
      comparisonMd: "其它 harness 证据不足。",
      patterns: ["todo", "plan"],
      harnesses: [
        {
          slug,
          analysisMd: "见 src/tasks/todo.ts:2。",
          files: [
            { path: "src/tasks/todo.ts", lines: [2, 2, 3] },
            { path: "../secret.ts", lines: [1] },
            { path: "src/missing.ts", lines: [4] },
          ],
        },
        { slug: "ghost", analysisMd: "应被丢弃。", files: [] },
      ],
    };

    const { command } = fakeClaude(
      `
const fs = require("node:fs");
const path = require("node:path");
const dirs = fs.readdirSync(process.cwd()).filter((name) => name.endsWith("${slug}"));
if (dirs.length !== 1) { console.error("missing snapshot"); process.exit(2); }
const file = path.join(process.cwd(), dirs[0], "src/tasks/todo.ts");
if (!fs.existsSync(file)) { console.error("missing file"); process.exit(3); }
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
`,
      `console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: ${JSON.stringify(payload)} }));`,
    );

    const result = await exploreWithClaudeCode(db, input(harness), {
      command,
      timeoutMs: 30_000,
    });

    expect(result).not.toBeNull();
    expect(result?.synthesis.summaryMd).toContain("todo");
    expect(result?.synthesis.comparisonMd).toContain("证据不足");
    expect(result?.synthesis.harnesses).toEqual([{ slug, analysisMd: "见 src/tasks/todo.ts:2。" }]);
    expect(result?.patterns).toEqual(["todo", "plan"]);

    const [evidence] = result?.evidence.harnesses ?? [];
    expect(evidence.status).toBe("ok");
    expect(evidence.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence.totalFiles).toBe(1);
    // Duplicate and unsafe/missing citations are dropped.
    expect(evidence.files).toHaveLength(1);
    expect(evidence.files[0].path).toBe("src/tasks/todo.ts");
    expect(evidence.files[0].snippets.map((snippet) => snippet.line)).toEqual([2, 3]);
    expect(evidence.files[0].snippets[0].text).toContain("planTodos");
    expect(result?.evidence.patterns).toEqual(["todo", "plan"]);

    // The CLI ran under a strict, read-only configuration.
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    expect(args).toContain("--restricted");
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--json-schema");
    expect(args.join(" ")).toContain("Read,Grep,Glob");
    expect(args.join("\n")).toContain("各 harness 如何处理长程任务");

    // Snapshots and worktree metadata are cleaned up.
    expect(worktreeList(slug)).not.toContain(path.join(os.tmpdir(), "zodiac-explore-"));
  });

  test("trims oversized model output instead of discarding the exploration", async () => {
    const slug = "fake-oversize";
    const { db, harness } = await setupMirror(slug);

    const payload = {
      summaryMd: "结论",
      // Both bounds are exceeded: 12 file entries and a 9k-char analysis.
      harnesses: [
        {
          slug,
          analysisMd: "长".repeat(9000),
          files: Array.from({ length: 12 }, () => ({
            path: "src/tasks/todo.ts",
            lines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          })),
        },
      ],
      patterns: Array.from({ length: 25 }, (_, index) => `p${index}`),
    };

    const { command } = fakeClaude(
      `console.log(JSON.stringify({ type: "result", is_error: false, structured_output: ${JSON.stringify(payload)} }));`,
    );

    const result = await exploreWithClaudeCode(db, input(harness), {
      command,
      timeoutMs: 30_000,
    });

    expect(result).not.toBeNull();
    expect(result?.synthesis.harnesses[0].analysisMd).toHaveLength(8000);
    // Patterns survive the schema clamp, then the engine keeps its own top-12.
    expect(result?.patterns).toHaveLength(12);
  });

  test("accepts plain result JSON and records empty evidence without citations", async () => {
    const slug = "fake-plain";
    const { db, harness } = await setupMirror(slug);
    const payload = {
      summaryMd: "证据不足。",
      harnesses: [{ slug, analysisMd: "没有找到可引用的实现。", files: [] }],
    };
    const { command } = fakeClaude(
      "",
      `console.log(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(${JSON.stringify(payload)}) }));`,
    );

    const result = await exploreWithClaudeCode(db, input(harness), {
      command,
      timeoutMs: 30_000,
    });

    expect(result).not.toBeNull();
    expect(result?.patterns).toEqual([]);
    const [evidence] = result?.evidence.harnesses ?? [];
    expect(evidence.status).toBe("empty");
    expect(evidence.note).toContain("未引用");
    expect(evidence.files).toEqual([]);
  });

  test("returns null and cleans up when the CLI fails", async () => {
    const slug = "fake-failure";
    const { db, harness } = await setupMirror(slug);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { command } = fakeClaude("process.exit(1);");

    const result = await exploreWithClaudeCode(db, input(harness), {
      command,
      timeoutMs: 30_000,
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("local claude-code exploration failed"),
      expect.any(String),
    );
    expect(worktreeList(slug)).not.toContain(path.join(os.tmpdir(), "zodiac-explore-"));
  });

  test("returns null for an invalid command or when no mirror resolves", async () => {
    const { db, harness } = await setupMirror("fake-noop");

    const invalid = await exploreWithClaudeCode(db, input(harness), {
      command: "/definitely/not/a/claude",
      timeoutMs: 5_000,
    });
    expect(invalid).toBeNull();

    const missing = createHarness(db, {
      slug: "fake-no-mirror",
      name: "Missing",
      repoUrl: "https://github.com/a/missing",
    }).harness;
    const result = await exploreWithClaudeCode(
      db,
      { ...input(harness), harnesses: [missing] },
      { command: "claude" },
    );
    expect(result).toBeNull();
  });
});

describe("getClaudeCodeStatus", () => {
  test("reports the version of a runnable command", async () => {
    const { command } = fakeClaude("", 'console.log("2.1.278 (Claude Code)");');
    const status = await getClaudeCodeStatus(command, 10_000);
    expect(status).toEqual({
      available: true,
      version: "2.1.278 (Claude Code)",
      command,
    });
  });

  test("reports unavailable for a missing binary or invalid command", async () => {
    expect(await getClaudeCodeStatus("/definitely/not/a/claude", 5_000)).toMatchObject({
      available: false,
      version: null,
    });
    expect(await getClaudeCodeStatus("claude\n--bad", 5_000)).toEqual({
      available: false,
      version: null,
      command: "claude\n--bad",
    });
  });
});
