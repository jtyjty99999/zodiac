import { describe, expect, test } from "vitest";
import {
  countOpenCandidates,
  createCandidate,
  getCandidate,
  listCandidateChecks,
  listCandidates,
  updateCandidateStatus,
  upsertCandidateCheck,
} from "@/lib/db/repositories/candidates";
import {
  type CommitInput,
  countAllCommits,
  countByCategory,
  countCommits,
  countCommitsByDay,
  countCommitsSince,
  getCommitBySha,
  latestCommits,
  listCommitFiles,
  listCommits,
  listCommitsForAnalysis,
  setCommitStats,
  updateCommitAnalysis,
  upsertCommits,
} from "@/lib/db/repositories/commits";
import {
  getDailyReport,
  listAvailableDays,
  listDailyDaySummaries,
  rebuildDailyReport,
  setDailySummary,
} from "@/lib/db/repositories/daily";
import {
  createHarness,
  deleteHarness,
  getHarnessById,
  getHarnessBySlug,
  listHarnesses,
  recordSyncFailure,
  recordSyncStart,
  recordSyncSuccess,
  updateHarness,
} from "@/lib/db/repositories/harnesses";
import { countReleases, listReleases, upsertReleases } from "@/lib/db/repositories/releases";
import {
  getAllSettings,
  getJsonSetting,
  getSetting,
  setJsonSetting,
  setSetting,
} from "@/lib/db/repositories/settings";
import {
  failStaleRuns,
  finishSyncRun,
  getRunningSyncRun,
  getSyncRun,
  getSyncRunsByIds,
  listRunningSyncRuns,
  listSyncRuns,
  startSyncRun,
  touchSyncRun,
  updateSyncRunPhase,
} from "@/lib/db/repositories/syncRuns";
import { makeDb } from "./helpers";

function commit(shaChar: string, day: string, subject = "feat: something"): CommitInput {
  return {
    sha: shaChar.repeat(40),
    committerDate: `${day}T12:00:00.000Z`,
    day,
    author: "Test",
    subject,
    body: null,
    url: null,
    filesChanged: 1,
  };
}

describe("harness repository", () => {
  test("creates, updates, lists and deletes harnesses", () => {
    const db = makeDb();
    const { harness, created } = createHarness(db, {
      slug: "codex",
      name: "Codex",
      repoUrl: "https://github.com/openai/codex",
      scheduleMode: "hourly",
      backfillDays: 7,
    });
    expect(created).toBe(true);
    expect(harness.slug).toBe("codex");
    expect(harness.scheduleMode).toBe("hourly");
    expect(harness.enabled).toBe(true);

    // Creating the same slug returns the existing row.
    const again = createHarness(db, {
      slug: "codex",
      name: "Other",
      repoUrl: "https://github.com/x/y",
    });
    expect(again.created).toBe(false);
    expect(again.harness.name).toBe("Codex");

    const updated = updateHarness(db, harness.id, { enabled: false, name: "Codex CLI" });
    expect(updated?.enabled).toBe(false);
    expect(updated?.name).toBe("Codex CLI");

    createHarness(db, { slug: "pi", name: "Pi", repoUrl: "https://github.com/a/pi" });
    expect(listHarnesses(db)).toHaveLength(2);
    expect(listHarnesses(db, { enabledOnly: true })).toHaveLength(1);
    expect(getHarnessBySlug(db, "pi")?.name).toBe("Pi");

    expect(deleteHarness(db, harness.id)).toBe(true);
    expect(getHarnessById(db, harness.id)).toBeNull();
    expect(deleteHarness(db, harness.id)).toBe(false);
  });

  test("records sync outcomes and clears previous errors", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    recordSyncFailure(db, harness.id, "boom ".repeat(500));
    const failed = getHarnessById(db, harness.id);
    expect(failed?.lastError?.length).toBeLessThanOrEqual(1000);

    recordSyncSuccess(db, harness.id, { lastSha: "f".repeat(40), at: "2026-11-19T00:00:00.000Z" });
    const success = getHarnessById(db, harness.id);
    expect(success?.lastError).toBeNull();
    expect(success?.lastSha).toBe("f".repeat(40));
    expect(success?.lastSuccessAt).toBe("2026-11-19T00:00:00.000Z");
  });

  test("tracks attempt start separately from attempt finish", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    expect(harness.lastAttemptAt).toBeNull();
    expect(harness.lastSyncAt).toBeNull();

    recordSyncStart(db, harness.id, { at: "2026-11-19T00:00:00.000Z" });
    const running = getHarnessById(db, harness.id);
    // The attempt is visible immediately...
    expect(running?.lastAttemptAt).toBe("2026-11-19T00:00:00.000Z");
    // ...but finishing timestamps stay untouched until the run ends.
    expect(running?.lastSyncAt).toBeNull();
    expect(running?.lastSuccessAt).toBeNull();

    recordSyncFailure(db, harness.id, "boom", { at: "2026-11-19T00:05:00.000Z" });
    const failed = getHarnessById(db, harness.id);
    expect(failed?.lastSyncAt).toBe("2026-11-19T00:05:00.000Z");
    expect(failed?.lastSuccessAt).toBeNull();

    recordSyncSuccess(db, harness.id, { at: "2026-11-19T00:10:00.000Z" });
    const done = getHarnessById(db, harness.id);
    expect(done?.lastSyncAt).toBe("2026-11-19T00:10:00.000Z");
    expect(done?.lastSuccessAt).toBe("2026-11-19T00:10:00.000Z");
  });
});

