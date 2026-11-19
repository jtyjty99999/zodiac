import type { Release } from "../../types";
import { type Db, getDb } from "../client";

interface ReleaseRow {
  id: number;
  harness_id: number;
  tag: string;
  name: string | null;
  url: string | null;
  published_at: string | null;
  body: string | null;
}

function mapRelease(row: ReleaseRow): Release {
  return {
    id: row.id,
    harnessId: row.harness_id,
    tag: row.tag,
    name: row.name,
    url: row.url,
    publishedAt: row.published_at,
    body: row.body,
  };
}

export interface ReleaseInput {
  tag: string;
  name?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  body?: string | null;
}

export function upsertReleases(
  db: Db = getDb(),
  harnessId: number,
  releases: ReleaseInput[],
): { inserted: number } {
  if (releases.length === 0) return { inserted: 0 };

  const findExisting = db.prepare(
    "SELECT 1 AS present FROM releases WHERE harness_id = ? AND tag = ?",
  );
  let inserted = 0;

  const insert = db.prepare(
    `INSERT INTO releases (harness_id, tag, name, url, published_at, body)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(harness_id, tag) DO UPDATE SET
       name = excluded.name,
       url = excluded.url,
       published_at = excluded.published_at,
       body = excluded.body`,
  );

  const run = db.transaction((items: ReleaseInput[]) => {
    for (const release of items) {
      if (!findExisting.get(harnessId, release.tag)) inserted += 1;
      insert.run(
        harnessId,
        release.tag,
        release.name ?? null,
        release.url ?? null,
        release.publishedAt ?? null,
        release.body ?? null,
      );
    }
  });
  run(releases);

  return { inserted };
}

export function listReleases(db: Db = getDb(), harnessId?: number, limit = 50): Release[] {
  const rows =
    harnessId === undefined
      ? (db
          .prepare("SELECT * FROM releases ORDER BY published_at DESC, id DESC LIMIT ?")
          .all(limit) as ReleaseRow[])
      : (db
          .prepare(
            "SELECT * FROM releases WHERE harness_id = ? ORDER BY published_at DESC, id DESC LIMIT ?",
          )
          .all(harnessId, limit) as ReleaseRow[]);
  return rows.map(mapRelease);
}

export function countReleases(db: Db = getDb(), harnessId?: number): number {
  const row =
    harnessId === undefined
      ? (db.prepare("SELECT COUNT(*) AS count FROM releases").get() as { count: number })
      : (db
          .prepare("SELECT COUNT(*) AS count FROM releases WHERE harness_id = ?")
          .get(harnessId) as { count: number });
  return row.count;
}
