import type { Commit, CommitCategory, CommitFile } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface CommitRow {
  id: number;
  harness_id: number;
  sha: string;
  committer_date: string;
  day: string;
  author: string;
  subject: string;
  body: string | null;
  url: string | null;
  category: CommitCategory | null;
  rating: number | null;
  rating_reason: string | null;
  summary_md: string | null;
  feature_tags: string | null;
  files_changed: number;
  insertions: number;
  deletions: number;
  diff_path: string | null;
  stats_complete: number;
  analyzed_by: string | null;
  analyzed_at: string | null;
}

function mapCommit(row: CommitRow): Commit {
  return {
    id: row.id,
    harnessId: row.harness_id,
    sha: row.sha,
    committerDate: row.committer_date,
    day: row.day,
    author: row.author,
    subject: row.subject,
    body: row.body,
    url: row.url,
    category: row.category,
    rating: row.rating,
    ratingReason: row.rating_reason,
    summaryMd: row.summary_md,
    featureTags: row.feature_tags,
    filesChanged: row.files_changed,
    insertions: row.insertions,
    deletions: row.deletions,
    diffPath: row.diff_path,
    statsComplete: row.stats_complete === 1,
    analyzedBy: row.analyzed_by,
    analyzedAt: row.analyzed_at,
  };
}

export interface CommitInput {
  sha: string;
  committerDate: string;
  day: string;
  author: string;
  subject: string;
  body?: string | null;
  url?: string | null;
  filesChanged?: number;
}

export function upsertCommits(
  db: Db = getDb(),
  harnessId: number,
  commits: CommitInput[],
): { inserted: number } {
  if (commits.length === 0) return { inserted: 0 };

  const existing = new Set<string>();
  const findExisting = db.prepare(
    "SELECT 1 AS present FROM commits WHERE harness_id = ? AND sha = ?",
  );
  for (const commit of commits) {
    if (findExisting.get(harnessId, commit.sha)) existing.add(commit.sha);
  }

  const insert = db.prepare(
    `INSERT INTO commits
       (harness_id, sha, committer_date, day, author, subject, body, url, files_changed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(harness_id, sha) DO UPDATE SET
       committer_date = excluded.committer_date,
       day = excluded.day,
       author = excluded.author,
       subject = excluded.subject,
       body = excluded.body,
       url = excluded.url,
       files_changed = excluded.files_changed`,
  );

  const run = db.transaction((items: CommitInput[]) => {
    for (const commit of items) {
      insert.run(
        harnessId,
        commit.sha,
        commit.committerDate,
        commit.day,
        commit.author,
        commit.subject,
        commit.body ?? null,
        commit.url ?? null,
        commit.filesChanged ?? 0,
      );
    }
  });
  run(commits);

  return { inserted: commits.filter((commit) => !existing.has(commit.sha)).length };
}

export function setCommitStats(
  db: Db = getDb(),
  commitId: number,
  stats: {
    insertions: number;
    deletions: number;
    files: Array<{ path: string; additions: number; deletions: number; status?: string | null }>;
    diffPath: string | null;
  },
): void {
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE commits SET insertions = ?, deletions = ?, files_changed = ?,
         diff_path = ?, stats_complete = 1 WHERE id = ?`,
    ).run(stats.insertions, stats.deletions, stats.files.length, stats.diffPath, commitId);
    db.prepare("DELETE FROM commit_files WHERE commit_id = ?").run(commitId);
    const insertFile = db.prepare(
      "INSERT INTO commit_files (commit_id, path, additions, deletions, status) VALUES (?, ?, ?, ?, ?)",
    );
    for (const file of stats.files) {
      insertFile.run(commitId, file.path, file.additions, file.deletions, file.status ?? null);
    }
  });
  run();
}

export interface CommitFilter {
  harnessId?: number;
  category?: CommitCategory;
  rating?: number;
  fromDay?: string;
  toDay?: string;
  search?: string;
  limit?: number;
  offset?: number;
  unanalyzed?: boolean;
}

export function listCommits(db: Db = getDb(), filter: CommitFilter = {}): Commit[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filter.harnessId !== undefined) {
    clauses.push("harness_id = ?");
    params.push(filter.harnessId);
  }
  if (filter.category) {
    clauses.push("category = ?");
    params.push(filter.category);
  }
  if (filter.rating !== undefined) {
    clauses.push("rating = ?");
    params.push(filter.rating);
  }
  if (filter.fromDay) {
    clauses.push("day >= ?");
    params.push(filter.fromDay);
  }
  if (filter.toDay) {
    clauses.push("day <= ?");
    params.push(filter.toDay);
  }
  if (filter.search) {
    clauses.push("(subject LIKE ? OR body LIKE ? OR sha LIKE ?)");
    const pattern = `%${filter.search}%`;
    params.push(pattern, pattern, pattern);
  }
  if (filter.unanalyzed) {
    clauses.push("analyzed_at IS NULL");
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  const rows = db
    .prepare(
      `SELECT * FROM commits ${where}
       ORDER BY committer_date DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CommitRow[];

  return rows.map(mapCommit);
}

