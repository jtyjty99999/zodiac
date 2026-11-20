import fs from "node:fs";
import { analyzeCommits } from "../analysis";
import { crossCheckCandidate } from "../analysis/crossCheck";
import { refreshDailyReport } from "../analysis/daily";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { listCandidateChecks, listCandidates } from "../db/repositories/candidates";
import {
  type CommitInput,
  getCommitBySha,
  listCommitsForAnalysis,
  listCommitsMissingStats,
  setCommitStats,
  upsertCommits,
} from "../db/repositories/commits";
import {
  getHarnessById,
  listHarnesses,
  recordSyncFailure,
  recordSyncStart,
  recordSyncSuccess,
} from "../db/repositories/harnesses";
import { upsertReleases } from "../db/repositories/releases";
import {
  finishSyncRun,
  getRunningSyncRun,
  getSyncRun,
  startSyncRun,
  touchSyncRun,
  updateSyncRunPhase,
} from "../db/repositories/syncRuns";
import { type LoggedCommit, readLog, readNumstat, readPatch } from "../git/log";
import { ensureMirror } from "../git/mirror";
import { fetchReleases, parseGithubRepo } from "../git/releases";
import { readDiff, writeDiff } from "../git/storage";
import type { Harness, SyncRun, SyncTrigger } from "../types";
import { addDays, toDay } from "../utils/time";

export interface SyncOptions {
  trigger?: SyncTrigger;
  analyze?: boolean;
  maxDeep?: number;
  maxAnalyze?: number;
  maxCrossChecks?: number;
  depth?: number;
  /** Test/CLI-only: allow `file://` repository URLs. Never expose to HTTP handlers. */
  allowLocalRepo?: boolean;
}

export interface SyncReport {
  status: "success" | "failed" | "already-running";
  harnessId: number;
  runId: number | null;
  newCommits: number;
  newReleases: number;
  analyzed: number;
  aiUsed: number;
  error?: string;
}

const DEFAULT_DEEP_LIMIT = 50;
const DEFAULT_ANALYZE_LIMIT = 500;
const DEFAULT_CROSS_CHECK_LIMIT = 5;
const LOG_PAGE_SIZE = 2000;
const MAX_LOG_PAGES = 10;

// Run ids currently executing in this process. A "running" row that is not in
// this set may have been left behind by a previous process (crash/restart), so
// it can be reclaimed once its heartbeat goes stale.
const activeRuns = new Set<number>();
// A run is only reclaimed after this long without a heartbeat, which keeps a
// genuinely long (but alive) sync from being mistaken for an orphan.
const ORPHAN_GRACE_MS = 5 * 60_000;
// How often a running sync refreshes its heartbeat while it works.
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface BeginSyncResult {
  status: "started" | "already-running";
  harness: Harness;
  /** The newly created run, or the existing run when one is already active. */
  run: SyncRun | null;
}

function heartbeatAgeMs(run: SyncRun): number {
  const lastSeen = Date.parse(run.heartbeatAt ?? run.startedAt);
  return Number.isFinite(lastSeen) ? Date.now() - lastSeen : Number.POSITIVE_INFINITY;
}

/**
 * Reserves a sync run for a harness without doing any I/O work yet. Callers can
 * return the run id to the client immediately and then execute `runSyncRun`.
 */
export function beginSyncRun(
  db: Db = getDb(),
  harnessId: number,
  trigger: SyncTrigger,
): BeginSyncResult {
  const harness = getHarnessById(db, harnessId);
  if (!harness) throw new Error(`Harness not found: ${harnessId}`);

  const orphan = getRunningSyncRun(db, harnessId);
  if (orphan && !activeRuns.has(orphan.id) && heartbeatAgeMs(orphan) > ORPHAN_GRACE_MS) {
    finishSyncRun(db, orphan.id, "failed", {
      error: "Aborted: the previous sync process exited",
    });
  }

  const run = startSyncRun(db, harnessId, trigger);
  if (!run) {
    return { status: "already-running", harness, run: getRunningSyncRun(db, harnessId) };
  }

  activeRuns.add(run.id);
  return { status: "started", harness, run };
}

/**
 * Reads the commit range newest-first in pages until the backfill cutoff (in
 * the configured timezone) is reached, so a large range is never truncated and
 * `last_sha` never advances past commits that were not ingested.
 */
