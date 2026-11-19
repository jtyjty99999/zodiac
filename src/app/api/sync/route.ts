import { getDb } from "@/lib/db/client";
import { getHarnessById, listHarnesses } from "@/lib/db/repositories/harnesses";
import { getRunningSyncRun, listSyncRuns } from "@/lib/db/repositories/syncRuns";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { syncHarness } from "@/lib/ingest/sync";
import { syncRequestSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardMutation(request, "sync", 6);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = syncRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "同步参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    let targets = [];

    if (parsed.data.harnessId) {
      const harness = getHarnessById(db, parsed.data.harnessId);
      if (!harness) return apiError("Harness 不存在", 404);
      targets = [harness];
    } else if (parsed.data.all) {
      targets = listHarnesses(db, { enabledOnly: true });
    } else {
      return apiError("需要指定 harnessId 或 all=true", 400);
    }

    if (targets.length === 0) return apiError("没有可同步的 harness", 409);

    const alreadyRunning = targets.filter((harness) => getRunningSyncRun(db, harness.id));
    const started = targets.filter((harness) => !alreadyRunning.includes(harness));

    if (started.length === 0) {
      return apiOk(
        { started: [], alreadyRunning: alreadyRunning.map((harness) => harness.slug) },
        undefined,
        202,
      );
    }

    const analyze = parsed.data.analyze !== false;
    void (async () => {
      for (const harness of started) {
        try {
          await syncHarness(db, harness.id, { trigger: "manual", analyze });
        } catch (error) {
          console.error(
            `[zodiac] manual sync failed for ${harness.slug}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();

    return apiOk(
      {
        started: started.map((harness) => ({ harnessId: harness.id, slug: harness.slug })),
        alreadyRunning: alreadyRunning.map((harness) => harness.slug),
      },
      undefined,
      202,
    );
  } catch (error) {
    return serverError(error);
  }
}

export async function GET() {
  try {
    const db = getDb();
    const runs = listSyncRuns(db, undefined, 30);
    const running = runs.filter((run) => run.status === "running");
    return apiOk({ running, recent: runs.slice(0, 20) });
  } catch (error) {
    return serverError(error);
  }
}
