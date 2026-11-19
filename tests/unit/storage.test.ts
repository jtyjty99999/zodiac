import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DATA_DIR } from "@/lib/git/mirror";
import { diffRelativePath, readDiff, resolveDataPath, writeDiff } from "@/lib/git/storage";

describe("resolveDataPath", () => {
  test("resolves paths inside the data directory", () => {
    const resolved = resolveDataPath("diffs/codex/abc.patch");
    expect(resolved).toBe(path.join(DATA_DIR, "diffs", "codex", "abc.patch"));
  });

  test("refuses to escape the data directory", () => {
    expect(() => resolveDataPath("../outside.txt")).toThrow(/outside the data directory/);
    expect(() => resolveDataPath(path.join("..", "..", "etc", "passwd"))).toThrow();
    expect(() => resolveDataPath("/etc/passwd")).toThrow();
  });
});

describe("diff storage", () => {
  test("builds slug and sha scoped relative paths", () => {
    const sha = "a".repeat(40);
    expect(diffRelativePath("codex", sha)).toBe(`diffs/codex/${sha}.patch`);
    expect(diffRelativePath("codex", "ABC1234")).toBe("diffs/codex/abc1234.patch");
  });

  test("rejects invalid slugs and SHAs", () => {
    expect(() => diffRelativePath("../evil", "a".repeat(40))).toThrow(/Invalid harness slug/);
    expect(() => diffRelativePath("codex", "--all")).toThrow(/Invalid commit SHA/);
  });

  test("writes and reads a patch back", () => {
    const sha = "b".repeat(40);
    const relative = writeDiff("codex", sha, "diff --git a/x b/x\n+hello\n");
    expect(fs.existsSync(resolveDataPath(relative))).toBe(true);
    expect(readDiff(relative)).toBe("diff --git a/x b/x\n+hello\n");
  });

  test("readDiff tolerates missing paths and files", () => {
    expect(readDiff(null)).toBeNull();
    expect(readDiff("diffs/codex/missing.patch")).toBeNull();
    expect(readDiff("../../etc/passwd")).toBeNull();
  });
});