async function readCommitHistory(
  dir: string,
  branch: string,
  lastSha: string | null,
  cutoffDay: string,
): Promise<LoggedCommit[]> {
  const seen = new Map<string, LoggedCommit>();
  const fromSha = lastSha;
  let toSha: string | null = null;

  for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
    let batch: LoggedCommit[];
    try {
      batch = await readLog(dir, {
        branch,
        fromSha,
        toSha: toSha ?? undefined,
        maxCount: LOG_PAGE_SIZE,
      });
    } catch (error) {
      if (!fromSha) throw error;
      // The previous SHA fell outside the shallow window; restart from the
      // head, still bounded by the backfill cutoff.
      return readCommitHistory(dir, branch, null, cutoffDay);
    }
    if (batch.length === 0) break;

    let reachedCutoff = false;
    for (const commit of batch) {
      if (toDay(commit.committerDate) < cutoffDay) {
        reachedCutoff = true;
        continue;
      }
      seen.set(commit.sha, commit);
    }
    if (reachedCutoff || batch.length < LOG_PAGE_SIZE) break;

    const oldest = batch[batch.length - 1].sha;
    if (oldest === toSha || oldest === fromSha) break;
    toSha = oldest;
  }

  return [...seen.values()];
}

function commitUrl(harness: Harness, sha: string): string | null {
  const repo = parseGithubRepo(harness.repoUrl);
  if (!repo) return null;
  return `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}`;
}

function depthFor(harness: Harness): number {
  const minimum = 200;
  const estimate = harness.backfillDays * 12;
  return Math.min(Math.max(minimum, estimate), 5000);
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/:\/\/[^/\s@]+@/g, "://***@")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 ***")
    .replace(/([?&](?:token|access_token|api_key|apikey|key|password|secret)=)[^&\s]+/gi, "$1***")
    .slice(0, 1500);
}

export async function syncHarness(
  db: Db = getDb(),
  harnessId: number,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const begin = beginSyncRun(db, harnessId, options.trigger ?? "manual");
  if (begin.status === "already-running" || !begin.run) {
    return {
      status: "already-running",
      harnessId,
      runId: null,
      newCommits: 0,
      newReleases: 0,
      analyzed: 0,
      aiUsed: 0,
    };
  }
  return runSyncRun(db, begin.harness, begin.run, options);
}

/**
 * Executes a run reserved by `beginSyncRun`. Splitting reservation from work
 * lets the HTTP layer hand the run id to the client before slow I/O starts.
 */
