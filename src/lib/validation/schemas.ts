import { z } from "zod";
import { CLAUDE_CODE_COMMAND_MAX_LENGTH, isValidClaudeCommand } from "../explore/engineSettings";
import { COMMIT_CATEGORIES } from "../types";
import { isTimezone } from "../utils/time";

export const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,49}$/, "slug 只能包含小写字母、数字与连字符（2-50 位）");

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "无效日期");

const REPO_URL_PROTOCOLS = new Set(["https:", "ssh:"]);
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

// Repo URLs are fetched by the server, so loopback/private targets and raw IP
// literals are refused to keep the sync pipeline from acting as an SSRF proxy.
function isUnsafeRepoHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".")) return true;
  if (host === "localhost" || LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  // IPv4 literal (including metadata addresses like 169.254.169.254) or IPv6.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return false;
}

export function isValidRepoUrl(value: string): boolean {
  const url = value.trim();
  if (!url || url.length > 300) return false;
  if (/[\s`$;&|<>\\"']/.test(url)) return false;

  const scp = /^git@([A-Za-z0-9.-]+):([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;
  if (url.startsWith("git@")) {
    const match = scp.exec(url);
    return match !== null && !isUnsafeRepoHost(match[1]);
  }

  try {
    const parsed = new URL(url);
    if (!REPO_URL_PROTOCOLS.has(parsed.protocol)) return false;
    if (isUnsafeRepoHost(parsed.hostname)) return false;
    return /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export const repoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(isValidRepoUrl, "仅支持 https/ssh 的 owner/repo 形式域名仓库地址");

export function isValidBranch(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("..") || value.includes("\\") || value.includes(" ")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(value);
}

export const branchSchema = z.string().trim().max(200).refine(isValidBranch, "无效的 git 分支名");

export const shaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, "无效的提交 SHA");

export const scheduleModeSchema = z.enum(["off", "hourly", "daily"]);

export const dailyTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");

export const harnessCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  repoUrl: repoUrlSchema,
  branch: branchSchema.optional(),
  enabled: z.boolean().optional(),
  scheduleMode: scheduleModeSchema.optional(),
  dailyTime: dailyTimeSchema.optional(),
  backfillDays: z.coerce.number().int().min(1).max(3650).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const harnessPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    repoUrl: repoUrlSchema.optional(),
    branch: branchSchema.optional(),
    enabled: z.boolean().optional(),
    scheduleMode: scheduleModeSchema.optional(),
    dailyTime: dailyTimeSchema.optional(),
    backfillDays: z.coerce.number().int().min(1).max(3650).optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    baselineSha: shaSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "没有需要更新的字段");

export const supportStatusSchema = z.enum(["yes", "partial", "no", "unknown"]);

export const featureSupportSchema = z.object({
  featureId: z.coerce.number().int().positive(),
  harnessId: z.coerce.number().int().positive(),
  status: supportStatusSchema,
  notes: z.string().max(4000).nullable().optional(),
  evidence: z.string().max(4000).nullable().optional(),
  sinceVersion: z.string().max(80).nullable().optional(),
});

export const featureDeepDiveSchema = z.object({
  deepDive: z.boolean(),
});

export const featureKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)+$/, "功能点 key 形如 module.feature");

export const candidateAcceptSchema = z.object({
  action: z.literal("accept"),
  featureKey: featureKeySchema,
  moduleKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  support: z
    .array(
      z.object({
        harnessId: z.coerce.number().int().positive(),
        status: supportStatusSchema,
        notes: z.string().max(2000).nullable().optional(),
        evidence: z.string().max(2000).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
  note: z.string().max(500).optional(),
});

export const candidateRejectSchema = z.object({
  action: z.literal("reject"),
  note: z.string().max(500).optional(),
});

export const candidateActionSchema = z.discriminatedUnion("action", [
  candidateAcceptSchema,
  candidateRejectSchema,
]);

export const syncRequestSchema = z.object({
  harnessId: z.coerce.number().int().positive().optional(),
  all: z.boolean().optional(),
  analyze: z.boolean().optional(),
});

export const commitAnalyzeSchema = z.object({
  force: z.boolean().optional(),
});

export const explorationCreateSchema = z.object({
  proposition: z.string().trim().min(5, "命题至少 5 个字符").max(600, "命题最多 600 个字符"),
  harnessIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
});

export const settingsSchema = z
  .object({
    aiEnabled: z.boolean().optional(),
    aiModel: z.string().trim().min(1).max(120).optional(),
    aiMaxPerSync: z.coerce.number().int().min(0).max(200).optional(),
    timezone: z.string().trim().refine(isTimezone, "无效的 IANA 时区").optional(),
    exploreEngine: z.enum(["api", "claude-code"]).optional(),
    claudeCodeCommand: z
      .string()
      .trim()
      .max(CLAUDE_CODE_COMMAND_MAX_LENGTH, "Claude Code 命令过长")
      .refine(isValidClaudeCommand, "Claude Code 命令不能为空且不能包含控制字符")
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "没有需要更新的字段");

export const commitFilterSchema = z.object({
  harnessId: z.coerce.number().int().positive().optional(),
  category: z.enum(COMMIT_CATEGORIES as [string, ...string[]]).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  fromDay: daySchema.optional(),
  toDay: daySchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export type HarnessCreateInput = z.infer<typeof harnessCreateSchema>;
export type HarnessPatchInput = z.infer<typeof harnessPatchSchema>;
