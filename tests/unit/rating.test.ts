import { describe, expect, test } from "vitest";
import { rateCommit } from "@/lib/analysis/rating";
import type { CommitCategory } from "@/lib/types";

const base = { subject: "change", body: null, insertions: 0, deletions: 0, filesChanged: 0 };

function rate(category: CommitCategory, overrides: Partial<typeof base> = {}) {
  return rateCommit({ ...base, category, ...overrides });
}

describe("rateCommit", () => {
  test("mid-sized feature commits land at three stars", () => {
    const result = rate("feature", { insertions: 60, deletions: 20, filesChanged: 4 });
    expect(result.rating).toBe(3);
    expect(result.reason).toContain("功能迭代");
  });

  test("large feature commits gain scale", () => {
    expect(rate("feature", { insertions: 250, deletions: 10, filesChanged: 12 }).rating).toBe(4);
  });

  test("security-related features gain impact", () => {
    const result = rate("feature", {
      subject: "feat: harden permission sandbox",
      insertions: 40,
      deletions: 10,
      filesChanged: 3,
    });
    expect(result.rating).toBe(4);
    expect(result.reason).toContain("安全边界");
  });

  test("cross-module features can reach five stars", () => {
    expect(rate("feature", { insertions: 900, deletions: 50, filesChanged: 30 }).rating).toBe(5);
  });

  test("critical bugfixes are rated higher", () => {
    const result = rate("bugfix", {
      subject: "fix: critical crash on startup",
      insertions: 20,
      deletions: 5,
      filesChanged: 2,
    });
    expect(result.rating).toBe(4);
    expect(result.reason).toContain("修复关键缺陷");
  });

  test("large bugfixes gain a second star", () => {
    expect(rate("bugfix", { insertions: 120, deletions: 60, filesChanged: 6 }).rating).toBe(4);
  });

  test("substantial performance work gains a star", () => {
    expect(rate("performance", { insertions: 70, deletions: 20, filesChanged: 3 }).rating).toBe(4);
    expect(rate("performance", { insertions: 10, deletions: 5, filesChanged: 2 }).rating).toBe(3);
  });

  test("small refactors are rated down", () => {
    expect(rate("refactor", { insertions: 10, deletions: 5, filesChanged: 2 }).rating).toBe(2);
    expect(rate("refactor", { insertions: 100, deletions: 50, filesChanged: 8 }).rating).toBe(3);
  });

  test("docs/tests/tooling are rated lower", () => {
    expect(rate("docs", { insertions: 50, deletions: 0, filesChanged: 2 }).rating).toBe(2);
    expect(rate("test", { insertions: 50, deletions: 0, filesChanged: 2 }).rating).toBe(2);
    expect(rate("tooling", { insertions: 50, deletions: 0, filesChanged: 2 }).rating).toBe(2);
  });

  test("tiny changes lose a star but never drop below one", () => {
    expect(rate("other", { insertions: 2, deletions: 1, filesChanged: 1 }).rating).toBe(1);
  });

  test("huge changes are capped at five stars", () => {
    expect(rate("feature", { insertions: 2000, deletions: 0, filesChanged: 2 }).rating).toBe(5);
  });

  test("negative churn inputs are treated as zero", () => {
    // Clamped churn of zero still triggers the "tiny change" penalty.
    const result = rate("feature", { insertions: -50, deletions: -50, filesChanged: -1 });
    expect(result.rating).toBe(2);
  });
});
