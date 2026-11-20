import { describe, expect, test } from "vitest";
import { dueHarnesses, isHarnessDue, zonedTimeToUtc } from "@/lib/scheduler/due";
import type { Harness } from "@/lib/types";

function harness(overrides: Partial<Harness> = {}): Harness {
  return {
    id: 1,
    slug: "codex",
    name: "Codex",
    repoUrl: "https://github.com/openai/codex",
    branch: "main",
    localPath: null,
    sortOrder: 0,
    enabled: true,
    scheduleMode: "daily",
    dailyTime: "09:00",
    backfillDays: 30,
    baselineSha: null,
    lastAttemptAt: null,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastSha: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("zonedTimeToUtc", () => {
  test("converts a wall-clock time to an instant", () => {
    expect(zonedTimeToUtc("2026-11-19", "09:00", "Asia/Shanghai").toISOString()).toBe(
      "2026-11-19T01:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-11-19", "09:00", "UTC").toISOString()).toBe(
      "2026-11-19T09:00:00.000Z",
    );
  });

  test("handles daylight saving transitions", () => {
    // Berlin is UTC+2 in July and UTC+1 in January.
    expect(zonedTimeToUtc("2026-07-15", "12:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-01-15", "12:00", "Europe/Berlin").toISOString()).toBe(
      "2026-01-15T11:00:00.000Z",
    );
  });
});

describe("isHarnessDue", () => {
  // Tests run with ZODIAC_TZ=UTC (see tests/setup.ts).

  test("disabled harnesses and schedule off are never due", () => {
    expect(isHarnessDue(harness({ enabled: false }))).toBe(false);
    expect(isHarnessDue(harness({ scheduleMode: "off" }))).toBe(false);
  });

  test("hourly harnesses are due when never synced", () => {
    expect(isHarnessDue(harness({ scheduleMode: "hourly" }))).toBe(true);
  });

  test("hourly harnesses respect the minimum interval", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    expect(
      isHarnessDue(
        harness({ scheduleMode: "hourly", lastSyncAt: "2026-11-19T11:30:00.000Z" }),
        now,
      ),
    ).toBe(false);
    expect(
      isHarnessDue(
        harness({ scheduleMode: "hourly", lastSyncAt: "2026-11-19T10:50:00.000Z" }),
        now,
      ),
    ).toBe(true);
  });

  test("daily harnesses wait until the scheduled time", () => {
    const before = new Date("2026-11-19T08:59:00.000Z");
    const after = new Date("2026-11-19T09:30:00.000Z");
    expect(isHarnessDue(harness(), before)).toBe(false);
    expect(isHarnessDue(harness(), after)).toBe(true);
  });

  test("daily harnesses already synced after the schedule are not due again", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    expect(isHarnessDue(harness({ lastSyncAt: "2026-11-19T09:10:00.000Z" }), now)).toBe(false);
    expect(isHarnessDue(harness({ lastSyncAt: "2026-11-18T09:10:00.000Z" }), now)).toBe(true);
  });

  test("invalid lastSync timestamps are treated as never synced", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    expect(isHarnessDue(harness({ lastSyncAt: "garbage" }), now)).toBe(true);
  });

  test("the last attempt takes precedence over the last completion", () => {
    // A run started 10 minutes ago is still working; its earlier success must
    // not make the harness due again mid-run.
    const now = new Date("2026-11-19T12:00:00.000Z");
    expect(
      isHarnessDue(
        harness({
          scheduleMode: "hourly",
          lastAttemptAt: "2026-11-19T11:50:00.000Z",
          lastSyncAt: "2026-11-19T10:00:00.000Z",
        }),
        now,
      ),
    ).toBe(false);
  });

  test("unknown schedule modes are not due", () => {
    expect(isHarnessDue(harness({ scheduleMode: "weekly" as Harness["scheduleMode"] }))).toBe(
      false,
    );
  });
});

describe("dueHarnesses", () => {
  test("filters the harness list", () => {
    const now = new Date("2026-11-19T12:00:00.000Z");
    const due = dueHarnesses(
      [
        harness({ id: 1 }),
        harness({ id: 2, enabled: false }),
        harness({ id: 3, scheduleMode: "off" }),
      ],
      now,
    );
    expect(due.map((harness) => harness.id)).toEqual([1]);
  });
});
