import type {
  CatalogVersion,
  Feature,
  FeatureDetail,
  FeatureHistory,
  FeatureModule,
  FeatureSupport,
  SupportStatus,
} from "../../types";
import { nowIso, toDay } from "../../utils/time";
import { type Db, getDb } from "../client";

interface ModuleRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  sort_order: number;
}

interface FeatureRow {
  id: number;
  key: string;
  module_id: number;
  name: string;
  description: string | null;
  tags: string | null;
  overview_md: string | null;
  diff_summary_md: string | null;
  is_deep_dive: number;
  first_seen_day: string | null;
  updated_day: string | null;
  sort_order: number;
  created_at: string;
}

interface SupportRow {
  id: number;
  feature_id: number;
  harness_id: number;
  status: SupportStatus;
  notes: string | null;
  evidence: string | null;
  since_version: string | null;
  updated_day: string | null;
  updated_at: string;
}

interface DetailRow {
  id: number;
  feature_id: number;
  harness_id: number;
  detail_md: string;
  evidence: string | null;
  updated_day: string | null;
  updated_at: string;
}

interface HistoryRow {
  id: number;
  feature_id: number;
  harness_id: number | null;
  day: string;
  kind: string;
  summary: string;
  created_at: string;
}

interface VersionRow {
  id: number;
  version: string;
  note: string | null;
  harness_shas: string | null;
  snapshot_json: string;
  created_at: string;
}

