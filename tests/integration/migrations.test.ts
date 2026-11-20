import { describe, expect, test } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { listAppliedMigrations, migrate, readUserVersion } from "@/lib/db/migrate";
import { MIGRATIONS } from "@/lib/db/schema";

const EXPECTED_TABLES = [
  "harnesses",
  "sync_runs",
  "releases",
  "commits",
  "commit_files",
  "daily_reports",
  "feature_modules",
  "features",
  "feature_support",
  "feature_details",
  "feature_history",
  "catalog_versions",
  "candidates",
  "candidate_checks",
  "settings",
  "explorations",
  "feature_audits",
];

describe("migrate", () => {
  test("applies every migration and records it", () => {
    const db = openDatabase(":memory:");
    const latest = Math.max(...MIGRATIONS.map((migration) => migration.version));
    expect(migrate(db)).toBe(latest);
    expect(readUserVersion(db)).toBe(latest);
    expect(listAppliedMigrations(db)).toHaveLength(MIGRATIONS.length);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  test("is idempotent", () => {
    const db = openDatabase(":memory:");
    const first = migrate(db);
    const second = migrate(db);
    expect(second).toBe(first);
    expect(listAppliedMigrations(db)).toHaveLength(MIGRATIONS.length);
  });

  test("enables foreign keys on app connections", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      db
        .prepare(
          "INSERT INTO commits (harness_id, sha, committer_date, day, author, subject) VALUES (999, 'x', 'x', 'x', 'x', 'x')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  test("enforces a single running sync run per harness", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const harnessId = Number(
      db
        .prepare(
          "INSERT INTO harnesses (slug, name, repo_url, created_at, updated_at) VALUES ('a', 'A', 'https://github.com/a/b', 'x', 'x')",
        )
        .run().lastInsertRowid,
    );
    const insert = db.prepare(
      "INSERT INTO sync_runs (harness_id, trigger, status, started_at) VALUES (?, 'manual', 'running', 'x')",
    );
    insert.run(harnessId);
    expect(() => insert.run(harnessId)).toThrow(/UNIQUE constraint failed/);
  });
});
