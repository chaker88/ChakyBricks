import type { CellValue, ColumnInfo } from "@/lib/api-types";
import { formatCell } from "@/lib/format";

export function tableReference(schema: string, table: string): string {
  return schema === "main" ? table : `${schema}.${table}`;
}

export function previewSql(reference: string): string {
  return `SELECT *\nFROM ${reference}\nLIMIT 100;`;
}

export function estimateColumnWidth(
  column: ColumnInfo,
  rows: CellValue[][],
  index: number,
  sampleRows = 50,
): number {
  const sample = rows.slice(0, sampleRows).map((row) => formatCell(row[index]).length);
  const chars = Math.max(column.name.length + 4, column.type.length, ...sample);
  return Math.round(Math.min(360, Math.max(80, chars * 7.5 + 28)));
}
