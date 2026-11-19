import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CATEGORY_STYLES,
  CategoryBadge,
  EmptyState,
  MarkdownView,
  PageHeader,
  RatingStars,
} from "@/components/ui";
import { categoryLabel } from "@/lib/analysis/classify";
import { getDb } from "@/lib/db/client";
import { listCommits } from "@/lib/db/repositories/commits";
import { getDailyReports, listAvailableDays } from "@/lib/db/repositories/daily";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { listReleases } from "@/lib/db/repositories/releases";
import { COMMIT_CATEGORIES, type CommitCategory } from "@/lib/types";
import { toDay } from "@/lib/utils/time";

export const metadata = { title: "日更详情" };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COMMITS = 400;

function parseCategoryCounts(raw: string): Partial<Record<CommitCategory, number>> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const counts: Partial<Record<CommitCategory, number>> = {};
    for (const category of COMMIT_CATEGORIES) {
      const entry = (value as Record<string, unknown>)[category];
      if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
        counts[category] = entry;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

export default async function DailyDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!DAY_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    notFound();
  }

  const db = getDb();
  const harnesses = listHarnesses(db);
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));

  const reports = getDailyReports(db, date);
  const commits = listCommits(db, { fromDay: date, toDay: date, limit: MAX_COMMITS });
  const releases = listReleases(db, undefined, 200).filter(
    (release) => release.publishedAt && toDay(release.publishedAt) === date,
  );

  const days = listAvailableDays(db, 400);
  const index = days.indexOf(date);
  const newer = index > 0 ? days[index - 1] : null;
  const older = index >= 0 && index < days.length - 1 ? days[index + 1] : null;

  const commitsByHarness = new Map<number, typeof commits>();
  for (const commit of commits) {
    const list = commitsByHarness.get(commit.harnessId) ?? [];
    list.push(commit);
    commitsByHarness.set(commit.harnessId, list);
  }

  const reportByHarness = new Map(reports.map((report) => [report.harnessId, report]));
  const harnessIds = [...new Set([...reportByHarness.keys(), ...commitsByHarness.keys()])];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Link href="/daily" className="hover:text-ink">
          日更归档
        </Link>
        <span>/</span>
        <span className="font-mono">{date}</span>
      </div>

      <PageHeader
        title={`${date} 日报`}
        description={`${commits.length} 次提交 · ${harnessIds.length} 个 harness · ${releases.length} 个发版`}
        actions={
          <>
            {older ? (
              <Link href={`/daily/${older}`} className="btn">
                <ArrowLeft size={13} /> {older}
              </Link>
            ) : null}
            {newer ? (
              <Link href={`/daily/${newer}`} className="btn">
                {newer} <ArrowRight size={13} />
              </Link>
            ) : null}
          </>
        }
      />

      {harnessIds.length === 0 ? (
        <EmptyState title="该日期没有记录" hint="可能当天没有提交，或尚未同步。" />
      ) : (
        <div className="space-y-4">
          {harnessIds.map((harnessId) => {
            const harness = harnessById.get(harnessId);
            const report = reportByHarness.get(harnessId);
            const harnessCommits = commitsByHarness.get(harnessId) ?? [];
            const counts = report ? parseCategoryCounts(report.categoryCounts) : {};
            return (
              <section key={harnessId} className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">
                      {harness?.name ?? `Harness #${harnessId}`}
                    </h2>
                    <span className="chip font-mono">{harness?.slug ?? harnessId}</span>
                    <span className="chip">
                      {report?.commitCount ?? harnessCommits.length} 次提交
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMIT_CATEGORIES.filter((category) => counts[category]).map((category) => (
                      <span
                        key={category}
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] ${CATEGORY_STYLES[category]}`}
                      >
                        {categoryLabel(category)} {counts[category]}
                      </span>
                    ))}
                  </div>
                </div>

                {report?.summaryMd ? (
                  <div className="border-b border-line/60 px-4 py-3">
                    <MarkdownView content={report.summaryMd} />
                  </div>
                ) : null}

                {harnessCommits.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted">无提交明细。</p>
                ) : (
                  <ul className="divide-y divide-line/50">
                    {harnessCommits.map((commit) => (
                      <li key={commit.id}>
                        <Link
                          href={`/commits/${commit.id}`}
                          className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs transition-colors hover:bg-surface-2/60"
                        >
                          <span className="font-mono text-[11px] text-muted">
                            {commit.sha.slice(0, 7)}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {commit.subject}
                          </span>
                          <span className="text-[10px] text-muted">{commit.author}</span>
                          <CategoryBadge category={commit.category} />
                          <RatingStars rating={commit.rating} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {releases.length > 0 ? (
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold">当日发版</h2>
              <ul className="space-y-2">
                {releases.map((release) => (
                  <li key={release.id} className="flex items-center gap-2 text-xs">
                    <span className="chip font-mono">{release.tag}</span>
                    <span className="text-muted">
                      {harnessById.get(release.harnessId)?.name ?? "未知"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted">{release.name}</span>
                    {release.url ? (
                      <a
                        href={release.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-accent hover:underline"
                      >
                        查看
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
