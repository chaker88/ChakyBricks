import type { Grain, NumberFormat } from "@/lib/dashboard-types";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let existing = formatters.get(key);
  if (!existing) {
    try {
      existing = new Intl.NumberFormat("en-US", options);
    } catch {
      existing = new Intl.NumberFormat("en-US", { ...options, currency: "USD" });
    }
    formatters.set(key, existing);
  }
  return existing;
}

/** Compact (1.2K, 3.4M) for axes, KPIs and labels; full precision with separators for tooltips. */
export function formatValue(
  value: number | null | undefined,
  format: NumberFormat | undefined,
  compact: boolean,
  compactDigits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const type = format?.type ?? "auto";
  const decimals = format?.decimals ?? undefined;
  if (type === "percent") {
    return formatter({
      style: "percent",
      minimumFractionDigits: decimals ?? 0,
      maximumFractionDigits: decimals ?? 1,
    }).format(value);
  }
  const currency: Intl.NumberFormatOptions =
    type === "currency" ? { style: "currency", currency: format?.currency || "USD" } : {};
  const short = type === "compact" || type === "currency" || type === "auto" ? compact : false;
  if (short && Math.abs(value) >= 1000) {
    return formatter({
      ...currency,
      notation: "compact",
      maximumFractionDigits: decimals ?? compactDigits,
      minimumFractionDigits: decimals ?? 0,
    }).format(value);
  }
  const whole = Number.isInteger(value);
  return formatter({
    ...currency,
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? (whole ? 0 : 2),
  }).format(value);
}

export function formatPercentChange(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return `${sign}${formatter({ style: "percent", maximumFractionDigits: 1 }).format(Math.abs(fraction))}`;
}

export function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Label for a date bucket; `long` is the tooltip form, the short one fits an axis. */
export function formatBucket(
  value: string,
  grain: Grain | null | undefined,
  long: boolean,
): string {
  const date = parseISODate(value);
  if (!date) return value;
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  switch (grain) {
    case "year":
      return String(year);
    case "quarter":
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${year}`;
    case "month":
      return `${month} ${year}`;
    case "week":
      return long ? `Week of ${month} ${date.getDate()}, ${year}` : `${month} ${date.getDate()}`;
    default:
      return long ? `${month} ${date.getDate()}, ${year}` : `${month} ${date.getDate()}`;
  }
}

export function nextBucket(value: string, grain: Grain): string | null {
  const date = parseISODate(value);
  if (!date) return null;
  switch (grain) {
    case "day":
      date.setDate(date.getDate() + 1);
      break;
    case "week":
      date.setDate(date.getDate() + 7);
      break;
    case "month":
      date.setMonth(date.getMonth() + 1);
      break;
    case "quarter":
      date.setMonth(date.getMonth() + 3);
      break;
    case "year":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return toISODate(date);
}
