import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { EmptyState, MiniBars, PageHeader, StatCard } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { countCommitsByDay } from "@/lib/db/repositories/commits";
import { listDailyDaySummaries } from "@/lib/db/repositories/daily";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { dateRange, toDay } from "@/lib/utils/time";

export const metadata = { title: "日更归档" };

const ARCHIVE_LIMIT = 90;
const CHART_DAYS = 30;

export default function DailyIndexPage() {
  const db = getDb();
  const today = toDay(new Date());
  const harnesses = listHarnesses(db);
  const summaries = listDailyDaySummaries(db, ARCHIVE_LIMIT);

  const chartDays = dateRange(today, CHART_DAYS);
  const counts = countCommitsByDay(db, { fromDay: chartDays[0], toDay: today });
  const countByDay = new Map(counts.map((entry) => [entry.day, entry.count]));
  const chart = chartDays.map((day) => ({ day, count: countByDay.get(day) ?? 0 }));

  const totalCommits = summaries.reduce((sum, entry) => sum + entry.commitCount, 0);

  return (
    <div>
      <PageHeader
        title="日更归档"
        description="按天汇总各 harness 的提交、分类与发版，形成可回溯的演进日志。"
        actions={
          <Link href={`/daily/${today}`} className="btn btn-primary">
            <CalendarDays size={14} /> 今天
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="归档天数" value={summaries.length} hint={`最多展示 ${ARCHIVE_LIMIT} 天`} />
        <StatCard label="归档提交" value={totalCommits} accent="cyan" />
        <StatCard label="跟踪 Harness" value={harnesses.length} accent="emerald" />
      </div>

      <section className="card mb-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">近 {CHART_DAYS} 天提交趋势</h2>
          <span className="text-[11px] text-muted">点击柱状进入当日归档</span>
        </div>
        <MiniBars data={chart} hrefBase="/daily" />
      </section>

      {summaries.length === 0 ? (
        <EmptyState title="还没有归档数据" hint="同步 harness 后，系统会自动按天重建日报。" />
      ) : (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">归档列表</h2>
            <span className="chip">{summaries.length} 天</span>
          </div>
          <ul className="divide-y divide-line/60">
            {summaries.map((entry) => (
              <li key={entry.day}>
                <Link
                  href={`/daily/${entry.day}`}
                  className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                >
                  <span className="w-28 font-mono text-[13px]">{entry.day}</span>
                  <span className="text-[11px] text-muted">
                    {entry.harnessCount} 个 harness 有提交
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-muted">
                    <strong className="text-ink">{entry.commitCount}</strong> 次提交
                  </span>
                  <span className="text-[11px] text-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-4 text-[11px] text-muted">提示：当天的归档会随每次同步自动重建。</p>
    </div>
  );
}
