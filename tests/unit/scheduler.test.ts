import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getDb, openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { createHarness, listHarnesses } from "@/lib/db/repositories/harnesses";
import { listSyncRuns } from "@/lib/db/repositories/syncRuns";
import {
  isSchedulerRunning,
  runSchedulerTick,
  startScheduler,
  stopScheduler,
} from "@/lib/scheduler/scheduler";

/**
 * The scheduler talks to the process-wide DB (`getDb`), so this file points
 * ZODIAC_DB_PATH at a throwaway file before the first `getDb` call and cleans
 * up the scheduler state afterwards.
 */
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-sched-")), "sched.db");

type SchedulerStore = typeof globalThis & {
  __zodiacScheduler?: {
    timer: ReturnType<typeof setInterval> | null;
    running: boolean;
    started: boolean;
  };
};

beforeEach(() => {
  process.env.ZODIAC_DB_PATH = dbPath;
  // The global test setup disables the scheduler; these tests exercise it.
  process.env.ZODIAC_SCHEDULER = "on";
});

afterEach(() => {
  stopScheduler();
  (globalThis as SchedulerStore).__zodiacScheduler = undefined;
});

describe("runSchedulerTick", () => {
  test("skips the tick while another tick is running", async () => {
    (globalThis as SchedulerStore).__zodiacScheduler = {
      timer: null,
      running: true,
      started: false,
    };
    await runSchedulerTick();
    // The guard returns before touching the DB, so no database file appears.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("creates the database and no-ops when nothing is due", async () => {
    await runSchedulerTick();
    const db = getDb();
    // Harnesses with schedule off are skipped even when enabled.
    createHarness(db, {
      slug: "quiet",
      name: "Quiet",
      repoUrl: "https://github.com/a/quiet",
      scheduleMode: "off",
    });
    await runSchedulerTick(new Date("2026-11-19T12:00:00Z"));
    expect(listSyncRuns(db)).toHaveLength(0);
  });

  test("records failed scheduled syncs without throwing", async () => {
    const db = getDb();
    createHarness(db, {
      slug: "offline",
      name: "Offline",
      // The scheduler never enables the local override, so this fails fast
      // at URL validation instead of attempting a network fetch.
      repoUrl: "file:///nonexistent/zodiac-scheduler-test",
      scheduleMode: "hourly",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runSchedulerTick(new Date("2026-11-19T12:00:00Z"));

    const runs = listSyncRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].trigger).toBe("schedule");
    expect(listHarnesses(db).find((harness) => harness.slug === "offline")?.lastError).toContain(
      "Invalid repository URL",
    );
    vi.restoreAllMocks();
  });
});

describe("startScheduler / stopScheduler", () => {
  test("does nothing when disabled by env", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const previous = process.env.ZODIAC_SCHEDULER;
    process.env.ZODIAC_SCHEDULER = "off";
    try {
      startScheduler();
      expect(isSchedulerRunning()).toBe(false);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    } finally {
      if (previous === undefined) delete process.env.ZODIAC_SCHEDULER;
      else process.env.ZODIAC_SCHEDULER = previous;
      vi.restoreAllMocks();
    }
  });

  test("starts once, is idempotent, and can be stopped", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // The immediate tick runs against the temp DB.
    startScheduler(600_000);
    expect(isSchedulerRunning()).toBe(true);
    startScheduler(600_000);
    expect(isSchedulerRunning()).toBe(true);

    stopScheduler();
    expect(isSchedulerRunning()).toBe(false);
    // Let the immediate tick settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.restoreAllMocks();
  });
});

describe("database helpers", () => {
  test("getDb memoises the process-wide connection", () => {
    const db = getDb();
    expect(getDb()).toBe(db);
  });

  test("openDatabase creates parent directories", () => {
    const nested = path.join(path.dirname(dbPath), "deep", "nested", "db.sqlite");
    const db = openDatabase(nested);
    migrate(db);
    expect(fs.existsSync(nested)).toBe(true);
    db.close();
  });
});
