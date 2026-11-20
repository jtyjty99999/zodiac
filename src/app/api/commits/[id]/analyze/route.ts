import { after } from "next/server";
import { beginCommitAnalysis, isCommitAnalyzing, runCommitAnalysis } from "@/lib/analysis/active";
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

    // Idempotent: a second click while the analysis runs just reports progress.
    if (!beginCommitAnalysis(id)) {
      return apiOk({ id, status: "running" }, undefined, 202);
    }

    // after() keeps the background work alive past the 202 response.
    after(async () => {
      await runCommitAnalysis(db, id);
    });

    return apiOk({ id, status: "running" }, undefined, 202);
  } catch (error) {
    return serverError(error);
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的提交 ID", 400);

  try {
    const db = getDb();
    const commit = getCommitById(db, id);
    if (!commit) return apiError("提交不存在", 404);
    return apiOk({
      id,
      analyzing: isCommitAnalyzing(id),
      analyzedBy: commit.analyzedBy,
      analyzedAt: commit.analyzedAt,
    });
  } catch (error) {
    return serverError(error);
  }
}
