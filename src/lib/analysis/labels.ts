/** Human-readable label for the stored `analyzed_by` engine marker. */
export function analyzedByLabel(value: string | null | undefined): string {
  if (value === "heuristic+claude") return "Claude API";
  if (value === "claude-code") return "本地 Claude Code";
  if (value === "heuristic") return "启发式";
  return value ?? "未分析";
}
