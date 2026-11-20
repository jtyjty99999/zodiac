import { getDb } from "@/lib/db/client";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import {
  getSyncRunsByIds,
  listRunningSyncRuns,
  listSyncRuns,
} from "@/lib/db/repositories/syncRuns";
import { apiOk, serverError } from "@/lib/http/responses";
import { parseId } from "@/lib/http/routeHelpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const runIds = (new URL(request.url).searchParams.get("runIds") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map(parseId)
      .filter((id): id is number => id !== null);

    const runs = listSyncRuns(db, undefined, 40);
    const harnesses = listHarnesses(db);

    return apiOk({
      running: listRunningSyncRuns(db),
      recent: runs.slice(0, 20),
      // Only populated when the client polls its own run ids.
      runs: runIds.length > 0 ? getSyncRunsByIds(db, runIds) : [],
      harnesses: harnesses.map((harness) => ({
        id: harness.id,
        slug: harness.slug,
        name: harness.name,
        lastAttemptAt: harness.lastAttemptAt,
        lastSyncAt: harness.lastSyncAt,
        lastSuccessAt: harness.lastSuccessAt,
        lastError: harness.lastError,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}
