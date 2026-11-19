import { describe, expect, test } from "vitest";
import { categoryLabel, classifyCommit } from "@/lib/analysis/classify";

describe("classifyCommit", () => {
  test("honours conventional commit prefixes with high confidence", () => {
    const result = classifyCommit({ subject: "feat(tui): add theme switcher" });
    expect(result.category).toBe("feature");
    expect(result.confidence).toBe(0.9);
    expect(result.reasons[0]).toContain("conventional commit: feat");
  });

  test.each([
    ["fix: prevent crash when config is missing", "bugfix"],
    ["perf(context): skip redundant token counting", "performance"],
    ["refactor: split scheduler module", "refactor"],
    ["docs: document MCP setup", "docs"],
    ["test: cover sandbox deny paths", "test"],
    ["ci: add nightly workflow", "tooling"],
    ["revert: undo patch tool rewrite", "bugfix"],
    ["style: reformat with biome", "refactor"],
  ])("maps %s to %s", (subject, expected) => {
    expect(classifyCommit({ subject }).category).toBe(expected);
  });

  test("falls back to keyword scoring when no conventional prefix is used", () => {
    const result = classifyCommit({ subject: "Add support for MCP servers" });
    expect(result.category).toBe("feature");
    expect(result.confidence).toBeCloseTo(0.65);
    expect(result.reasons.some((reason) => reason.startsWith("关键词评分"))).toBe(true);
  });

  test("recognises Chinese keywords", () => {
    expect(classifyCommit({ subject: "修复崩溃问题" }).category).toBe("bugfix");
    expect(classifyCommit({ subject: "优化上下文压缩性能" }).category).toBe("performance");
  });

  test("uses file paths as weak signals", () => {
    const result = classifyCommit({
      subject: "tweak",
      files: [{ path: "tests/session.test.ts" }, { path: "src/session.ts" }],
    });
    expect(result.category).toBe("test");
  });

  test("defaults large unlabelled changes to feature", () => {
    const result = classifyCommit({
      subject: "tweak",
      files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }],
      insertions: 30,
      deletions: 20,
    });
    expect(result.category).toBe("feature");
    expect(result.reasons.some((reason) => reason.includes("默认归类为功能迭代"))).toBe(true);
  });

  test("returns other when nothing matches", () => {
    const result = classifyCommit({ subject: "wip" });
    expect(result.category).toBe("other");
    expect(result.confidence).toBe(0.2);
  });

  test("an unknown conventional type is not trusted", () => {
    // `wip:` is not a known type, so classification falls through to keywords.
    expect(classifyCommit({ subject: "wip: stuff" }).category).toBe("other");
  });
});

describe("categoryLabel", () => {
  test("labels every category in Chinese", () => {
    expect(categoryLabel("feature")).toBe("功能迭代");
    expect(categoryLabel("bugfix")).toBe("缺陷修复");
    expect(categoryLabel("other")).toBe("其他");
  });
});
