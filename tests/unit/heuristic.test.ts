import { describe, expect, test } from "vitest";
import {
  extractTags,
  guessModuleKey,
  heuristicSummary,
  suggestCandidate,
} from "@/lib/analysis/heuristic";

describe("extractTags", () => {
  test("detects domain tags from subject, body and paths", () => {
    const tags = extractTags({
      subject: "feat: add MCP stdio transport",
      body: "Also improves session resume",
      files: [{ path: "src/mcp/client.ts" }],
    });
    expect(tags).toContain("mcp");
    expect(tags).toContain("session");
  });

  test("recognises Chinese keywords", () => {
    const tags = extractTags({ subject: "支持子代理与沙箱权限" });
    expect(tags).toContain("subagent");
    expect(tags).toContain("permissions");
  });

  test("caps the tag list at eight entries", () => {
    const tags = extractTags({
      subject:
        "add mcp sandbox context memory session worktree subagent tools lsp plugin model tui ide web desktop oauth config otel performance security ci release",
    });
    expect(tags.length).toBeLessThanOrEqual(8);
  });
});

describe("guessModuleKey", () => {
  test("prefers module hints that match both tags and text", () => {
    expect(guessModuleKey({ subject: "Add MCP server support" })).toBe("mcp");
    expect(guessModuleKey({ subject: "feat: subagent delegation" })).toBe("multi-agent");
  });

  test("falls back to the first tag match", () => {
    expect(guessModuleKey({ subject: "plugin: rework", tags: ["plugin"] })).toBe("extensions");
  });

  test("returns null when no hints fire", () => {
    expect(guessModuleKey({ subject: "Improve reliability", tags: [] })).toBeNull();
  });
});

describe("heuristicSummary", () => {
  test("builds a markdown summary with category, scale, files and tags", () => {
    const { summaryMd, tags } = heuristicSummary({
      subject: "feat: add MCP transport",
      body: null,
      category: "feature",
      files: [{ path: "src/mcp/client.ts" }, { path: "src/mcp/index.ts" }],
      insertions: 120,
      deletions: 30,
    });
    expect(tags).toContain("mcp");
    expect(summaryMd).toContain("功能迭代");
    expect(summaryMd).toContain("2 个文件");
    expect(summaryMd).toContain("`src/mcp/client.ts`");
    expect(summaryMd).toContain("涉及领域");
  });

  test("notes when no file list is available", () => {
    const { summaryMd } = heuristicSummary({
      subject: "fix: typo",
      body: null,
      category: "bugfix",
      files: [],
      insertions: 1,
      deletions: 1,
    });
    expect(summaryMd).toContain("浅抓取");
    expect(summaryMd).not.toContain("涉及领域");
  });

  test("uses large-change wording for big feature commits", () => {
    const { summaryMd } = heuristicSummary({
      subject: "feat: rework everything",
      body: null,
      category: "feature",
      files: [{ path: "src/a.ts" }],
      insertions: 600,
      deletions: 100,
    });
    expect(summaryMd).toContain("规模较大的功能迭代");
  });
});

describe("suggestCandidate", () => {
  test("ignores non-feature commits", () => {
    expect(suggestCandidate({ category: "bugfix", subject: "fix: crash", files: [] })).toBeNull();
  });

  test("ignores commits whose subject is too short after stripping the prefix", () => {
    expect(suggestCandidate({ category: "feature", subject: "feat: abc", files: [] })).toBeNull();
  });

  test("ignores housekeeping subjects", () => {
    expect(
      suggestCandidate({ category: "feature", subject: "chore: bump deps everywhere", files: [] }),
    ).toBeNull();
  });

  test("builds a candidate from a feature commit", () => {
    const suggestion = suggestCandidate({
      category: "feature",
      subject: "feat: add support for subagents",
      body: "Lets the agent delegate work to a child loop.",
      files: [{ path: "src/agents/child.ts" }],
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion?.name).toBe("add support for subagents");
    expect(suggestion?.moduleKey).toBe("multi-agent");
    expect(suggestion?.confidence).toBe(0.7);
    expect(suggestion?.evidence).toContain("src/agents/child.ts");
  });

  test("falls back to the subject when the body is empty", () => {
    const suggestion = suggestCandidate({
      category: "feature",
      subject: "feat: introduce workspace memory",
      files: [{ path: "src/memory/workspace.ts" }],
    });
    expect(suggestion?.description).toBe("introduce workspace memory");
    expect(suggestion?.confidence).toBe(0.7);
  });

  test("requires at least one non-test source file", () => {
    expect(
      suggestCandidate({
        category: "feature",
        subject: "feat: add workspace memory",
        files: [{ path: "docs/memory.md" }],
      }),
    ).toBeNull();
    expect(
      suggestCandidate({
        category: "feature",
        subject: "feat: add workspace memory",
        files: [{ path: "packages/foo/tests/new.ts" }],
      }),
    ).toBeNull();
    expect(
      suggestCandidate({
        category: "feature",
        subject: "feat: add workspace memory",
        files: [],
      }),
    ).toBeNull();
  });

  test("requires explicit new-capability wording", () => {
    expect(
      suggestCandidate({
        category: "feature",
        subject: "feat: rework workspace memory internals",
        files: [{ path: "src/memory/workspace.ts" }],
      }),
    ).toBeNull();
  });
});
