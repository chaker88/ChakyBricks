use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::backend::Backend;

pub const MINIMIZED_ARG: &str = "--minimized";
const TRAY_ID: &str = "main";

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Prefs {
    pub keep_running_in_background: bool,
    pub start_with_system: bool,
}

impl Prefs {
    pub fn wants_tray(&self) -> bool {
        self.keep_running_in_background || self.start_with_system
    }
}

#[derive(Default)]
pub struct Shell {
    prefs: Mutex<Prefs>,
    pause_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

impl Shell {
    pub fn load() -> Self {
        let prefs = std::fs::read_to_string(config_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            prefs: Mutex::new(prefs),
            pause_item: Mutex::new(None),
        }
    }

    pub fn prefs(&self) -> Prefs {
        self.prefs.lock().map(|p| *p).unwrap_or_default()
    }
}

fn app_home() -> PathBuf {
    if let Some(home) = std::env::var_os("CHAKYBRICKS_HOME") {
        return PathBuf::from(home);
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join("ChakyBricks");
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join(".config").join("ChakyBricks")
}

fn config_path() -> PathBuf {
    app_home().join("config.json")
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub fn started_minimized() -> bool {
    std::env::args().any(|arg| arg == MINIMIZED_ARG)
}

pub fn apply(app: &AppHandle) {
    let prefs = app.state::<Shell>().prefs();
    sync_autostart(app, prefs.start_with_system);
    if prefs.wants_tray() {
        if app.tray_by_id(TRAY_ID).is_none() {
            if let Err(e) = build_tray(app) {
                eprintln!("could not create the tray icon: {e}");
            }
        }
    } else {
        app.remove_tray_by_id(TRAY_ID);
        if let Ok(mut item) = app.state::<Shell>().pause_item.lock() {
            *item = None;
        }
    }
}

fn sync_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    let result = if enabled {
        manager.enable()
    } else if current {
        manager.disable()
    } else {
        Ok(())
    };
    if let Err(e) = result {
        eprintln!("could not update the start-with-system entry: {e}");
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ChakyBricks", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pause all jobs", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &pause, &separator, &quit])?;
    if let Ok(mut slot) = app.state::<Shell>().pause_item.lock() {
        *slot = Some(pause.clone());
    }
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ChakyBricks")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "pause" => toggle_pause(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    set_pause_checked(app, jobs_paused(app));
    Ok(())
}

fn set_pause_checked(app: &AppHandle, checked: bool) {
    if let Ok(slot) = app.state::<Shell>().pause_item.lock() {
        if let Some(item) = slot.as_ref() {
            let _ = item.set_checked(checked);
        }
    }
}

fn toggle_pause(app: &AppHandle) {
    let wanted = !jobs_paused(app);
    let actual = set_jobs_paused(app, wanted).unwrap_or(!wanted);
    set_pause_checked(app, actual);
}

fn jobs_paused(app: &AppHandle) -> bool {
    request(app, "GET", "")
        .map(|body| body.contains("\"paused\":true"))
        .unwrap_or(false)
}

fn set_jobs_paused(app: &AppHandle, paused: bool) -> Option<bool> {
    let body = format!("{{\"paused\":{paused}}}");
    request(app, "PUT", &body).map(|text| text.contains("\"paused\":true"))
}

fn request(app: &AppHandle, method: &str, body: &str) -> Option<String> {
    let backend = app.try_state::<Backend>()?;
    let info = backend.info();
    let mut stream = TcpStream::connect(("127.0.0.1", info.port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .ok()?;
    let message = format!(
        "{method} /api/jobs/state HTTP/1.1\r\nHost: 127.0.0.1\r\nX-ChakyBricks-Token: {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        info.token,
        body.len()
    );
    stream.write_all(message.as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    response.starts_with("HTTP/1.1 200").then_some(response)
}

#[tauri::command]
pub fn shell_prefs(shell: State<'_, Shell>) -> Prefs {
    shell.prefs()
}

#[tauri::command]
pub fn set_shell_prefs(app: AppHandle, shell: State<'_, Shell>, prefs: Prefs) {
    if let Ok(mut current) = shell.prefs.lock() {
        *current = prefs;
    }
    apply(&app);
}

#[tauri::command]
pub fn set_tray_paused(app: AppHandle, paused: bool) {
    set_pause_checked(&app, paused);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefs_default_to_off() {
        let prefs: Prefs = serde_json::from_str("{\"workspace\": \"x\"}").unwrap();
        assert!(!prefs.wants_tray());
    }

    #[test]
    fn either_pref_wants_a_tray() {
        let prefs: Prefs = serde_json::from_str("{\"start_with_system\": true}").unwrap();
        assert!(prefs.wants_tray());
        assert!(!prefs.keep_running_in_background);
    }
}
