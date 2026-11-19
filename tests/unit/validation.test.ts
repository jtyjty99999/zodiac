import { describe, expect, test } from "vitest";
import {
  branchSchema,
  candidateActionSchema,
  daySchema,
  featureKeySchema,
  harnessCreateSchema,
  harnessPatchSchema,
  isValidBranch,
  isValidRepoUrl,
  repoUrlSchema,
  settingsSchema,
  shaSchema,
  slugSchema,
  supportStatusSchema,
} from "@/lib/validation/schemas";

describe("slugSchema", () => {
  test("accepts lowercase slugs", () => {
    expect(slugSchema.safeParse("codex").success).toBe(true);
    expect(slugSchema.safeParse("wave-agent").success).toBe(true);
  });

  test("rejects uppercase, spaces and short slugs", () => {
    expect(slugSchema.safeParse("Codex").success).toBe(false);
    expect(slugSchema.safeParse("wave agent").success).toBe(false);
    expect(slugSchema.safeParse("x").success).toBe(false);
  });
});

describe("isValidRepoUrl", () => {
  test("accepts https, ssh and scp-style GitHub URLs", () => {
    expect(isValidRepoUrl("https://github.com/openai/codex")).toBe(true);
    expect(isValidRepoUrl("https://github.com/openai/codex.git")).toBe(true);
    expect(isValidRepoUrl("git@github.com:openai/codex.git")).toBe(true);
    expect(isValidRepoUrl("ssh://git@example.com/org/repo")).toBe(true);
  });

  test("rejects unsupported protocols, malformed paths and injection attempts", () => {
    expect(isValidRepoUrl("ftp://github.com/a/b")).toBe(false);
    expect(isValidRepoUrl("https://github.com/only-owner")).toBe(false);
    expect(isValidRepoUrl("https://github.com/a/b/c")).toBe(false);
    expect(isValidRepoUrl("https://no-dot-host/a/b")).toBe(false);
    expect(isValidRepoUrl("https://github.com/a/b; rm -rf /")).toBe(false);
    expect(isValidRepoUrl("git@github.com:no-slash")).toBe(false);
    expect(isValidRepoUrl("")).toBe(false);
    expect(isValidRepoUrl(`https://github.com/a/${"b".repeat(300)}`)).toBe(false);
  });

  test("rejects plaintext and git protocols", () => {
    expect(isValidRepoUrl("http://github.com/a/b")).toBe(false);
    expect(isValidRepoUrl("git://github.com/a/b")).toBe(false);
  });

  test("rejects loopback, private and metadata hosts", () => {
    expect(isValidRepoUrl("https://127.0.0.1/a/b")).toBe(false);
    expect(isValidRepoUrl("https://169.254.169.254/a/b")).toBe(false);
    expect(isValidRepoUrl("https://[::1]/a/b")).toBe(false);
    expect(isValidRepoUrl("https://localhost/a/b")).toBe(false);
    expect(isValidRepoUrl("https://git.internal/a/b")).toBe(false);
    expect(isValidRepoUrl("https://repo.local/a/b")).toBe(false);
    expect(isValidRepoUrl("git@10.0.0.5:owner/repo.git")).toBe(false);
  });

  test("repoUrlSchema wraps the same rules", () => {
    const result = repoUrlSchema.safeParse("not a url");
    expect(result.success).toBe(false);
  });
});

describe("isValidBranch", () => {
  test("accepts normal branch names", () => {
    expect(isValidBranch("main")).toBe(true);
    expect(isValidBranch("feature/mcp-transport")).toBe(true);
    expect(isValidBranch("release-1.2.3")).toBe(true);
  });

  test("rejects ref injection and malformed names", () => {
    expect(isValidBranch("")).toBe(false);
    expect(isValidBranch("-x")).toBe(false);
    expect(isValidBranch("/head")).toBe(false);
    expect(isValidBranch("a..b")).toBe(false);
    expect(isValidBranch("a b")).toBe(false);
    expect(isValidBranch("a\\b")).toBe(false);
  });

  test("branchSchema wraps the same rules", () => {
    expect(branchSchema.safeParse("main").success).toBe(true);
    expect(branchSchema.safeParse("bad branch").success).toBe(false);
  });
});

describe("daySchema", () => {
  test("accepts valid days and rejects impossible ones", () => {
    expect(daySchema.safeParse("2026-11-19").success).toBe(true);
    expect(daySchema.safeParse("2026-13-40").success).toBe(false);
    expect(daySchema.safeParse("19-11-2026").success).toBe(false);
  });
});

describe("harness schemas", () => {
  test("create schema requires slug, name and repo URL", () => {
    const parsed = harnessCreateSchema.safeParse({
      slug: "codex",
      name: "Codex",
      repoUrl: "https://github.com/openai/codex",
      backfillDays: "30",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.backfillDays).toBe(30);
  });

  test("create schema rejects bad fields", () => {
    expect(
      harnessCreateSchema.safeParse({ slug: "Bad Slug", name: "X", repoUrl: "nope" }).success,
    ).toBe(false);
  });

  test("patch schema rejects empty patches", () => {
    expect(harnessPatchSchema.safeParse({}).success).toBe(false);
    expect(harnessPatchSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});

describe("candidateActionSchema", () => {
  test("accepts an accept action with support rows", () => {
    const parsed = candidateActionSchema.safeParse({
      action: "accept",
      featureKey: "context.compaction",
      support: [{ harnessId: 1, status: "yes" }],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an accept action without support rows", () => {
    expect(
      candidateActionSchema.safeParse({
        action: "accept",
        featureKey: "context.compaction",
        support: [],
      }).success,
    ).toBe(false);
  });

  test("rejects malformed feature keys", () => {
    expect(featureKeySchema.safeParse("NoDots").success).toBe(false);
    expect(featureKeySchema.safeParse("context.compaction").success).toBe(true);
  });

  test("accepts a reject action", () => {
    expect(candidateActionSchema.safeParse({ action: "reject" }).success).toBe(true);
    expect(candidateActionSchema.safeParse({ action: "maybe" }).success).toBe(false);
  });
});

describe("misc schemas", () => {
  test("support statuses are constrained", () => {
    expect(supportStatusSchema.safeParse("partial").success).toBe(true);
    expect(supportStatusSchema.safeParse("maybe").success).toBe(false);
  });

  test("shaSchema accepts short and full SHAs", () => {
    expect(shaSchema.safeParse("abc1234").success).toBe(true);
    expect(shaSchema.safeParse("a".repeat(40)).success).toBe(true);
    expect(shaSchema.safeParse("not-hex!").success).toBe(false);
  });

  test("settingsSchema validates the timezone", () => {
    expect(settingsSchema.safeParse({ timezone: "Asia/Shanghai" }).success).toBe(true);
    expect(settingsSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
});
