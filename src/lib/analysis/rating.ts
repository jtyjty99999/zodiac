import type { CommitCategory } from "../types";
import { categoryLabel } from "./classify";
import { isCorePath, isMechanicalPath } from "./paths";

export interface RatingInput {
  category: CommitCategory;
  subject: string;
  body?: string | null;
  insertions: number;
  deletions: number;
  filesChanged: number;
  /** Changed paths, when the caller has them; enables path-level signals. */
  files?: string[];
}

export interface RatingResult {
  rating: number;
  reason: string;
}

const SECURITY_HINTS =
  /(security|vulnerab|injection|auth|permission|sandbox|secret|安全|注入|权限|沙箱)/i;
const IMPACT_HINTS = /(regression|crash|data loss|breaking|major|critical|稳定|崩溃|严重)/i;
const BREAKING_HINTS = /(breaking change|\bbreaking\b|不兼容|破坏性)/i;

const MINOR_CATEGORIES: ReadonlySet<CommitCategory> = new Set(["docs", "test", "tooling"]);
const MAX_POSITIVE_SIGNALS = 2;
const TINY_CHURN = 10;
const MECHANICAL_RATIO = 0.6;

/**
 * Rates a commit by functional importance, blast radius and risk. Diff size is
 * never a positive signal: a large rename or a dependency bump stays low, while
 * a small security fix can rate high.
 */
export function rateCommit(input: RatingInput): RatingResult {
  const churn = Math.max(input.insertions, 0) + Math.max(input.deletions, 0);
  const filesChanged = Math.max(input.filesChanged, 0);
  const text = `${input.subject}\n${input.body ?? ""}`;
  const files = input.files?.filter(Boolean) ?? [];
  const positive: string[] = [];

  let rating = 3;

  if (MINOR_CATEGORIES.has(input.category)) {
    rating -= 1;
  } else if (input.category === "other") {
    rating -= 1;
  } else if (input.category === "refactor") {
    rating -= 1;
  } else {
    if (SECURITY_HINTS.test(text)) positive.push("涉及安全边界");
    if (files.length > 0 && files.some((path) => isCorePath(path))) {
      positive.push("触及核心运行时路径");
    }
    if (input.category === "bugfix" && IMPACT_HINTS.test(text)) {
      positive.push("修复关键缺陷");
    }
    if (BREAKING_HINTS.test(text)) positive.push("包含破坏性变更");
  }

  // Positive judgement is capped so judgement stays about importance, not volume.
  rating += Math.min(positive.length, MAX_POSITIVE_SIGNALS);

  const negative: string[] = [];
  if (churn < TINY_CHURN && filesChanged <= 1) {
    rating -= 1;
    negative.push("改动量很小");
  }
  if (files.length > 0 && !MINOR_CATEGORIES.has(input.category) && input.category !== "other") {
    const mechanical = files.filter((path) => isMechanicalPath(path)).length;
    if (mechanical / files.length >= MECHANICAL_RATIO) {
      rating -= 1;
      negative.push("以文档、测试或锁文件等机械改动为主");
    }
  }

  const signals = [...positive.slice(0, MAX_POSITIVE_SIGNALS), ...negative];
  const clamped = Math.min(5, Math.max(1, rating));
  const basis = "依据功能重要性、影响面与风险判断，改动行数不作为加分项";
  const reason =
    signals.length > 0
      ? `${categoryLabel(input.category)}：${signals.join("；")}。${basis}。`
      : `${categoryLabel(input.category)}：未发现高影响、高风险或明显低价值信号。${basis}。`;

  return { rating: clamped, reason };
}
