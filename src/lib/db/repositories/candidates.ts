import type { Candidate, CandidateCheck, CandidateStatus, SupportStatus } from "../../types";
import { nowIso } from "../../utils/time";
import { type Db, getDb } from "../client";

interface CandidateRow {
  id: number;
  harness_id: number;
  commit_id: number | null;
  module_key: string | null;
  name: string;
  description: string | null;
  evidence: string | null;
  confidence: number;
  status: CandidateStatus;
  created_day: string;
  reviewed_day: string | null;
  created_at: string;
}

interface CheckRow {
  id: number;
  candidate_id: number;
  harness_id: number;
  status: SupportStatus;
  evidence: string | null;
  note: string | null;
}

function mapCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    harnessId: row.harness_id,
    commitId: row.commit_id,
    moduleKey: row.module_key,
    name: row.name,
    description: row.description,
    evidence: row.evidence,
    confidence: row.confidence,
    status: row.status,
    createdDay: row.created_day,
    reviewedDay: row.reviewed_day,
    createdAt: row.created_at,
  };
}

function mapCheck(row: CheckRow): CandidateCheck {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    harnessId: row.harness_id,
    status: row.status,
    evidence: row.evidence,
    note: row.note,
  };
}

export interface CandidateInput {
  harnessId: number;
  commitId?: number | null;
  moduleKey?: string | null;
  name: string;
  description?: string | null;
  evidence?: string | null;
  confidence?: number;
  createdDay: string;
}

export function createCandidate(db: Db = getDb(), input: CandidateInput): Candidate {
  const existing = db
    .prepare("SELECT * FROM candidates WHERE harness_id = ? AND name = ? AND status = 'pending'")
    .get(input.harnessId, input.name) as CandidateRow | undefined;
  if (existing) return mapCandidate(existing);

  // Re-analyzing the same commit must not resurface a candidate the user has
  // already accepted or rejected.
  if (input.commitId !== undefined && input.commitId !== null) {
    const reviewed = db
      .prepare(
        "SELECT * FROM candidates WHERE harness_id = ? AND name = ? AND commit_id = ? AND status != 'pending'",
      )
      .get(input.harnessId, input.name, input.commitId) as CandidateRow | undefined;
    if (reviewed) return mapCandidate(reviewed);
  }

  const result = db
    .prepare(
      `INSERT INTO candidates
         (harness_id, commit_id, module_key, name, description, evidence, confidence, created_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.harnessId,
      input.commitId ?? null,
      input.moduleKey ?? null,
      input.name,
      input.description ?? null,
      input.evidence ?? null,
      input.confidence ?? 0,
      input.createdDay,
      nowIso(),
    );

  const row = db
    .prepare("SELECT * FROM candidates WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as CandidateRow;
  return mapCandidate(row);
}

export function getCandidate(db: Db = getDb(), id: number): Candidate | null {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as
    | CandidateRow
    | undefined;
  return row ? mapCandidate(row) : null;
}

export function listCandidates(db: Db = getDb(), status?: CandidateStatus): Candidate[] {
  const rows = status
    ? (db
        .prepare("SELECT * FROM candidates WHERE status = ? ORDER BY created_day DESC, id DESC")
        .all(status) as CandidateRow[])
    : (db
        .prepare("SELECT * FROM candidates ORDER BY created_day DESC, id DESC")
        .all() as CandidateRow[]);
  return rows.map(mapCandidate);
}

export function countOpenCandidates(db: Db = getDb(), harnessId?: number): number {
  const row =
    harnessId === undefined
      ? (db.prepare("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending'").get() as {
          count: number;
        })
      : (db
          .prepare(
            "SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending' AND harness_id = ?",
          )
          .get(harnessId) as { count: number });
  return row.count;
}

export function updateCandidateStatus(
  db: Db = getDb(),
  id: number,
  status: Exclude<CandidateStatus, "pending">,
  reviewedDay: string,
): void {
  db.prepare("UPDATE candidates SET status = ?, reviewed_day = ? WHERE id = ?").run(
    status,
    reviewedDay,
    id,
  );
}

export function upsertCandidateCheck(
  db: Db = getDb(),
  input: {
    candidateId: number;
    harnessId: number;
    status: SupportStatus;
    evidence?: string | null;
    note?: string | null;
  },
): CandidateCheck {
  db.prepare(
    `INSERT INTO candidate_checks (candidate_id, harness_id, status, evidence, note)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id, harness_id) DO UPDATE SET
       status = excluded.status, evidence = excluded.evidence, note = excluded.note`,
  ).run(
    input.candidateId,
    input.harnessId,
    input.status,
    input.evidence ?? null,
    input.note ?? null,
  );

  const row = db
    .prepare("SELECT * FROM candidate_checks WHERE candidate_id = ? AND harness_id = ?")
    .get(input.candidateId, input.harnessId) as CheckRow;
  return mapCheck(row);
}

export function listCandidateChecks(db: Db = getDb(), candidateId: number): CandidateCheck[] {
  return (
    db
      .prepare("SELECT * FROM candidate_checks WHERE candidate_id = ? ORDER BY harness_id")
      .all(candidateId) as CheckRow[]
  ).map(mapCheck);
}
