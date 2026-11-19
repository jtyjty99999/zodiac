import type { CommitCategory } from "../types";
import { categoryLabel } from "./classify";

export interface HeuristicInput {
  subject: string;
  body?: string | null;
  category: CommitCategory;
  files: Array<{ path: string; status?: string | null }>;
  insertions: number;
  deletions: number;
}

const TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "mcp", pattern: /\bmcp\b|model context protocol/i },
  {
    tag: "permissions",
    pattern: /\bpermission|approval|sandbox|seatbelt|bubblewrap|landlock|acl\b|权限|审批|沙箱/i,
  },
  { tag: "context", pattern: /\bcontext|compaction|token budget|prompt cache|上下文|压缩/i },
  { tag: "memory", pattern: /\bmemory|memories|记忆/i },
  { tag: "session", pattern: /\bsession|resume|transcript|checkpoint|会话/i },
  { tag: "worktree", pattern: /\bworktree|git worktree\b/i },
  { tag: "subagent", pattern: /\bsub-?agent|subagent|delegate|子代理|子智能体/i },
  { tag: "agent-loop", pattern: /\bstreaming|agent loop|steering|plan mode|主循环|流式|计划模式/i },
  { tag: "tools", pattern: /\btool(s|ing)?\b|shell|bash|apply_patch|edit_file|工具/i },
  { tag: "lsp", pattern: /\blsp|language server|diagnostic|语言服务/i },
  { tag: "plugin", pattern: /\bplugin|extension|hooks?|skills?\b|插件|扩展/i },
  { tag: "models", pattern: /\bmodel|provider|anthropic|openai|gemini|ollama|模型|供应商/i },
  { tag: "tui", pattern: /\btui|terminal ui|ink|opentui|终端/i },
  { tag: "ide", pattern: /\bvscode|vs code|jetbrains|intellij|ide\b/i },
  { tag: "web", pattern: /\bweb|browser|http server|web ui\b|网页|浏览器/i },
  { tag: "desktop", pattern: /\belectron|tauri|desktop app\b|桌面/i },
  { tag: "auth", pattern: /\boauth|sso|login|sign[- ]?in|鉴权|登录/i },
  { tag: "config", pattern: /\bconfig|settings|toml|yaml\b|配置/i },
  { tag: "telemetry", pattern: /\botel|opentelemetry|telemetry|observability|遥测|可观测/i },
  { tag: "performance", pattern: /\bperformance|latency|cache|optimi[sz]|性能|延迟/i },
  { tag: "security", pattern: /\bsecurity|vulnerab|cve|injection|安全|漏洞/i },
  { tag: "ci", pattern: /\bci\b|github actions|pipeline|workflow|流水线/i },
  { tag: "release", pattern: /\brelease|version|changelog|发版|版本/i },
];

const MODULE_HINTS: Array<{ moduleKey: string; tags: string[]; pattern: RegExp }> = [
  {
    moduleKey: "agent-loop",
    tags: ["agent-loop"],
    pattern: /loop|steering|plan mode|streaming|主循环|流式/i,
  },
  {
    moduleKey: "builtin-tools",
    tags: ["tools", "lsp"],
    pattern: /tool|shell|bash|edit|patch|搜索|工具/i,
  },
  {
    moduleKey: "permissions",
    tags: ["permissions", "security"],
    pattern: /permission|approval|sandbox|security|审批|沙箱|权限/i,
  },
  { moduleKey: "context", tags: ["context"], pattern: /context|compact|prompt|上下文|压缩/i },
  { moduleKey: "memory", tags: ["memory"], pattern: /memory|记忆/i },
  { moduleKey: "session", tags: ["session", "worktree"], pattern: /session|resume|worktree|会话/i },
  { moduleKey: "models", tags: ["models", "auth"], pattern: /model|provider|oauth|模型|供应商/i },
  {
    moduleKey: "interface",
    tags: ["tui", "ide", "web", "desktop"],
    pattern: /tui|vscode|jetbrains|desktop|web ui|界面/i,
  },
  { moduleKey: "run-modes", tags: ["ci"], pattern: /headless|rpc|daemon|sdk|json output/i },
  { moduleKey: "extensions", tags: ["plugin"], pattern: /plugin|hook|skill|extension|插件/i },
  { moduleKey: "mcp", tags: ["mcp"], pattern: /mcp|model context protocol/i },
  {
    moduleKey: "multi-agent",
    tags: ["subagent"],
    pattern: /subagent|workflow|cron|background task|子代理/i,
  },
  {
    moduleKey: "config",
    tags: ["config", "telemetry"],
    pattern: /config|settings|otel|telemetry|配置|遥测/i,
  },
];

export function extractTags(input: {
  subject: string;
  body?: string | null;
  files?: Array<{ path: string }>;
}): string[] {
  const haystack = [
    input.subject,
    input.body ?? "",
    ...(input.files ?? []).map((file) => file.path),
  ].join("\n");
  return TAG_RULES.filter((rule) => rule.pattern.test(haystack))
    .map((rule) => rule.tag)
    .slice(0, 8);
}

