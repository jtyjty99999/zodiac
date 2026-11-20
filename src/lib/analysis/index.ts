import fs from "node:fs";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import { createCandidate } from "../db/repositories/candidates";
import {
  type AnalysisUpdate,
  getCommitById,
  listCommitFiles,
  updateCommitAnalysis,
} from "../db/repositories/commits";
import { getHarnessById } from "../db/repositories/harnesses";
import {
  getExplorationEngineSettings,
  isLocalEngineEnabled,
  type LocalEngineKind,
  localEngineSelection,
} from "../explore/engineSettings";
import { readPatch } from "../git/log";
import { mirrorPath } from "../git/mirror";
import { readDiff } from "../git/storage";
import { getLocalEngineStatus } from "../localEngine";
import type { Commit, CommitCategory, Harness } from "../types";
import {
  type AiAnalysis,
  type AiCommitContext,
  type AiConfig,
  analyzeWithClaude,
  getAiConfig,
} from "./anthropic";
import { classifyCommit } from "./classify";
import { refreshDailyReport } from "./daily";
import { extractTags, heuristicSummary, suggestCandidate } from "./heuristic";
import { analyzeWithLocalEngine } from "./localClaude";
import { rateCommit } from "./rating";

export type AnalyzedBy = "heuristic" | "heuristic+claude" | LocalEngineKind;

export interface AnalyzeOptions {
  useAi?: boolean;
  aiConfig?: AiConfig;
  diffText?: string | null;
  force?: boolean;
  candidate?: boolean;
  /** Injectable local Claude Code reviewer; tests use this to avoid spawning a CLI. */
  localAnalyzer?: (context: AiCommitContext) => Promise<AiAnalysis | null>;
  localTimeoutMs?: number;
  /** Refresh the day's report digest after this commit (batch callers opt out). */
  daily?: boolean;
}

export interface AnalyzeOutcome {
  commitId: number;
  category: CommitCategory;
  rating: number;
  analyzedBy: AnalyzedBy;
  candidateId: number | null;
}

const LOCAL_STATUS_TTL_MS = 60_000;
let localStatusCache: {
  engine: LocalEngineKind;
  command: string;
  checkedAt: number;
  available: boolean;
} | null = null;

/** Local CLI availability is cached so a sync does not probe once per commit. */
async function isLocalEngineAvailable(engine: LocalEngineKind, command: string): Promise<boolean> {
  if (!isLocalEngineEnabled(engine)) return false;
  const now = Date.now();
  if (
    localStatusCache &&
    localStatusCache.engine === engine &&
    localStatusCache.command === command &&
    now - localStatusCache.checkedAt < LOCAL_STATUS_TTL_MS
  ) {
    return localStatusCache.available;
  }
  const status = await getLocalEngineStatus(engine, command);
  localStatusCache = { engine, command, checkedAt: now, available: status.available };
  return status.available;
}

function normalizeAnalyzedBy(value: string | null): AnalyzedBy {
  if (value === "heuristic+claude" || value === "claude-code") return value;
  if (value === "codex" || value === "deepseek") return value;
  return "heuristic";
}

async function resolveDiff(
  commit: Commit,
  harness: Harness,
  options: AnalyzeOptions,
): Promise<string | null> {
  if (options.diffText !== undefined) return options.diffText;
  const stored = readDiff(commit.diffPath);
  if (stored !== null) return stored;
  if (options.useAi === false) return null;

  try {
    const dir = mirrorPath(harness.slug);
    if (!fs.existsSync(dir)) return null;
    const result = await readPatch(dir, commit.sha);
    return result.patch;
  } catch {
    return null;
  }
}

