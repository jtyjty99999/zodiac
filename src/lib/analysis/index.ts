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
import { readPatch } from "../git/log";
import { mirrorPath } from "../git/mirror";
import { readDiff } from "../git/storage";
import type { Commit, CommitCategory, Harness } from "../types";
import { type AiConfig, analyzeWithClaude, getAiConfig } from "./anthropic";
import { classifyCommit } from "./classify";
import { refreshDailyReport } from "./daily";
import { extractTags, heuristicSummary, suggestCandidate } from "./heuristic";
import { rateCommit } from "./rating";

export interface AnalyzeOptions {
  useAi?: boolean;
  aiConfig?: AiConfig;
  diffText?: string | null;
  force?: boolean;
  candidate?: boolean;
  /** Refresh the day's report digest after this commit (batch callers opt out). */
  daily?: boolean;
}

export interface AnalyzeOutcome {
  commitId: number;
  category: CommitCategory;
  rating: number;
  analyzedBy: "heuristic" | "heuristic+claude";
  candidateId: number | null;
}

async function resolveDiff(
  commit: Commit,
  harness: Harness,
  options: AnalyzeOptions,
): Promise<string | null> {
  if (options.diffText !== undefined) return options.diffText;
  const stored = readDiff(commit.diffPath);
  if (stored !== null) return stored;
  if (!options.useAi) return null;

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
      analyzedBy: commit.analyzedBy === "heuristic+claude" ? "heuristic+claude" : "heuristic",
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
  const useAi = options.useAi !== false && aiConfig.enabled;
  let aiCandidate: { name: string; description: string; moduleKey: string | null } | null = null;

  if (useAi) {
    const diff = await resolveDiff(commit, harness, options);
    const ai = await analyzeWithClaude(
      {
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
      },
      aiConfig,
    );
    if (ai) {
      analysis = {
        category: ai.category,
        rating: ai.rating,
        ratingReason: ai.ratingReason,
        summaryMd: ai.summary,
        featureTags: ai.tags.length > 0 ? ai.tags : heuristic.tags,
        analyzedBy: "heuristic+claude",
      };
      if (ai.candidate) {
        aiCandidate = {
          name: ai.candidate.name,
          description: ai.candidate.description,
          moduleKey: ai.candidate.moduleKey,
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
    analyzedBy: analysis.analyzedBy === "heuristic+claude" ? "heuristic+claude" : "heuristic",
    candidateId,
  };
}

export interface BatchAnalyzeOptions {
  limit?: number;
  useAi?: boolean;
  aiBudget?: number;
  getDiff?: (commit: Commit) => Promise<string | null>;
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
  let aiUsed = 0;
  let analyzed = 0;
  let candidates = 0;
  const days = new Set<string>();

  for (const commit of commits.slice(0, limit)) {
    const canUseAi = aiConfig.enabled && aiUsed < budget && options.useAi !== false;
    let diffText: string | null | undefined;
    if (canUseAi && options.getDiff) {
      diffText = await options.getDiff(commit).catch(() => null);
    }

    const outcome = await analyzeCommitById(db, commit.id, {
      useAi: canUseAi,
      aiConfig,
      diffText,
      daily: false,
    });
    if (!outcome) continue;

    analyzed += 1;
    if (outcome.analyzedBy === "heuristic+claude") aiUsed += 1;
    if (outcome.candidateId) candidates += 1;
    days.add(commit.day);
  }

  return { analyzed, aiUsed, days: [...days], candidates };
}

export function extractCommitTags(commit: Commit, files: Array<{ path: string }>): string[] {
  return extractTags({ subject: commit.subject, body: commit.body, files });
}