export function guessModuleKey(input: {
  subject: string;
  body?: string | null;
  tags?: string[];
}): string | null {
  const text = `${input.subject}\n${input.body ?? ""}`;
  const tags = input.tags ?? extractTags(input);
  for (const hint of MODULE_HINTS) {
    if (hint.tags.some((tag) => tags.includes(tag)) && hint.pattern.test(text)) {
      return hint.moduleKey;
    }
  }
  const byTag = MODULE_HINTS.find((hint) => hint.tags.some((tag) => tags.includes(tag)));
  return byTag?.moduleKey ?? null;
}

function topPaths(files: Array<{ path: string }>, limit = 6): string[] {
  return files.slice(0, limit).map((file) => `\`${file.path}\``);
}

export interface HeuristicAnalysis {
  tags: string[];
  summaryMd: string;
}

export function heuristicSummary(input: HeuristicInput): HeuristicAnalysis {
  const tags = extractTags(input);
  const churn = input.insertions + input.deletions;
  const paths = topPaths(input.files);
  const fileLine =
    paths.length > 0 ? `- 主要文件：${paths.join("、")}` : "- 主要文件：无文件清单（浅抓取）";
  const tagLine =
    tags.length > 0 ? `- 涉及领域：${tags.map((tag) => `\`${tag}\``).join("、")}` : "";

  const commentary = buildCommentary(input, churn, tags);

  const summaryMd = [
    `> ${commentary}`,
    "",
    `- 分类：${categoryLabel(input.category)}`,
    `- 规模：${input.files.length} 个文件，+${input.insertions} / -${input.deletions}`,
    fileLine,
    tagLine,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { tags, summaryMd };
}

function buildCommentary(input: HeuristicInput, churn: number, tags: string[]): string {
  const scope = tags.length > 0 ? tags.slice(0, 3).join(" / ") : "核心运行时";
  switch (input.category) {
    case "feature":
      return churn >= 500
        ? `这是一次规模较大的功能迭代，主要围绕 ${scope} 展开，值得关注其接口与行为变化。`
        : `新增或增强了 ${scope} 相关能力，属于常规功能迭代。`;
    case "bugfix":
      return `修复了与 ${scope} 相关的缺陷，关注是否附带回归测试。`;
    case "performance":
      return `针对 ${scope} 的性能优化，建议结合基准或延迟数据评估收益。`;
    case "refactor":
      return `对 ${scope} 进行了结构调整，通常不改变外部行为，但可能影响扩展点。`;
    case "docs":
      return `文档与说明类更新，帮助理解 ${scope} 的使用方式。`;
    case "test":
      return `补充或调整测试，覆盖 ${scope} 的相关行为。`;
    case "tooling":
      return `工程/构建/依赖相关调整，影响 ${scope} 的开发与发布流程。`;
    default:
      return "零散改动，未匹配到明确的领域信号。";
  }
}

export interface CandidateSuggestion {
  name: string;
  description: string;
  moduleKey: string | null;
  confidence: number;
  evidence: string;
}

const SOURCE_FILE_PATTERN =
  /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|rs|go|py|java|kt|kts|swift|cs|scala|c|cc|cpp|h|hpp|mm|rb|php|lua|zig|ex|exs|sh|bash|zsh)$/i;
const NON_SOURCE_PATH =
  /(?:^|\/)(?:docs?|documentation|tests?|__tests__|specs?|fixtures?|examples?|benchmarks?)(?:\/|$)|(?:\.|_)(?:test|spec)\.[a-z0-9]+$/i;
const NEW_FEATURE_SIGNAL =
  /\b(?:new|add|adds|added|implement\w*|introduc\w*|support|supports|enable|enables)\b|新增|实现|支持|引入|加入/i;

export function suggestCandidate(input: {
  category: CommitCategory;
  subject: string;
  body?: string | null;
  files: Array<{ path: string }>;
}): CandidateSuggestion | null {
  if (input.category !== "feature") return null;
  const cleaned = input.subject
    .replace(/^[a-zA-Z]+(?:\([^)]*\))?!?:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 6) return null;
  if (/^(chore|docs|test|ci|build|release|bump|version)/i.test(cleaned)) return null;

  // A candidate should describe capability work, not documentation or tests,
  // and the commit must touch at least one source file.
  const touchesSource = input.files.some(
    (file) => SOURCE_FILE_PATTERN.test(file.path) && !NON_SOURCE_PATH.test(file.path),
  );
  if (!touchesSource) return null;

  // Require explicit new-capability wording; incidental mentions of a module
  // (e.g. a fix that happens to touch MCP code) should not create candidates.
  const text = `${input.subject}\n${input.body ?? ""}`;
  if (!NEW_FEATURE_SIGNAL.test(text)) return null;

  const tags = extractTags({ subject: input.subject, body: input.body, files: input.files });
  return {
    name: cleaned.slice(0, 120),
    description: (input.body ?? "").trim().slice(0, 400) || cleaned,
    moduleKey: guessModuleKey({ subject: input.subject, body: input.body, tags }),
    confidence: 0.7,
    evidence: input.files
      .slice(0, 5)
      .map((file) => file.path)
      .join("\n"),
  };
}