export function countCommits(db: Db = getDb(), filter: CommitFilter = {}): number {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filter.harnessId !== undefined) {
    clauses.push("harness_id = ?");
    params.push(filter.harnessId);
  }
  if (filter.category) {
    clauses.push("category = ?");
    params.push(filter.category);
  }
  if (filter.rating !== undefined) {
    clauses.push("rating = ?");
    params.push(filter.rating);
  }
  if (filter.fromDay) {
    clauses.push("day >= ?");
    params.push(filter.fromDay);
  }
  if (filter.toDay) {
    clauses.push("day <= ?");
    params.push(filter.toDay);
  }
  if (filter.search) {
    clauses.push("(subject LIKE ? OR body LIKE ? OR sha LIKE ?)");
    const pattern = `%${filter.search}%`;
    params.push(pattern, pattern, pattern);
  }
  if (filter.unanalyzed) {
    clauses.push("analyzed_at IS NULL");
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) AS count FROM commits ${where}`).get(...params) as {
    count: number;
  };
  return row.count;
}

export function getCommitById(db: Db = getDb(), id: number): Commit | null {
  const row = db.prepare("SELECT * FROM commits WHERE id = ?").get(id) as CommitRow | undefined;
  return row ? mapCommit(row) : null;
}

export function getCommitBySha(db: Db = getDb(), harnessId: number, sha: string): Commit | null {
  const row = db
    .prepare("SELECT * FROM commits WHERE harness_id = ? AND sha = ?")
    .get(harnessId, sha) as CommitRow | undefined;
  return row ? mapCommit(row) : null;
}

export function listCommitFiles(db: Db = getDb(), commitId: number): CommitFile[] {
  const rows = db
    .prepare("SELECT * FROM commit_files WHERE commit_id = ? ORDER BY additions + deletions DESC")
    .all(commitId) as Array<{
    id: number;
    commit_id: number;
    path: string;
    additions: number;
    deletions: number;
    status: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    commitId: row.commit_id,
    path: row.path,
    additions: row.additions,
    deletions: row.deletions,
    status: row.status,
  }));
}

export interface AnalysisUpdate {
  category: CommitCategory;
  rating: number;
  ratingReason: string;
  summaryMd: string;
  featureTags: string[];
  analyzedBy: string;
}

export function updateCommitAnalysis(
  db: Db = getDb(),
  commitId: number,
  update: AnalysisUpdate,
): void {
  db.prepare(
    `UPDATE commits SET category = ?, rating = ?, rating_reason = ?, summary_md = ?,
       feature_tags = ?, analyzed_by = ?, analyzed_at = ? WHERE id = ?`,
  ).run(
    update.category,
    update.rating,
    update.ratingReason,
    update.summaryMd,
    JSON.stringify(update.featureTags),
    update.analyzedBy,
    nowIso(),
    commitId,
  );
}

export function listCommitsForAnalysis(
  db: Db = getDb(),
  harnessId: number,
  limit: number,
): Commit[] {
  const rows = db
    .prepare(
      `SELECT * FROM commits WHERE harness_id = ? AND analyzed_at IS NULL
       ORDER BY committer_date DESC LIMIT ?`,
    )
    .all(harnessId, limit) as CommitRow[];
  return rows.map(mapCommit);
}

export function listCommitsMissingStats(
  db: Db = getDb(),
  harnessId: number,
  limit: number,
): Commit[] {
  const rows = db
    .prepare(
      `SELECT * FROM commits WHERE harness_id = ? AND stats_complete = 0
       ORDER BY committer_date DESC LIMIT ?`,
    )
    .all(harnessId, limit) as CommitRow[];
  return rows.map(mapCommit);
}

export interface DayCount {
  day: string;
  count: number;
}

export function countCommitsByDay(
  db: Db = getDb(),
  options: { harnessId?: number; fromDay: string; toDay: string },
): DayCount[] {
  const params: Array<string | number> = [options.fromDay, options.toDay];
  let sql = "SELECT day, COUNT(*) AS count FROM commits WHERE day >= ? AND day <= ?";
  if (options.harnessId !== undefined) {
    sql += " AND harness_id = ?";
    params.push(options.harnessId);
  }
  sql += " GROUP BY day ORDER BY day";
  const rows = db.prepare(sql).all(...params) as Array<{ day: string; count: number }>;
  return rows;
}

export function countByCategory(
  db: Db = getDb(),
  options: { harnessId?: number; fromDay?: string } = {},
): Record<string, number> {
  const clauses: string[] = ["category IS NOT NULL"];
  const params: Array<string | number> = [];
  if (options.harnessId !== undefined) {
    clauses.push("harness_id = ?");
    params.push(options.harnessId);
  }
  if (options.fromDay) {
    clauses.push("day >= ?");
    params.push(options.fromDay);
  }
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM commits
       WHERE ${clauses.join(" AND ")} GROUP BY category`,
    )
    .all(...params) as Array<{ category: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.category, row.count]));
}

export function latestCommits(db: Db = getDb(), limit = 8): Commit[] {
  const rows = db
    .prepare("SELECT * FROM commits ORDER BY committer_date DESC, id DESC LIMIT ?")
    .all(limit) as CommitRow[];
  return rows.map(mapCommit);
}

export function countCommitsSince(db: Db = getDb(), harnessId: number, fromDay: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM commits WHERE harness_id = ? AND day >= ?")
    .get(harnessId, fromDay) as { count: number };
  return row.count;
}

export function countAllCommits(db: Db = getDb(), harnessId?: number): number {
  const row =
    harnessId === undefined
      ? (db.prepare("SELECT COUNT(*) AS count FROM commits").get() as { count: number })
      : (db
          .prepare("SELECT COUNT(*) AS count FROM commits WHERE harness_id = ?")
          .get(harnessId) as { count: number });
  return row.count;
}
