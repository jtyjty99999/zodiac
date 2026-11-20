import { commitCatalogChange } from "@/lib/catalog/versions";
import { getDb } from "@/lib/db/client";
import { getFeatureById, setFeatureDeepDive } from "@/lib/db/repositories/catalog";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, parseId, readJsonBody } from "@/lib/http/routeHelpers";
import { featureDeepDiveSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Marks a feature as a deep-dive comparison (or removes the badge). Idempotent:
 * re-setting the same value leaves the catalog and baseline untouched.
 */
export async function POST(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "feature-deep-dive", 30);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的功能点 ID", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = featureDeepDiveSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "深挖参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    const feature = getFeatureById(db, id);
    if (!feature) return apiError("功能点不存在", 404);

    if (feature.isDeepDive === parsed.data.deepDive) {
      return apiOk({ featureId: id, deepDive: feature.isDeepDive, version: null });
    }

    setFeatureDeepDive(db, id, parsed.data.deepDive);
    const version = commitCatalogChange(db, {
      note: `${parsed.data.deepDive ? "设为" : "取消"}深挖：${feature.name}`,
    }).version;
    return apiOk({ featureId: id, deepDive: parsed.data.deepDive, version });
  } catch (error) {
    return serverError(error);
  }
}
