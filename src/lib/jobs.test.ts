import { describe, expect, it } from "vitest";
import { defaultSchedule, joinInterval, scheduleIsComplete, splitInterval } from "@/lib/jobs";

describe("job schedules", () => {
  it("starts every preset complete", () => {
    for (const type of ["manual", "interval", "daily", "weekly", "monthly", "cron"] as const) {
      expect(scheduleIsComplete(defaultSchedule(type))).toBe(true);
    }
  });

  it("flags missing fields", () => {
    expect(scheduleIsComplete({ type: "weekly", time: "06:00", days: [] })).toBe(false);
    expect(scheduleIsComplete({ type: "cron", expression: "  " })).toBe(false);
    expect(scheduleIsComplete({ type: "interval", minutes: 0 })).toBe(false);
    expect(scheduleIsComplete({ type: "monthly", time: "01:00" })).toBe(false);
  });

  it("converts between minutes and hours", () => {
    expect(splitInterval(90)).toEqual({ count: 90, unit: "minutes" });
    expect(splitInterval(120)).toEqual({ count: 2, unit: "hours" });
    expect(splitInterval(30)).toEqual({ count: 30, unit: "minutes" });
    expect(joinInterval(2, "hours")).toBe(120);
    expect(joinInterval(15, "minutes")).toBe(15);
  });
});
