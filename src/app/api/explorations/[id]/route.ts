import { getDb } from "@/lib/db/client";
import {
  deleteExploration,
  failStaleExplorations,
  getExploration,
} from "@/lib/db/repositories/explorations";
import { activeExplorationIds } from "@/lib/explore/run";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, parseId } from "@/lib/http/routeHelpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的探索 ID", 400);

  try {
    const db = getDb();
    failStaleExplorations(db, activeExplorationIds());
    const exploration = getExploration(db, id);
    if (!exploration) return apiError("探索不存在", 404);
    return apiOk({ exploration });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "explorations-delete", 20);
  if (blocked) return blocked;

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return apiError("无效的探索 ID", 400);

  try {
    const db = getDb();
    const exploration = getExploration(db, id);
    if (!exploration) return apiError("探索不存在", 404);
    if (exploration.status === "running" || activeExplorationIds().includes(id)) {
      return apiError("探索正在进行中，暂时无法删除", 409);
    }
    const deleted = deleteExploration(db, id);
    if (!deleted) return apiError("探索正在进行中，暂时无法删除", 409);
    return apiOk({ deleted: true });
  } catch (error) {
    return serverError(error);
  }
}
