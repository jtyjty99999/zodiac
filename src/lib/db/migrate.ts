import type { Db } from "./client";
import { MIGRATIONS } from "./schema";

export function migrate(db: Db, now = new Date()): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const current = readUserVersion(db);
  let applied = current;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, now.toISOString());
    });
    apply();

    // PRAGMA cannot be parameterized; the value comes from our own constant list.
    db.pragma(`user_version = ${migration.version}`);
    applied = migration.version;
  }

  return applied;
}

export function readUserVersion(db: Db): number {
  const value = db.pragma("user_version", { simple: true });
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function listAppliedMigrations(
  db: Db,
): Array<{ version: number; name: string; appliedAt: string }> {
  const rows = db
    .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string; applied_at: string }>;
  return rows.map((row) => ({
    version: row.version,
    name: row.name,
    appliedAt: row.applied_at,
  }));
}
