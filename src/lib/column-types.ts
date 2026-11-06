import {
  Binary,
  Braces,
  Calendar,
  Clock,
  Hash,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";

export type TypeCategory = "number" | "text" | "date" | "time" | "boolean" | "binary" | "nested";

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|U\w*INT|FLOAT|DOUBLE|REAL|DECIMAL)/;

export function typeCategory(type: string): TypeCategory {
  const t = type.toUpperCase();
  if (/^(STRUCT|MAP|UNION)\(/.test(t) || t.endsWith("]")) return "nested";
  if (NUMERIC.test(t)) return "number";
  if (t.startsWith("TIMESTAMP") || t.startsWith("TIME")) return t === "TIME" ? "time" : "date";
  if (t === "DATE") return "date";
  if (t === "BOOLEAN") return "boolean";
  if (t === "BLOB") return "binary";
  return "text";
}

const ICONS: Record<TypeCategory, LucideIcon> = {
  number: Hash,
  text: Type,
  date: Calendar,
  time: Clock,
  boolean: ToggleLeft,
  binary: Binary,
  nested: Braces,
};

export function typeIcon(type: string): LucideIcon {
  return ICONS[typeCategory(type)];
}

export function isNumericType(type: string): boolean {
  return typeCategory(type) === "number";
}
