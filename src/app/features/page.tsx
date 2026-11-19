import { Sparkles } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader, StatCard, SupportBadge } from "@/components/ui";
import { getMatrix } from "@/lib/catalog/matrix";

export const metadata = { title: "功能矩阵" };

interface SearchParams {
  q?: string;
  module?: string;
  diff?: string;
}

export default async function FeaturesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const matrix = getMatrix();
  const query = (params.q ?? "").trim().toLowerCase();
  const moduleFilter = params.module ?? "";
  const onlyDiff = params.diff === "1";

  const filteredModules = matrix.modules.filter(
    (module) => !moduleFilter || module.key === moduleFilter,
  );

  const rowsByModule = filteredModules
    .map((module) => {
      const rows = matrix.rows.filter((row) => {
        if (row.module.id !== module.id) return false;
        if (query) {
          const haystack =
            `${row.feature.name} ${row.feature.key} ${row.feature.description ?? ""}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (onlyDiff) {
          const statuses = new Set(row.cells.map((cell) => cell.support.status));
          if (statuses.size <= 1) return false;
        }
        return true;
      });
      return { module, rows };
    })
    .filter((entry) => entry.rows.length > 0);

  const totalRows = rowsByModule.reduce((sum, entry) => sum + entry.rows.length, 0);
  const deepDives = matrix.rows.filter((row) => row.feature.isDeepDive).length;

  return (
    <div>
      <PageHeader
        title="功能矩阵"
        description="按模块梳理各 harness 的能力覆盖：✓ 支持、◐ 部分支持、✗ 不支持、? 待确认。点击任意功能点进入实现细节对比。"
        actions={
          <Link href="/compare" className="btn">
            实现细节对比 →
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="功能点"
          value={matrix.rows.length}
          hint={`${matrix.modules.length} 个模块`}
        />
        <StatCard label="深挖对比" value={deepDives} accent="cyan" hint="实现级细节" />
        <StatCard label="Harness" value={matrix.harnesses.length} accent="emerald" />
        <StatCard label="当前筛选" value={totalRows} accent="amber" hint="行" />
      </div>

      <form className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end" method="get">
        <div className="flex-1">
          <label className="label" htmlFor="q">
            搜索功能点
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            className="input"
            placeholder="名称、key 或描述，例如 compaction / 沙箱"
          />
        </div>
        <div className="sm:w-56">
          <label className="label" htmlFor="module">
            模块
          </label>
          <select id="module" name="module" defaultValue={moduleFilter} className="input">
            <option value="">全部模块</option>
            {matrix.modules.map((module) => (
              <option key={module.key} value={module.key}>
                {module.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            name="diff"
            value="1"
            defaultChecked={onlyDiff}
            className="accent-[var(--z-accent)]"
          />
          仅看差异
        </label>
        <button type="submit" className="btn btn-primary">
          筛选
        </button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {matrix.coverage.map((entry) => (
          <span key={entry.harness.id} className="chip">
            {entry.harness.name} · 覆盖率 {entry.score}%
          </span>
        ))}
      </div>

      {rowsByModule.length === 0 ? (
        <EmptyState title="没有匹配的功能点" hint="调整搜索词或清空筛选条件。" />
      ) : (
        <div className="space-y-5">
          {rowsByModule.map(({ module, rows }) => (
            <section key={module.key} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">{module.name}</h2>
                  {module.description ? (
                    <p className="mt-0.5 text-[11px] text-muted">{module.description}</p>
                  ) : null}
                </div>
                <span className="chip">{rows.length} 项</span>
              </div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="min-w-[260px]">功能点</th>
                      {matrix.harnesses.map((harness) => (
                        <th key={harness.id} className="min-w-[120px] text-center">
                          {harness.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.feature.key}>
                        <td>
                          <Link
                            href={`/compare/${encodeURIComponent(row.feature.key)}`}
                            className="font-medium hover:text-accent"
                          >
                            {row.feature.name}
                          </Link>
                          {row.feature.isDeepDive ? (
                            <span
                              className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-cyan"
                              title="深挖对比"
                            >
                              <Sparkles size={10} /> 深挖
                            </span>
                          ) : null}
                          <div className="mt-0.5 font-mono text-[10px] text-muted">
                            {row.feature.key}
                          </div>
                        </td>
                        {row.cells.map((cell) => (
                          <td key={cell.harness.id} className="text-center">
                            <Link
                              href={`/compare/${encodeURIComponent(row.feature.key)}#${cell.harness.slug}`}
                              title={cell.support.notes ?? undefined}
                              className="inline-block"
                            >
                              <SupportBadge status={cell.support.status} />
                            </Link>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
