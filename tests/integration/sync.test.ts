import { describe, expect, test } from "vitest";
import { listCandidates } from "@/lib/db/repositories/candidates";
import { listCommits } from "@/lib/db/repositories/commits";
import { getDailyReport } from "@/lib/db/repositories/daily";
import { createHarness, getHarnessById } from "@/lib/db/repositories/harnesses";
import { listReleases } from "@/lib/db/repositories/releases";
import {
  finishSyncRun,
  getRunningSyncRun,
  listSyncRuns,
  startSyncRun,
} from "@/lib/db/repositories/syncRuns";
import { readDiff } from "@/lib/git/storage";
import { syncHarness } from "@/lib/ingest/sync";
import { appendCommit, createTempRepo, makeDb } from "./helpers";

const demoCommit = {
  subject: "feat: add MCP stdio transport",
  body: "Adds an MCP client over stdio.",
  files: { "src/mcp.ts": "export const client = 1;\n", "README.md": "# demo\n" },
  tag: "v0.1.0",
};

describe("syncHarness", () => {
  test("clones, ingests, analyzes and records a successful run", async () => {
    const repo = createTempRepo([
      demoCommit,
      {
        subject: "fix: crash on missing config",
        files: { "src/config.ts": "export const x = 1;\n" },
      },
      { subject: "perf: cache token counts", files: { "src/tokens.ts": "export const t = 1;\n" } },
    ]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
      backfillDays: 30,
    });

    const report = await syncHarness(db, harness.id, {
      trigger: "cli",
      analyze: true,
      allowLocalRepo: true,
    });

    expect(report.status).toBe("success");
    expect(report.newCommits).toBe(3);
    expect(report.runId).not.toBeNull();

    const stored = getHarnessById(db, harness.id);
    expect(stored?.lastSha).toBe(repo.shas.at(-1));
    expect(stored?.lastSuccessAt).not.toBeNull();
    expect(stored?.lastError).toBeNull();

    const commits = listCommits(db, { harnessId: harness.id });
    expect(commits).toHaveLength(3);

    const [newest] = commits;
    expect(newest.subject).toBe("perf: cache token counts");
    expect(newest.category).toBe("performance");
    expect(newest.rating).not.toBeNull();
    expect(newest.analyzedBy).toBe("heuristic");
    expect(newest.summaryMd).toContain("性能");
    expect(newest.statsComplete).toBe(true);
    expect(newest.insertions).toBeGreaterThan(0);
    expect(readDiff(newest.diffPath)).toContain("src/tokens.ts");

    const daily = getDailyReport(db, harness.id, newest.day);
    expect(daily?.commitCount).toBe(3);

    // The temp repository is not on GitHub, so releases fall back to tags.
    expect(listReleases(db, harness.id).map((release) => release.tag)).toContain("v0.1.0");

    // The feature commit produces a pending candidate.
    const pending = listCandidates(db, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].moduleKey).toBe("mcp");

    const runs = listSyncRuns(db, harness.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].trigger).toBe("cli");
    expect(runs[0].newCommits).toBe(3);
  });

  test("incremental syncs only ingest new commits", async () => {
    const repo = createTempRepo([demoCommit]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
      backfillDays: 30,
    });

    await syncHarness(db, harness.id, { analyze: true, allowLocalRepo: true });
    appendCommit(repo.dir, {
      subject: "feat: add subagent delegation",
      files: { "src/agents.ts": "export const agent = 1;\n" },
    });

    const report = await syncHarness(db, harness.id, { analyze: true, allowLocalRepo: true });
    expect(report.status).toBe("success");
    expect(report.newCommits).toBe(1);

    const commits = listCommits(db, { harnessId: harness.id });
    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toBe("feat: add subagent delegation");
    expect(commits[0].analyzedAt).not.toBeNull();
    expect(listSyncRuns(db, harness.id)).toHaveLength(2);
  });

  test("rejects file URLs unless the local override is enabled", async () => {
    const repo = createTempRepo([demoCommit]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
    });
    const report = await syncHarness(db, harness.id, { analyze: false });
    expect(report.status).toBe("failed");
    expect(report.error).toContain("Invalid repository URL");
    expect(getHarnessById(db, harness.id)?.lastError).toContain("Invalid repository URL");
    expect(listSyncRuns(db, harness.id)[0].status).toBe("failed");
  });

  test("records a failed run when the remote cannot be reached", async () => {
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "broken",
      name: "Broken",
      repoUrl: "file:///nonexistent/zodiac-test-repo",
    });
    const report = await syncHarness(db, harness.id, { analyze: false, allowLocalRepo: true });
    expect(report.status).toBe("failed");
    expect(report.runId).not.toBeNull();
    expect(getRunningSyncRun(db, harness.id)).toBeNull();
    expect(listSyncRuns(db, harness.id)[0].status).toBe("failed");
  });

  test("refuses to start when a run is already in progress", async () => {
    const repo = createTempRepo([demoCommit]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
    });
    const running = startSyncRun(db, harness.id, "manual");
    expect(running).not.toBeNull();

    const report = await syncHarness(db, harness.id, { analyze: false, allowLocalRepo: true });
    expect(report).toEqual({
      status: "already-running",
      harnessId: harness.id,
      runId: null,
      newCommits: 0,
      newReleases: 0,
      analyzed: 0,
      aiUsed: 0,
    });
    finishSyncRun(db, running!.id, "success");
  });

  test("reclaims a stale orphaned run left by an exited process", async () => {
    const repo = createTempRepo([demoCommit]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
    });
    const stale = startSyncRun(db, harness.id, "manual")!;
    const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
    db.prepare("UPDATE sync_runs SET started_at = ?, heartbeat_at = ? WHERE id = ?").run(
      staleAt,
      staleAt,
      stale.id,
    );

    const report = await syncHarness(db, harness.id, { analyze: false, allowLocalRepo: true });
    expect(report.status).toBe("success");

    const runs = listSyncRuns(db, harness.id);
    const reclaimed = runs.find((run) => run.id === stale.id);
    expect(reclaimed?.status).toBe("failed");
    expect(reclaimed?.error).toContain("previous sync process exited");
  });

  test("keeps a long-running run alive while its heartbeat is fresh", async () => {
    const repo = createTempRepo([demoCommit]);
    const db = makeDb();
    const { harness } = createHarness(db, {
      slug: "demo",
      name: "Demo",
      repoUrl: repo.url,
    });
    const run = startSyncRun(db, harness.id, "manual")!;
    // Old start time, but the heartbeat proves the process is still alive.
    db.prepare("UPDATE sync_runs SET started_at = ? WHERE id = ?").run(
      new Date(Date.now() - 10 * 60_000).toISOString(),
      run.id,
    );

    const report = await syncHarness(db, harness.id, { analyze: false, allowLocalRepo: true });
    expect(report.status).toBe("already-running");
    expect(getRunningSyncRun(db, harness.id)?.id).toBe(run.id);
    finishSyncRun(db, run.id, "success");
  });

  test("throws for unknown harnesses", async () => {
    const db = makeDb();
    await expect(syncHarness(db, 999, { analyze: false })).rejects.toThrow(/Harness not found/);
  });
});
