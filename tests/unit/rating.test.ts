import { describe, expect, test } from "vitest";
import { rateCommit } from "@/lib/analysis/rating";
import type { CommitCategory } from "@/lib/types";

const base = {
  subject: "change",
  body: null as string | null,
  insertions: 0,
  deletions: 0,
  filesChanged: 0,
  files: [] as string[],
};

function rate(category: CommitCategory, overrides: Partial<typeof base> = {}) {
  return rateCommit({ ...base, category, ...overrides });
}

describe("rateCommit", () => {
  test("ordinary feature work lands at three stars", () => {
    const result = rate("feature", {
      insertions: 60,
      deletions: 20,
      filesChanged: 4,
      files: ["src/mcp.ts"],
    });
    expect(result.rating).toBe(3);
    expect(result.reason).toContain("功能迭代");
    expect(result.reason).toContain("改动行数不作为加分项");
  });

  test("large churn alone does not raise the rating", () => {
    const result = rate("feature", {
      insertions: 2500,
      deletions: 900,
      filesChanged: 40,
      files: ["src/mcp.ts", "src/tools.ts"],
    });
    expect(result.rating).toBe(3);
  });

  test("security-related features gain importance", () => {
    const result = rate("feature", {
      subject: "feat: harden permission sandbox",
      insertions: 40,
      deletions: 10,
      filesChanged: 3,
      files: ["src/permissions.ts"],
    });
    expect(result.rating).toBe(4);
    expect(result.reason).toContain("安全边界");
  });

  test("core runtime changes gain impact", () => {
    const result = rate("feature", {
      subject: "feat: rework agent loop",
      insertions: 40,
      deletions: 10,
      filesChanged: 3,
      files: ["src/agent/loop.ts", "docs/loop.md"],
    });
    expect(result.rating).toBe(4);
    expect(result.reason).toContain("核心运行时");
  });

  test("positive signals are capped at two", () => {
    const result = rate("feature", {
      subject: "feat(security)!: breaking permission sandbox rewrite",
      body: "BREAKING CHANGE: old policy format removed",
      insertions: 50,
      deletions: 10,
      filesChanged: 4,
      files: ["src/core/permissions.ts"],
    });
    expect(result.rating).toBe(5);
  });

  test("critical bugfixes rate higher than large mechanical fixes", () => {
    const critical = rate("bugfix", {
      subject: "fix: crash on startup",
      insertions: 20,
      deletions: 5,
      filesChanged: 2,
      files: ["bin/main.ts"],
    });
    expect(critical.rating).toBe(4);
    expect(critical.reason).toContain("修复关键缺陷");

    const large = rate("bugfix", {
      subject: "fix: rename helpers",
      insertions: 900,
      deletions: 900,
      filesChanged: 30,
      files: ["src/a.ts", "src/b.ts"],
    });
    expect(large.rating).toBe(3);
  });

  test("performance work only gains a star near core paths", () => {
    expect(
      rate("performance", {
        subject: "perf: faster streaming",
        insertions: 10,
        deletions: 5,
        filesChanged: 2,
        files: ["src/runtime/stream.ts"],
      }).rating,
    ).toBe(4);
    expect(
      rate("performance", {
        subject: "perf: faster release script",
        insertions: 10,
        deletions: 5,
        filesChanged: 2,
        files: ["scripts/release.mjs"],
      }).rating,
    ).toBe(3);
  });

  test("docs, tests, tooling and other are rated down regardless of size", () => {
    for (const category of ["docs", "test", "tooling"] as const) {
      expect(
        rate(category, { insertions: 500, deletions: 0, filesChanged: 5, files: ["README.md"] })
          .rating,
      ).toBe(2);
    }
    expect(rate("other", { insertions: 500, deletions: 0, filesChanged: 5 }).rating).toBe(2);
  });

  test("pure mechanical changes lose a star", () => {
    const result = rate("feature", {
      insertions: 2000,
      deletions: 0,
      filesChanged: 4,
      files: ["README.md", "CHANGELOG.md", "docs/usage.md", "pnpm-lock.yaml"],
    });
    expect(result.rating).toBe(2);
    expect(result.reason).toContain("机械改动");
  });

  test("tiny changes lose a star but never drop below one", () => {
    expect(rate("other", { insertions: 2, deletions: 1, filesChanged: 1 }).rating).toBe(1);
  });

  test("negative churn inputs are treated as zero", () => {
    const result = rate("feature", {
      insertions: -50,
      deletions: -50,
      filesChanged: -1,
      files: ["src/a.ts"],
    });
    expect(result.rating).toBe(2);
  });
});
