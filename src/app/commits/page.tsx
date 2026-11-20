import Link from "next/link";
import { CategoryBadge, EmptyState, MarkdownView, PageHeader, RatingStars } from "@/components/ui";
import { categoryLabel } from "@/lib/analysis/classify";
import { analyzedByLabel } from "@/lib/analysis/labels";
import { getDb } from "@/lib/db/client";
import { countCommits, listCommits } from "@/lib/db/repositories/commits";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { countReleases, listReleases } from "@/lib/db/repositories/releases";
import { COMMIT_CATEGORIES, type CommitCategory } from "@/lib/types";

export const metadata = { title: "提交与发版" };

const PAGE_SIZE = 40;
const RELEASE_LIMIT = 100;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface CommitSearchParams {
  harness?: string;
  category?: string;
  rating?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
  tab?: string;
}

function buildHref(
  base: CommitSearchParams,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | undefined> = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/commits?${query}` : "/commits";
}

export default async function CommitsPage({
  searchParams,
}: {
  searchParams: Promise<CommitSearchParams>;
}) {
  const params = await searchParams;
  const db = getDb();
  const harnesses = listHarnesses(db);

  const harnessId = Number.parseInt(params.harness ?? "", 10);
  const validHarnessId = harnesses.some((harness) => harness.id === harnessId)
    ? harnessId
    : undefined;
  const category = COMMIT_CATEGORIES.includes(params.category as CommitCategory)
    ? (params.category as CommitCategory)
    : undefined;
  const rating = (() => {
    const value = Number.parseInt(params.rating ?? "", 10);
    return value >= 1 && value <= 5 ? value : undefined;
  })();
  const fromDay = params.from && DAY_PATTERN.test(params.from) ? params.from : undefined;
  const toDay = params.to && DAY_PATTERN.test(params.to) ? params.to : undefined;
  const search = (params.q ?? "").trim().slice(0, 120) || undefined;
  const tab = params.tab === "releases" ? "releases" : "commits";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const baseParams: CommitSearchParams = {
    harness: params.harness,
    category: params.category,
    rating: params.rating,
    from: params.from,
    to: params.to,
    q: params.q,
    tab: tab === "releases" ? "releases" : undefined,
  };

  const filter = {
    harnessId: validHarnessId,
    category,
    rating,
    fromDay,
    toDay,
    search,
  };

  const commits =
    tab === "commits"
      ? listCommits(db, { ...filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      : [];
  const total = tab === "commits" ? countCommits(db, filter) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const releases = tab === "releases" ? listReleases(db, validHarnessId, RELEASE_LIMIT) : [];
  const releaseTotal = tab === "releases" ? countReleases(db, validHarnessId) : 0;
  const harnessById = new Map(harnesses.map((harness) => [harness.id, harness]));

  return (
    <div>
      <PageHeader
        title="提交与发版"
        description="按 harness、分类、评级与日期筛选提交；发版记录来自 GitHub Releases（失败时回退 git tags）。"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={buildHref(baseParams, { tab: undefined, page: undefined })}
          className={`btn ${tab === "commits" ? "btn-primary" : ""}`}
        >
          提交 <span className="ml-1 text-[11px] opacity-70">{countCommits(db, filter)}</span>
        </Link>
        <Link
          href={buildHref(baseParams, { tab: "releases", page: undefined })}
          className={`btn ${tab === "releases" ? "btn-primary" : ""}`}
        >
          发版{" "}
          <span className="ml-1 text-[11px] opacity-70">{countReleases(db, validHarnessId)}</span>
        </Link>
      </div>

      <form className="card mb-5 grid gap-3 p-4 md:grid-cols-6" method="get">
        <input type="hidden" name="tab" value={tab} />
        <div className="md:col-span-2">
          <label className="label" htmlFor="q">
            搜索
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ""}
            className="input"
            placeholder="标题、正文或 SHA"
          />
        </div>
        <div>
          <label className="label" htmlFor="harness">
            Harness
          </label>
          <select id="harness" name="harness" defaultValue={params.harness ?? ""} className="input">
            <option value="">全部</option>
            {harnesses.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">
            分类
          </label>
          <select
            id="category"
            name="category"
            defaultValue={params.category ?? ""}
            className="input"
          >
            <option value="">全部</option>
            {COMMIT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">
            起始日
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={params.from ?? ""}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            结束日
          </label>
          <input id="to" name="to" type="date" defaultValue={params.to ?? ""} className="input" />
        </div>
        <div className="flex items-end gap-2 md:col-span-2">
          <button type="submit" className="btn btn-primary">
            筛选
          </button>
          <Link href={tab === "releases" ? "/commits?tab=releases" : "/commits"} className="btn">
            重置
          </Link>
        </div>
      </form>

      {tab === "commits" ? (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">提交列表</h2>
            <span className="chip">
              第 {page} / {totalPages} 页 · 共 {total} 条
            </span>
          </div>
          {commits.length === 0 ? (
            <div className="p-4">
              <EmptyState title="没有匹配的提交" hint="调整筛选条件，或先在 Harness 页触发同步。" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>提交</th>
                      <th className="w-24">日期</th>
                      <th className="w-24">分类</th>
                      <th className="w-24">评级</th>
                      <th className="w-28">变更</th>
                      <th className="w-20">分析</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commits.map((commit) => (
                      <tr key={commit.id}>
                        <td>
                          <Link
                            href={`/commits/${commit.id}`}
                            className="font-medium hover:text-accent"
                          >
                            {commit.subject}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                            <span>{harnessById.get(commit.harnessId)?.name ?? "未知"}</span>
                            <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                            <span>{commit.author}</span>
                          </div>
                        </td>
                        <td className="font-mono text-[11px]">{commit.day}</td>
                        <td>
                          <CategoryBadge category={commit.category} />
                        </td>
                        <td>
                          <RatingStars rating={commit.rating} />
                        </td>
                        <td className="font-mono text-[11px] tabular-nums">
                          <span className="text-success">+{commit.insertions}</span>{" "}
                          <span className="text-danger">-{commit.deletions}</span>
                          <div className="text-[10px] text-muted">{commit.filesChanged} 文件</div>
                        </td>
                        <td className="text-[10px] text-muted">
                          {analyzedByLabel(commit.analyzedBy)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs">
                {page > 1 ? (
                  <Link href={buildHref(baseParams, { page: String(page - 1) })} className="btn">
                    ← 上一页
                  </Link>
                ) : (
                  <span />
                )}
                {page < totalPages ? (
                  <Link href={buildHref(baseParams, { page: String(page + 1) })} className="btn">
                    下一页 →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="space-y-3">
          {releases.length === 0 ? (
            <EmptyState
              title="没有发版记录"
              hint="同步后自动抓取 GitHub Releases；无 API 时回退 git tags。"
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">发版记录</h2>
                <span className="chip">
                  共 {releaseTotal} 条 · 展示最近 {releases.length} 条
                </span>
              </div>
              <ul className="divide-y divide-line/60">
                {releases.map((release) => (
                  <li key={release.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip font-mono">{release.tag}</span>
                      <span className="text-[11px] text-muted">
                        {harnessById.get(release.harnessId)?.name ?? "未知"}
                      </span>
                      <span className="text-xs font-medium">{release.name ?? release.tag}</span>
                      <span className="ml-auto text-[11px] text-muted">
                        {release.publishedAt ? release.publishedAt.slice(0, 10) : "—"}
                      </span>
                      {release.url ? (
                        <a
                          href={release.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-accent hover:underline"
                        >
                          Release 页面 ↗
                        </a>
                      ) : null}
                    </div>
                    {release.body ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-muted">
                          展开说明
                        </summary>
                        <div className="mt-2 rounded-lg bg-surface-2/60 p-3">
                          <MarkdownView content={release.body.slice(0, 8000)} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
