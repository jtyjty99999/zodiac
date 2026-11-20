import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AiConfig } from "@/lib/analysis/anthropic";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { type SynthesisInput, synthesizeExploration } from "@/lib/explore/ai";
import type { ExplorationEvidence } from "@/lib/types";

function makeDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

const enabledConfig: AiConfig = { enabled: true, hasKey: true, model: "m", maxPerSync: 20 };

function evidence(withSnippets = true): ExplorationEvidence {
  return {
    generatedAt: "2026-11-20T00:00:00.000Z",
    patterns: ["context", "compact"],
    harnesses: [
      {
        harnessId: 1,
        slug: "codex",
        name: "Codex",
        status: "ok",
        rev: "a".repeat(40),
        totalFiles: withSnippets ? 1 : 0,
        totalMatches: withSnippets ? 2 : 0,
        files: withSnippets
          ? [
              {
                path: "src/context.rs",
                total: 2,
                snippets: [{ line: 10, text: "10: fn compact() {}" }],
              },
            ]
          : [],
        note: null,
        truncated: false,
      },
    ],
    relatedFeatures: [],
    truncated: false,
  };
}

const input: SynthesisInput = {
  proposition: "各 harness 如何处理上下文压缩",
  patterns: ["context", "compact"],
  evidence: evidence(),
  matchedFeatures: [],
};

function fakeClient(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }),
    },
  } as unknown as Anthropic;
}

async function withKey<T>(fn: () => T | Promise<T>): Promise<T> {
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("synthesizeExploration", () => {
  test("returns null when AI is disabled", async () => {
    const factory = vi.fn();
    const result = await synthesizeExploration(makeDb(), input, {
      config: { ...enabledConfig, enabled: false },
      clientFactory: factory,
    });
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  test("returns null without an API key", async () => {
    const factory = vi.fn();
    const result = await synthesizeExploration(makeDb(), input, {
      config: enabledConfig,
      clientFactory: factory,
    });
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  test("skips the model when no harness produced snippets", async () => {
    const factory = vi.fn();
    const result = await withKey(() =>
      synthesizeExploration(
        makeDb(),
        { ...input, evidence: evidence(false) },
        { config: enabledConfig, clientFactory: factory },
      ),
    );
    expect(result).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  test("parses fenced JSON and keeps only known, unique harness slugs", async () => {
    await withKey(async () => {
      const payload = {
        summaryMd: "Codex 通过 compact 压缩上下文。",
        differencesMd: "只检索到 Codex。",
        harnesses: [
          { slug: "codex", analysisMd: "Codex 在 src/context.rs:10 实现压缩。" },
          { slug: "codex", analysisMd: "重复条目" },
          { slug: "ghost", analysisMd: "未知 harness" },
        ],
      };
      const result = await synthesizeExploration(makeDb(), input, {
        config: enabledConfig,
        clientFactory: () => fakeClient(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``),
      });
      expect(result?.summaryMd).toBe("Codex 通过 compact 压缩上下文。");
      expect(result?.differencesMd).toBe("只检索到 Codex。");
      expect(result?.harnesses).toEqual([
        { slug: "codex", analysisMd: "Codex 在 src/context.rs:10 实现压缩。" },
      ]);
    });
  });

  test("normalizes an omitted differencesMd to null", async () => {
    await withKey(async () => {
      const payload = {
        summaryMd: "Codex 单独实现了压缩。",
        harnesses: [{ slug: "codex", analysisMd: "证据位于 src/context.rs。" }],
      };
      const result = await synthesizeExploration(makeDb(), input, {
        config: enabledConfig,
        clientFactory: () => fakeClient(JSON.stringify(payload)),
      });
      expect(result?.differencesMd).toBeNull();
    });
  });

  test("returns null on invalid JSON or schema violations", async () => {
    await withKey(async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const invalidJson = await synthesizeExploration(makeDb(), input, {
        config: enabledConfig,
        clientFactory: () => fakeClient("not json"),
      });
      expect(invalidJson).toBeNull();

      const invalidSchema = await synthesizeExploration(makeDb(), input, {
        config: enabledConfig,
        clientFactory: () => fakeClient(JSON.stringify({ summaryMd: "", harnesses: "nope" })),
      });
      expect(invalidSchema).toBeNull();
    });
  });
});
