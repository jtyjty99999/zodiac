import { getAiConfig } from "@/lib/analysis/anthropic";
import { type Db, getDb } from "@/lib/db/client";
import { getAllSettings, setSetting } from "@/lib/db/repositories/settings";
import { getExplorationEngineSettings } from "@/lib/explore/engineSettings";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { getTimezone } from "@/lib/utils/time";
import { settingsSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

function settingsPayload(db: Db) {
  const config = getAiConfig(db);
  return {
    settings: getAllSettings(db),
    ai: {
      enabled: config.enabled,
      hasKey: config.hasKey,
      model: config.model,
      maxPerSync: config.maxPerSync,
    },
    explore: getExplorationEngineSettings(db),
    timezone: getTimezone(),
    schedulerEnabled: process.env.ZODIAC_SCHEDULER !== "off",
    hasGithubToken: Boolean(process.env.GITHUB_TOKEN?.trim()),
  };
}

export async function GET() {
  try {
    return apiOk(settingsPayload(getDb()));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  const blocked = guardMutation(request, "settings", 30);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = settingsSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "设置参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    const input = parsed.data;

    if (input.aiEnabled !== undefined) setSetting(db, "aiEnabled", String(input.aiEnabled));
    if (input.aiModel !== undefined) setSetting(db, "aiModel", input.aiModel);
    if (input.aiMaxPerSync !== undefined)
      setSetting(db, "aiMaxPerSync", String(input.aiMaxPerSync));
    if (input.timezone !== undefined) {
      setSetting(db, "timezone", input.timezone);
      process.env.ZODIAC_TZ = input.timezone;
    }
    if (input.exploreEngine !== undefined) {
      setSetting(db, "exploreEngine", input.exploreEngine);
    }
    if (input.claudeCodeCommand !== undefined) {
      setSetting(db, "claudeCodeCommand", input.claudeCodeCommand);
    }
    if (input.codexCommand !== undefined) {
      setSetting(db, "codexCommand", input.codexCommand);
    }
    if (input.deepseekCommand !== undefined) {
      setSetting(db, "deepseekCommand", input.deepseekCommand);
    }

    return apiOk(settingsPayload(db));
  } catch (error) {
    return serverError(error);
  }
}
