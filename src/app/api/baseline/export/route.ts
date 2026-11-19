import { NextResponse } from "next/server";
import { snapshotToMarkdown } from "@/lib/catalog/markdown";
import { buildHarnessShas } from "@/lib/catalog/versions";
import { getDb } from "@/lib/db/client";
import { exportCatalogSnapshot } from "@/lib/db/repositories/catalog";
import { listHarnesses } from "@/lib/db/repositories/harnesses";
import { serverError } from "@/lib/http/responses";
import { toDay } from "@/lib/utils/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const snapshot = exportCatalogSnapshot(db);
    const day = toDay(new Date());
    const format = new URL(request.url).searchParams.get("format");

    if (format === "md") {
      const markdown = snapshotToMarkdown(snapshot, listHarnesses(db));
      return new NextResponse(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="zodiac-baseline-${day}.md"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const payload = { ...snapshot, harnessShas: buildHarnessShas(db) };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="zodiac-baseline-${day}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
