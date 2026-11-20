import { describe, expect, test } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { setSetting } from "@/lib/db/repositories/settings";
import {
  getExplorationEngineSettings,
  isLocalEngineKind,
  isValidLocalCommand,
  LOCAL_ENGINE_DEFAULT_COMMANDS,
  localCommandFor,
  localEngineSelection,
} from "@/lib/explore/engineSettings";

function makeDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

describe("exploration engine settings", () => {
  test("defaults to the API engine and each engine's default command", () => {
    const settings = getExplorationEngineSettings(makeDb());
    expect(settings).toEqual({
      engine: "api",
      command: LOCAL_ENGINE_DEFAULT_COMMANDS["claude-code"],
      codexCommand: LOCAL_ENGINE_DEFAULT_COMMANDS.codex,
      deepseekCommand: LOCAL_ENGINE_DEFAULT_COMMANDS.deepseek,
    });
  });

  test("reads a stored local engine and all three commands", () => {
    const db = makeDb();
    setSetting(db, "exploreEngine", "codex");
    setSetting(db, "claudeCodeCommand", "/opt/bin/claude");
    setSetting(db, "codexCommand", "/opt/bin/codex");
    setSetting(db, "deepseekCommand", "/opt/bin/dsh");
    expect(getExplorationEngineSettings(db)).toEqual({
      engine: "codex",
      command: "/opt/bin/claude",
      codexCommand: "/opt/bin/codex",
      deepseekCommand: "/opt/bin/dsh",
    });
  });

  test("ignores unknown engines and invalid commands", () => {
    const db = makeDb();
    setSetting(db, "exploreEngine", "gpt");
    setSetting(db, "claudeCodeCommand", "claude\n--dangerously-skip-permissions");
    setSetting(db, "codexCommand", "");
    setSetting(db, "deepseekCommand", "dsh\u0000");
    expect(getExplorationEngineSettings(db)).toEqual({
      engine: "api",
      command: LOCAL_ENGINE_DEFAULT_COMMANDS["claude-code"],
      codexCommand: LOCAL_ENGINE_DEFAULT_COMMANDS.codex,
      deepseekCommand: LOCAL_ENGINE_DEFAULT_COMMANDS.deepseek,
    });
  });

  test("isValidLocalCommand rejects empty and control characters", () => {
    expect(isValidLocalCommand("claude")).toBe(true);
    expect(isValidLocalCommand("  /usr/local/bin/dsh  ")).toBe(true);
    expect(isValidLocalCommand("")).toBe(false);
    expect(isValidLocalCommand("   ")).toBe(false);
    expect(isValidLocalCommand("claude\u0000")).toBe(false);
    expect(isValidLocalCommand(`claude ${"-".repeat(600)}`)).toBe(false);
  });

  test("recognises the supported local engine kinds", () => {
    expect(isLocalEngineKind("claude-code")).toBe(true);
    expect(isLocalEngineKind("codex")).toBe(true);
    expect(isLocalEngineKind("deepseek")).toBe(true);
    expect(isLocalEngineKind("api")).toBe(false);
    expect(isLocalEngineKind(null)).toBe(false);
  });

  test("resolves the selected command and falls back to Claude Code for the API engine", () => {
    const settings = {
      engine: "deepseek" as const,
      command: "claude",
      codexCommand: "codex",
      deepseekCommand: "/opt/bin/dsh",
    };
    expect(localCommandFor(settings, "deepseek")).toBe("/opt/bin/dsh");
    expect(localCommandFor(settings, "codex")).toBe("codex");
    expect(localEngineSelection(settings)).toEqual({
      engine: "deepseek",
      command: "/opt/bin/dsh",
    });
    expect(localEngineSelection({ ...settings, engine: "api" })).toEqual({
      engine: "claude-code",
      command: "claude",
    });
  });
});
