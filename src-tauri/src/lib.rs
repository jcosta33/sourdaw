mod commands;
pub mod host;
pub mod state;

const SENTRY_DSN: &str = "https://666a44d19fe7746cab1f89db2f3610fb@o4511158245654528.ingest.de.sentry.io/4511158252732496";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry = sentry::init((
        SENTRY_DSN,
        sentry::ClientOptions {
            release: Some(format!("sourdaw@{APP_VERSION}").into()),
            attach_stacktrace: true,
            send_default_pii: false,
            ..Default::default()
        },
    ));

    tauri::Builder::default()
        .manage(state::AppState::default())
        .manage(commands::collab::CollabState::default())
        .manage(commands::midi::MidiState::default())
        .manage(commands::native_llm::NativeLlmState::default())
        .manage(commands::speech::DictationState::default())
        .manage(commands::audio_gen::AudioGenState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            // Native in-process LLM (mistral.rs)
            commands::native_llm::init_native_llm,
            commands::native_llm::generate_native_completion,
            commands::native_llm::stream_native_completion,
            commands::native_llm::native_tool_calling,
            commands::native_llm::schema_constrained_generation,
            commands::native_llm::unload_native_llm,
            commands::native_llm::get_native_llm_status,
            commands::native_llm::get_model_dir,
            // AI audio processing (DeepFilterNet + Demucs ONNX)
            commands::ai_audio::denoise_audio,
            commands::ai_audio::separate_stems,
            // Audio generation sidecar (Stable Audio Open)
            commands::audio_gen::start_audio_gen_sidecar,
            commands::audio_gen::generate_audio_clip,
            commands::audio_gen::stop_audio_gen_sidecar,
            commands::audio_postprocess::post_process_audio,
            commands::speech::load_whisper_model,
            commands::speech::ensure_whisper_ready,
            commands::speech::start_dictation,
            commands::speech::stop_dictation,
            commands::speech::get_asr_status,
            commands::filesystem::read_audio_file,
            commands::filesystem::write_audio_file,
            commands::filesystem::list_directory,
            commands::plugins::scan_plugins,
            commands::plugins::get_default_plugin_paths,
            commands::plugins::load_plugin,
            commands::plugins::unload_plugin,
            commands::plugins::set_plugin_parameter,
            commands::plugins::get_plugin_parameters,
            commands::plugins::get_plugin_state,
            commands::plugins::set_plugin_state,
            commands::plugins::start_native_engine,
            commands::plugins::send_plugin_midi,
            commands::plugins::update_plugin_transport,
            commands::plugins::process_plugin_audio,
            // audio bridge
            // commands::audio_ipc::audio_ipc, // TODO: re-add when audio_ipc module is implemented
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
            commands::collab::collab_get_nearby_sessions,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
