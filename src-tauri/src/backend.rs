use std::error::Error;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

const TOKEN_ENV: &str = "CHAKYBRICKS_TOKEN";

#[derive(Clone, Serialize)]
pub struct BackendInfo {
    pub port: u16,
    pub token: String,
}

pub struct Backend {
    info: BackendInfo,
    child: Mutex<Option<Child>>,
}

impl Backend {
    pub fn spawn(app: &AppHandle) -> Result<Self, Box<dyn Error>> {
        let info = BackendInfo {
            port: free_port()?,
            token: new_token()?,
        };
        let mut command = backend_command(app)?;
        command
            .args(["--port", &info.port.to_string(), "--watch-stdin"])
            .env(TOKEN_ENV, &info.token)
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .env("PYTHONNOUSERSITE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to start backend: {e}"))?;
        if let Some(stdout) = child.stdout.take() {
            forward_output(stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            forward_output(stderr);
        }
        Ok(Self {
            info,
            child: Mutex::new(Some(child)),
        })
    }

    pub fn info(&self) -> &BackendInfo {
        &self.info
    }

    pub fn shutdown(&self) {
        if let Some(mut child) = self.child.lock().ok().and_then(|mut c| c.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[tauri::command]
pub fn backend_info(backend: State<'_, Backend>) -> BackendInfo {
    backend.info.clone()
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn new_token() -> Result<String, Box<dyn Error>> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("failed to generate token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(debug_assertions)]
fn backend_command(_app: &AppHandle) -> Result<Command, Box<dyn Error>> {
    use std::path::PathBuf;
    let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend");
    let python = std::env::var_os("CHAKYBRICKS_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| backend_dir.join(".venv/Scripts/python.exe"));
    if !python.exists() {
        return Err(format!(
            "backend Python not found at {}; run scripts/setup.ps1 first",
            python.display()
        )
        .into());
    }
    let mut command = Command::new(python);
    command.current_dir(backend_dir).args(["-m", "chakybricks"]);
    Ok(command)
}

#[cfg(not(debug_assertions))]
fn backend_command(app: &AppHandle) -> Result<Command, Box<dyn Error>> {
    use tauri::Manager;
    let python = app.path().resource_dir()?.join("python").join("python.exe");
    if !python.exists() {
        return Err(format!("bundled Python runtime not found at {}", python.display()).into());
    }
    let mut command = Command::new(python);
    command.args(["-m", "chakybricks"]);
    Ok(command)
}

fn forward_output(stream: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            eprintln!("[backend] {line}");
        }
    });
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_64_hex_chars_and_unique() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn free_port_is_bindable() {
        let port = free_port().unwrap();
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }
}
