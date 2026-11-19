import fs from "node:fs";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import {
  getCandidate,
  listCandidateChecks,
  upsertCandidateCheck,
} from "../db/repositories/candidates";
import { listHarnesses } from "../db/repositories/harnesses";
import { mirrorPath, runGit, sanitizeText } from "../git/mirror";
import type { CandidateCheck } from "../types";

export function searchTerms(name: string, description?: string | null): string[] {
  const cleaned = name.replace(/^[a-zA-Z]+(?:\([^)]*\))?!?:\s*/, "");
  const latin = cleaned.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) ?? [];
  const chinese = cleaned.match(/[一-鿿]{2,}/g) ?? [];
  const fromDescription = (description ?? "").match(/[A-Za-z][A-Za-z0-9_-]{5,}/g) ?? [];

  return [
    ...new Set([...latin.slice(0, 3), ...chinese.slice(0, 1), ...fromDescription.slice(0, 1)]),
  ]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 3);
}

export interface MatchEvidence {
  sha: string;
  date: string;
  subject: string;
}

export async function searchCommits(
  dir: string,
  term: string,
  limit = 5,
): Promise<MatchEvidence[]> {
  const result = await runGit(
    [
      "--git-dir",
      dir,
      "log",
      "--all",
      `--max-count=${limit}`,
      "--regexp-ignore-case",
      "--fixed-strings",
      `--grep=${term}`,
      "--format=%H%x00%cI%x00%s",
    ],
    { timeoutMs: 30_000 },
  );

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split("\u0000");
      return {
        sha: sanitizeText(sha, 40),
        date: sanitizeText(date, 40),
        subject: sanitizeText(subject, 300),
      };
    })
    .filter((match) => /^[0-9a-f]{7,40}$/.test(match.sha));
}

export const CROSS_CHECK_NOTE =
  "基于各仓库最近提交信息的全文检索，仅作提示；未命中不代表不具备该能力。";

export async function crossCheckCandidate(
  db: Db = getDb(),
  candidateId: number,
): Promise<CandidateCheck[]> {
  const candidate = getCandidate(db, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);

  const terms = searchTerms(candidate.name, candidate.description);
  const harnesses = listHarnesses(db);
  const results: CandidateCheck[] = [];

  for (const harness of harnesses) {
    if (harness.id === candidate.harnessId) continue;

    const dir = mirrorPath(harness.slug);
    if (!fs.existsSync(dir)) {
      results.push(
        upsertCandidateCheck(db, {
          candidateId,
          harnessId: harness.id,
          status: "unknown",
          evidence: null,
          note: "尚未建立本地镜像",
        }),
      );
      continue;
    }

    const matches: MatchEvidence[] = [];
    for (const term of terms) {
      try {
        const found = await searchCommits(dir, term, 3);
        matches.push(...found);
      } catch {
        // A failed search only weakens the advisory signal.
      }
      if (matches.length >= 3) break;
    }

    const unique = [...new Map(matches.map((match) => [match.sha, match])).values()].slice(0, 3);
    results.push(
      upsertCandidateCheck(db, {
        candidateId,
        harnessId: harness.id,
        status: unique.length > 0 ? "yes" : "unknown",
        evidence:
          unique
            .map((match) => `${match.sha.slice(0, 8)} ${match.date.slice(0, 10)} ${match.subject}`)
            .join("\n") || null,
        note:
          unique.length > 0 ? CROSS_CHECK_NOTE : `未检索到：${terms.join(", ") || "（无检索词）"}`,
      }),
    );
  }

  return results.length > 0 ? results : listCandidateChecks(db, candidateId);
}
