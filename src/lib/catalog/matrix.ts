import { type Db, getDb } from "../db/client";
import {
  getFeatureById,
  getFeatureByKey,
  listFeatureDetails,
  listFeatureHistory,
  listFeatures,
  listModules,
  listSupport,
  recordFeatureHistory,
  setFeatureSupport,
  touchFeature,
} from "../db/repositories/catalog";
import { listHarnesses } from "../db/repositories/harnesses";
import type {
  Feature,
  FeatureDetail,
  FeatureHistory,
  FeatureModule,
  FeatureSupport,
  Harness,
  SupportStatus,
} from "../types";
import { toDay } from "../utils/time";
import { commitCatalogChange } from "./versions";

export interface MatrixCell {
  harness: Harness;
  support: FeatureSupport;
}

export interface MatrixRow {
  feature: Feature;
  module: FeatureModule;
  cells: MatrixCell[];
}

export interface HarnessCoverage {
  harness: Harness;
  yes: number;
  partial: number;
  no: number;
  unknown: number;
  score: number;
}

export interface Matrix {
  modules: FeatureModule[];
  harnesses: Harness[];
  rows: MatrixRow[];
  coverage: HarnessCoverage[];
}

const STATUS_WEIGHT: Record<SupportStatus, number> = {
  yes: 1,
  partial: 0.5,
  no: 0,
  unknown: 0,
};

export function getMatrix(db: Db = getDb()): Matrix {
  const modules = listModules(db);
  const harnesses = listHarnesses(db);
  const features = listFeatures(db);
  const support = listSupport(db);

  const supportByKey = new Map<string, FeatureSupport>();
  for (const entry of support) {
    supportByKey.set(`${entry.featureId}:${entry.harnessId}`, entry);
  }
  const moduleById = new Map(modules.map((module) => [module.id, module]));

  const rows: MatrixRow[] = features.map((feature) => {
    const module = moduleById.get(feature.moduleId);
    if (!module) throw new Error(`Feature ${feature.key} has no module`);
    const cells = harnesses.map((harness) => {
      const found = supportByKey.get(`${feature.id}:${harness.id}`);
      const fallback: FeatureSupport = {
        id: 0,
        featureId: feature.id,
        harnessId: harness.id,
        status: "unknown",
        notes: null,
        evidence: null,
        sinceVersion: null,
        updatedDay: null,
        updatedAt: "",
      };
      return { harness, support: found ?? fallback };
    });
    return { feature, module, cells };
  });

  const coverage = harnesses.map((harness) => {
    const counts = { yes: 0, partial: 0, no: 0, unknown: 0 };
    for (const row of rows) {
      const cell = row.cells.find((entry) => entry.harness.id === harness.id);
      if (cell) counts[cell.support.status] += 1;
    }
    const total = rows.length || 1;
    const score =
      ((counts.yes * STATUS_WEIGHT.yes + counts.partial * STATUS_WEIGHT.partial) / total) * 100;
    return { harness, ...counts, score: Math.round(score * 10) / 10 };
  });

  return { modules, harnesses, rows, coverage };
}

export interface CompareCell {
  harness: Harness;
  support: FeatureSupport;
  detail: FeatureDetail | null;
}

export interface CompareView {
  feature: Feature;
  module: FeatureModule;
  cells: CompareCell[];
  history: FeatureHistory[];
  deepDive: boolean;
  prev: { key: string; name: string } | null;
  next: { key: string; name: string } | null;
}

export function getCompareView(featureKey: string, db: Db = getDb()): CompareView | null {
  const feature = getFeatureByKey(db, featureKey);
  if (!feature) return null;

  const modules = listModules(db);
  const module = modules.find((entry) => entry.id === feature.moduleId);
  if (!module) return null;

  const harnesses = listHarnesses(db);
  const support = listSupport(db, [feature.id]);
  const details = listFeatureDetails(db, feature.id);
  const supportByHarness = new Map(support.map((entry) => [entry.harnessId, entry]));
  const detailsByHarness = new Map(details.map((entry) => [entry.harnessId, entry]));

  const cells = harnesses.map((harness) => ({
    harness,
    support:
      supportByHarness.get(harness.id) ??
      ({
        id: 0,
        featureId: feature.id,
        harnessId: harness.id,
        status: "unknown",
        notes: null,
        evidence: null,
        sinceVersion: null,
        updatedDay: null,
        updatedAt: "",
      } satisfies FeatureSupport),
    detail: detailsByHarness.get(harness.id) ?? null,
  }));

  const ordered = listFeatures(db);
  const index = ordered.findIndex((entry) => entry.id === feature.id);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  return {
    feature,
    module,
    cells,
    history: listFeatureHistory(db, feature.id),
    deepDive: feature.isDeepDive,
    prev: prev ? { key: prev.key, name: prev.name } : null,
    next: next ? { key: next.key, name: next.name } : null,
  };
}

export function listDeepDiveFeatures(db: Db = getDb()): Feature[] {
  return listFeatures(db).filter((feature) => feature.isDeepDive);
}

export interface SaveSupportInput {
  featureId: number;
  harnessId: number;
  status: SupportStatus;
  notes?: string | null;
  evidence?: string | null;
  sinceVersion?: string | null;
  day?: string;
  recordVersion?: boolean;
  note?: string;
}

export interface SaveSupportResult {
  support: FeatureSupport;
  version: string | null;
}

export function saveFeatureSupport(db: Db = getDb(), input: SaveSupportInput): SaveSupportResult {
  const feature = getFeatureById(db, input.featureId);
  if (!feature) throw new Error(`Feature not found: ${input.featureId}`);
  const harness = listHarnesses(db).find((entry) => entry.id === input.harnessId);
  if (!harness) throw new Error(`Harness not found: ${input.harnessId}`);

  const day = input.day ?? toDay(new Date());

  let version: string | null = null;
  const run = db.transaction(() => {
    setFeatureSupport(db, input.featureId, input.harnessId, {
      status: input.status,
      notes: input.notes ?? null,
      evidence: input.evidence ?? null,
      sinceVersion: input.sinceVersion ?? null,
      updatedDay: day,
    });
    touchFeature(db, input.featureId, day);
    recordFeatureHistory(db, {
      featureId: input.featureId,
      harnessId: input.harnessId,
      day,
      kind: "support",
      summary: `${harness.name} / ${feature.name}: ${input.status}`,
    });
    if (input.recordVersion !== false) {
      version = commitCatalogChange(db, {
        note: input.note ?? `更新功能点「${feature.name}」（${harness.name} → ${input.status}）`,
      }).version;
    }
  });
  run.immediate();

  const updated = listSupport(db, [input.featureId]).find(
    (entry) => entry.harnessId === input.harnessId,
  );
  if (!updated) throw new Error("Failed to persist support");
  return { support: updated, version };
}