describe("commit repository", () => {
  function seeded() {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const other = createHarness(db, {
      slug: "codex",
      name: "Codex",
      repoUrl: "https://github.com/b/codex",
    }).harness;
    return { db, harnessId: harness.id, otherId: other.id };
  }

  test("upserts commits idempotently and reports inserts", () => {
    const { db, harnessId } = seeded();
    const first = upsertCommits(db, harnessId, [
      commit("a", "2026-11-19"),
      commit("b", "2026-11-18"),
    ]);
    expect(first.inserted).toBe(2);
    const second = upsertCommits(db, harnessId, [
      { ...commit("a", "2026-11-19"), subject: "changed" },
      commit("c", "2026-11-17"),
    ]);
    expect(second.inserted).toBe(1);
    expect(countAllCommits(db, harnessId)).toBe(3);
    expect(getCommitBySha(db, harnessId, "a".repeat(40))?.subject).toBe("changed");
  });

  test("filters, paginates and counts commits", () => {
    const { db, harnessId, otherId } = seeded();
    upsertCommits(db, harnessId, [
      commit("a", "2026-11-19", "feat: add MCP"),
      commit("b", "2026-11-18", "fix: crash"),
      commit("c", "2026-11-17", "docs: readme"),
    ]);
    upsertCommits(db, otherId, [commit("d", "2026-11-19", "feat: other")]);

    const ids = listCommits(db, { harnessId }).map((entry) => entry.sha);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("a".repeat(40));

    const byDay = listCommits(db, { harnessId, fromDay: "2026-11-18", toDay: "2026-11-18" });
    expect(byDay.map((entry) => entry.sha)).toEqual(["b".repeat(40)]);

    const searched = listCommits(db, { search: "MCP" });
    expect(searched).toHaveLength(1);

    const page = listCommits(db, { harnessId, limit: 1, offset: 1 });
    expect(page.map((entry) => entry.sha)).toEqual(["b".repeat(40)]);

    // Categorisation happens on analysis; set it up to test category filters.
    const target = listCommits(db, { search: "MCP" })[0];
    updateCommitAnalysis(db, target.id, {
      category: "feature",
      rating: 4,
      ratingReason: "reason",
      summaryMd: "summary",
      featureTags: ["mcp"],
      analyzedBy: "heuristic",
    });
    expect(countCommits(db, { category: "feature" })).toBe(1);
    expect(countCommits(db, { rating: 4 })).toBe(1);
    expect(countCommits(db, { unanalyzed: true })).toBe(3);
    expect(countCommits(db, { search: "no-such-thing" })).toBe(0);
    expect(listCommitsForAnalysis(db, harnessId, 10)).toHaveLength(2);

    expect(countByCategory(db)).toEqual({ feature: 1 });
    expect(
      countCommitsByDay(db, { harnessId, fromDay: "2026-11-01", toDay: "2026-11-30" }),
    ).toEqual([
      { day: "2026-11-17", count: 1 },
      { day: "2026-11-18", count: 1 },
      { day: "2026-11-19", count: 1 },
    ]);
    expect(countCommitsSince(db, harnessId, "2026-11-18")).toBe(2);
    expect(latestCommits(db, 2).map((entry) => entry.day)).toEqual(["2026-11-19", "2026-11-19"]);
  });

  test("stores deep stats and file lists", () => {
    const { db, harnessId } = seeded();
    upsertCommits(db, harnessId, [commit("a", "2026-11-19")]);
    const stored = getCommitBySha(db, harnessId, "a".repeat(40));
    expect(stored).not.toBeNull();
    setCommitStats(db, stored!.id, {
      insertions: 30,
      deletions: 4,
      files: [
        { path: "src/a.ts", additions: 20, deletions: 2, status: "M" },
        { path: "src/b.ts", additions: 10, deletions: 2, status: "A" },
      ],
      diffPath: "diffs/pi/a.patch",
    });
    const updated = getCommitBySha(db, harnessId, "a".repeat(40));
    expect(updated?.statsComplete).toBe(true);
    expect(updated?.insertions).toBe(30);
    expect(updated?.filesChanged).toBe(2);
    expect(updated?.diffPath).toBe("diffs/pi/a.patch");

    const files = listCommitFiles(db, stored!.id);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("daily repository", () => {
  test("rebuilds per-harness daily reports", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    upsertCommits(db, harness.id, [commit("a", "2026-11-19"), commit("b", "2026-11-19")]);
    const report = rebuildDailyReport(db, harness.id, "2026-11-19");
    expect(report.commitCount).toBe(2);
    expect(JSON.parse(report.categoryCounts)).toEqual({ other: 2 });

    setDailySummary(db, harness.id, "2026-11-19", "## Summary");
    expect(getDailyReport(db, harness.id, "2026-11-19")?.summaryMd).toBe("## Summary");
    expect(getDailyReport(db, harness.id, "2026-11-20")).toBeNull();
    expect(listAvailableDays(db)).toEqual(["2026-11-19"]);
    expect(listDailyDaySummaries(db)).toEqual([
      { day: "2026-11-19", commitCount: 2, harnessCount: 1 },
    ]);
  });
});

describe("release repository", () => {
  test("upserts releases without duplicating tags", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    expect(upsertReleases(db, harness.id, [])).toEqual({ inserted: 0 });
    expect(
      upsertReleases(db, harness.id, [
        { tag: "v1.0.0", name: "One", publishedAt: "2026-11-01T00:00:00Z" },
        { tag: "v1.1.0" },
      ]),
    ).toEqual({ inserted: 2 });
    expect(upsertReleases(db, harness.id, [{ tag: "v1.0.0", name: "One updated" }])).toEqual({
      inserted: 0,
    });
    expect(listReleases(db, harness.id)).toHaveLength(2);
    // The third upsert blanked published_at, so ordering falls back to id DESC.
    expect(listReleases(db)[0].tag).toBe("v1.1.0");
    expect(countReleases(db, harness.id)).toBe(2);
  });
});

describe("sync run repository", () => {
  test("tracks a run lifecycle and prevents concurrent runs", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const run = startSyncRun(db, harness.id, "manual");
    expect(run?.status).toBe("running");
    expect(startSyncRun(db, harness.id, "manual")).toBeNull();
    expect(getRunningSyncRun(db, harness.id)?.id).toBe(run?.id);

    updateSyncRunPhase(db, run!.id, "ingest", { newCommits: 3 });
    finishSyncRun(db, run!.id, "success", { newCommits: 3, newReleases: 1 });
    expect(getRunningSyncRun(db, harness.id)).toBeNull();

    const runs = listSyncRuns(db, harness.id);
    expect(runs[0].phase).toBe("done");
    expect(runs[0].newCommits).toBe(3);
    expect(runs[0].newReleases).toBe(1);
    expect(runs[0].finishedAt).not.toBeNull();
  });

  test("fails stale running runs", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const run = startSyncRun(db, harness.id, "schedule");
    const staleAt = "2020-01-01T00:00:00.000Z";
    db.prepare("UPDATE sync_runs SET started_at = ?, heartbeat_at = ? WHERE id = ?").run(
      staleAt,
      staleAt,
      run!.id,
    );
    expect(failStaleRuns(db)).toBe(1);
    expect(listSyncRuns(db, harness.id)[0].status).toBe("failed");
    expect(failStaleRuns(db)).toBe(0);
  });

  test("a fresh heartbeat protects a long-running run from stale cleanup", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const run = startSyncRun(db, harness.id, "schedule")!;
    db.prepare("UPDATE sync_runs SET started_at = ? WHERE id = ?").run(
      "2020-01-01T00:00:00.000Z",
      run.id,
    );
    touchSyncRun(db, run.id);
    expect(failStaleRuns(db)).toBe(0);
    finishSyncRun(db, run.id, "success");
  });

  test("reads individual and active runs by id", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const first = startSyncRun(db, harness.id, "manual")!;
    expect(getSyncRun(db, first.id)?.status).toBe("running");
    expect(listRunningSyncRuns(db).map((run) => run.id)).toEqual([first.id]);
    expect(getSyncRunsByIds(db, [first.id, 9999])).toHaveLength(1);

    expect(getSyncRun(db, first.id)?.heartbeatAt).not.toBeNull();
    finishSyncRun(db, first.id, "success");
    expect(getSyncRun(db, first.id)?.finishedAt).not.toBeNull();
    expect(listRunningSyncRuns(db)).toEqual([]);
    expect(getSyncRunsByIds(db, [])).toEqual([]);
  });
});

