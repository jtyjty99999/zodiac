import { describe, expect, test } from "vitest";
import { setFeatureSupport, type Taxonomy, upsertTaxonomy } from "@/lib/db/repositories/catalog";
import {
  createExploration,
  deleteExploration,
  failStaleExplorations,
  findRunningExploration,
  finishExploration,
  getExploration,
  listExplorations,
  updateExplorationPhase,
} from "@/lib/db/repositories/explorations";
import { createHarness, deleteHarness } from "@/lib/db/repositories/harnesses";
import {
  beginExploration,
  ExplorationBusyError,
  NoHarnessesError,
  runExploration,
} from "@/lib/explore/run";
import { ensureMirror } from "@/lib/git/mirror";
import type { ExplorationEvidence } from "@/lib/types";
import { createTempRepo, makeDb } from "./helpers";

const taxonomy: Taxonomy = {
  modules: [{ key: "context", name: "上下文", sortOrder: 1 }],
  features: [
    {
      key: "context.compaction",
      module: "context",
      name: "上下文压缩",
      description: "Compact conversation history",
      tags: ["compaction"],
    },
  ],
};

function emptyEvidence(): ExplorationEvidence {
  return {
    generatedAt: "2026-11-20T00:00:00.000Z",
    patterns: [],
    harnesses: [],
    relatedFeatures: [],
    truncated: false,
  };
}

