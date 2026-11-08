import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ShellPrefs {
  keep_running_in_background: boolean;
  start_with_system: boolean;
}

const NOTICE_KEY = "chakybricks.background-notice-seen";

/** Tells the desktop shell (tray icon, close behaviour, autostart) about the saved preferences. */
export async function applyShellPrefs(prefs: ShellPrefs): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_shell_prefs", { prefs });
}

export function backgroundNoticeSeen(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markBackgroundNoticeSeen(): void {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // storage unavailable: the notice is simply shown again next time
  }
}
