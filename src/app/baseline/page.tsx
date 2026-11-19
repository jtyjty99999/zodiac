import { Download } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, RelativeTime, StatCard } from "@/components/ui";
import { getMatrix } from "@/lib/catalog/matrix";
import { getDb } from "@/lib/db/client";
import {
  type CatalogSnapshot,
  listCatalogVersions,
  listFeatures,
  listRecentFeatureHistory,
} from "@/lib/db/repositories/catalog";
import { listHarnesses } from "@/lib/db/repositories/harnesses";

export const metadata = { title: "基线版本" };

const VERSION_LIMIT = 60;
const HISTORY_LIMIT = 40;

function parseHarnessShas(raw: string | null): Array<[string, string | null]> {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string | null] =>
          entry[1] === null || typeof entry[1] === "string",
      )
      .map(([slug, sha]) => [slug, sha as string | null]);
  } catch {
    return [];
  }
}

function snapshotCounts(raw: string): { features: number; support: number } {
  try {
    const snapshot = JSON.parse(raw) as CatalogSnapshot;
    const features = Array.isArray(snapshot.features) ? snapshot.features.length : 0;
    const support = Array.isArray(snapshot.features)
      ? snapshot.features.reduce(
          (sum, feature) => sum + (Array.isArray(feature.support) ? feature.support.length : 0),
          0,
        )
      : 0;
    return { features, support };
  } catch {
    return { features: 0, support: 0 };
  }
}

export default function BaselinePage() {
  const db = getDb();
  const versions = listCatalogVersions(db, VERSION_LIMIT);
  const history = listRecentFeatureHistory(db, HISTORY_LIMIT);
  const harnesses = listHarnesses(db);
  const features = listFeatures(db);
  const matrix = getMatrix(db);

  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));
  const harnessBySlug = new Map(harnesses.map((harness) => [harness.slug, harness]));
  const latest = versions[0] ?? null;
  const latestCounts = latest ? snapshotCounts(latest.snapshotJson) : { features: 0, support: 0 };

  return (
    <div>
      <PageHeader
        title="基线版本"
        description="功能目录每次更新都会生成带日期的版本快照，记录当时各 harness 的提交与支持状态，可回溯、可导出。"
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="/api/baseline/export?format=md" className="btn" download>
              <Download size={13} /> 导出 Markdown
            </a>
            <a href="/api/baseline/export" className="btn btn-primary" download>
              <Download size={13} /> 导出 JSON
            </a>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="当前基版本"
          value={latest?.version ?? "—"}
          hint={latest ? latest.note?.slice(0, 40) : "尚未生成"}
        />
        <StatCard
          label="版本数"
          value={versions.length}
          accent="cyan"
          hint={`最近 ${VERSION_LIMIT} 条`}
        />
        <StatCard
          label="功能点"
          value={matrix.rows.length}
          accent="emerald"
          hint={`${matrix.modules.length} 个模块`}
        />
        <StatCard label="支持记录" value={latestCounts.support} accent="amber" hint="最新快照" />
      </div>

      {latest ? (
        <section className="card mb-5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">当前基线 {latest.version}</h2>
            <span className="text-[11px] text-muted">
              生成于 <RelativeTime iso={latest.createdAt} />
            </span>
          </div>
          {latest.note ? <p className="mt-1 text-xs text-muted">{latest.note}</p> : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {parseHarnessShas(latest.harnessShas).map(([slug, sha]) => (
              <div key={slug} className="rounded-lg border border-line px-3 py-2">
                <div className="text-[11px] text-muted">
                  {harnessBySlug.get(slug)?.name ?? slug}
                </div>
                <div className="mt-0.5 font-mono text-[11px]">
                  {sha ? sha.slice(0, 10) : "未同步"}
                </div>
              </div>
            ))}
            {parseHarnessShas(latest.harnessShas).length === 0 ? (
              <p className="text-[11px] text-muted">该版本未记录 harness SHA。</p>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="mb-5">
          <EmptyState
            title="还没有基线版本"
            hint="运行 seed 导入初始基线，或在对比页编辑支持状态后自动生成带日期的版本。"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">版本时间线</h2>
            <span className="chip">{versions.length} 条</span>
          </div>
          {versions.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted">暂无版本记录。</p>
          ) : (
            <ol className="divide-y divide-line/60">
              {versions.map((version) => {
                const counts = snapshotCounts(version.snapshotJson);
                return (
                  <li key={version.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip font-mono">{version.version}</span>
                      <span className="text-[11px] text-muted">
                        <RelativeTime iso={version.createdAt} />
                      </span>
                      <span className="ml-auto text-[10px] text-muted">
                        {counts.features} 功能点 / {counts.support} 支持记录
                      </span>
                    </div>
                    {version.note ? (
                      <p className="mt-1 text-[11px] text-muted">{version.note}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted">
                      {parseHarnessShas(version.harnessShas).map(([slug, sha]) => (
                        <span key={slug} className="font-mono">
                          {slug}@{sha ? sha.slice(0, 7) : "—"}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">功能变更记录</h2>
            <span className="chip">最近 {history.length} 条</span>
          </div>
          {history.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted">暂无变更记录。</p>
          ) : (
            <ol className="divide-y divide-line/60">
              {history.map((entry) => {
                const feature = featureById.get(entry.featureId);
                const harness = entry.harnessId === null ? null : harnessById.get(entry.harnessId);
                return (
                  <li key={entry.id} className="px-4 py-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-[10px] text-muted">
                        {entry.day}
                      </span>
                      <span className="chip">{entry.kind}</span>
                      {feature ? (
                        <Link
                          href={`/compare/${encodeURIComponent(feature.key)}`}
                          className="font-medium hover:text-accent"
                        >
                          {feature.name}
                        </Link>
                      ) : (
                        <span className="font-medium">功能点 #{entry.featureId}</span>
                      )}
                      {harness ? (
                        <span className="text-[10px] text-muted">{harness.name}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 pl-[88px] text-[11px] text-muted">{entry.summary}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
