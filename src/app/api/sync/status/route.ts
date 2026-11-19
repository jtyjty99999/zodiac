import { getDb } from "@/lib/db/client";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { listSyncRuns } from "@/lib/db/repositories/syncRuns";
import { apiOk, serverError } from "@/lib/http/responses";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const runs = listSyncRuns(db, undefined, 40);
    const running = runs.filter((run) => run.status === "running");
    const harnesses = listHarnesses(db);

    return apiOk({
      running,
      recent: runs.slice(0, 20),
      harnesses: harnesses.map((harness) => ({
        id: harness.id,
        slug: harness.slug,
        name: harness.name,
        lastSyncAt: harness.lastSyncAt,
        lastSuccessAt: harness.lastSuccessAt,
        lastError: harness.lastError,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}
