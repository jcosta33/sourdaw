mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::llm::invoke_llm,
            commands::llm::get_llm_status,
            commands::speech::transcribe_audio,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
