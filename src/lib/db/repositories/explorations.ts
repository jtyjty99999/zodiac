import type {
  Exploration,
  ExplorationEngine,
  ExplorationEvidence,
  ExplorationMatchedFeature,
  ExplorationPhase,
  ExplorationStatus,
} from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface ExplorationRow {
  id: number;
  proposition: string;
  harness_ids: string;
  keywords: string;
  matched_features: string;
  status: ExplorationStatus;
  phase: ExplorationPhase;
  engine: ExplorationEngine;
  report_md: string | null;
  evidence_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const LIST_COLUMNS =
  "id, proposition, harness_ids, keywords, matched_features, status, phase, engine, NULL AS report_md, NULL AS evidence_json, error, created_at, finished_at";

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is number => Number.isSafeInteger(item) && item > 0)
      : [];
  } catch {
    return [];
  }
}

function parseMatchedFeatures(raw: string): ExplorationMatchedFeature[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.id !== "number" ||
        typeof entry.key !== "string" ||
        typeof entry.name !== "string"
      ) {
        return [];
      }
      return [{ id: entry.id, key: entry.key, name: entry.name }];
    });
  } catch {
    return [];
  }
}

function parseEvidence(raw: string | null): ExplorationEvidence | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const evidence = value as Partial<ExplorationEvidence>;
    if (!Array.isArray(evidence.harnesses) || !Array.isArray(evidence.patterns)) return null;
    return {
      generatedAt: typeof evidence.generatedAt === "string" ? evidence.generatedAt : "",
      patterns: evidence.patterns.filter((item): item is string => typeof item === "string"),
      harnesses: evidence.harnesses,
      relatedFeatures: Array.isArray(evidence.relatedFeatures) ? evidence.relatedFeatures : [],
      truncated: evidence.truncated === true,
    };
  } catch {
    return null;
  }
}

function mapExploration(row: ExplorationRow): Exploration {
  return {
    id: row.id,
    proposition: row.proposition,
    harnessIds: parseNumberArray(row.harness_ids),
    keywords: parseStringArray(row.keywords),
    matchedFeatures: parseMatchedFeatures(row.matched_features),
    status: row.status,
    phase: row.phase,
    engine: row.engine,
    reportMd: row.report_md,
    evidence: parseEvidence(row.evidence_json),
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export interface CreateExplorationInput {
  proposition: string;
  harnessIds: number[];
  keywords: string[];
  matchedFeatures: ExplorationMatchedFeature[];
}

export function createExploration(db: Db = getDb(), input: CreateExplorationInput): Exploration {
  const result = db
    .prepare(
      `INSERT INTO explorations
         (proposition, harness_ids, keywords, matched_features, status, phase, engine, created_at)
       VALUES (?, ?, ?, ?, 'running', 'search', 'heuristic', ?)`,
    )
    .run(
      input.proposition,
      JSON.stringify(input.harnessIds),
      JSON.stringify(input.keywords),
      JSON.stringify(input.matchedFeatures),
      nowIso(),
    );
  const row = db
    .prepare("SELECT * FROM explorations WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as ExplorationRow;
  return mapExploration(row);
}

export function getExploration(db: Db = getDb(), id: number): Exploration | null {
  const row = db.prepare("SELECT * FROM explorations WHERE id = ?").get(id) as
    | ExplorationRow
    | undefined;
  return row ? mapExploration(row) : null;
}

/** Lists recent explorations without the (potentially large) report/evidence. */
export function listExplorations(db: Db = getDb(), limit = 30): Exploration[] {
  const rows = db
    .prepare(`SELECT ${LIST_COLUMNS} FROM explorations ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(limit) as ExplorationRow[];
  return rows.map(mapExploration);
}

export function updateExplorationPhase(
  db: Db = getDb(),
  id: number,
  phase: ExplorationPhase,
): void {
  db.prepare("UPDATE explorations SET phase = ? WHERE id = ? AND status = 'running'").run(
    phase,
    id,
  );
}

/** Replaces the search patterns while the exploration is still running. */
export function updateExplorationKeywords(db: Db = getDb(), id: number, keywords: string[]): void {
  db.prepare("UPDATE explorations SET keywords = ? WHERE id = ? AND status = 'running'").run(
    JSON.stringify(keywords),
    id,
  );
}

export interface FinishExplorationInput {
  status: Exclude<ExplorationStatus, "running">;
  engine?: ExplorationEngine;
  reportMd?: string | null;
  evidence?: ExplorationEvidence | null;
  error?: string | null;
}

export function finishExploration(
  db: Db = getDb(),
  id: number,
  input: FinishExplorationInput,
): void {
  db.prepare(
    `UPDATE explorations SET status = ?, phase = 'done', engine = COALESCE(?, engine),
       report_md = COALESCE(?, report_md),
       evidence_json = COALESCE(?, evidence_json),
       error = ?, finished_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.engine ?? null,
    input.reportMd ?? null,
    input.evidence ? JSON.stringify(input.evidence) : null,
    input.error ? input.error.slice(0, 1500) : null,
    nowIso(),
    id,
  );
}

/**
 * Marks running rows left behind by an exited process as failed. Rows that are
 * still executing in this process are excluded.
 */
export function failStaleExplorations(
  db: Db = getDb(),
  activeIds: number[] = [],
  olderThanMinutes = 10,
): number {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const active = [...new Set(activeIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const exclusion = active.length > 0 ? ` AND id NOT IN (${active.map(() => "?").join(", ")})` : "";
  const result = db
    .prepare(
      `UPDATE explorations SET status = 'failed', phase = 'done', finished_at = ?,
         error = COALESCE(error, 'Aborted: stale running exploration')
       WHERE status = 'running' AND created_at < ?${exclusion}`,
    )
    .run(nowIso(), cutoff, ...active);
  return result.changes;
}

/** Deletes a finished exploration. Running rows are protected. */
export function deleteExploration(db: Db = getDb(), id: number): boolean {
  const result = db
    .prepare("DELETE FROM explorations WHERE id = ? AND status != 'running'")
    .run(id);
  return result.changes > 0;
}

export function findRunningExploration(db: Db = getDb()): Exploration | null {
  const row = db
    .prepare("SELECT * FROM explorations WHERE status = 'running' ORDER BY id DESC LIMIT 1")
    .get() as ExplorationRow | undefined;
  return row ? mapExploration(row) : null;
}
