import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: ApiMeta;
  details?: unknown;
}

export function apiOk<T>(data: T, meta?: ApiMeta, status = 200): NextResponse {
  const body: ApiEnvelope<T> = { success: true, data, error: null, ...(meta ? { meta } : {}) };
  return NextResponse.json(body, { status });
}

export function apiError(message: string, status = 400, details?: unknown): NextResponse {
  const body: ApiEnvelope<null> = {
    success: false,
    data: null,
    error: message,
    ...(details === undefined ? {} : { details }),
  };
  return NextResponse.json(body, { status });
}

export function validationError(error: ZodError): NextResponse {
  return apiError(
    "请求参数校验失败",
    422,
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

export function serverError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Unknown error";
  // Detailed cause stays on the server; the client gets a generic message.
  console.error("[zodiac] API error:", message);
  return apiError("服务器内部错误", 500);
}

export function unauthorized(): NextResponse {
  return apiError("请求来源不被允许", 403);
}
