import type { CatalogSnapshot } from "../db/repositories/catalog";
import type { FeatureSupport, Harness, SupportStatus } from "../types";

const STATUS_MARK: Record<SupportStatus, string> = {
  yes: "✓",
  partial: "◐",
  no: "✗",
  unknown: "?",
};

function cell(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

/**
 * Renders the catalog snapshot as a Markdown document: one matrix table per
 * module followed by the deep-dive overview and cross-harness summary.
 */
export function snapshotToMarkdown(snapshot: CatalogSnapshot, harnesses: Harness[]): string {
  const ordered = [...harnesses].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const harnessById = new Map(ordered.map((harness) => [harness.id, harness]));
  const header = `| 功能点 | 说明 | ${ordered.map((harness) => cell(harness.name)).join(" | ")} | 更新 |
| --- | --- | ${ordered.map(() => "---").join(" | ")} | --- |`;

  const lines: string[] = [
    "# Zodiac 功能基线",
    "",
    `> 生成时间：${snapshot.generatedAt}`,
    `> 覆盖 harness：${ordered.map((harness) => harness.name).join(" / ")}`,
    "",
  ];

  for (const module of snapshot.modules) {
    const features = snapshot.features.filter((feature) => feature.moduleId === module.id);
    if (features.length === 0) continue;
    lines.push(`## ${module.name}`, "");
    if (module.description) lines.push(`> ${module.description}`, "");
    lines.push(header);
    for (const feature of features) {
      const supportByHarness = new Map<number, FeatureSupport>(
        feature.support.map((entry) => [entry.harnessId, entry]),
      );
      const marks = ordered.map((harness) => {
        const entry = supportByHarness.get(harness.id);
        return entry ? STATUS_MARK[entry.status] : "·";
      });
      const updated = feature.support
        .map((entry) => entry.updatedDay)
        .filter((day): day is string => Boolean(day))
        .sort()
        .at(-1);
      lines.push(
        `| ${cell(feature.name)} | ${cell(feature.description)} | ${marks.join(" | ")} | ${updated ?? ""} |`,
      );
    }
    lines.push("");
  }

  const deepDives = snapshot.features.filter(
    (feature) => feature.overviewMd || feature.diffSummaryMd,
  );
  if (deepDives.length > 0) {
    lines.push("## 重点功能实现对比", "");
    for (const feature of deepDives) {
      lines.push(`### ${feature.name}`, "");
      if (feature.overviewMd) lines.push(feature.overviewMd, "");
      if (feature.diffSummaryMd) lines.push(`**横向差异：** ${feature.diffSummaryMd}`, "");
      const support = feature.support
        .map((entry) => {
          const harness = harnessById.get(entry.harnessId);
          if (!harness) return null;
          const note = entry.notes ? `：${cell(entry.notes)}` : "";
          return `- ${harness.name} ${STATUS_MARK[entry.status]}${note}`;
        })
        .filter((line): line is string => line !== null);
      if (support.length > 0) lines.push(...support, "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
