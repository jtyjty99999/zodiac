import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Feature, Harness } from "@/lib/types";

vi.mock("@/lib/db/repositories/harnesses", () => ({ listHarnesses: vi.fn() }));
vi.mock("@/lib/explore/evidence", () => ({ resolveHarnessSource: vi.fn() }));
vi.mock("@/lib/analysis/claudeJson", () => ({ requestClaudeJson: vi.fn() }));
vi.mock("@/lib/claude/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude/cli")>();
  return { ...actual, runClaudeCommand: vi.fn() };
});
vi.mock("@/lib/git/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/git/search")>();
  return { ...actual, readBlob: vi.fn(), searchMirror: vi.fn() };
});
vi.mock("@/lib/git/snapshot", () => ({
  createSnapshotRoot: vi.fn(() => "/tmp/audit-root"),
  createSnapshot: vi.fn(async (_mirror: string, _rev: string, root: string, name: string) => {
    return `${root}/${name}`;
  }),
  removeSnapshot: vi.fn(async () => {}),
  removeSnapshotRoot: vi.fn(async () => {}),
}));

import { requestClaudeJson } from "@/lib/analysis/claudeJson";
import { runClaudeCommand } from "@/lib/claude/cli";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { resolveHarnessSource } from "@/lib/explore/evidence";
import { auditFeature, buildAuditPrompt } from "@/lib/features/audit";
import { readBlob, searchMirror } from "@/lib/git/search";
import { createSnapshot } from "@/lib/git/snapshot";

const config = { enabled: true, hasKey: true, model: "claude-sonnet-5", maxPerSync: 5 };
const engineSettings = { engine: "claude-code" as const, command: "claude" };

const harness: Harness = {
  id: 1,
  slug: "codex",
  name: "Codex",
  repoUrl: "https://github.com/a/codex",
  branch: "main",
  localPath: null,
  sortOrder: 0,
  enabled: true,
  scheduleMode: "off",
  dailyTime: "09:17",
  backfillDays: 30,
  baselineSha: null,
  lastAttemptAt: null,
  lastSyncAt: null,
  lastSuccessAt: null,
  lastSha: null,
  lastError: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
};

const feature: Feature = {
  id: 10,
  key: "context.compaction",
  moduleId: 1,
  name: "上下文压缩",
  description: "Compact conversation history",
  tags: '["compaction"]',
  overviewMd: null,
  diffSummaryMd: null,
  isDeepDive: true,
  firstSeenDay: "2026-11-01",
  updatedDay: "2026-11-01",
  sortOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
};

const source = { harness, dir: "/tmp/mirror", rev: "a".repeat(40) };

const modelOutput = {
  overviewMd: "两端都支持",
  diffSummaryMd: null,
  harnesses: [
    {
      slug: "codex",
      status: "yes",
      notes: "完整实现",
      detailMd: "在 src/a.ts 中实现。",
      evidence: [{ path: "src/a.ts", lines: [2] }],
    },
  ],
};

const mocked = {
  requestClaudeJson: vi.mocked(requestClaudeJson),
  runClaudeCommand: vi.mocked(runClaudeCommand),
  listHarnesses: vi.mocked(listHarnesses),
  resolveHarnessSource: vi.mocked(resolveHarnessSource),
  readBlob: vi.mocked(readBlob),
  searchMirror: vi.mocked(searchMirror),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.listHarnesses.mockReturnValue([harness]);
  mocked.resolveHarnessSource.mockResolvedValue({ ok: true, source });
  mocked.readBlob.mockResolvedValue("line one\nline two\nline three\n");
  vi.mocked(createSnapshot).mockImplementation(
    async (_mirror, _rev, root, name) => `${root}/${name}`,
  );
  mocked.searchMirror.mockResolvedValue({
    rev: source.rev,
    files: [{ path: "src/a.ts", total: 1, snippets: [{ line: 2, text: "compact()" }] }],
    totalFiles: 1,
    totalMatches: 1,
    truncated: false,
    notes: [],
  });
});

describe("auditFeature", () => {
  test("uses the API with keyword evidence when configured", async () => {
    mocked.requestClaudeJson.mockResolvedValue(modelOutput);

    const outcome = await auditFeature({} as never, feature, { config });

    expect(outcome.engine).toBe("claude");
    expect(outcome.revs).toEqual({ codex: source.rev });
    expect(outcome.result.harnesses[0].evidence).toEqual(["src/a.ts:2"]);
    expect(mocked.requestClaudeJson).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining("不可信数据") }),
    );
    expect(mocked.runClaudeCommand).not.toHaveBeenCalled();
  });

  test("falls back to local Claude Code snapshots when the API yields nothing", async () => {
    mocked.requestClaudeJson.mockResolvedValue(null);
    mocked.runClaudeCommand.mockResolvedValue({
      stdout: JSON.stringify({ type: "result", is_error: false, structured_output: modelOutput }),
      stderr: "",
    });

    const outcome = await auditFeature({} as never, feature, { config, engineSettings });

    expect(outcome.engine).toBe("claude-code");
    expect(outcome.result.overviewMd).toBe("两端都支持");
    const args = mocked.runClaudeCommand.mock.calls[0][1];
    expect(args).toContain("--json-schema");
    expect(args).toContain("Read,Grep,Glob");
  });

  test("reports clearly when no mirror is available", async () => {
    mocked.listHarnesses.mockReturnValue([]);
    await expect(auditFeature({} as never, feature, { config })).rejects.toThrow(
      /先同步至少一个 harness/,
    );
  });

  test("reports a local CLI failure", async () => {
    mocked.requestClaudeJson.mockResolvedValue(null);
    mocked.runClaudeCommand.mockRejectedValue(new Error("not logged in"));

    await expect(auditFeature({} as never, feature, { config, engineSettings })).rejects.toThrow(
      /本地 Claude Code 审查失败/,
    );
  });

  test("throws when snapshots could not be prepared", async () => {
    const snapshot = await import("@/lib/git/snapshot");
    vi.mocked(snapshot.createSnapshot).mockRejectedValue(new Error("worktree failed"));
    mocked.requestClaudeJson.mockResolvedValue(null);

    await expect(auditFeature({} as never, feature, { config, engineSettings })).rejects.toThrow(
      /没有可用的审查引擎/,
    );
  });

  test("builds prompts from plain-text tags and tolerates empty catalogs", () => {
    const prompt = buildAuditPrompt({ ...feature, tags: "mcp, context" }, new Map());
    expect(prompt).toContain("mcp、context");
    expect(prompt).toContain("上下文压缩");
    expect(buildAuditPrompt({ ...feature, tags: "{broken" }, new Map())).toContain("{broken");
  });
});

describe("audit labels", () => {
  test("maps audit statuses and engines to Chinese labels", async () => {
    const { featureAuditEngineLabel, featureAuditStatusLabel } = await import(
      "@/lib/features/labels"
    );
    expect(featureAuditStatusLabel("running")).toBe("进行中");
    expect(featureAuditStatusLabel("success")).toBe("已完成");
    expect(featureAuditStatusLabel("failed")).toBe("失败");
    expect(featureAuditEngineLabel("claude")).toBe("Claude API");
    expect(featureAuditEngineLabel("claude-code")).toBe("本地 Claude Code");
  });
});
