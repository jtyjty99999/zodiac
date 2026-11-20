import { ArrowRight, Boxes, Radio } from "lucide-react";
import Link from "next/link";
import SyncButton from "@/components/SyncButton";
import {
  CategoryBadge,
  EmptyState,
  MiniBars,
  PageHeader,
  RatingStars,
  RelativeTime,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { getMatrix } from "@/lib/catalog/matrix";
import { getDb } from "@/lib/db/client";
import { countOpenCandidates } from "@/lib/db/repositories/candidates";
import { latestCatalogVersion } from "@/lib/db/repositories/catalog";
import {
  countAllCommits,
  countCommitsByDay,
  countCommitsSince,
  latestCommits,
} from "@/lib/db/repositories/commits";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { listReleases } from "@/lib/db/repositories/releases";
import { listRunningSyncRuns, listSyncRuns } from "@/lib/db/repositories/syncRuns";
import { addDays, dateRange, toDay } from "@/lib/utils/time";

export const metadata = { title: "概览" };

const WEEK_DAYS = 7;
const CHART_DAYS = 14;

export default function OverviewPage() {
  const db = getDb();
  const today = toDay(new Date());
  const weekStart = addDays(today, -(WEEK_DAYS - 1));
  const chartDays = dateRange(today, CHART_DAYS);

  const harnesses = listHarnesses(db);
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const matrix = getMatrix(db);
  const baseline = latestCatalogVersion(db);

  const commits7d = harnesses.reduce(
    (sum, harness) => sum + countCommitsSince(db, harness.id, weekStart),
    0,
  );
  const openCandidates = countOpenCandidates(db);
  const coverage =
    matrix.coverage.length > 0
      ? matrix.coverage.reduce((sum, entry) => sum + entry.score, 0) / matrix.coverage.length
      : 0;

  const dayCounts = countCommitsByDay(db, { fromDay: chartDays[0], toDay: today });
  const countByDay = new Map(dayCounts.map((entry) => [entry.day, entry.count]));
  const chart = chartDays.map((day) => ({ day, count: countByDay.get(day) ?? 0 }));

  const recentCommits = latestCommits(db, 8);
  const releases = listReleases(db, undefined, 6);
  const recentRuns = listSyncRuns(db, undefined, 6);
  // Server-rendered running state: survives a refresh and lets the buttons
  // resume polling the exact runs instead of guessing from React state.
  const runningRuns = listRunningSyncRuns(db);
  const runningRunByHarness = new Map(runningRuns.map((run) => [run.harnessId, run]));

  return (
    <div>
      <PageHeader
        title="概览"
        description="跟踪主流 coding agent harness 的提交、发版与功能演进，维护功能矩阵与实现细节对比基线。"
        actions={
          <>
            {baseline ? (
              <Link href="/baseline" className="chip hover:text-ink">
                基线 {baseline.version}
              </Link>
            ) : null}
            <SyncButton all initialRunIds={runningRuns.map((run) => run.id)} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="跟踪 Harness"
          value={harnesses.length}
          hint={`${harnesses.filter((h) => h.enabled).length} 个启用`}
        />
        <StatCard
          label={`近 ${WEEK_DAYS} 日提交`}
          value={commits7d}
          accent="cyan"
          hint={`自 ${weekStart}`}
        />
        <StatCard
          label="待确认候选"
          value={openCandidates}
          accent="amber"
          hint="新功能待并入基线"
        />
        <StatCard
          label="平均覆盖率"
          value={`${coverage.toFixed(1)}%`}
          accent="emerald"
          hint={`${matrix.rows.length} 个功能点`}
        />
      </div>

      {harnesses.length === 0 ? (
        <EmptyState
          title="还没有跟踪任何 harness"
          hint="前往 Harness 管理添加仓库，或运行 pnpm seed 导入初始四端数据。"
        />
      ) : (
        <div className="mb-5 grid gap-3 md:grid-cols-2">
          {harnesses.map((harness) => {
            const week = countCommitsSince(db, harness.id, weekStart);
            const total = countAllCommits(db, harness.id);
            const runningRun = runningRunByHarness.get(harness.id);
            return (
              <section key={harness.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{harness.name}</h2>
                      <span className="chip font-mono">{harness.slug}</span>
                      {!harness.enabled ? <span className="chip">已停用</span> : null}
                      {runningRun ? (
                        <span className="chip border-warning/40 text-warning">
                          {runningRun.phase === "queued" ? "排队中" : "同步中"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted">
                      {harness.repoUrl}
                    </p>
                  </div>
                  <SyncButton
                    harnessId={harness.id}
                    compact
                    label="跟进"
                    initialRunIds={runningRun ? [runningRun.id] : undefined}
                  />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">近 7 日</div>
                    <div className="mt-0.5 font-semibold tabular-nums">{week}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">累计提交</div>
                    <div className="mt-0.5 font-semibold tabular-nums">{total}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {runningRun ? "本次同步" : "最后同步"}
                    </div>
                    <div className="mt-0.5">
                      {runningRun ? (
                        <span className="text-[11px] text-warning">进行中…</span>
                      ) : (
                        <RelativeTime iso={harness.lastSyncAt} />
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px] text-muted">
                  <span>
                    调度{" "}
                    {harness.scheduleMode === "off"
                      ? "关闭"
                      : harness.scheduleMode === "hourly"
                        ? "每小时"
                        : `每天 ${harness.dailyTime}`}
                  </span>
                  <Link href="/harnesses" className="inline-flex items-center gap-1 hover:text-ink">
                    管理 <ArrowRight size={11} />
                  </Link>
                </div>
                {harness.lastError ? (
                  <p className="mt-2 line-clamp-2 rounded-md bg-danger/10 px-2 py-1 text-[11px] text-danger">
                    {harness.lastError}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={`近 ${CHART_DAYS} 天提交`}
          action={
            <Link href="/daily" className="text-[11px] text-muted hover:text-ink">
              日更归档 →
            </Link>
          }
        >
          <MiniBars data={chart} hrefBase="/daily" />
        </SectionCard>

        <SectionCard
          title="最近提交"
          action={
            <Link href="/commits" className="text-[11px] text-muted hover:text-ink">
              全部提交 →
            </Link>
          }
        >
          {recentCommits.length === 0 ? (
            <p className="text-xs text-muted">还没有抓取到提交。点击「立即跟进」开始同步。</p>
          ) : (
            <ul className="space-y-2.5">
              {recentCommits.map((commit) => (
                <li key={commit.id} className="flex items-start gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/commits/${commit.id}`}
                      className="line-clamp-1 font-medium hover:text-accent"
                    >
                      {commit.subject}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                      <span>{harnessById.get(commit.harnessId)?.name ?? "未知"}</span>
                      <span>·</span>
                      <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                      <span>·</span>
                      <span>{commit.day}</span>
                    </div>
                  </div>
                  <CategoryBadge category={commit.category} />
                  <RatingStars rating={commit.rating} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="最近发版"
          action={<span className="text-[11px] text-muted">{releases.length} 条</span>}
        >
          {releases.length === 0 ? (
            <p className="text-xs text-muted">尚无发版记录。</p>
          ) : (
            <ul className="space-y-2">
              {releases.map((release) => (
                <li key={release.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="chip font-mono">{release.tag}</span>
                      <span className="text-muted">
                        {harnessById.get(release.harnessId)?.name ?? "未知"}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                      {release.name ?? release.tag}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">
                    {release.publishedAt ? release.publishedAt.slice(0, 10) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="同步运行"
          action={
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <Radio size={11} /> 最近 {recentRuns.length} 次
            </span>
          }
        >
          {recentRuns.length === 0 ? (
            <p className="text-xs text-muted">还没有同步记录。</p>
          ) : (
            <ul className="space-y-1.5">
              {recentRuns.map((run) => (
                <li key={run.id} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      run.status === "success"
                        ? "bg-success"
                        : run.status === "failed"
                          ? "bg-danger"
                          : "animate-pulse bg-warning"
                    }`}
                  />
                  <span className="w-20 shrink-0 truncate">
                    {harnessById.get(run.harnessId)?.name ?? `#${run.harnessId}`}
                  </span>
                  <span className="text-muted">{run.trigger}</span>
                  <span className="text-muted">{run.phase}</span>
                  <span className="ml-auto tabular-nums text-muted">
                    +{run.newCommits} 提交 / +{run.newReleases} 发版
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <section className="card mt-4 flex flex-wrap items-center gap-3 px-4 py-3 text-xs text-muted">
        <Boxes size={14} className="text-accent" />
        <span>
          功能矩阵覆盖 {matrix.rows.length} 个功能点、{matrix.modules.length} 个模块。
        </span>
        <Link
          href="/features"
          className="ml-auto inline-flex items-center gap-1 text-ink hover:text-accent"
        >
          查看功能矩阵 <ArrowRight size={12} />
        </Link>
      </section>
    </div>
  );
}
