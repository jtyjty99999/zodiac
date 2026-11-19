import { analyzeCommitById } from "@/lib/analysis";
import { getAiConfig } from "@/lib/analysis/anthropic";
import { getDb } from "@/lib/db/client";
import { getCommitById } from "@/lib/db/repositories/commits";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, parseId } from "@/lib/http/routeHelpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "commit-analyze", 20);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的提交 ID", 400);

  try {
    const db = getDb();
    const commit = getCommitById(db, id);
    if (!commit) return apiError("提交不存在", 404);

    const config = getAiConfig(db);
    const outcome = await analyzeCommitById(db, id, {
      force: true,
      useAi: config.enabled,
      aiConfig: config,
    });
    if (!outcome) return apiError("分析失败", 500);
    return apiOk(outcome);
  } catch (error) {
    return serverError(error);
  }
}
