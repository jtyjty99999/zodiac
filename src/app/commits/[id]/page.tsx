import { ExternalLink, GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import CommitAnalyzeButton from "@/components/CommitAnalyzeButton";
import {
  CategoryBadge,
  DiffView,
  MarkdownView,
  PageHeader,
  RatingStars,
  RelativeTime,
  SectionCard,
} from "@/components/ui";
import { analyzedByLabel } from "@/lib/analysis/labels";
import { getDb } from "@/lib/db/client";
import { getCommitById, listCommitFiles } from "@/lib/db/repositories/commits";
import { getHarnessById } from "@/lib/db/repositories/harnesses";
import { readDiff } from "@/lib/git/storage";
import { parseId } from "@/lib/http/routeHelpers";

export const metadata = { title: "提交详情" };

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export default async function CommitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) notFound();

  const db = getDb();
  const commit = getCommitById(db, id);
  if (!commit) notFound();

  const harness = getHarnessById(db, commit.harnessId);
  const files = listCommitFiles(db, commit.id);
  const diff = readDiff(commit.diffPath);
  const tags = parseTags(commit.featureTags);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Link href="/commits" className="hover:text-ink">
          提交与发版
        </Link>
        <span>/</span>
        <span className="font-mono">{commit.sha.slice(0, 10)}</span>
      </div>

      <PageHeader
        title={commit.subject}
        description={`${harness?.name ?? "未知 harness"} · ${commit.day} · ${commit.author}`}
        actions={
          <>
            {commit.url ? (
              <a href={commit.url} target="_blank" rel="noopener noreferrer" className="btn">
                <ExternalLink size={13} /> GitHub
              </a>
            ) : null}
            <CommitAnalyzeButton commitId={commit.id} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">分类</div>
          <div className="mt-1">
            <CategoryBadge category={commit.category} />
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">评级</div>
          <div className="mt-1">
            <RatingStars rating={commit.rating} />
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">变更</div>
          <div className="mt-1 font-mono text-xs tabular-nums">
            <span className="text-success">+{commit.insertions}</span>{" "}
            <span className="text-danger">-{commit.deletions}</span>{" "}
            <span className="text-muted">/ {commit.filesChanged} 文件</span>
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted">分析引擎</div>
          <div className="mt-1 text-xs">{analyzedByLabel(commit.analyzedBy)}</div>
          <div className="mt-0.5 text-[10px] text-muted">
            <RelativeTime iso={commit.analyzedAt} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {commit.summaryMd || commit.ratingReason ? (
            <SectionCard title="评审">
              {commit.summaryMd ? <MarkdownView content={commit.summaryMd} /> : null}
              {commit.ratingReason ? (
                <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                  <span className="font-medium text-ink">评级理由：</span>
                  {commit.ratingReason}
                </p>
              ) : null}
            </SectionCard>
          ) : (
            <SectionCard title="评审">
              <p className="text-xs text-muted">
                尚未分析。点击右上角「重新分析」生成分类、评级与评审。
              </p>
            </SectionCard>
          )}

          <SectionCard
            title="代码变更"
            action={
              <span className="text-[11px] text-muted">
                {commit.statsComplete ? "统计完整" : "仅元数据"}
              </span>
            }
          >
            {diff ? (
              <DiffView patch={diff} />
            ) : (
              <p className="text-xs text-muted">
                尚未保存 diff。同步时会为较新的提交抓取 diff；可在同步后重新分析以补全。
              </p>
            )}
          </SectionCard>

          {commit.body ? (
            <SectionCard title="提交正文">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted">
                {commit.body}
              </pre>
            </SectionCard>
          ) : null}
        </div>

        <aside className="space-y-4">
          <SectionCard title="文件列表">
            {files.length === 0 ? (
              <p className="text-xs text-muted">暂无文件级统计。</p>
            ) : (
              <ul className="space-y-1.5">
                {files.map((file) => (
                  <li key={file.id} className="text-[11px]">
                    <div className="break-all font-mono leading-relaxed">{file.path}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted">
                      {file.status ? <span className="chip">{file.status}</span> : null}
                      <span className="text-success">+{file.additions}</span>
                      <span className="text-danger">-{file.deletions}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="标签">
            {tags.length === 0 ? (
              <p className="text-xs text-muted">暂无功能标签。</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          <section className="card p-4 text-[11px] text-muted">
            <div className="mb-2 flex items-center gap-1.5 text-ink">
              <GitBranch size={12} />
              <span className="text-xs font-semibold">仓库信息</span>
            </div>
            <p className="break-all font-mono">{harness?.repoUrl ?? "—"}</p>
            <p className="mt-1">
              分支 <span className="font-mono">{harness?.branch ?? "—"}</span>
            </p>
            <p className="mt-1 break-all font-mono">SHA {commit.sha}</p>
            <p className="mt-1">
              提交时间 <RelativeTime iso={commit.committerDate} />
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
