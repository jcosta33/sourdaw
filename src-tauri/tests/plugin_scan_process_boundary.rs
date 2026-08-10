use std::process::Command;
#[test]
fn scan_command_does_not_load_plugin_code_in_the_application_process() {
    let command_source = include_str!("../src/commands/plugins.rs");
    assert!(!command_source.contains("extract_clap_metadata("));
    assert!(include_str!("../src/main.rs").contains("plugin_scan_worker::run_from_process_args"));
}
#[test]
fn packaged_application_binary_enters_the_scan_worker_before_tauri_startup() {
    let response_path =
        std::env::temp_dir().join(format!("sourdaw-worker-{}.json", std::process::id()));
    let status = Command::new(env!("CARGO_BIN_EXE_sourdaw"))
        .arg(sourdaw_lib::host::plugin_scan_worker::WORKER_ARGUMENT)
        .arg(env!("CARGO_BIN_EXE_sourdaw"))
        .arg(&response_path)
        .status()
        .expect("application scan worker should start");
    assert!(status.success());
    let response: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&response_path).expect("worker response should be written"),
    )
    .expect("worker response should be valid JSON");
    let _ = std::fs::remove_file(&response_path);
    assert_ne!(
        response["worker_pid"].as_u64(),
        Some(u64::from(std::process::id()))
    );
    let error = response["result"]["Err"].as_str().unwrap();
    assert!(error.contains("clap_entry"));
}
