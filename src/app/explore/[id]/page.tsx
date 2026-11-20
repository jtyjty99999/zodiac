import Link from "next/link";
import { notFound } from "next/navigation";
import ExplorationActions from "@/components/ExplorationActions";
import ExplorationLive from "@/components/ExplorationLive";
import {
  ExplorationStatusBadge,
  MarkdownView,
  PageHeader,
  SectionCard,
  StatCard,
} from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { failStaleExplorations, getExploration } from "@/lib/db/repositories/explorations";
import { activeExplorationIds } from "@/lib/explore/run";
import { parseId } from "@/lib/http/routeHelpers";
import type { ExplorationEngine, ExplorationHarnessEvidence, SupportStatus } from "@/lib/types";

export const metadata = { title: "探索详情" };

const ENGINE_LABELS: Record<ExplorationEngine, string> = {
  heuristic: "启发式检索",
  "heuristic+claude": "启发式 + Claude 综合",
  claude: "Claude 自主探索",
  "claude-code": "本地 Claude Code 探索",
  codex: "本地 Codex 探索",
  deepseek: "本地 DeepSeek Harness 探索",
};

const EVIDENCE_STATUS_LABELS: Record<ExplorationHarnessEvidence["status"], string> = {
  ok: "已探索",
  empty: "未命中",
  missing: "镜像未同步",
  error: "探索失败",
};

const SUPPORT_LABELS: Record<SupportStatus, string> = {
  yes: "支持",
  partial: "部分支持",
  no: "不支持",
  unknown: "待确认",
};

function HarnessEvidence({ entry }: { entry: ExplorationHarnessEvidence }) {
  const related = entry.status === "ok" || entry.status === "empty";
  return (
    <details className="rounded-lg border border-line">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span className="font-medium">{entry.name}</span>
        <span className="chip font-mono">{entry.slug}</span>
        <span className="chip">{EVIDENCE_STATUS_LABELS[entry.status]}</span>
        <span className="text-muted">
          {entry.totalFiles} 文件 / {entry.totalMatches} 行
        </span>
        {entry.rev ? (
          <span className="font-mono text-[10px] text-muted">rev {entry.rev.slice(0, 8)}</span>
        ) : null}
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-2.5">
        {entry.note ? <p className="text-[11px] text-warning">{entry.note}</p> : null}
        {entry.files.map((file) => (
          <div key={file.path}>
            <p className="break-all font-mono text-[11px]">
              {file.path} <span className="text-muted">（{file.total} 行命中）</span>
            </p>
            <div className="mt-1 space-y-1">
              {file.snippets.map((snippet) => (
                <pre
                  key={snippet.line}
                  className="overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-[10px] leading-relaxed"
                >
                  {snippet.text}
                </pre>
              ))}
            </div>
          </div>
        ))}
        {entry.files.length === 0 ? (
          <p className="text-[11px] text-muted">
            {related ? "未检索到包含这些关键词的代码。" : "该 harness 未产生可用证据。"}
          </p>
        ) : null}
        {entry.truncated ? (
          <p className="text-[11px] text-muted">结果因上限被截断，仅展示部分命中。</p>
        ) : null}
      </div>
    </details>
  );
}

