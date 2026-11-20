import type { FeatureAuditEngine, FeatureAuditStatus } from "../types";

export function featureAuditStatusLabel(value: FeatureAuditStatus): string {
  if (value === "success") return "已完成";
  if (value === "failed") return "失败";
  return "进行中";
}

export function featureAuditEngineLabel(value: FeatureAuditEngine): string {
  return value === "claude" ? "Claude API" : "本地 Claude Code";
}
