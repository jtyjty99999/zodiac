import { describe, expect, test } from "vitest";
import { acceptCandidate, rejectCandidate } from "@/lib/catalog/candidates";
import {
  getCompareView,
  getMatrix,
  listDeepDiveFeatures,
  saveFeatureSupport,
} from "@/lib/catalog/matrix";
import {
  commitCatalogChange,
  ensureInitialCatalogVersion,
  nextCatalogVersion,
} from "@/lib/catalog/versions";
import { createCandidate, getCandidate } from "@/lib/db/repositories/candidates";
import {
  exportCatalogSnapshot,
  getFeatureByKey,
  listCatalogVersions,
  listFeatureHistory,
  listFeatures,
  listModules,
  listSupport,
  setFeatureDeepDive,
  type Taxonomy,
  upsertFeatureDetail,
  upsertTaxonomy,
} from "@/lib/db/repositories/catalog";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { makeDb } from "./helpers";

const taxonomy: Taxonomy = {
  modules: [
    { key: "context", name: "上下文", sortOrder: 1 },
    { key: "mcp", name: "MCP", sortOrder: 2 },
  ],
  features: [
    { key: "context.system-prompt", module: "context", name: "系统提示", isDeepDive: true },
    { key: "context.compaction", module: "context", name: "上下文压缩" },
    { key: "mcp.stdio", module: "mcp", name: "MCP stdio" },
  ],
};

function seeded() {
  const db = makeDb();
  const a = createHarness(db, {
    slug: "codex",
    name: "Codex",
    repoUrl: "https://github.com/a/codex",
  });
  const b = createHarness(db, { slug: "pi", name: "Pi", repoUrl: "https://github.com/a/pi" });
  upsertTaxonomy(db, taxonomy, new Date("2026-11-19T12:00:00Z"));
  return { db, codexId: a.harness.id, piId: b.harness.id };
}

describe("upsertTaxonomy", () => {
  test("creates modules and features and seeds unknown support", () => {
    const { db, codexId } = seeded();
    expect(listModules(db).map((module) => module.key)).toEqual(["context", "mcp"]);
    expect(listFeatures(db)).toHaveLength(3);
    const support = listSupport(db);
    expect(support).toHaveLength(6);
    expect(support.every((entry) => entry.status === "unknown")).toBe(true);
    expect(listDeepDiveFeatures(db).map((feature) => feature.key)).toEqual([
      "context.system-prompt",
    ]);
    expect(getFeatureByKey(db, "context.compaction")?.firstSeenDay).toBe("2026-11-19");

    // Idempotent: re-upserting updates without duplicating.
    const result = upsertTaxonomy(db, taxonomy);
    expect(result.createdFeatures).toBe(0);
    expect(listFeatures(db)).toHaveLength(3);
    expect(getFeatureByKey(db, "mcp.stdio")?.moduleId).not.toBe(0);
    expect(listSupport(db, [getFeatureByKey(db, "mcp.stdio")!.id]).length).toBe(2);
    expect(codexId).toBeGreaterThan(0);
  });

  test("rejects unknown modules", () => {
    const db = makeDb();
    expect(() =>
      upsertTaxonomy(db, {
        modules: [],
        features: [{ key: "a.b", module: "missing", name: "x" }],
      }),
    ).toThrow(/Unknown taxonomy module/);
  });
});

describe("getMatrix", () => {
  test("builds rows, cells and coverage", () => {
    const { db, codexId, piId } = seeded();
    const systemPrompt = getFeatureByKey(db, "context.system-prompt")!;
    saveFeatureSupport(db, {
      featureId: systemPrompt.id,
      harnessId: codexId,
      status: "yes",
      day: "2026-11-19",
      recordVersion: false,
    });
    saveFeatureSupport(db, {
      featureId: systemPrompt.id,
      harnessId: piId,
      status: "partial",
      day: "2026-11-19",
      recordVersion: false,
    });

    const matrix = getMatrix(db);
    expect(matrix.modules).toHaveLength(2);
    expect(matrix.harnesses).toHaveLength(2);
    expect(matrix.rows).toHaveLength(3);
    expect(matrix.rows[0].module.key).toBe("context");
    expect(matrix.rows[0].cells).toHaveLength(2);

    const codex = matrix.coverage.find((entry) => entry.harness.id === codexId);
    expect(codex?.yes).toBe(1);
    expect(codex?.unknown).toBe(2);
    // 1 yes out of 3 features = 33.3%
    expect(codex?.score).toBe(33.3);

    const pi = matrix.coverage.find((entry) => entry.harness.id === piId);
    expect(pi?.partial).toBe(1);
    expect(pi?.score).toBe(16.7);
  });
});

