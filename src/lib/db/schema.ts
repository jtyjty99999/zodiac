export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS harnesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  local_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_mode TEXT NOT NULL DEFAULT 'daily',
  daily_time TEXT NOT NULL DEFAULT '09:17',
  backfill_days INTEGER NOT NULL DEFAULT 30,
  baseline_sha TEXT,
  last_sync_at TEXT,
  last_success_at TEXT,
  last_sha TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'queued',
  status TEXT NOT NULL DEFAULT 'running',
  new_commits INTEGER NOT NULL DEFAULT 0,
  new_releases INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_runs_one_running
  ON sync_runs(harness_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_sync_runs_harness ON sync_runs(harness_id, started_at DESC);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  name TEXT,
  url TEXT,
  published_at TEXT,
  body TEXT,
  UNIQUE(harness_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_releases_harness ON releases(harness_id, published_at DESC);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  committer_date TEXT NOT NULL,
  day TEXT NOT NULL,
  author TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  url TEXT,
  category TEXT,
  rating INTEGER,
  rating_reason TEXT,
  summary_md TEXT,
  feature_tags TEXT,
  files_changed INTEGER NOT NULL DEFAULT 0,
  insertions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  diff_path TEXT,
  stats_complete INTEGER NOT NULL DEFAULT 0,
  analyzed_by TEXT,
  analyzed_at TEXT,
  UNIQUE(harness_id, sha)
);
CREATE INDEX IF NOT EXISTS idx_commits_harness_day ON commits(harness_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_commits_category ON commits(category);
CREATE INDEX IF NOT EXISTS idx_commits_rating ON commits(rating);

CREATE TABLE IF NOT EXISTS commit_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  status TEXT
);
CREATE INDEX IF NOT EXISTS idx_commit_files_commit ON commit_files(commit_id);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  commit_count INTEGER NOT NULL DEFAULT 0,
  category_counts TEXT NOT NULL DEFAULT '{}',
  summary_md TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(harness_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_reports_day ON daily_reports(day DESC);

CREATE TABLE IF NOT EXISTS feature_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  module_id INTEGER NOT NULL REFERENCES feature_modules(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  overview_md TEXT,
  diff_summary_md TEXT,
  is_deep_dive INTEGER NOT NULL DEFAULT 0,
  first_seen_day TEXT,
  updated_day TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_features_module ON features(module_id, sort_order);

CREATE TABLE IF NOT EXISTS feature_support (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  notes TEXT,
  evidence TEXT,
  since_version TEXT,
  updated_day TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(feature_id, harness_id)
);
CREATE INDEX IF NOT EXISTS idx_feature_support_feature ON feature_support(feature_id);

CREATE TABLE IF NOT EXISTS feature_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  detail_md TEXT NOT NULL,
  evidence TEXT,
  updated_day TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(feature_id, harness_id)
);

CREATE TABLE IF NOT EXISTS feature_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  harness_id INTEGER REFERENCES harnesses(id) ON DELETE SET NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_history_feature ON feature_history(feature_id, day DESC);

CREATE TABLE IF NOT EXISTS catalog_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  note TEXT,
  harness_shas TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  commit_id INTEGER REFERENCES commits(id) ON DELETE SET NULL,
  module_key TEXT,
  name TEXT NOT NULL,
  description TEXT,
  evidence TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_day TEXT NOT NULL,
  reviewed_day TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status, created_day DESC);

CREATE TABLE IF NOT EXISTS candidate_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  harness_id INTEGER NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  evidence TEXT,
  note TEXT,
  UNIQUE(candidate_id, harness_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: INITIAL_SCHEMA,
  },
  {
    version: 2,
    name: "sync_attempt_and_heartbeat",
    // last_sync_at used to be written when an attempt *started*, which made a
    // running sync look finished. Split it into last_attempt_at (start) and
    // last_sync_at (finished), and backfill from the sync_runs history.
    sql: `
ALTER TABLE harnesses ADD COLUMN last_attempt_at TEXT;
ALTER TABLE sync_runs ADD COLUMN heartbeat_at TEXT;

UPDATE harnesses SET last_attempt_at = last_sync_at WHERE last_sync_at IS NOT NULL;
UPDATE harnesses SET last_sync_at = (
  SELECT MAX(finished_at) FROM sync_runs
  WHERE sync_runs.harness_id = harnesses.id AND finished_at IS NOT NULL
);

UPDATE sync_runs SET heartbeat_at = COALESCE(finished_at, started_at);
`,
  },
  {
    version: 3,
    name: "explorations",
    // A feature exploration: a user proposition searched against the local
    // mirrors of the selected harnesses, with a persisted comparison report.
    sql: `
CREATE TABLE IF NOT EXISTS explorations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposition TEXT NOT NULL,
  harness_ids TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  matched_features TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'running',
  phase TEXT NOT NULL DEFAULT 'search',
  engine TEXT NOT NULL DEFAULT 'heuristic',
  report_md TEXT,
  evidence_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_explorations_created ON explorations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_explorations_status ON explorations(status, created_at);
`,
  },
  {
    version: 4,
    name: "feature_audits",
    // An on-demand AI re-audit of one feature: the engine reads every harness
    // mirror and rewrites the feature's support status, implementation details
    // and comparison summary. The catalog version is recorded for rollback.
    sql: `
CREATE TABLE IF NOT EXISTS feature_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  engine TEXT NOT NULL DEFAULT 'claude-code',
  version TEXT,
  result_json TEXT,
  report_md TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_feature_audits_feature ON feature_audits(feature_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_audits_status ON feature_audits(status, created_at);
`,
  },
];