export async function runSyncRun(
  db: Db,
  harness: Harness,
  run: SyncRun,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const harnessId = harness.id;

  // A queued row can be reclaimed by another process while it waits its turn.
  const current = getSyncRun(db, run.id);
  if (current?.status !== "running") {
    activeRuns.delete(run.id);
    return {
      status: "failed",
      harnessId,
      runId: run.id,
      newCommits: 0,
      newReleases: 0,
      analyzed: 0,
      aiUsed: 0,
      error: "Aborted: the sync run is no longer active",
    };
  }

  activeRuns.add(run.id);
  const heartbeat = setInterval(() => {
    try {
      touchSyncRun(db, run.id);
    } catch (error) {
      console.warn(
        `[zodiac] heartbeat failed for run ${run.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  try {
    // Record the attempt when work actually starts so "last attempt" is not
    // stamped for runs that are still queued, and the scheduler won't
    // retrigger while this one is active.
    recordSyncStart(db, harnessId);
    updateSyncRunPhase(db, run.id, "fetch");
    const mirror = await ensureMirror({
      slug: harness.slug,
      repoUrl: harness.repoUrl,
      branch: harness.branch,
      depth: options.depth ?? depthFor(harness),
      allowLocalRepo: options.allowLocalRepo,
    });

    updateSyncRunPhase(db, run.id, "ingest");
    const cutoffDay = addDays(toDay(new Date()), -harness.backfillDays);
    const logged = await readCommitHistory(mirror.dir, harness.branch, harness.lastSha, cutoffDay);

    const inputs: CommitInput[] = logged.map((commit) => ({
      sha: commit.sha,
      committerDate: commit.committerDate,
      day: toDay(commit.committerDate),
      author: commit.author,
      subject: commit.subject,
      body: commit.body,
      url: commitUrl(harness, commit.sha),
      filesChanged: commit.files.length,
    }));

    const { inserted } = upsertCommits(db, harnessId, inputs);
    const fileStatusBySha = new Map(
      logged.map((commit) => [
        commit.sha,
        new Map(commit.files.map((file) => [file.path, file.status])),
      ]),
    );

    // Deep capture (numstat + patch) for the newest commits lacking stats,
    // including a backlog of older commits so batches over the limit are
    // eventually completed instead of being skipped forever.
    const currentShas = new Set(logged.map((commit) => commit.sha));
    const missingCurrent = logged
      .filter((commit) => {
        const stored = getCommitBySha(db, harnessId, commit.sha);
        return stored && !stored.statsComplete;
      })
      .map((commit) => commit.sha);
    const backlog = listCommitsMissingStats(db, harnessId, DEFAULT_DEEP_LIMIT)
      .map((commit) => commit.sha)
      .filter((sha) => !currentShas.has(sha));
    const deepShas = [...missingCurrent, ...backlog].slice(
      0,
      options.maxDeep ?? DEFAULT_DEEP_LIMIT,
    );

    for (const sha of deepShas) {
      const stored = getCommitBySha(db, harnessId, sha);
      if (!stored) continue;
      try {
        const [numstat, patch] = await Promise.all([
          readNumstat(mirror.dir, sha),
          readPatch(mirror.dir, sha),
        ]);
        const relative = writeDiff(harness.slug, sha, patch.patch);
        const statuses = fileStatusBySha.get(sha);
        setCommitStats(db, stored.id, {
          insertions: numstat.insertions,
          deletions: numstat.deletions,
          files: numstat.files.map((file) => ({
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
            status: statuses?.get(file.path) ?? null,
          })),
          diffPath: relative,
        });
      } catch {
        // Stats are best-effort; analysis can proceed from commit metadata.
      }
    }

    let newReleases = 0;
    try {
      const { releases } = await fetchReleases({
        repoUrl: harness.repoUrl,
        mirrorDir: mirror.dir,
      });
      newReleases = upsertReleases(db, harnessId, releases).inserted;
    } catch {
      // Releases are advisory; failure must not fail the sync run.
    }

    let analyzed = 0;
    let aiUsed = 0;
    if (options.analyze !== false) {
      updateSyncRunPhase(db, run.id, "analyze");
      const pending = listCommitsForAnalysis(
        db,
        harnessId,
        options.maxAnalyze ?? DEFAULT_ANALYZE_LIMIT,
      );
      const result = await analyzeCommits(db, pending, {
        limit: options.maxAnalyze ?? DEFAULT_ANALYZE_LIMIT,
        getDiff: async (commit) => {
          const stored = readDiff(commit.diffPath);
          if (stored !== null) return stored;
          try {
            if (!fs.existsSync(mirror.dir)) return null;
            return (await readPatch(mirror.dir, commit.sha)).patch;
          } catch {
            return null;
          }
        },
      });
      analyzed = result.analyzed;
      aiUsed = result.aiUsed;

      const harnessCount = listHarnesses(db).length;
      const pendingCandidates = listCandidates(db, "pending")
        .filter((candidate) => candidate.harnessId === harnessId)
        .slice(0, options.maxCrossChecks ?? DEFAULT_CROSS_CHECK_LIMIT);
      for (const candidate of pendingCandidates) {
        const checks = listCandidateChecks(db, candidate.id);
        if (checks.length >= harnessCount - 1) continue;
        try {
          await crossCheckCandidate(db, candidate.id);
        } catch {
          // Cross-checking is advisory.
        }
      }
    }

    // Always materialize the day archive, even for metadata-only syncs
    // (`--no-analyze`) and when the analysis budget covered only some commits.
    for (const day of new Set(inputs.map((input) => input.day))) {
      refreshDailyReport(db, harnessId, day);
    }

    recordSyncSuccess(db, harnessId, { lastSha: mirror.headSha });
    updateSyncRunPhase(db, run.id, "finalize", { newCommits: inserted, newReleases });
    finishSyncRun(db, run.id, "success", {
      newCommits: inserted,
      newReleases,
      error: null,
    });

    return {
      status: "success",
      harnessId,
      runId: run.id,
      newCommits: inserted,
      newReleases,
      analyzed,
      aiUsed,
    };
  } catch (error) {
    const message = cleanError(error);
    recordSyncFailure(db, harnessId, message);
    finishSyncRun(db, run.id, "failed", { error: message });
    return {
      status: "failed",
      harnessId,
      runId: run.id,
      newCommits: 0,
      newReleases: 0,
      analyzed: 0,
      aiUsed: 0,
      error: message,
    };
  } finally {
    clearInterval(heartbeat);
    activeRuns.delete(run.id);
  }
}

export async function syncAllHarnesses(
  db: Db = getDb(),
  options: SyncOptions = {},
): Promise<SyncReport[]> {
  const harnesses = listHarnesses(db, { enabledOnly: true });
  const reports: SyncReport[] = [];
  for (const harness of harnesses) {
    reports.push(await syncHarness(db, harness.id, options));
  }
  return reports;
}
