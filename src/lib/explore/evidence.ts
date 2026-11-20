import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import { listSupport } from "../db/repositories/catalog";
import { mirrorPath, revParse } from "../git/mirror";
import { searchMirror } from "../git/search";
import type {
  ExplorationEvidence,
  ExplorationHarnessEvidence,
  ExplorationMatchedFeature,
  Harness,
  SupportStatus,
} from "../types";
import { cleanErrorMessage } from "../utils/errors";
import { nowIso } from "../utils/time";

export interface EvidenceInput {
  harnesses: Harness[];
  patterns: string[];
  matchedFeatures: ExplorationMatchedFeature[];
}

function mirrorReady(dir: string): boolean {
  return fs.existsSync(path.join(dir, "HEAD"));
}

async function harnessEvidence(
  harness: Harness,
  patterns: string[],
): Promise<ExplorationHarnessEvidence> {
  const base = {
    harnessId: harness.id,
    slug: harness.slug,
    name: harness.name,
    rev: null,
    totalFiles: 0,
    totalMatches: 0,
    files: [],
    note: null,
    truncated: false,
  } satisfies Omit<ExplorationHarnessEvidence, "status">;

  const dir = mirrorPath(harness.slug);
  if (!mirrorReady(dir)) {
    return { ...base, status: "missing", note: "本地镜像尚未同步，请先在 Harness 管理页同步" };
  }

  let rev: string;
  try {
    rev = await revParse(dir, harness.branch);
  } catch (error) {
    return {
      ...base,
      status: "error",
      note: `无法解析分支 ${harness.branch}：${cleanErrorMessage(error, 300)}`,
    };
  }

  try {
    const result = await searchMirror(dir, rev, patterns);
    const status = result.files.length === 0 ? "empty" : "ok";
    return {
      harnessId: harness.id,
      slug: harness.slug,
      name: harness.name,
      status,
      rev,
      totalFiles: result.totalFiles,
      totalMatches: result.totalMatches,
      files: result.files,
      note:
        result.notes.length > 0
          ? result.notes.slice(0, 3).join("；")
          : status === "empty"
            ? "未检索到匹配的代码"
            : null,
      truncated: result.truncated,
    };
  } catch (error) {
    return { ...base, rev, status: "error", note: cleanErrorMessage(error, 500) };
  }
}

function relatedFeaturesFor(
  db: Db,
  matchedFeatures: ExplorationMatchedFeature[],
  harnesses: Harness[],
): ExplorationEvidence["relatedFeatures"] {
  if (matchedFeatures.length === 0) return [];
  const supportRows = listSupport(
    db,
    matchedFeatures.map((feature) => feature.id),
  );
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));

  return matchedFeatures.map((feature) => {
    const support: Record<string, SupportStatus> = {};
    for (const row of supportRows) {
      if (row.featureId !== feature.id) continue;
      const harness = harnessById.get(row.harnessId);
      if (harness) support[harness.slug] = row.status;
    }
    return { featureId: feature.id, key: feature.key, name: feature.name, support };
  });
}

/** Retrieves bounded, structured evidence from every selected harness mirror. */
export async function buildEvidence(db: Db, input: EvidenceInput): Promise<ExplorationEvidence> {
  const harnesses: ExplorationHarnessEvidence[] = [];
  for (const harness of input.harnesses) {
    harnesses.push(await harnessEvidence(harness, input.patterns));
  }

  return {
    generatedAt: nowIso(),
    patterns: input.patterns,
    harnesses,
    relatedFeatures: relatedFeaturesFor(db, input.matchedFeatures, input.harnesses),
    truncated: harnesses.some((entry) => entry.truncated),
  };
}
