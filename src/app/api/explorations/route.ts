import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { failStaleExplorations, listExplorations } from "@/lib/db/repositories/explorations";
import {
  activeExplorationIds,
  beginExploration,
  ExplorationBusyError,
  HarnessNotFoundError,
  NoHarnessesError,
  runExploration,
} from "@/lib/explore/run";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation, readJsonBody } from "@/lib/http/routeHelpers";
import { explorationCreateSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardMutation(request, "explorations", 6);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = explorationCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(
      "探索参数无效",
      422,
      parsed.error.issues.map((issue) => issue.message),
    );
  }

  try {
    const db = getDb();
    const exploration = beginExploration(db, {
      proposition: parsed.data.proposition,
      harnessIds: parsed.data.harnessIds,
    });

    // after() keeps the background work alive past the 202 response.
    after(async () => {
      try {
        await runExploration(db, exploration.id);
      } catch (error) {
        console.error(
          `[zodiac] exploration ${exploration.id} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    return apiOk({ id: exploration.id, status: "running" }, undefined, 202);
  } catch (error) {
    if (error instanceof ExplorationBusyError) return apiError(error.message, 409);
    if (error instanceof NoHarnessesError) return apiError(error.message, 409);
    if (error instanceof HarnessNotFoundError) return apiError(error.message, 422);
    return serverError(error);
  }
}

export async function GET() {
  try {
    const db = getDb();
    failStaleExplorations(db, activeExplorationIds());
    return apiOk({ explorations: listExplorations(db, 30) });
  } catch (error) {
    return serverError(error);
  }
}
