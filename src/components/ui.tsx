import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { categoryLabel } from "@/lib/analysis/classify";
import type { CommitCategory, ExplorationStatus, SupportStatus } from "@/lib/types";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "violet" | "cyan" | "emerald" | "amber";
}) {
  const color =
    accent === "cyan"
      ? "text-cyan"
      : accent === "emerald"
        ? "text-success"
        : accent === "amber"
          ? "text-warning"
          : "text-accent";
  return (
    <div className="card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted">{hint}</div> : null}
    </div>
  );
}

export const SUPPORT_LABELS: Record<SupportStatus, string> = {
  yes: "支持",
  partial: "部分支持",
  no: "不支持",
  unknown: "待确认",
};

export function SupportBadge({ status }: { status: SupportStatus }) {
  const styles: Record<SupportStatus, string> = {
    yes: "border-success/35 bg-success/10 text-success",
    partial: "border-warning/35 bg-warning/10 text-warning",
    no: "border-line bg-surface-2 text-muted",
    unknown: "border-line bg-transparent text-muted",
  };
  const glyph: Record<SupportStatus, string> = { yes: "✓", partial: "◐", no: "✗", unknown: "?" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${styles[status]}`}
      title={SUPPORT_LABELS[status]}
    >
      <span aria-hidden>{glyph[status]}</span>
      {SUPPORT_LABELS[status]}
    </span>
  );
}

export const CATEGORY_STYLES: Record<CommitCategory, string> = {
  feature: "border-accent/35 bg-accent-soft text-accent",
  performance: "border-cyan/35 bg-cyan/10 text-cyan",
  bugfix: "border-danger/35 bg-danger/10 text-danger",
  refactor: "border-warning/35 bg-warning/10 text-warning",
  docs: "border-line bg-surface-2 text-muted",
  test: "border-line bg-surface-2 text-muted",
  tooling: "border-line bg-surface-2 text-muted",
  other: "border-line bg-transparent text-muted",
};

export function CategoryBadge({ category }: { category: CommitCategory | null }) {
  if (!category) return <span className="chip">未分析</span>;
  return (
    <span
      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${CATEGORY_STYLES[category]}`}
    >
      {categoryLabel(category)}
    </span>
  );
}

export const EXPLORATION_STATUS_LABELS: Record<ExplorationStatus, string> = {
  running: "运行中",
  success: "已完成",
  failed: "失败",
};

export function ExplorationStatusBadge({ status }: { status: ExplorationStatus }) {
  const styles: Record<ExplorationStatus, string> = {
    running: "border-accent/35 bg-accent-soft text-accent",
    success: "border-success/35 bg-success/10 text-success",
    failed: "border-danger/35 bg-danger/10 text-danger",
  };
  return (
    <span
      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      {EXPLORATION_STATUS_LABELS[status]}
    </span>
  );
}

export function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-xs text-muted">—</span>;
  return (
    <span
      className="whitespace-nowrap text-[12px] tracking-tight text-warning"
      title={`${rating} / 5`}
    >
      {"★".repeat(rating)}
      <span className="text-muted/50">{"★".repeat(Math.max(5 - rating, 0))}</span>
    </span>
  );
}

export function MarkdownView({ content }: { content: string | null | undefined }) {
  if (!content) return <p className="text-sm text-muted">暂无内容</p>;
  return (
    <div className="prose-zodiac">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const MAX_DIFF_LINES = 1500;

export function DiffView({ patch, truncated }: { patch: string; truncated?: boolean }) {
  const lines = patch.split("\n");
  const visible = lines.slice(0, MAX_DIFF_LINES);

  return (
    <div>
      <div className="diff-view">
        {visible.map((line, index) => {
          const className = line.startsWith("@@")
            ? "diff-hunk"
            : line.startsWith("+") && !line.startsWith("+++")
              ? "diff-add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "diff-del"
                : line.startsWith("diff --git") || line.startsWith("index ")
                  ? "diff-meta"
                  : "";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional and never reordered
            <div key={`${index}:${line}`} className={`diff-line ${className}`}>
              {line || " "}
            </div>
          );
        })}
      </div>
      {lines.length > MAX_DIFF_LINES || truncated ? (
        <p className="mt-2 text-xs text-muted">
          内容已截断：仅展示前 {MAX_DIFF_LINES} 行{truncated ? "（原始 diff 超出存储上限）" : ""}。
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MiniBars({
  data,
  hrefBase,
}: {
  data: Array<{ day: string; count: number }>;
  hrefBase?: string;
}) {
  const max = Math.max(1, ...data.map((entry) => entry.count));
  return (
    <div className="flex h-28 items-end gap-1.5">
      {data.map((entry) => {
        const height = Math.max(4, Math.round((entry.count / max) * 88));
        const bar = (
          <div
            key={entry.day}
            title={`${entry.day} · ${entry.count} 次提交`}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <div
              className="w-full rounded-t-[3px] bg-gradient-to-t from-accent/60 to-accent transition-opacity hover:opacity-80"
              style={{ height }}
            />
          </div>
        );
        return hrefBase ? (
          <Link
            key={entry.day}
            href={`${hrefBase}/${entry.day}`}
            className="flex flex-1 justify-center"
          >
            {bar}
          </Link>
        ) : (
          bar
        );
      })}
    </div>
  );
}

export function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted">从未</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span className="text-muted">—</span>;
  return (
    <span title={date.toLocaleString("zh-CN")} className="tabular-nums">
      {date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  );
}