describe("runExploration", () => {
  test("retrieves evidence from a local mirror and stores a heuristic report", async () => {
    const repo = createTempRepo([
      {
        subject: "feat: compact context",
        files: {
          "src/context/compact.ts":
            "export function compactContext(history: string[]): string[] {\n  return history.filter(Boolean);\n}\n",
          "src/tools/shell.ts": "export function shellTool() {\n  return 'ok';\n}\n",
        },
      },
    ]);
    await ensureMirror({
      slug: "explore-main",
      repoUrl: repo.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "explore-main",
      name: "Codex",
      repoUrl: repo.url,
    });
    upsertTaxonomy(db, taxonomy, new Date("2026-11-20T00:00:00Z"));
    const feature = db
      .prepare("SELECT id FROM features WHERE key = ?")
      .get("context.compaction") as { id: number };
    setFeatureSupport(db, feature.id, harness.id, { status: "yes", updatedDay: "2026-11-20" });

    const exploration = beginExploration(db, {
      proposition: "context compaction",
      harnessIds: [harness.id],
    });
    expect(exploration.status).toBe("running");
    expect(exploration.keywords).toContain("context");
    expect(exploration.keywords).toContain("compaction");
    expect(exploration.matchedFeatures).toEqual([
      { id: feature.id, key: "context.compaction", name: "上下文压缩" },
    ]);

    await runExploration(db, exploration.id);

    const stored = getExploration(db, exploration.id);
    expect(stored?.status).toBe("success");
    expect(stored?.phase).toBe("done");
    expect(stored?.engine).toBe("heuristic");
    expect(stored?.finishedAt).not.toBeNull();
    expect(stored?.reportMd).toContain("src/context/compact.ts");
    expect(stored?.reportMd).toContain("已检索");
    expect(stored?.reportMd).toContain("本报告由启发式检索生成");

    const evidence = stored?.evidence;
    expect(evidence?.harnesses).toHaveLength(1);
    expect(evidence?.harnesses[0].status).toBe("ok");
    expect(evidence?.harnesses[0].rev).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence?.harnesses[0].files[0].path).toBe("src/context/compact.ts");
    expect(evidence?.harnesses[0].files[0].snippets.length).toBeGreaterThan(0);
    expect(evidence?.relatedFeatures[0].support).toEqual({ "explore-main": "yes" });
  });

  test("records missing mirrors, empty matches and deleted harnesses without failing", async () => {
    const emptyRepo = createTempRepo([
      { subject: "docs: readme", files: { "src/other.ts": "export const x = 1;\n" } },
    ]);
    await ensureMirror({
      slug: "explore-empty",
      repoUrl: emptyRepo.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const db = makeDb();
    const missing = createHarness(db, {
      slug: "explore-missing",
      name: "Missing",
      repoUrl: "https://github.com/a/missing",
    }).harness;
    const empty = createHarness(db, {
      slug: "explore-empty",
      name: "Empty",
      repoUrl: emptyRepo.url,
    }).harness;
    const gone = createHarness(db, {
      slug: "explore-gone",
      name: "Gone",
      repoUrl: "https://github.com/a/gone",
    }).harness;

    const exploration = beginExploration(db, {
      proposition: "sandbox bubblewrap",
      harnessIds: [missing.id, empty.id, gone.id],
    });
    deleteHarness(db, gone.id);

    await runExploration(db, exploration.id);

    const stored = getExploration(db, exploration.id);
    expect(stored?.status).toBe("success");
    const entries = stored?.evidence?.harnesses ?? [];
    expect(entries.map((entry) => entry.slug)).toEqual([
      "explore-missing",
      "explore-empty",
      `harness-${gone.id}`,
    ]);
    expect(entries[0].status).toBe("missing");
    expect(entries[0].note).toContain("尚未同步");
    expect(entries[1].status).toBe("empty");
    expect(entries[2].status).toBe("error");
    expect(entries[2].note).toContain("已被删除");
    expect(stored?.reportMd).toContain("镜像未同步");
    expect(stored?.reportMd).toContain("已删除的 harness #");
  });

  test("reports a mirror whose configured branch cannot be resolved", async () => {
    const repo = createTempRepo([
      { subject: "feat: sandbox", files: { "src/sandbox.ts": "export const box = 1;\n" } },
    ]);
    await ensureMirror({
      slug: "explore-branch",
      repoUrl: repo.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "explore-branch",
      name: "Branchless",
      repoUrl: repo.url,
      branch: "does-not-exist",
    });

    const exploration = beginExploration(db, {
      proposition: "sandbox",
      harnessIds: [harness.id],
    });
    await runExploration(db, exploration.id);

    const stored = getExploration(db, exploration.id);
    expect(stored?.status).toBe("success");
    expect(stored?.evidence?.harnesses[0].status).toBe("error");
    expect(stored?.evidence?.harnesses[0].note).toContain("无法解析分支");
  });

  test("rejects concurrent explorations and cleans up after completion", async () => {
    const repo = createTempRepo([
      { subject: "feat: context", files: { "src/context.ts": "export const c = 1;\n" } },
    ]);
    await ensureMirror({
      slug: "explore-busy",
      repoUrl: repo.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "explore-busy",
      name: "Busy",
      repoUrl: repo.url,
    });

    const first = beginExploration(db, {
      proposition: "context compaction",
      harnessIds: [harness.id],
    });
    try {
      expect(() =>
        beginExploration(db, { proposition: "another proposition", harnessIds: [harness.id] }),
      ).toThrow(ExplorationBusyError);
    } finally {
      await runExploration(db, first.id);
    }
    expect(getExploration(db, first.id)?.status).toBe("success");

    const second = beginExploration(db, {
      proposition: "context again",
      harnessIds: [harness.id],
    });
    await runExploration(db, second.id);
    expect(getExploration(db, second.id)?.status).toBe("success");
  });

  test("requires at least one enabled harness", () => {
    const db = makeDb();
    expect(() => beginExploration(db, { proposition: "context compaction" })).toThrow(
      NoHarnessesError,
    );
  });

  test("rejects unknown harness ids", () => {
    const db = makeDb();
    expect(() =>
      beginExploration(db, { proposition: "context compaction", harnessIds: [9999] }),
    ).toThrow(/Harness 不存在/);
  });
});

describe("explorations repository", () => {
  test("tracks phases and protects running rows", () => {
    const db = makeDb();
    const created = createExploration(db, {
      proposition: "context compaction",
      harnessIds: [1],
      keywords: ["context"],
      matchedFeatures: [],
    });
    expect(created.status).toBe("running");
    expect(created.phase).toBe("search");
    expect(deleteExploration(db, created.id)).toBe(false);

    updateExplorationPhase(db, created.id, "synthesize");
    expect(getExploration(db, created.id)?.phase).toBe("synthesize");

    finishExploration(db, created.id, {
      status: "success",
      engine: "heuristic+claude",
      reportMd: "# report",
      evidence: emptyEvidence(),
    });
    const finished = getExploration(db, created.id);
    expect(finished?.status).toBe("success");
    expect(finished?.phase).toBe("done");
    expect(finished?.engine).toBe("heuristic+claude");
    expect(finished?.reportMd).toBe("# report");
    expect(finished?.evidence?.patterns).toEqual([]);

    // List view omits the potentially large report/evidence payloads.
    const listed = listExplorations(db);
    expect(listed[0].id).toBe(created.id);
    expect(listed[0].reportMd).toBeNull();
    expect(listed[0].evidence).toBeNull();

    expect(deleteExploration(db, created.id)).toBe(true);
    expect(getExploration(db, created.id)).toBeNull();
    expect(deleteExploration(db, created.id)).toBe(false);
  });

  test("records failures with a bounded error message", () => {
    const db = makeDb();
    const created = createExploration(db, {
      proposition: "context compaction",
      harnessIds: [1],
      keywords: [],
      matchedFeatures: [],
    });
    finishExploration(db, created.id, { status: "failed", error: "x".repeat(2000) });
    const failed = getExploration(db, created.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toHaveLength(1500);
  });

  test("reclaims stale running rows but spares active ids", () => {
    const db = makeDb();
    const stale = createExploration(db, {
      proposition: "stale exploration",
      harnessIds: [1],
      keywords: [],
      matchedFeatures: [],
    });
    const active = createExploration(db, {
      proposition: "active exploration",
      harnessIds: [1],
      keywords: [],
      matchedFeatures: [],
    });

    // Negative window puts the cutoff in the future so freshly created rows
    // count as stale deterministically; active ids must still be spared.
    expect(failStaleExplorations(db, [active.id], -1)).toBe(1);
    expect(getExploration(db, stale.id)?.status).toBe("failed");
    expect(getExploration(db, stale.id)?.error).toContain("stale");
    expect(getExploration(db, active.id)?.status).toBe("running");
    expect(findRunningExploration(db)?.id).toBe(active.id);
  });
});
