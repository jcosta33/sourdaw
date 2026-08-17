mod commands;
mod events;
pub mod host;
pub mod state;
mod windows;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .manage(commands::collab::CollabState::default())
        .manage(commands::link::LinkState::default())
        .manage(commands::midi::MidiState::default())
        .manage(commands::midi::PushState::default())
        .manage(commands::speech::DictationState::default())
        .manage(commands::crumbs::CrumbsState::default())
        .manage(commands::provider_gateway::ProviderGatewayState::default())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            // Privileged model-provider gateway
            commands::provider_gateway::provider_gateway_request,
            commands::provider_gateway::cancel_provider_gateway_request,
            // AI audio processing
            commands::ai_audio::denoise_audio,
            commands::audio_postprocess::post_process_audio,
            commands::speech::load_whisper_model,
            commands::speech::ensure_whisper_ready,
            commands::speech::start_dictation,
            commands::speech::stop_dictation,
            commands::speech::get_asr_status,
            commands::filesystem::read_audio_file,
            commands::filesystem::write_audio_file,
            commands::filesystem::read_file_bytes,
            commands::filesystem::write_file_bytes,
            commands::filesystem::list_directory,
            commands::plugins::scan_plugins,
            commands::plugins::get_default_plugin_paths,
            commands::plugins::load_plugin,
            commands::plugins::unload_plugin,
            commands::plugins::set_plugin_parameter,
            commands::plugins::get_plugin_parameters,
            commands::plugins::get_plugin_state_bytes,
            commands::plugins::set_plugin_state_bytes,
            commands::plugins::start_native_engine,
            commands::plugins::send_plugin_midi,
            commands::plugins::set_plugin_bypass,
            commands::plugins::update_plugin_transport,
            commands::plugins::process_plugin_audio,
            commands::engine_diagnostics::engine_rt_diagnostics,
            // Plugin GUI
            commands::plugin_gui::is_plugin_gui_supported,
            commands::plugin_gui::open_plugin_gui,
            commands::plugin_gui::close_plugin_gui,
            commands::plugin_gui::close_all_plugin_guis,
            commands::plugin_gui::hide_all_plugin_guis,
            commands::plugin_gui::show_all_plugin_guis,
            // MIDI bridge
            commands::midi::list_midi_inputs,
            commands::midi::open_midi_input,
            commands::midi::close_midi_input,
            commands::midi::open_push_transport,
            commands::midi::send_push_midi,
            commands::midi::write_push2_display,
            commands::midi::close_push_transport,
            // Ableton Link bridge
            commands::link::enable_link,
            commands::link::disable_link,
            commands::link::set_link_tempo,
            commands::link::get_link_status,
            commands::link::link_start_playing,
            commands::link::link_stop_playing,
            // CRDT collaboration
            commands::collab::collab_create_project,
            commands::collab::collab_save_bundle,
            commands::collab::collab_load_bundle,
            commands::collab::collab_get_document_state,
            commands::collab::collab_merge_bundle,
            commands::collab::collab_apply_change,
            // LAN discovery
            commands::collab::collab_start_advertising,
            commands::collab::collab_stop_advertising,
            commands::collab::collab_start_browsing,
            commands::collab::collab_stop_browsing,
            commands::collab::collab_get_nearby_sessions,
            // Crumbs
            commands::crumbs::create_crumbs,
            commands::crumbs::destroy_crumbs,
            commands::crumbs::load_sample,
            commands::crumbs::crumbs_note_on,
            commands::crumbs::crumbs_note_off,
            commands::crumbs::set_crumbs_param,
            commands::crumbs::set_crumbs_mode,
            commands::crumbs::get_waveform_peaks,
            commands::crumbs::detect_onsets,
            commands::crumbs::detect_sample_pitch,
            commands::crumbs::crumbs_all_sound_off,
            commands::crumbs::get_crumbs_position,
            commands::crumbs::detect_smart_loop_points,
            commands::crumbs::arm_recording,
            commands::crumbs::stop_recording,
            // Pitch Edit
            commands::pitch_edit::analyze_pitch,
            commands::pitch_edit::commit_pitch_edit,
            // Tuning
            commands::tuning::parse_scl,
        ])
        .setup(|app| {
            // Start the CLAP latency watcher: it turns a plugin's
            // clap_host_latency.changed() / request_restart() callback into a
            // `plugin-latency-changed` event on the webview (PH-4). Started here
            // rather than at first load so the sender exists before any plugin
            // can flag.
            let engine_plugins = {
                let app_state = app.state::<state::AppState>();
                std::sync::Arc::clone(&app_state.engine_plugins)
            };
            host::latency_watcher::start(
                Arc::new(events::TauriEventSink::new(app.handle().clone())),
                engine_plugins,
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // `RunEvent::Exit` is this shell's only hook onto the exit cascade.
            // The cascade itself — its three steps and their order — belongs to
            // `sourdaw_native::shutdown`, so the Node shell runs the same one.
            if let tauri::RunEvent::Exit = event {
                let window_host = windows::TauriWindowHost::new(app_handle.clone());
                let report = sourdaw_native::shutdown::shutdown(
                    &app_handle.state::<commands::collab::CollabState>(),
                    app_handle.state::<state::AppState>().inner(),
                    Some(&window_host),
                );

                if !report.editors_that_refused.is_empty() {
                    eprintln!(
                        "[Plugin] editors that did not close on exit: {:?}",
                        report.editors_that_refused
                    );
                }
                if let Some(error) = report.editor_close_error {
                    eprintln!("[Plugin] closing plugin editors on exit failed: {error}");
                }
            }
        });
}
