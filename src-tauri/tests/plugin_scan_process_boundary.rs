use std::path::PathBuf;
use std::process::Command;

fn unique_temp_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "sourdaw-plugin-worker-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos()
    ))
}

#[test]
fn scan_command_does_not_load_plugin_code_in_the_application_process() {
    let command_source = include_str!("../src/commands/plugins.rs");
    let application_entry = include_str!("../src/main.rs");

    assert!(
        !command_source.contains("scanner::scan_directory("),
        "scan_plugins still invokes native plugin metadata extraction in the application process"
    );
    assert!(command_source.contains("plugin_scan_worker::scan_clap_metadata"));
    assert!(application_entry.contains("plugin_scan_worker::run_from_process_args"));
}

#[test]
fn packaged_application_binary_enters_the_scan_worker_before_tauri_startup() {
    let temp_root = unique_temp_root();
    std::fs::create_dir_all(&temp_root).expect("temporary worker directory should be created");
    let response_path = temp_root.join("response.json");

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
    let _ = std::fs::remove_dir_all(&temp_root);

    assert_ne!(
        response["worker_pid"].as_u64(),
        Some(u64::from(std::process::id()))
    );
    assert!(
        response["result"]["Err"]
            .as_str()
            .is_some_and(|error| error.contains("clap_entry")),
        "non-CLAP input should return a bounded worker error: {response}"
    );
}
