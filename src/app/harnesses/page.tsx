import HarnessManager, { type SyncRunSummary } from "@/components/HarnessManager";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { listSyncRuns } from "@/lib/db/repositories/syncRuns";
import { getTimezone } from "@/lib/utils/time";

export const metadata = { title: "Harness 管理" };

const RUN_LIMIT = 100;

export default function HarnessesPage() {
  const db = getDb();
  const harnesses = listHarnesses(db);
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));

  const runs: SyncRunSummary[] = listSyncRuns(db, undefined, RUN_LIMIT).map((run) => ({
    id: run.id,
    harnessId: run.harnessId,
    harnessName: harnessById.get(run.harnessId)?.name ?? `Harness #${run.harnessId}`,
    trigger: run.trigger,
    phase: run.phase,
    status: run.status,
    newCommits: run.newCommits,
    newReleases: run.newReleases,
    startedAt: run.startedAt,
    error: run.error,
  }));

  const schedulerEnabled = process.env.ZODIAC_SCHEDULER !== "off";

  return (
    <div>
      <PageHeader
        title="Harness 管理"
        description="维护被跟踪的 coding agent 仓库，配置分支、调度与回填范围，并查看同步历史。"
        actions={
          <span className="chip">
            调度器 {schedulerEnabled ? "运行中" : "已关闭"} · 时区 {getTimezone()}
          </span>
        }
      />
      <HarnessManager harnesses={harnesses} runs={runs} />
      <p className="mt-4 text-[11px] text-muted">
        提示：同步会在后台抓取裸镜像并增量入库；首次同步较慢，可在概览页观察运行状态。
      </p>
    </div>
  );
}
