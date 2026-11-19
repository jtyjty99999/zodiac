export const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function getTimezone(): string {
  const tz = process.env.ZODIAC_TZ?.trim();
  if (!tz) return DEFAULT_TIMEZONE;
  return isTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function toDay(date: Date | string, tz: string = getTimezone()): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid date: ${String(date)}`);
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function addDays(day: string, days: number): string {
  const base = new Date(`${day}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export function dateRange(endDay: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(endDay, i - (days - 1)));
}

export function formatDayLabel(day: string): string {
  return day;
}
