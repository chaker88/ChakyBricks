import type { CatalogResponse } from "@/lib/api-types";
import { filterCatalog } from "@/lib/catalog";

const table = (name: string, columns: string[]) => ({
  schema: "x",
  name,
  version: 0,
  row_count: 1,
  size_bytes: 1,
  updated_at: "",
  columns: columns.map((c) => ({ name: c, type: "VARCHAR" })),
});

const catalog: CatalogResponse = {
  schemas: [
    { name: "main", tables: [table("orders", ["order_id", "region"]), table("users", ["email"])] },
    { name: "sales", tables: [table("targets", ["quota"])] },
  ],
};

describe("filterCatalog", () => {
  it("returns everything for an empty query", () => {
    expect(filterCatalog(catalog, "  ")).toBe(catalog);
  });

  it("matches schemas, tables and columns", () => {
    expect(filterCatalog(catalog, "sales").schemas.map((s) => s.name)).toEqual(["sales"]);
    const byTable = filterCatalog(catalog, "USERS");
    expect(byTable.schemas[0].tables.map((t) => t.name)).toEqual(["users"]);
    expect(byTable.schemas[0].tables[0].columns).toHaveLength(1);
    const byColumn = filterCatalog(catalog, "region");
    expect(byColumn.schemas).toHaveLength(1);
    expect(byColumn.schemas[0].tables[0].columns.map((c) => c.name)).toEqual(["region"]);
    expect(filterCatalog(catalog, "nothing").schemas).toEqual([]);
  });
});
