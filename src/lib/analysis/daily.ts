import type { Db } from "../db/client";
import { listCommits } from "../db/repositories/commits";
import { rebuildDailyReport, setDailySummary } from "../db/repositories/daily";
import type { CommitCategory, DailyReport } from "../types";
import { categoryLabel } from "./classify";

const TOP_COMMITS = 3;

export function buildDailySummary(db: Db, harnessId: number, day: string): string {
  const commits = listCommits(db, { harnessId, fromDay: day, toDay: day, limit: 200 });
  if (commits.length === 0) return "";

  const counts: Record<string, number> = {};
  for (const commit of commits) {
    const key = commit.category ?? "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const breakdown = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${categoryLabel(category as CommitCategory)} ${count}`)
    .join(" / ");

  const top = [...commits]
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        b.insertions + b.deletions - (a.insertions + a.deletions),
    )
    .slice(0, TOP_COMMITS);

  const lines = [`> 当日共 ${commits.length} 次提交：${breakdown}。`];
  if (top.length > 0) {
    lines.push("", "**重点项目**");
    for (const commit of top) {
      const stars = commit.rating ? `${"★".repeat(commit.rating)} ` : "";
      lines.push(`- ${stars}${commit.subject} (\`${commit.sha.slice(0, 7)}\`)`);
    }
  }
  return lines.join("\n");
}

/**
 * Rebuilds a day's counters and refreshes its digest. Called for every
 * affected day after ingestion, so reports also exist when analysis is off.
 */
export function refreshDailyReport(db: Db, harnessId: number, day: string): DailyReport {
  const report = rebuildDailyReport(db, harnessId, day);
  const summary = buildDailySummary(db, harnessId, day);
  if (summary) setDailySummary(db, harnessId, day, summary);
  return report;
}
