import { describe, expect, test } from "vitest";
import {
  extractKeywords,
  type FeatureHint,
  latinTokens,
  MAX_PATTERNS,
  matchFeatures,
} from "@/lib/explore/keywords";

const features: FeatureHint[] = [
  {
    id: 7,
    key: "context.compaction",
    name: "上下文压缩",
    description: "Condense history when the context window is full",
    tags: JSON.stringify(["compaction", "context window"]),
  },
  {
    id: 8,
    key: "mcp.stdio",
    name: "MCP stdio",
    description: "MCP client over stdio",
    tags: JSON.stringify(["mcp"]),
  },
];

describe("latinTokens", () => {
  test("lowercases tokens and drops stopwords and short fragments", () => {
    expect(latinTokens("How does Context Compaction work in the Agent")).toEqual([
      "context",
      "compaction",
      "work",
      "agent",
    ]);
  });

  test("strips trailing punctuation and deduplicates", () => {
    expect(latinTokens("MCP, mcp. MCP-client")).toEqual(["mcp", "mcp-client"]);
  });
});

describe("matchFeatures", () => {
  test("scores features by key, name, description and tags", () => {
    const matched = matchFeatures(["context", "compaction"], features);
    expect(matched.map((feature) => feature.id)).toEqual([7]);
  });

  test("returns nothing when no term matches or terms are empty", () => {
    expect(matchFeatures(["sandbox"], features)).toEqual([]);
    expect(matchFeatures([], features)).toEqual([]);
  });
});

describe("extractKeywords", () => {
  test("maps Chinese domain terms to English code patterns", () => {
    const result = extractKeywords("各 harness 如何处理上下文压缩");
    expect(result.patterns[0]).toBe("context");
    expect(result.patterns).toContain("compact");
    expect(result.patterns).toContain("上下文");
    expect(result.patterns).toContain("压缩");
    expect(result.notes).toContain("未匹配到功能目录条目");
  });

  test("prefers the longer dictionary term (上下文窗口 before 上下文)", () => {
    const result = extractKeywords("上下文窗口溢出");
    expect(result.patterns[0]).toBe("context window");
    expect(result.patterns[1]).toBe("context");
  });

  test("keeps English tokens and dedupes case-insensitively", () => {
    const result = extractKeywords("context CONTEXT compaction");
    expect(result.patterns).toEqual(["context", "compaction"]);
  });

  test("matches catalog features and adds their tags/key segments", () => {
    const result = extractKeywords("context compaction implementation", features);
    expect(result.matchedFeatures).toEqual([
      { id: 7, key: "context.compaction", name: "上下文压缩" },
    ]);
    expect(result.patterns).toContain("compaction");
    expect(result.patterns).toContain("context window");
  });

  test("drops catalog tags shared by many features", () => {
    const broad: FeatureHint[] = [
      {
        id: 7,
        key: "context.compaction",
        name: "上下文压缩",
        description: null,
        tags: JSON.stringify(["core", "compaction"]),
      },
      {
        id: 9,
        key: "session.core",
        name: "会话核心",
        description: null,
        tags: JSON.stringify(["core", "session"]),
      },
      {
        id: 10,
        key: "models.core",
        name: "模型核心",
        description: null,
        tags: JSON.stringify(["core", "models"]),
      },
    ];
    const result = extractKeywords("context compaction", broad);
    expect(result.patterns).toContain("compaction");
    expect(result.patterns).not.toContain("core");
  });

  test("caps the number of patterns", () => {
    const result = extractKeywords(
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo",
    );
    expect(result.patterns).toHaveLength(MAX_PATTERNS);
    expect(result.patterns[0]).toBe("alpha");
  });

  test("falls back to Chinese bigrams without noise terms", () => {
    const result = extractKeywords("如何实现");
    expect(result.patterns).not.toContain("如何");
    expect(result.patterns).not.toContain("实现");
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  test("uses the proposition itself when nothing else can be extracted", () => {
    const result = extractKeywords("hi");
    expect(result.patterns).toEqual(["hi"]);
    expect(result.notes).toContain("未提取到有效关键词，已使用命题原文检索");
  });

  test("never returns an option-like pattern", () => {
    const result = extractKeywords("--no-verify sandbox");
    expect(result.patterns.every((pattern) => !pattern.startsWith("-"))).toBe(true);
    expect(result.patterns).toContain("sandbox");
  });
});
