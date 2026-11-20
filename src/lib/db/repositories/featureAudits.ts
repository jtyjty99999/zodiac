import type { FeatureAudit, FeatureAuditEngine, FeatureAuditStatus } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface FeatureAuditRow {
  id: number;
  feature_id: number;
  status: FeatureAuditStatus;
  engine: FeatureAuditEngine;
  version: string | null;
  result_json: string | null;
  report_md: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const RUNNING = "running";
const STALE_MINUTES = 15;

function mapAudit(row: FeatureAuditRow): FeatureAudit {
  return {
    id: row.id,
    featureId: row.feature_id,
    status: row.status,
    engine: row.engine,
    version: row.version,
    resultJson: row.result_json,
    reportMd: row.report_md,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function createFeatureAudit(
  db: Db = getDb(),
  input: { featureId: number; engine: FeatureAuditEngine },
): FeatureAudit {
  const result = db
    .prepare(
      `INSERT INTO feature_audits (feature_id, status, engine, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.featureId, RUNNING, input.engine, nowIso());

  const row = db
    .prepare("SELECT * FROM feature_audits WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as FeatureAuditRow;
  return mapAudit(row);
}

export function getFeatureAudit(db: Db = getDb(), id: number): FeatureAudit | null {
  const row = db.prepare("SELECT * FROM feature_audits WHERE id = ?").get(id) as
    | FeatureAuditRow
    | undefined;
  return row ? mapAudit(row) : null;
}

export function latestFeatureAudit(db: Db = getDb(), featureId: number): FeatureAudit | null {
  const row = db
    .prepare(
      "SELECT * FROM feature_audits WHERE feature_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(featureId) as FeatureAuditRow | undefined;
  return row ? mapAudit(row) : null;
}

export function findRunningFeatureAudit(db: Db = getDb()): FeatureAudit | null {
  const row = db
    .prepare("SELECT * FROM feature_audits WHERE status = ? ORDER BY created_at ASC LIMIT 1")
    .get(RUNNING) as FeatureAuditRow | undefined;
  return row ? mapAudit(row) : null;
}

export interface FinishFeatureAuditInput {
  status: Exclude<FeatureAuditStatus, "running">;
  engine?: FeatureAuditEngine;
  version?: string | null;
  resultJson?: string | null;
  reportMd?: string | null;
  error?: string | null;
}

export function finishFeatureAudit(
  db: Db = getDb(),
  id: number,
  input: FinishFeatureAuditInput,
): FeatureAudit | null {
  db.prepare(
    `UPDATE feature_audits SET
       status = ?, engine = COALESCE(?, engine), version = ?,
       result_json = ?, report_md = ?, error = ?, finished_at = ?
     WHERE id = ? AND status = ?`,
  ).run(
    input.status,
    input.engine ?? null,
    input.version ?? null,
    input.resultJson ?? null,
    input.reportMd ?? null,
    input.error ?? null,
    nowIso(),
    id,
    RUNNING,
  );
  return getFeatureAudit(db, id);
}

/**
 * Reclaims audit rows orphaned by a restart. Audits running in this process
 * are exempt. Returns the number of rows failed.
 */
export function failStaleFeatureAudits(
  db: Db = getDb(),
  activeIds: number[] = [],
  olderThanMinutes = STALE_MINUTES,
): number {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const rows = db
    .prepare("SELECT id FROM feature_audits WHERE status = ? AND created_at < ?")
    .all(RUNNING, cutoff) as Array<{ id: number }>;
  const active = new Set(activeIds);
  let failed = 0;
  for (const row of rows) {
    if (active.has(row.id)) continue;
    const result = db
      .prepare(
        `UPDATE feature_audits SET status = 'failed', error = ?, finished_at = ?
         WHERE id = ? AND status = ?`,
      )
      .run("Aborted: the audit process exited", nowIso(), row.id, RUNNING);
    failed += result.changes;
  }
  return failed;
}
