import { describe, expect, test } from "vitest";
import {
  getFeatureByKey,
  listCatalogVersions,
  listFeatureDetails,
  listFeatureHistory,
  listSupport,
  setFeatureSupport,
  type Taxonomy,
  upsertTaxonomy,
} from "@/lib/db/repositories/catalog";
import {
  createFeatureAudit,
  failStaleFeatureAudits,
  finishFeatureAudit,
  getFeatureAudit,
  latestFeatureAudit,
} from "@/lib/db/repositories/featureAudits";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { resolveHarnessSource } from "@/lib/explore/evidence";
import {
  buildAuditPrompt,
  buildAuditReport,
  type FeatureAuditOutcome,
  normalizeAuditResult,
  verifyAuditCitations,
} from "@/lib/features/audit";
import {
  beginFeatureAudit,
  FeatureAuditBusyError,
  FeatureAuditNotFoundError,
  runFeatureAudit,
} from "@/lib/features/run";
import { ensureMirror } from "@/lib/git/mirror";
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

function seeded() {
  const db = makeDb();
  const codex = createHarness(db, {
    slug: "audit-codex",
    name: "Codex",
    repoUrl: "https://github.com/a/codex",
  });
  const pi = createHarness(db, {
    slug: "audit-pi",
    name: "Pi",
    repoUrl: "https://github.com/a/pi",
  });
  upsertTaxonomy(db, taxonomy, new Date("2026-11-20T00:00:00Z"));
  return {
    db,
    feature: getFeatureByKey(db, "context.compaction")!,
    codexId: codex.harness.id,
    piId: pi.harness.id,
  };
}

function outcome(): FeatureAuditOutcome {
  return {
    engine: "claude-code",
    revs: { "audit-codex": "a".repeat(40), "audit-pi": "b".repeat(40) },
    result: {
      overviewMd: "两端都支持上下文压缩，Codex 的实现更完整。",
      diffSummaryMd: "Codex 使用摘要 + 截断，Pi 只做截断。",
      harnesses: [
        {
          slug: "audit-codex",
          status: "yes",
          notes: "完整的压缩流水线",
          detailMd: "在 `src/context/compact.ts` 中按 token 预算截断。",
          evidence: ["src/context/compact.ts:3"],
        },
        {
          slug: "audit-pi",
          status: "partial",
          notes: "仅截断，无摘要",
          detailMd: "只在上下文超限时丢弃最早消息。",
          evidence: [],
        },
      ],
    },
  };
}

describe("runFeatureAudit", () => {
  test("writes support, details, comparison and a baseline version", async () => {
    const { db, feature, codexId, piId } = seeded();
    const audit = beginFeatureAudit(db, feature.key);
    await runFeatureAudit(db, audit.id, { auditor: async () => outcome() });

    const stored = getFeatureAudit(db, audit.id)!;
    expect(stored.status).toBe("success");
    expect(stored.engine).toBe("claude-code");
    expect(stored.version).not.toBeNull();
    expect(stored.reportMd).toContain("AI 重审");
    expect(JSON.parse(stored.resultJson ?? "{}").overviewMd).toContain("上下文压缩");

    const updated = getFeatureByKey(db, "context.compaction")!;
    expect(updated.overviewMd).toContain("Codex 的实现更完整");
    expect(updated.diffSummaryMd).toContain("摘要 + 截断");
    expect(updated.isDeepDive).toBe(true);

    const support = listSupport(db, [feature.id]);
    const codex = support.find((entry) => entry.harnessId === codexId)!;
    const pi = support.find((entry) => entry.harnessId === piId)!;
    expect(codex).toMatchObject({
      status: "yes",
      notes: "完整的压缩流水线",
      evidence: "src/context/compact.ts:3",
    });
    expect(pi).toMatchObject({ status: "partial", notes: "仅截断，无摘要", evidence: null });

    const details = listFeatureDetails(db, feature.id);
    expect(details.find((entry) => entry.harnessId === codexId)?.detailMd).toContain("compact.ts");

    const history = listFeatureHistory(db, feature.id).filter((entry) => entry.kind === "audit");
    expect(history).toHaveLength(2);

    const versions = listCatalogVersions(db, 5);
    expect(versions[0].note).toContain("AI 重审");
    expect(versions[0].version).toBe(stored.version);
  });

  test("records a failed audit without touching the catalog", async () => {
    const { db, feature, codexId } = seeded();
    setFeatureSupport(db, feature.id, codexId, { status: "no", updatedDay: "2026-11-19" });
    const audit = beginFeatureAudit(db, feature.key);
    await runFeatureAudit(db, audit.id, {
      auditor: async () => {
        throw new Error("CLI 不可用");
      },
    });

    const stored = getFeatureAudit(db, audit.id)!;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("CLI 不可用");
    expect(stored.version).toBeNull();
    expect(getFeatureByKey(db, "context.compaction")?.overviewMd).toBeNull();
    expect(getFeatureByKey(db, "context.compaction")?.isDeepDive).toBe(false);
    expect(listSupport(db, [feature.id]).find((entry) => entry.harnessId === codexId)?.status).toBe(
      "no",
    );
  });

  test("only one audit may run at a time", async () => {
    const { db, feature } = seeded();
    const first = beginFeatureAudit(db, feature.key);
    try {
      expect(() => beginFeatureAudit(db, feature.key)).toThrow(FeatureAuditBusyError);
    } finally {
      await runFeatureAudit(db, first.id, { auditor: async () => outcome() });
    }
    expect(getFeatureAudit(db, first.id)?.status).toBe("success");

    const second = beginFeatureAudit(db, feature.key);
    await runFeatureAudit(db, second.id, { auditor: async () => outcome() });
    expect(latestFeatureAudit(db, feature.id)?.id).toBe(second.id);
  });

  test("rejects unknown feature keys", () => {
    const { db } = seeded();
    expect(() => beginFeatureAudit(db, "missing.feature")).toThrow(FeatureAuditNotFoundError);
  });
});

