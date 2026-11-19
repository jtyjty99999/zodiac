export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getDb } = await import("./lib/db/client");
  const { getSetting } = await import("./lib/db/repositories/settings");
  const { isTimezone } = await import("./lib/utils/time");

  // The timezone chosen in Settings lives in the database; re-apply it on boot
  // so bucketing stays consistent across restarts.
  try {
    const stored = getSetting(getDb(), "timezone");
    if (stored && isTimezone(stored)) process.env.ZODIAC_TZ = stored;
  } catch (error) {
    console.warn("[zodiac] Failed to restore the stored timezone:", error);
  }

  const { startScheduler } = await import("./lib/scheduler/scheduler");
  startScheduler();
}
