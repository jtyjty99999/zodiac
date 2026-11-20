import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { getFeatureByKey } from "@/lib/db/repositories/catalog";
import { latestFeatureAudit } from "@/lib/db/repositories/featureAudits";
import {
  activeFeatureAuditIds,
  beginFeatureAudit,
  FeatureAuditBusyError,
  FeatureAuditNotFoundError,
  runFeatureAudit,
} from "@/lib/features/run";
import { apiError, apiOk, serverError } from "@/lib/http/responses";
import { guardMutation } from "@/lib/http/routeHelpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

function decodeKey(raw: string): string | null {
  try {
    const key = decodeURIComponent(raw).trim();
    return key.length > 0 && key.length <= 200 ? key : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: Params) {
  const blocked = guardMutation(request, "feature-audit", 10);
  if (blocked) return blocked;

  const { key: rawKey } = await params;
  const key = decodeKey(rawKey);
  if (!key) return apiError("功能点标识无效", 400);

  try {
    const db = getDb();
    const audit = beginFeatureAudit(db, key);

    // after() keeps the background work alive past the 202 response.
    after(async () => {
      try {
        await runFeatureAudit(db, audit.id);
      } catch (error) {
        console.error(
          `[zodiac] feature audit ${audit.id} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    return apiOk({ id: audit.id, status: "running" }, undefined, 202);
  } catch (error) {
    if (error instanceof FeatureAuditNotFoundError) return apiError(error.message, 404);
    if (error instanceof FeatureAuditBusyError) return apiError(error.message, 409);
    return serverError(error);
  }
}

export async function GET(_request: Request, { params }: Params) {
  const { key: rawKey } = await params;
  const key = decodeKey(rawKey);
  if (!key) return apiError("功能点标识无效", 400);

  try {
    const db = getDb();
    const feature = getFeatureByKey(db, key);
    if (!feature) return apiError("功能点不存在", 404);
    return apiOk({
      audit: latestFeatureAudit(db, feature.id),
      active: activeFeatureAuditIds(),
    });
  } catch (error) {
    return serverError(error);
  }
}
