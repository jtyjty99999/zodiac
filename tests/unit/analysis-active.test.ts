import { afterEach, describe, expect, test, vi } from "vitest";
import {
  beginCommitAnalysis,
  endCommitAnalysis,
  isCommitAnalyzing,
  runCommitAnalysis,
} from "@/lib/analysis/active";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";

vi.mock("@/lib/analysis", () => ({ analyzeCommitById: vi.fn() }));

const { analyzeCommitById } = await import("@/lib/analysis");
const mockedAnalyze = vi.mocked(analyzeCommitById);

function freshDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
  mockedAnalyze.mockReset();
  endCommitAnalysis(101);
  endCommitAnalysis(102);
});

describe("commit analysis activity", () => {
  test("reserves at most one run per commit", () => {
    expect(isCommitAnalyzing(101)).toBe(false);
    expect(beginCommitAnalysis(101)).toBe(true);
    expect(isCommitAnalyzing(101)).toBe(true);
    expect(beginCommitAnalysis(101)).toBe(false);
    endCommitAnalysis(101);
    expect(isCommitAnalyzing(101)).toBe(false);
  });

  test("allows different commits to run concurrently", () => {
    expect(beginCommitAnalysis(101)).toBe(true);
    expect(beginCommitAnalysis(102)).toBe(true);
    expect(isCommitAnalyzing(101)).toBe(true);
    expect(isCommitAnalyzing(102)).toBe(true);
  });

  test("runs the forced analysis and always releases the slot", async () => {
    const db = freshDb();
    mockedAnalyze.mockResolvedValue(null);
    beginCommitAnalysis(101);

    await runCommitAnalysis(db, 101);

    expect(mockedAnalyze).toHaveBeenCalledWith(
      db,
      101,
      expect.objectContaining({ force: true, useAi: true }),
    );
    expect(isCommitAnalyzing(101)).toBe(false);
  });

  test("logs failures and still releases the slot", async () => {
    const db = freshDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockedAnalyze.mockRejectedValue(new Error("network down"));
    beginCommitAnalysis(102);

    await runCommitAnalysis(db, 102);

    expect(warn).toHaveBeenCalled();
    expect(isCommitAnalyzing(102)).toBe(false);
  });
});
