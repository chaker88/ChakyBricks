mod backend;
mod shell;

use backend::Backend;
use shell::Shell;
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                shell::show_main_window(app);
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![shell::MINIMIZED_ARG]),
            ));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let backend = Backend::spawn(app.handle())?;
            app.manage(backend);
            let shell = Shell::load();
            let prefs = shell.prefs();
            app.manage(shell);
            shell::apply(app.handle());
            if !(prefs.wants_tray() && shell::started_minimized()) {
                shell::show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let keep = app
                    .try_state::<Shell>()
                    .is_some_and(|s| s.prefs().keep_running_in_background);
                if keep {
                    api.prevent_close();
                    shell::hide_main_window(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            backend::backend_info,
            shell::shell_prefs,
            shell::set_shell_prefs,
            shell::set_tray_paused
        ])
        .build(tauri::generate_context!())
        .expect("failed to build ChakyBricks");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(backend) = handle.try_state::<Backend>() {
                backend.shutdown();
            }
        }
    });
}
