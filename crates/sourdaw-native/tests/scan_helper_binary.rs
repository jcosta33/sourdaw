//! Proves the plugin-scan leaf helper's process contract without a real
//! plugin: the safety refusal for a process started with no worker marker,
//! and a bounded, cleanly-failing extraction attempt against a path with
//! nothing at it. `crates/sourdaw-native/src/host/plugin_scan_worker.rs`
//! owns the contract these assert against; this only proves the standalone
//! `sourdaw-plugin-scan-helper` binary actually runs it.

use std::process::Command;
use std::time::{Duration, Instant};

#[test]
fn refuses_to_run_with_no_worker_marker() {
    let output = Command::new(env!("CARGO_BIN_EXE_sourdaw-plugin-scan-helper"))
        .output()
        .expect("the helper binary should start");

    assert_eq!(
        output.status.code(),
        Some(2),
        "a helper started with no worker marker should refuse rather than do nothing silently"
    );
    assert!(
        !output.stderr.is_empty(),
        "the refusal should say why on stderr"
    );
}

#[test]
fn runs_a_descriptor_scan_leaf_to_completion() {
    let response_dir = std::env::temp_dir().join(format!(
        "sourdaw-scan-helper-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after the epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&response_dir).expect("temp response dir should be creatable");
    let response_path = response_dir.join("response.json");

    let started = Instant::now();
    let status = Command::new(env!("CARGO_BIN_EXE_sourdaw-plugin-scan-helper"))
        .arg("--sourdaw-plugin-scan-worker")
        .arg("clap")
        .arg("/nonexistent/does-not-exist.clap")
        .arg(&response_path)
        .status()
        .expect("the helper binary should start");
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(5),
        "a leaf scan against one path should finish well inside its bound, took {elapsed:?}"
    );
    assert!(
        status.success(),
        "a completed leaf reports success on its own exit code, whatever the extraction result was"
    );

    let response_body =
        std::fs::read_to_string(&response_path).expect("the leaf should write a response file");
    let response: serde_json::Value =
        serde_json::from_str(&response_body).expect("the response file should be JSON");
    assert!(
        response
            .get("result")
            .and_then(|result| result.get("Err"))
            .is_some(),
        "a nonexistent CLAP path should extract as Err, got: {response}"
    );

    let _ = std::fs::remove_dir_all(&response_dir);
}