describe("getCompareView", () => {
  test("returns cells, details, history and neighbours", () => {
    const { db, codexId } = seeded();
    const feature = getFeatureByKey(db, "context.compaction")!;
    upsertFeatureDetail(db, feature.id, codexId, {
      detailMd: "压缩策略基于 token 预算。",
      evidence: "src/context/compact.ts",
      updatedDay: "2026-11-19",
    });
    saveFeatureSupport(db, {
      featureId: feature.id,
      harnessId: codexId,
      status: "yes",
      notes: "自动压缩",
      day: "2026-11-19",
      recordVersion: false,
    });

    const view = getCompareView("context.compaction", db)!;
    expect(view.feature.key).toBe("context.compaction");
    expect(view.module.key).toBe("context");
    expect(view.deepDive).toBe(false);
    expect(view.cells.find((cell) => cell.harness.id === codexId)?.detail?.detailMd).toContain(
      "压缩策略",
    );
    expect(view.cells.find((cell) => cell.harness.id === codexId)?.support.status).toBe("yes");
    expect(view.history.length).toBeGreaterThan(0);
    expect(view.prev?.key).toBe("context.system-prompt");
    expect(view.next?.key).toBe("mcp.stdio");

    const first = getCompareView("context.system-prompt", db)!;
    expect(first.prev).toBeNull();
    expect(first.deepDive).toBe(true);

    const last = getCompareView("mcp.stdio", db)!;
    expect(last.next).toBeNull();

    expect(getCompareView("nope.none", db)).toBeNull();
  });
});

describe("setFeatureDeepDive", () => {
  test("toggles the deep-dive flag used by the compare view", () => {
    const { db } = seeded();
    const feature = getFeatureByKey(db, "context.compaction")!;
    expect(feature.isDeepDive).toBe(false);

    setFeatureDeepDive(db, feature.id, true);
    expect(getFeatureByKey(db, "context.compaction")?.isDeepDive).toBe(true);
    expect(getCompareView("context.compaction", db)?.deepDive).toBe(true);
    expect(listDeepDiveFeatures(db).map((entry) => entry.key)).toContain("context.compaction");

    setFeatureDeepDive(db, feature.id, false);
    expect(getCompareView("context.compaction", db)?.deepDive).toBe(false);
  });
});

describe("saveFeatureSupport", () => {
  test("persists support, history and a dated catalog version", () => {
    const { db, codexId } = seeded();
    const feature = getFeatureByKey(db, "mcp.stdio")!;
    const result = saveFeatureSupport(db, {
      featureId: feature.id,
      harnessId: codexId,
      status: "yes",
      notes: "标准实现",
      evidence: "src/mcp/client.ts",
      day: "2026-11-19",
      note: "确认 codex 支持 MCP stdio",
    });
    expect(result.support.status).toBe("yes");
    expect(result.support.updatedDay).toBe("2026-11-19");
    expect(result.version).not.toBeNull();

    const history = listFeatureHistory(db, feature.id);
    expect(history[0].summary).toContain("Codex / MCP stdio: yes");
    expect(listCatalogVersions(db)[0].note).toBe("确认 codex 支持 MCP stdio");
  });

  test("rejects unknown features and harnesses", () => {
    const { db, codexId } = seeded();
    const feature = getFeatureByKey(db, "mcp.stdio")!;
    expect(() =>
      saveFeatureSupport(db, { featureId: 9999, harnessId: codexId, status: "yes" }),
    ).toThrow(/Feature not found/);
    expect(() =>
      saveFeatureSupport(db, { featureId: feature.id, harnessId: 9999, status: "yes" }),
    ).toThrow(/Harness not found/);
  });
});

