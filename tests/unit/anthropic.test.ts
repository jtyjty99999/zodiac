import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AI_RESULT_JSON_SCHEMA,
  type AiCommitContext,
  analyzeWithClaude,
  buildUserPrompt,
  COMMIT_REVIEW_SYSTEM_PROMPT,
  getAiConfig,
} from "@/lib/analysis/anthropic";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { setSetting } from "@/lib/db/repositories/settings";

function freshDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

async function withKey<T>(fn: () => T | Promise<T>): Promise<T> {
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
}

const context: AiCommitContext = {
  repo: "https://github.com/openai/codex",
  sha: "a".repeat(40),
  subject: "feat: add MCP stdio transport",
  body: "Exposes an MCP client.",
  files: [{ path: "src/mcp.ts", additions: 120, deletions: 3 }],
  diff: null,
};

const validPayload = {
  category: "feature",
  rating: 4,
  ratingReason: "新增 MCP 传输层，扩展工具生态，影响所有 MCP 用户。",
  summary:
    "**解决的问题**\n\n外部工具无法通过 stdio 接入。\n\n**实现思路**\n\n新增 transport 层并在启动时注册。\n\n**影响与风险**\n\n新增协议入口，需要关注权限校验。",
  tags: ["mcp"],
  candidate: { name: "MCP stdio transport", description: "stdio 传输", moduleKey: "mcp" },
};

const enabledConfig = { enabled: true, hasKey: true, model: "m", maxPerSync: 1 };

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
  delete process.env.ANTHROPIC_MODEL;
});

describe("getAiConfig", () => {
  test("defaults to disabled without an API key", () => {
    const config = getAiConfig(freshDb());
    expect(config).toEqual({
      enabled: false,
      hasKey: false,
      model: "claude-sonnet-5",
      maxPerSync: 20,
    });
  });

  test("enables automatically when a key is present and no setting overrides it", async () => {
    await withKey(() => {
      expect(getAiConfig(freshDb()).enabled).toBe(true);
    });
  });

  test("respects the persisted enable flag", async () => {
    await withKey(() => {
      const db = freshDb();
      setSetting(db, "aiEnabled", "false");
      expect(getAiConfig(db).enabled).toBe(false);
      setSetting(db, "aiEnabled", "true");
      expect(getAiConfig(db).enabled).toBe(true);
    });
  });

  test("never enables without a key, even if the setting is true", () => {
    const db = freshDb();
    setSetting(db, "aiEnabled", "true");
    const config = getAiConfig(db);
    expect(config.hasKey).toBe(false);
    expect(config.enabled).toBe(false);
  });

  test("resolves the model from setting then environment then default", () => {
    const db = freshDb();
    process.env.ANTHROPIC_MODEL = "claude-env-model";
    expect(getAiConfig(db).model).toBe("claude-env-model");
    setSetting(db, "aiModel", "claude-setting-model");
    expect(getAiConfig(db).model).toBe("claude-setting-model");
  });

  test("clamps the per-sync budget and tolerates garbage", () => {
    const db = freshDb();
    setSetting(db, "aiMaxPerSync", "5");
    expect(getAiConfig(db).maxPerSync).toBe(5);
    setSetting(db, "aiMaxPerSync", "999");
    expect(getAiConfig(db).maxPerSync).toBe(200);
    setSetting(db, "aiMaxPerSync", "abc");
    expect(getAiConfig(db).maxPerSync).toBe(20);
  });
});

describe("analyzeWithClaude", () => {
  test("returns null when disabled", async () => {
    await withKey(async () => {
      const result = await analyzeWithClaude(
        context,
        { enabled: false, hasKey: true, model: "m", maxPerSync: 1 },
        () => fakeClient("{}"),
      );
      expect(result).toBeNull();
    });
  });

  test("returns null without an API key", async () => {
    const result = await analyzeWithClaude(context, { ...enabledConfig, hasKey: false }, () =>
      fakeClient("{}"),
    );
    expect(result).toBeNull();
  });

  test("parses fenced JSON and validates it", async () => {
    await withKey(async () => {
      const text = `Here you go:\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``;
      const result = await analyzeWithClaude(context, enabledConfig, (key) => {
        expect(key).toBe("test-key");
        return fakeClient(text);
      });
      expect(result).toMatchObject({ category: "feature", rating: 4, tags: ["mcp"] });
    });
  });

  test("joins multiple text blocks and ignores non-text blocks", async () => {
    await withKey(async () => {
      const json = JSON.stringify(validPayload);
      const client = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              { type: "thinking", thinking: "..." },
              { type: "text", text: json.slice(0, 12) },
              { type: "text", text: json.slice(12) },
            ],
          }),
        },
      } as unknown as Anthropic;
      const result = await analyzeWithClaude(context, enabledConfig, () => client);
      expect(result?.rating).toBe(4);
    });
  });

  test("returns null and warns on unparseable output", async () => {
    await withKey(async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await analyzeWithClaude(context, enabledConfig, () =>
        fakeClient("no json here"),
      );
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalled();
    });
  });

  test("returns null on schema violations", async () => {
    await withKey(async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await analyzeWithClaude(context, enabledConfig, () =>
        fakeClient(JSON.stringify({ ...validPayload, rating: 9 })),
      );
      expect(result).toBeNull();
    });
  });

  test("returns null when the client throws", async () => {
    await withKey(async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = {
        messages: { create: vi.fn().mockRejectedValue(new Error("network down")) },
      } as unknown as Anthropic;
      const result = await analyzeWithClaude(context, enabledConfig, () => client);
      expect(result).toBeNull();
    });
  });

  test("defaults candidate to optional", async () => {
    await withKey(async () => {
      const withoutCandidate = { ...validPayload, candidate: undefined };
      const result = await analyzeWithClaude(context, enabledConfig, () =>
        fakeClient(JSON.stringify(withoutCandidate)),
      );
      expect(result).not.toBeNull();
      expect(result?.candidate).toBeUndefined();
    });
  });
});

describe("commit review prompt", () => {
  test("asks for review sections and judges importance, not diff size", () => {
    expect(COMMIT_REVIEW_SYSTEM_PROMPT).toContain("**解决的问题**");
    expect(COMMIT_REVIEW_SYSTEM_PROMPT).toContain("**实现思路**");
    expect(COMMIT_REVIEW_SYSTEM_PROMPT).toContain("**影响与风险**");
    expect(COMMIT_REVIEW_SYSTEM_PROMPT).toContain("不是改动行数");
    expect(COMMIT_REVIEW_SYSTEM_PROMPT).toContain("不可信数据");
  });

  test("builds a user prompt with metadata and a fenced diff", () => {
    const prompt = buildUserPrompt({ ...context, diff: "diff --git a/x b/x\n+hello\n" });
    expect(prompt).toContain("feat: add MCP stdio transport");
    expect(prompt).toContain("src/mcp.ts (+120/-3)");
    expect(prompt).toContain("```diff");
    expect(prompt).toContain("+hello");
  });

  test("says so when no diff was captured", () => {
    const prompt = buildUserPrompt(context);
    expect(prompt).toContain("diff 未抓取");
  });

  test("exports a JSON schema matching the review output", () => {
    expect(AI_RESULT_JSON_SCHEMA.required).toEqual([
      "category",
      "rating",
      "ratingReason",
      "summary",
      "tags",
      "candidate",
    ]);
    expect(AI_RESULT_JSON_SCHEMA.properties.rating).toMatchObject({ minimum: 1, maximum: 5 });
  });
});
