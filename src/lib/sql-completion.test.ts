import type { TableSummary } from "@/lib/api-types";
import { completionsAt, findTable, tableReferences } from "@/lib/sql-completion";

const table = (schema: string, name: string, columns: string[]): TableSummary => ({
  schema,
  name,
  version: 0,
  row_count: 10,
  size_bytes: 1,
  updated_at: "",
  columns: columns.map((c) => ({ name: c, type: "VARCHAR" })),
});

const tables = [
  table("main", "orders", ["order_id", "region", "amount"]),
  table("main", "employees", ["الاسم", "prénom"]),
  table("sales", "targets", ["region", "quota"]),
];

const labels = (before: string, full = before) =>
  completionsAt(before, full, tables).map((c) => c.label);

describe("sql completion", () => {
  it("finds tables by bare, qualified and quoted names", () => {
    expect(findTable(tables, "orders")?.schema).toBe("main");
    expect(findTable(tables, "sales.targets")?.name).toBe("targets");
    expect(findTable(tables, '"sales"."targets"')?.name).toBe("targets");
    expect(findTable(tables, "targets")?.schema).toBe("sales");
    expect(findTable(tables, "nope")).toBeUndefined();
  });

  it("collects references and aliases from FROM and JOIN", () => {
    const refs = tableReferences(
      "SELECT * FROM orders o JOIN sales.targets AS t ON o.region = t.region WHERE 1",
      tables,
    );
    expect(refs.get("o")?.name).toBe("orders");
    expect(refs.get("t")?.name).toBe("targets");
    expect(refs.get("sales.targets")?.name).toBe("targets");
    expect(refs.has("on")).toBe(false);
    expect(tableReferences("SELECT * FROM orders WHERE x", tables).has("where")).toBe(false);
  });

  it("suggests tables after a schema qualifier", () => {
    expect(labels("SELECT * FROM sales.")).toEqual(["targets"]);
    expect(labels("SELECT * FROM sales.ta")).toEqual(["targets"]);
  });

  it("suggests columns after a table or alias qualifier", () => {
    const full = "SELECT o. FROM orders o";
    expect(labels("SELECT o.", full)).toEqual(["order_id", "region", "amount"]);
    expect(labels("SELECT orders.")).toEqual(["order_id", "region", "amount"]);
    expect(labels("SELECT sales.targets.")).toEqual(["region", "quota"]);
    expect(labels("SELECT employees.")).toEqual(["الاسم", "prénom"]);
    expect(labels("SELECT unknown.")).toEqual([]);
  });

  it("ranks referenced columns first, then tables, schemas, keywords and functions", () => {
    const items = completionsAt("SELECT ", "SELECT  FROM employees", tables);
    const kinds = [
      ...new Set(items.sort((a, b) => a.sortText.localeCompare(b.sortText)).map((i) => i.kind)),
    ];
    expect(kinds).toEqual(["column", "table", "schema", "keyword", "function"]);
    expect(items.filter((i) => i.kind === "column").map((i) => i.label)).toEqual([
      "prénom",
      "الاسم",
    ]);
    expect(items.filter((i) => i.kind === "table").map((i) => i.label)).toContain("sales.targets");
    expect(items.filter((i) => i.kind === "table").map((i) => i.label)).toContain("orders");
    expect(items.find((i) => i.label === "count")?.insertText).toBe("count(");
  });
});
