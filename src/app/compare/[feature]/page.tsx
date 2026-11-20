import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import FeatureAuditButton from "@/components/FeatureAuditButton";
import SupportEditor from "@/components/SupportEditor";
import { MarkdownView, PageHeader, SupportBadge } from "@/components/ui";
import { getCompareView } from "@/lib/catalog/matrix";
import { getDb } from "@/lib/db/client";
import { latestFeatureAudit } from "@/lib/db/repositories/featureAudits";
import { featureAuditEngineLabel, featureAuditStatusLabel } from "@/lib/features/labels";

export const metadata = { title: "功能对比" };

function formatAuditTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export default async function CompareFeaturePage({
  params,
}: {
  params: Promise<{ feature: string }>;
}) {
  const { feature: rawKey } = await params;
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    notFound();
  }
  const view = getCompareView(key);
  if (!view) notFound();
  const latestAudit = latestFeatureAudit(getDb(), view.feature.id);

  const evidenceLines = (value: string | null): string[] =>
    (value ?? "")
      .split(/\n|,\s*/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Link href="/compare" className="hover:text-ink">
          实现对比
        </Link>
        <span>/</span>
        <span>{view.module.name}</span>
      </div>

      <PageHeader
        title={view.feature.name}
        description={view.feature.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip font-mono">{view.feature.key}</span>
            {view.deepDive ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[11px] text-cyan">
                <Sparkles size={11} /> 深挖对比
              </span>
            ) : null}
            {view.feature.updatedDay ? (
              <span className="chip">更新于 {view.feature.updatedDay}</span>
            ) : null}
          </div>
        }
      />

      <section className="card mb-5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold">AI 重审</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              模型会读取每个 harness
              的代码快照，重新判断支持状态、整理实现细节与横向差异，并直接写入功能矩阵、生成可回滚的基线版本。
            </p>
            {latestAudit ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                <span className="chip">{featureAuditStatusLabel(latestAudit.status)}</span>
                <span>{featureAuditEngineLabel(latestAudit.engine)}</span>
                {latestAudit.finishedAt ? (
                  <span>· {formatAuditTime(latestAudit.finishedAt)}</span>
                ) : null}
                {latestAudit.version ? (
                  <span>
                    · 基线 <span className="font-mono">{latestAudit.version}</span>
                  </span>
                ) : null}
                {latestAudit.status === "failed" && latestAudit.error ? (
                  <span className="text-danger">· {latestAudit.error}</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-muted">尚未执行过 AI 重审。</p>
            )}
          </div>
          <FeatureAuditButton
            featureKey={view.feature.key}
            featureName={view.feature.name}
            initialRunning={latestAudit?.status === "running"}
          />
        </div>
        {latestAudit?.status === "success" && latestAudit.reportMd ? (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
              查看最近一次重审报告
            </summary>
            <div className="mt-3">
              <MarkdownView content={latestAudit.reportMd} />
            </div>
          </details>
        ) : null}
      </section>

      {view.feature.overviewMd || view.feature.diffSummaryMd ? (
        <section className="card mb-5 p-4">
          <h2 className="mb-2 text-sm font-semibold">横向差异</h2>
          {view.feature.overviewMd ? <MarkdownView content={view.feature.overviewMd} /> : null}
          {view.feature.diffSummaryMd ? (
            <div className="mt-3 border-t border-line pt-3">
              <MarkdownView content={view.feature.diffSummaryMd} />
            </div>
          ) : null}
        </section>
      ) : (
        <p className="mb-5 rounded-lg border border-dashed border-line px-4 py-3 text-xs text-muted">
          该功能点尚未填写横向差异总结。可在基线数据补齐后自动展示。
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {view.cells.map((cell) => {
          const evidences = [
            ...new Set([
              ...evidenceLines(cell.support.evidence),
              ...evidenceLines(cell.detail?.evidence ?? null),
            ]),
          ];
          return (
            <section
              key={cell.harness.id}
              id={cell.harness.slug}
              className="card flex flex-col p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <Link href={`/harnesses`} className="text-sm font-semibold hover:text-accent">
                  {cell.harness.name}
                </Link>
                <SupportBadge status={cell.support.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted">
                <span className="font-mono">{cell.harness.slug}</span>
                {cell.support.updatedDay ? <span>· {cell.support.updatedDay}</span> : null}
                {cell.support.sinceVersion ? (
                  <span>· since {cell.support.sinceVersion}</span>
                ) : null}
              </div>

              {cell.support.notes ? (
                <p className="mt-3 whitespace-pre-line rounded-lg bg-surface-2/70 px-3 py-2 text-xs leading-relaxed text-muted">
                  {cell.support.notes}
                </p>
              ) : null}

              <div className="mt-3 flex-1">
                {cell.detail?.detailMd ? (
                  <MarkdownView content={cell.detail.detailMd} />
                ) : (
                  <p className="text-xs text-muted">暂无实现细节。</p>
                )}
              </div>

              {evidences.length > 0 ? (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">证据</div>
                  <ul className="space-y-0.5 font-mono text-[10px] leading-relaxed text-muted">
                    {evidences.map((line) => (
                      <li key={line} className="break-all">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <SupportEditor
        featureId={view.feature.id}
        featureName={view.feature.name}
        rows={view.cells.map((cell) => ({
          harnessId: cell.harness.id,
          harnessName: cell.harness.name,
          status: cell.support.status,
          notes: cell.support.notes,
          evidence: cell.support.evidence ?? cell.detail?.evidence ?? null,
        }))}
      />

      {view.history.length > 0 ? (
        <section className="card mt-5 p-4">
          <h2 className="mb-3 text-sm font-semibold">变更时间线</h2>
          <ol className="space-y-2">
            {view.history.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-xs">
                <span className="w-24 shrink-0 font-mono text-muted">{entry.day}</span>
                <span className="chip h-fit">{entry.kind}</span>
                <span className="text-muted">{entry.summary}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <nav className="mt-6 flex items-center justify-between gap-3 text-sm">
        {view.prev ? (
          <Link href={`/compare/${encodeURIComponent(view.prev.key)}`} className="btn">
            <ArrowLeft size={14} /> {view.prev.name}
          </Link>
        ) : (
          <span />
        )}
        {view.next ? (
          <Link href={`/compare/${encodeURIComponent(view.next.key)}`} className="btn">
            {view.next.name} <ArrowRight size={14} />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
