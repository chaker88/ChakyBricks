import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { DATA_FILE_EXTENSIONS } from "@/lib/import";

export async function pickDataFile(): Promise<string | null> {
  if (!isTauri()) return window.prompt("Path to a data file")?.trim() || null;
  const result = await open({
    multiple: false,
    directory: false,
    title: "Import data",
    filters: [{ name: "Data files", extensions: DATA_FILE_EXTENSIONS }],
  });
  return typeof result === "string" ? result : null;
}

export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri()) return window.prompt(title)?.trim() || null;
  const result = await open({ multiple: false, directory: true, title });
  return typeof result === "string" ? result : null;
}

export async function pickSavePath(
  defaultName: string,
  format: "csv" | "parquet",
): Promise<string | null> {
  if (!isTauri()) return window.prompt("Save to path", defaultName)?.trim() || null;
  const result = await save({
    title: "Export full result",
    defaultPath: defaultName,
    filters: [{ name: format === "csv" ? "CSV" : "Parquet", extensions: [format] }],
  });
  return result ?? null;
}

/** Resolves to a path, null when cancelled, or undefined outside the desktop app. */
export async function pickExportPath(
  defaultName: string,
  format: "png" | "pdf",
): Promise<string | null | undefined> {
  if (!isTauri()) return undefined;
  const result = await save({
    title: "Export dashboard",
    defaultPath: defaultName,
    filters: [{ name: format === "png" ? "PNG image" : "PDF document", extensions: [format] }],
  });
  return result ?? null;
}
