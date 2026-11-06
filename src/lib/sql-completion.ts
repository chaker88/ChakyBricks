import type { ColumnInfo, TableSummary } from "@/lib/api-types";

export type CompletionKind = "keyword" | "function" | "schema" | "table" | "column";

export interface Completion {
  label: string;
  kind: CompletionKind;
  insertText: string;
  detail?: string;
  sortText: string;
}

export const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "AS",
  "DISTINCT",
  "UNION",
  "UNION ALL",
  "EXCEPT",
  "INTERSECT",
  "WITH",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS NULL",
  "IS NOT NULL",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "ASC",
  "DESC",
  "NULLS LAST",
  "QUALIFY",
  "WINDOW",
  "OVER",
  "PARTITION BY",
  "DESCRIBE",
  "SUMMARIZE",
  "EXPLAIN",
  "PIVOT",
  "UNPIVOT",
];

export const SQL_FUNCTIONS = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "mode",
  "stddev",
  "approx_count_distinct",
  "quantile_cont",
  "string_agg",
  "list",
  "first",
  "last",
  "arg_max",
  "arg_min",
  "coalesce",
  "nullif",
  "cast",
  "try_cast",
  "round",
  "floor",
  "ceil",
  "abs",
  "lower",
  "upper",
  "trim",
  "length",
  "concat",
  "replace",
  "split_part",
  "regexp_matches",
  "regexp_replace",
  "strftime",
  "strptime",
  "date_trunc",
  "date_part",
  "date_diff",
  "current_date",
  "now",
  "row_number",
  "rank",
  "dense_rank",
  "lag",
  "lead",
  "unnest",
  "read_csv",
  "read_parquet",
  "read_json",
];

const IDENT = String.raw`(?:"[^"]+"|[\p{L}_][\p{L}\p{M}\p{N}_]*)`;
const QUALIFIER_RE = new RegExp(String.raw`(${IDENT}(?:\.${IDENT})?)\.([\p{L}\p{M}\p{N}_]*)$`, "u");
const REFERENCE_RE = new RegExp(
  String.raw`\b(?:from|join)\s+(${IDENT}(?:\.${IDENT})?)(?:\s+(?:as\s+)?(${IDENT}))?`,
  "giu",
);
const NOT_ALIASES = new Set([
  "where",
  "join",
  "left",
  "right",
  "full",
  "inner",
  "outer",
  "cross",
  "on",
  "using",
  "group",
  "order",
  "limit",
  "offset",
  "having",
  "union",
  "except",
  "intersect",
  "window",
  "qualify",
  "natural",
  "as",
  "pivot",
  "unpivot",
]);

export function unquote(identifier: string): string {
  return identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1)
    : identifier.toLowerCase();
}

export function findTable(tables: TableSummary[], reference: string): TableSummary | undefined {
  const parts = reference.split(".").map(unquote);
  if (parts.length === 2) {
    return tables.find((t) => t.schema === parts[0] && t.name === parts[1]);
  }
  return (
    tables.find((t) => t.schema === "main" && t.name === parts[0]) ??
    tables.find((t) => t.name === parts[0])
  );
}

export function tableReferences(sql: string, tables: TableSummary[]): Map<string, TableSummary> {
  const references = new Map<string, TableSummary>();
  for (const match of sql.matchAll(REFERENCE_RE)) {
    const table = findTable(tables, match[1]);
    if (!table) continue;
    references.set(table.name, table);
    references.set(`${table.schema}.${table.name}`, table);
    const alias = match[2] ? unquote(match[2]) : null;
    if (alias && !NOT_ALIASES.has(alias)) references.set(alias, table);
  }
  return references;
}

function columnItems(columns: ColumnInfo[], tableLabel: string, rank: string): Completion[] {
  return columns.map((c) => ({
    label: c.name,
    kind: "column",
    insertText: c.name,
    detail: `${c.type} · ${tableLabel}`,
    sortText: `${rank}${c.name}`,
  }));
}

export function completionsAt(
  textBeforeCursor: string,
  fullText: string,
  tables: TableSummary[],
): Completion[] {
  const schemas = [...new Set(tables.map((t) => t.schema))];
  const qualified = QUALIFIER_RE.exec(textBeforeCursor);
  if (qualified) {
    const qualifier = qualified[1];
    const name = unquote(qualifier);
    if (!qualifier.includes(".") && schemas.includes(name)) {
      return tables
        .filter((t) => t.schema === name)
        .map((t) => ({
          label: t.name,
          kind: "table",
          insertText: t.name,
          detail: `${t.row_count.toLocaleString()} rows`,
          sortText: `0${t.name}`,
        }));
    }
    const table =
      tableReferences(fullText, tables).get(qualifier.split(".").map(unquote).join(".")) ??
      findTable(tables, qualifier);
    return table ? columnItems(table.columns, `${table.schema}.${table.name}`, "0") : [];
  }

  const referenced = [...new Set(tableReferences(fullText, tables).values())];
  const items: Completion[] = referenced.flatMap((t) =>
    columnItems(t.columns, `${t.schema}.${t.name}`, "0"),
  );
  for (const t of tables) {
    const insertText = t.schema === "main" ? t.name : `${t.schema}.${t.name}`;
    items.push({
      label: insertText,
      kind: "table",
      insertText,
      detail: `${t.row_count.toLocaleString()} rows`,
      sortText: `1${insertText}`,
    });
  }
  for (const schema of schemas) {
    items.push({ label: schema, kind: "schema", insertText: schema, sortText: `2${schema}` });
  }
  for (const keyword of SQL_KEYWORDS) {
    items.push({ label: keyword, kind: "keyword", insertText: keyword, sortText: `3${keyword}` });
  }
  for (const fn of SQL_FUNCTIONS) {
    items.push({ label: fn, kind: "function", insertText: `${fn}(`, sortText: `4${fn}` });
  }
  return items;
}
