import type { Db } from "../db/client";
import {
  createExploration,
  failStaleExplorations,
  findRunningExploration,
  finishExploration,
  getExploration,
  updateExplorationPhase,
} from "../db/repositories/explorations";
import { getHarnessById, listHarnesses } from "../db/repositories/harnesses";
import type { Exploration, ExplorationHarnessEvidence, Harness } from "../types";
import { cleanErrorMessage } from "../utils/errors";
import { type ExplorationSynthesis, type SynthesisInput, synthesizeExploration } from "./ai";
import { buildEvidence } from "./evidence";
import { extractKeywordsFor } from "./keywords";
import { buildReport } from "./report";

export class ExplorationBusyError extends Error {
  constructor() {
    super("已有探索正在进行，请等待它完成后再提交");
    this.name = "ExplorationBusyError";
  }
}

export class HarnessNotFoundError extends Error {
  constructor(harnessId: number) {
    super(`Harness 不存在：${harnessId}`);
    this.name = "HarnessNotFoundError";
  }
}

export class NoHarnessesError extends Error {
  constructor() {
    super("没有可探索的 harness");
    this.name = "NoHarnessesError";
  }
}

// Live explorations in this process. Kept on globalThis so dev HMR does not
// forget running work and mark it stale.
const globalStore = globalThis as typeof globalThis & { __zodiacActiveExplorations?: Set<number> };
if (!globalStore.__zodiacActiveExplorations) {
  globalStore.__zodiacActiveExplorations = new Set<number>();
}
const activeExplorations = globalStore.__zodiacActiveExplorations;

export function activeExplorationIds(): number[] {
  return [...activeExplorations];
}

function resolveHarnesses(db: Db, harnessIds: number[]): Harness[] {
  const unique = [...new Set(harnessIds)];
  return unique.map((harnessId) => {
    const harness = getHarnessById(db, harnessId);
    if (!harness) throw new HarnessNotFoundError(harnessId);
    return harness;
  });
}

export interface BeginExplorationInput {
  proposition: string;
  /** Empty/omitted means all enabled harnesses. */
  harnessIds?: number[];
}

/**
 * Reserves an exploration row synchronously. The caller returns its id to the
 * client and executes `runExploration` in the background.
 */
export function beginExploration(db: Db, input: BeginExplorationInput): Exploration {
  // A running row that is not executing in this process was orphaned by a
  // restart; reclaim it immediately instead of making the user wait for the
  // 10-minute stale cutoff.
  const running = findRunningExploration(db);
  if (running && !activeExplorations.has(running.id)) {
    finishExploration(db, running.id, {
      status: "failed",
      error: "Aborted: the exploration process exited",
    });
  }
  failStaleExplorations(db, [...activeExplorations]);

  if (activeExplorations.size > 0) throw new ExplorationBusyError();

  const requested = input.harnessIds && input.harnessIds.length > 0 ? input.harnessIds : null;
  const targets = requested
    ? resolveHarnesses(db, requested)
    : listHarnesses(db, { enabledOnly: true });
  if (targets.length === 0) throw new NoHarnessesError();

  const keywords = extractKeywordsFor(db, input.proposition);
  const exploration = createExploration(db, {
    proposition: input.proposition,
    harnessIds: targets.map((harness) => harness.id),
    keywords: keywords.patterns,
    matchedFeatures: keywords.matchedFeatures,
  });
  activeExplorations.add(exploration.id);
  return exploration;
}

function deletedHarnessEntry(harnessId: number): ExplorationHarnessEvidence {
  return {
    harnessId,
    slug: `harness-${harnessId}`,
    name: `已删除的 harness #${harnessId}`,
    status: "error",
    rev: null,
    totalFiles: 0,
    totalMatches: 0,
    files: [],
    note: "Harness 已被删除，未执行检索",
    truncated: false,
  };
}

export interface RunExplorationOptions {
  /** Test seam: replaces the real Claude synthesis. */
  synth?: (db: Db, input: SynthesisInput) => Promise<ExplorationSynthesis | null>;
}

/**
 * Executes a reserved exploration: offline evidence retrieval, optional Claude
 * synthesis, report assembly. Never throws; failures are recorded on the row.
 */
export async function runExploration(
  db: Db,
  id: number,
  options: RunExplorationOptions = {},
): Promise<void> {
  const exploration = getExploration(db, id);
  if (exploration?.status !== "running") {
    activeExplorations.delete(id);
    return;
  }

  try {
    updateExplorationPhase(db, id, "search");

    const live: Harness[] = [];
    const missingIds: number[] = [];
    for (const harnessId of exploration.harnessIds) {
      const harness = getHarnessById(db, harnessId);
      if (harness) live.push(harness);
      else missingIds.push(harnessId);
    }

    const evidence = await buildEvidence(db, {
      harnesses: live,
      patterns: exploration.keywords,
      matchedFeatures: exploration.matchedFeatures,
    });
    const fullEvidence =
      missingIds.length === 0
        ? evidence
        : {
            ...evidence,
            harnesses: [...evidence.harnesses, ...missingIds.map(deletedHarnessEntry)],
          };

    updateExplorationPhase(db, id, "synthesize");
    const synthesis = await (options.synth ?? synthesizeExploration)(db, {
      proposition: exploration.proposition,
      patterns: exploration.keywords,
      evidence: fullEvidence,
      matchedFeatures: exploration.matchedFeatures,
    });

    const report = buildReport(
      {
        proposition: exploration.proposition,
        createdAt: exploration.createdAt,
        keywords: exploration.keywords,
        evidence: fullEvidence,
      },
      synthesis,
    );

    finishExploration(db, id, {
      status: "success",
      engine: synthesis ? "heuristic+claude" : "heuristic",
      reportMd: report.slice(0, 100_000),
      evidence: fullEvidence,
    });
  } catch (error) {
    finishExploration(db, id, {
      status: "failed",
      error: cleanErrorMessage(error),
    });
  } finally {
    activeExplorations.delete(id);
  }
}
