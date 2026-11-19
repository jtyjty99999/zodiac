import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { checkRateLimit, clientKey, isSameOrigin } from "@/lib/http/guard";
import { apiError, apiOk, serverError, unauthorized, validationError } from "@/lib/http/responses";
import { guardMutation, parseId, readJsonBody } from "@/lib/http/routeHelpers";

let scopeCounter = 0;
function uniqueScope(): string {
  scopeCounter += 1;
  return `test-${scopeCounter}-${Date.now()}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkRateLimit", () => {
  test("allows requests within the window and reports the remainder", () => {
    const key = uniqueScope();
    const first = checkRateLimit(key, 2, 60_000);
    expect(first).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    expect(checkRateLimit(key, 2, 60_000).allowed).toBe(true);

    const blocked = checkRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("resets once the window elapses", () => {
    const key = uniqueScope();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    expect(checkRateLimit(key, 1, 5_000).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 5_000).allowed).toBe(false);
    now.mockReturnValue(1_006_000);
    expect(checkRateLimit(key, 1, 5_000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  function request(headers: Record<string, string>) {
    return new Request("http://localhost/api", { headers });
  }

  test("ignores spoofable forwarded headers", () => {
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("local");
    expect(clientKey(request({ "x-real-ip": "9.9.9.9" }))).toBe("local");
    expect(clientKey(request({}))).toBe("local");
  });
});

describe("isSameOrigin", () => {
  function request(headers: Record<string, string>) {
    return new Request("http://localhost/api", { headers });
  }

  test("rejects requests without an Origin header", () => {
    expect(isSameOrigin(request({ host: "localhost:3000" }))).toBe(false);
  });

  test("matches the host header", () => {
    expect(isSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(
      true,
    );
    expect(isSameOrigin(request({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(
      false,
    );
  });

  test("rejects non-loopback hosts even when Origin agrees (DNS rebinding)", () => {
    expect(
      isSameOrigin(request({ origin: "http://evil.example:3000", host: "evil.example:3000" })),
    ).toBe(false);
    expect(
      isSameOrigin(request({ origin: "http://192.168.1.5:3000", host: "192.168.1.5:3000" })),
    ).toBe(false);
  });

  test("accepts loopback variants", () => {
    expect(isSameOrigin(request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(
      true,
    );
    expect(isSameOrigin(request({ origin: "http://[::1]:3000", host: "[::1]:3000" }))).toBe(true);
  });

  test("rejects origins when the host is missing or malformed", () => {
    expect(isSameOrigin(request({ origin: "http://localhost" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "not a url", host: "localhost" }))).toBe(false);
  });
});

describe("responses", () => {
  test("apiOk wraps data with optional meta", async () => {
    const plain = apiOk({ value: 1 });
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({ success: true, data: { value: 1 }, error: null });

    const created = apiOk({ id: 7 }, { total: 9, page: 1, limit: 10 }, 201);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      success: true,
      data: { id: 7 },
      error: null,
      meta: { total: 9, page: 1, limit: 10 },
    });
  });

  test("apiError carries status and optional details", async () => {
    const plain = apiError("bad");
    expect(plain.status).toBe(400);
    expect(await plain.json()).toEqual({ success: false, data: null, error: "bad" });

    const withDetails = apiError("nope", 409, [{ path: "a", message: "m" }]);
    expect(withDetails.status).toBe(409);
    expect((await withDetails.json()).details).toEqual([{ path: "a", message: "m" }]);
  });

  test("validationError formats zod issues", async () => {
    const schema = z.object({ name: z.string().min(3), count: z.number() });
    const result = schema.safeParse({ name: "x", count: "no" });
    expect(result.success).toBe(false);
    const response = validationError(result.error!);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("请求参数校验失败");
    expect(body.details).toHaveLength(2);
    expect(body.details[0].path).toBe("name");
  });

  test("serverError hides internals but logs them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = serverError(new Error("secret stack detail"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      data: null,
      error: "服务器内部错误",
    });
    expect(spy).toHaveBeenCalled();

    const unknown = serverError("string failure");
    expect(unknown.status).toBe(500);
  });

  test("unauthorized is a 403", async () => {
    const response = unauthorized();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("请求来源不被允许");
  });
});

describe("guardMutation", () => {
  function request(headers: Record<string, string>) {
    return new Request("http://localhost/api/sync", { method: "POST", headers });
  }

  test("allows same-origin requests under the limit", () => {
    expect(
      guardMutation(
        request({ origin: "http://localhost:3000", host: "localhost:3000" }),
        uniqueScope(),
      ),
    ).toBeNull();
  });

  test("rejects cross-origin requests", async () => {
    const response = guardMutation(
      request({ origin: "https://evil.example", host: "localhost:3000" }),
      uniqueScope(),
    );
    expect(response?.status).toBe(403);
  });

  test("rate limits and advertises Retry-After", async () => {
    const scope = uniqueScope();
    const headers = { origin: "http://localhost:3000", host: "localhost:3000" };
    expect(guardMutation(request(headers), scope, 1)).toBeNull();
    const blocked = guardMutation(request(headers), scope, 1);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("readJsonBody", () => {
  test("parses valid JSON", async () => {
    const result = await readJsonBody(
      new Request("http://localhost", { method: "POST", body: '{"a":1}' }),
    );
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  test("returns a 400 response for invalid JSON", async () => {
    const result = await readJsonBody(
      new Request("http://localhost", { method: "POST", body: "{oops" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  test("rejects bodies above the size cap", async () => {
    const oversized = JSON.stringify({ blob: "x".repeat(1_000_001) });
    const streamed = await readJsonBody(
      new Request("http://localhost", { method: "POST", body: oversized }),
    );
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.response.status).toBe(413);

    const declared = await readJsonBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "1000001" },
        body: "{}",
      }),
    );
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.response.status).toBe(413);
  });
});

describe("parseId", () => {
  test("accepts positive integers", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("123456")).toBe(123456);
  });

  test("rejects zero, negatives and garbage", () => {
    expect(parseId("0")).toBeNull();
    expect(parseId("-1")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("abc")).toBeNull();
    expect(parseId("1234567890123")).toBeNull();
  });
});
