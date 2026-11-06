import type { CatalogResponse, TableSummary } from "@/lib/api-types";

export function filterCatalog(catalog: CatalogResponse, query: string): CatalogResponse {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;
  return {
    schemas: catalog.schemas
      .map((schema) => {
        if (schema.name.includes(q)) return schema;
        const tables = schema.tables
          .map((table) => {
            if (table.name.includes(q)) return table;
            const columns = table.columns.filter((c) => c.name.toLowerCase().includes(q));
            return columns.length ? { ...table, columns } : null;
          })
          .filter((t): t is TableSummary => t !== null);
        return tables.length ? { ...schema, tables } : null;
      })
      .filter((s): s is CatalogResponse["schemas"][number] => s !== null),
  };
}
