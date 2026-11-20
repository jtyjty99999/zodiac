import type {
  ExplorationEngine,
  ExplorationEvidence,
  ExplorationHarnessEvidence,
  SupportStatus,
} from "../types";
import type { ExplorationSynthesis } from "./ai";
import { LOCAL_ENGINE_LABELS } from "./engineSettings";

export interface ReportInput {
  proposition: string;
  createdAt: string;
  keywords: string[];
  evidence: ExplorationEvidence;
}

const STATUS_LABELS: Record<ExplorationHarnessEvidence["status"], string> = {
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

const MAX_REPORT_FILES_PER_HARNESS = 4;

function engineLabel(engine: ExplorationEngine): string {
  if (engine === "claude") return "Claude 自主探索";
  if (engine === "heuristic+claude") return "启发式 + Claude";
  if (engine === "heuristic") return "启发式";
  return `${LOCAL_ENGINE_LABELS[engine]} 探索`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function fenced(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/**
 * Model-authored Markdown uses its own heading levels; shift them down so the
 * text nests under the report's sections instead of flattening the outline.
 */
function demoteHeadings(markdown: string, levels: number): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, space: string) => {
    return `${"#".repeat(Math.min(6, hashes.length + levels))}${space}`;
  });
}

function topDirs(
  entry: ExplorationHarnessEvidence,
  limit = 2,
): Array<{ dir: string; files: number }> {
  const counts = new Map<string, number>();
  for (const file of entry.files) {
    const dir = file.path.split("/").slice(0, 2).join("/");
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dir, files]) => ({ dir, files }))
    .sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir))
    .slice(0, limit);
}

function relatedText(input: ReportInput, slug: string): string {
  const parts = input.evidence.relatedFeatures.map((feature) => {
    const status = feature.support[slug];
    return status ? `${feature.name}（${SUPPORT_LABELS[status]}）` : feature.name;
  });
  return parts.length > 0 ? parts.join("、") : "—";
}

function relatedLine(input: ReportInput, slug: string): string | null {
  const parts = input.evidence.relatedFeatures.map((feature) => {
    const status = feature.support[slug];
    return status ? `${feature.name} — ${SUPPORT_LABELS[status]}` : feature.name;
  });
  return parts.length > 0 ? parts.join("；") : null;
}

function heuristicConclusion(input: ReportInput): string {
  const entries = input.evidence.harnesses;
  const searched = entries.filter((entry) => entry.status === "ok" || entry.status === "empty");
  const totalFiles = entries.reduce((sum, entry) => sum + entry.totalFiles, 0);
  const totalLines = entries.reduce((sum, entry) => sum + entry.totalMatches, 0);
  const ranked = [...searched]
    .filter((entry) => entry.totalMatches > 0)
    .sort((a, b) => b.totalMatches - a.totalMatches);

  const lines = [
    `- 共检索 ${entries.length} 个 harness、${input.evidence.patterns.length} 个关键词，命中 ${totalFiles} 个文件 / ${totalLines} 行。`,
  ];

  if (ranked.length > 0) {
    const strongest = ranked
      .slice(0, 3)
      .map((entry) => `${entry.name}（${entry.totalMatches} 行）`)
      .join("、");
    lines.push(`- 证据最集中的 harness：${strongest}。`);
    const dirs = topDirs(ranked[0], 3)
      .map((entry) => `\`${entry.dir}\``)
      .join("、");
    if (dirs) lines.push(`- ${ranked[0].name} 的相关代码主要位于 ${dirs}。`);
  } else {
    lines.push("- 所选 harness 中都没有关键词命中，建议换用更具体的英文术语或功能名称。");
  }

  const unavailable = entries.filter(
    (entry) => entry.status === "missing" || entry.status === "error",
  );
  if (unavailable.length > 0) {
    lines.push(
      `- 未参与检索：${unavailable.map((entry) => `${entry.name}（${STATUS_LABELS[entry.status]}）`).join("、")}。`,
    );
  }

  lines.push(
    "- 注意：检索是大小写不敏感的字面匹配，只能说明「相关代码出现在哪里」，不构成对功能完整度的判断；具体支持情况请以功能矩阵与对比页为准。",
  );
  return lines.join("\n");
}

