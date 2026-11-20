import type { SyncPhase, SyncRun, SyncStatus, SyncTrigger } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface SyncRunRow {
  id: number;
  harness_id: number;
  trigger: SyncTrigger;
  phase: SyncPhase;
  status: SyncStatus;
  new_commits: number;
  new_releases: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
}

function mapSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    harnessId: row.harness_id,
    trigger: row.trigger,
    phase: row.phase,
    status: row.status,
    newCommits: row.new_commits,
    newReleases: row.new_releases,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    heartbeatAt: row.heartbeat_at,
  };
}

export function startSyncRun(
  db: Db = getDb(),
  harnessId: number,
  trigger: SyncTrigger,
): SyncRun | null {
  try {
    const timestamp = nowIso();
    const result = db
      .prepare(
        "INSERT INTO sync_runs (harness_id, trigger, phase, status, started_at, heartbeat_at) VALUES (?, ?, 'queued', 'running', ?, ?)",
      )
      .run(harnessId, trigger, timestamp, timestamp);
    const row = db
      .prepare("SELECT * FROM sync_runs WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as SyncRunRow;
    return mapSyncRun(row);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export function updateSyncRunPhase(
  db: Db = getDb(),
  runId: number,
  phase: SyncPhase,
  counts: { newCommits?: number; newReleases?: number } = {},
): void {
  db.prepare(
    `UPDATE sync_runs SET phase = ?, heartbeat_at = ?,
       new_commits = COALESCE(?, new_commits),
       new_releases = COALESCE(?, new_releases)
     WHERE id = ?`,
  ).run(phase, nowIso(), counts.newCommits ?? null, counts.newReleases ?? null, runId);
}

/** Refreshes the liveness timestamp of a running row. */
export function touchSyncRun(db: Db = getDb(), runId: number): void {
  db.prepare("UPDATE sync_runs SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(
    nowIso(),
    runId,
  );
}

export function finishSyncRun(
  db: Db = getDb(),
  runId: number,
  status: Exclude<SyncStatus, "running">,
  options: { newCommits?: number; newReleases?: number; error?: string | null } = {},
): void {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE sync_runs SET status = ?, phase = 'done', finished_at = ?, heartbeat_at = ?,
       new_commits = COALESCE(?, new_commits),
       new_releases = COALESCE(?, new_releases),
       error = ?
     WHERE id = ?`,
  ).run(
    status,
    timestamp,
    timestamp,
    options.newCommits ?? null,
    options.newReleases ?? null,
    options.error ? options.error.slice(0, 2000) : null,
    runId,
  );
}

export function getSyncRun(db: Db = getDb(), runId: number): SyncRun | null {
  const row = db.prepare("SELECT * FROM sync_runs WHERE id = ?").get(runId) as
    | SyncRunRow
    | undefined;
  return row ? mapSyncRun(row) : null;
}

export function listRunningSyncRuns(db: Db = getDb()): SyncRun[] {
  const rows = db
    .prepare("SELECT * FROM sync_runs WHERE status = 'running' ORDER BY started_at ASC, id ASC")
    .all() as SyncRunRow[];
  return rows.map(mapSyncRun);
}

/** Fetches specific runs by id (bounded), used by the status endpoint. */
export function getSyncRunsByIds(db: Db = getDb(), ids: number[]): SyncRun[] {
  const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 50);
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM sync_runs WHERE id IN (${placeholders})`)
    .all(...unique) as SyncRunRow[];
  return rows.map(mapSyncRun);
}

export function getRunningSyncRun(db: Db = getDb(), harnessId: number): SyncRun | null {
  const row = db
    .prepare("SELECT * FROM sync_runs WHERE harness_id = ? AND status = 'running' ORDER BY id DESC")
    .get(harnessId) as SyncRunRow | undefined;
  return row ? mapSyncRun(row) : null;
}

export function listSyncRuns(db: Db = getDb(), harnessId?: number, limit = 20): SyncRun[] {
  const rows =
    harnessId === undefined
      ? (db
          .prepare("SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT ?")
          .all(limit) as SyncRunRow[])
      : (db
          .prepare(
            "SELECT * FROM sync_runs WHERE harness_id = ? ORDER BY started_at DESC, id DESC LIMIT ?",
          )
          .all(harnessId, limit) as SyncRunRow[]);
  return rows.map(mapSyncRun);
}

export function failStaleRuns(db: Db = getDb(), olderThanMinutes = 30): number {
  const now = new Date();
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
  const result = db
    .prepare(
      `UPDATE sync_runs SET status = 'failed', phase = 'done', finished_at = ?, heartbeat_at = ?,
         error = COALESCE(error, 'Aborted: stale running sync')
       WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ?`,
    )
    .run(now.toISOString(), now.toISOString(), cutoff);
  return result.changes;
}
