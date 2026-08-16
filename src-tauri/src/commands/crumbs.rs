use sourdaw_native::commands::crumbs as native;
use sourdaw_native::state::AppState;

pub use daw_dsp::crumbs::types::SampleId;
pub use sourdaw_native::commands::crumbs::{
    CrumbsState, LoopPointDetectionResult, OnsetDetectionResult, PitchDetectionResult,
    SampleLoadResult,
};

#[tauri::command]
pub async fn create_crumbs(
    instance_id: String,
    sample_rate: f32,
    state: tauri::State<'_, CrumbsState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::create_crumbs(instance_id, sample_rate, &state, &app_state).await
}

#[tauri::command]
pub async fn destroy_crumbs(
    instance_id: String,
    state: tauri::State<'_, CrumbsState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    native::destroy_crumbs(instance_id, &state, &app_state).await
}

#[tauri::command]
pub async fn load_sample(
    instance_id: String,
    file_path: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<SampleLoadResult, String> {
    native::load_sample(instance_id, file_path, &state).await
}

#[tauri::command]
pub async fn crumbs_note_on(
    instance_id: String,
    note: u8,
    velocity: u8,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::crumbs_note_on(instance_id, note, velocity, &state).await
}

#[tauri::command]
pub async fn crumbs_note_off(
    instance_id: String,
    note: u8,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::crumbs_note_off(instance_id, note, &state).await
}

#[tauri::command]
pub async fn set_crumbs_param(
    instance_id: String,
    param: String,
    value: f32,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::set_crumbs_param(instance_id, param, value, &state).await
}

#[tauri::command]
pub async fn set_crumbs_mode(
    instance_id: String,
    mode: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::set_crumbs_mode(instance_id, mode, &state).await
}

/// Waveform peaks as raw f32 bytes.
///
/// `tauri::ipc::Response` carries them verbatim to the webview as an
/// `ArrayBuffer`; a `Vec<u8>` return would be serialized as a JSON array of
/// decimal numbers instead.
#[tauri::command]
pub async fn get_waveform_peaks(
    instance_id: String,
    sample_id: SampleId,
    level: usize,
    channel: Option<u8>,
    state: tauri::State<'_, CrumbsState>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = native::get_waveform_peaks(instance_id, sample_id, level, channel, &state).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn detect_onsets(
    instance_id: String,
    sample_id: SampleId,
    algorithm: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<OnsetDetectionResult, String> {
    native::detect_onsets(instance_id, sample_id, algorithm, &state).await
}

#[tauri::command]
pub async fn detect_sample_pitch(
    instance_id: String,
    sample_id: SampleId,
    state: tauri::State<'_, CrumbsState>,
) -> Result<PitchDetectionResult, String> {
    native::detect_sample_pitch(instance_id, sample_id, &state).await
}

#[tauri::command]
pub async fn crumbs_all_sound_off(
    instance_id: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::crumbs_all_sound_off(instance_id, &state).await
}

#[tauri::command]
pub async fn get_crumbs_position(
    instance_id: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<u64, String> {
    native::get_crumbs_position(instance_id, &state).await
}

#[tauri::command]
pub async fn detect_smart_loop_points(
    instance_id: String,
    sample_id: SampleId,
    state: tauri::State<'_, CrumbsState>,
) -> Result<Option<LoopPointDetectionResult>, String> {
    native::detect_smart_loop_points(instance_id, sample_id, &state).await
}

#[tauri::command]
pub async fn arm_recording(
    instance_id: String,
    threshold: f32,
    target_pad: u8,
    max_duration_secs: f32,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::arm_recording(
        instance_id,
        threshold,
        target_pad,
        max_duration_secs,
        &state,
    )
    .await
}

#[tauri::command]
pub async fn stop_recording(
    instance_id: String,
    state: tauri::State<'_, CrumbsState>,
) -> Result<(), String> {
    native::stop_recording(instance_id, &state).await
}
