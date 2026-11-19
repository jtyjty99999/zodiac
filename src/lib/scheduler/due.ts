import type { Harness } from "../types";
import { getTimezone, toDay } from "../utils/time";

export const HOURLY_MIN_INTERVAL_MS = 55 * 60 * 1000;

function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

export function zonedTimeToUtc(day: string, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(":").map((value) => Number.parseInt(value, 10));
  const naive = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
      hour,
      minute,
      0,
    ),
  );
  const offset = offsetMinutes(naive, timeZone);
  return new Date(naive.getTime() - offset * 60_000);
}

export function isHarnessDue(harness: Harness, now: Date = new Date()): boolean {
  if (!harness.enabled || harness.scheduleMode === "off") return false;

  const lastSync = harness.lastSyncAt ? new Date(harness.lastSyncAt) : null;

  if (harness.scheduleMode === "hourly") {
    if (!lastSync || Number.isNaN(lastSync.getTime())) return true;
    return now.getTime() - lastSync.getTime() >= HOURLY_MIN_INTERVAL_MS;
  }

  if (harness.scheduleMode === "daily") {
    const tz = getTimezone();
    const scheduled = zonedTimeToUtc(toDay(now, tz), harness.dailyTime, tz);
    if (now.getTime() < scheduled.getTime()) return false;
    if (!lastSync || Number.isNaN(lastSync.getTime())) return true;
    return lastSync.getTime() < scheduled.getTime();
  }

  return false;
}

export function dueHarnesses(harnesses: Harness[], now: Date = new Date()): Harness[] {
  return harnesses.filter((harness) => isHarnessDue(harness, now));
}
