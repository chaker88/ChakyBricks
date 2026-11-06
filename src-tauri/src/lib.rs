mod backend;

use backend::Backend;
use tauri::{Manager, RunEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let backend = Backend::spawn(app.handle())?;
            app.manage(backend);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend::backend_info])
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
