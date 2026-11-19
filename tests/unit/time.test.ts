import { describe, expect, test } from "vitest";
import { addDays, dateRange, daysBetween, getTimezone, isTimezone, toDay } from "@/lib/utils/time";

describe("toDay", () => {
  test("formats an instant in the requested timezone", () => {
    const instant = new Date("2026-11-19T16:30:00.000Z");
    expect(toDay(instant, "UTC")).toBe("2026-11-19");
    expect(toDay(instant, "Asia/Shanghai")).toBe("2026-11-20");
  });

  test("accepts ISO strings", () => {
    expect(toDay("2026-01-02T03:04:05.000Z", "UTC")).toBe("2026-01-02");
  });

  test("throws on invalid input", () => {
    expect(() => toDay("not-a-date", "UTC")).toThrow(/Invalid date/);
  });
});

describe("day arithmetic", () => {
  test("addDays handles month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("daysBetween is signed", () => {
    expect(daysBetween("2026-11-01", "2026-11-19")).toBe(18);
    expect(daysBetween("2026-11-19", "2026-11-01")).toBe(-18);
  });

  test("dateRange ends at the given day", () => {
    expect(dateRange("2026-11-19", 3)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(dateRange("2026-11-19", 1)).toEqual(["2026-11-19"]);
  });
});

describe("timezone helpers", () => {
  test("validates IANA timezones", () => {
    expect(isTimezone("Asia/Shanghai")).toBe(true);
    expect(isTimezone("UTC")).toBe(true);
    expect(isTimezone("Mars/Olympus")).toBe(false);
  });

  test("falls back to the default timezone when unset or invalid", () => {
    const previous = process.env.ZODIAC_TZ;
    try {
      process.env.ZODIAC_TZ = "Mars/Olympus";
      expect(getTimezone()).toBe("Asia/Shanghai");
      delete process.env.ZODIAC_TZ;
      expect(getTimezone()).toBe("Asia/Shanghai");
      process.env.ZODIAC_TZ = "Europe/Berlin";
      expect(getTimezone()).toBe("Europe/Berlin");
    } finally {
      if (previous === undefined) delete process.env.ZODIAC_TZ;
      else process.env.ZODIAC_TZ = previous;
    }
  });
});
