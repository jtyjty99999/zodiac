import { describe, expect, test } from "vitest";
import {
  buildSnippets,
  isSafeRepoPath,
  isValidSearchPattern,
  parseGrepCounts,
  parseGrepPaths,
  rankFileMatches,
} from "@/lib/git/search";

describe("isValidSearchPattern", () => {
  test("accepts literal words and rejects options, short or control strings", () => {
    expect(isValidSearchPattern("context")).toBe(true);
    expect(isValidSearchPattern("  compaction  ")).toBe(true);
    expect(isValidSearchPattern("x")).toBe(false);
    expect(isValidSearchPattern("-flag")).toBe(false);
    expect(isValidSearchPattern("bad\u0000pattern")).toBe(false);
    expect(isValidSearchPattern("a".repeat(81))).toBe(false);
  });
});

describe("isSafeRepoPath", () => {
  test("accepts relative repository paths", () => {
    expect(isSafeRepoPath("src/core/context.ts")).toBe(true);
    expect(isSafeRepoPath("README.md")).toBe(true);
  });

  test("rejects absolute, traversal, option-like, empty and control paths", () => {
    expect(isSafeRepoPath("/etc/passwd")).toBe(false);
    expect(isSafeRepoPath("../secret")).toBe(false);
    expect(isSafeRepoPath("src/../../etc/passwd")).toBe(false);
    expect(isSafeRepoPath("src//context.ts")).toBe(false);
    expect(isSafeRepoPath("-rf")).toBe(false);
    expect(isSafeRepoPath("")).toBe(false);
    expect(isSafeRepoPath("src/\u0000.ts")).toBe(false);
    expect(isSafeRepoPath("a".repeat(401))).toBe(false);
  });
});

describe("parseGrepCounts", () => {
  const rev = "b".repeat(40);

  test("strips the rev prefix and sums duplicate paths", () => {
    const stdout = [`${rev}:src/a.ts:3`, `${rev}:src/b.ts:1`, `${rev}:src/a.ts:2`, "garbage"].join(
      "\n",
    );
    const { files, truncated } = parseGrepCounts(stdout, rev);
    expect(truncated).toBe(false);
    expect(files).toEqual([
      { path: "src/a.ts", total: 5 },
      { path: "src/b.ts", total: 1 },
    ]);
  });

  test("drops unsafe paths and non-positive counts", () => {
    const stdout = [`${rev}:../evil.ts:9`, `${rev}:src/ok.ts:0`, `${rev}:src/fine.ts:2`].join("\n");
    const { files } = parseGrepCounts(stdout, rev);
    expect(files).toEqual([{ path: "src/fine.ts", total: 2 }]);
  });

  test("flags truncated output when it exceeds the line budget", () => {
    const stdout = [`${rev}:src/a.ts:1`, `${rev}:src/b.ts:2`, `${rev}:src/c.ts:3`].join("\n");
    const { files, truncated } = parseGrepCounts(stdout, rev, 2);
    expect(truncated).toBe(true);
    expect(files).toHaveLength(2);
  });
});

describe("parseGrepPaths", () => {
  const rev = "c".repeat(40);

  test("strips the rev prefix, dedupes and drops unsafe paths", () => {
    const stdout = [
      `${rev}:src/a.ts`,
      `${rev}:src/a.ts`,
      `${rev}:../evil.ts`,
      `${rev}:/absolute.ts`,
      "src/b.ts",
    ].join("\n");
    const { paths, truncated } = parseGrepPaths(stdout, rev);
    expect(truncated).toBe(false);
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("flags truncated output when it exceeds the line budget", () => {
    const stdout = [`${rev}:src/a.ts`, `${rev}:src/b.ts`, `${rev}:src/c.ts`].join("\n");
    const { paths, truncated } = parseGrepPaths(stdout, rev, 2);
    expect(truncated).toBe(true);
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("rankFileMatches", () => {
  test("drops vendored, binary and lock files", () => {
    const ranked = rankFileMatches([
      { path: "node_modules/pkg/index.js", total: 50 },
      { path: "dist/bundle.js", total: 40 },
      { path: "package-lock.json", total: 30 },
      { path: "assets/logo.png", total: 20 },
      { path: "src/core/context.ts", total: 2 },
    ]);
    expect(ranked.map((file) => file.path)).toEqual(["src/core/context.ts"]);
  });

  test("orders by hit count, then prefers source files over tests", () => {
    const ranked = rankFileMatches([
      { path: "tests/context.test.ts", total: 5 },
      { path: "src/context.ts", total: 5 },
      { path: "src/more.ts", total: 9 },
    ]);
    expect(ranked.map((file) => file.path)).toEqual([
      "src/more.ts",
      "src/context.ts",
      "tests/context.test.ts",
    ]);
  });

  test("respects the file cap", () => {
    const ranked = rankFileMatches(
      [
        { path: "a.ts", total: 1 },
        { path: "b.ts", total: 2 },
      ],
      1,
    );
    expect(ranked).toHaveLength(1);
  });

  test("weighted ranking ranks a file matching a rare pattern above a generic one", () => {
    // "task" matches 900 of 1000 files; "todo" matches only 3. Even with equal
    // raw counts, the selective pattern must win.
    const generic = new Set([
      ...Array.from({ length: 900 }, (_, index) => `gen/file-${index}.ts`),
      "src/task.ts",
    ]);
    const specific = new Set(["src/todo.ts", "src/other.ts", "src/third.ts"]);

    const ranked = rankFileMatches(
      [
        { path: "src/task.ts", total: 5 },
        { path: "src/todo.ts", total: 5 },
      ],
      10,
      { patternSets: [specific, generic], patterns: ["todo", "task"], totalFiles: 1000 },
    );

    expect(ranked.map((file) => file.path)).toEqual(["src/todo.ts", "src/task.ts"]);
  });
});

describe("buildSnippets", () => {
  const content = [
    "const a = 1;",
    "const history: string[] = [];",
    "// filler",
    "// filler",
    "function CONTEXT_compact() {}",
    "// filler",
    "// filler",
    "const b = 2;",
  ].join("\n");

  test("extracts numbered context blocks around case-insensitive matches", () => {
    const snippets = buildSnippets(content, ["context"], { maxSnippets: 1, contextLines: 1 });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].line).toBe(5);
    expect(snippets[0].text).toBe("4: // filler\n5: function CONTEXT_compact() {}\n6: // filler");
  });

  test("caps snippets per file", () => {
    const repeated = ["foo", "foo", "foo", "foo"].join("\n");
    expect(buildSnippets(repeated, ["foo"], { maxSnippets: 2 })).toHaveLength(2);
  });

  test("truncates very long matching lines", () => {
    const long = `context ${"x".repeat(400)}`;
    const [snippet] = buildSnippets(long, ["context"], { contextLines: 0 });
    expect(snippet.text.endsWith("…")).toBe(true);
    expect(snippet.text.length).toBeLessThan(320);
  });

  test("returns nothing without usable patterns", () => {
    expect(buildSnippets(content, [])).toEqual([]);
    expect(buildSnippets(content, ["missing-term"])).toEqual([]);
  });
});
