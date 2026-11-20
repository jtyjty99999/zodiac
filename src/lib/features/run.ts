import { getAiConfig } from "../analysis/anthropic";
import { commitCatalogChange } from "../catalog/versions";
import type { Db } from "../db/client";
import {
  getFeatureById,
  getFeatureByKey,
  listSupport,
  recordFeatureHistory,
  setFeatureDeepDive,
  setFeatureSupport,
  touchFeature,
  updateFeatureContent,
  upsertFeatureDetail,
} from "../db/repositories/catalog";
import {
  createFeatureAudit,
  failStaleFeatureAudits,
  findRunningFeatureAudit,
  finishFeatureAudit,
  getFeatureAudit,
} from "../db/repositories/featureAudits";
import { listHarnesses } from "../db/repositories/harnesses";
import { getExplorationEngineSettings, localEngineSelection } from "../explore/engineSettings";
import type { Feature, FeatureAudit } from "../types";
import { cleanErrorMessage } from "../utils/errors";
import { toDay } from "../utils/time";
import { auditFeature, buildAuditReport, type FeatureAuditOutcome } from "./audit";

const MAX_ERROR_CHARS = 1_500;

export class FeatureAuditBusyError extends Error {
  constructor() {
    super("已有功能点重审正在进行，请等待它完成后再试");
    this.name = "FeatureAuditBusyError";
  }
}

export class FeatureAuditNotFoundError extends Error {
  constructor(key: string) {
    super(`功能点不存在：${key}`);
    this.name = "FeatureAuditNotFoundError";
  }
}

const globalStore = globalThis as typeof globalThis & { __zodiacActiveAudits?: Set<number> };
if (!globalStore.__zodiacActiveAudits) {
  globalStore.__zodiacActiveAudits = new Set<number>();
}
const activeAudits = globalStore.__zodiacActiveAudits;

export function activeFeatureAuditIds(): number[] {
  return [...activeAudits];
}

/**
 * Reserves an audit row synchronously. The caller returns its id to the client
 * and executes `runFeatureAudit` in the background.
 */
export function beginFeatureAudit(db: Db, featureKey: string): FeatureAudit {
  const feature = getFeatureByKey(db, featureKey);
  if (!feature) throw new FeatureAuditNotFoundError(featureKey);

  // A running row that is not executing in this process was orphaned by a
  // restart; reclaim it immediately.
  const running = findRunningFeatureAudit(db);
  if (running && !activeAudits.has(running.id)) {
    finishFeatureAudit(db, running.id, {
      status: "failed",
      error: "Aborted: the audit process exited",
    });
  }
  failStaleFeatureAudits(db, [...activeAudits]);

  if (activeAudits.size > 0) throw new FeatureAuditBusyError();

  const config = getAiConfig(db);
  const engine =
    config.enabled && config.hasKey
      ? "claude"
      : localEngineSelection(getExplorationEngineSettings(db)).engine;
  const audit = createFeatureAudit(db, {
    featureId: feature.id,
    engine,
  });
  activeAudits.add(audit.id);
  return audit;
}

export interface ApplyAuditOptions {
  day?: string;
}

/**
 * Writes an audit result into the catalog in one transaction and records a
 * dated baseline version so the previous state stays recoverable.
 */
export function applyFeatureAudit(
  db: Db,
  feature: Feature,
  outcome: FeatureAuditOutcome,
  options: ApplyAuditOptions = {},
): string {
  const day = options.day ?? toDay(new Date());
  const harnessBySlug = new Map(listHarnesses(db).map((harness) => [harness.slug, harness]));
  const currentSupport = new Map(
    listSupport(db, [feature.id]).map((entry) => [entry.harnessId, entry]),
  );

  let version = "";
  const run = db.transaction(() => {
    updateFeatureContent(db, feature.id, {
      overviewMd: outcome.result.overviewMd,
      diffSummaryMd: outcome.result.diffSummaryMd,
      updatedDay: day,
    });
    touchFeature(db, feature.id, day);
    // An audited feature now has implementation-level content, so it joins the
    // deep-dive set (the compare page can still toggle it off manually).
    setFeatureDeepDive(db, feature.id, true);

    for (const entry of outcome.result.harnesses) {
      const harness = harnessBySlug.get(entry.slug);
      if (!harness) continue;
      const evidence = entry.evidence.length > 0 ? entry.evidence.join("\n") : null;
      setFeatureSupport(db, feature.id, harness.id, {
        status: entry.status,
        notes: entry.notes,
        evidence,
        sinceVersion: currentSupport.get(harness.id)?.sinceVersion ?? null,
        updatedDay: day,
      });
      upsertFeatureDetail(db, feature.id, harness.id, {
        detailMd: entry.detailMd,
        evidence,
        updatedDay: day,
      });
      recordFeatureHistory(db, {
        featureId: feature.id,
        harnessId: harness.id,
        day,
        kind: "audit",
        summary: `AI 重审：${harness.name} → ${entry.status}`,
      });
    }

    version = commitCatalogChange(db, {
      note: `AI 重审功能点「${feature.name}」（引擎 ${outcome.engine}）`,
    }).version;
  });
  run.immediate();
  return version;
}

export interface RunFeatureAuditOptions {
  /** Test seam: replaces the real audit engine. */
  auditor?: (db: Db, feature: Feature) => Promise<FeatureAuditOutcome>;
}

/**
 * Executes a reserved audit. Never throws; failures are recorded on the row so
 * the UI can show what happened.
 */
export async function runFeatureAudit(
  db: Db,
  id: number,
  options: RunFeatureAuditOptions = {},
): Promise<void> {
  const audit = getFeatureAudit(db, id);
  if (audit?.status !== "running") {
    activeAudits.delete(id);
    return;
  }

  try {
    const feature = getFeatureById(db, audit.featureId);
    if (!feature) throw new Error("功能点已被删除");
    const outcome = await (options.auditor ?? auditFeature)(db, feature);
    const version = applyFeatureAudit(db, feature, outcome);
    finishFeatureAudit(db, id, {
      status: "success",
      engine: outcome.engine,
      version,
      resultJson: JSON.stringify({ ...outcome.result, revs: outcome.revs }),
      reportMd: buildAuditReport(feature, outcome),
      error: null,
    });
  } catch (error) {
    const message = cleanErrorMessage(error, MAX_ERROR_CHARS);
    console.warn(`[zodiac] feature audit ${id} failed:`, message);
    finishFeatureAudit(db, id, { status: "failed", error: message });
  } finally {
    activeAudits.delete(id);
  }
}
