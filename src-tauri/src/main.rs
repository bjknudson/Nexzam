#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use backend::{start_backend_supervisor, AppRuntimeState, DesktopContext};
use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::menu::{MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

const UPDATE_REPO: &str = "bjknudson/Nexzam";

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

#[tauri::command]
fn check_for_updates(app_handle: AppHandle) {
    run_update_check(&app_handle);
}

fn run_update_check(app_handle: &AppHandle) {
    let current_version = app_handle.package_info().version.to_string();

    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Nexzam-Update-Check")
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            show_update_message(
                MessageLevel::Warning,
                "Could not start the update check.",
            );
            return;
        }
    };

    let response = match client
        .get(format!("https://api.github.com/repos/{UPDATE_REPO}/releases/latest"))
        .send()
    {
        Ok(response) => response,
        Err(_) => {
            show_update_message(
                MessageLevel::Warning,
                "Could not reach GitHub. Check your internet connection and try again.",
            );
            return;
        }
    };

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        show_update_message(
            MessageLevel::Info,
            "No published releases were found yet. This beta is distributed manually for now.",
        );
        return;
    }

    if !response.status().is_success() {
        show_update_message(
            MessageLevel::Warning,
            "GitHub returned an unexpected response. Try again later.",
        );
        return;
    }

    let body = match response.text() {
        Ok(text) => text,
        Err(_) => {
            show_update_message(MessageLevel::Warning, "Could not read the update response.");
            return;
        }
    };

    let latest_tag = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("tag_name").and_then(|v| v.as_str()).map(str::to_string));

    let Some(latest_tag) = latest_tag else {
        show_update_message(
            MessageLevel::Warning,
            "Could not parse the latest release information.",
        );
        return;
    };

    let latest_version = latest_tag.trim_start_matches('v');

    if compare_versions(latest_version, &current_version) == std::cmp::Ordering::Greater {
        let release_url = format!("https://github.com/{UPDATE_REPO}/releases/tag/{latest_tag}");
        let choice = MessageDialog::new()
            .set_level(MessageLevel::Info)
            .set_title("Update Available")
            .set_description(format!(
                "Nexzam {latest_version} is available. You're running {current_version}. Open the release page in your browser?"
            ))
            .set_buttons(MessageButtons::YesNo)
            .show();

        if choice == MessageDialogResult::Yes {
            let _ = Command::new("open").arg(release_url).spawn();
        }
    } else {
        show_update_message(
            MessageLevel::Info,
            format!("You're up to date. Nexzam {current_version}."),
        );
    }
}

fn show_update_message(level: MessageLevel, message: impl Into<String>) {
    MessageDialog::new()
        .set_level(level)
        .set_title("Check for Updates")
        .set_description(message.into())
        .set_buttons(MessageButtons::Ok)
        .show();
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(version: &str) -> Vec<u64> {
        version
            .split(|c: char| c == '.' || c == '-' || c == '+')
            .take(3)
            .map(|segment| segment.parse::<u64>().unwrap_or(0))
            .collect()
    }

    let (left, right) = (parts(a), parts(b));
    for index in 0..3 {
        let (l, r) = (
            left.get(index).copied().unwrap_or(0),
            right.get(index).copied().unwrap_or(0),
        );
        match l.cmp(&r) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Arc::new(AppRuntimeState::default()))
        .menu(|handle| {
            let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let check_updates_item =
                MenuItemBuilder::with_id("check-for-updates", "Check for Updates…").build(handle)?;
            let open_bank_item = MenuItemBuilder::with_id("open-bank", "Open Bank…")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;
            let open_demo_item =
                MenuItemBuilder::with_id("open-demo-bank", "Open Demo Bank").build(handle)?;
            let save_bank_item = MenuItemBuilder::with_id("save-bank", "Save Bank")
                .accelerator("CmdOrCtrl+S")
                .build(handle)?;
            let save_as_item = MenuItemBuilder::with_id("save-as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(handle)?;

            let app_menu = SubmenuBuilder::new(handle, "Nexzam")
                .item(&PredefinedMenuItem::about(handle, Some("About Nexzam"), None)?)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&open_bank_item)
                .item(&open_demo_item)
                .separator()
                .item(&save_bank_item)
                .item(&save_as_item)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(handle, "Window").minimize().build()?;

            let help_menu = SubmenuBuilder::new(handle, "Help")
                .item(&check_updates_item)
                .build()?;

            tauri::menu::MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()
        })
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "settings" => {
                let _ = app_handle.emit("nexzam://open-settings", ());
            }
            "check-for-updates" => {
                run_update_check(app_handle);
            }
            "open-bank" => {
                let _ = app_handle.emit("nexzam://open-bank", ());
            }
            "open-demo-bank" => {
                let _ = app_handle.emit("nexzam://open-demo-bank", ());
            }
            "save-bank" => {
                let _ = app_handle.emit("nexzam://save-bank", ());
            }
            "save-as" => {
                let _ = app_handle.emit("nexzam://save-as", ());
            }
            _ => {}
        })
        .setup(|app| {
            start_backend_supervisor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_context,
            open_bank_dialog,
            save_bank_dialog,
            set_archive_dirty,
            check_for_updates
        ])
        .build(tauri::generate_context!())
        .expect("error while running Nexzam");

    app.run(|app_handle, event| match event {
            RunEvent::WindowEvent { event: WindowEvent::Destroyed, .. } => {
                let state = app_handle.state::<Arc<AppRuntimeState>>();
                if app_handle.webview_windows().is_empty() {
                    state.stop_backend();
                }
            }
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
