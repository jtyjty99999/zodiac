export type ScheduleMode = "off" | "hourly" | "daily";

export type SyncTrigger = "manual" | "schedule" | "cli";
export type SyncStatus = "running" | "success" | "failed";
export type SyncPhase = "queued" | "fetch" | "ingest" | "analyze" | "finalize" | "done";

export type CommitCategory =
  | "feature"
  | "performance"
  | "bugfix"
  | "refactor"
  | "docs"
  | "test"
  | "tooling"
  | "other";

export const COMMIT_CATEGORIES: readonly CommitCategory[] = [
  "feature",
  "performance",
  "bugfix",
  "refactor",
  "docs",
  "test",
  "tooling",
  "other",
];

export type SupportStatus = "yes" | "partial" | "no" | "unknown";

export const SUPPORT_STATUSES: readonly SupportStatus[] = ["yes", "partial", "no", "unknown"];

export type CandidateStatus = "pending" | "accepted" | "rejected";

export interface Harness {
  id: number;
  slug: string;
  name: string;
  repoUrl: string;
  branch: string;
  localPath: string | null;
  sortOrder: number;
  enabled: boolean;
  scheduleMode: ScheduleMode;
  dailyTime: string;
  backfillDays: number;
  baselineSha: string | null;
  /** When the most recent sync attempt started (set even while it is running). */
  lastAttemptAt: string | null;
  /** When the most recent attempt finished, regardless of success/failure. */
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: number;
  harnessId: number;
  trigger: SyncTrigger;
  phase: SyncPhase;
  status: SyncStatus;
  newCommits: number;
  newReleases: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Last liveness signal; used to detect runs orphaned by an exited process. */
  heartbeatAt: string | null;
}

export interface Release {
  id: number;
  harnessId: number;
  tag: string;
  name: string | null;
  url: string | null;
  publishedAt: string | null;
  body: string | null;
}

export interface Commit {
  id: number;
  harnessId: number;
  sha: string;
  committerDate: string;
  day: string;
  author: string;
  subject: string;
  body: string | null;
  url: string | null;
  category: CommitCategory | null;
  rating: number | null;
  ratingReason: string | null;
  summaryMd: string | null;
  featureTags: string | null;
  filesChanged: number;
  insertions: number;
  deletions: number;
  diffPath: string | null;
  statsComplete: boolean;
  analyzedBy: string | null;
  analyzedAt: string | null;
}

export interface CommitFile {
  id: number;
  commitId: number;
  path: string;
  additions: number;
  deletions: number;
  status: string | null;
}

export interface DailyReport {
  id: number;
  harnessId: number;
  day: string;
  commitCount: number;
  categoryCounts: string;
  summaryMd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureModule {
  id: number;
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface Feature {
  id: number;
  key: string;
  moduleId: number;
  name: string;
  description: string | null;
  tags: string | null;
  overviewMd: string | null;
  diffSummaryMd: string | null;
  isDeepDive: boolean;
  firstSeenDay: string | null;
  updatedDay: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface FeatureSupport {
  id: number;
  featureId: number;
  harnessId: number;
  status: SupportStatus;
  notes: string | null;
  evidence: string | null;
  sinceVersion: string | null;
  updatedDay: string | null;
  updatedAt: string;
}

export interface FeatureDetail {
  id: number;
  featureId: number;
  harnessId: number;
  detailMd: string;
  evidence: string | null;
  updatedDay: string | null;
  updatedAt: string;
}

export interface FeatureHistory {
  id: number;
  featureId: number;
  harnessId: number | null;
  day: string;
  kind: string;
  summary: string;
  createdAt: string;
}

export interface CatalogVersion {
  id: number;
  version: string;
  note: string | null;
  harnessShas: string | null;
  snapshotJson: string;
  createdAt: string;
}

export interface Candidate {
  id: number;
  harnessId: number;
  commitId: number | null;
  moduleKey: string | null;
  name: string;
  description: string | null;
  evidence: string | null;
  confidence: number;
  status: CandidateStatus;
  createdDay: string;
  reviewedDay: string | null;
  createdAt: string;
}

export interface CandidateCheck {
  id: number;
  candidateId: number;
  harnessId: number;
  status: SupportStatus;
  evidence: string | null;
  note: string | null;
}

export interface FeatureWithSupport extends Feature {
  moduleKey: string;
  moduleName: string;
  support: Record<string, FeatureSupport>;
}

export interface HarnessStats {
  harnessId: number;
  totalCommits: number;
  commits7d: number;
  lastCommitDay: string | null;
  openCandidates: number;
}

export type ExplorationStatus = "running" | "success" | "failed";
export type ExplorationPhase = "search" | "synthesize" | "done";
export type ExplorationEngine = "heuristic" | "heuristic+claude";
export type ExplorationHarnessStatus = "ok" | "empty" | "missing" | "error";

export interface ExplorationMatchedFeature {
  id: number;
  key: string;
  name: string;
}

export interface ExplorationSnippet {
  line: number;
  text: string;
}

export interface ExplorationFileEvidence {
  path: string;
  /** Number of matching lines in the whole file. */
  total: number;
  snippets: ExplorationSnippet[];
}

export interface ExplorationHarnessEvidence {
  harnessId: number;
  slug: string;
  name: string;
  status: ExplorationHarnessStatus;
  rev: string | null;
  totalFiles: number;
  totalMatches: number;
  files: ExplorationFileEvidence[];
  note: string | null;
  /** True when grep output or file selection hit a limit. */
  truncated: boolean;
}

export interface ExplorationEvidence {
  generatedAt: string;
  patterns: string[];
  harnesses: ExplorationHarnessEvidence[];
  /** Matched catalog features with per-harness support status keyed by slug. */
  relatedFeatures: Array<{
    featureId: number;
    key: string;
    name: string;
    support: Record<string, SupportStatus>;
  }>;
  truncated: boolean;
}

export interface Exploration {
  id: number;
  proposition: string;
  harnessIds: number[];
  keywords: string[];
  matchedFeatures: ExplorationMatchedFeature[];
  status: ExplorationStatus;
  phase: ExplorationPhase;
  engine: ExplorationEngine;
  reportMd: string | null;
  evidence: ExplorationEvidence | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}
