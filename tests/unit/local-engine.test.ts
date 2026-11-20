import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getLocalEngineStatus, runLocalEngine } from "@/lib/localEngine";

/** Writes an executable node script and returns its absolute path. */
function fakeCli(name: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zodiac-fake-${name}-`));
  const command = path.join(dir, name);
  fs.writeFileSync(command, ["#!/usr/bin/env node", body].join("\n"), "utf8");
  fs.chmodSync(command, 0o755);
  return command;
}

const options = {
  prompt: "review this diff",
  systemPrompt: "SYSTEM RULES",
  cwd: os.tmpdir(),
  timeoutMs: 20_000,
};

beforeAll(() => {
  delete process.env.ZODIAC_LOCAL_CLAUDE;
});

afterAll(() => {
  process.env.ZODIAC_LOCAL_CLAUDE = "off";
});

describe("runLocalEngine", () => {
  test("parses Claude Code's JSON result wrapper", async () => {
    const command = fakeCli(
      "claude",
      `console.log(JSON.stringify({ type: "result", is_error: false, structured_output: { answer: "claude" } }));`,
    );
    const parsed = await runLocalEngine("claude-code", command, options);
    expect(parsed).toEqual({ answer: "claude" });
  });

  test("runs codex exec with a read-only sandbox and reads the last-message file", async () => {
    const argsFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-codex-args-")),
      "args.json",
    );
    const command = fakeCli(
      "codex",
      `
const fs = require("node:fs");
const args = process.argv.slice(2);
const messagePath = args[args.indexOf("--output-last-message") + 1];
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
  fs.writeFileSync(messagePath, JSON.stringify({ answer: "codex", sawSystem: stdin.includes("SYSTEM RULES") }));
});
`,
    );

    const parsed = await runLocalEngine("codex", command, {
      ...options,
      jsonSchema: { type: "object" },
    });

    expect(parsed).toEqual({ answer: "codex", sawSystem: true });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    expect(args.slice(0, 2)).toEqual(["exec", "--sandbox"]);
    expect(args).toContain("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--output-schema");
    expect(args).toContain("--output-last-message");
    expect(args.at(-1)).toBe("-");
  });

  test("runs the DeepSeek harness headless profile and extracts stdout JSON", async () => {
    const argsFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-dsh-args-")),
      "args.json",
    );
    const command = fakeCli(
      "dsh",
      `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
console.log("思考中…");
console.log(JSON.stringify({ answer: "deepseek" }));
`,
    );

    const parsed = await runLocalEngine("deepseek", command, options);

    expect(parsed).toEqual({ answer: "deepseek" });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    expect(args[0]).toBe("--profile");
    expect(args[1]).toBe("headless");
    expect(args[2]).toContain("SYSTEM RULES");
    expect(args[2]).toContain("review this diff");
  });

  test("wraps CLI failures with the engine label", async () => {
    const command = fakeCli("codex", `console.error("boom"); process.exit(2);`);
    await expect(runLocalEngine("codex", command, options)).rejects.toThrow(/本地 Codex 调用失败/);
  });

  test("rejects invalid commands and disabled engines", async () => {
    await expect(runLocalEngine("codex", "codex\n--bad", options)).rejects.toThrow(/命令无效/);
    process.env.ZODIAC_LOCAL_ENGINE = "off";
    try {
      await expect(runLocalEngine("deepseek", "dsh", options)).rejects.toThrow(/被环境变量禁用/);
    } finally {
      delete process.env.ZODIAC_LOCAL_ENGINE;
    }
  });
});

describe("getLocalEngineStatus", () => {
  test("reports the version of an available engine", async () => {
    const command = fakeCli("codex", `console.log("codex-cli 0.9.0");`);
    await expect(getLocalEngineStatus("codex", command)).resolves.toEqual({
      engine: "codex",
      command,
      available: true,
      version: "codex-cli 0.9.0",
    });
  });

  test("marks missing commands and invalid settings unavailable", async () => {
    await expect(getLocalEngineStatus("deepseek", "/definitely/not/a/dsh", 5_000)).resolves.toEqual(
      {
        engine: "deepseek",
        command: "/definitely/not/a/dsh",
        available: false,
        version: null,
      },
    );
    await expect(getLocalEngineStatus("deepseek", "dsh\n--bad")).resolves.toMatchObject({
      available: false,
      version: null,
    });
  });
});
