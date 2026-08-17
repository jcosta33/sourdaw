use daw_core::{PluginId, PluginInstanceId};
use daw_plugin_host::scanner::ScanResult;
use sourdaw_native::commands::plugins as native;
use sourdaw_native::state::AppState;

use crate::windows::TauriWindowHost;

use super::binary_ipc::{raw_body_bytes, read_percent_encoded_header};

pub use sourdaw_native::commands::plugins::{PluginInstance, PluginParameter, PluginUnloadResult};

#[tauri::command]
pub async fn scan_plugins(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<ScanResult, String> {
    native::scan_plugins(paths, &state).await
}

#[tauri::command]
pub async fn get_default_plugin_paths() -> Result<Vec<String>, String> {
    native::get_default_plugin_paths().await
}

#[tauri::command]
pub async fn load_plugin(
    plugin_id: PluginId,
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<PluginInstance, String> {
    native::load_plugin(plugin_id, instance_id, &state).await
}

#[tauri::command]
pub async fn unload_plugin(
    instance_id: Option<PluginInstanceId>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<PluginUnloadResult, String> {
    native::unload_plugin(instance_id, &TauriWindowHost::new(app), &state).await
}

#[tauri::command]
pub async fn set_plugin_parameter(
    instance_id: PluginInstanceId,
    param_id: u32,
    value: f64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::set_plugin_parameter(instance_id, param_id, value, &state).await
}

#[tauri::command]
pub async fn get_plugin_parameters(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PluginParameter>, String> {
    native::get_plugin_parameters(instance_id, &state).await
}

/// Read a plugin instance's opaque state chunk over Tauri's binary IPC path.
///
/// `tauri::ipc::Response` carries the bytes verbatim to the webview as an
/// `ArrayBuffer`. A `Vec<u8>` return would be serialized as a JSON array of
/// decimal numbers — ~3.57x the raw length for the high-entropy bytes real
/// plugin state is made of (OE-5 / WB-5 / M-109).
#[tauri::command]
pub async fn get_plugin_state_bytes(
    instance_id: PluginInstanceId,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let chunk = native::get_plugin_state_bytes(instance_id, &state).await?;
    Ok(tauri::ipc::Response::new(chunk))
}

/// Restore a plugin instance's opaque state chunk over Tauri's binary IPC path.
///
/// The whole invoke message is the chunk (`InvokeBody::Raw`), so the instance id
/// travels in the `x-sourdaw-plugin-instance` header.
#[tauri::command]
pub async fn set_plugin_state_bytes(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let instance_id = read_percent_encoded_header(&request, native::PLUGIN_INSTANCE_HEADER)?;
    let plugin_state = raw_body_bytes(&request, "set_plugin_state_bytes")?;

    native::set_plugin_state_bytes(instance_id, plugin_state, &state).await
}

#[tauri::command]
pub async fn start_native_engine(state: tauri::State<'_, AppState>) -> Result<String, String> {
    native::start_native_engine(&state).await
}

#[tauri::command]
pub async fn send_plugin_midi(
    engine_plugin_id: usize,
    note: u8,
    velocity: u8,
    channel: i16,
    is_note_on: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::send_plugin_midi(
        engine_plugin_id,
        note,
        velocity,
        channel,
        is_note_on,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn set_plugin_bypass(
    instance_id: String,
    bypassed: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::set_plugin_bypass(instance_id, bypassed, &state).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_plugin_transport(
    tempo: f64,
    time_sig_num: u16,
    time_sig_denom: u16,
    is_playing: bool,
    song_pos_beats: f64,
    song_pos_seconds: f64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::update_plugin_transport(
        tempo,
        time_sig_num,
        time_sig_denom,
        is_playing,
        song_pos_beats,
        song_pos_seconds,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn process_plugin_audio(
    instance_id: String,
    audio_bytes: Vec<u8>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    native::process_plugin_audio(instance_id, audio_bytes, &state).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use daw_plugin_host::{AudioPlugin, ClapWrapper};
    use sourdaw_native::host::native_bridge::SharedClapPlugin;
    use sourdaw_native::state::{EnginePluginInstanceData, PluginRelayScratch};
    use std::sync::Arc;
    use tauri::Manager;

    use super::super::binary_ipc::raw_response_bytes;

    fn block_on<Fut: std::future::Future>(future: Fut) -> Fut::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build")
            .block_on(future)
    }

    fn command_test_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(AppState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build")
    }

    fn insert_engine_owned_fixture(state: &AppState, instance_id: &str, state_bytes: Vec<u8>) {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture(
            "Engine Owned Fixture",
            state_bytes,
            true,
        );
        let parameters = wrapper.get_parameters();
        let runtime = Arc::new(SharedClapPlugin::new(wrapper));
        let mut engine_plugins = state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock should be available");
        engine_plugins.insert(
            instance_id.to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 17,
                runtime,
                name: "Engine Owned Fixture".to_string(),
                parameters,
                has_gui: true,
                bridge: None,
                relay_scratch: PluginRelayScratch::default(),
            },
        );
    }

    #[test]
    fn get_plugin_state_bytes_returns_the_chunk_as_a_raw_body_not_a_json_number_array() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        insert_engine_owned_fixture(&state, "engine-owned-fixture", vec![1, 2, 3]);

        let response = block_on(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            state.clone(),
        ))
        .expect("state read should succeed");

        assert_eq!(raw_response_bytes(response), vec![1, 2, 3]);
    }

    #[test]
    fn get_plugin_state_bytes_preserves_zero_and_high_bytes_verbatim() {
        let app = command_test_app();
        let state = app.state::<AppState>();
        let chunk = vec![0u8, 1, 127, 128, 200, 254, 255, 0];
        insert_engine_owned_fixture(&state, "engine-owned-fixture", chunk.clone());

        let response = block_on(get_plugin_state_bytes(
            PluginInstanceId("engine-owned-fixture".to_string()),
            state.clone(),
        ))
        .expect("state read should succeed");

        assert_eq!(raw_response_bytes(response), chunk);
    }
}
