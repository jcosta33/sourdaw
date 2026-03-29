mod commands;
pub mod host;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = tauri_specta::ts::builder()
        .commands(tauri_specta::collect_commands![
            commands::plugins::scan_plugins,
            commands::plugins::get_default_plugin_paths,
            commands::plugins::load_plugin,
            commands::plugins::unload_plugin,
            commands::plugins::set_plugin_parameter,
            commands::plugins::get_plugin_parameters,
            commands::plugins::get_plugin_state,
            commands::plugins::set_plugin_state,
        ]);

    #[cfg(debug_assertions)]
    specta_builder
        .export(specta::typescript::ExportConfiguration::new(), "../src/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .manage(state::AppState::default())
        .manage(commands::midi::MidiState::default())
        .manage(commands::llm::LlmSidecarState::default())
        .manage(commands::native_llm::NativeLlmState::default())
        .manage(commands::speech::DictationState::default())
        .manage(commands::audio_gen::AudioGenState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::llm::start_llm_sidecar,
            commands::llm::stop_llm_sidecar,
            commands::llm::get_llm_sidecar_status,
            commands::llm::get_model_dir,
            commands::llm::generate_llm_completion,
            commands::llm::stream_llm_completion,
            // Native in-process LLM (mistral.rs)
            commands::native_llm::init_native_llm,
            commands::native_llm::generate_native_completion,
            commands::native_llm::stream_native_completion,
            commands::native_llm::native_tool_calling,
            commands::native_llm::unload_native_llm,
            commands::native_llm::get_native_llm_status,
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
            // audio bridge
            commands::audio_ipc::audio_ipc,
            // Plugin GUI
            commands::plugin_gui::is_plugin_gui_supported,
            commands::plugin_gui::open_plugin_gui,
            commands::plugin_gui::close_plugin_gui,
            // MIDI bridge
            commands::midi::list_midi_inputs,
            commands::midi::open_midi_input,
            commands::midi::close_midi_input,
        ])
        .setup(|app| {
            tauri_specta::Builder::new()
                .commands(tauri_specta::collect_commands![
                    commands::plugins::scan_plugins,
                    commands::plugins::get_default_plugin_paths,
                    commands::plugins::load_plugin,
                    commands::plugins::unload_plugin,
                    commands::plugins::set_plugin_parameter,
                    commands::plugins::get_plugin_parameters,
                    commands::plugins::get_plugin_state,
                    commands::plugins::set_plugin_state,
                ])
                .export_for_plugin(specta::typescript::ExportConfiguration::new(), app.handle(), "../src/bindings.ts", "tauri")?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

