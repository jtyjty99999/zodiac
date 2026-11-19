import type { CommitCategory } from "../types";
import { categoryLabel } from "./classify";

export interface RatingInput {
  category: CommitCategory;
  subject: string;
  body?: string | null;
  insertions: number;
  deletions: number;
  filesChanged: number;
}

export interface RatingResult {
  rating: number;
  reason: string;
}

const SECURITY_HINTS =
  /(security|vulnerab|injection|auth|permission|sandbox|secret|安全|注入|权限|沙箱)/i;
const IMPACT_HINTS = /(regression|crash|data loss|breaking|major|critical|稳定|重大|严重)/i;

export function rateCommit(input: RatingInput): RatingResult {
  const churn = Math.max(input.insertions, 0) + Math.max(input.deletions, 0);
  const files = Math.max(input.filesChanged, 0);
  const text = `${input.subject}\n${input.body ?? ""}`;
  const signals: string[] = [];
  let rating = 3;

  if (input.category === "feature") {
    if (churn >= 200 || files >= 10) {
      rating += 1;
      signals.push("功能改动规模较大");
    }
    if (churn >= 800 || files >= 25) {
      rating += 1;
      signals.push("跨模块的大功能");
    }
    if (SECURITY_HINTS.test(text)) {
      rating += 1;
      signals.push("涉及安全边界");
    }
  } else if (input.category === "bugfix") {
    if (IMPACT_HINTS.test(text) || SECURITY_HINTS.test(text)) {
      rating += 1;
      signals.push("修复关键缺陷");
    }
    if (churn >= 150) {
      rating += 1;
      signals.push("修复涉及较多代码");
    }
  } else if (input.category === "performance") {
    if (churn >= 80) {
      rating += 1;
      signals.push("性能优化覆盖实质代码");
    }
  } else if (input.category === "refactor") {
    if (churn < 30) {
      rating -= 1;
      signals.push("小范围整理");
    }
  } else if (
    input.category === "docs" ||
    input.category === "test" ||
    input.category === "tooling"
  ) {
    rating -= 1;
    signals.push(`${categoryLabel(input.category)}类提交`);
  } else if (input.category === "other") {
    rating -= 1;
    signals.push("未归类的零散改动");
  }

  if (churn < 10 && files <= 1) {
    rating -= 1;
    signals.push("改动量很小");
  }
  if (churn >= 1500 || files >= 40) {
    rating += 1;
    signals.push("超大规模变更");
  }

  const clamped = Math.min(5, Math.max(1, rating));
  const reason =
    signals.length > 0
      ? `${categoryLabel(input.category)}，${signals.join("；")}。`
      : `${categoryLabel(input.category)}，改动规模与影响中等。`;

  return { rating: clamped, reason };
}
