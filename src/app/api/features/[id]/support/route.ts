import { saveFeatureSupport } from "@/lib/catalog/matrix";
import { getDb } from "@/lib/db/client";
import { getFeatureById } from "@/lib/db/repositories/catalog";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { featureSupportSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardMutation(request, "feature-support", 60);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = featureSupportSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "功能点状态参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    if (!getFeatureById(db, parsed.data.featureId)) return apiError("功能点不存在", 404);

    const result = saveFeatureSupport(db, {
      featureId: parsed.data.featureId,
      harnessId: parsed.data.harnessId,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      evidence: parsed.data.evidence ?? null,
      sinceVersion: parsed.data.sinceVersion ?? null,
    });
    return apiOk(result);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return apiError(error.message, 404);
    }
    return serverError(error);
  }
}
