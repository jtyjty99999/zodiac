import { type AiConfig, getAiConfig } from "../analysis/anthropic";
import type { Db } from "../db/client";
import {
  createExploration,
  failStaleExplorations,
  findRunningExploration,
  finishExploration,
  getExploration,
  updateExplorationKeywords,
  updateExplorationPhase,
} from "../db/repositories/explorations";
import { getHarnessById, listHarnesses } from "../db/repositories/harnesses";
import type {
  Exploration,
  ExplorationEngine,
  ExplorationEvidence,
  ExplorationHarnessEvidence,
  Harness,
} from "../types";
import { cleanErrorMessage } from "../utils/errors";
import {
  type AgenticExplorationInput,
  type AgenticExplorationResult,
  exploreWithClaude,
} from "./agent";
import { type ExplorationSynthesis, type SynthesisInput, synthesizeExploration } from "./ai";
import { exploreWithLocalEngine } from "./claudeCode";
import {
  type ExplorationEngineSettings,
  getExplorationEngineSettings,
  type LocalEngineKind,
  localEngineSelection,
} from "./engineSettings";
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
  /** Test seam: replaces the AI configuration (defaults to getAiConfig). */
  config?: AiConfig;
  /** Test seam: replaces the stored engine choice (defaults to getExplorationEngineSettings). */
  engineSettings?: ExplorationEngineSettings;
  /** Test seam: replaces the real Claude synthesis. */
  synth?: (db: Db, input: SynthesisInput) => Promise<ExplorationSynthesis | null>;
  /** Test seam: replaces the real AI tool-loop exploration. */
  explore?: (
    db: Db,
    input: AgenticExplorationInput,
    options: { config?: AiConfig },
  ) => Promise<AgenticExplorationResult | null>;
  /** Test seam: replaces the local engine CLI exploration. */
  exploreCode?: (
    db: Db,
    input: AgenticExplorationInput,
    options: { engine: LocalEngineKind; command?: string },
  ) => Promise<AgenticExplorationResult | null>;
}

function withDeletedHarnesses(
  evidence: ExplorationEvidence,
  missingIds: number[],
): ExplorationEvidence {
  if (missingIds.length === 0) return evidence;
  return {
    ...evidence,
    harnesses: [...evidence.harnesses, ...missingIds.map(deletedHarnessEntry)],
  };
}

/**
 * Executes a reserved exploration. With AI configured Claude explores the
 * mirrors itself through tools; otherwise (or on failure) the offline
 * keyword retrieval path runs. Never throws; failures are recorded on the row.
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
    const live: Harness[] = [];
    const missingIds: number[] = [];
    for (const harnessId of exploration.harnessIds) {
      const harness = getHarnessById(db, harnessId);
      if (harness) live.push(harness);
      else missingIds.push(harnessId);
    }

    const config = options.config ?? getAiConfig(db);
    const engineSettings = options.engineSettings ?? getExplorationEngineSettings(db);
    const agentInput: AgenticExplorationInput = {
      proposition: exploration.proposition,
      patterns: exploration.keywords,
      matchedFeatures: exploration.matchedFeatures,
      harnesses: live,
    };
    let evidence: ExplorationEvidence | null = null;
    let synthesis: ExplorationSynthesis | null = null;
    let engine: ExplorationEngine = "heuristic";

    // Local engines are an explicit opt-in: when one is selected it runs even
    // without ANTHROPIC_API_KEY, and its failures fall back to offline retrieval.
    const selection = localEngineSelection(engineSettings);
    const useLocalCli = engineSettings.engine !== "api";
    if (useLocalCli || config.enabled) {
      updateExplorationPhase(db, id, "explore");
      const ai = useLocalCli
        ? await (options.exploreCode ?? exploreWithLocalEngine)(db, agentInput, selection)
        : await (options.explore ?? exploreWithClaude)(db, agentInput, { config });
      if (ai) {
        evidence = ai.evidence;
        synthesis = ai.synthesis;
        engine = useLocalCli ? selection.engine : "claude";
        if (ai.patterns.length > 0) {
          updateExplorationKeywords(db, id, ai.patterns);
        }
      }
    }

    if (!evidence) {
      updateExplorationPhase(db, id, "search");
      evidence = await buildEvidence(db, {
        harnesses: live,
        patterns: exploration.keywords,
        matchedFeatures: exploration.matchedFeatures,
      });
      updateExplorationPhase(db, id, "synthesize");
      synthesis = await (options.synth ?? synthesizeExploration)(db, {
        proposition: exploration.proposition,
        patterns: exploration.keywords,
        evidence,
        matchedFeatures: exploration.matchedFeatures,
      });
      engine = synthesis ? "heuristic+claude" : "heuristic";
    }

    const fullEvidence = withDeletedHarnesses(evidence, missingIds);
    const report = buildReport(
      {
        proposition: exploration.proposition,
        createdAt: exploration.createdAt,
        keywords: fullEvidence.patterns,
        evidence: fullEvidence,
      },
      synthesis,
      engine,
    );

    finishExploration(db, id, {
      status: "success",
      engine,
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
