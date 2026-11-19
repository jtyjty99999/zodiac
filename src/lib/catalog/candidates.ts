import { type Db, getDb } from "../db/client";
import { getCandidate, updateCandidateStatus } from "../db/repositories/candidates";
import {
  createFeature,
  getFeatureByKey,
  recordFeatureHistory,
  setFeatureSupport,
  touchFeature,
} from "../db/repositories/catalog";
import { listHarnesses } from "../db/repositories/harnesses";
import type { Feature, SupportStatus } from "../types";
import { toDay } from "../utils/time";
import { commitCatalogChange } from "./versions";

export interface CandidateSupportInput {
  harnessId: number;
  status: SupportStatus;
  notes?: string | null;
  evidence?: string | null;
}

export interface AcceptCandidateInput {
  featureKey: string;
  moduleKey?: string;
  name?: string;
  description?: string | null;
  support: CandidateSupportInput[];
  note?: string;
  day?: string;
}

export interface AcceptCandidateResult {
  feature: Feature;
  version: string | null;
}

const FEATURE_KEY_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)+$/;

export function acceptCandidate(
  db: Db = getDb(),
  candidateId: number,
  input: AcceptCandidateInput,
): AcceptCandidateResult {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  if (candidate.status !== "pending") throw new Error("Candidate already reviewed");
  if (!FEATURE_KEY_PATTERN.test(input.featureKey)) {
    throw new Error(`Invalid feature key: ${input.featureKey}`);
  }

  const harnesses = listHarnesses(db);
  const validHarnessIds = new Set(harnesses.map((harness) => harness.id));
  for (const entry of input.support) {
    if (!validHarnessIds.has(entry.harnessId)) {
      throw new Error(`Unknown harness: ${entry.harnessId}`);
    }
  }

  const day = input.day ?? toDay(new Date());
  let feature = getFeatureByKey(db, input.featureKey);
  let createdNew = false;

  if (!feature) {
    if (!input.moduleKey) throw new Error("moduleKey is required for a new feature");
    feature = createFeature(db, {
      key: input.featureKey,
      moduleKey: input.moduleKey,
      name: input.name ?? candidate.name,
      description: input.description ?? candidate.description,
      tags: ["candidate"],
      day,
    });
    createdNew = true;
  }

  const featureId = feature.id;
  const featureName = feature.name;

  const run = db.transaction(() => {
    for (const entry of input.support) {
      setFeatureSupport(db, featureId, entry.harnessId, {
        status: entry.status,
        notes: entry.notes ?? null,
        evidence: entry.evidence ?? null,
        sinceVersion: null,
        updatedDay: day,
      });
      const harness = harnesses.find((item) => item.id === entry.harnessId);
      recordFeatureHistory(db, {
        featureId,
        harnessId: entry.harnessId,
        day,
        kind: createdNew ? "added" : "support",
        summary: `${harness?.name ?? "harness"} / ${featureName}: ${entry.status}`,
      });
    }
    touchFeature(db, featureId, day);
    updateCandidateStatus(db, candidateId, "accepted", day);
    return commitCatalogChange(db, {
      note: input.note ?? `采纳候选「${candidate.name}」并更新功能点「${featureName}」`,
    });
  });
  const change = run.immediate();
  return { feature, version: change.version };
}

export function rejectCandidate(db: Db = getDb(), candidateId: number): void {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  if (candidate.status !== "pending") throw new Error("Candidate already reviewed");
  updateCandidateStatus(db, candidateId, "rejected", toDay(new Date()));
}
