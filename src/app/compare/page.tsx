import { Sparkles } from "lucide-react";
import Link from "next/link";
import { PageHeader, SUPPORT_LABELS } from "@/components/ui";
import { getMatrix } from "@/lib/catalog/matrix";
import type { SupportStatus } from "@/lib/types";

export const metadata = { title: "实现对比" };

const GLYPHS: Record<SupportStatus, { glyph: string; className: string }> = {
  yes: { glyph: "✓", className: "text-success" },
  partial: { glyph: "◐", className: "text-warning" },
  no: { glyph: "✗", className: "text-muted/70" },
  unknown: { glyph: "?", className: "text-muted/50" },
};

export default function CompareIndexPage() {
  const matrix = getMatrix();
  const deepDives = matrix.rows.filter((row) => row.feature.isDeepDive).length;

  return (
    <div>
      <PageHeader
        title="实现对比"
        description="逐功能查看各 harness 的支持状态、实现思路与源码证据。带「深挖」标记的功能点包含横向差异总结。"
        actions={
          <Link href="/features" className="btn">
            ← 功能矩阵
          </Link>
        }
      />

      <div className="mb-5 card flex flex-wrap items-center gap-4 px-4 py-3 text-xs text-muted">
        <span>
          共 <strong className="text-ink">{matrix.rows.length}</strong> 个功能点 /{" "}
          <strong className="text-ink">{deepDives}</strong> 个深挖
        </span>
        <span className="flex items-center gap-3">
          {matrix.harnesses.map((harness) => (
            <span key={harness.id} className="text-ink">
              {harness.name}
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {(["yes", "partial", "no", "unknown"] as SupportStatus[]).map((status) => (
            <span key={status} className="flex items-center gap-1">
              <span className={GLYPHS[status].className}>{GLYPHS[status].glyph}</span>
              {SUPPORT_LABELS[status]}
            </span>
          ))}
        </span>
      </div>

      <div className="space-y-4">
        {matrix.modules.map((module) => {
          const rows = matrix.rows.filter((row) => row.module.id === module.id);
          if (rows.length === 0) return null;
          return (
            <section key={module.key} className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">{module.name}</h2>
                {module.description ? (
                  <p className="mt-0.5 text-[11px] text-muted">{module.description}</p>
                ) : null}
              </div>
              <ul className="divide-y divide-line/60">
                {rows.map((row) => (
                  <li key={row.feature.key}>
                    <Link
                      href={`/compare/${encodeURIComponent(row.feature.key)}`}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium">
                          {row.feature.name}
                          {row.feature.isDeepDive ? (
                            <Sparkles size={11} className="text-cyan" />
                          ) : null}
                        </span>
                        <span className="font-mono text-[10px] text-muted">{row.feature.key}</span>
                      </span>
                      <span className="flex items-center gap-4 font-mono text-sm">
                        {row.cells.map((cell) => (
                          <span
                            key={cell.harness.id}
                            className={`w-4 text-center ${GLYPHS[cell.support.status].className}`}
                            title={`${cell.harness.name}: ${SUPPORT_LABELS[cell.support.status]}`}
                          >
                            {GLYPHS[cell.support.status].glyph}
                          </span>
                        ))}
                      </span>
                      <span className="text-[11px] text-muted">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
