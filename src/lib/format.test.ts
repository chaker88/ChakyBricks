import { typeCategory } from "@/lib/column-types";
import { formatBytes, formatCell, formatDuration, formatNumber } from "@/lib/format";

describe("format", () => {
  it("formats numbers and bytes", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
    expect(formatBytes(250 * 1024 ** 2)).toBe("250 MB");
  });

  it("formats durations", () => {
    expect(formatDuration(3.21)).toBe("3.2s");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3720)).toBe("1h 2m");
  });

  it("formats cells", () => {
    expect(formatCell(null)).toBe("NULL");
    expect(formatCell(3.5)).toBe("3.5");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("column types", () => {
  it.each([
    ["BIGINT", "number"],
    ["DECIMAL(18,2)", "number"],
    ["UBIGINT", "number"],
    ["VARCHAR", "text"],
    ["DATE", "date"],
    ["TIMESTAMP WITH TIME ZONE", "date"],
    ["TIME", "time"],
    ["BOOLEAN", "boolean"],
    ["BLOB", "binary"],
    ["STRUCT(a INTEGER)", "nested"],
    ["INTEGER[]", "nested"],
  ])("%s is %s", (type, category) => {
    expect(typeCategory(type)).toBe(category);
  });
});
