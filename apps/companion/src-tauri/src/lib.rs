mod config;
mod connection;
mod controller;
mod device;
mod game_actions;
mod input;
mod keys;
mod macros;
mod minecraft;
mod protocol;
mod tiktok;
mod updater;

use controller::{Controller, Snapshot};
use input::GameWindow;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

type Ctl<'a> = State<'a, Arc<Controller>>;

#[tauri::command]
fn get_state(ctl: Ctl) -> Snapshot {
    ctl.snapshot()
}

#[derive(Deserialize)]
struct PairResponse {
    token: String,
}

#[tauri::command]
async fn pair(ctl: Ctl<'_>, server_url: String, code: String, name: String) -> Result<(), String> {
    let server_url = server_url.trim().trim_end_matches('/').to_string();
    let response = reqwest::Client::new()
        .post(format!("{server_url}/api/companions/pair"))
        .json(&serde_json::json!({
            "code": code.trim().to_uppercase(),
            "name": name,
            "hostname": device::name(),
            "platform": device::platform(),
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if !response.status().is_success() {
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        return Err(body["error"].as_str().unwrap_or("Pairing failed").to_string());
    }
    let PairResponse { token } = response.json().await.map_err(|e| e.to_string())?;
    ctl.update_config(|c| {
        c.server_url = Some(server_url);
        c.device_token = Some(token);
        c.device_name = Some(name);
        // Approvals carry over from the old Ctrl/Alt toggles only for companions paired before they existed.
        c.approved_combos.get_or_insert_with(Vec::new);
    })?;
    connection::restart(&ctl);
    Ok(())
}

/// The PC's own name, to suggest as the device name when pairing.
#[tauri::command]
fn device_name() -> Option<String> {
    device::name()
}

#[tauri::command]
fn unpair(ctl: Ctl) -> Result<(), String> {
    connection::stop(&ctl);
    ctl.update_config(|c| c.device_token = None)
}

#[tauri::command]
fn reconnect(ctl: Ctl) {
    connection::restart(&ctl);
}

#[tauri::command]
fn list_windows(ctl: Ctl) -> Vec<GameWindow> {
    ctl.list_windows()
}

#[tauri::command]
fn set_target(ctl: Ctl, process: Option<String>) -> Result<(), String> {
    // With no game there's nothing to press into, so pause; picking one again waits for Resume.
    if process.is_none() {
        ctl.set_paused(true);
    }
    ctl.update_config(|c| c.target_process = process.map(|p| p.to_lowercase()))
}

#[tauri::command]
fn set_allowed_keys(ctl: Ctl, keys: Vec<String>) -> Result<(), String> {
    ctl.update_config(|c| c.allowed_keys = Some(keys))
}

#[tauri::command]
fn set_combo_approved(ctl: Ctl, key: String, approved: bool) -> Result<(), String> {
    ctl.set_combo_approved(&key, approved)
}

#[tauri::command]
fn set_paused(ctl: Ctl, paused: bool) -> Result<(), String> {
    if !paused && ctl.config().target_process.is_none() {
        return Err("Pick your game first, then resume".into());
    }
    ctl.set_paused(paused);
    Ok(())
}

#[tauri::command]
async fn tiktok_sign_in(app: AppHandle, ctl: Ctl<'_>) -> Result<bool, String> {
    tiktok::sign_in(app, ctl.inner().clone()).await
}

#[tauri::command]
async fn tiktok_status(ctl: Ctl<'_>) -> Result<tiktok::Status, String> {
    tiktok::status(ctl.inner().clone()).await
}

#[tauri::command]
fn start_recording(ctl: Ctl, name: String) -> Result<(), String> {
    ctl.start_recording(&name)
}

#[tauri::command]
fn cancel_recording(ctl: Ctl) {
    ctl.cancel_recording();
}

#[tauri::command]
fn delete_macro(ctl: Ctl, name: String) -> Result<(), String> {
    ctl.delete_macro(&name)
}

#[tauri::command]
fn try_macro(ctl: Ctl, name: String) {
    ctl.try_macro(name);
}

#[tauri::command]
fn save_game_action(ctl: Ctl, action: game_actions::GameAction, editing: Option<String>) -> Result<(), String> {
    ctl.save_game_action(action, editing)
}

#[tauri::command]
fn delete_game_action(ctl: Ctl, name: String) -> Result<(), String> {
    ctl.delete_game_action(&name)
}

#[tauri::command]
fn try_game_action(ctl: Ctl, name: String) {
    ctl.try_game_action(&name);
}

/// A blank or missing password keeps the saved one, which never comes back to the window.
#[tauri::command]
fn set_minecraft(ctl: Ctl, host: String, port: u16, password: Option<String>, player: String) -> Result<(), String> {
    ctl.set_minecraft(&host, port, password, &player)
}

#[tauri::command]
async fn test_minecraft(ctl: Ctl<'_>) -> Result<String, String> {
    ctl.inner().clone().test_minecraft().await
}

#[tauri::command]
fn request_permission() {
    input::request_permission();
}

#[tauri::command]
fn reset_permission(app: AppHandle) {
    input::reset_permission(&app.config().identifier);
}

/// macOS sometimes only applies a newly granted Accessibility permission once the app starts again.
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

/// The host's answer to "update automatically?", from the one-time question or the switch at the bottom of the window.
#[tauri::command]
fn set_auto_update(ctl: Ctl, enabled: bool) -> Result<(), String> {
    ctl.update_config(|c| c.auto_update = Some(enabled))?;
    if enabled {
        updater::resume(ctl.inner().clone());
    }
    Ok(())
}

// Update problems show in the window's update notice rather than as an error.
#[tauri::command]
async fn check_update(ctl: Ctl<'_>) -> Result<(), String> {
    updater::check(ctl.inner(), true).await;
    Ok(())
}

#[tauri::command]
async fn install_update(ctl: Ctl<'_>) -> Result<(), String> {
    let _ = updater::install(ctl.inner().clone(), false).await;
    Ok(())
}

#[tauri::command]
fn dismiss_update(ctl: Ctl) -> Result<(), String> {
    updater::dismiss(&ctl)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The panic hotkey only ever pauses; resuming is a deliberate click in the app.
    let panic_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Backspace);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &panic_key && event.state() == ShortcutState::Pressed {
                        app.state::<Arc<Controller>>().set_paused(true);
                    }
                    if shortcut == &controller::stop_key() && event.state() == ShortcutState::Pressed {
                        // Not from inside this handler: stopping unregisters the shortcut that called it.
                        let controller = app.state::<Arc<Controller>>().inner().clone();
                        std::thread::spawn(move || controller.finish_recording());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let controller = Controller::new(app.handle().clone(), config_path);
            app.manage(controller.clone());
            app.global_shortcut().register(panic_key)?;
            if controller.config().device_token.is_some() {
                connection::restart(&controller);
            }
            updater::start(controller.clone());
            controller.watch_permission();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            pair,
            device_name,
            unpair,
            reconnect,
            list_windows,
            set_target,
            set_allowed_keys,
            set_combo_approved,
            set_paused,
            request_permission,
            reset_permission,
            restart_app,
            start_recording,
            cancel_recording,
            delete_macro,
            try_macro,
            save_game_action,
            delete_game_action,
            try_game_action,
            set_minecraft,
            test_minecraft,
            tiktok_sign_in,
            tiktok_status,
            set_auto_update,
            check_update,
            install_update,
            dismiss_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Hyperion companion");
}
