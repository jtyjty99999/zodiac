import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { extractJson, requestClaudeJson } from "@/lib/analysis/claudeJson";

const schema = z.object({ ok: z.boolean(), name: z.string().optional() });
const config = { enabled: true, hasKey: true, model: "m" };

function fakeClient(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }),
    },
  } as unknown as Anthropic;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("extractJson", () => {
  test("parses a bare JSON object", () => {
    expect(extractJson('{"ok":true}')).toEqual({ ok: true });
  });

  test("parses fenced JSON with surrounding prose", () => {
    expect(extractJson('Here:\n```json\n{"ok":true,"name":"x"}\n```\nDone.')).toEqual({
      ok: true,
      name: "x",
    });
  });

  test("tolerates prose braces by taking the outer object", () => {
    expect(extractJson('prefix {"ok": true} suffix')).toEqual({ ok: true });
  });

  test("throws when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow(/no JSON object/);
  });
});

describe("requestClaudeJson", () => {
  test("returns null without calling the model when disabled or keyless", async () => {
    const factory = vi.fn();
    process.env.ANTHROPIC_API_KEY = "test-key";
    const disabled = await requestClaudeJson({
      config: { ...config, enabled: false },
      system: "s",
      user: "u",
      schema,
      maxTokens: 100,
      clientFactory: factory,
    });
    expect(disabled).toBeNull();

    delete process.env.ANTHROPIC_API_KEY;
    const keyless = await requestClaudeJson({
      config,
      system: "s",
      user: "u",
      schema,
      maxTokens: 100,
      clientFactory: factory,
    });
    expect(keyless).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  test("calls the injected client and validates the result", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const result = await requestClaudeJson({
      config,
      system: "s",
      user: "u",
      schema,
      maxTokens: 100,
      clientFactory: (key) => {
        expect(key).toBe("test-key");
        return fakeClient('{"ok":true,"name":"zodiac"}');
      },
    });
    expect(result).toEqual({ ok: true, name: "zodiac" });
  });

  test("returns null and warns on schema violations or client errors", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      await requestClaudeJson({
        config,
        system: "s",
        user: "u",
        schema,
        maxTokens: 100,
        clientFactory: () => fakeClient('{"ok":"nope"}'),
      }),
    ).toBeNull();

    const throwingClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error("network down")) },
    } as unknown as Anthropic;
    expect(
      await requestClaudeJson({
        config,
        system: "s",
        user: "u",
        schema,
        maxTokens: 100,
        clientFactory: () => throwingClient,
      }),
    ).toBeNull();

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
