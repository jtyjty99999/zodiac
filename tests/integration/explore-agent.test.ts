import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AiConfig } from "@/lib/analysis/anthropic";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { exploreWithClaude } from "@/lib/explore/agent";
import { resolveHarnessSource } from "@/lib/explore/evidence";
import { createObservationState, executeExploreTool } from "@/lib/explore/tools";
import { ensureMirror } from "@/lib/git/mirror";
import { createTempRepo, makeDb } from "./helpers";

const ENABLED: AiConfig = { enabled: true, hasKey: true, model: "test-model", maxPerSync: 0 };
const REPO_FILES = {
  "src/tasks/todo.ts": [
    "export interface TodoItem { text: string }",
    "export function planTodos(items: TodoItem[]): string {",
    "  return items.map((item) => item.text).join('\\n');",
    "}",
    "",
  ].join("\n"),
  "src/context/compact.ts":
    "export function compactContext(history: string[]): string[] {\n  return history.filter(Boolean);\n}\n",
};

function toolUseResponse(calls: Array<{ name: string; input: unknown }>): Anthropic.Message {
  return {
    content: calls.map((call, index) => ({
      type: "tool_use",
      id: `tool-${index + 1}`,
      name: call.name,
      input: call.input,
    })),
    stop_reason: "tool_use",
  } as unknown as Anthropic.Message;
}

function textResponse(text: string): Anthropic.Message {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  } as unknown as Anthropic.Message;
}

/** Records responses and hands them out in order; an Error value throws. */
function fakeClient(responses: Array<Anthropic.Message | Error>) {
  const queue = [...responses];
  const create = vi.fn(async (_params: unknown) => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra Claude call");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

function factorySpy() {
  return vi.fn((_apiKey: string) => ({ messages: { create: vi.fn() } }) as unknown as Anthropic);
}

async function withKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
}

async function setupMirror(slug: string) {
  const repo = createTempRepo([{ subject: "feat: long-running tasks", files: REPO_FILES }]);
  await ensureMirror({ slug, repoUrl: repo.url, branch: "main", allowLocalRepo: true });

  const db = makeDb();
  const { harness } = createHarness(db, { slug, name: "Codex", repoUrl: repo.url });
  return { db, harness };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exploreWithClaude", () => {
  test("explores through tools and builds evidence from observed files", async () => {
    const { db, harness } = await setupMirror("agent-main");
    const finalJson = JSON.stringify({
      summaryMd: "Codex 通过 todo 列表跟踪长程任务。",
      comparisonMd: "其它 harness 证据不足。",
      harnesses: [
        { slug: "agent-main", analysisMd: "见 src/tasks/todo.ts:1 的 TodoItem 定义。" },
        { slug: "ghost", analysisMd: "未知 harness，应被丢弃。" },
      ],
    });
    const { client, create } = fakeClient([
      toolUseResponse([
        { name: "grep_code", input: { slug: "agent-main", pattern: "todo" } },
        { name: "read_file", input: { slug: "agent-main", path: "src/tasks/todo.ts" } },
        { name: "read_file", input: { slug: "agent-main", path: "../etc/passwd" } },
      ]),
      textResponse("探索完成"),
      textResponse(finalJson),
    ]);

    const result = await withKey(() =>
      exploreWithClaude(
        db,
        {
          proposition: "各 harness 如何处理长程任务",
          patterns: ["long-running", "task"],
          matchedFeatures: [],
          harnesses: [harness],
        },
        { config: ENABLED, clientFactory: () => client, maxSteps: 3 },
      ),
    );

    expect(result).not.toBeNull();
    expect(result?.patterns).toEqual(["todo"]);
    expect(result?.synthesis.summaryMd).toContain("todo");
    expect(result?.synthesis.comparisonMd).toContain("证据不足");
    // Unknown slugs from the model are dropped.
    expect(result?.synthesis.harnesses).toEqual([
      { slug: "agent-main", analysisMd: "见 src/tasks/todo.ts:1 的 TodoItem 定义。" },
    ]);

    const [evidence] = result?.evidence.harnesses ?? [];
    expect(evidence.status).toBe("ok");
    expect(evidence.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence.totalFiles).toBe(1);
    expect(evidence.files[0].path).toBe("src/tasks/todo.ts");
    expect(evidence.files[0].snippets.length).toBeGreaterThan(0);
    expect(result?.evidence.patterns).toEqual(["todo"]);

    // Two tool-loop steps plus the final JSON call.
    expect(create).toHaveBeenCalledTimes(3);
    const firstCall = create.mock.calls[0][0] as {
      tools?: Array<{ name: string }>;
      system?: string;
    };
    expect(firstCall.tools?.map((tool) => tool.name)).toEqual([
      "list_dir",
      "grep_code",
      "read_file",
    ]);
    expect(firstCall.system).toContain("agent-main");

    // The traversal read failed safely as a tool error, without aborting.
    const secondCall = create.mock.calls[1][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResults = secondCall.messages
      .filter((message) => Array.isArray(message.content))
      .flatMap((message) => message.content as Array<{ type?: string; is_error?: boolean }>)
      .filter((block) => block.type === "tool_result");
    expect(toolResults.some((entry) => entry.is_error)).toBe(true);
  });

  test("returns null when AI is disabled or no mirror is available", async () => {
    const { db, harness } = await setupMirror("agent-disabled");

    const disabledFactory = factorySpy();
    const disabled = await exploreWithClaude(
      db,
      {
        proposition: "long-running tasks",
        patterns: [],
        matchedFeatures: [],
        harnesses: [harness],
      },
      { config: { ...ENABLED, enabled: false }, clientFactory: disabledFactory },
    );
    expect(disabled).toBeNull();
    expect(disabledFactory).not.toHaveBeenCalled();

    const { harness: missing } = createHarness(db, {
      slug: "agent-no-mirror",
      name: "Missing",
      repoUrl: "https://github.com/a/missing",
    });
    const missingFactory = factorySpy();
    const result = await withKey(() =>
      exploreWithClaude(
        db,
        {
          proposition: "long-running tasks",
          patterns: [],
          matchedFeatures: [],
          harnesses: [missing],
        },
        { config: ENABLED, clientFactory: missingFactory },
      ),
    );
    expect(result).toBeNull();
    expect(missingFactory).not.toHaveBeenCalled();
  });

  test("returns null and warns when the Claude call fails", async () => {
    const { db, harness } = await setupMirror("agent-failure");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeClient([new Error("network down")]);

    const result = await withKey(() =>
      exploreWithClaude(
        db,
        {
          proposition: "long-running tasks",
          patterns: [],
          matchedFeatures: [],
          harnesses: [harness],
        },
        { config: ENABLED, clientFactory: () => client },
      ),
    );

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("AI exploration failed"),
      "network down",
    );
  });

  test("returns null when the model explores nothing", async () => {
    const { db, harness } = await setupMirror("agent-empty");
    const { client } = fakeClient([
      toolUseResponse([{ name: "grep_code", input: { slug: "agent-empty", pattern: "zzz-none" } }]),
      textResponse("没有找到"),
    ]);

    const result = await withKey(() =>
      exploreWithClaude(
        db,
        {
          proposition: "unfindable feature",
          patterns: [],
          matchedFeatures: [],
          harnesses: [harness],
        },
        { config: ENABLED, clientFactory: () => client },
      ),
    );
    expect(result).toBeNull();
  });
});

