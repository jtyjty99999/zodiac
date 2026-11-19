import { type Db, getDb } from "../db/client";
import {
  type CatalogSnapshot,
  createCatalogVersion,
  exportCatalogSnapshot,
  listCatalogVersions,
} from "../db/repositories/catalog";
import { listHarnesses } from "../db/repositories/harnesses";
import { toDay } from "../utils/time";

export interface CatalogChangeInput {
  note: string;
  now?: Date;
}

export interface CatalogChangeResult {
  version: string;
  snapshot: CatalogSnapshot;
}

export function buildHarnessShas(db: Db = getDb()): Record<string, string | null> {
  return Object.fromEntries(
    listHarnesses(db).map((harness) => [harness.slug, harness.lastSha ?? harness.baselineSha]),
  );
}

export function nextCatalogVersion(db: Db, day: string): string {
  const versions = listCatalogVersions(db, 500).map((entry) => entry.version);
  const sameDay = versions.filter((version) => version === day || version.startsWith(`${day}-`));
  if (sameDay.length === 0) return day;

  const maxSuffix = sameDay.reduce((max, version) => {
    if (version === day) return Math.max(max, 1);
    const suffix = Number(version.slice(day.length + 1));
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 1);

  return `${day}-${maxSuffix + 1}`;
}

/**
 * Snapshot the catalog and record a dated version entry. The catalog version is
 * the user-visible "baseline updated on" marker.
 */
export function commitCatalogChange(
  db: Db = getDb(),
  input: CatalogChangeInput,
): CatalogChangeResult {
  const now = input.now ?? new Date();
  const day = toDay(now);

  // Allocate the version and write the snapshot atomically so concurrent
  // writers cannot claim the same date suffix, and a crash cannot leave a
  // catalog change without its dated version record.
  const run = db.transaction(() => {
    const version = nextCatalogVersion(db, day);
    const snapshot = exportCatalogSnapshot(db);
    const entry = createCatalogVersion(db, {
      version,
      note: input.note,
      harnessShas: JSON.stringify(buildHarnessShas(db)),
      snapshotJson: JSON.stringify(snapshot),
    });
    return { version: entry.version, snapshot };
  });

  return run.immediate();
}

/**
 * Ensure the catalog has at least one baseline version (used by seed/CLI).
 */
export function ensureInitialCatalogVersion(
  db: Db = getDb(),
  note = "初始基线（四端源码扫描）",
  now: Date = new Date(),
): CatalogChangeResult | null {
  const existing = listCatalogVersions(db, 1);
  if (existing.length > 0) return null;
  return commitCatalogChange(db, { note, now });
}
