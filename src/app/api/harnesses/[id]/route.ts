import { getDb } from "@/lib/db/client";
import { deleteHarness, getHarnessById, updateHarness } from "@/lib/db/repositories/harnesses";
import { removeHarnessData } from "@/lib/git/mirror";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, parseId, readJsonBody } from "@/lib/http/routeHelpers";
import { harnessPatchSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "harnesses", 30);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的 Harness ID", 400);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = harnessPatchSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "Harness 参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const updated = updateHarness(getDb(), id, parsed.data);
    if (!updated) return apiError("Harness 不存在", 404);
    return apiOk(updated);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "harnesses", 20);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的 Harness ID", 400);

  try {
    const harness = getHarnessById(getDb(), id);
    if (!harness) return apiError("Harness 不存在", 404);
    const removed = deleteHarness(getDb(), id);
    if (removed) {
      try {
        removeHarnessData(harness.slug);
      } catch (error) {
        // The database row is already gone; stale mirror files are harmless.
        console.error("Failed to remove harness data", error);
      }
    }
    return apiOk({ removed });
  } catch (error) {
    return serverError(error);
  }
}
