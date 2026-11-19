import { analyzeCommitById } from "../src/lib/analysis";
import { crossCheckCandidate } from "../src/lib/analysis/crossCheck";
import { refreshDailyReport } from "../src/lib/analysis/daily";
import { getDb } from "../src/lib/db/client";
import { listCandidateChecks, listCandidates } from "../src/lib/db/repositories/candidates";
import { listHarnesses } from "../src/lib/db/repositories/harnesses";

function usage(): never {
  process.stderr.write("Usage: pnpm reanalyze [--reset-candidates] [--harness <slug>]\n");
  process.exit(1);
}

interface CommitRow {
  id: number;
  harness_id: number;
  day: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg !== "--reset-candidates" && arg !== "--harness") usage();
  }
  const resetCandidates = args.includes("--reset-candidates");
  const harnessIndex = args.indexOf("--harness");
  const slug = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;
  if (harnessIndex >= 0 && !slug) usage();

  const db = getDb();

  if (resetCandidates) {
    const removed = db.transaction(() => {
      db.prepare(
        `DELETE FROM candidate_checks
         WHERE candidate_id IN (SELECT id FROM candidates WHERE status = 'pending')`,
      ).run();
      return db.prepare("DELETE FROM candidates WHERE status = 'pending'").run().changes;
    })();
    process.stdout.write(`Removed ${removed} pending candidates.\n`);
  }

  const rows = (
    slug
      ? db
          .prepare(
            `SELECT commits.id, commits.harness_id, commits.day FROM commits
             JOIN harnesses ON harnesses.id = commits.harness_id
             WHERE harnesses.slug = ?
             ORDER BY commits.committer_date ASC, commits.id ASC`,
          )
          .all(slug)
      : db
          .prepare("SELECT id, harness_id, day FROM commits ORDER BY committer_date ASC, id ASC")
          .all()
  ) as CommitRow[];

  process.stdout.write(`Re-analyzing ${rows.length} commits with the heuristic engine…\n`);

  let analyzed = 0;
  let candidates = 0;
  for (const row of rows) {
    const outcome = await analyzeCommitById(db, row.id, {
      force: true,
      useAi: false,
      daily: false,
    });
    if (!outcome) continue;
    analyzed += 1;
    if (outcome.candidateId) candidates += 1;
  }

  const days = new Set(rows.map((row) => `${row.harness_id}:${row.day}`));
  for (const key of days) {
    const [harnessId, day] = key.split(":");
    refreshDailyReport(db, Number(harnessId), day);
  }

  const harnesses = listHarnesses(db);
  const targetHarness = slug ? harnesses.find((entry) => entry.slug === slug) : undefined;
  const targets = slug
    ? listCandidates(db, "pending").filter(
        (candidate) => targetHarness !== undefined && candidate.harnessId === targetHarness.id,
      )
    : listCandidates(db, "pending");
  let crossChecked = 0;
  for (const candidate of targets) {
    if (listCandidateChecks(db, candidate.id).length >= harnesses.length - 1) continue;
    try {
      await crossCheckCandidate(db, candidate.id);
      crossChecked += 1;
    } catch {
      // Cross-checking is advisory; a failure must not abort the run.
    }
  }

  process.stdout.write(
    `Done: ${analyzed} analyzed, ${candidates} new candidates, ${crossChecked} cross-checked.\n`,
  );
  db.close();
}

void main();
