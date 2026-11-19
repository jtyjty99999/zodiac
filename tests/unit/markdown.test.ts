import { describe, expect, test } from "vitest";
import { snapshotToMarkdown } from "@/lib/catalog/markdown";
import type { CatalogSnapshot } from "@/lib/db/repositories/catalog";
import type { FeatureSupport, Harness, SupportStatus } from "@/lib/types";

function harness(id: number, slug: string, name: string, sortOrder = id): Harness {
  return {
    id,
    slug,
    name,
    repoUrl: `https://github.com/a/${slug}`,
    branch: "main",
    localPath: null,
    sortOrder,
    enabled: true,
    scheduleMode: "daily",
    dailyTime: "09:17",
    backfillDays: 30,
    baselineSha: null,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastSha: null,
    lastError: null,
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  };
}

function support(
  featureId: number,
  harnessId: number,
  status: SupportStatus,
  extra: Partial<FeatureSupport> = {},
): FeatureSupport {
  return {
    id: featureId * 10 + harnessId,
    featureId,
    harnessId,
    status,
    notes: null,
    evidence: null,
    sinceVersion: null,
    updatedDay: "2026-11-19",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...extra,
  };
}

function snapshot(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    generatedAt: "2026-11-19T12:00:00.000Z",
    modules: [
      { id: 1, key: "agent-loop", name: "智能体循环", description: "循环与工具", sortOrder: 1 },
    ],
    features: [
      {
        id: 1,
        key: "agent-loop.loop",
        moduleId: 1,
        name: "主循环",
        description: "采样与工具回灌",
        tags: null,
        overviewMd: "主循环概述。",
        diffSummaryMd: "各家差异。",
        isDeepDive: true,
        firstSeenDay: "2026-11-19",
        updatedDay: "2026-11-19",
        sortOrder: 1,
        createdAt: "2026-11-19T00:00:00.000Z",
        moduleKey: "agent-loop",
        support: [
          support(1, 1, "yes", { updatedDay: "2026-11-18", notes: "自研循环" }),
          support(1, 2, "partial", { updatedDay: "2026-11-19" }),
        ],
      },
    ],
    ...overrides,
  };
}

describe("snapshotToMarkdown", () => {
  test("renders a matrix per module with status marks and latest update day", () => {
    const md = snapshotToMarkdown(snapshot(), [
      harness(2, "beta", "Beta"),
      harness(1, "alpha", "Alpha"),
    ]);

    expect(md).toContain("# Zodiac 功能基线");
    expect(md).toContain("## 智能体循环");
    expect(md).toContain("> 循环与工具");
    // Harnesses are ordered by sortOrder, not input order.
    expect(md).toContain("| 功能点 | 说明 | Alpha | Beta | 更新 |");
    expect(md).toContain("| 主循环 | 采样与工具回灌 | ✓ | ◐ | 2026-11-19 |");
    expect(md).toContain("**横向差异：** 各家差异。");
    expect(md).toContain("- Alpha ✓：自研循环");
  });

  test("marks missing support as unknown and escapes table content", () => {
    const base = snapshot();
    const md = snapshotToMarkdown(
      {
        ...base,
        features: [
          {
            ...base.features[0],
            name: "主|循环",
            description: "第一行\n第二行",
            overviewMd: null,
            diffSummaryMd: null,
            support: [support(1, 1, "unknown")],
          },
        ],
      },
      [harness(1, "alpha", "Alpha"), harness(2, "beta", "Beta")],
    );

    expect(md).toContain("| 主\\|循环 | 第一行 第二行 | ? | · | 2026-11-19 |");
    // No overview/diff summary means no deep-dive section.
    expect(md).not.toContain("## 重点功能实现对比");
  });

  test("omits modules without features", () => {
    const base = snapshot();
    const md = snapshotToMarkdown(
      {
        ...base,
        modules: [
          ...base.modules,
          { id: 2, key: "mcp", name: "MCP", description: null, sortOrder: 2 },
        ],
      },
      [harness(1, "alpha", "Alpha")],
    );
    expect(md).not.toContain("## MCP");
  });
});
