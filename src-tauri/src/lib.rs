mod commands;
pub mod host;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .manage(commands::midi::MidiState::default())
        .manage(commands::llm::LlmSidecarState::default())
        .manage(commands::speech::DictationState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::llm::start_llm_sidecar,
            commands::llm::stop_llm_sidecar,
            commands::llm::get_llm_sidecar_status,
            commands::llm::get_model_dir,
            commands::llm::generate_llm_completion,
            commands::llm::stream_llm_completion,
            commands::speech::load_whisper_model,
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
            // audio bridge
            commands::audio_ipc::audio_ipc,
            // MIDI bridge
            commands::midi::list_midi_inputs,
            commands::midi::open_midi_input,
            commands::midi::close_midi_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

