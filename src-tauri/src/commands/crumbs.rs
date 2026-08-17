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

#[cfg(test)]
mod tests {
    use super::*;

    use daw_dsp::crumbs::engine::CrumbsMetering;
    use daw_dsp::crumbs::sample::SampleData;
    use daw_dsp::crumbs::types::CrumbsCommand;
    use sourdaw_native::commands::crumbs::CrumbsInstanceData;
    use sourdaw_native::host::native_bridge::{PendingRecordingCommit, RecordBufferPair};
    use std::collections::HashMap;
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

    /// One instance holding one mono sample, wired as `create_crumbs` wires it.
    fn instance_with_sample(sample_id: SampleId) -> CrumbsInstanceData {
        let (command_tx, _cmd_rx) = rtrb::RingBuffer::<CrumbsCommand>::new(8);
        let (_commit_tx, commit_rx) = rtrb::RingBuffer::<PendingRecordingCommit>::new(2);
        let (recycle_tx, _recycle_rx) = rtrb::RingBuffer::<RecordBufferPair>::new(2);

        let mut samples = HashMap::new();
        samples.insert(
            sample_id,
            Arc::new(SampleData::from_mono(
                (0..1024).map(|i| (i as f32 / 512.0) - 1.0).collect(),
                48_000,
            )),
        );

        CrumbsInstanceData {
            command_tx,
            samples,
            metering: Arc::new(CrumbsMetering::default()),
            engine_plugin_id: 0,
            next_sample_id: sample_id + 1,
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        }
    }

    #[test]
    fn get_waveform_peaks_returns_a_raw_body_not_a_json_number_array() {
        let app = tauri::test::mock_builder()
            .manage(CrumbsState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("test app should build");
        let state = app.state::<CrumbsState>();
        state
            .instances
            .lock()
            .expect("crumbs instances lock should be available")
            .insert("crumbs-a".to_string(), instance_with_sample(1));

        let response = block_on(get_waveform_peaks(
            "crumbs-a".to_string(),
            1,
            0,
            None,
            state.clone(),
        ))
        .expect("peak read should succeed");

        let bytes = raw_response_bytes(response);
        assert!(!bytes.is_empty(), "the sample must produce peaks");
        assert_eq!(
            bytes.len() % 4,
            0,
            "peaks cross as little-endian f32 bytes, not as decimal numbers"
        );
    }
}
