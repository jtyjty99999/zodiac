import type { Db } from "../db/client";
import { listFeatures } from "../db/repositories/catalog";
import { isValidSearchPattern } from "../git/search";
import type { ExplorationMatchedFeature, Feature } from "../types";

export type FeatureHint = Pick<Feature, "id" | "key" | "name" | "description" | "tags">;

export interface KeywordResult {
  patterns: string[];
  matchedFeatures: ExplorationMatchedFeature[];
  notes: string[];
}

export const MAX_PATTERNS = 8;
const MAX_FEATURES = 3;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "how",
  "what",
  "which",
  "does",
  "did",
  "are",
  "was",
  "were",
  "from",
  "into",
  "that",
  "this",
  "these",
  "those",
  "when",
  "where",
  "why",
  "versus",
  "each",
  "any",
  "not",
  "but",
  "you",
  "your",
  "our",
  "their",
  "its",
  "use",
  "used",
  "using",
  "about",
  "across",
  "compare",
  "comparison",
  "handle",
  "handles",
  "handling",
  "implement",
  "implemented",
  "implementation",
  "codebase",
  "code",
  "repo",
  "repos",
  "repository",
  "repositories",
  "harness",
  "harnesses",
  "support",
  "supported",
  "supports",
  "different",
  "between",
]);

// Chinese (and a few English) domain terms mapped to literal code patterns.
// Longer keys are checked first so 上下文窗口 wins over 上下文.
export const ZH_EN_TERMS: ReadonlyArray<{ zh: string[]; en: string[] }> = [
  { zh: ["上下文窗口"], en: ["context window"] },
  { zh: ["工具调用"], en: ["tool call"] },
  { zh: ["系统提示", "提示词"], en: ["system prompt", "prompt"] },
  { zh: ["多智能体"], en: ["multi-agent", "orchestrat"] },
  { zh: ["计划模式"], en: ["plan mode"] },
  { zh: ["上下文"], en: ["context"] },
  { zh: ["压缩"], en: ["compact"] },
  { zh: ["摘要"], en: ["summar"] },
  { zh: ["记忆"], en: ["memory"] },
  { zh: ["会话"], en: ["session"] },
  { zh: ["持久化"], en: ["persist"] },
  { zh: ["恢复"], en: ["resume"] },
  { zh: ["沙箱"], en: ["sandbox"] },
  { zh: ["权限"], en: ["permission"] },
  { zh: ["审批"], en: ["approval"] },
  { zh: ["工具"], en: ["tool"] },
  { zh: ["主循环"], en: ["agent loop", "run loop"] },
  { zh: ["循环"], en: ["loop"] },
  { zh: ["子智能体", "子代理"], en: ["subagent"] },
  { zh: ["插件"], en: ["plugin"] },
  { zh: ["扩展"], en: ["extension"] },
  { zh: ["流式"], en: ["stream"] },
  { zh: ["模型"], en: ["model"] },
  { zh: ["供应商"], en: ["provider"] },
  { zh: ["配置"], en: ["config"] },
  { zh: ["环境变量"], en: ["env"] },
  { zh: ["日志"], en: ["log"] },
  { zh: ["遥测"], en: ["telemetry", "analytics"] },
  { zh: ["终端"], en: ["terminal", "tui"] },
  { zh: ["界面"], en: ["tui", "ui"] },
  { zh: ["快捷键"], en: ["keybind"] },
  { zh: ["命令"], en: ["command"] },
  { zh: ["搜索"], en: ["search"] },
  { zh: ["文件"], en: ["file"] },
  { zh: ["编辑"], en: ["edit", "patch"] },
  { zh: ["补丁"], en: ["patch"] },
  { zh: ["截断"], en: ["truncat"] },
  { zh: ["重试"], en: ["retry"] },
  { zh: ["取消"], en: ["cancel", "abort"] },
  { zh: ["中断"], en: ["interrupt"] },
  { zh: ["事件"], en: ["event"] },
  { zh: ["通知"], en: ["notification"] },
  { zh: ["队列"], en: ["queue"] },
  { zh: ["并发"], en: ["concurren"] },
  { zh: ["钩子"], en: ["hook"] },
  { zh: ["技能"], en: ["skill"] },
  { zh: ["身份验证"], en: ["auth"] },
  { zh: ["密钥"], en: ["api key"] },
  { zh: ["性能"], en: ["performance"] },
  { zh: ["重构"], en: ["refactor"] },
  { zh: ["缓存"], en: ["cache"] },
  { zh: ["令牌", "标记"], en: ["token"] },
  { zh: ["历史"], en: ["history"] },
];