describe("candidate acceptance", () => {
  function pendingCandidate(db: ReturnType<typeof makeDb>, harnessId: number) {
    return createCandidate(db, {
      harnessId,
      name: "Subagent delegation",
      description: "Delegate work to child agents",
      moduleKey: "multi-agent",
      createdDay: "2026-11-19",
      confidence: 0.7,
    });
  }

  test("creates a new feature, support rows, history and a catalog version", () => {
    const { db, codexId, piId } = seeded();
    const candidate = pendingCandidate(db, codexId);

    const result = acceptCandidate(db, candidate.id, {
      featureKey: "multi-agent.subagents",
      moduleKey: "mcp", // re-using an existing module keeps the test simple
      name: "子智能体",
      description: "委派子任务",
      support: [
        { harnessId: codexId, status: "yes", notes: "内置" },
        { harnessId: piId, status: "partial" },
      ],
      note: "采纳子智能体能力",
    });

    expect(result.feature.key).toBe("multi-agent.subagents");
    expect(result.version).not.toBeNull();
    expect(getCandidate(db, candidate.id)?.status).toBe("accepted");

    const support = listSupport(db, [result.feature.id]);
    expect(support).toHaveLength(2);
    expect(support.find((entry) => entry.harnessId === codexId)?.status).toBe("yes");
    expect(support.find((entry) => entry.harnessId === piId)?.status).toBe("partial");
    expect(listFeatureHistory(db, result.feature.id)[0].kind).toBe("added");
    expect(listCatalogVersions(db)[0].note).toBe("采纳子智能体能力");
  });

  test("adds support to an existing feature", () => {
    const { db, codexId, piId } = seeded();
    const candidate = pendingCandidate(db, codexId);
    const result = acceptCandidate(db, candidate.id, {
      featureKey: "mcp.stdio",
      support: [{ harnessId: piId, status: "yes" }],
    });
    expect(result.feature.key).toBe("mcp.stdio");
    expect(listFeatureHistory(db, result.feature.id)[0].kind).toBe("support");
  });

  test("validates input and prevents double review", () => {
    const { db, codexId } = seeded();
    const candidate = pendingCandidate(db, codexId);

    expect(() => acceptCandidate(db, candidate.id, { featureKey: "BadKey", support: [] })).toThrow(
      /Invalid feature key/,
    );
    expect(() =>
      acceptCandidate(db, candidate.id, { featureKey: "new.feature", support: [] }),
    ).toThrow(/moduleKey is required/);
    expect(() =>
      acceptCandidate(db, candidate.id, {
        featureKey: "mcp.stdio",
        support: [{ harnessId: 9999, status: "yes" }],
      }),
    ).toThrow(/Unknown harness/);

    acceptCandidate(db, candidate.id, {
      featureKey: "mcp.stdio",
      support: [{ harnessId: codexId, status: "yes" }],
    });
    expect(() =>
      acceptCandidate(db, candidate.id, {
        featureKey: "mcp.stdio",
        support: [{ harnessId: codexId, status: "yes" }],
      }),
    ).toThrow(/already reviewed/);
    expect(() => acceptCandidate(db, 9999, { featureKey: "mcp.stdio", support: [] })).toThrow(
      /Candidate not found/,
    );
  });

  test("rejects candidates", () => {
    const { db, codexId } = seeded();
    const candidate = pendingCandidate(db, codexId);
    rejectCandidate(db, candidate.id);
    const stored = getCandidate(db, candidate.id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.reviewedDay).not.toBeNull();
    expect(() => rejectCandidate(db, candidate.id)).toThrow(/already reviewed/);
    expect(() => rejectCandidate(db, 9999)).toThrow(/Candidate not found/);
  });
});

describe("catalog versions", () => {
  test("suffixes versions created on the same day", () => {
    const db = makeDb();
    const now = new Date("2026-11-19T12:00:00Z");
    expect(nextCatalogVersion(db, "2026-11-19")).toBe("2026-11-19");
    expect(commitCatalogChange(db, { note: "first", now }).version).toBe("2026-11-19");
    expect(commitCatalogChange(db, { note: "second", now }).version).toBe("2026-11-19-2");
    expect(commitCatalogChange(db, { note: "third", now }).version).toBe("2026-11-19-3");
    expect(nextCatalogVersion(db, "2026-11-20")).toBe("2026-11-20");
    expect(listCatalogVersions(db)).toHaveLength(3);
  });

  test("ensureInitialCatalogVersion only runs once", () => {
    const db = makeDb();
    expect(ensureInitialCatalogVersion(db, "初始基线")).not.toBeNull();
    expect(ensureInitialCatalogVersion(db, "重复")).toBeNull();
    expect(listCatalogVersions(db)).toHaveLength(1);
  });

  test("snapshots include modules, features, module keys and support", () => {
    const { db, codexId } = seeded();
    const feature = getFeatureByKey(db, "mcp.stdio")!;
    saveFeatureSupport(db, {
      featureId: feature.id,
      harnessId: codexId,
      status: "yes",
      day: "2026-11-19",
      recordVersion: false,
    });
    const snapshot = exportCatalogSnapshot(db);
    expect(snapshot.modules).toHaveLength(2);
    expect(snapshot.features).toHaveLength(3);
    const mcp = snapshot.features.find((entry) => entry.key === "mcp.stdio");
    expect(mcp?.moduleKey).toBe("mcp");
    expect(mcp?.support.find((entry) => entry.harnessId === codexId)?.status).toBe("yes");
  });
});
