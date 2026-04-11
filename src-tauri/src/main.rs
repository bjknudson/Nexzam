#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use std::sync::Arc;

use backend::{start_backend_supervisor, AppRuntimeState, DesktopContext};
use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::{Manager, RunEvent};

#[tauri::command]
fn get_desktop_context(state: tauri::State<'_, Arc<AppRuntimeState>>) -> DesktopContext {
    state.desktop_context()
}

#[tauri::command]
fn open_bank_dialog() -> Option<String> {
    FileDialog::new()
        .add_filter("Nexzam Banks", &["bok"])
        .set_title("Open Nexzam Bank")
        .pick_file()
        .map(|path| path.display().to_string())
}

#[tauri::command]
fn save_bank_dialog(current_path: Option<String>) -> Option<String> {
    let mut dialog = FileDialog::new()
        .add_filter("Nexzam Banks", &["bok"])
        .set_title("Save Nexzam Bank");

    if let Some(path) = current_path {
        dialog = dialog.set_file_name(
            std::path::Path::new(&path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("bank.bok"),
        );
    } else {
        dialog = dialog.set_file_name("bank.bok");
    }

    dialog.save_file().map(|path| path.display().to_string())
}

#[tauri::command]
fn set_archive_dirty(state: tauri::State<'_, Arc<AppRuntimeState>>, dirty: bool) {
    state.set_archive_dirty(dirty);
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Arc::new(AppRuntimeState::default()))
        .setup(|app| {
            start_backend_supervisor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_context,
            open_bank_dialog,
            save_bank_dialog,
            set_archive_dirty
        ])
        .build(tauri::generate_context!())
        .expect("error while running Nexzam");

    app.run(|app_handle, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                let state = app_handle.state::<Arc<AppRuntimeState>>();
                if state.allow_exit() {
                    return;
                }

                if state.desktop_context().archive_dirty {
                    api.prevent_exit();
                    let confirm = MessageDialog::new()
                        .set_level(MessageLevel::Warning)
                        .set_title("Unsaved Archive Changes")
                        .set_description(
                            "The working copy has changes that have not been written back to the .bok archive. Quit anyway?",
                        )
                        .set_buttons(MessageButtons::YesNo)
                        .show();

                    if confirm == MessageDialogResult::Yes {
                        state.set_allow_exit(true);
                        state.stop_backend();
                        app_handle.exit(0);
                    }
                } else {
                    state.stop_backend();
                }
            }
            RunEvent::Exit => {
                let state = app_handle.state::<Arc<AppRuntimeState>>();
                state.stop_backend();
            }
            _ => {}
        });
}
