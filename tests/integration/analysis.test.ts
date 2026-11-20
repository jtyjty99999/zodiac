import { describe, expect, test } from "vitest";
import { analyzeCommitById, analyzeCommits, extractCommitTags } from "@/lib/analysis";
import { listCandidates } from "@/lib/db/repositories/candidates";
import {
  getCommitById,
  getCommitBySha,
  listCommits,
  setCommitStats,
  upsertCommits,
} from "@/lib/db/repositories/commits";
import { getDailyReport } from "@/lib/db/repositories/daily";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { makeDb } from "./helpers";

function seeded() {
  const db = makeDb();
  const { harness } = createHarness(db, {
    slug: "demo",
    name: "Demo",
    repoUrl: "https://github.com/a/demo",
  });
  upsertCommits(db, harness.id, [
    {
      sha: "a".repeat(40),
      committerDate: "2026-11-19T10:00:00.000Z",
      day: "2026-11-19",
      author: "T",
      subject: "feat: add MCP stdio transport",
      body: "Exposes an MCP client.",
      filesChanged: 2,
    },
    {
      sha: "b".repeat(40),
      committerDate: "2026-11-18T10:00:00.000Z",
      day: "2026-11-18",
      author: "T",
      subject: "fix: crash on startup",
      body: null,
      filesChanged: 1,
    },
  ]);
  const feature = getCommitBySha(db, harness.id, "a".repeat(40))!;
  const bugfix = getCommitBySha(db, harness.id, "b".repeat(40))!;
  setCommitStats(db, feature.id, {
    insertions: 120,
    deletions: 10,
    files: [
      { path: "src/mcp.ts", additions: 100, deletions: 5, status: "A" },
      { path: "README.md", additions: 20, deletions: 5, status: "M" },
    ],
    diffPath: null,
  });
  return { db, harnessId: harness.id, featureId: feature.id, bugfixId: bugfix.id };
}

describe("analyzeCommitById", () => {
  test("classifies, rates and summarises with heuristics", async () => {
    const { db, harnessId, featureId } = seeded();
    const outcome = await analyzeCommitById(db, featureId, { useAi: false });

    expect(outcome).toMatchObject({
      commitId: featureId,
      category: "feature",
      analyzedBy: "heuristic",
    });
    expect(outcome?.rating).toBeGreaterThanOrEqual(3);
    expect(outcome?.candidateId).not.toBeNull();

    const stored = getCommitById(db, featureId)!;
    expect(stored.category).toBe("feature");
    expect(stored.analyzedAt).not.toBeNull();
    expect(stored.summaryMd).toContain("功能迭代");
    expect(JSON.parse(stored.featureTags ?? "[]")).toContain("mcp");

    // A daily report is rebuilt for the commit day.
    expect(getDailyReport(db, harnessId, "2026-11-19")?.commitCount).toBe(1);

    const candidates = listCandidates(db, "pending");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(outcome?.candidateId);
    expect(candidates[0].moduleKey).toBe("mcp");
  });

  test("does not create candidates for bugfixes", async () => {
    const { db, bugfixId } = seeded();
    const outcome = await analyzeCommitById(db, bugfixId, { useAi: false });
    expect(outcome?.category).toBe("bugfix");
    expect(outcome?.candidateId).toBeNull();
    expect(listCandidates(db)).toHaveLength(0);
  });

  test("returns the stored analysis on re-run unless forced", async () => {
    const { db, featureId } = seeded();
    const first = await analyzeCommitById(db, featureId, { useAi: false });
    const second = await analyzeCommitById(db, featureId, { useAi: false });
    expect(second).toMatchObject({
      commitId: featureId,
      category: first?.category,
      rating: first?.rating,
      candidateId: null,
    });

    const forced = await analyzeCommitById(db, featureId, { useAi: false, force: true });
    // Candidate dedupe returns the existing pending candidate.
    expect(forced?.candidateId).toBe(first?.candidateId);
    expect(listCandidates(db)).toHaveLength(1);
  });

  test("falls back to heuristics when API and local CLI are unavailable", async () => {
    const { db, featureId } = seeded();
    const outcome = await analyzeCommitById(db, featureId, {
      aiConfig: { enabled: true, hasKey: false, model: "claude-sonnet-5", maxPerSync: 5 },
      diffText: "diff --git a/x b/x\n+hello\n",
      localAnalyzer: async () => null,
    });
    expect(outcome?.analyzedBy).toBe("heuristic");
    expect(getCommitById(db, featureId)?.analyzedBy).toBe("heuristic");
  });

  test("uses the local Claude Code reviewer when the API is unavailable", async () => {
    const { db, featureId } = seeded();
    const outcome = await analyzeCommitById(db, featureId, {
      aiConfig: { enabled: false, hasKey: false, model: "claude-sonnet-5", maxPerSync: 5 },
      diffText: "diff --git a/x b/x\n+hello\n",
      localAnalyzer: async () => ({
        category: "feature",
        rating: 4,
        ratingReason: "本地评审：新增 MCP 传输层。",
        summary:
          "**解决的问题**\n\n需要 MCP。\n\n**实现思路**\n\n新增传输层。\n\n**影响与风险**\n\n新增入口。",
        tags: ["mcp"],
        candidate: null,
      }),
    });

    expect(outcome?.analyzedBy).toBe("claude-code");
    const stored = getCommitById(db, featureId)!;
    expect(stored.analyzedBy).toBe("claude-code");
    expect(stored.summaryMd).toContain("**实现思路**");
    expect(stored.rating).toBe(4);
  });

  test("skips the local reviewer when model analysis is disabled", async () => {
    const { db, featureId } = seeded();
    const localAnalyzer = async () => {
      throw new Error("should not be called");
    };
    const outcome = await analyzeCommitById(db, featureId, { useAi: false, localAnalyzer });
    expect(outcome?.analyzedBy).toBe("heuristic");
  });

  test("can skip candidate creation", async () => {
    const { db, featureId } = seeded();
    const outcome = await analyzeCommitById(db, featureId, { useAi: false, candidate: false });
    expect(outcome?.candidateId).toBeNull();
    expect(listCandidates(db)).toHaveLength(0);
  });

  test("returns null for unknown commits", async () => {
    const { db } = seeded();
    expect(await analyzeCommitById(db, 9999, { useAi: false })).toBeNull();
  });
});

describe("analyzeCommits", () => {
  test("processes a batch up to the limit", async () => {
    const { db, harnessId } = seeded();
    const commits = listCommits(db, { harnessId });
    const result = await analyzeCommits(db, commits, { useAi: false, limit: 1 });

    expect(result.analyzed).toBe(1);
    expect(result.aiUsed).toBe(0);
    expect(result.candidates).toBe(1);
    expect(result.days).toEqual(["2026-11-19"]);
    // Only the newest commit is analysed.
    expect(getCommitBySha(db, harnessId, "b".repeat(40))?.analyzedAt).toBeNull();
  });

  test("honours a zero AI budget", async () => {
    const { db, harnessId } = seeded();
    const commits = listCommits(db, { harnessId });
    const result = await analyzeCommits(db, commits, { aiBudget: 0 });
    expect(result.aiUsed).toBe(0);
    expect(result.analyzed).toBe(2);
  });
});

describe("extractCommitTags", () => {
  test("derives tags from commit text and files", () => {
    const { db, featureId } = seeded();
    const commit = getCommitById(db, featureId)!;
    expect(extractCommitTags(commit, [{ path: "src/mcp.ts" }])).toContain("mcp");
  });
});
