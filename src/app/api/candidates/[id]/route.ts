import { acceptCandidate, rejectCandidate } from "@/lib/catalog/candidates";
import { getDb } from "@/lib/db/client";
import { getCandidate, listCandidateChecks } from "@/lib/db/repositories/candidates";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, parseId, readJsonBody } from "@/lib/http/routeHelpers";
import { candidateActionSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的候选 ID", 400);

  try {
    const db = getDb();
    const candidate = getCandidate(db, id);
    if (!candidate) return apiError("候选不存在", 404);
    return apiOk({ candidate, checks: listCandidateChecks(db, id) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "candidates", 30);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的候选 ID", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = candidateActionSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "候选操作参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    if (parsed.data.action === "accept") {
      const result = acceptCandidate(db, id, {
        featureKey: parsed.data.featureKey,
        moduleKey: parsed.data.moduleKey,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        support: parsed.data.support.map((entry) => ({
          harnessId: entry.harnessId,
          status: entry.status,
          notes: entry.notes ?? null,
          evidence: entry.evidence ?? null,
        })),
        note: parsed.data.note,
      });
      return apiOk({
        featureId: result.feature.id,
        featureKey: result.feature.key,
        version: result.version,
      });
    }

    rejectCandidate(db, id);
    return apiOk({ rejected: true });
  } catch (error) {
    if (error instanceof Error && /already reviewed|not found/i.test(error.message)) {
      return apiError(error.message, 409);
    }
    if (
      error instanceof Error &&
      /invalid feature key|moduleKey is required|unknown harness/i.test(error.message)
    ) {
      return apiError(error.message, 422);
    }
    return serverError(error);
  }
}
