import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { getHarnessById, listHarnesses } from "@/lib/db/repositories/harnesses";
import { listRunningSyncRuns, listSyncRuns } from "@/lib/db/repositories/syncRuns";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { beginSyncRun, runSyncRun } from "@/lib/ingest/sync";
import type { Harness, SyncRun } from "@/lib/types";
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
    let targets: Harness[] = [];

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

    const started: Array<{ harnessId: number; slug: string; runId: number }> = [];
    const alreadyRunning: Array<{ harnessId: number; slug: string; runId: number | null }> = [];
    const jobs: Array<{ harness: Harness; run: SyncRun }> = [];

    // Reserve every run synchronously so the client gets run ids back that it
    // can poll. Work starts only after the response is sent.
    for (const harness of targets) {
      const begin = beginSyncRun(db, harness.id, "manual");
      if (begin.status === "started" && begin.run) {
        jobs.push({ harness: begin.harness, run: begin.run });
        started.push({ harnessId: harness.id, slug: harness.slug, runId: begin.run.id });
      } else {
        alreadyRunning.push({
          harnessId: harness.id,
          slug: harness.slug,
          runId: begin.run?.id ?? null,
        });
      }
    }

    const analyze = parsed.data.analyze !== false;
    if (jobs.length > 0) {
      // after() keeps the background work alive past the 202 response; a plain
      // floating promise can be cancelled when the request scope ends.
      after(async () => {
        for (const job of jobs) {
          try {
            await runSyncRun(db, job.harness, job.run, { trigger: "manual", analyze });
          } catch (error) {
            console.error(
              `[zodiac] manual sync failed for ${job.harness.slug}:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      });
    }

    return apiOk({ started, alreadyRunning }, undefined, 202);
  } catch (error) {
    return serverError(error);
  }
}

export async function GET() {
  try {
    const db = getDb();
    const runs = listSyncRuns(db, undefined, 30);
    return apiOk({ running: listRunningSyncRuns(db), recent: runs.slice(0, 20) });
  } catch (error) {
    return serverError(error);
  }
}
