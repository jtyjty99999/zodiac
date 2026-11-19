import { describe, expect, test } from "vitest";
import { searchTerms } from "@/lib/analysis/crossCheck";

describe("searchTerms", () => {
  test("extracts latin words and a Chinese phrase", () => {
    expect(searchTerms("feat: add prompt caching", "Uses the anthropic SDK")).toEqual([
      "prompt",
      "caching",
      "anthropic",
    ]);
  });

  test("keeps Chinese phrases and drops short tokens", () => {
    expect(searchTerms("feat: 新增子智能体", null)).toEqual(["新增子智能体"]);
  });

  test("deduplicates and caps at three terms", () => {
    const terms = searchTerms(
      "support workspace memory workspace session",
      "workspace memory session compaction",
    );
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.length).toBeLessThanOrEqual(3);
  });

  test("returns an empty list when there is nothing to search", () => {
    expect(searchTerms("fix", null)).toEqual([]);
    expect(searchTerms("a b", "")).toEqual([]);
  });

  test("strips conventional commit prefixes", () => {
    expect(searchTerms("fix(mcp): stdio reconnect", null)).toEqual(["stdio", "reconnect"]);
  });
});
