import { describe, expect, test } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { setSetting } from "@/lib/db/repositories/settings";
import {
  CLAUDE_CODE_DEFAULT_COMMAND,
  getExplorationEngineSettings,
  isValidClaudeCommand,
} from "@/lib/explore/engineSettings";

function makeDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

describe("exploration engine settings", () => {
  test("defaults to the API engine and the claude command", () => {
    const settings = getExplorationEngineSettings(makeDb());
    expect(settings).toEqual({ engine: "api", command: CLAUDE_CODE_DEFAULT_COMMAND });
  });

  test("reads a stored local engine and command", () => {
    const db = makeDb();
    setSetting(db, "exploreEngine", "claude-code");
    setSetting(db, "claudeCodeCommand", "/opt/bin/claude");
    expect(getExplorationEngineSettings(db)).toEqual({
      engine: "claude-code",
      command: "/opt/bin/claude",
    });
  });

  test("ignores unknown engines and invalid commands", () => {
    const db = makeDb();
    setSetting(db, "exploreEngine", "gpt");
    setSetting(db, "claudeCodeCommand", "claude\n--dangerously-skip-permissions");
    expect(getExplorationEngineSettings(db)).toEqual({
      engine: "api",
      command: CLAUDE_CODE_DEFAULT_COMMAND,
    });
  });

  test("isValidClaudeCommand rejects empty and control characters", () => {
    expect(isValidClaudeCommand("claude")).toBe(true);
    expect(isValidClaudeCommand("  /usr/local/bin/claude  ")).toBe(true);
    expect(isValidClaudeCommand("")).toBe(false);
    expect(isValidClaudeCommand("   ")).toBe(false);
    expect(isValidClaudeCommand("claude\u0000")).toBe(false);
    expect(isValidClaudeCommand(`claude ${"-".repeat(600)}`)).toBe(false);
  });
});