function harnessSection(
  input: ReportInput,
  entry: ExplorationHarnessEvidence,
  synthesis: ExplorationSynthesis | null,
): string {
  const lines = [`### ${entry.name}（${entry.slug}）`, ""];
  const meta = [
    STATUS_LABELS[entry.status],
    ...(entry.rev ? [`版本 \`${entry.rev.slice(0, 10)}\``] : []),
    `命中 ${entry.totalFiles} 个文件 / ${entry.totalMatches} 行`,
  ];
  const dirs = topDirs(entry);
  if (dirs.length > 0) {
    meta.push(`主要目录 ${dirs.map((dir) => `\`${dir.dir}\``).join("、")}`);
  }
  lines.push(`> ${meta.join(" · ")}`);
  const related = relatedLine(input, entry.slug);
  if (related) lines.push(`> 相关功能点：${related}`);
  if (entry.note) lines.push(`> 说明：${entry.note}`);
  lines.push("");

  const analysis = synthesis?.harnesses.find((item) => item.slug === entry.slug);
  if (analysis) {
    lines.push(demoteHeadings(analysis.analysisMd, 2), "");
  }

  if (entry.files.length === 0) {
    if (entry.status === "missing") {
      lines.push("该 harness 尚无本地镜像，未执行探索。", "");
    } else if (entry.status === "error") {
      lines.push("探索过程中出错，未获得可用证据。", "");
    } else {
      lines.push("未在该 harness 中找到与命题相关的实现线索。", "");
    }
    return lines.join("\n");
  }

  if (!synthesis) {
    // Offline fallback has no written analysis, so snippets carry the report.
    for (const file of entry.files.slice(0, MAX_REPORT_FILES_PER_HARNESS)) {
      lines.push(`#### \`${file.path}\`（${file.total} 行命中）`, "");
      for (const snippet of file.snippets) {
        lines.push(fenced(snippet.text), "");
      }
    }
    if (entry.files.length > MAX_REPORT_FILES_PER_HARNESS) {
      lines.push(
        `> 另有 ${entry.files.length - MAX_REPORT_FILES_PER_HARNESS} 个命中文件，可在页面「代码证据」中查看。`,
        "",
      );
    }
    return lines.join("\n");
  }

  // AI reports stay analysis-first; code is kept as traceable citations only.
  lines.push("**代码引用**", "");
  for (const file of entry.files) {
    const cited = file.snippets.map((snippet) => snippet.line).join("、");
    lines.push(`- \`${file.path}\`（第 ${cited} 行）`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Deterministic report skeleton; used directly when AI is unavailable. */
export function buildReport(
  input: ReportInput,
  synthesis: ExplorationSynthesis | null = null,
  engine: ExplorationEngine = synthesis ? "heuristic+claude" : "heuristic",
): string {
  const keywords =
    input.evidence.patterns.map((pattern) => `\`${pattern}\``).join("、") ||
    (engine === "heuristic" || engine === "heuristic+claude" ? "—" : "AI 自主探索");
  const conclusion = synthesis ? synthesis.summaryMd : heuristicConclusion(input);

  const tableRows = input.evidence.harnesses.map((entry) => {
    const dirs = topDirs(entry)
      .map((dir) => `\`${dir.dir}\``)
      .join("、");
    return `| ${escapeCell(entry.name)} | ${STATUS_LABELS[entry.status]} | ${
      entry.totalFiles
    } | ${entry.totalMatches} | ${escapeCell(dirs) || "—"} | ${escapeCell(relatedText(input, entry.slug))} |`;
  });

  const unavailable = input.evidence.harnesses.filter(
    (entry) => entry.status === "missing" || entry.status === "error",
  );

  const parts = [
    `# 功能探索：${input.proposition.trim()}`,
    "",
    `> 生成时间：${input.createdAt} · 引擎：${engineLabel(engine)} · 范围：${input.evidence.harnesses.length} 个 harness · 检索词：${keywords}`,
    "",
    "## 结论",
    "",
    conclusion,
    "",
  ];

  if (!synthesis) {
    // Make the limitation impossible to miss: this report has no "how" analysis.
    parts.splice(
      4,
      0,
      "> ⚠ 本次未运行 AI 分析：以下只有代码命中位置，没有实现方案分析。请到「设置」启用 Anthropic API 或本地 Claude Code，然后重新发起探索。",
      "",
    );
  }

  if (synthesis?.comparisonMd) {
    parts.push("## 横向对比", "", demoteHeadings(synthesis.comparisonMd, 1), "");
  } else {
    parts.push("## 横向对比", "");
  }

  parts.push(
    "| Harness | 探索状态 | 命中文件 | 命中行数 | 主要目录 | 相关功能点 |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...(tableRows.length > 0 ? tableRows : ["| — | — | 0 | 0 | — | — |"]),
    "",
    synthesis ? "## 各 harness 实现方案" : "## 各 harness 代码线索",
    "",
  );

  for (const entry of input.evidence.harnesses) {
    parts.push(harnessSection(input, entry, synthesis));
  }

  parts.push("## 检索说明", "");
  parts.push(
    "- 检索在本地 bare mirror 上完成，使用固定字符串、大小写不敏感匹配；未执行仓库中的任何代码，代码与注释仅作为数据。",
    "- 只检索所选 harness 当前分支的 HEAD，不代表历史版本或未合并分支。",
    "- 上限：每个 harness 最多 8 个文件、每文件 3 段、每段约 300 字符；二进制与超大文件会被跳过。",
  );
  if (input.evidence.truncated) {
    parts.push("- 部分结果因上述上限被截断。");
  }
  if (unavailable.length > 0) {
    parts.push(
      `- 未获得证据的 harness：${unavailable
        .map((entry) => `${entry.name}（${STATUS_LABELS[entry.status]}）`)
        .join("、")}。`,
    );
  }
  if (!synthesis) {
    parts.push(
      "- 本报告由启发式检索生成，仅展示关键词命中与已有功能目录信息；配置 AI 引擎后可获得完整的实现方案与横向对比。",
    );
  } else {
    parts.push("- 报告以分析为主；原始代码片段可在页面下方「代码证据」中展开查看。");
  }
  parts.push("");

  return parts.join("\n");
}

export function buildHeuristicReport(input: ReportInput): string {
  return buildReport(input, null);
}