describe("executeExploreTool", () => {
  test("lists, greps and reads against a mirror while recording observations", async () => {
    const { harness } = await setupMirror("agent-tools");
    const resolved = await resolveHarnessSource(harness);
    if (!resolved.ok) throw new Error("mirror should resolve");
    const context = {
      sources: new Map([[harness.slug, resolved.source]]),
      observations: createObservationState(),
    };

    const listing = await executeExploreTool(context, "list_dir", { slug: "agent-tools" });
    expect(listing.isError).toBe(false);
    expect(listing.text).toContain("src/");

    const grep = await executeExploreTool(context, "grep_code", {
      slug: "agent-tools",
      pattern: "planTodos",
    });
    expect(grep.isError).toBe(false);
    expect(grep.text).toContain("src/tasks/todo.ts:");
    expect(context.observations.patterns.has("planTodos")).toBe(true);
    expect(context.observations.files.get(harness.id)?.size).toBe(1);

    const read = await executeExploreTool(context, "read_file", {
      slug: "agent-tools",
      path: "src/tasks/todo.ts",
    });
    expect(read.isError).toBe(false);
    expect(read.text).toContain("1: export interface TodoItem");

    const traversal = await executeExploreTool(context, "read_file", {
      slug: "agent-tools",
      path: "../secret",
    });
    expect(traversal.isError).toBe(true);

    const badPrefix = await executeExploreTool(context, "grep_code", {
      slug: "agent-tools",
      pattern: "todo",
      path: "../..",
    });
    expect(badPrefix.isError).toBe(true);

    const unknownHarness = await executeExploreTool(context, "list_dir", { slug: "ghost" });
    expect(unknownHarness.isError).toBe(true);

    const unknownTool = await executeExploreTool(context, "delete_repo", {});
    expect(unknownTool.isError).toBe(true);

    const invalidInput = await executeExploreTool(context, "grep_code", { slug: "agent-tools" });
    expect(invalidInput.isError).toBe(true);
  });
});