export async function analyzeCommitById(
  db: Db = getDb(),
  commitId: number,
  options: AnalyzeOptions = {},
): Promise<AnalyzeOutcome | null> {
  const commit = getCommitById(db, commitId);
  if (!commit) return null;
  if (commit.analyzedAt && !options.force) {
    return {
      commitId: commit.id,
      category: commit.category ?? "other",
      rating: commit.rating ?? 3,
      analyzedBy: normalizeAnalyzedBy(commit.analyzedBy),
      candidateId: null,
    };
  }

  const harness = getHarnessById(db, commit.harnessId);
  if (!harness) return null;

  const files = listCommitFiles(db, commitId);
  const classification = classifyCommit({
    subject: commit.subject,
    body: commit.body,
    files: files.map((file) => ({ path: file.path, status: file.status })),
    insertions: commit.insertions,
    deletions: commit.deletions,
  });
  const rating = rateCommit({
    category: classification.category,
    subject: commit.subject,
    body: commit.body,
    insertions: commit.insertions,
    deletions: commit.deletions,
    filesChanged: commit.filesChanged,
    files: files.map((file) => file.path),
  });
  const heuristic = heuristicSummary({
    subject: commit.subject,
    body: commit.body,
    category: classification.category,
    files: files.map((file) => ({ path: file.path, status: file.status })),
    insertions: commit.insertions,
    deletions: commit.deletions,
  });

  let analysis: AnalysisUpdate = {
    category: classification.category,
    rating: rating.rating,
    ratingReason: rating.reason,
    summaryMd: heuristic.summaryMd,
    featureTags: heuristic.tags,
    analyzedBy: "heuristic",
  };

  const aiConfig = options.aiConfig ?? getAiConfig(db);
  const useModel = options.useAi !== false;
  let aiCandidate: { name: string; description: string; moduleKey: string | null } | null = null;

  if (useModel) {
    const diff = await resolveDiff(commit, harness, options);
    const context: AiCommitContext = {
      repo: harness.repoUrl,
      sha: commit.sha,
      subject: commit.subject,
      body: commit.body,
      files: files.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      })),
      diff,
    };

    // Automatic engine: Anthropic API first, then the local Claude Code CLI.
    let reviewed: AiAnalysis | null = null;
    let analyzedBy: AnalyzedBy = "heuristic+claude";
    if (aiConfig.enabled) {
      reviewed = await analyzeWithClaude(context, aiConfig);
    }
    if (!reviewed) {
      if (options.localAnalyzer) {
        reviewed = await options.localAnalyzer(context);
        if (reviewed) analyzedBy = "claude-code";
      } else {
        const selection = localEngineSelection(getExplorationEngineSettings(db));
        if (await isLocalEngineAvailable(selection.engine, selection.command)) {
          reviewed = await analyzeWithLocalEngine(context, {
            engine: selection.engine,
            command: selection.command,
            timeoutMs: options.localTimeoutMs,
          });
          if (reviewed) analyzedBy = selection.engine;
        }
      }
    }

    if (reviewed) {
      analysis = {
        category: reviewed.category,
        rating: reviewed.rating,
        ratingReason: reviewed.ratingReason,
        summaryMd: reviewed.summary,
        featureTags: reviewed.tags.length > 0 ? reviewed.tags : heuristic.tags,
        analyzedBy,
      };
      if (reviewed.candidate) {
        aiCandidate = {
          name: reviewed.candidate.name,
          description: reviewed.candidate.description,
          moduleKey: reviewed.candidate.moduleKey,
        };
      }
    }
  }

  updateCommitAnalysis(db, commitId, analysis);

  let candidateId: number | null = null;
  const candidateEnabled = options.candidate !== false;
  if (candidateEnabled && analysis.category === "feature") {
    const suggestion = aiCandidate
      ? { ...aiCandidate, confidence: 0.8 }
      : suggestCandidate({
          category: analysis.category,
          subject: commit.subject,
          body: commit.body,
          files: files.map((file) => ({ path: file.path })),
        });

    if (suggestion) {
      const candidate = createCandidate(db, {
        harnessId: commit.harnessId,
        commitId: commit.id,
        moduleKey: suggestion.moduleKey,
        name: suggestion.name,
        description: suggestion.description,
        evidence: `commit ${commit.sha.slice(0, 10)} · ${commit.subject}`,
        confidence: suggestion.confidence,
        createdDay: commit.day,
      });
      candidateId = candidate.id;
    }
  }

  if (options.daily !== false) {
    refreshDailyReport(db, commit.harnessId, commit.day);
  }

  return {
    commitId,
    category: analysis.category,
    rating: analysis.rating,
    analyzedBy: analysis.analyzedBy as AnalyzedBy,
    candidateId,
  };
}

export interface BatchAnalyzeOptions {
  limit?: number;
  useAi?: boolean;
  aiBudget?: number;
  getDiff?: (commit: Commit) => Promise<string | null>;
  localAnalyzer?: (context: AiCommitContext) => Promise<AiAnalysis | null>;
  localTimeoutMs?: number;
}

export interface BatchAnalyzeResult {
  analyzed: number;
  aiUsed: number;
  days: string[];
  candidates: number;
}

export async function analyzeCommits(
  db: Db = getDb(),
  commits: Commit[],
  options: BatchAnalyzeOptions = {},
): Promise<BatchAnalyzeResult> {
  const aiConfig = getAiConfig(db);
  const limit = Math.min(options.limit ?? commits.length, commits.length);
  const budget =
    options.useAi === false ? 0 : Math.min(options.aiBudget ?? aiConfig.maxPerSync, limit);
  let modelAttempts = 0;
  let aiUsed = 0;
  let analyzed = 0;
  let candidates = 0;
  const days = new Set<string>();

  for (const commit of commits.slice(0, limit)) {
    // Attempts, not successes, consume the budget: a failing local CLI should
    // not be retried for every commit in the same sync.
    const canUseModel = modelAttempts < budget;
    let diffText: string | null | undefined;
    if (canUseModel) {
      modelAttempts += 1;
      if (options.getDiff) {
        diffText = await options.getDiff(commit).catch(() => null);
      }
    }

    const outcome = await analyzeCommitById(db, commit.id, {
      useAi: canUseModel,
      aiConfig,
      diffText,
      daily: false,
      localAnalyzer: options.localAnalyzer,
      localTimeoutMs: options.localTimeoutMs,
    });
    if (!outcome) continue;

    analyzed += 1;
    if (outcome.analyzedBy !== "heuristic") aiUsed += 1;
    if (outcome.candidateId) candidates += 1;
    days.add(commit.day);
  }

  return { analyzed, aiUsed, days: [...days], candidates };
}

export function extractCommitTags(commit: Commit, files: Array<{ path: string }>): string[] {
  return extractTags({ subject: commit.subject, body: commit.body, files });
}
