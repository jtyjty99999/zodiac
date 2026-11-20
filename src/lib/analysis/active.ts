import type { Db } from "../db/client";
import { getAiConfig } from "./anthropic";
import { analyzeCommitById } from "./index";

const MAX_ERROR_CHARS = 500;

const globalStore = globalThis as typeof globalThis & {
  __zodiacActiveCommitAnalyses?: Set<number>;
};
if (!globalStore.__zodiacActiveCommitAnalyses) {
  globalStore.__zodiacActiveCommitAnalyses = new Set<number>();
}
const activeAnalyses = globalStore.__zodiacActiveCommitAnalyses;

export function isCommitAnalyzing(commitId: number): boolean {
  return activeAnalyses.has(commitId);
}

/** Reserves an analysis slot; false when the same commit is already running. */
export function beginCommitAnalysis(commitId: number): boolean {
  if (activeAnalyses.has(commitId)) return false;
  activeAnalyses.add(commitId);
  return true;
}

export function endCommitAnalysis(commitId: number): void {
  activeAnalyses.delete(commitId);
}

/**
 * Runs a reserved analysis in the background. Never throws: failures are
 * logged and the slot is always released so the page stops polling.
 */
export async function runCommitAnalysis(db: Db, commitId: number): Promise<void> {
  try {
    await analyzeCommitById(db, commitId, {
      force: true,
      useAi: true,
      aiConfig: getAiConfig(db),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[zodiac] commit ${commitId} analysis failed:`, message.slice(0, MAX_ERROR_CHARS));
  } finally {
    endCommitAnalysis(commitId);
  }
}
