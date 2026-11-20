import Link from "next/link";
import ExplorationForm from "@/components/ExplorationForm";
import {
  EmptyState,
  ExplorationStatusBadge,
  PageHeader,
  RelativeTime,
  SectionCard,
} from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { failStaleExplorations, listExplorations } from "@/lib/db/repositories/explorations";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { activeExplorationIds } from "@/lib/explore/run";
import type { ExplorationEngine } from "@/lib/types";

export const metadata = { title: "功能探索" };

const ENGINE_LABELS: Record<ExplorationEngine, string> = {
  heuristic: "启发式",
  "heuristic+claude": "启发式 + Claude",
};

export default function ExplorePage() {
  const db = getDb();
  failStaleExplorations(db, activeExplorationIds());

  const harnesses = listHarnesses(db);
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const explorations = listExplorations(db, 30);

  const scopeText = (harnessIds: number[]): string => {
    if (harnessIds.length === 0) return "全部 harness";
    return harnessIds.map((id) => harnessById.get(id)?.name ?? `已删除 #${id}`).join(" / ");
  };

  return (
    <div>
      <PageHeader
        title="功能探索"
        description="输入一个命题，系统会把命题转换成检索词，在所选 harness 的本地镜像中离线查找代码证据，并生成跨 harness 的对比报告。配置 AI 后将基于证据做 Claude 综合，否则输出启发式报告。"
      />

      <SectionCard title="发起探索">
        <ExplorationForm
          harnesses={harnesses.map((harness) => ({
            id: harness.id,
            name: harness.name,
            enabled: harness.enabled,
          }))}
        />
      </SectionCard>

      <SectionCard title="历史探索" className="mt-6">
        {explorations.length === 0 ? (
          <EmptyState title="还没有探索记录" hint="输入命题并提交后，报告会自动保存在这里。" />
        ) : (
          <ul className="divide-y divide-line">
            {explorations.map((exploration) => (
              <li key={exploration.id}>
                <Link
                  href={`/explore/${exploration.id}`}
                  className="flex flex-col gap-1.5 py-3 transition-colors first:pt-0 last:pb-0 hover:text-accent"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <ExplorationStatusBadge status={exploration.status} />
                    <span className="text-sm font-medium">{exploration.proposition}</span>
                  </span>
                  <span className="text-[11px] text-muted">
                    {scopeText(exploration.harnessIds)} · {ENGINE_LABELS[exploration.engine]} ·{" "}
                    <RelativeTime iso={exploration.createdAt} />
                    {exploration.status === "running"
                      ? ` · ${exploration.phase === "synthesize" ? "综合中" : "检索中"}`
                      : null}
                  </span>
                  {exploration.keywords.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {exploration.keywords.slice(0, 6).map((keyword) => (
                        <span key={keyword} className="chip font-mono text-[10px]">
                          {keyword}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
