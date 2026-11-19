import type { Harness, ScheduleMode } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface HarnessRow {
  id: number;
  slug: string;
  name: string;
  repo_url: string;
  branch: string;
  local_path: string | null;
  sort_order: number;
  enabled: number;
  schedule_mode: ScheduleMode;
  daily_time: string;
  backfill_days: number;
  baseline_sha: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_sha: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function mapHarness(row: HarnessRow): Harness {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    repoUrl: row.repo_url,
    branch: row.branch,
    localPath: row.local_path,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    scheduleMode: row.schedule_mode,
    dailyTime: row.daily_time,
    backfillDays: row.backfill_days,
    baselineSha: row.baseline_sha,
    lastSyncAt: row.last_sync_at,
    lastSuccessAt: row.last_success_at,
    lastSha: row.last_sha,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface HarnessInput {
  slug: string;
  name: string;
  repoUrl: string;
  branch?: string;
  sortOrder?: number;
  enabled?: boolean;
  scheduleMode?: ScheduleMode;
  dailyTime?: string;
  backfillDays?: number;
}

export type HarnessPatch = Partial<Omit<HarnessInput, "slug">> & { baselineSha?: string | null };

export function listHarnesses(
  db: Db = getDb(),
  options: { enabledOnly?: boolean } = {},
): Harness[] {
  const sql = options.enabledOnly
    ? "SELECT * FROM harnesses WHERE enabled = 1 ORDER BY sort_order, id"
    : "SELECT * FROM harnesses ORDER BY sort_order, id";
  return (db.prepare(sql).all() as HarnessRow[]).map(mapHarness);
}

export function getHarnessById(db: Db = getDb(), id: number): Harness | null {
  const row = db.prepare("SELECT * FROM harnesses WHERE id = ?").get(id) as HarnessRow | undefined;
  return row ? mapHarness(row) : null;
}

export function getHarnessBySlug(db: Db = getDb(), slug: string): Harness | null {
  const row = db.prepare("SELECT * FROM harnesses WHERE slug = ?").get(slug) as
    | HarnessRow
    | undefined;
  return row ? mapHarness(row) : null;
}

export interface CreateHarnessResult {
  harness: Harness;
  created: boolean;
}

export function createHarness(db: Db = getDb(), input: HarnessInput): CreateHarnessResult {
  const existing = getHarnessBySlug(db, input.slug);
  if (existing) return { harness: existing, created: false };

  const timestamp = nowIso();
  const result = db
    .prepare(
      `INSERT INTO harnesses
        (slug, name, repo_url, branch, sort_order, enabled, schedule_mode, daily_time,
         backfill_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.slug,
      input.name,
      input.repoUrl,
      input.branch ?? "main",
      input.sortOrder ?? 100,
      input.enabled === false ? 0 : 1,
      input.scheduleMode ?? "daily",
      input.dailyTime ?? "09:17",
      input.backfillDays ?? 30,
      timestamp,
      timestamp,
    );

  const harness = getHarnessById(db, Number(result.lastInsertRowid));
  if (!harness) throw new Error("Failed to create harness");
  return { harness, created: true };
}

export function updateHarness(db: Db = getDb(), id: number, patch: HarnessPatch): Harness | null {
  const current = getHarnessById(db, id);
  if (!current) return null;

  const next = {
    name: patch.name ?? current.name,
    repoUrl: patch.repoUrl ?? current.repoUrl,
    branch: patch.branch ?? current.branch,
    sortOrder: patch.sortOrder ?? current.sortOrder,
    enabled: patch.enabled ?? current.enabled,
    scheduleMode: patch.scheduleMode ?? current.scheduleMode,
    dailyTime: patch.dailyTime ?? current.dailyTime,
    backfillDays: patch.backfillDays ?? current.backfillDays,
    baselineSha: patch.baselineSha === undefined ? current.baselineSha : patch.baselineSha,
  };

  db.prepare(
    `UPDATE harnesses SET
       name = ?, repo_url = ?, branch = ?, sort_order = ?, enabled = ?,
       schedule_mode = ?, daily_time = ?, backfill_days = ?, baseline_sha = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.name,
    next.repoUrl,
    next.branch,
    next.sortOrder,
    next.enabled ? 1 : 0,
    next.scheduleMode,
    next.dailyTime,
    next.backfillDays,
    next.baselineSha,
    nowIso(),
    id,
  );

  return getHarnessById(db, id);
}

export function deleteHarness(db: Db = getDb(), id: number): boolean {
  const result = db.prepare("DELETE FROM harnesses WHERE id = ?").run(id);
  return result.changes > 0;
}

export function recordSyncStart(
  db: Db = getDb(),
  id: number,
  options: { lastSyncAt?: string } = {},
): void {
  const timestamp = options.lastSyncAt ?? nowIso();
  db.prepare(
    "UPDATE harnesses SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?",
  ).run(timestamp, timestamp, id);
}

export function recordSyncSuccess(
  db: Db = getDb(),
  id: number,
  options: { lastSha?: string | null; at?: string } = {},
): void {
  const timestamp = options.at ?? nowIso();
  db.prepare(
    `UPDATE harnesses SET last_success_at = ?, last_sha = COALESCE(?, last_sha),
       last_error = NULL, updated_at = ? WHERE id = ?`,
  ).run(timestamp, options.lastSha ?? null, timestamp, id);
}

export function recordSyncFailure(db: Db = getDb(), id: number, error: string): void {
  const timestamp = nowIso();
  db.prepare("UPDATE harnesses SET last_error = ?, updated_at = ? WHERE id = ?").run(
    error.slice(0, 1000),
    timestamp,
    id,
  );
}
