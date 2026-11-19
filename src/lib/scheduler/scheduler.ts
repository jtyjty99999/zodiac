import { getDb } from "../db/client";
import { listHarnesses } from "../db/repositories/harnesses";
import { failStaleRuns } from "../db/repositories/syncRuns";
import { syncHarness } from "../ingest/sync";
import { dueHarnesses } from "./due";

export const DEFAULT_TICK_MS = 60_000;

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  started: boolean;
}

const globalStore = globalThis as typeof globalThis & { __zodiacScheduler?: SchedulerState };

function state(): SchedulerState {
  if (!globalStore.__zodiacScheduler) {
    globalStore.__zodiacScheduler = { timer: null, running: false, started: false };
  }
  return globalStore.__zodiacScheduler;
}

export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
  const scheduler = state();
  if (scheduler.running) return;
  scheduler.running = true;

  try {
    const db = getDb();
    failStaleRuns(db, 30);
    const harnesses = listHarnesses(db, { enabledOnly: true });
    const due = dueHarnesses(harnesses, now);

    for (const harness of due) {
      try {
        await syncHarness(db, harness.id, { trigger: "schedule" });
      } catch (error) {
        console.error(
          `[zodiac] scheduled sync failed for ${harness.slug}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } finally {
    scheduler.running = false;
  }
}

export function startScheduler(intervalMs: number = DEFAULT_TICK_MS): void {
  if (process.env.ZODIAC_SCHEDULER === "off") {
    console.info("[zodiac] scheduler disabled via ZODIAC_SCHEDULER=off");
    return;
  }

  const scheduler = state();
  if (scheduler.started) return;
  scheduler.started = true;

  const tick = () => {
    void runSchedulerTick().catch((error) => {
      console.error(
        "[zodiac] scheduler tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
  };

  tick();
  scheduler.timer = setInterval(tick, intervalMs);
  scheduler.timer.unref?.();
  console.info(`[zodiac] scheduler started (every ${Math.round(intervalMs / 1000)}s)`);
}

export function stopScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) clearInterval(scheduler.timer);
  scheduler.timer = null;
  scheduler.started = false;
}

export function isSchedulerRunning(): boolean {
  return state().started;
}
