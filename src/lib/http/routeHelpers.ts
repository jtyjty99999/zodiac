import type { NextResponse } from "next/server";
import { checkRateLimit, clientKey, isSameOrigin } from "./guard";
import { apiError } from "./responses";

export function guardMutation(request: Request, scope: string, limit = 60): NextResponse | null {
  if (!isSameOrigin(request)) {
    return apiError("跨站请求被拒绝", 403);
  }
  const result = checkRateLimit(`${clientKey(request)}:${scope}`, limit, 60_000);
  if (!result.allowed) {
    const response = apiError("请求过于频繁，请稍后再试", 429);
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
    return response;
  }
  return null;
}

const MAX_JSON_BODY_BYTES = 1_000_000;

async function readBodyText(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length > MAX_JSON_BODY_BYTES) return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const text = await readBodyText(request).catch(() => null);
  if (text === null) {
    return { ok: false, response: apiError("请求体过大或无法读取", 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError("请求体必须是合法 JSON", 400) };
  }
}

export function parseId(value: string): number | null {
  if (!/^\d{1,12}$/.test(value)) return null;
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