function mapModule(row: ModuleRow): FeatureModule {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

function mapFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    key: row.key,
    moduleId: row.module_id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    overviewMd: row.overview_md,
    diffSummaryMd: row.diff_summary_md,
    isDeepDive: row.is_deep_dive === 1,
    firstSeenDay: row.first_seen_day,
    updatedDay: row.updated_day,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function mapSupport(row: SupportRow): FeatureSupport {
  return {
    id: row.id,
    featureId: row.feature_id,
    harnessId: row.harness_id,
    status: row.status,
    notes: row.notes,
    evidence: row.evidence,
    sinceVersion: row.since_version,
    updatedDay: row.updated_day,
    updatedAt: row.updated_at,
  };
}

function mapDetail(row: DetailRow): FeatureDetail {
  return {
    id: row.id,
    featureId: row.feature_id,
    harnessId: row.harness_id,
    detailMd: row.detail_md,
    evidence: row.evidence,
    updatedDay: row.updated_day,
    updatedAt: row.updated_at,
  };
}

function mapHistory(row: HistoryRow): FeatureHistory {
  return {
    id: row.id,
    featureId: row.feature_id,
    harnessId: row.harness_id,
    day: row.day,
    kind: row.kind,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function mapVersion(row: VersionRow): CatalogVersion {
  return {
    id: row.id,
    version: row.version,
    note: row.note,
    harnessShas: row.harness_shas,
    snapshotJson: row.snapshot_json,
    createdAt: row.created_at,
  };
}

export interface TaxonomyModuleInput {
  key: string;
  name: string;
  description?: string | null;
  sortOrder: number;
}

export interface TaxonomyFeatureInput {
  key: string;
  module: string;
  name: string;
  description?: string | null;
  tags?: string[];
  isDeepDive?: boolean;
  sortOrder?: number;
}

export interface Taxonomy {
  version?: string;
  modules: TaxonomyModuleInput[];
  features: TaxonomyFeatureInput[];
}

export interface UpsertTaxonomyResult {
  moduleCount: number;
  featureCount: number;
  createdFeatures: number;
}

export function upsertTaxonomy(
  db: Db = getDb(),
  taxonomy: Taxonomy,
  now: Date = new Date(),
): UpsertTaxonomyResult {
  const timestamp = nowIso(now);
  let createdFeatures = 0;

  const run = db.transaction(() => {
    const upsertModule = db.prepare(
      `INSERT INTO feature_modules (key, name, description, sort_order)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name, description = excluded.description, sort_order = excluded.sort_order`,
    );
    for (const module of taxonomy.modules) {
      upsertModule.run(module.key, module.name, module.description ?? null, module.sortOrder);
    }

    const findModule = db.prepare("SELECT id FROM feature_modules WHERE key = ?");
    const findFeature = db.prepare("SELECT id FROM features WHERE key = ?");
    const insertFeature = db.prepare(
      `INSERT INTO features
         (key, module_id, name, description, tags, is_deep_dive, first_seen_day, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateFeature = db.prepare(
      `UPDATE features SET module_id = ?, name = ?, description = ?, tags = ?,
         is_deep_dive = ?, sort_order = ? WHERE id = ?`,
    );
    const insertSupport = db.prepare(
      `INSERT OR IGNORE INTO feature_support
         (feature_id, harness_id, status, updated_day, updated_at)
       SELECT ?, id, 'unknown', ?, ? FROM harnesses`,
    );

    taxonomy.features.forEach((feature, index) => {
      const moduleRow = findModule.get(feature.module) as { id: number } | undefined;
      if (!moduleRow) {
        throw new Error(`Unknown taxonomy module: ${feature.module}`);
      }
      const tags = JSON.stringify(feature.tags ?? []);
      const existing = findFeature.get(feature.key) as { id: number } | undefined;

      if (existing) {
        updateFeature.run(
          moduleRow.id,
          feature.name,
          feature.description ?? null,
          tags,
          feature.isDeepDive ? 1 : 0,
          feature.sortOrder ?? index,
          existing.id,
        );
      } else {
        const result = insertFeature.run(
          feature.key,
          moduleRow.id,
          feature.name,
          feature.description ?? null,
          tags,
          feature.isDeepDive ? 1 : 0,
          toDay(now),
          feature.sortOrder ?? index,
          timestamp,
        );
        createdFeatures += 1;
        insertSupport.run(Number(result.lastInsertRowid), toDay(now), timestamp);
      }
    });
  });
  run();

  return {
    moduleCount: taxonomy.modules.length,
    featureCount: taxonomy.features.length,
    createdFeatures,
  };
}

export function listModules(db: Db = getDb()): FeatureModule[] {
  return (
    db.prepare("SELECT * FROM feature_modules ORDER BY sort_order, id").all() as ModuleRow[]
  ).map(mapModule);
}

export function listFeatures(db: Db = getDb()): Feature[] {
  return (
    db.prepare("SELECT * FROM features ORDER BY module_id, sort_order, id").all() as FeatureRow[]
  ).map(mapFeature);
}

export function getFeatureById(db: Db = getDb(), id: number): Feature | null {
  const row = db.prepare("SELECT * FROM features WHERE id = ?").get(id) as FeatureRow | undefined;
  return row ? mapFeature(row) : null;
}

export function getFeatureByKey(db: Db = getDb(), key: string): Feature | null {
  const row = db.prepare("SELECT * FROM features WHERE key = ?").get(key) as FeatureRow | undefined;
  return row ? mapFeature(row) : null;
}

export function createFeature(
  db: Db = getDb(),
  input: {
    key: string;
    moduleKey: string;
    name: string;
    description?: string | null;
    tags?: string[];
    isDeepDive?: boolean;
    day: string;
  },
): Feature {
  const moduleRow = db
    .prepare("SELECT id, sort_order FROM feature_modules WHERE key = ?")
    .get(input.moduleKey) as { id: number; sort_order: number } | undefined;
  if (!moduleRow) throw new Error(`Unknown module: ${input.moduleKey}`);

  const sortRow = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM features WHERE module_id = ?")
    .get(moduleRow.id) as { next: number };

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO features
           (key, module_id, name, description, tags, is_deep_dive, first_seen_day, updated_day,
            sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.key,
        moduleRow.id,
        input.name,
        input.description ?? null,
        JSON.stringify(input.tags ?? []),
        input.isDeepDive ? 1 : 0,
        input.day,
        input.day,
        sortRow.next,
        nowIso(),
      );
    db.prepare(
      `INSERT OR IGNORE INTO feature_support
         (feature_id, harness_id, status, updated_day, updated_at)
       SELECT ?, id, 'unknown', ?, ? FROM harnesses`,
    ).run(Number(result.lastInsertRowid), input.day, nowIso());
  });
  run();

  const feature = getFeatureByKey(db, input.key);
  if (!feature) throw new Error(`Failed to create feature: ${input.key}`);
  return feature;
}

export function listSupport(db: Db = getDb(), featureIds?: number[]): FeatureSupport[] {
  if (!featureIds || featureIds.length === 0) {
    return (db.prepare("SELECT * FROM feature_support").all() as SupportRow[]).map(mapSupport);
  }
  const placeholders = featureIds.map(() => "?").join(",");
  return (
    db
      .prepare(`SELECT * FROM feature_support WHERE feature_id IN (${placeholders})`)
      .all(...featureIds) as SupportRow[]
  ).map(mapSupport);
}

export interface FeatureSupportPatch {
  status: SupportStatus;
  notes?: string | null;
  evidence?: string | null;
  sinceVersion?: string | null;
  updatedDay: string;
  updatedAt?: string;
}

export function setFeatureSupport(
  db: Db = getDb(),
  featureId: number,
  harnessId: number,
  patch: FeatureSupportPatch,
): FeatureSupport {
  const timestamp = patch.updatedAt ?? nowIso();
  db.prepare(
    `INSERT INTO feature_support
       (feature_id, harness_id, status, notes, evidence, since_version, updated_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature_id, harness_id) DO UPDATE SET
       status = excluded.status,
       notes = excluded.notes,
       evidence = excluded.evidence,
       since_version = excluded.since_version,
       updated_day = excluded.updated_day,
       updated_at = excluded.updated_at`,
  ).run(
    featureId,
    harnessId,
    patch.status,
    patch.notes ?? null,
    patch.evidence ?? null,
    patch.sinceVersion ?? null,
    patch.updatedDay,
    timestamp,
  );

  const row = db
    .prepare("SELECT * FROM feature_support WHERE feature_id = ? AND harness_id = ?")
    .get(featureId, harnessId) as SupportRow;
  return mapSupport(row);
}

export function touchFeature(db: Db = getDb(), featureId: number, day: string): void {
  db.prepare("UPDATE features SET updated_day = ? WHERE id = ?").run(day, featureId);
}

export function setFeatureDeepDive(db: Db = getDb(), featureId: number, deepDive: boolean): void {
  db.prepare("UPDATE features SET is_deep_dive = ? WHERE id = ?").run(deepDive ? 1 : 0, featureId);
}

export function updateFeatureContent(
  db: Db = getDb(),
  featureId: number,
  content: {
    overviewMd?: string | null;
    diffSummaryMd?: string | null;
    updatedDay: string;
  },
): void {
  const current = getFeatureById(db, featureId);
  if (!current) return;
  db.prepare(
    "UPDATE features SET overview_md = ?, diff_summary_md = ?, updated_day = ? WHERE id = ?",
  ).run(
    content.overviewMd === undefined ? current.overviewMd : content.overviewMd,
    content.diffSummaryMd === undefined ? current.diffSummaryMd : content.diffSummaryMd,
    content.updatedDay,
    featureId,
  );
}

export function upsertFeatureDetail(
  db: Db = getDb(),
  featureId: number,
  harnessId: number,
  detail: { detailMd: string; evidence?: string | null; updatedDay: string },
): FeatureDetail {
  db.prepare(
    `INSERT INTO feature_details (feature_id, harness_id, detail_md, evidence, updated_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature_id, harness_id) DO UPDATE SET
       detail_md = excluded.detail_md,
       evidence = excluded.evidence,
       updated_day = excluded.updated_day,
       updated_at = excluded.updated_at`,
  ).run(
    featureId,
    harnessId,
    detail.detailMd,
    detail.evidence ?? null,
    detail.updatedDay,
    nowIso(),
  );

  const row = db
    .prepare("SELECT * FROM feature_details WHERE feature_id = ? AND harness_id = ?")
    .get(featureId, harnessId) as DetailRow;
  return mapDetail(row);
}

export function listFeatureDetails(db: Db = getDb(), featureId: number): FeatureDetail[] {
  return (
    db
      .prepare("SELECT * FROM feature_details WHERE feature_id = ? ORDER BY harness_id")
      .all(featureId) as DetailRow[]
  ).map(mapDetail);
}

export function recordFeatureHistory(
  db: Db = getDb(),
  entry: {
    featureId: number;
    harnessId?: number | null;
    day: string;
    kind: string;
    summary: string;
  },
): void {
  db.prepare(
    `INSERT INTO feature_history (feature_id, harness_id, day, kind, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entry.featureId, entry.harnessId ?? null, entry.day, entry.kind, entry.summary, nowIso());
}

export function listFeatureHistory(
  db: Db = getDb(),
  featureId: number,
  limit = 50,
): FeatureHistory[] {
  return (
    db
      .prepare(
        "SELECT * FROM feature_history WHERE feature_id = ? ORDER BY day DESC, id DESC LIMIT ?",
      )
      .all(featureId, limit) as HistoryRow[]
  ).map(mapHistory);
}

export function listRecentFeatureHistory(db: Db = getDb(), limit = 30): FeatureHistory[] {
  return (
    db
      .prepare("SELECT * FROM feature_history ORDER BY day DESC, id DESC LIMIT ?")
      .all(limit) as HistoryRow[]
  ).map(mapHistory);
}

export function createCatalogVersion(
  db: Db = getDb(),
  input: {
    version: string;
    note?: string | null;
    harnessShas?: string | null;
    snapshotJson: string;
  },
): CatalogVersion {
  db.prepare(
    `INSERT INTO catalog_versions (version, note, harness_shas, snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       note = excluded.note, harness_shas = excluded.harness_shas, snapshot_json = excluded.snapshot_json`,
  ).run(input.version, input.note ?? null, input.harnessShas ?? null, input.snapshotJson, nowIso());

  const row = db
    .prepare("SELECT * FROM catalog_versions WHERE version = ?")
    .get(input.version) as VersionRow;
  return mapVersion(row);
}

export function latestCatalogVersion(db: Db = getDb()): CatalogVersion | null {
  const row = db
    .prepare("SELECT * FROM catalog_versions ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as VersionRow | undefined;
  return row ? mapVersion(row) : null;
}

export function listCatalogVersions(db: Db = getDb(), limit = 50): CatalogVersion[] {
  return (
    db
      .prepare("SELECT * FROM catalog_versions ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(limit) as VersionRow[]
  ).map(mapVersion);
}

export interface CatalogSnapshot {
  generatedAt: string;
  modules: FeatureModule[];
  features: Array<Feature & { moduleKey: string; support: FeatureSupport[] }>;
}

export function exportCatalogSnapshot(db: Db = getDb()): CatalogSnapshot {
  const modules = listModules(db);
  const features = listFeatures(db);
  const support = listSupport(db);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const supportByFeature = new Map<number, FeatureSupport[]>();
  for (const entry of support) {
    const list = supportByFeature.get(entry.featureId) ?? [];
    list.push(entry);
    supportByFeature.set(entry.featureId, list);
  }

  return {
    generatedAt: nowIso(),
    modules,
    features: features.map((feature) => ({
      ...feature,
      moduleKey: moduleById.get(feature.moduleId)?.key ?? "unknown",
      support: supportByFeature.get(feature.id) ?? [],
    })),
  };
}