describe("feature audits repository", () => {
  test("tracks status and reclaims stale rows", () => {
    const { db, feature } = seeded();
    const audit = createFeatureAudit(db, { featureId: feature.id, engine: "claude" });
    expect(audit.status).toBe("running");
    expect(latestFeatureAudit(db, feature.id)?.id).toBe(audit.id);

    finishFeatureAudit(db, audit.id, {
      status: "success",
      engine: "claude",
      version: "2026-11-20",
      resultJson: "{}",
      reportMd: "# report",
    });
    expect(getFeatureAudit(db, audit.id)).toMatchObject({
      status: "success",
      version: "2026-11-20",
      reportMd: "# report",
    });

    const stale = createFeatureAudit(db, { featureId: feature.id, engine: "claude-code" });
    db.prepare("UPDATE feature_audits SET created_at = ? WHERE id = ?").run(
      "2020-01-01T00:00:00.000Z",
      stale.id,
    );
    expect(failStaleFeatureAudits(db)).toBe(1);
    expect(getFeatureAudit(db, stale.id)?.status).toBe("failed");

    // An active (in-process) audit is not reclaimed.
    const active = createFeatureAudit(db, { featureId: feature.id, engine: "claude-code" });
    db.prepare("UPDATE feature_audits SET created_at = ? WHERE id = ?").run(
      "2020-01-01T00:00:00.000Z",
      active.id,
    );
    expect(failStaleFeatureAudits(db, [active.id])).toBe(0);
    expect(getFeatureAudit(db, active.id)?.status).toBe("running");
  });
});

describe("audit output handling", () => {
  test("normalizes oversized and malformed model output", () => {
    const result = normalizeAuditResult({
      overviewMd: "o".repeat(5_000),
      diffSummaryMd: 42,
      harnesses: [
        {
          slug: "codex",
          status: "yes",
          notes: "n".repeat(1_000),
          detailMd: "d".repeat(7_000),
          evidence: [
            { path: "src/a.ts", lines: [4] },
            { path: "../etc/passwd", lines: [1] },
            { path: "src/b.ts", lines: ["x"] },
          ],
        },
        { slug: "codex", status: "no", notes: "dup", detailMd: "dup", evidence: [] },
        { slug: "pi", status: "maybe", notes: "bad", detailMd: "bad", evidence: [] },
      ],
    });

    expect(result.overviewMd).toHaveLength(4_000);
    expect(result.diffSummaryMd).toBeNull();
    expect(result.harnesses).toHaveLength(1);
    expect(result.harnesses[0].notes).toHaveLength(800);
    expect(result.harnesses[0].detailMd).toHaveLength(6_000);
    expect(result.harnesses[0].evidence).toEqual(["src/a.ts:4"]);
  });

  test("verifies citations against the mirror and drops invented paths", async () => {
    const repo = createTempRepo([
      {
        subject: "feat: compact context",
        files: {
          "src/context/compact.ts": "line one\nline two\nline three\n",
        },
      },
    ]);
    const slug = `audit-verify-${Date.now()}`;
    await ensureMirror({ slug, repoUrl: repo.url, branch: "main", allowLocalRepo: true });
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug,
      name: "Codex",
      repoUrl: repo.url,
    });
    const resolved = await resolveHarnessSource(harness);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const verified = await verifyAuditCitations(
      {
        overviewMd: "overview",
        diffSummaryMd: null,
        harnesses: [
          {
            slug,
            status: "yes",
            notes: "ok",
            detailMd: "detail",
            evidence: ["src/context/compact.ts:2", "src/context/compact.ts:99", "src/nope.ts:1"],
          },
          {
            slug: "unknown-harness",
            status: "unknown",
            notes: "?",
            detailMd: "?",
            evidence: ["src/context/compact.ts:1"],
          },
        ],
      },
      new Map([[slug, resolved.source]]),
    );

    expect(verified.harnesses[0].evidence).toEqual(["src/context/compact.ts:2"]);
    expect(verified.harnesses[1].evidence).toEqual([]);
  });

  test("builds a prompt and report with each harness and its evidence", () => {
    const { db, feature } = seeded();
    const prompt = buildAuditPrompt(
      feature,
      new Map([
        [
          "audit-codex",
          {
            harness: {
              id: 1,
              slug: "audit-codex",
              name: "Codex",
              repoUrl: "",
              branch: "main",
              localPath: null,
              sortOrder: 0,
              enabled: true,
              scheduleMode: "off",
              dailyTime: "09:17",
              backfillDays: 30,
              baselineSha: null,
              lastAttemptAt: null,
              lastSyncAt: null,
              lastSuccessAt: null,
              lastSha: null,
              lastError: null,
              createdAt: "",
              updatedAt: "",
            },
            dir: "/tmp/mirror",
            rev: "c".repeat(40),
            snapshotDir: "/tmp/snapshot/0-audit-codex",
          },
        ],
      ]),
    );
    expect(prompt).toContain("上下文压缩");
    expect(prompt).toContain("0-audit-codex");
    expect(prompt).toContain("compaction");

    const report = buildAuditReport(feature, outcome(), "2026-11-20T00:00:00.000Z");
    expect(report).toContain("AI 重审：上下文压缩");
    expect(report).toContain("audit-codex · 支持");
    expect(report).toContain("src/context/compact.ts:3");
    expect(db).toBeDefined();
  });
});
