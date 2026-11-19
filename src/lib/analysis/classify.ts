import type { CommitCategory } from "../types";

export interface ClassifyInput {
  subject: string;
  body?: string | null;
  files?: Array<{ path: string; status?: string | null }>;
  insertions?: number;
  deletions?: number;
}

export interface Classification {
  category: CommitCategory;
  reasons: string[];
  confidence: number;
}

const CONVENTIONAL: Record<string, CommitCategory> = {
  feat: "feature",
  feature: "feature",
  fix: "bugfix",
  bugfix: "bugfix",
  perf: "performance",
  refactor: "refactor",
  docs: "docs",
  doc: "docs",
  test: "test",
  tests: "test",
  build: "tooling",
  ci: "tooling",
  chore: "tooling",
  style: "refactor",
  revert: "bugfix",
};

interface KeywordRule {
  category: CommitCategory;
  weight: number;
  pattern: RegExp;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    category: "feature",
    weight: 3,
    pattern: /\b(add|adds|added|implement|introduc|support|new |enable|allow|feature|launch)\b/i,
  },
  {
    category: "feature",
    weight: 3,
    pattern: /新增|实现|支持|引入|增加|允许|功能/,
  },
  {
    category: "bugfix",
    weight: 3,
    pattern: /\b(fix|fixes|fixed|bug|regression|crash|error|issue|broken|hotfix|workaround)\b/i,
  },
  { category: "bugfix", weight: 3, pattern: /修复|缺陷|崩溃|报错|问题|回归/ },
  {
    category: "performance",
    weight: 3,
    pattern: /\b(perf|performance|optimi[sz]e|speed|faster|latency|memory usage|cache|parallel)\b/i,
  },
  { category: "performance", weight: 3, pattern: /性能|优化|加速|耗时|内存|并发/ },
  {
    category: "refactor",
    weight: 2,
    pattern: /\b(refactor|cleanup|clean up|rename|restructure|simplify|reorganize|move)\b/i,
  },
  { category: "refactor", weight: 2, pattern: /重构|整理|重命名|简化|拆分/ },
  { category: "docs", weight: 2, pattern: /\b(docs?|readme|changelog|docs?ite|comments?)\b/i },
  { category: "docs", weight: 2, pattern: /文档|说明|注释/ },
  { category: "test", weight: 2, pattern: /\b(tests?|specs?|fixtures?|coverage)\b/i },
  { category: "test", weight: 2, pattern: /测试|用例|覆盖率/ },
  {
    category: "tooling",
    weight: 2,
    pattern: /\b(ci|cd|build|deps?|dependenc|bump|release|workflow|lint|format|github actions)\b/i,
  },
  { category: "tooling", weight: 2, pattern: /构建|依赖|发版|发布|流水线/ },
];

function conventionalPrefix(subject: string): { type: string; rest: string } | null {
  const match = subject.match(/^([a-zA-Z]+)(?:\([^)]*\))?!?:\s*(.*)$/);
  if (!match) return null;
  return { type: match[1].toLowerCase(), rest: match[2] };
}

function pathSignals(files: Array<{ path: string }>): Partial<Record<CommitCategory, number>> {
  const signals: Partial<Record<CommitCategory, number>> = {};
  for (const file of files) {
    const path = file.path.toLowerCase();
    const add = (category: CommitCategory, weight: number) => {
      signals[category] = (signals[category] ?? 0) + weight;
    };
    if (/(^|\/)(docs?|documentation)\//.test(path) || /\.(md|mdx)$/.test(path)) add("docs", 1);
    if (/(^|\/)(tests?|__tests__|spec|e2e)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path)) {
      add("test", 1);
    }
    if (
      path.startsWith(".github/") ||
      /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|cargo\.lock|go\.sum)$/.test(
        path,
      ) ||
      /(^|\/)(biome\.json|eslint|tsconfig|vitest|playwright|makefile|dockerfile)/.test(path)
    ) {
      add("tooling", 1);
    }
  }
  return signals;
}

export function classifyCommit(input: ClassifyInput): Classification {
  const reasons: string[] = [];
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  const files = input.files ?? [];
  const text = `${subject}\n${body}`;

  const prefix = conventionalPrefix(subject);
  if (prefix && CONVENTIONAL[prefix.type]) {
    const category = CONVENTIONAL[prefix.type];
    reasons.push(`conventional commit: ${prefix.type}`);
    return { category, reasons, confidence: 0.9 };
  }

  const scores: Record<CommitCategory, number> = {
    feature: 0,
    performance: 0,
    bugfix: 0,
    refactor: 0,
    docs: 0,
    test: 0,
    tooling: 0,
    other: 0,
  };

  for (const rule of KEYWORD_RULES) {
    // Subject matches count double: the title is the strongest signal.
    if (rule.pattern.test(subject)) {
      scores[rule.category] += rule.weight * 2;
    } else if (rule.pattern.test(text)) {
      scores[rule.category] += rule.weight;
    }
  }

  for (const [category, weight] of Object.entries(pathSignals(files)) as Array<
    [CommitCategory, number]
  >) {
    scores[category] += weight;
  }

  const totalFiles = files.length;
  const churn = (input.insertions ?? 0) + (input.deletions ?? 0);
  if (scores.feature === 0 && scores.bugfix === 0 && totalFiles >= 3 && churn >= 40) {
    scores.feature += 1;
    reasons.push("多处代码变更，默认归类为功能迭代");
  }

  const entries = (Object.entries(scores) as Array<[CommitCategory, number]>).filter(
    ([category]) => category !== "other",
  );
  entries.sort((a, b) => b[1] - a[1]);
  const [winner, topScore] = entries[0] ?? ["other", 0];

  if (!topScore) {
    return { category: "other", reasons: ["未匹配到明显分类信号"], confidence: 0.2 };
  }

  reasons.push(`关键词评分：${winner}=${topScore}`);
  const confidence = Math.min(0.85, 0.35 + topScore * 0.05);
  return { category: winner, reasons, confidence };
}

const CATEGORY_LABELS: Record<CommitCategory, string> = {
  feature: "功能迭代",
  performance: "性能优化",
  bugfix: "缺陷修复",
  refactor: "重构整理",
  docs: "文档",
  test: "测试",
  tooling: "工程与工具",
  other: "其他",
};

export function categoryLabel(category: CommitCategory): string {
  return CATEGORY_LABELS[category];
}