export default async function ExplorationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) notFound();

  const db = getDb();
  failStaleExplorations(db, activeExplorationIds());
  const exploration = getExploration(db, id);
  if (!exploration) notFound();

  const evidence = exploration.evidence;
  const searchedCount =
    evidence?.harnesses.filter((entry) => entry.status === "ok" || entry.status === "empty")
      .length ?? 0;
  const isRunning = exploration.status === "running";

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Link href="/explore" className="hover:text-ink">
          功能探索
        </Link>
        <span>/</span>
        <span className="font-mono">#{exploration.id}</span>
      </div>

      <PageHeader
        title={exploration.proposition}
        description={`${ENGINE_LABELS[exploration.engine]} · ${exploration.harnessIds.length} 个 harness · 创建于 ${exploration.createdAt.slice(0, 16).replace("T", " ")}`}
        actions={isRunning ? undefined : <ExplorationActions explorationId={exploration.id} />}
      />

      {isRunning ? (
        <div className="mb-5">
          <ExplorationLive explorationId={exploration.id} initialPhase={exploration.phase} />
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="状态"
          value={<ExplorationStatusBadge status={exploration.status} />}
          hint={
            exploration.finishedAt
              ? `完成于 ${exploration.finishedAt.slice(0, 16).replace("T", " ")}`
              : undefined
          }
        />
        <StatCard
          label="引擎"
          value={<span className="text-sm">{ENGINE_LABELS[exploration.engine]}</span>}
        />
        <StatCard
          label="检索范围"
          value={<span className="text-sm">{exploration.harnessIds.length} 个 harness</span>}
          hint={evidence ? `${searchedCount} 个完成检索` : undefined}
          accent="cyan"
        />
        <StatCard
          label="关键词"
          value={<span className="text-sm">{exploration.keywords.length} 个</span>}
          hint={
            evidence
              ? `共命中 ${evidence.harnesses.reduce((sum, entry) => sum + entry.totalFiles, 0)} 个文件`
              : undefined
          }
          accent="emerald"
        />
      </div>

      {exploration.keywords.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">检索词</span>
          {exploration.keywords.map((keyword) => (
            <span key={keyword} className="chip font-mono text-[10px]">
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      {exploration.matchedFeatures.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">相关功能点</span>
          {exploration.matchedFeatures.map((feature) => (
            <Link
              key={feature.id}
              href={`/compare/${encodeURIComponent(feature.key)}`}
              className="chip hover:text-accent"
            >
              {feature.name}
            </Link>
          ))}
        </div>
      ) : null}

      {exploration.status === "failed" ? (
        <SectionCard title="失败原因" className="mb-4">
          <p className="whitespace-pre-wrap break-words text-xs text-danger">
            {exploration.error ?? "未知错误"}
          </p>
        </SectionCard>
      ) : null}

      {exploration.reportMd ? (
        <SectionCard title="分析报告" className="mb-4">
          <MarkdownView content={exploration.reportMd} />
        </SectionCard>
      ) : isRunning ? (
        <SectionCard title="分析报告" className="mb-4">
          <p className="text-xs text-muted">报告生成中，完成后页面会自动刷新。</p>
        </SectionCard>
      ) : null}

      <SectionCard title="代码证据">
        <p className="mb-2 text-[11px] text-muted">
          报告是主要结论；这里保留原始代码片段供溯源，默认折叠。
        </p>
        {evidence ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">
              展开代码证据（{evidence.harnesses.length} 个 harness ·{" "}
              {evidence.harnesses.reduce((sum, entry) => sum + entry.totalFiles, 0)} 个文件）
            </summary>
            <div className="mt-2 space-y-2">
              {evidence.relatedFeatures.length > 0 ? (
                <p className="text-[11px] text-muted">
                  功能目录支持情况：
                  {evidence.relatedFeatures
                    .map((feature) => {
                      const statuses = Object.entries(feature.support)
                        .map(([slug, status]) => `${slug}=${SUPPORT_LABELS[status]}`)
                        .join("，");
                      return `${feature.name}（${statuses || "无记录"}）`;
                    })
                    .join("；")}
                </p>
              ) : null}
              {evidence.harnesses.map((entry) => (
                <HarnessEvidence key={`${entry.harnessId}:${entry.slug}`} entry={entry} />
              ))}
              {evidence.harnesses.length === 0 ? (
                <p className="text-xs text-muted">没有证据记录。</p>
              ) : null}
              {evidence.truncated ? (
                <p className="text-[11px] text-warning">部分证据因检索上限被截断。</p>
              ) : null}
            </div>
          </details>
        ) : (
          <p className="text-xs text-muted">
            {isRunning ? "证据正在构建。" : "本次探索没有留下证据数据。"}
          </p>
        )}
      </SectionCard>
    </div>
  );
}
