import { getDb } from "@/lib/db/client";
import { createHarness, getHarnessBySlug, listHarnesses } from "@/lib/db/repositories/harnesses";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { harnessCreateSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return apiOk(listHarnesses(getDb()));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  const blocked = guardMutation(request, "harnesses", 20);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = harnessCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "Harness 参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    if (getHarnessBySlug(db, parsed.data.slug)) {
      return apiError("slug 已存在", 409);
    }
    const { harness } = createHarness(db, {
      slug: parsed.data.slug,
      name: parsed.data.name,
      repoUrl: parsed.data.repoUrl,
      branch: parsed.data.branch,
      enabled: parsed.data.enabled,
      scheduleMode: parsed.data.scheduleMode,
      dailyTime: parsed.data.dailyTime,
      backfillDays: parsed.data.backfillDays,
      sortOrder: parsed.data.sortOrder,
    });
    return apiOk(harness, undefined, 201);
  } catch (error) {
    return serverError(error);
  }
}
