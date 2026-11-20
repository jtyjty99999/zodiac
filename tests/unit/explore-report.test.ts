import { describe, expect, test } from "vitest";
import type { ExplorationSynthesis } from "@/lib/explore/ai";
import { buildHeuristicReport, buildReport, type ReportInput } from "@/lib/explore/report";
import type { ExplorationEvidence } from "@/lib/types";

function evidence(): ExplorationEvidence {
  return {
    generatedAt: "2026-11-20T00:00:00.000Z",
    patterns: ["context", "compact"],
    harnesses: [
      {
        harnessId: 1,
        slug: "codex",
        name: "Codex",
        status: "ok",
        rev: "a".repeat(40),
        totalFiles: 1,
        totalMatches: 3,
        files: [
          {
            path: "codex-rs/core/src/context.rs",
            total: 3,
            snippets: [{ line: 12, text: "10: fn compact() {\n12:   drop(&history);" }],
          },
        ],
        note: null,
        truncated: false,
      },
      {
        harnessId: 2,
        slug: "pi",
        name: "Pi",
        status: "missing",
        rev: null,
        totalFiles: 0,
        totalMatches: 0,
        files: [],
        note: "本地镜像尚未同步，请先在 Harness 管理页同步",
        truncated: false,
      },
    ],
    relatedFeatures: [
      { featureId: 1, key: "context.compaction", name: "上下文压缩", support: { codex: "yes" } },
    ],
    truncated: false,
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    proposition: "各 harness 如何处理上下文压缩",
    createdAt: "2026-11-20T00:00:00.000Z",
    keywords: ["context", "compact"],
    evidence: evidence(),
    ...overrides,
  };
}

describe("buildHeuristicReport", () => {
  test("renders the fixed skeleton with comparison table and evidence", () => {
    const report = buildHeuristicReport(input());
    expect(report).toContain("# 功能探索：各 harness 如何处理上下文压缩");
    expect(report).toContain("引擎：启发式");
    expect(report).toContain("`context`、`compact`");
    expect(report).toContain("## 结论");
    expect(report).toContain("## 横向对比");
    expect(report).toContain("| Codex | 已探索 | 1 | 3 | `codex-rs/core` | 上下文压缩（支持） |");
    expect(report).toContain("| Pi | 镜像未同步 | 0 | 0 | — |");
    expect(report).toContain("codex-rs/core/src/context.rs");
    expect(report).toContain("```text");
    expect(report).toContain("10: fn compact() {");
    expect(report).toContain("本地镜像尚未同步");
    expect(report).toContain("本报告由启发式检索生成");
    // The limitation is stated up front, not only in the closing notes.
    expect(report).toContain("本次未运行 AI 分析");
    expect(report).not.toContain("## 横向差异");
  });

  test("ranks the harness with the most evidence and names main directories", () => {
    const report = buildHeuristicReport(input());
    expect(report).toContain("证据最集中的 harness：Codex（3 行）");
    expect(report).toContain("`codex-rs/core`");
    expect(report).toContain("未参与检索：Pi（镜像未同步）");
  });

  test("handles an empty harness list", () => {
    const report = buildHeuristicReport(input({ evidence: { ...evidence(), harnesses: [] } }));
    expect(report).toContain("共检索 0 个 harness、2 个关键词，命中 0 个文件 / 0 行。");
    expect(report).toContain("| — | — | 0 | 0 | — | — |");
  });

  test("lengthens the fence when snippets contain backticks", () => {
    const base = evidence();
    const withFence: ExplorationEvidence = {
      ...base,
      harnesses: [
        {
          ...base.harnesses[0],
          files: [
            {
              path: "src/markdown.ts",
              total: 1,
              snippets: [{ line: 3, text: "```\nconst fence = 1;\n```" }],
            },
          ],
        },
      ],
    };
    const report = buildHeuristicReport(input({ evidence: withFence }));
    expect(report).toContain("````text");
  });

  test("notes truncation and unavailable harnesses", () => {
    const base = evidence();
    const report = buildHeuristicReport(input({ evidence: { ...base, truncated: true } }));
    expect(report).toContain("部分结果因上述上限被截断");
  });
});

describe("buildReport with Claude synthesis", () => {
  const synthesis: ExplorationSynthesis = {
    summaryMd: "Codex 在 core 层压缩上下文，Pi 没有可用的检索证据。",
    comparisonMd: "## 触发时机\n\n两者在压缩触发时机上不同。",
    harnesses: [
      {
        slug: "codex",
        analysisMd:
          "## 方案概述\n\nCodex 于 `context.rs` 中实现压缩。\n\n### 数据流\n\n请求前压缩。",
      },
    ],
  };

  test("leads with the analysis, comparison and per-harness implementation", () => {
    const report = buildReport(input(), synthesis);
    expect(report).toContain("引擎：启发式 + Claude");
    expect(report).toContain("Codex 在 core 层压缩上下文");
    expect(report).toContain("## 横向对比");
    expect(report).toContain("两者在压缩触发时机上不同。");
    expect(report).toContain("## 各 harness 实现方案");
    expect(report).toContain("Codex 于 `context.rs` 中实现压缩。");
    // Model headings are demoted so they nest under the report's sections.
    expect(report).toContain("### 触发时机");
    expect(report).toContain("#### 方案概述");
    expect(report).toContain("##### 数据流");
    expect(report).not.toContain("本报告由启发式检索生成");
    // Skeleton table and traceable citations stay intact under synthesis.
    expect(report).toContain("| Codex | 已探索 | 1 | 3 |");
    expect(report).toContain("**代码引用**");
    expect(report).toContain("codex-rs/core/src/context.rs");
    // Code snippets are demoted to the page's collapsed evidence section.
    expect(report).not.toContain("```text");
    expect(report).toContain("「代码证据」中展开查看");
  });

  test("falls back to the comparison table when the model omits comparisonMd", () => {
    const report = buildReport(input(), { ...synthesis, comparisonMd: null });
    expect(report).toContain("## 横向对比");
    expect(report).toContain("| Codex | 已探索 | 1 | 3 |");
    expect(report).not.toContain("两者在压缩触发时机上不同。");
  });
});
