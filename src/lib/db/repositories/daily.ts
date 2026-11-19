import type { DailyReport } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface DailyRow {
  id: number;
  harness_id: number;
  day: string;
  commit_count: number;
  category_counts: string;
  summary_md: string | null;
  created_at: string;
  updated_at: string;
}

function mapDaily(row: DailyRow): DailyReport {
  return {
    id: row.id,
    harnessId: row.harness_id,
    day: row.day,
    commitCount: row.commit_count,
    categoryCounts: row.category_counts,
    summaryMd: row.summary_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rebuildDailyReport(db: Db = getDb(), harnessId: number, day: string): DailyReport {
  const counts = db
    .prepare(
      `SELECT COALESCE(category, 'other') AS category, COUNT(*) AS count
       FROM commits WHERE harness_id = ? AND day = ? GROUP BY category`,
    )
    .all(harnessId, day) as Array<{ category: string; count: number }>;

  const categoryCounts = Object.fromEntries(counts.map((row) => [row.category, row.count]));
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO daily_reports
       (harness_id, day, commit_count, category_counts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(harness_id, day) DO UPDATE SET
       commit_count = excluded.commit_count,
       category_counts = excluded.category_counts,
       updated_at = excluded.updated_at`,
  ).run(harnessId, day, total, JSON.stringify(categoryCounts), timestamp, timestamp);

  const row = db
    .prepare("SELECT * FROM daily_reports WHERE harness_id = ? AND day = ?")
    .get(harnessId, day) as DailyRow;
  return mapDaily(row);
}

export function setDailySummary(
  db: Db = getDb(),
  harnessId: number,
  day: string,
  summaryMd: string,
): void {
  db.prepare(
    `INSERT INTO daily_reports (harness_id, day, commit_count, category_counts, summary_md, created_at, updated_at)
     VALUES (?, ?, 0, '{}', ?, ?, ?)
     ON CONFLICT(harness_id, day) DO UPDATE SET
       summary_md = excluded.summary_md, updated_at = excluded.updated_at`,
  ).run(harnessId, day, summaryMd, nowIso(), nowIso());
}

export function getDailyReports(db: Db = getDb(), day: string): DailyReport[] {
  return (
    db
      .prepare("SELECT * FROM daily_reports WHERE day = ? ORDER BY harness_id")
      .all(day) as DailyRow[]
  ).map(mapDaily);
}

export function getDailyReport(
  db: Db = getDb(),
  harnessId: number,
  day: string,
): DailyReport | null {
  const row = db
    .prepare("SELECT * FROM daily_reports WHERE harness_id = ? AND day = ?")
    .get(harnessId, day) as DailyRow | undefined;
  return row ? mapDaily(row) : null;
}

export function listAvailableDays(db: Db = getDb(), limit = 60): string[] {
  const rows = db
    .prepare(
      `SELECT day, SUM(commit_count) AS total FROM daily_reports
       GROUP BY day ORDER BY day DESC LIMIT ?`,
    )
    .all(limit) as Array<{ day: string; total: number }>;
  return rows.map((row) => row.day);
}

export interface DailyDaySummary {
  day: string;
  commitCount: number;
  harnessCount: number;
}

export function listDailyDaySummaries(db: Db = getDb(), limit = 60): DailyDaySummary[] {
  const rows = db
    .prepare(
      `SELECT day, SUM(commit_count) AS commit_count, COUNT(DISTINCT harness_id) AS harness_count
       FROM daily_reports
       GROUP BY day
       ORDER BY day DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ day: string; commit_count: number; harness_count: number }>;
  return rows.map((row) => ({
    day: row.day,
    commitCount: row.commit_count,
    harnessCount: row.harness_count,
  }));
}
