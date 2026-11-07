import { describe, expect, it } from "vitest";
import {
  formatBucket,
  formatPercentChange,
  formatValue,
  nextBucket,
  parseISODate,
  toISODate,
} from "@/lib/number-format";

describe("formatValue", () => {
  it("abbreviates large numbers when compact", () => {
    expect(formatValue(1234, undefined, true)).toBe("1.2K");
    expect(formatValue(3_400_000, { type: "compact" }, true)).toBe("3.4M");
    expect(formatValue(5_600_000_000, undefined, true)).toBe("5.6B");
    expect(formatValue(999, undefined, true)).toBe("999");
  });

  it("keeps full precision with separators for tooltips", () => {
    expect(formatValue(1234567.891, undefined, false)).toBe("1,234,567.89");
    expect(formatValue(42, { type: "number" }, true)).toBe("42");
  });

  it("formats currency and percent", () => {
    expect(formatValue(1500, { type: "currency", currency: "USD" }, true)).toBe("$1.5K");
    expect(formatValue(1234.5, { type: "currency", currency: "USD" }, false)).toBe("$1,234.5");
    expect(formatValue(0.123, { type: "percent" }, true)).toBe("12.3%");
    expect(formatValue(0.5, { type: "percent", decimals: 0 }, false)).toBe("50%");
  });

  it("handles missing values and honours decimals", () => {
    expect(formatValue(null, undefined, true)).toBe("—");
    expect(formatValue(Number.NaN, undefined, true)).toBe("—");
    expect(formatValue(2.5, { type: "number", decimals: 2 }, false)).toBe("2.50");
  });
});

describe("formatPercentChange", () => {
  it("signs changes", () => {
    expect(formatPercentChange(0.1234)).toBe("+12.3%");
    expect(formatPercentChange(-0.5)).toBe("−50%");
    expect(formatPercentChange(null)).toBe("—");
  });
});

describe("date buckets", () => {
  it("labels each grain", () => {
    expect(formatBucket("2025-03-01", "month", false)).toBe("Mar 2025");
    expect(formatBucket("2025-04-01", "quarter", true)).toBe("Q2 2025");
    expect(formatBucket("2025-01-01", "year", true)).toBe("2025");
    expect(formatBucket("2025-03-03", "week", true)).toBe("Week of Mar 3, 2025");
    expect(formatBucket("2025-03-03", "day", false)).toBe("Mar 3");
    expect(formatBucket("not a date", "day", true)).toBe("not a date");
  });

  it("steps by grain", () => {
    expect(nextBucket("2025-01-31", "day")).toBe("2025-02-01");
    expect(nextBucket("2025-03-03", "week")).toBe("2025-03-10");
    expect(nextBucket("2025-01-01", "month")).toBe("2025-02-01");
    expect(nextBucket("2025-10-01", "quarter")).toBe("2026-01-01");
    expect(nextBucket("2025-01-01", "year")).toBe("2026-01-01");
  });

  it("round-trips ISO dates without timezone drift", () => {
    expect(toISODate(parseISODate("2024-02-29")!)).toBe("2024-02-29");
    expect(parseISODate("x")).toBeNull();
  });
});