describe("candidate repository", () => {
  test("creates candidates once while pending and tracks checks", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    const other = createHarness(db, {
      slug: "codex",
      name: "Codex",
      repoUrl: "https://github.com/b/codex",
    }).harness;
    const candidate = createCandidate(db, {
      harnessId: harness.id,
      name: "Subagents",
      description: "Delegate work",
      moduleKey: "multi-agent",
      createdDay: "2026-11-19",
      confidence: 0.7,
    });
    expect(candidate.status).toBe("pending");

    const duplicate = createCandidate(db, {
      harnessId: harness.id,
      name: "Subagents",
      createdDay: "2026-11-19",
    });
    expect(duplicate.id).toBe(candidate.id);
    expect(listCandidates(db, "pending")).toHaveLength(1);
    expect(countOpenCandidates(db)).toBe(1);
    expect(countOpenCandidates(db, harness.id)).toBe(1);

    upsertCandidateCheck(db, {
      candidateId: candidate.id,
      harnessId: other.id,
      status: "yes",
      evidence: "abc",
      note: "note",
    });
    upsertCandidateCheck(db, {
      candidateId: candidate.id,
      harnessId: other.id,
      status: "partial",
      evidence: null,
      note: "updated",
    });
    const checks = listCandidateChecks(db, candidate.id);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("partial");
    expect(checks[0].note).toBe("updated");

    updateCandidateStatus(db, candidate.id, "accepted", "2026-11-20");
    expect(getCandidate(db, candidate.id)?.status).toBe("accepted");
    expect(countOpenCandidates(db)).toBe(0);
    // After review a new pending candidate with the same name can be created.
    expect(
      createCandidate(db, { harnessId: harness.id, name: "Subagents", createdDay: "2026-11-21" })
        .id,
    ).not.toBe(candidate.id);
  });

  test("does not resurface a reviewed candidate when its commit is re-analyzed", () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "pi",
      name: "Pi",
      repoUrl: "https://github.com/a/pi",
    });
    upsertCommits(db, harness.id, [commit("a", "2026-11-19"), commit("b", "2026-11-19")]);
    const firstCommit = getCommitBySha(db, harness.id, "a".repeat(40))!;
    const secondCommit = getCommitBySha(db, harness.id, "b".repeat(40))!;

    const candidate = createCandidate(db, {
      harnessId: harness.id,
      commitId: firstCommit.id,
      name: "Skills",
      createdDay: "2026-11-19",
    });
    updateCandidateStatus(db, candidate.id, "rejected", "2026-11-20");

    // Re-analyzing the same commit returns the reviewed candidate untouched.
    const again = createCandidate(db, {
      harnessId: harness.id,
      commitId: firstCommit.id,
      name: "Skills",
      createdDay: "2026-11-21",
    });
    expect(again.id).toBe(candidate.id);
    expect(again.status).toBe("rejected");
    expect(listCandidates(db, "pending")).toHaveLength(0);

    // The same feature name from a different commit is a new signal.
    const fresh = createCandidate(db, {
      harnessId: harness.id,
      commitId: secondCommit.id,
      name: "Skills",
      createdDay: "2026-11-21",
    });
    expect(fresh.id).not.toBe(candidate.id);
    expect(fresh.status).toBe("pending");
  });
});

describe("settings repository", () => {
  test("stores, reads and serialises settings", () => {
    const db = makeDb();
    expect(getSetting(db, "missing")).toBeNull();
    setSetting(db, "aiEnabled", "true");
    setSetting(db, "aiEnabled", "false");
    expect(getSetting(db, "aiEnabled")).toBe("false");
    expect(getAllSettings(db)).toEqual({ aiEnabled: "false" });

    setJsonSetting(db, "tags", ["a", "b"]);
    expect(getJsonSetting<string[]>(db, "tags", [])).toEqual(["a", "b"]);

    setSetting(db, "broken", "{not json");
    expect(getJsonSetting(db, "broken", { fallback: true })).toEqual({ fallback: true });
  });
});
