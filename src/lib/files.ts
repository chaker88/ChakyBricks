import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