const BIGRAM_NOISE = new Set([
  "如何",
  "何如",
  "什么",
  "哪些",
  "是否",
  "以及",
  "怎么",
  "怎样",
  "可以",
  "这个",
  "那个",
  "通过",
  "进行",
  "实现",
  "支持",
  "处理",
  "对比",
  "比较",
  "各个",
  "所有",
  "主要",
  "区别",
  "差异",
  "分别",
  "之间",
  "中的",
  "我们",
]);

// Catalog tags/key segments shared by more features than this are taxonomy
// vocabulary ("core", "advanced", …) and would flood the search results.
const MAX_FEATURE_TERM_SHARING = 2;

function featureTermFrequency(features: FeatureHint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const feature of features) {
    const terms = new Set(featureTerms(feature).map((term) => term.toLowerCase()));
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

/** Latin tokens of the proposition, lowercased and stopword-filtered. */
export function latinTokens(proposition: string): string[] {
  const tokens: string[] = [];
  for (const match of proposition.matchAll(/[A-Za-z][A-Za-z0-9_.+-]{2,31}/g)) {
    const token = match[0].toLowerCase().replace(/[.+-]+$/, "");
    if (token.length < 3 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    tokens.push(token);
  }
  return [...new Set(tokens)];
}

function chineseBigrams(proposition: string, limit = 2): string[] {
  const runs = proposition.match(/[一-鿿]{2,30}/g) ?? [];
  const bigrams: string[] = [];
  for (const run of runs) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (BIGRAM_NOISE.has(bigram)) continue;
      bigrams.push(bigram);
    }
  }
  return [...new Set(bigrams)].slice(0, limit);
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length >= 3)
      : [];
  } catch {
    return [];
  }
}

function featureTerms(feature: FeatureHint): string[] {
  const tags = parseTags(feature.tags);
  const keySegments = feature.key.split(/[.-]/).filter((segment) => segment.length >= 3);
  return [...tags, ...keySegments];
}

/** Scores catalog features by word overlap with the proposition's terms. */
export function matchFeatures(
  terms: string[],
  features: FeatureHint[],
  limit = MAX_FEATURES,
): FeatureHint[] {
  const normalized = terms
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 2);
  if (normalized.length === 0) return [];

  const scored = features.map((feature) => {
    const haystack = [
      feature.key,
      feature.name,
      feature.description ?? "",
      feature.tags ?? "",
      ...featureTerms(feature),
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const term of normalized) {
      if (haystack.includes(term)) score += Math.min(term.length, 8);
    }
    return { feature, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.feature);
}

/**
 * Turns a free-form proposition into bounded literal search patterns plus the
 * catalog features it likely refers to.
 */
export function extractKeywords(
  proposition: string,
  features: FeatureHint[] = [],
  maxPatterns = MAX_PATTERNS,
): KeywordResult {
  const notes: string[] = [];
  const tokens = latinTokens(proposition);
  const dictionaryTerms: string[] = [];
  const matchedChinese: string[] = [];

  for (const entry of ZH_EN_TERMS) {
    const hit = entry.zh.find((term) => proposition.includes(term));
    if (!hit) continue;
    matchedChinese.push(hit);
    dictionaryTerms.push(...entry.en);
  }

  const featureCandidates = matchFeatures(
    [...tokens, ...matchedChinese, ...dictionaryTerms],
    features,
  );
  const frequency = featureTermFrequency(features);
  const specificFeatureTerms = featureCandidates
    .flatMap(featureTerms)
    .filter((term) => (frequency.get(term.toLowerCase()) ?? 0) <= MAX_FEATURE_TERM_SHARING);

  const ordered: string[] = [
    ...dictionaryTerms,
    ...tokens,
    ...specificFeatureTerms,
    ...matchedChinese,
  ];

  const patterns: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string) => {
    const pattern = candidate.trim();
    if (!isValidSearchPattern(pattern)) return;
    const key = pattern.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    patterns.push(pattern);
  };

  for (const candidate of ordered) {
    if (patterns.length >= maxPatterns) break;
    push(candidate);
  }

  if (patterns.length < 2) {
    for (const bigram of chineseBigrams(proposition)) push(bigram);
  }

  if (patterns.length === 0) {
    push(proposition.replace(/\s+/g, " ").trim().slice(0, 60));
    notes.push("未提取到有效关键词，已使用命题原文检索");
  }
  if (featureCandidates.length === 0) {
    notes.push("未匹配到功能目录条目");
  }

  return {
    patterns: patterns.slice(0, maxPatterns),
    matchedFeatures: featureCandidates.map((feature) => ({
      id: feature.id,
      key: feature.key,
      name: feature.name,
    })),
    notes,
  };
}

export function extractKeywordsFor(db: Db, proposition: string): KeywordResult {
  let features: FeatureHint[] = [];
  try {
    features = listFeatures(db);
  } catch {
    // The catalog may be empty in a fresh install; keyword extraction still works.
    features = [];
  }
  return extractKeywords(proposition, features);
}
